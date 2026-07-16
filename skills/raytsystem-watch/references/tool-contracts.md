# Tool Hub video contracts

The canonical Tool Hub registry exposes exactly eight governed `video.*` tools at contract version
`1.2.0`. JSON Schema from `raytsystem tool list --json` is authoritative; this reference explains
the operating contract and must not be used to invent extra fields, executables, or side effects.

| Tool ID | Typed purpose | `cli_dependencies` | Normal result |
|---|---|---|---|
| `video.probe` | Probe staged local media streams, format, and duration | `ffprobe` | `completed` |
| `video.download` | Acquire one approved public HTTP(S) media object | `yt-dlp` | `completed` or policy block |
| `video.transcript` | Read supplied text, a transcript file, or a media sidecar | none | `completed` or `partial` |
| `video.extract_audio` | Produce bounded PCM WAV from staged local media | `ffprobe`, `ffmpeg` | `completed` |
| `video.extract_frames` | Produce bounded JPEG frames at typed timestamps/intervals | `ffprobe`, `ffmpeg` | `completed` or `partial` |
| `video.ocr_frames` | OCR staged frame artifacts with `eng`, `rus`, or `eng+rus` | `tesseract` | `completed` or `partial` |
| `video.inspect_frames` | Validate frames/OCR and prepare a local evidence manifest | none | `partial` until host inspection |
| `video.summarize_timeline` | Deterministically align transcript and frame evidence | none | `completed` or `partial` |

## Common contract

- Inputs and outputs are Pydantic-backed JSON objects with extra fields rejected.
- Source kinds are `local_file`, `url`, and `transcript`; individual tools narrow that set.
- Tool outputs use `completed`, `partial`, or `blocked`, retain artifact hashes, and record source
  identity, invocation hash, contract version, executable versions, and untrusted-content status.
- The declared roots are `workspace:read`, `ops/staging/watch:write`, and
  `launcher-pinned-runtime:read`.
- Default limits are 2 GiB, four hours, 48 frames, and 8 MiB of transcript text.
- Every external executable is path-, SHA-256-, version-, platform-, and architecture-pinned.
- There is no generic shell surface. Callers cannot supply executable names, free argv, cookies,
  browser sessions, credentials, DRM bypass, or hidden downloader configuration.

## Network contract

`video.download` requires both an unexpired destination-bound approval for the exact normalized
origin/source identity and a trusted destination-bound executor that owns DNS, redirect, and socket
enforcement. JSON approval alone is insufficient. The stock CLI and MCP dispatcher do not inject
that executor and therefore fail closed before network access.

## Local executor contract

`video.probe`, `video.extract_audio`, `video.extract_frames`, and `video.ocr_frames` require an
injected executor that is network-denied and root-confined at the OS capability boundary. Merely
installing the CLI dependencies or setting executable pins does not satisfy this requirement. The
stock `AllowlistedCliRunner` intentionally reports `enforces_local_sandbox = false`.

## Inspection contract

`video.inspect_frames` does not pretend to be a vision model. It validates retained frames and OCR,
emits `local_evidence_manifest`, and returns `host_visual_analysis_required`. A host may supply
bounded visual observations to `video.summarize_timeline`, but must not call the inspection complete
unless it actually inspected the referenced frames.
