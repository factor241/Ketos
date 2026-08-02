# ruff: noqa: EM101, PLR2004, PT018, S101, S603, SLF001

from __future__ import annotations

import subprocess
import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts/mvp/check_stage01_source_boundaries.py"


def _load_guard():
    spec = spec_from_file_location("stage01_source_boundary_guard", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_stage01_source_boundary_guard_passes_current_checkout() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/mvp/check_stage01_source_boundaries.py"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "stage01-source-boundary: PASS"


def test_python_ast_guard_detects_aliases_brackets_custom_protocol_and_local_resume(tmp_path: Path) -> None:
    guard = _load_guard()
    source = tmp_path / "bypass.py"
    source.write_text(
        """
from langgraph.types import Command as ResumeCommand
from ag_ui.core import CustomEvent as CE
import importlib as loader

Alias = ResumeCommand
g = getattr
module_name = "langgraph." + "types"
command_name = "Com" + "mand"
DynamicCommand = g(loader.import_module(module_name), command_name)

def parse_ag_ui_payload(value):
    forwarded_key = "forwarded" + "Props"
    command_key = "com" + "mand"
    resume_key = "res" + "ume"
    legacy = value[forwarded_key][command_key][resume_key]
    forwarded = value.forwarded_props
    command = forwarded["command"]
    dynamic = getattr(getattr(getattr(value, "forwarded_props"), "command"), "resume")
    return legacy, command["resume"], dynamic

def bypass():
    Alias(resume={"approved": True})
    return DynamicCommand(resume={"approved": False})
""",
        encoding="utf-8",
    )

    violations = guard._python_bypass_violations(source)

    assert "deprecated forwardedProps command resume access" in violations
    assert "local Command(resume=...) construction" in violations
    assert "custom event or encoder import" in violations
    assert "local AG-UI parser or encoder" in violations


def test_python_guard_fails_closed_on_unparseable_and_unreadable_files(tmp_path: Path, monkeypatch) -> None:
    guard = _load_guard()
    invalid = tmp_path / "invalid.py"
    invalid.write_text("def broken(:\n", encoding="utf-8")
    with pytest.raises(guard.BoundaryError, match="cannot parse"):
        guard._parse_python(invalid)

    unreadable = tmp_path / "unreadable.py"
    unreadable.write_text("pass\n", encoding="utf-8")
    original_read_text = Path.read_text

    def denied_read(path, *args, **kwargs):
        if path == unreadable:
            raise PermissionError("denied")
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", denied_read)
    with pytest.raises(guard.BoundaryError, match="cannot read"):
        guard._parse_python(unreadable)


def test_call_counter_detects_extra_registrar_alias_calls(tmp_path: Path) -> None:
    guard = _load_guard()
    source = tmp_path / "registrars.py"
    source.write_text(
        """
from ag_ui_langgraph import add_langgraph_fastapi_endpoint as add_endpoint

add_endpoint(app, agent)
indirect = add_endpoint
indirect(app, agent)
namespace.add_langgraph_fastapi_endpoint(app, agent)
""",
        encoding="utf-8",
    )

    assert guard._call_count(source, "add_langgraph_fastapi_endpoint") == 3


def test_registrar_chain_detects_an_aliased_call_from_an_unowned_file(tmp_path: Path) -> None:
    guard = _load_guard()
    allowed = tmp_path / "allowed.py"
    allowed.write_text("register_stage01_ag_ui(app, runtime)\n", encoding="utf-8")
    bypass = tmp_path / "bypass.py"
    bypass.write_text(
        "from ketos.agentic.api.router import register_stage01_ag_ui as register\nregister(app, runtime)\n",
        encoding="utf-8",
    )

    assert guard._unexpected_callers([allowed, bypass], "register_stage01_ag_ui", allowed) == [bypass]


def test_registrar_reference_guard_rejects_parameter_and_default_relays(tmp_path: Path) -> None:
    guard = _load_guard()
    owner = tmp_path / "owner.py"
    owner.write_text(
        "from source import register_stage01_ag_ui\nregister_stage01_ag_ui(app, runtime)\n",
        encoding="utf-8",
    )
    relay = tmp_path / "relay.py"
    relay.write_text(
        "from source import register_stage01_ag_ui\n"
        "def forward(callback=register_stage01_ag_ui):\n    callback(app, runtime)\n",
        encoding="utf-8",
    )

    violations = guard._registrar_reference_violations([owner, relay], "register_stage01_ag_ui", None, owner)

    assert any("relayed registrar reference" in item for item in violations)


def test_registrar_reference_guard_rejects_computed_getattr_default(tmp_path: Path) -> None:
    guard = _load_guard()
    owner = tmp_path / "owner.py"
    owner.write_text("register_stage01_ag_ui(app, runtime)\n", encoding="utf-8")
    bypass = tmp_path / "bypass.py"
    bypass.write_text(
        'def relay(cb=getattr(module, "register_stage01_" + "ag_ui")):\n'
        "    cb(app, runtime)\n",
        encoding="utf-8",
    )

    violations = guard._registrar_reference_violations(
        [owner, bypass], "register_stage01_ag_ui", None, owner
    )

    assert any("relayed registrar reference" in item for item in violations)


def test_route_guard_rejects_alternate_registration(tmp_path: Path, monkeypatch) -> None:
    guard = _load_guard()
    backend = tmp_path / "ketos"
    api = backend / "agentic/api"
    service = backend / "agentic/services/ag_ui"
    api.mkdir(parents=True)
    service.mkdir(parents=True)
    admitted = api / "ag_ui_router.py"
    admitted.write_text('register(path="/ag-ui")\nrouter.include_router(private.router)\n', encoding="utf-8")
    registrar = api / "router.py"
    registrar.write_text("app.include_router(stage01_router)\n", encoding="utf-8")
    bypass = service / "bypass.py"
    bypass.write_text('api = app\napi.add_api_route("/api/v1/agentic/" + "ag-ui-shadow", handler)\n', encoding="utf-8")
    monkeypatch.setattr(guard, "BACKEND_ROOT", backend)
    monkeypatch.setattr(guard, "STAGE01_BACKEND", service)
    monkeypatch.setattr(guard, "ROOT", tmp_path)

    violations = guard._route_boundary_violations([admitted, registrar, bypass])

    assert any("route mutation" in item for item in violations)


def test_production_scan_covers_all_changed_runtime_and_backend_sources() -> None:
    guard = _load_guard()
    sources = set(guard._production_sources(guard._workspace_changed_paths()))

    assert guard.BACKEND_ROOT / "agentic/api/router.py" in sources
    assert guard.RUNTIME_SOURCE_ROOT / "credential-forwarding.ts" in sources
    assert guard.RUNTIME_SOURCE_ROOT / "origin-guard.ts" in sources
    assert guard.ROOT / "src/kfx/src/kfx/services/settings/feature_flags.py" in sources
    assert guard.FRONTEND_ROOT / "vite.config.mts" in sources
    assert guard.FRONTEND_ROOT / "postcss.config.js" in sources
    assert guard.ROOT / "scripts/mvp/probe_ag_ui_adapter.py" in sources


@pytest.mark.parametrize(
    "source",
    [
        "const decoder = new TextDecoder()",
        "const stream = new EventSource(url)",
        'const mime = "text/event-stream"',
        "target.dispatchEvent(event)",
        "input.forwardedProps.command.resume",
        "Command({ resume: payload })",
    ],
)
def test_typescript_custom_transport_patterns_are_detected(source: str) -> None:
    guard = _load_guard()
    assert any(pattern.search(source) for pattern in guard.FORBIDDEN_TS_PRODUCTION_PATTERNS)


@pytest.mark.parametrize(
    "source",
    [
        'fetch("/api/v1/agentic/ag-ui", {method: "POST"})',
        'page.request.post("/api/copilotkit")',
        'request.fetch("/api/copilotkit")',
        "page.evaluate(() => window.fetch('/api/copilotkit'))",
        "element.dispatchEvent(new CustomEvent('resume'))",
        "fetch(runtimeUrl, options)",
        "new XMLHttpRequest()",
        "axios.post(runtimeUrl, body)",
        "page.request.delete(runtimeUrl)",
        "send = fetch; send(runtimeUrl)",
        "window['fetch'](runtimeUrl)",
        "send = axios; send.post(runtimeUrl)",
        "client = page.request; client.post(runtimeUrl)",
        "navigator.sendBeacon(runtimeUrl, body)",
        "new WebSocket(runtimeUrl)",
        "page.evaluateHandle(() => fetch(runtimeUrl))",
        "page.$eval('body', () => fetch(runtimeUrl))",
    ],
)
def test_manual_e2e_transport_patterns_are_detected(source: str) -> None:
    guard = _load_guard()
    assert any(pattern.search(source) for pattern in guard.MANUAL_E2E_PATTERNS)


@pytest.mark.parametrize(
    "source",
    [
        "const { request: client } = page; client.post(url)",
        "page['re' + 'quest'].post(url)",
        "window['fe' + 'tch'](url)",
    ],
)
def test_conservative_e2e_guard_detects_destructured_and_computed_roots(source: str) -> None:
    guard = _load_guard()
    assert guard._e2e_transport_violations(source)


@pytest.mark.parametrize(
    "source",
    [
        'const key = `fe${"tch"}`;\nwindow[key](url)',
        'const key = ["fe", "tch"].join("");\nglobalThis[key](url)',
    ],
)
def test_conservative_e2e_guard_rejects_multiline_computed_global_transport(source: str) -> None:
    guard = _load_guard()
    assert guard._e2e_transport_violations(source)


def test_conservative_e2e_guard_allows_only_passive_request_observation() -> None:
    guard = _load_guard()
    source = 'page.on("request", (eventCandidate) => observe(eventCandidate))\nresponse.request()'
    assert guard._e2e_transport_violations(source) == []


def test_shell_guard_rejects_custom_protocol_tokens() -> None:
    guard = _load_guard()
    assert guard._shell_bypass_violations("dispatchEvent resume") == ["dispatchEvent"]


@pytest.mark.parametrize(
    "source",
    [
        'curl -X POST -d "forwardedProps.command.resume" "$url"',
        'python -c "Command(resume={})"',
    ],
)
def test_shell_guard_rejects_manual_resume_commands(source: str) -> None:
    guard = _load_guard()
    assert guard._shell_bypass_violations(source)


def test_ancestry_guard_requires_both_exact_commits_to_be_head_ancestors(monkeypatch) -> None:
    guard = _load_guard()

    def fake_git(*args: str):
        if args[:2] == ("rev-parse", "--verify"):
            commit = args[2].removesuffix("^{commit}")
            return subprocess.CompletedProcess(args, 0, stdout=f"{commit}\n", stderr="")
        return subprocess.CompletedProcess(args, 1, stdout="", stderr="not ancestor")

    monkeypatch.setattr(guard, "_git", fake_git)
    with pytest.raises(guard.BoundaryError, match="not descended"):
        guard._require_ancestry()


def test_workspace_paths_include_commit_index_worktree_and_untracked(monkeypatch) -> None:
    guard = _load_guard()
    outputs = iter(["committed\n", "indexed\n", "worktree\n", "untracked\n"])
    monkeypatch.setattr(
        guard,
        "_git",
        lambda *args: subprocess.CompletedProcess(args, 0, stdout=next(outputs), stderr=""),
    )

    assert guard._workspace_changed_paths() == {"committed", "indexed", "worktree", "untracked"}


def test_ownership_uses_exact_file_matches_and_rejects_suffix_bypass(monkeypatch) -> None:
    guard = _load_guard()
    admitted = "src/frontend/vite.config.mts"
    monkeypatch.setattr(guard, "_workspace_changed_paths", lambda: {admitted, f"{admitted}.evil"})

    with pytest.raises(guard.BoundaryError, match=r"vite\.config\.mts\.evil"):
        guard._require_changed_path_ownership()


def test_ownership_rejects_rogue_files_inside_formerly_broad_directories(monkeypatch) -> None:
    guard = _load_guard()
    monkeypatch.setattr(
        guard,
        "_workspace_changed_paths",
        lambda: {"src/copilot-runtime/rogue-protocol.ts", "vendor/stage01/unexpected.bin"},
    )

    with pytest.raises(guard.BoundaryError, match="rogue-protocol"):
        guard._require_changed_path_ownership()
