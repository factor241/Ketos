from __future__ import annotations

import re
from pathlib import Path

import tomllib
import yaml

ROOT = Path(__file__).resolve().parents[2]
SCOPES = (
    ROOT / ".github",
    ROOT / "docker",
    ROOT / "docker_example",
    ROOT / "deploy",
    ROOT / ".devcontainer",
)
FILES = (
    *(path for scope in SCOPES for path in scope.rglob("*") if path.is_file() and path.name != ".DS_Store"),
    ROOT / "render.yaml",
)
LEGACY_PRODUCT = "lang" + "flow"
LEGACY_EXECUTOR = "l" + "fx"
LEGACY_IDENTITY = re.compile(rf"(?i)(?<![a-z0-9])(?:{LEGACY_PRODUCT}|{LEGACY_EXECUTOR})(?![a-z0-9])")
WORKFLOW_FILES = tuple(sorted((ROOT / ".github" / "workflows").glob("*.y*ml")))
MUTATING_SHELL_PATTERNS = (
    re.compile(r"\bgit\s+push\b"),
    re.compile(
        r"\bgit\s+tag\s+"
        r"(?!(?:-l|--list|-v|--verify|--points-at|--contains|--merged|--no-merged|--sort|--format|--column)(?:[=\s]|$))"
    ),
    re.compile(r"\b(?:uv|twine|npm|pnpm)\s+publish\b"),
    re.compile(r"\bmake\s+\S*publish\b"),
    re.compile(r"\bdocker\s+push\b"),
    re.compile(r"\bdocker\s+buildx\s+imagetools\s+create\b"),
    re.compile(r"\baws\s+s3\s+(?:sync|cp|rm|mv)\b"),
    re.compile(r"\baws\s+cloudfront\s+create-invalidation\b"),
)


def _manifest(path: str) -> dict:
    return tomllib.loads((ROOT / path).read_text(encoding="utf-8"))


def test_distribution_surfaces_are_ketos_only() -> None:
    offenders: list[str] = []
    for path in FILES:
        text = path.read_text(encoding="utf-8")
        if LEGACY_IDENTITY.search(text) or LEGACY_IDENTITY.search(path.name):
            offenders.append(str(path.relative_to(ROOT)))
    assert not offenders, "legacy distribution identity remains:\n" + "\n".join(offenders)


def test_release_sdists_exclude_negative_contract_inputs() -> None:
    expected_exclusions = {
        "src/backend/base/pyproject.toml": {"/TASK7A_HANDOFF.yaml"},
        "src/kfx/pyproject.toml": {"/tests"},
    }
    failures: list[str] = []
    for path, expected in expected_exclusions.items():
        configured = set(
            _manifest(path)
            .get("tool", {})
            .get("hatch", {})
            .get("build", {})
            .get("targets", {})
            .get("sdist", {})
            .get("exclude", [])
        )
        missing = sorted(expected - configured)
        if missing:
            failures.append(f"{path}: missing {', '.join(missing)}")
    assert not failures, "sdist exclusions are incomplete:\n" + "\n".join(failures)


def test_sdist_vcs_metadata_uses_current_identity() -> None:
    for relative_path in (".gitignore", "src/backend/.gitignore"):
        gitignore = (ROOT / relative_path).read_text(encoding="utf-8")
        assert LEGACY_IDENTITY.search(gitignore) is None, relative_path


def test_packaged_runtime_has_no_upstream_owned_contact_or_telemetry_defaults() -> None:
    runtime_sources = (
        ROOT / "src/backend/base/ketos/__main__.py",
        ROOT / "src/backend/base/ketos/services/telemetry/schema.py",
    )
    forbidden = (
        "discord.com/invite/" + "EqksyE2EX9",
        "api." + "scarf.sh",
    )
    failures = [
        f"{path.relative_to(ROOT)}: {token}"
        for path in runtime_sources
        for token in forbidden
        if token in path.read_text(encoding="utf-8")
    ]
    assert not failures, "upstream-owned runtime endpoints remain:\n" + "\n".join(failures)


def test_external_release_gate_is_fail_closed_and_immutable() -> None:
    gate = ROOT / "scripts/ci/require_external_release.py"
    text = gate.read_text(encoding="utf-8")
    assert "KETOS_EXTERNAL_RELEASE" in text
    assert "GITHUB_SHA" in text
    assert "KETOS_RELEASE_COMMIT" in text
    assert "GITHUB_REF_TYPE" in text
    assert "workflow_dispatch" in text


def _workflow(path: str) -> dict:
    return yaml.safe_load((ROOT / path).read_text(encoding="utf-8"))


def _step_text(step: dict) -> str:
    return "\n".join(str(value) for value in step.values())


def _has_shell_separator(line: str) -> bool:
    return any(separator in line for separator in ("&&", "||", ";", "|"))


def _shell_mutation_lines(step: dict) -> tuple[str, ...]:
    mutations: list[str] = []
    for raw_line in str(step.get("run", "")).splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if re.match(r"^(?:echo|printf)\b", line) and not _has_shell_separator(line):
            continue
        matches = [pattern for pattern in MUTATING_SHELL_PATTERNS if pattern.search(line)]
        if (
            len(matches) == 1
            and re.match(r"^aws\s+s3\s+(?:sync|cp|rm|mv)\b", line)
            and "--dryrun" in line
            and not _has_shell_separator(line)
        ):
            continue
        if matches:
            mutations.append(line)
    return tuple(mutations)


def _action_looks_mutating(uses: str) -> bool:
    action = uses.split("@", 1)[0].casefold()
    basename = action.rstrip("/").rsplit("/", 1)[-1]
    words = set(filter(None, re.split(r"[^a-z0-9]+", basename)))
    return bool(
        words & {"deploy", "publish"}
        or basename.endswith("release")
        or basename
        in {
            "action-gh-release",
            "actions-gh-pages",
            "release-action",
            "release-drafter",
        }
    )


def _local_composite_steps(uses: str, root: Path) -> tuple[dict, ...]:
    if not uses.startswith("./"):
        return ()
    target = (root / uses).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return ()
    candidates = (target / "action.yml", target / "action.yaml") if target.is_dir() else (target,)
    definition = next((candidate for candidate in candidates if candidate.is_file()), None)
    if definition is None:
        return ()
    payload = yaml.safe_load(definition.read_text(encoding="utf-8")) or {}
    if payload.get("runs", {}).get("using") != "composite":
        return ()
    return tuple(payload.get("runs", {}).get("steps", ()))


def _step_mutations(step: dict, root: Path = ROOT, visited_actions: frozenset[str] = frozenset()) -> tuple[str, ...]:
    uses = str(step.get("uses", ""))
    mutations: list[str] = []
    if _action_looks_mutating(uses):
        mutations.append(uses)

    with_values = step.get("with", {})
    if (
        uses.startswith("docker/build-push-action@")
        and "push" in with_values
        and str(with_values["push"]).strip().casefold() not in {"0", "false", "no", "off"}
    ):
        mutations.append("docker/build-push-action@:push")

    nested_action = str(with_values.get("action", ""))
    nested_inputs = with_values.get("with", {})
    if nested_action:
        if isinstance(nested_inputs, str):
            nested_inputs = yaml.safe_load(nested_inputs) or {}
        mutations.extend(_step_mutations({"uses": nested_action, "with": nested_inputs}, root, visited_actions))

    if uses.startswith("./") and uses not in visited_actions:
        for nested_step in _local_composite_steps(uses, root):
            mutations.extend(_step_mutations(nested_step, root, visited_actions | {uses}))
    mutations.extend(_shell_mutation_lines(step))
    return tuple(mutations)


def _gate_commands(step: dict) -> tuple[tuple[int, int], ...]:
    run = str(step.get("run", ""))
    command = re.compile(
        r"(?m)(?:^|&&|\|\||;|\$\()\s*(?:uv\s+run(?:\s+python)?|python(?:3)?)\b"
        r"[^\n;|&]*require_external_release\.py(?:\"|')?"
    )
    return tuple((match.start(), match.end()) for match in command.finditer(run))


def _is_executable_gate_step(step: dict) -> bool:
    run = str(step.get("run", "")).strip()
    gates = _gate_commands({"run": run})
    return (
        len(gates) == 1
        and gates[0] == (0, len(run))
        and not step.get("if")
        and str(step.get("continue-on-error", "false")).casefold() not in {"1", "true", "yes"}
    )


def _same_step_gate_precedes_shell_mutation(step: dict) -> bool:
    run = str(step.get("run", ""))
    gates = _gate_commands(step)
    if not gates:
        return False
    mutation_indexes = [match.start() for pattern in MUTATING_SHELL_PATTERNS for match in pattern.finditer(run)]
    if not mutation_indexes:
        return False
    first_mutation = min(mutation_indexes)
    return any(end < first_mutation and run[end:first_mutation].strip() == "&&" for _, end in gates)


def _mutation_jobs() -> dict[str, tuple[str, ...]]:
    discovered: dict[str, tuple[str, ...]] = {}
    for path in WORKFLOW_FILES:
        jobs = _workflow(str(path.relative_to(ROOT))).get("jobs", {})
        mutation_jobs = tuple(
            job_name for job_name, job in jobs.items() if any(_step_mutations(step) for step in job.get("steps", []))
        )
        if mutation_jobs:
            discovered[str(path.relative_to(ROOT))] = mutation_jobs
    return discovered


def _job_if_is_sha_bound(job: dict) -> bool:
    condition = str(job.get("if", "")).strip()
    if condition.startswith("${{") and condition.endswith("}}"):
        condition = condition[3:-2].strip()
    if "||" in condition:
        return False
    actual: set[str] = set()
    for raw_fragment in condition.split("&&"):
        fragment = raw_fragment.strip()
        normalized = fragment[1:-1].strip() if fragment.startswith("(") and fragment.endswith(")") else fragment
        if normalized:
            actual.add(normalized)
    required = {
        "vars.KETOS_EXTERNAL_RELEASE_ENABLED == 'true'",
        "github.event_name == 'workflow_dispatch'",
        "github.ref_type == 'tag'",
        "vars.KETOS_RELEASE_COMMIT == github.sha",
        "vars.KETOS_EXTERNAL_RELEASE == format('publish:{0}', github.sha)",
    }
    return actual == required


def test_mutation_detector_is_fail_closed_for_dynamic_and_nested_actions(tmp_path: Path) -> None:
    expression_push = {
        "uses": "docker/build-push-action@v6",
        "with": {"push": "${{ inputs.push }}"},
    }
    wrapped_push = {
        "uses": "Wandalen/wretry.action@master",
        "with": {
            "action": "docker/build-push-action@v6",
            "with": "push: true\ncontext: .",
        },
    }
    local = tmp_path / "publish-action"
    local.mkdir()
    (local / "action.yml").write_text(
        "runs:\n  using: composite\n  steps:\n    - shell: bash\n      run: uv publish dist/*\n",
        encoding="utf-8",
    )

    assert _step_mutations(expression_push)
    assert _step_mutations(wrapped_push)
    assert _step_mutations({"uses": "peaceiris/actions-gh-pages@v4"})
    assert _step_mutations({"uses": "./publish-action"}, root=tmp_path)
    assert not _step_mutations({"uses": "docker/build-push-action@v6", "with": {"push": "false"}})


def test_shell_mutation_detector_does_not_skip_chained_commands() -> None:
    assert not _shell_mutation_lines({"run": "echo 'git push is disabled'"})
    assert not _shell_mutation_lines({"run": "aws s3 sync source target --dryrun"})
    assert _shell_mutation_lines({"run": "echo ok; git push origin main"})
    assert _shell_mutation_lines({"run": "printf ok && uv publish dist/*"})
    assert _shell_mutation_lines({"run": "aws s3 sync source target --dryrun; aws s3 rm s3://bucket/key"})
    assert _shell_mutation_lines({"run": 'git tag "$TAG"'})
    assert _shell_mutation_lines({"run": 'git tag -f "$TAG"'})
    assert _shell_mutation_lines({"run": 'git tag -u "$KEY" "$TAG"'})
    assert not _shell_mutation_lines({"run": "git tag -l 'v*'"})
    assert not _shell_mutation_lines({"run": "git tag --points-at HEAD"})


def test_gate_detector_rejects_non_executable_or_skippable_bypasses() -> None:
    executable = {"run": "uv run python scripts/ci/require_external_release.py"}
    assert _is_executable_gate_step(executable)
    assert not _is_executable_gate_step({"run": "echo require_external_release.py"})
    assert not _is_executable_gate_step({"run": "# uv run scripts/ci/require_external_release.py"})
    assert not _is_executable_gate_step(executable | {"if": "false"})
    assert not _is_executable_gate_step(executable | {"continue-on-error": "true"})
    assert not _is_executable_gate_step({"run": "uv run scripts/ci/require_external_release.py || true"})
    assert not _is_executable_gate_step({"run": "uv run scripts/ci/require_external_release.py; true"})
    assert not _is_executable_gate_step({"run": "uv run scripts/ci/require_external_release.py | tee gate.log"})
    assert _same_step_gate_precedes_shell_mutation(
        {"run": "uv run scripts/ci/require_external_release.py && uv publish dist/*"}
    )
    assert not _same_step_gate_precedes_shell_mutation({"run": "echo require_external_release.py; uv publish dist/*"})
    assert not _same_step_gate_precedes_shell_mutation(
        {"run": "uv run scripts/ci/require_external_release.py || true && uv publish dist/*"}
    )
    assert not _same_step_gate_precedes_shell_mutation(
        {"run": "uv run scripts/ci/require_external_release.py; echo ok && uv publish dist/*"}
    )


def test_job_gate_requires_the_exact_fail_closed_conjunction() -> None:
    gate = (
        "${{ vars.KETOS_EXTERNAL_RELEASE_ENABLED == 'true' "
        "&& github.event_name == 'workflow_dispatch' "
        "&& github.ref_type == 'tag' "
        "&& vars.KETOS_RELEASE_COMMIT == github.sha "
        "&& vars.KETOS_EXTERNAL_RELEASE == format('publish:{0}', github.sha) }}"
    )
    assert _job_if_is_sha_bound({"if": gate})
    assert not _job_if_is_sha_bound({"if": f"always() || ({gate})"})
    assert not _job_if_is_sha_bound({"if": gate.replace(" && github.ref_type == 'tag'", "")})


def test_dynamic_external_mutation_discovery_is_complete_and_gated() -> None:
    failures: list[str] = []
    mutable_refs = ("${{ inputs.ref }}", "${{ inputs.branch }}", "${{ github.head_ref }}")
    for workflow_path, job_names in _mutation_jobs().items():
        jobs = _workflow(workflow_path)["jobs"]
        for job_name in job_names:
            job = jobs[job_name]
            steps = job.get("steps", [])
            mutation_indexes = [index for index, step in enumerate(steps) if _step_mutations(step)]
            first_mutation = min(mutation_indexes)
            checkout_indexes = [
                index for index, step in enumerate(steps) if str(step.get("uses", "")).startswith("actions/checkout@")
            ]
            if not checkout_indexes or checkout_indexes[0] >= first_mutation:
                failures.append(f"{workflow_path}:{job_name}: checkout missing before mutation")
            elif steps[checkout_indexes[0]].get("with", {}).get("ref") != "${{ github.sha }}":
                failures.append(f"{workflow_path}:{job_name}: checkout is not github.sha")

            job_text = _step_text(job)
            failures.extend(
                f"{workflow_path}:{job_name}: mutable ref {mutable_ref}"
                for mutable_ref in mutable_refs
                if mutable_ref in job_text
            )

            job_gate = _job_if_is_sha_bound(job)
            for index in mutation_indexes:
                step = steps[index]
                preceding_gates = [steps[index - 1]] if index and _is_executable_gate_step(steps[index - 1]) else []
                same_step_gate = _same_step_gate_precedes_shell_mutation(step)
                gate_steps = preceding_gates or ([step] if same_step_gate else [])
                if not job_gate and not gate_steps:
                    failures.append(f"{workflow_path}:{job_name}:{step.get('name', index)}: mutation gate missing")
                    continue
                for gate_step in gate_steps:
                    env = gate_step.get("env", {})
                    if env.get("KETOS_RELEASE_COMMIT") != "${{ vars.KETOS_RELEASE_COMMIT }}":
                        failures.append(f"{workflow_path}:{job_name}: approved SHA not passed")
                    if env.get("KETOS_EXTERNAL_RELEASE") != "${{ vars.KETOS_EXTERNAL_RELEASE }}":
                        failures.append(f"{workflow_path}:{job_name}: approval token not passed")

    assert not failures, "discovered external mutations are not fail-closed:\n" + "\n".join(failures)


def test_every_external_publish_job_checks_out_the_approved_sha() -> None:
    failures: list[str] = []
    for workflow_path, job_names in _mutation_jobs().items():
        jobs = _workflow(workflow_path)["jobs"]
        for job_name in job_names:
            steps = jobs[job_name].get("steps", [])
            checkout_indexes = [
                index for index, step in enumerate(steps) if str(step.get("uses", "")).startswith("actions/checkout@")
            ]
            gate_indexes = [
                index
                for index, step in enumerate(steps)
                if _is_executable_gate_step(step) or _same_step_gate_precedes_shell_mutation(step)
            ]
            if not checkout_indexes or (not gate_indexes and not _job_if_is_sha_bound(jobs[job_name])):
                failures.append(f"{workflow_path}:{job_name}: checkout/gate missing")
                continue
            checkout = steps[checkout_indexes[0]]
            if checkout.get("with", {}).get("ref") != "${{ github.sha }}":
                failures.append(f"{workflow_path}:{job_name}: checkout is not github.sha")
            if gate_indexes and checkout_indexes[0] > gate_indexes[0]:
                failures.append(f"{workflow_path}:{job_name}: gate runs before checkout")
    assert not failures, "external publish jobs are not immutable:\n" + "\n".join(failures)


def test_external_publish_jobs_do_not_consume_mutable_refs() -> None:
    failures: list[str] = []
    for workflow_path, job_names in _mutation_jobs().items():
        jobs = _workflow(workflow_path)["jobs"]
        for job_name in job_names:
            job_text = _step_text(jobs[job_name])
            failures.extend(
                f"{workflow_path}:{job_name}:{mutable_ref}"
                for mutable_ref in ("${{ inputs.ref }}", "${{ inputs.branch }}")
                if mutable_ref in job_text
            )
    assert not failures, "external publish jobs consume mutable refs:\n" + "\n".join(failures)


def test_release_gate_receives_sha_bound_repository_approval() -> None:
    failures: list[str] = []
    for workflow_path, job_names in _mutation_jobs().items():
        jobs = _workflow(workflow_path)["jobs"]
        for job_name in job_names:
            for step in jobs[job_name].get("steps", []):
                if not _is_executable_gate_step(step):
                    continue
                env = step.get("env", {})
                if env.get("KETOS_RELEASE_COMMIT") != "${{ vars.KETOS_RELEASE_COMMIT }}":
                    failures.append(f"{workflow_path}:{job_name}: approved SHA not passed")
                if env.get("KETOS_EXTERNAL_RELEASE") != "${{ vars.KETOS_EXTERNAL_RELEASE }}":
                    failures.append(f"{workflow_path}:{job_name}: approval token not passed")
    assert not failures, "release gate environment is incomplete:\n" + "\n".join(failures)


def test_release_workflow_callers_use_only_the_approved_sha() -> None:
    for workflow_path in (
        ".github/workflows/release_bundles.yml",
        ".github/workflows/release_nightly.yml",
    ):
        text = (ROOT / workflow_path).read_text(encoding="utf-8")
        assert "ref: ${{ inputs.release_tag" not in text
        assert "ref: ${{ inputs.nightly_tag" not in text


def test_nightly_tag_is_created_at_the_approved_sha() -> None:
    workflow = (ROOT / ".github/workflows/nightly_build.yml").read_text(encoding="utf-8")
    assert 'git tag -a "$RELEASE_TAG" "$GITHUB_SHA"' in workflow


def test_nightly_release_does_not_create_an_unapproved_version_commit() -> None:
    jobs = _workflow(".github/workflows/nightly_build.yml")["jobs"]
    steps = jobs["create-nightly-tag"].get("steps", [])
    job_text = "\n".join(_step_text(step) for step in steps)
    assert "git commit" not in job_text
    assert "update_pyproject_combined.py" not in job_text
    assert "update_kfx_version.py" not in job_text
    assert "update_sdk_version.py" not in job_text


def test_stable_release_tag_must_resolve_to_the_workflow_sha() -> None:
    workflow = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
    assert 'git rev-parse "${{ inputs.release_tag }}^{commit}"' in workflow
    assert 'if [ "$release_sha" != "$GITHUB_SHA" ]' in workflow


def test_manifest_publication_is_disabled_when_architecture_pushes_are_disabled() -> None:
    for workflow_path in (
        ".github/workflows/docker-build-v2.yml",
        ".github/workflows/docker-nightly-build.yml",
    ):
        workflow = (ROOT / workflow_path).read_text(encoding="utf-8")
        assert "docker buildx imagetools create" not in workflow
        assert "push: true" not in workflow
        assert "push: ${{" not in workflow


def test_observability_identity_is_atomic() -> None:
    dashboard = ROOT / "deploy/observability/grafana-loki/grafana/dashboards/ketos-production-logs.json"
    text = dashboard.read_text(encoding="utf-8")
    assert '"uid": "ketos-production-logs"' in text
    assert '"title": "Ketos Production Logs"' in text
    assert '"ketos"' in text
    assert 'job=\\"ketos\\"' in text


def test_distribution_readmes_match_local_image_pull_contracts() -> None:
    deploy_compose = _workflow("deploy/docker-compose.yml")["services"]
    deploy_readme = (ROOT / "deploy/README.md").read_text(encoding="utf-8")
    assert deploy_compose["backend"]["image"] == "${KETOS_BACKEND_IMAGE:-ketos/backend:local}"
    assert deploy_compose["frontend"]["image"] == "${KETOS_FRONTEND_IMAGE:-ketos/frontend:local}"
    assert deploy_compose["backend"]["pull_policy"] == "never"
    assert deploy_compose["frontend"]["pull_policy"] == "never"
    assert "`ketos/backend:local`" in deploy_readme
    assert "`ketos/frontend:local`" in deploy_readme
    assert "`pull_policy: never`" in deploy_readme
    assert "must already exist locally" in re.sub(r"\s+", " ", deploy_readme)
    assert "third-party service images" in deploy_readme

    example_services = [
        _workflow(path)["services"]["ketos"]
        for path in (
            "docker_example/docker-compose.yml",
            "docker_example/pre.docker-compose.yml",
        )
    ]
    example_readme = (ROOT / "docker_example/README.md").read_text(encoding="utf-8")
    for example_service in example_services:
        assert example_service["image"] == "${KETOS_IMAGE:-ketos/ketos:local}"
        assert example_service["pull_policy"] == "never"
    assert "`ketos/ketos:local`" in example_readme
    assert "`pull_policy: never`" in example_readme
    assert "must already exist locally" in re.sub(r"\s+", " ", example_readme)
    assert "third-party image" in example_readme


def test_observability_readme_local_links_resolve() -> None:
    readme = ROOT / "deploy/observability/grafana-loki/README.md"
    text = readme.read_text(encoding="utf-8")
    links = re.findall(r"(?<!!)\[[^]]+\]\(([^)]+)\)", text)
    anchors = {
        re.sub(r"[^a-z0-9 -]", "", heading.lower()).replace(" ", "-")
        for heading in re.findall(r"^#{1,6}\s+(.+)$", text, flags=re.MULTILINE)
    }
    missing = [
        target
        for target in links
        if (
            (target.startswith("#") and target.removeprefix("#") not in anchors)
            or (
                not target.startswith(("http://", "https://", "#"))
                and not (readme.parent / target.split("#", 1)[0]).resolve().exists()
            )
        )
    ]
    assert not missing, "broken local README links:\n" + "\n".join(missing)
