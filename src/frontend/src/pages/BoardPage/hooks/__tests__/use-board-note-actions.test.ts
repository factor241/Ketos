import { renderHook } from "@testing-library/react";

import {
  useDeleteBoardNote,
  usePatchBoardNote,
  usePostBoardNote,
} from "@/controllers/API/queries/board-notes";
import type { BoardNote } from "@/types/board";
import { useBoardNoteActions } from "../use-board-note-actions";

jest.mock("@/controllers/API/queries/board-notes");
const mockCreate = jest.mocked(usePostBoardNote);
const mockPatch = jest.mocked(usePatchBoardNote);
const mockDelete = jest.mocked(useDeleteBoardNote);
const note = {
  id: "note-1",
  projectId: "project-1",
  createdById: "user-1",
  content: "old",
  color: "#fff4cc",
  revision: 3,
  createdAt: "",
  updatedAt: "",
} satisfies BoardNote;

describe("useBoardNoteActions", () => {
  it("creates centered notes and keeps unsaved drafts in CAS saves", () => {
    const create = jest.fn();
    const patch = jest.fn();
    const remove = jest.fn();
    mockCreate.mockReturnValue({ mutate: create, isPending: false } as never);
    mockPatch.mockReturnValue({ mutate: patch, isPending: false } as never);
    mockDelete.mockReturnValue({ mutate: remove, isPending: false } as never);
    const onConflict = jest.fn();
    const { result } = renderHook(() =>
      useBoardNoteActions({
        projectId: "project-1",
        boardId: "board-1",
        onConflict,
      }),
    );
    expect(mockPatch).toHaveBeenCalledWith({
      projectId: "project-1",
      onConflict,
    });
    result.current.createAt({ x: 500, y: 400 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: { x: 340, y: 280, width: 320, height: 240 },
      }),
    );
    result.current.save(note, "draft");
    expect(patch).toHaveBeenCalledWith({
      noteId: "note-1",
      expectedRevision: 3,
      content: "draft",
      unsavedDraft: "draft",
    });
    result.current.deleteEntity(note);
    expect(remove).toHaveBeenCalledWith({
      noteId: "note-1",
      expectedRevision: 3,
    });
  });
});
