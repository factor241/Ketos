---
qualification_status: pending
qualified_on: 2026-07-17
platform: macOS-26.5.1-arm64
tool_contract_version: 1.2.0
---

# Ketos watch compatibility report

The contract surface and installed dependencies are present, but the mandatory eight-tool
end-to-end set is not fully executable through the stock CLI. Keep `test_status: pending`.

## Readiness counts

- canonical references: `5/5` present;
- registry contracts: `8/8` present;
- declared CLI dependency names: `4/4` present in the allowlist;
- installed dependency binaries: `4/4` present;
- real synthetic tool outcomes: `6 PASS / 2 BLOCKED / 0 FAIL`;
- distinct qualification capability blockers: `3`.

## Qualified dependency inventory

| Dependency | Qualified version / capability |
|---|---|
| `ffmpeg` | `8.1.2` |
| `ffprobe` | `8.1.2` |
| `yt-dlp` | `2026.07.04` |
| `tesseract` | `5.5.2` |
| `tesseract-lang` | `4.1.0`; languages `eng` and `rus` confirmed |

## Synthetic local-media evidence

A three-second local MP4 with H.264 video, AAC audio, an English/Russian title card, and a VTT
sidecar was exercised with real pinned binaries. The diagnostic executor denied network and
confined writes to a temporary Tool Hub stage. It was used only to qualify binary behavior; it is
not accepted as the missing production root-confined executor.

| Tool | Result | Evidence |
|---|---|---|
| `video.probe` | PASS | `completed`; duration `3.000000`; video and audio streams |
| `video.download` | BLOCKED | `destination_bound_download_executor_unavailable`; no network attempt |
| `video.transcript` | PASS | `completed`; method `sidecar`; one timestamped cue |
| `video.extract_audio` | PASS | `completed`; retained PCM WAV artifact |
| `video.extract_frames` | PASS | `completed`; `2/2` JPEG frames |
| `video.ocr_frames` | PASS | real `eng` OCR found `HELLO KETOS`; real `rus` OCR found `ПРИВЕТ КЕТОС` |
| `video.inspect_frames` | BLOCKED | typed result is `partial` with `host_visual_analysis_required` |
| `video.summarize_timeline` | PASS | `completed` after a bounded host observation; five aligned events |

The extracted frame was also inspected by the active Codex host and showed the expected white title
card with English `HELLO KETOS` and Russian `ПРИВЕТ КЕТОС`. This proves the one diagnostic frame was
viewed; it does not qualify unattended host visual inspection.

## Exact blockers

1. `default_cli_local_executor_unavailable`: the stock CLI constructs
   `AllowlistedCliRunner`, whose `enforces_local_sandbox` is false. Local probe/audio/frame/OCR
   therefore fail closed without a host-injected network-denied, root-confined executor.
2. `destination_bound_download_executor_unavailable`: the stock CLI exposes no approval input on
   `tool watch` and injects no destination-enforcing downloader. A safe public URL was not fetched.
3. `host_visual_analysis_required`: `video.inspect_frames` always emits a local evidence manifest
   and `partial`; the Codex/Claude adapters have no qualified typed handoff that writes actual visual
   observations back into the pipeline.

A stricter macOS `sandbox-exec` diagnostic with read access limited to the project/system/Homebrew
roots caused Homebrew `ffprobe` to abort in dyld on this macOS build. Expanding the diagnostic to
global read plus stage-only write allowed the real functional stages to run, but does not satisfy
the production root-confinement requirement and is not used to claim PASS.

## Host surface status

- Codex adapter: structural readiness policy present; local/URL media E2E not qualified.
- Claude Code adapter: structural readiness policy present; local/URL media E2E not qualified.
- Supplied transcript through the global CLI: available.

Move this report and the skill to `pass` only after a production host supplies the missing local and
download capabilities, real visual inspection completes through a typed handoff, and the same
eight-tool mandatory set passes without a policy downgrade.
