import type { BoardNote, Placement } from "@/types/board";
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

describe("placementsToNodes", () => {
  it("uses placement identity and geometry while keeping target identity separate", () => {
    expect(placementsToNodes([placement], [note])).toEqual([
      expect.objectContaining({
        id: "placement-1",
        type: "board-note",
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

  it("quarantines missing targets and unsupported future kinds", () => {
    const future = {
      ...placement,
      id: "placement-2",
      targetKind: "chat" as const,
    };
    expect(placementsToNodes([placement, future], [])).toEqual([]);
  });
});
