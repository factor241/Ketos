import type { BoardExecution } from "@/controllers/API/queries/executions";
import type { BoardNote, Placement } from "@/types/board";
import type { ChatThread } from "@/types/chat";
import type { AutomationSummary } from "@/types/flow/automation";
import { placementsToNodes } from "../placement-to-node";

const note: BoardNote = {
  id: "note-1",
  projectId: "project-1",
  createdById: "user-1",
  content: "hello",
  color: "#fff4cc",
  revision: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const placement: Placement = {
  id: "placement-1",
  boardId: "board-1",
  targetKind: "note",
  targetId: note.id,
  x: 12,
  y: 34,
  width: 320,
  height: 240,
  zIndex: 7,
  displayState: "normal",
  revision: 3,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

const chat: ChatThread = {
  id: "chat-1",
  projectId: "project-1",
  createdById: "user-1",
  title: "Incident copilot",
  provider: "OpenAI",
  modelName: "gpt-4o",
  contextPolicy: "board",
  archived: false,
  revision: 0,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

const automation: AutomationSummary = {
  id: "flow-1",
  name: "Incident automation",
  description: null,
};

describe("placementsToNodes", () => {
  it("uses placement identity and geometry while keeping target identity separate", () => {
    expect(placementsToNodes([placement], [note], [], [])).toEqual([
      expect.objectContaining({
        id: "placement-1",
        type: "boardNote",
        dragHandle: ".board-card-drag-handle",
        position: { x: 12, y: 34 },
        style: { width: 320, height: 240 },
        zIndex: 7,
        data: expect.objectContaining({
          placementId: "placement-1",
          targetId: "note-1",
          note,
          placement,
        }),
      }),
    ]);
  });

  it("creates a distinct chat node from placement geometry and durable chat identity", () => {
    const chatPlacement = {
      ...placement,
      id: "placement-2",
      targetKind: "chat" as const,
      targetId: chat.id,
    };
    expect(placementsToNodes([chatPlacement], [], [chat], [])).toEqual([
      expect.objectContaining({
        id: "placement-2",
        type: "chat",
        position: { x: 12, y: 34 },
        data: expect.objectContaining({ chat, placement: chatPlacement }),
      }),
    ]);
  });

  it("creates an automation node from Placement identity while keeping Flow identity separate", () => {
    const automationPlacement: Placement = {
      ...placement,
      id: "placement-automation",
      targetKind: "automation",
      targetId: automation.id,
    };

    expect(
      placementsToNodes([automationPlacement], [], [], [automation]),
    ).toEqual([
      expect.objectContaining({
        id: "placement-automation",
        type: "automation",
        data: expect.objectContaining({
          placementId: "placement-automation",
          targetId: "flow-1",
          summary: automation,
          placement: automationPlacement,
        }),
      }),
    ]);
  });

  it("keeps a missing-summary automation and quarantines unsupported future kinds", () => {
    const missingSummaryAutomation: Placement = {
      ...placement,
      id: "placement-automation",
      targetKind: "automation",
      targetId: "flow-missing",
    };
    const future: Placement = {
      ...placement,
      id: "placement-future",
      targetKind: "job_result",
    };

    expect(
      placementsToNodes(
        [placement, missingSummaryAutomation, future],
        [],
        [],
        [],
      ),
    ).toEqual([
      expect.objectContaining({
        id: "placement-automation",
        type: "automation",
        data: expect.objectContaining({
          placementId: "placement-automation",
          targetId: "flow-missing",
          summary: null,
        }),
      }),
    ]);
  });

  it("maps an exact terminal execution result without changing existing node kinds", () => {
    const resultPlacement: Placement = {
      ...placement,
      id: "placement-result",
      boardId: "board-1",
      targetKind: "job_result",
      targetId: "job-1",
    };
    const terminal = {
      job_id: "job-1",
      board_id: "board-1",
      flow_id: "flow-1",
      status: "succeeded",
      reason: null,
      created_timestamp: "2026-07-21T00:00:00Z",
      finished_timestamp: "2026-07-21T00:00:01Z",
      result: { kind: "text", value: "done", truncated: false },
    } satisfies BoardExecution;

    expect(
      placementsToNodes([resultPlacement], [], [], [], [terminal]),
    ).toEqual([
      expect.objectContaining({
        id: "placement-result",
        type: "jobResult",
        data: expect.objectContaining({
          placementId: "placement-result",
          targetKind: "job_result",
          execution: terminal,
          placement: resultPlacement,
        }),
      }),
    ]);
    expect(
      placementsToNodes(
        [resultPlacement],
        [],
        [],
        [],
        [{ ...terminal, status: "running", result: null }],
      ),
    ).toEqual([]);
  });
});
