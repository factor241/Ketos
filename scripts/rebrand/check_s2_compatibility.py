"""Validate the Stage 2 canonical and compatibility wheel set.

The checker never publishes artifacts and creates its virtual environments only
inside a disposable work directory.  Commands are deliberately sequential so
that the acceptance run stays within the rebrand RAM budget.
"""

# ruff: noqa: D202, EM101, EM102, TC003, TRY003

from __future__ import annotations

import argparse
import base64
import configparser
import csv
import hashlib
import json
import os
import platform
import resource
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import zipfile
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from email.parser import Parser
from pathlib import Path
from typing import Any


class AcceptanceError(RuntimeError):
    """Raised when an S2 artifact or runtime contract is not satisfied."""


CANONICAL_DISTRIBUTIONS = (
    "ketos-base",
    "ketos",
    "kfx",
    "ketos-sdk",
    "ketos-stepflow",
)
LEGACY_DISTRIBUTIONS = (
    "langflow-base",
    "langflow",
    "lfx",
    "langflow-sdk",
    "langflow-stepflow",
)
ALL_DISTRIBUTIONS = CANONICAL_DISTRIBUTIONS + LEGACY_DISTRIBUTIONS
OWNERSHIP_PAIRS = tuple(zip(CANONICAL_DISTRIBUTIONS, LEGACY_DISTRIBUTIONS, strict=True))
ALL_CLIS = ("ketos", "langflow", "kfx", "lfx", "kfx-mcp", "lfx-mcp")
CANONICAL_CLIS = ("ketos", "kfx", "kfx-mcp")

EXPECTED_PYTEST_FAMILIES = {
    "executor": (("kfx", "kfx", "kfx.testing"),),
    "sdk": (("ketos-sdk", "ketos", "ketos_sdk.testing"),),
}
RECORD_FIELD_COUNT = 3

RUNTIME_IDENTITY_PROBE = r"""
import importlib
import json
from pathlib import Path
import sys

legacy_backend = importlib.import_module("langflow.server")
canonical_backend = importlib.import_module("ketos.server")
legacy_executor = importlib.import_module("lfx.custom")
canonical_executor = importlib.import_module("kfx.custom")
legacy_sdk = importlib.import_module("langflow_sdk.client")
canonical_sdk = importlib.import_module("ketos_sdk")
legacy_stepflow = importlib.import_module("langflow_stepflow.translation.translator")
canonical_stepflow = importlib.import_module("ketos_stepflow.translation.translator")

checks = {
    "backend_module": legacy_backend is canonical_backend,
    "backend_application": (
        legacy_backend.LangflowApplication is canonical_backend.KetosApplication
    ),
    "executor_module": legacy_executor is canonical_executor,
    "executor_component": legacy_executor.Component is canonical_executor.Component,
    "sdk_client": legacy_sdk.Client is canonical_sdk.KetosClient,
    "sdk_langflow_client": legacy_sdk.LangflowClient is canonical_sdk.KetosClient,
    "stepflow_module": legacy_stepflow is canonical_stepflow,
    "stepflow_converter": (
        legacy_stepflow.LangflowConverter is canonical_stepflow.KetosConverter
    ),
}
venv_root = Path(sys.prefix).resolve()
origins = {
    "backend": str(Path(canonical_backend.__file__).resolve()),
    "executor": str(Path(canonical_executor.__file__).resolve()),
    "sdk": str(Path(canonical_sdk.__file__).resolve()),
    "stepflow": str(Path(canonical_stepflow.__file__).resolve()),
}
checks["wheel_origins"] = all(Path(origin).is_relative_to(venv_root) for origin in origins.values())
print(json.dumps(checks, sort_keys=True))
if not all(checks.values()):
    raise SystemExit(1)
"""

CANONICAL_RUNTIME_PROBE = r"""
import importlib
import json
from pathlib import Path
import sys

modules = (
    "ketos.server",
    "kfx.custom",
    "ketos_sdk.client",
    "ketos_stepflow.translation.translator",
)
loaded = {name: importlib.import_module(name) for name in modules}
venv_root = Path(sys.prefix).resolve()
results = {
    name: {
        "module": module.__name__,
        "from_wheel_venv": Path(module.__file__).resolve().is_relative_to(venv_root),
    }
    for name, module in loaded.items()
}
print(json.dumps(results, sort_keys=True))
if not all(item["from_wheel_venv"] for item in results.values()):
    raise SystemExit(1)
"""


@dataclass(frozen=True)
class CommandEvidence:
    command: list[str]
    exit_code: int
    duration_seconds: float
    peak_used_ram_gib: float | None
    stdout_tail: str
    stderr_tail: str


def _wheel_distribution(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            metadata_names = [name for name in archive.namelist() if name.endswith(".dist-info/METADATA")]
            if len(metadata_names) != 1:
                raise AcceptanceError(f"wheel {path.name} has {len(metadata_names)} METADATA files")
            metadata = Parser().parsestr(archive.read(metadata_names[0]).decode("utf-8"))
    except (OSError, UnicodeDecodeError, zipfile.BadZipFile) as exc:
        raise AcceptanceError(f"cannot inspect wheel {path}: {exc}") from exc
    name = metadata.get("Name")
    if not name:
        raise AcceptanceError(f"wheel {path.name} has no distribution Name")
    return name.lower().replace("_", "-")


def discover_wheels(wheel_dir: Path) -> dict[str, Path]:
    """Return exactly one wheel for every required S2 distribution."""

    if not wheel_dir.is_dir():
        raise AcceptanceError(f"wheel directory does not exist: {wheel_dir}")
    found: dict[str, list[Path]] = {name: [] for name in ALL_DISTRIBUTIONS}
    for path in sorted(wheel_dir.glob("*.whl")):
        distribution = _wheel_distribution(path)
        if distribution in found:
            found[distribution].append(path.resolve())
    missing = [name for name, paths in found.items() if not paths]
    duplicate = {name: [path.name for path in paths] for name, paths in found.items() if len(paths) > 1}
    if missing:
        raise AcceptanceError(f"missing wheel(s): {', '.join(missing)}")
    if duplicate:
        raise AcceptanceError(f"duplicate wheel(s): {json.dumps(duplicate, sort_keys=True)}")
    return {name: found[name][0] for name in ALL_DISTRIBUTIONS}


def _owned_members(path: Path) -> set[str]:
    with zipfile.ZipFile(path) as archive:
        return {
            name
            for name in archive.namelist()
            if name and not name.endswith("/") and not name.split("/", 1)[0].endswith(".dist-info")
        }


def wheel_payload_manifest(path: Path) -> dict[str, dict[str, str | int]]:
    """Validate a wheel RECORD and return the immutable payload manifest."""
    with zipfile.ZipFile(path) as archive:
        archive_names = {name for name in archive.namelist() if name and not name.endswith("/")}
        record_names = [name for name in archive_names if name.endswith(".dist-info/RECORD")]
        if len(record_names) != 1:
            raise AcceptanceError(f"wheel {path.name} has {len(record_names)} RECORD files")
        record_name = record_names[0]
        rows = list(csv.reader(archive.read(record_name).decode("utf-8").splitlines()))
        record = {row[0]: row[1:] for row in rows if len(row) == RECORD_FIELD_COUNT}
        if set(record) != archive_names:
            raise AcceptanceError(f"wheel {path.name} RECORD paths do not match archive members")
        if record[record_name] != ["", ""]:
            raise AcceptanceError(f"wheel {path.name} RECORD self-entry must be unhashed")

        manifest: dict[str, dict[str, str | int]] = {}
        for member in sorted(archive_names - {record_name}):
            content = archive.read(member)
            digest = hashlib.sha256(content).digest()
            encoded = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
            record_hash, record_size = record[member]
            if record_hash != f"sha256={encoded}" or record_size != str(len(content)):
                raise AcceptanceError(f"wheel {path.name} RECORD mismatch for {member}")
            manifest[member] = {
                "sha256": hashlib.sha256(content).hexdigest(),
                "record_hash": record_hash,
                "size": len(content),
            }
    return manifest


def find_pair_overlaps(wheels: dict[str, Path]) -> dict[str, list[str]]:
    """Find non-metadata files owned by both members of an ownership pair."""

    overlaps: dict[str, list[str]] = {}
    for canonical, legacy in OWNERSHIP_PAIRS:
        common = sorted(_owned_members(wheels[canonical]) & _owned_members(wheels[legacy]))
        if common:
            overlaps[f"{canonical}:{legacy}"] = common
    return overlaps


def _pytest_entry_points(path: Path) -> list[tuple[str, str]]:
    with zipfile.ZipFile(path) as archive:
        entry_names = [name for name in archive.namelist() if name.endswith(".dist-info/entry_points.txt")]
        if len(entry_names) > 1:
            raise AcceptanceError(f"wheel {path.name} has multiple entry_points.txt files")
        if not entry_names:
            return []
        parser = configparser.ConfigParser(interpolation=None)
        parser.optionxform = str
        parser.read_string(archive.read(entry_names[0]).decode("utf-8"))
    if not parser.has_section("pytest11"):
        return []
    return [(name, value.strip()) for name, value in parser.items("pytest11")]


def validate_pytest_entry_points(wheels: dict[str, Path]) -> dict[str, list[tuple[str, str, str]]]:
    """Require one canonical implementation for each pytest compatibility family."""

    actual_entries = {distribution: _pytest_entry_points(path) for distribution, path in wheels.items()}
    actual_flat = {
        (distribution, name, target) for distribution, entries in actual_entries.items() for name, target in entries
    }
    expected_flat = {entry for entries in EXPECTED_PYTEST_FAMILIES.values() for entry in entries}
    if actual_flat != expected_flat:
        raise AcceptanceError(
            f"pytest11 ownership mismatch: expected={sorted(expected_flat)!r}, actual={sorted(actual_flat)!r}"
        )
    return {family: [tuple(entry) for entry in entries] for family, entries in EXPECTED_PYTEST_FAMILIES.items()}


def install_scenarios() -> dict[str, tuple[tuple[str, ...], ...]]:
    """Return sequential install groups for the four required clean environments.

    These are requested direct-wheel groups, not the resolved dependency closure.
    """

    return {
        "canonical-only": (CANONICAL_DISTRIBUTIONS,),
        "legacy-only": (LEGACY_DISTRIBUTIONS,),
        "canonical-then-legacy": (CANONICAL_DISTRIBUTIONS, LEGACY_DISTRIBUTIONS),
        "legacy-then-canonical": (LEGACY_DISTRIBUTIONS, CANONICAL_DISTRIBUTIONS),
    }


def expected_installed_after_step(scenario: str, step_index: int) -> set[str]:
    """Return the required tested-wheel closure after one requested install step."""
    if scenario == "canonical-only":
        return set(CANONICAL_DISTRIBUTIONS)
    if scenario in {"legacy-only", "legacy-then-canonical"}:
        return set(ALL_DISTRIBUTIONS)
    if scenario == "canonical-then-legacy":
        return set(CANONICAL_DISTRIBUTIONS if step_index == 0 else ALL_DISTRIBUTIONS)
    raise AcceptanceError(f"unknown install scenario: {scenario}")


INSTALLED_ARTIFACT_PROBE = r"""
import csv
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys

spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
prefix = Path(sys.prefix).resolve()
result = {}
for name, expected_members in spec.items():
    distribution = importlib.metadata.distribution(name)
    dist_info = Path(distribution._path).resolve()
    record_rows = list(csv.reader((dist_info / "RECORD").read_text(encoding="utf-8").splitlines()))
    record = {row[0]: row[1:] for row in record_rows if len(row) == 3}
    members = {}
    for member in expected_members:
        installed = Path(distribution.locate_file(member)).resolve()
        content = installed.read_bytes()
        record_hash, record_size = record.get(member, (None, None))
        members[member] = {
            "sha256": hashlib.sha256(content).hexdigest(),
            "record_hash": record_hash,
            "size": len(content),
            "record_size": record_size,
        }
    result[name] = {
        "dist_info_in_venv": dist_info.is_relative_to(prefix),
        "members": members,
    }
print(json.dumps(result, sort_keys=True))
"""


def compare_installed_artifacts(
    expected: dict[str, dict[str, dict[str, str | int]]],
    actual: dict[str, Any],
) -> None:
    """Prove installed files and installed RECORD rows match supplied wheels."""
    if set(actual) != set(expected):
        raise AcceptanceError(
            f"installed wheel mismatch: expected distributions {sorted(expected)}, got {sorted(actual)}"
        )
    for distribution, expected_members in expected.items():
        installed = actual[distribution]
        if installed.get("dist_info_in_venv") is not True:
            raise AcceptanceError(f"installed wheel mismatch: {distribution} dist-info is outside venv")
        actual_members = installed.get("members", {})
        if set(actual_members) != set(expected_members):
            raise AcceptanceError(f"installed wheel mismatch: {distribution} member set")
        for member, expected_item in expected_members.items():
            actual_item = actual_members[member]
            expected_record_size = str(expected_item["size"])
            if (
                actual_item.get("sha256") != expected_item["sha256"]
                or actual_item.get("record_hash") != expected_item["record_hash"]
                or actual_item.get("size") != expected_item["size"]
                or actual_item.get("record_size") != expected_record_size
            ):
                raise AcceptanceError(f"installed wheel mismatch: {distribution}:{member}")


def _used_ram_gib() -> float | None:
    try:
        import psutil

        return psutil.virtual_memory().used / (1024**3)
    except (ImportError, OSError):
        pass
    if sys.platform.startswith("linux"):
        try:
            values = {}
            for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
                key, value = line.split(":", 1)
                values[key] = int(value.strip().split()[0])
            return (values["MemTotal"] - values["MemAvailable"]) / (1024**2)
        except (KeyError, OSError, ValueError):
            return None
    return None


def _child_peak_gib() -> float:
    peak = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    divisor = 1024**3 if sys.platform == "darwin" else 1024**2
    return peak / divisor


class SequentialRunner:
    """Run commands one at a time with admission and emergency RAM limits."""

    def __init__(self, *, admission_gib: float = 14.5, kill_gib: float = 15.5) -> None:
        self.admission_gib = admission_gib
        self.kill_gib = kill_gib
        self.evidence: list[CommandEvidence] = []

    def run(
        self,
        command: Sequence[str],
        *,
        cwd: Path,
        env: dict[str, str] | None = None,
        timeout_seconds: int = 900,
    ) -> subprocess.CompletedProcess[str]:
        used = _used_ram_gib()
        if used is not None and used > self.admission_gib:
            raise AcceptanceError(f"RAM admission denied: {used:.2f} GiB used > {self.admission_gib:.2f} GiB")
        started = time.monotonic()
        peak_used = used
        with (
            tempfile.TemporaryFile(mode="w+", encoding="utf-8") as stdout_file,
            tempfile.TemporaryFile(mode="w+", encoding="utf-8") as stderr_file,
        ):
            process = subprocess.Popen(  # noqa: S603
                list(command),
                cwd=cwd,
                env=env,
                text=True,
                stdout=stdout_file,
                stderr=stderr_file,
                start_new_session=True,
            )
            killed_for_ram = False
            while process.poll() is None:
                if time.monotonic() - started > timeout_seconds:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=10)
                    raise AcceptanceError(f"command timed out after {timeout_seconds}s: {list(command)!r}")
                current = _used_ram_gib()
                if current is not None:
                    peak_used = max(peak_used or current, current)
                    if current >= self.kill_gib:
                        killed_for_ram = True
                        os.killpg(process.pid, signal.SIGTERM)
                        try:
                            process.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            os.killpg(process.pid, signal.SIGKILL)
                            process.wait()
                        break
                time.sleep(0.25)
            exit_code = process.wait()
            stdout_file.seek(0)
            stderr_file.seek(0)
            stdout = stdout_file.read()
            stderr = stderr_file.read()
        duration = time.monotonic() - started
        peak = max(peak_used or 0.0, _child_peak_gib()) or None
        self.evidence.append(
            CommandEvidence(
                command=list(command),
                exit_code=exit_code,
                duration_seconds=round(duration, 3),
                peak_used_ram_gib=round(peak, 3) if peak is not None else None,
                stdout_tail=stdout[-4000:],
                stderr_tail=stderr[-4000:],
            )
        )
        if killed_for_ram:
            raise AcceptanceError(f"command process group terminated at RAM emergency limit {self.kill_gib:.2f} GiB")
        if exit_code:
            raise AcceptanceError(
                f"command failed ({exit_code}): {list(command)!r}\nstdout:\n{stdout[-2000:]}\nstderr:\n{stderr[-2000:]}"
            )
        return subprocess.CompletedProcess(list(command), exit_code, stdout, stderr)


def _venv_python(venv: Path) -> Path:
    return venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def _venv_cli(venv: Path, name: str) -> Path:
    suffix = ".exe" if os.name == "nt" else ""
    return venv / ("Scripts" if os.name == "nt" else "bin") / f"{name}{suffix}"


def _dependency_site_path() -> Path:
    import site

    candidates = [Path(path) for path in site.getsitepackages() if "site-packages" in path]
    if not candidates:
        raise AcceptanceError("cannot locate the current dependency site-packages")
    return candidates[0].resolve()


def _attach_dependency_site(venv: Path, dependency_site: Path) -> None:
    python = _venv_python(venv)
    version = f"python{sys.version_info.major}.{sys.version_info.minor}"
    site_packages = venv / "Lib" / "site-packages" if os.name == "nt" else venv / "lib" / version / "site-packages"
    if not python.exists() or not site_packages.is_dir():
        raise AcceptanceError(f"virtual environment layout is incomplete: {venv}")
    (site_packages / "_ketos_s2_dependencies.pth").write_text(f"{dependency_site}\n", encoding="utf-8")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _prove_installed_artifacts(
    python: Path,
    *,
    expected_names: set[str],
    manifests: dict[str, dict[str, dict[str, str | int]]],
    scenario: str,
    step_index: int,
    work_dir: Path,
    runner: SequentialRunner,
) -> dict[str, Any]:
    expected = {name: manifests[name] for name in sorted(expected_names)}
    spec_path = work_dir / f"{scenario}-step-{step_index + 1}-expected-payload.json"
    spec_path.write_text(json.dumps(expected, sort_keys=True), encoding="utf-8")
    completed = runner.run(
        [str(python), "-c", INSTALLED_ARTIFACT_PROBE, str(spec_path)],
        cwd=work_dir,
        timeout_seconds=240,
    )
    actual = json.loads(completed.stdout.splitlines()[-1])
    compare_installed_artifacts(expected, actual)
    return {
        name: {
            "dist_info_in_venv": actual[name]["dist_info_in_venv"],
            "verified_payload_members": len(expected[name]),
        }
        for name in sorted(expected)
    }


def run_runtime_matrix(
    wheels: dict[str, Path],
    *,
    manifests: dict[str, dict[str, dict[str, str | int]]],
    work_dir: Path,
    runner: SequentialRunner,
    dependency_site: Path | None,
) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for scenario, groups in install_scenarios().items():
        venv = work_dir / scenario
        runner.run(
            ["uv", "venv", "--clear", "--python", sys.executable, str(venv)],
            cwd=work_dir,
        )
        if dependency_site is not None:
            _attach_dependency_site(venv, dependency_site)
        python = _venv_python(venv)
        non_clean_dependency_seed: list[str] = []
        if dependency_site is not None and groups[0] == LEGACY_DISTRIBUTIONS:
            seed_command = [
                "uv",
                "pip",
                "install",
                "--python",
                str(python),
                "--find-links",
                str(next(iter(wheels.values())).parent),
                "--no-deps",
                *(str(wheels[name]) for name in CANONICAL_DISTRIBUTIONS),
            ]
            runner.run(seed_command, cwd=work_dir)
            non_clean_dependency_seed = list(CANONICAL_DISTRIBUTIONS)

        step_results = []
        for step_index, group in enumerate(groups):
            command = [
                "uv",
                "pip",
                "install",
                "--python",
                str(python),
                "--find-links",
                str(next(iter(wheels.values())).parent),
            ]
            if dependency_site is not None:
                command.append("--no-deps")
            command.extend(str(wheels[name]) for name in group)
            runner.run(command, cwd=work_dir)
            expected_closure = expected_installed_after_step(scenario, step_index)
            artifact_proof = _prove_installed_artifacts(
                python,
                expected_names=expected_closure,
                manifests=manifests,
                scenario=scenario,
                step_index=step_index,
                work_dir=work_dir,
                runner=runner,
            )
            step_results.append(
                {
                    "requested_direct_wheels": list(group),
                    "required_resolved_tested_wheel_closure": sorted(expected_closure),
                    "artifact_record_proof": artifact_proof,
                }
            )

        expected_clis = CANONICAL_CLIS if scenario == "canonical-only" else ALL_CLIS
        for cli in expected_clis:
            executable = _venv_cli(venv, cli)
            if not executable.is_file():
                raise AcceptanceError(f"{scenario}: missing CLI {cli}")
            runner.run([str(executable), "--help"], cwd=work_dir, timeout_seconds=240)

        probe = CANONICAL_RUNTIME_PROBE if scenario == "canonical-only" else RUNTIME_IDENTITY_PROBE
        completed = runner.run([str(python), "-c", probe], cwd=work_dir, timeout_seconds=240)
        results[scenario] = {
            "requested_install_steps": step_results,
            "non_clean_dependency_seed": non_clean_dependency_seed,
            "clis": list(expected_clis),
            "probe": json.loads(completed.stdout.splitlines()[-1]),
        }
    return results


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel-dir", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--evidence", type=Path)
    parser.add_argument(
        "--dependency-mode",
        choices=("resolve", "reuse-current"),
        default="resolve",
        help="resolve in clean venvs, or reuse only current third-party dependencies for low-RAM local proof",
    )
    parser.add_argument("--inventory-only", action="store_true")
    parser.add_argument("--keep-work-dir", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    started = time.time()
    wheels = discover_wheels(args.wheel_dir.resolve())
    manifests = {name: wheel_payload_manifest(path) for name, path in wheels.items()}
    overlaps = find_pair_overlaps(wheels)
    if overlaps:
        raise AcceptanceError(f"wheel ownership overlap: {json.dumps(overlaps, sort_keys=True)}")
    pytest_owners = validate_pytest_entry_points(wheels)
    evidence: dict[str, Any] = {
        "schema_version": 1,
        "verdict": "PASS",
        "started_at_unix": started,
        "platform": platform.platform(),
        "python": sys.version,
        "dependency_mode": args.dependency_mode,
        "wheels": {
            name: {
                "path": str(path),
                "sha256": _sha256(path),
                "record_verified_payload_members": len(manifests[name]),
            }
            for name, path in wheels.items()
        },
        "ownership_overlaps": overlaps,
        "pytest_owners": pytest_owners,
    }
    runner = SequentialRunner()
    created_work_dir = args.work_dir is None
    work_dir = args.work_dir.resolve() if args.work_dir else Path(tempfile.mkdtemp(prefix="ketos-s2-"))
    work_dir.mkdir(parents=True, exist_ok=True)
    failure: AcceptanceError | None = None
    try:
        try:
            if not args.inventory_only:
                dependency_site = _dependency_site_path() if args.dependency_mode == "reuse-current" else None
                evidence["runtime"] = run_runtime_matrix(
                    wheels,
                    manifests=manifests,
                    work_dir=work_dir,
                    runner=runner,
                    dependency_site=dependency_site,
                )
        except AcceptanceError as exc:
            failure = exc
            evidence["verdict"] = "FAIL"
            evidence["error"] = str(exc)
        evidence["commands"] = [asdict(item) for item in runner.evidence]
        evidence["duration_seconds"] = round(time.time() - started, 3)
        encoded = json.dumps(evidence, indent=2, sort_keys=True) + "\n"
        if args.evidence:
            args.evidence.parent.mkdir(parents=True, exist_ok=True)
            args.evidence.write_text(encoded, encoding="utf-8")
        print(encoded, end="")
        if failure is not None:
            raise failure
    finally:
        if created_work_dir and not args.keep_work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AcceptanceError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
