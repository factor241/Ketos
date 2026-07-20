# Stage 05 Product Design audit

**Verdict:** `BLOCKED`

**Candidate:** `9ce671d064016148e739287630710002e55c95be`

## Reviewed current-run evidence

| State | Artifact | Visual review |
| --- | --- | --- |
| Empty | [01-empty.png](./01-empty.png) | Board hierarchy remains recognizable; chat search/create controls are grouped; empty copy is visible; no overlap or clipping at 1800×1000. |
| Search no results | [02-search-no-results.png](./02-search-no-results.png) | Query, clear control, create action and no-results feedback are readable and aligned. |
| Two placed chats | [03-two-chats.png](./03-two-chats.png) | Both stock CopilotKit surfaces are fully visible, independently framed, titled and operable; CardFrame actions do not overlap the composer. |

The implementation reuses the existing Board, CardFrame, React Flow canvas, Ketos buttons, semantic color tokens and stock `CopilotChat`. It does not introduce a replacement message body, composer, tool renderer, raw-color palette or new visual language.

## Blocking finding

Two stock `CopilotChat` instances using the required fixed agent ID `ketos-chat` do not retain independent `threadId` values in the installed `@copilotkit/react-core@1.63.1-ketos.1`. The real-browser assertion for a message sent from **Release evidence** received the ID of **Operations notes**:

- expected: `27f7ebf9-c455-46ac-806d-a1a9b111389b`
- received: `6d11fbf5-45d9-4462-bd30-d61940c2e686`
- evidence: `src/frontend/test-results/core-integrations-board-co-87cd0-acement-lifecycle-and-focus-chromium/error-context.md`

The installed build resolves one shared agent by `agentId` and each mounted chat mutates that same object's `threadId`. This makes the result mount/effect-order dependent and violates the two-chat isolation requirement.

The official component contract documents `agentId` and `threadId` as chat properties and the official architecture expects thread-scoped conversations:

- [CopilotChat reference](https://docs.copilotkit.ai/reference/v2/components/CopilotChat)
- [CopilotKit runtime backend](https://docs.copilotkit.ai/a2a/backend/copilot-runtime)
- [AG-UI messages](https://docs.ag-ui.com/concepts/messages)

## Evidence limits

- `04-error-reconnect.png` and `05-close-replace-focus.png` are intentionally absent: the executable story stops at the critical thread-isolation assertion before those states.
- The three screenshots above were inspected visually, but screenshots do not replace interaction assertions.
- No claim of full WCAG conformance is made. Focus, semantic regions and keyboard actions have focused Jest coverage; the complete browser focus roundtrip remains blocked downstream of thread isolation.
- Chrome and Computer Use skill instructions were available, but their controlling MCP tools were not exposed in this session. Local image inspection and Playwright evidence were used and this limitation is not represented as a successful connector run.

## Minimal unblock

Admit an approved pinned CopilotKit artifact whose stock `CopilotChat` creates or resolves distinct agent state per `(agentId, threadId)`, without adding a second provider, alternate agent IDs, a wrapper chat surface or a package-lock change inside Stage 05. Then rerun the entire browser story and capture states 04 and 05.
