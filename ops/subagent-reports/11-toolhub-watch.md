# Agent 11 — RaytSystem Tool Hub / WATCH qualification

Date: 2026-07-17  
Outcome: `DONE_WITH_CONCERNS`  
Canonical skill status: `test_status: pending`

## Executive result

The missing WATCH references were restored in both the Ketos skill projection and the nested
RaytSystem canonical skill. Required Homebrew media packages are installed and the real local
binary pipeline was exercised on a synthetic English/Russian video.

The mandatory eight-tool operational matrix is:

- `PASS`: 6
- `BLOCKED`: 2
- `FAIL`: 0

The skill remains `pending`, because the stock CLI does not provide the production capabilities
required for a truthful full PASS:

1. `default_cli_local_executor_unavailable`
2. `destination_bound_download_executor_unavailable`
3. `host_visual_analysis_required`

No commit or push was created.

## Scope and safety

- Read the repository `AGENTS.md`, project `skills/raytsystem-watch/SKILL.md`, nested canonical
  `raytsystem/skills/raytsystem-watch/SKILL.md`, Tool Hub docs, contracts, registry, runner,
  dispatcher, pipeline, CLI, and existing tests.
- Treated transcript, OCR, pixels, filenames, and metadata as untrusted evidence.
- Used no cookies, browser sessions, credentials, tokens, DRM bypass, or authenticated source.
- Performed no remote media download. `video.download` was invoked only far enough to prove the
  destination-bound executor block; no network attempt occurred.
- Did not modify Claude/MCP configuration, `AGENTS.md`, `CLAUDE.md`, runtime adapters, canonical
  knowledge, ledgers, or generated graph artifacts.
- Preserved unrelated dirty state in both the outer repository and nested RaytSystem checkout.

## Dependency qualification

Homebrew action:

```text
brew install ffmpeg yt-dlp tesseract-lang
```

`tesseract` was already installed and was not reinstalled.

Qualified inventory:

| Dependency | Result |
|---|---|
| `ffmpeg` | PASS — Homebrew `8.1.2_1`; binary reports `8.1.2` |
| `ffprobe` | PASS — supplied by `ffmpeg`; binary reports `8.1.2` |
| `yt-dlp` | PASS — Homebrew `2026.7.4`; binary reports `2026.07.04` |
| `tesseract` | PASS — existing `5.5.2` |
| `tesseract-lang` | PASS — Homebrew `4.1.0` |
| OCR language `eng` | PASS |
| OCR language `rus` | PASS |

The Tool Hub registry reports exactly `8` contracts, contract version `1.2.0`, and the exact
allowlisted dependency set `ffmpeg`, `ffprobe`, `tesseract`, `yt-dlp`.

## TDD evidence

RED:

```text
node --test scripts/raytsystem-watch-readiness.test.mjs
tests 3, pass 0, fail 3
```

All three failures were the intended missing-reference failures:

- `skills/raytsystem-watch/references/tool-contracts.md`
- `skills/raytsystem-watch/references/compatibility-report.md`

GREEN after the minimal reference/skill implementation:

```text
node --test scripts/raytsystem-watch-readiness.test.mjs
tests 3, pass 3, fail 0
```

The readiness test now checks:

- both project and nested canonical reference sets are `5/5`;
- all eight exact `video.*` tool IDs are documented;
- contract version, `cli_dependencies`, destination-bound networking, and no-generic-shell
  requirements are documented;
- the compatibility reports retain `qualification_status: pending` and the exact blockers.

## Real synthetic media qualification

The host-gated test created a three-second H.264/AAC MP4 with:

- English screen text `HELLO KETOS`;
- Russian screen text `ПРИВЕТ КЕТОС`;
- a timestamped VTT sidecar;
- a deterministic audio tone.

Real pinned Homebrew binaries were executed under a diagnostic macOS sandbox that denied network
and confined writes to the temporary Tool Hub staging root.

| Tool | Status | Evidence |
|---|---|---|
| `video.probe` | PASS | `completed`; `3.000000` seconds; video + audio streams |
| `video.download` | BLOCKED | `destination_bound_download_executor_unavailable`; zero network access |
| `video.transcript` | PASS | `completed`; `sidecar`; one timestamped segment |
| `video.extract_audio` | PASS | `completed`; retained PCM WAV |
| `video.extract_frames` | PASS | `completed`; `2/2` retained JPEG frames |
| `video.ocr_frames` | PASS | `eng` found `HELLO KETOS`; `rus` found `ПРИВЕТ КЕТОС` |
| `video.inspect_frames` | BLOCKED | typed `partial`; `host_visual_analysis_required` |
| `video.summarize_timeline` | PASS | `completed`; five aligned events; no limitations after bounded host observation |

The active Codex host also opened the extracted frame and visually confirmed the white title card
and both expected text lines. This proves that diagnostic frame was inspected; it does not qualify
an unattended production visual-analysis adapter.

Qualification command:

```text
RAYTSYSTEM_RUN_WATCH_QUALIFICATION=1 uv run pytest -q \
  tests/test_toolhub_watch_qualification.py
1 passed
```

## Why the status is not PASS

### `default_cli_local_executor_unavailable`

The stock dispatcher constructs `AllowlistedCliRunner`, which intentionally declares
`enforces_local_sandbox = false`. Therefore stock CLI local media probe/audio/frame/OCR fails closed
even when binaries and executable pins exist.

A stricter diagnostic `sandbox-exec` profile with read access limited to project, system, and
Homebrew roots caused Homebrew `ffprobe` to abort in dyld on macOS 26.5.1. A global-read,
network-denied, stage-write-confined diagnostic profile exercised the real binaries successfully,
but it is not root-confined enough to be accepted as the production capability.

Minimal unblock: implement and qualify a host-injected OS capability executor with network denial
and approved-root read/write confinement, then expose it to the CLI/host adapter without weakening
the executable pin and typed-argv contracts.

### `destination_bound_download_executor_unavailable`

`video.download` requires both a short-lived exact `NetworkApproval` and a
`DestinationBoundDownloadExecutor` that owns DNS, redirects, and socket enforcement. The stock CLI
injects neither the executor nor a complete approval surface for `tool watch`.

Minimal unblock: implement a destination-enforcing host capability, add a destination-bound approval
flow, and qualify it using a safe public URL. No remote download was attempted in this task.

### `host_visual_analysis_required`

`video.inspect_frames` validates staged frames/OCR and always returns a local evidence manifest with
`partial`. It has no typed completion handoff that retains an actual host visual observation.

Minimal unblock: add and qualify a bounded artifact-hash-bound host observation handoff, preserve
the inspection provenance, and rerun the full matrix through both Codex and Claude Code adapters.

## Verification

Combined project policy/catalog/readiness gate:

```text
node --test \
  scripts/raytsystem-watch-readiness.test.mjs \
  scripts/codex-skill-policy.test.mjs \
  scripts/claude-skill-adapters.test.mjs \
  scripts/raytsystem-canonical-catalog.test.mjs
tests 15, pass 15, fail 0
```

Nested Tool Hub gate:

```text
RAYTSYSTEM_RUN_WATCH_QUALIFICATION=1 uv run pytest -q \
  tests/test_toolhub_video.py \
  tests/test_toolhub_mcp.py \
  tests/test_toolhub_watch_qualification.py
40 passed
```

Focused lint:

```text
uv run ruff check tests/test_toolhub_watch_qualification.py
All checks passed
```

Workspace RaytSystem lint:

```text
raytsystem lint --root /Volumes/Projects/ketos_canvas_mod_main --json
ok: true
findings: 0
```

`raytsystem doctor` remains non-healthy only because the disposable code graph is stale after
parallel agents changed six script inputs. It was not rebuilt because graph refresh is outside this
Tool Hub/WATCH scope and Graphify must not be changed as a side effect.

## Files changed

Outer Ketos workspace:

- `skills/raytsystem-watch/SKILL.md`
- `skills/raytsystem-watch/references/tool-contracts.md`
- `skills/raytsystem-watch/references/compatibility-report.md`
- `scripts/raytsystem-watch-readiness.test.mjs`
- `ops/subagent-reports/11-toolhub-watch.md`

Nested RaytSystem checkout:

- `raytsystem/skills/raytsystem-watch/references/tool-contracts.md`
- `raytsystem/skills/raytsystem-watch/references/compatibility-report.md`
- `raytsystem/tests/test_toolhub_watch_qualification.py`

Host adapters did not require edits: both already point to their canonical WATCH procedure and
their policy tests pass with the restored reference set.

## Reviewer follow-up: OCR and matrix hardening

The qualification test was hardened after review so empty or partial OCR results cannot satisfy
vacuous `all(...)` assertions.

Added checks:

- both English and Russian OCR outputs must have `status == completed`;
- each OCR output must contain exactly one item per extracted frame;
- the matrix must contain exactly six distinct PASS tool IDs and two distinct BLOCKED tool IDs;
- PASS and BLOCKED sets must be disjoint and their union must equal all eight `VideoToolId` values.

Follow-up verification:

```text
RAYTSYSTEM_RUN_WATCH_QUALIFICATION=1 uv run pytest -q \
  tests/test_toolhub_watch_qualification.py
1 passed
```

```text
uv run ruff check tests/test_toolhub_watch_qualification.py
All checks passed
```

```text
node --test scripts/raytsystem-watch-readiness.test.mjs
tests 3, pass 3, fail 0
```
