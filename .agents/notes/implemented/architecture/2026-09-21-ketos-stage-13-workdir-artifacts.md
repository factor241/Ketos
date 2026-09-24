# Agent Note: Board windows derive session artifacts from tool results and isolate runtime state from workspace paths

Status: implemented

English | [中文](2026-09-21-ketos-stage-13-workdir-artifacts.zh.md)

## Problem

Ketos sessions run in a dedicated working directory that is fixed at creation time, but users could neither inspect the working directory of a chat nor view the files created or modified during the session from the board. Composer controls previously included a folder chip, which cluttered the prompt drafting surface and offered a misleading suggestion that working directories could be modified mid-session. Furthermore, the board lacked any presentation for files affected by tool operations, while raw filesystem browsing was restricted to the side panels.

There was also a critical isolation risk: users or automated tools could unintentionally select or register the Ketos runtime home directory (`~/.ketos` or `$DSH_HOME`) as their active workspace directory, allowing prompt operations or command executions to corrupt runtime databases (`board.db`, `settings.yaml`, session logs). Additionally, selecting dangerous locations such as the filesystem root (`/`, `C:\`) or the entire user home directory (`~`) lacked client-side warnings or confirmation guards.

## Decision

**Working directory display and project quick actions live exclusively in the chats panel.** The panel's chats level now displays the active project's path with dedicated actions to copy the path (`panel-copy-path`) and reveal or open the folder in the system file manager (`panel-open-folder`) via the existing `session.openWorkspacePath` route. The composer invariant is permanently enforced: no workspace or folder chip is ever rendered in `ComposerBar`.

**Session artifacts derive dynamically from settled tool results without filesystem scans.** `window/artifacts-model.ts` inspects settled tool results in the session's chat snapshot, recognizing file interactions from `write`, `edit`, `str_replace_editor`, and `read` operations (including subcalls), while ignoring failed calls (`isError`). Artifacts are deduplicated by normalized path with mutation precedence: write/edit operations (`created`, `modified`) outrank passive read operations (`read`), preserving mutation tags and updating timestamps to the latest interaction.

**Artifacts render in a dedicated panel tab and a conversation summary strip.** The chats panel now provides a segmented tab control (`[Chats]` and `[Artifacts]`), a 5th rail action button (`panel-rail-artifacts`), and a full artifacts list with empty-state messaging, tags (`Tag` with `data-board-artifact-kind`), and quick actions to copy path or reveal in the file manager. A non-intrusive artifacts summary strip sits above the composer in `ConversationBody`, displaying the artifact count and toggling directly into the artifacts panel tab.

**Host and client enforce strict isolation for `~/.ketos` and warn on root paths.** On the host, `workspace-controller` canonicalizes candidate paths with `fs.realpath` and rejects any path equal to or nested within `$DSH_HOME`, `~/.ketos`, or `~/.dsh` with `RemoteError('workspace/invalid-path', ...)`. On the client, `validateWorkspacePath` performs synchronous path checks against known home and DSH roots, throwing localized dictionary errors (`panel.error.ketosHome`) for forbidden paths and prompting for confirmation (`panel.warn.dangerousPath`) before accepting filesystem root or user home directories.

## Alternatives considered

- **Scan the filesystem on the host to list produced artifacts.** Rejected: filesystem scans are expensive, race with background tools, capture unrelated untracked files, and break remote or sandboxed deployments where client boards view remote sessions. Deriving artifacts purely from settled tool calls in the session log guarantees 100% fidelity to the model's actual work.
- **Return the folder chip to the composer bar.** Rejected: the session working directory is immutable after creation; placing a folder selector or chip in the composer creates false affordances and wastes scarce input space.
- **Provide a full interactive file manager in the board window.** Rejected as out of scope for MVP: full file browsing, file viewing, and tree exploration already exist in `ui-sidebar-files`. The board window focuses on a clean list of touched artifacts with path copy and system reveal.
- **Hardcode path checks solely on the client.** Rejected: malicious or direct RPC calls could bypass the client UI; security isolation requires host enforcement with realpath canonicalization backed by client-side friendly pre-validation.

## Consequences

Users can immediately see which project folder an agent is working in, copy its path, or open it in their OS file manager. Produced files are tracked and surfaced in the artifacts tab and conversation strip as they are generated, providing quick access without digging through long chat transcripts. Attempting to target `~/.ketos` or `$DSH_HOME` is cleanly blocked across both host and client boundaries, preventing accidental corruption of runtime state.

Verification: `tests/artifacts-model.client.spec.ts` verifies tool node extraction, mutation precedence, deduplication, and subcall handling; `tests/path-validation.client.spec.ts` verifies client validation and warning triggers; `tests/window-chats-panel.client.spec.tsx` verifies project path display, quick actions, tab switching, rail and strip triggers, and folder rejection; `packages/api/workspace-controller/tests/workspace-controller.host.spec.ts` proves host rejection of `$DSH_HOME` and `~/.ketos`; and `tests/composer.client.spec.tsx` verifies the composer invariant.

## Related

- [Board windows manage workspaces and chats in a resizable side panel](2026-09-16-ketos-board-window-chats-panel.md) — the chats panel layout and folder browser foundation.
- [Board windows render tool calls as cards and navigate pending approvals to the main panel](2026-09-20-ketos-board-tool-cards-approvals.md) — the settled tool nodes from which artifacts are extracted.
- [`packages/client/ui-board/README.md`](../../../../packages/client/ui-board/README.md) — package documentation covering workspace folder and artifact limitations.
- [`packages/api/workspace-controller/README.md`](../../../../packages/api/workspace-controller/README.md) — workspace controller commands and path validation contract.
