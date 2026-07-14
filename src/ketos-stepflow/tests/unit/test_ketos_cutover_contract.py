"""Destructive Ketos cutover contract for the Stepflow integration package."""

from __future__ import annotations

import hashlib
import re
import subprocess
import tarfile
import zipfile
from pathlib import Path

import pytest
import tomllib

REPO_ROOT = Path(__file__).resolve().parents[4]
OLD_SLUG = "lang" + "flow"
OLD_EXECUTOR = "l" + "fx"
OLD_PACKAGE_ROOT = REPO_ROOT / "src" / f"{OLD_SLUG}-stepflow"
PACKAGE_ROOT = REPO_ROOT / "src" / "ketos-stepflow"
OLD_BRAND = re.compile(rf"{OLD_SLUG[:4]}[-_ ]?{OLD_SLUG[4:]}", re.IGNORECASE)


def test_stepflow_package_has_destructive_ketos_cutover() -> None:
    assert PACKAGE_ROOT.is_dir()
    assert not OLD_PACKAGE_ROOT.exists()
    assert (PACKAGE_ROOT / "src" / "ketos_stepflow" / "__init__.py").is_file()
    assert not (PACKAGE_ROOT / "src" / f"{OLD_SLUG}_stepflow").exists()

    manifest = tomllib.loads((PACKAGE_ROOT / "pyproject.toml").read_text())
    assert manifest["project"]["name"] == "ketos-stepflow"
    assert manifest["tool"]["hatch"]["build"]["targets"]["wheel"]["packages"] == ["src/ketos_stepflow"]
    dependencies = set(manifest["project"]["dependencies"])
    assert "kfx~=1.10.2" in dependencies
    assert "ketos-base~=0.10.2" in dependencies
    assert OLD_EXECUTOR not in dependencies


def test_stepflow_protocol_is_ketos_only() -> None:
    source = PACKAGE_ROOT / "src" / "ketos_stepflow"
    source_text = "\n".join(path.read_text(errors="replace") for path in source.rglob("*.py"))
    assert "/ketos/" in source_text
    assert "__ketos_type__" in source_text
    assert '"ketos"' in source_text
    assert f"/{OLD_SLUG}/" not in source_text.lower()
    assert f"__{OLD_SLUG}_type__" not in source_text.lower()
    assert f'"{OLD_SLUG}"' not in source_text.lower()


def test_old_stepflow_type_marker_is_rejected() -> None:
    from ketos_stepflow.worker.handlers.ketos_types import KetosTypeInputHandler

    old_marker = "__" + OLD_SLUG + "_type__"
    handler = KetosTypeInputHandler()
    with pytest.raises(ValueError, match="Legacy Stepflow type marker"):
        handler.matches(template_field={}, value={old_marker: "Message", "text": "no"})


@pytest.mark.parametrize(
    "value,kind",
    [
        (OLD_SLUG + "_node", "step ID"),
        ("/" + OLD_SLUG + "/core/prompt", "component route"),
        (OLD_SLUG, "queue"),
    ],
)
def test_old_stepflow_protocol_values_are_rejected(value: str, kind: str) -> None:
    from ketos_stepflow.protocol import validate_component_route, validate_queue_name, validate_step_id

    validators = {
        "step ID": validate_step_id,
        "component route": validate_component_route,
        "queue": validate_queue_name,
    }
    with pytest.raises(ValueError, match=f"Legacy Stepflow {kind}"):
        validators[kind](value)


def test_stepflow_workflow_tweaks_reject_old_ids_and_routes() -> None:
    from ketos_stepflow.translation.stepflow_tweaks import apply_stepflow_tweaks_to_dict

    old_id = OLD_SLUG + "_node"
    old_route = "/" + OLD_SLUG + "/core/prompt"
    with pytest.raises(ValueError, match="Legacy Stepflow step ID"):
        apply_stepflow_tweaks_to_dict({"steps": [{"id": old_id, "component": "/ketos/core/prompt"}]})
    with pytest.raises(ValueError, match="Legacy Stepflow component route"):
        apply_stepflow_tweaks_to_dict({"steps": [{"id": "ketos_node", "component": old_route}]})


def test_stepflow_observability_defaults_to_ketos_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import InMemoryMetricReader
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
    from stepflow_py.worker.observability import ObservabilityConfig

    from ketos_stepflow.worker import __main__ as worker_main

    monkeypatch.delenv("STEPFLOW_SERVICE_NAME", raising=False)
    assert worker_main.configure_observability_environment() == "ketos-stepflow"
    config = ObservabilityConfig()
    resource = Resource.create({"service.name": config.service_name})

    span_exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(SimpleSpanProcessor(span_exporter))
    with tracer_provider.get_tracer("task11").start_as_current_span("runtime-cutover"):
        pass

    metric_reader = InMemoryMetricReader()
    meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
    meter_provider.get_meter("task11").create_counter("runtime.cutover").add(1)
    metrics = metric_reader.get_metrics_data()

    assert span_exporter.get_finished_spans()[0].resource.attributes["service.name"] == "ketos-stepflow"
    assert metrics.resource_metrics[0].resource.attributes["service.name"] == "ketos-stepflow"


def test_old_brand_is_confined_to_package_notice() -> None:
    violations: list[str] = []
    for path in PACKAGE_ROOT.rglob("*"):
        if (
            not path.is_file()
            or path.name == "NOTICE"
            or "__pycache__" in path.parts
            or ".pytest_cache" in path.parts
        ):
            continue
        if OLD_BRAND.search(path.read_text(errors="replace")):
            violations.append(path.relative_to(REPO_ROOT).as_posix())
    assert violations == []


def test_stepflow_package_carries_apache_license_and_provenance_notice() -> None:
    license_text = (PACKAGE_ROOT / "LICENSE").read_text()
    legacy_product = OLD_SLUG.capitalize()
    provenance_line = (
        f"This product includes software derived from {legacy_product} Stepflow, "
        "licensed under the Apache License, Version 2.0."
    )
    expected_notice = f"Ketos Stepflow Notice\n\n{provenance_line}\n".encode()
    notice_bytes = (PACKAGE_ROOT / "NOTICE").read_bytes()

    assert "Apache License" in license_text
    assert "Version 2.0, January 2004" in license_text
    assert notice_bytes == expected_notice
    assert notice_bytes.decode().splitlines()[2] == provenance_line
    assert (
        hashlib.sha256(notice_bytes).hexdigest() == "d5fe5257f43692583fb8f66bb222dd0250a277fcab482bb50de6d124e9243cd4"
    )


def test_canonical_ketos_flow_fixtures_are_versioned_and_not_optional() -> None:
    fixtures = PACKAGE_ROOT / "tests" / "fixtures" / "ketos"
    assert (fixtures / "basic_prompting.json").is_file()
    assert (fixtures / "simple_agent.json").is_file()

    tests_text = "\n".join(path.read_text() for path in (PACKAGE_ROOT / "tests").rglob("test_*.py"))
    assert "fixture " + "not found" not in tests_text


def test_built_artifacts_carry_legal_files_without_legacy_payloads(tmp_path: Path) -> None:
    subprocess.run(
        ["uv", "build", "--project", str(PACKAGE_ROOT), "--wheel", "--sdist", "--out-dir", str(tmp_path)],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    artifacts = [*tmp_path.glob("*.whl"), *tmp_path.glob("*.tar.gz")]
    assert len(artifacts) == 2
    for artifact in artifacts:
        if artifact.suffix == ".whl":
            with zipfile.ZipFile(artifact) as archive:
                entries = {name: archive.read(name) for name in archive.namelist()}
        else:
            with tarfile.open(artifact, "r:gz") as archive:
                entries = {
                    member.name: extracted.read()
                    for member in archive.getmembers()
                    if member.isfile() and (extracted := archive.extractfile(member)) is not None
                }

        assert sorted(Path(name).name for name in entries).count("LICENSE") == 1
        assert sorted(Path(name).name for name in entries).count("NOTICE") == 1
        assert ".gitignore" not in {Path(name).name for name in entries}
        assert not any(OLD_BRAND.search(name) or OLD_EXECUTOR in name.lower() for name in entries)
        assert not any(
            Path(name).name != "NOTICE"
            and (OLD_BRAND.search(payload.decode(errors="replace")) or OLD_EXECUTOR in payload.decode(errors="replace"))
            for name, payload in entries.items()
        )
