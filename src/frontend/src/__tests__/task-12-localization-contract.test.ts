import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const frontendRoot = resolve(__dirname, "../..");

function source(relativePath: string): string {
  return readFileSync(resolve(frontendRoot, relativePath), "utf8");
}

const task12CandidateDebt: Record<string, string[]> = {
  "src/components/core/assistantPanel/assistant-panel.constants.ts": [
    'text: "Build agents and other components"',
    'text: "Answer questions about Ketos"',
  ],
  "src/components/core/assistantPanel/components/assistant-build-tasks.tsx": [
    "return `Added ${",
    "return `Removed ${",
    "return `Wired ${",
    "return `Configured ${",
  ],
  "src/components/core/assistantPanel/components/assistant-component-result.tsx":
    [">Approve<"],
  "src/components/core/assistantPanel/components/assistant-file-card.tsx": [
    ">Open<",
    ">Download<",
  ],
  "src/components/core/assistantPanel/components/assistant-flow-preview.tsx": [
    ">Add to canvas<",
    'title="Discard the current canvas and replace it with this flow"',
    ">Replace canvas<",
    ">Dismiss<",
    ">Added to canvas<",
    ">Dismissed<",
    ">Added to flow<",
    ">Add to Flow<",
  ],
  "src/components/core/assistantPanel/components/assistant-header.tsx": [
    'title="Skip-all mode is on.',
  ],
  "src/components/core/assistantPanel/components/assistant-loading-state.tsx": [
    'aria-label="Generating flow"',
  ],
  "src/components/core/assistantPanel/components/assistant-message-body.tsx": [
    ">Cancelled<",
  ],
  "src/components/core/assistantPanel/components/assistant-plan-card.tsx": [
    ">Continue<",
    ">Reset<",
    ">Dismiss<",
    ">Plan approved<",
    ">Dismissed<",
  ],
  "src/components/core/assistantPanel/components/model-selector.tsx": [
    'title="This model may underperform on agent tasks"',
  ],
  "src/modals/IOModal/components/chatView/chatInput/components/voice-assistant/helpers/create-new-session-name.ts":
    ['toLocaleString("en-US"', "return `Session ${"],
  "src/modals/IOModal/components/chatView/fileComponent/components/file-card.tsx":
    ['alt="generated image"'],
  "src/modals/IOModal/components/chatView/fileComponent/components/file-preview.tsx":
    [">Error...<", 'alt="file"'],
  "src/modals/IOModal/components/sidebar-open-view.tsx": [">Chat<"],
  "src/pages/FlowPage/components/MemoriesMainContent/components/MemoryDetailsHeader.tsx":
    ['aria-label="Delete memory"'],
  "src/pages/FlowPage/components/TraceComponent/traceViewHelpers.ts": [
    'return "Empty"',
  ],
};

const auditDebt: Record<string, string[]> = {
  "src/components/core/assistantPanel/components/assistant-flow-edit-card.tsx":
    [
      ">Show less<",
      ">Show more<",
      ">Accept<",
      ">Dismiss<",
      ">Applied<",
      ">Dismissed<",
      ">Proposed Changes<",
      ">Accept All (<",
    ],
  "src/components/core/assistantPanel/components/assistant-flow-preview.tsx": [
    '|| "Untitled Flow"',
    ">components,<",
    ">connections<",
    ">Preview disabled — too many components (<",
  ],
  "src/components/core/assistantPanel/components/assistant-input.tsx": [
    'placeholder="Tell me what to change…"',
  ],
  "src/components/core/assistantPanel/components/assistant-plan-card.tsx": [
    '"Refining plan"',
    '"Proposed plan"',
    ">Send your changes…<",
  ],
  "src/components/core/assistantPanel/components/assistant-validation-failed.tsx":
    [
      ">Component generation failed<",
      ">The selected model was unable to generate valid component code.",
      ">Error details<",
      ">Try Again<",
    ],
  "src/components/core/playgroundComponent/chat-view/chat-header/components/chat-sessions-dropdown.tsx":
    [">Default Session<", ">New Session<"],
  "src/components/core/playgroundComponent/chat-view/chat-messages/components/edit-message-field.tsx":
    [">Save<", ">Cancel<", ">Editing messages will update the memory"],
  "src/components/core/playgroundComponent/chat-view/chat-messages/components/error-message.tsx":
    [">Flow running...<", ">An error occurred<", ">Field:<"],
  "src/components/core/playgroundComponent/chat-view/chat-messages/components/flow-running-squeleton.tsx":
    [">Flow running...<"],
  "src/modals/IOModal/components/chatView/chatInput/components/button-send-wrapper.tsx":
    [">Stop<", ">Send<"],
  "src/modals/IOModal/components/chatView/chatMessage/components/content-view.tsx":
    [
      ">Flow running...<",
      ">An error occured in the<",
      ">Component, stopping your flow.",
      ">Error details:<",
      ">Field:<",
      ">Steps to fix:<",
    ],
  "src/modals/IOModal/components/chatView/chatMessage/components/edit-message-field.tsx":
    [">Save<", ">Cancel<", ">Editing messages will update the memory"],
  "src/modals/IOModal/components/chatView/components/chat-view.tsx": [
    ">New chat<",
    ">Test your flow with a chat prompt<",
  ],
  "src/modals/IOModal/components/flow-running-squeleton.tsx": [
    ">Flow running...<",
  ],
  "src/modals/IOModal/components/IOFieldView/components/session-selector.tsx": [
    ">Default Session<",
    ">Rename<",
    ">Message logs<",
    ">Delete<",
  ],
  "src/pages/FlowPage/components/MemoriesMainContent/components/MemoryDocumentPanel.tsx":
    [">\(no session\)<"],
  "src/pages/FlowPage/components/TraceComponent/TraceAccordionItem.tsx": [
    ">tokens<",
    ">Input:<",
    ">Output:<",
    ">Failed to load trace details<",
  ],
  "src/pages/FlowPage/components/TraceComponent/SpanNode.tsx": [
    "aria-label={span.status}",
  ],
  "src/pages/FlowPage/components/TraceComponent/SpanDetail.tsx": [
    "aria-label={span.status}",
  ],
  "src/pages/FlowPage/components/TraceComponent/TraceDetailView.tsx": [
    '"Run Summary"',
  ],
  "src/pages/FlowPage/components/TraceComponent/config/flowTraceColumns.tsx": [
    "aria-label={status}",
  ],
  "src/modals/IOModal/components/chatView/chatInput/components/voice-assistant/hooks/use-start-conversation.ts":
    ['|| "en-US"'],
};

describe("Task 12 frontend localization contract", () => {
  it.each(Object.entries(task12CandidateDebt))(
    "removes confirmed Task 12 candidate debt from %s",
    (relativePath, forbiddenFragments) => {
      const contents = source(relativePath);
      for (const fragment of forbiddenFragments) {
        expect(contents).not.toContain(fragment);
      }
    },
  );

  it.each(Object.entries(auditDebt))(
    "removes additional Wave D audit debt from %s",
    (relativePath, forbiddenFragments) => {
      const contents = source(relativePath);
      for (const fragment of forbiddenFragments) {
        expect(contents).not.toContain(fragment);
      }
    },
  );

  it("keeps assistant event and state identifiers as stable machine values", () => {
    const types = source(
      "src/components/core/assistantPanel/assistant-panel.types.ts",
    );
    for (const identifier of [
      '"add_component"',
      '"remove_component"',
      '"connect"',
      '"configure"',
      '"pending"',
      '"approved"',
      '"dismissed"',
      '"refining"',
    ]) {
      expect(types).toContain(identifier);
    }
  });

  it("keeps raw assistant, trace, and provider payloads on their original paths", () => {
    expect(
      source(
        "src/components/core/assistantPanel/components/assistant-message-body.tsx",
      ),
    ).toContain("{message.content}");
    expect(
      source("src/pages/FlowPage/components/TraceComponent/SpanDetail.tsx"),
    ).toContain("code={formatJsonData(span.inputs)}");
    expect(
      source("src/pages/FlowPage/components/TraceComponent/SpanDetail.tsx"),
    ).toContain("code={formatJsonData(span.outputs)}");
    expect(
      source(
        "src/modals/IOModal/components/chatView/chatInput/components/voice-assistant/hooks/use-start-recording.ts",
      ),
    ).toContain('type: "input_audio_buffer.append"');
  });
});
