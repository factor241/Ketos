import type { BoardNote, Placement } from "@/types/board";
import type { ChatThread } from "@/types/chat";
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

describe("placementsToNodes", () => {
  it("uses placement identity and geometry while keeping target identity separate", () => {
    expect(placementsToNodes([placement], [note], [])).toEqual([
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
    expect(placementsToNodes([chatPlacement], [], [chat])).toEqual([
      expect.objectContaining({
        id: "placement-2",
        type: "chat",
        position: { x: 12, y: 34 },
        data: expect.objectContaining({ chat, placement: chatPlacement }),
      }),
    ]);
  });

  it("quarantines missing targets and unsupported future kinds", () => {
    const future = {
      ...placement,
      id: "placement-2",
      targetKind: "automation" as const,
    };
    expect(placementsToNodes([placement, future], [], [])).toEqual([]);
  });
});
