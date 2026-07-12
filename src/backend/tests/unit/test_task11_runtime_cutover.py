from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from fastapi import HTTPException
from ketos.api.utils.core import extract_global_variables_from_headers
from ketos.services.cache.service import RedisCache
from ketos.services.rate_limit import service as rate_limit_service

if TYPE_CHECKING:
    from httpx import AsyncClient

REPO_ROOT = Path(__file__).resolve().parents[4]
OLD_PRODUCT = "lang" + "flow"
OLD_MCP_PREFIX = "l" + "f-"


def test_mcp_project_server_ids_use_canonical_prefix_only() -> None:
    for relative_path in (
        "src/backend/base/ketos/api/utils/mcp/config_utils.py",
        "src/backend/base/ketos/api/v1/mcp_projects.py",
    ):
        source = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
        assert OLD_MCP_PREFIX not in source
        assert "ketos-" in source


def test_celery_runtime_contract_has_explicit_names_and_default_route() -> None:
    import ketos.worker  # noqa: F401
    from ketos.core.celery_app import celery_app

    assert celery_app.conf.task_default_queue == "ketos"
    assert celery_app.conf.task_default_exchange == "ketos"
    assert celery_app.conf.task_default_routing_key == "ketos"
    expected = {
        "ketos.worker.tasks.test_celery",
        "ketos.worker.tasks.build_vertex",
        "ketos.worker.tasks.process_graph_cached_task",
    }
    assert expected <= set(celery_app.tasks)


def test_redis_hmac_domain_and_slowapi_keys_are_namespaced(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = object.__new__(RedisCache)
    cache._signing_key = None
    monkeypatch.setattr(
        "ketos.services.deps.get_settings_service",
        lambda: SimpleNamespace(
            auth_settings=SimpleNamespace(SECRET_KEY=SimpleNamespace(get_secret_value=lambda: "secret"))
        ),
    )

    assert RedisCache.HMAC_DOMAIN.startswith(b"ketos:")
    assert cache._get_signing_key()
    assert rate_limit_service.RATE_LIMIT_KEY_PREFIX == "ketos:rate-limit:"


@pytest.mark.parametrize(
    "headers",
    [
        {f"x-{OLD_PRODUCT}-global-var-secret": "value"},
        {f"x-{OLD_PRODUCT}-session": "value"},
    ],
)
def test_old_http_headers_are_rejected_during_extraction(headers: dict[str, str]) -> None:
    with pytest.raises(HTTPException) as exc_info:
        extract_global_variables_from_headers(headers, include_auth_headers=True)
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Legacy HTTP headers are not supported"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("POST", "/api/v1/run/not-a-flow", {}),
        ("POST", "/api/v2/workflows", {}),
        ("POST", f"/api/v1/mcp/project/{uuid4()}", {}),
    ],
)
async def test_old_headers_are_rejected_by_runtime_routes_before_execution(
    client: AsyncClient,
    method: str,
    path: str,
    payload: dict,
) -> None:
    response = await client.request(
        method,
        path,
        headers={f"x-{OLD_PRODUCT}-global-var-secret": "value"},
        json=payload,
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Legacy HTTP headers are not supported"}


@pytest.mark.asyncio
async def test_scarf_telemetry_requires_explicit_consent_and_url(monkeypatch: pytest.MonkeyPatch) -> None:
    from ketos.services.telemetry.service import TelemetryService as BackendTelemetryService
    from kfx.services.settings.groups.telemetry import TelemetrySettings
    from kfx.services.telemetry.service import TelemetryService as KfxTelemetryService

    monkeypatch.delenv("KETOS_TELEMETRY_BASE_URL", raising=False)
    monkeypatch.delenv("DO_NOT_TRACK", raising=False)
    settings = TelemetrySettings()
    assert settings.do_not_track is True
    assert settings.telemetry_base_url is None

    default_service = KfxTelemetryService()
    default_service.start()
    assert default_service._client is None
    assert default_service._worker_task is None

    consent_without_url = KfxTelemetryService(do_not_track=False)
    consent_without_url.start()
    assert consent_without_url._client is None
    assert consent_without_url._worker_task is None

    settings_service = SimpleNamespace(
        settings=SimpleNamespace(
            telemetry_base_url=None,
            do_not_track=False,
            prometheus_enabled=False,
        ),
    )
    backend_service = BackendTelemetryService(settings_service)
    backend_service.start()
    assert backend_service.client is None
    assert backend_service.worker_task is None

    explicit = KfxTelemetryService(base_url="https://telemetry.example.test", do_not_track=False)
    explicit.start()
    assert explicit._client is not None
    assert explicit._worker_task is not None
    await explicit.stop()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_live_redis_key_channel_and_hmac_contract() -> None:
    redis = pytest.importorskip("redis.asyncio")
    client = redis.Redis(host="127.0.0.1", port=6379, db=15, socket_connect_timeout=0.2)
    try:
        await client.ping()
    except Exception as exc:
        pytest.fail(f"local Redis is required for the Task 11 live gate: {exc}")

    from ketos.services.job_queue.service import RedisJobQueueService

    job_id = f"task11-live-{uuid4()}"
    producer = RedisJobQueueService(
        url="redis://127.0.0.1:6379/15",
        ttl=30,
        startup_grace_s=0.5,
        polling_stale_threshold_s=0,
    )
    subscriber = RedisJobQueueService(
        url="redis://127.0.0.1:6379/15",
        ttl=30,
        startup_grace_s=0.5,
        polling_stale_threshold_s=0,
    )
    pubsub = client.pubsub()
    try:
        producer.start()
        subscriber.start()
        await asyncio.gather(producer._connection_check_task, subscriber._connection_check_task)

        local_queue, event_manager = producer.create_queue(job_id)
        event_manager.send_event(event_type="task11.runtime", data={"runtime": "ketos"})
        local_queue.put_nowait((None, None, 1.0))

        remote_queue, _, _, _ = subscriber.get_queue_data(job_id)
        event = await asyncio.wait_for(remote_queue.get(), timeout=5)
        sentinel = await asyncio.wait_for(remote_queue.get(), timeout=5)
        assert json.loads(event[1])["event"] == "task11.runtime"
        assert sentinel[0] is None

        channel = producer._cancel_channel(job_id)
        await pubsub.subscribe(channel)
        await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.1)
        await producer.signal_cancel(job_id)
        cancel_message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=2)
        assert cancel_message is not None

        emitted_keys = {
            key.decode() if isinstance(key, bytes) else key
            for key in await client.keys(f"*{job_id}*")
        }
        emitted_channels = {channel}
        assert emitted_keys
        assert all(key.startswith("ketos:") for key in emitted_keys)
        assert all(name.startswith("ketos:") for name in emitted_channels)
        assert all(OLD_PRODUCT not in key.lower() for key in emitted_keys)
        assert all(OLD_PRODUCT not in name.lower() for name in emitted_channels)
    finally:
        await pubsub.aclose()
        await producer.stop()
        await subscriber.stop()
        stale_keys = await client.keys(f"*{job_id}*")
        if stale_keys:
            await client.delete(*stale_keys)
        await client.aclose()


def test_stepflow_setup_observability_emits_ketos_resources() -> None:
    script = r"""
import json
import os

os.environ.pop("STEPFLOW_SERVICE_NAME", None)
os.environ["STEPFLOW_OTLP_ENDPOINT"] = "http://collector.invalid:4317"
os.environ["STEPFLOW_LOG_DESTINATION"] = "stderr"

from ketos_stepflow.worker import __main__ as worker_main
from opentelemetry import metrics, trace
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from stepflow_py.worker import observability

span_exporter = InMemorySpanExporter()
metric_reader = InMemoryMetricReader()
observability.OTLPSpanExporter = lambda **kwargs: span_exporter
observability.BatchSpanProcessor = SimpleSpanProcessor
observability.OTLPMetricExporter = lambda **kwargs: object()
observability.PeriodicExportingMetricReader = lambda *args, **kwargs: metric_reader
observability.setup_observability()

with trace.get_tracer("task11").start_as_current_span("runtime-cutover"):
    pass
metrics.get_meter("task11").create_counter("runtime.cutover").add(1)
metric_data = metric_reader.get_metrics_data()
print(json.dumps({
    "configured": os.environ["STEPFLOW_SERVICE_NAME"],
    "server_module": worker_main.server.__class__.__module__,
    "span_service": span_exporter.get_finished_spans()[0].resource.attributes["service.name"],
    "metric_service": metric_data.resource_metrics[0].resource.attributes["service.name"],
}))
"""
    env = os.environ.copy()
    env.pop("STEPFLOW_SERVICE_NAME", None)
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", script],
        cwd=REPO_ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    evidence = json.loads(result.stdout.strip().splitlines()[-1])
    assert evidence == {
        "configured": "ketos-stepflow",
        "server_module": "stepflow_py.worker.server",
        "span_service": "ketos-stepflow",
        "metric_service": "ketos-stepflow",
    }


@pytest.mark.integration
def test_live_celery_worker_inspect_registered_and_default_queue() -> None:
    import ketos.worker  # noqa: F401
    from celery.contrib.testing.worker import start_worker
    from ketos.core.celery_app import celery_app

    original_broker = celery_app.conf.broker_url
    original_backend = celery_app.conf.result_backend
    celery_app.conf.update(broker_url="memory://", result_backend="cache+memory://")
    try:
        with start_worker(
            celery_app,
            perform_ping_check=False,
            pool="solo",
            shutdown_timeout=5,
        ) as worker:
            inspector = celery_app.control.inspect(destination=[worker.hostname], timeout=2)
            registered = inspector.registered() or {}
            active_queues = inspector.active_queues() or {}
            assert any("ketos.worker.tasks.test_celery" in tasks for tasks in registered.values())
            assert all(queues and queues[0]["name"] == "ketos" for queues in active_queues.values())
    finally:
        celery_app.conf.update(broker_url=original_broker, result_backend=original_backend)
