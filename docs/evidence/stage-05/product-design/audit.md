# Stage 05 Product Design audit

**Verdict:** `PASS`

**Tested candidate:** `1828f9cde0e`

**Tested tree:** `5ea9d1f9653e449c46e693db0a56b0f4e0ce8fd4`

**Current-run durable root:** `/Volumes/Projects/.ketos-stage05-final.yKdZoH`

## Interaction and isolation evidence

The prior shared-agent finding is resolved. Each stock `CopilotChat` surface now registers a distinct local `ProxiedCopilotRuntimeAgent` identity while both proxy requests continue to use the required runtime route `/api/copilotkit/agent/ketos-chat/run`. The browser proof intercepted exactly two primary run requests and asserted that each body carried its own durable Chat UUID:

- `Release evidence`: `7cf77fa3-6c50-4f5a-bd96-c6eb38800417`;
- `Operations notes`: `a5b1034e-e6cc-4668-9331-e76267814598`.

The executable story also proved:

- each answer appeared in only its originating accessible Chat region;
- each Chat persisted exactly one `ChatRun` and two ordered message rows with `chat_sequence` `1, 2` in the durable SQLite database;
- replay created no additional provider calls;
- collapse/remount, close/re-place, controlled reconnect, `mvp_chat=false`, and subsequent re-enable preserved the independent IDs and transcripts;
- the replacement card received focus and its bounding box did not intersect the sibling card.

All three controlled launches passed serially on the same current-run root: main two-chat story, feature-flag-off survival, and restore-only re-enable.

## Current-run visual evidence

| State | Artifact | Product Design review |
| --- | --- | --- |
| Empty | [01-empty.png](./01-empty.png) | Chat-list hierarchy is clear; search and create actions are grouped; empty copy is readable; no clipping or overlap at 1800×1000. |
| Search no results | [02-search-no-results.png](./02-search-no-results.png) | The query, clear control, create action, and no-results feedback remain distinguishable and aligned. |
| Two placed chats | [03-two-chats.png](./03-two-chats.png) | Two titled stock CopilotKit surfaces are visible side by side; CardFrame actions and composers do not collide. |
| Error and reconnect | [04-error-reconnect.png](./04-error-reconnect.png) | Semantic error and reconnect status are readable without losing either durable Chat surface or the board layout. |
| Close, replace, focus | [05-close-replace-focus.png](./05-close-replace-focus.png) | The replaced first Chat shows its restored transcript in a focused, fully visible adjacent slot; the second Chat remains separate and readable. |

The implementation stays inside the existing Ketos visual system: Board canvas, BoardCardFrame, React Flow placement behavior, Ketos buttons and semantic tokens, plus the stock CopilotKit message body and composer. No alternate chat surface, raw-color palette, or replacement tool renderer was introduced.

## Tool and evidence limits

- Product Design review and local image inspection were performed for all five PNGs at original resolution after the browser assertions passed.
- Computer Use was available and inspected `03-two-chats.png` in macOS Preview.
- The Chrome controller was available and initialized, but its URL security policy rejected the local `file://` PNG URL. The Chrome session was finalized; this audit does not claim Chrome inspected the local images.
- Playwright interaction, request-body, focus, geometry, API, and direct-database assertions are authoritative; screenshots supplement those assertions.
- No claim of full WCAG conformance is made from screenshots or the focused accessibility checks alone.

There are no active historical UUID or shared-agent blockers for this candidate.
