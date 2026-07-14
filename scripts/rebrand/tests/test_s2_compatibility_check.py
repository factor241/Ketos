from __future__ import annotations

# ruff: noqa: I001, S101

import importlib.util
import base64
import csv
import hashlib
import io
import sys
import zipfile
from copy import deepcopy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
CHECKER = ROOT / "scripts/rebrand/check_s2_compatibility.py"
SPEC = importlib.util.spec_from_file_location("check_s2_compatibility", CHECKER)
assert SPEC is not None
assert SPEC.loader is not None
check = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = check
SPEC.loader.exec_module(check)


def _write_wheel(
    directory: Path,
    distribution: str,
    *,
    members: tuple[str, ...] = (),
    entry_points: str = "",
) -> Path:
    normalized = distribution.replace("-", "_")
    path = directory / f"{normalized}-1.0.0-py3-none-any.whl"
    dist_info = f"{normalized}-1.0.0.dist-info"
    payload = {
        f"{dist_info}/METADATA": (f"Metadata-Version: 2.4\nName: {distribution}\nVersion: 1.0.0\n").encode(),
        f"{dist_info}/WHEEL": b"Wheel-Version: 1.0\n",
        **dict.fromkeys(members, b""),
    }
    if entry_points:
        payload[f"{dist_info}/entry_points.txt"] = entry_points.encode()
    record_buffer = io.StringIO()
    writer = csv.writer(record_buffer, lineterminator="\n")
    for member, content in payload.items():
        encoded = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).rstrip(b"=").decode()
        writer.writerow((member, f"sha256={encoded}", len(content)))
    writer.writerow((f"{dist_info}/RECORD", "", ""))
    payload[f"{dist_info}/RECORD"] = record_buffer.getvalue().encode()
    with zipfile.ZipFile(path, "w") as archive:
        for member, content in payload.items():
            archive.writestr(member, content)
    return path


def _complete_wheelhouse(directory: Path) -> None:
    pytest_entries = {
        "kfx": "[pytest11]\nkfx = kfx.testing\n",
        "ketos-sdk": "[pytest11]\nketos = ketos_sdk.testing\n",
    }
    for distribution in check.ALL_DISTRIBUTIONS:
        _write_wheel(
            directory,
            distribution,
            members=(f"{distribution.replace('-', '_')}/owned.py",),
            entry_points=pytest_entries.get(distribution, ""),
        )


def test_discover_wheels_requires_exactly_one_of_each_distribution(tmp_path: Path) -> None:
    _complete_wheelhouse(tmp_path)

    wheels = check.discover_wheels(tmp_path)

    assert tuple(wheels) == check.ALL_DISTRIBUTIONS
    assert all(path.suffix == ".whl" for path in wheels.values())
    wheels["lfx"].unlink()
    with pytest.raises(check.AcceptanceError, match=r"missing wheel.*lfx"):
        check.discover_wheels(tmp_path)


def test_non_metadata_overlap_is_rejected_but_dist_info_is_ignored(tmp_path: Path) -> None:
    _complete_wheelhouse(tmp_path)
    wheels = check.discover_wheels(tmp_path)
    assert check.find_pair_overlaps(wheels) == {}

    wheel = wheels["langflow-sdk"]
    with zipfile.ZipFile(wheel, "a") as archive:
        archive.writestr("ketos_sdk/owned.py", "")

    assert check.find_pair_overlaps(wheels) == {"ketos-sdk:langflow-sdk": ["ketos_sdk/owned.py"]}


def test_only_canonical_distributions_own_each_pytest_plugin_family(tmp_path: Path) -> None:
    _complete_wheelhouse(tmp_path)
    wheels = check.discover_wheels(tmp_path)

    assert check.validate_pytest_entry_points(wheels) == {
        "executor": [("kfx", "kfx", "kfx.testing")],
        "sdk": [("ketos-sdk", "ketos", "ketos_sdk.testing")],
    }

    legacy_wheel = wheels["lfx"]
    with zipfile.ZipFile(legacy_wheel, "a") as archive:
        archive.writestr(
            "lfx-1.0.0.dist-info/entry_points.txt",
            "[pytest11]\nlfx = lfx.testing\n",
        )
    with pytest.raises(check.AcceptanceError, match="pytest11 ownership"):
        check.validate_pytest_entry_points(wheels)


def test_install_matrix_preserves_both_orders_and_legacy_dependency_closure() -> None:
    scenarios = check.install_scenarios()

    assert tuple(scenarios) == (
        "canonical-only",
        "legacy-only",
        "canonical-then-legacy",
        "legacy-then-canonical",
    )
    assert scenarios["canonical-only"] == (check.CANONICAL_DISTRIBUTIONS,)
    assert scenarios["legacy-only"] == (check.LEGACY_DISTRIBUTIONS,)
    assert scenarios["canonical-then-legacy"] == (
        check.CANONICAL_DISTRIBUTIONS,
        check.LEGACY_DISTRIBUTIONS,
    )
    assert scenarios["legacy-then-canonical"] == (
        check.LEGACY_DISTRIBUTIONS,
        check.CANONICAL_DISTRIBUTIONS,
    )


def test_expected_dependency_closure_is_distinct_from_requested_order() -> None:
    assert check.expected_installed_after_step("canonical-only", 0) == set(check.CANONICAL_DISTRIBUTIONS)
    assert check.expected_installed_after_step("legacy-only", 0) == set(check.ALL_DISTRIBUTIONS)
    assert check.expected_installed_after_step("canonical-then-legacy", 0) == set(check.CANONICAL_DISTRIBUTIONS)
    assert check.expected_installed_after_step("canonical-then-legacy", 1) == set(check.ALL_DISTRIBUTIONS)
    assert check.expected_installed_after_step("legacy-then-canonical", 0) == set(check.ALL_DISTRIBUTIONS)


def test_wheel_record_payload_manifest_detects_content_substitution(tmp_path: Path) -> None:
    wheel = _write_wheel(tmp_path, "ketos-sdk", members=("ketos_sdk/client.py",))
    expected = check.wheel_payload_manifest(wheel)
    installed_members = deepcopy(expected)
    for item in installed_members.values():
        item["record_size"] = str(item["size"])
    actual = {
        "ketos-sdk": {
            "dist_info_in_venv": True,
            "members": installed_members,
        }
    }

    check.compare_installed_artifacts({"ketos-sdk": expected}, actual)
    actual["ketos-sdk"]["members"]["ketos_sdk/client.py"]["sha256"] = "substituted"
    with pytest.raises(check.AcceptanceError, match="installed wheel mismatch"):
        check.compare_installed_artifacts({"ketos-sdk": expected}, actual)


def test_runtime_probe_covers_six_clis_and_four_identity_families() -> None:
    assert check.ALL_CLIS == (
        "ketos",
        "langflow",
        "kfx",
        "lfx",
        "kfx-mcp",
        "lfx-mcp",
    )
    probe = check.RUNTIME_IDENTITY_PROBE
    for token in (
        "langflow.server",
        "ketos.server",
        "lfx.custom",
        "kfx.custom",
        "langflow_sdk.client",
        "ketos_sdk",
        "langflow_stepflow.translation.translator",
        "ketos_stepflow.translation.translator",
    ):
        assert token in probe


def test_failure_evidence_contract_is_explicit_in_checker_source() -> None:
    source = CHECKER.read_text(encoding="utf-8")

    assert 'evidence["verdict"] = "FAIL"' in source
    assert 'evidence["error"] = str(exc)' in source
    assert 'evidence["commands"] = [asdict(item) for item in runner.evidence]' in source
