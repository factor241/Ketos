import { renderHook } from "@testing-library/react";

import {
  useDeleteBoardNote,
  usePatchBoardNote,
  usePostBoardNote,
} from "@/controllers/API/queries/board-notes";
import { usePostPlacement } from "@/controllers/API/queries/placements";
import type { BoardNote } from "@/types/board";
import { useNotePlacementActions } from "../use-note-placement-actions";

jest.mock("@/controllers/API/queries/board-notes");
jest.mock("@/controllers/API/queries/placements");
const mockCreate = jest.mocked(usePostBoardNote);
const mockPatch = jest.mocked(usePatchBoardNote);
const mockDelete = jest.mocked(useDeleteBoardNote);
const mockPlacement = jest.mocked(usePostPlacement);
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

describe("useNotePlacementActions", () => {
  it("creates centered notes and keeps unsaved drafts in CAS saves", () => {
    const create = jest.fn();
    const patch = jest.fn();
    const remove = jest.fn();
    const replace = jest.fn();
    mockCreate.mockReturnValue({ mutate: create, isPending: false } as never);
    mockPatch.mockReturnValue({ mutate: patch, isPending: false } as never);
    mockDelete.mockReturnValue({ mutate: remove, isPending: false } as never);
    mockPlacement.mockReturnValue({
      mutate: replace,
      isPending: false,
    } as never);
    const onConflict = jest.fn();
    const { result } = renderHook(() =>
      useNotePlacementActions({
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
    result.current.replace(note, { x: 500, y: 400 });
    expect(replace).toHaveBeenCalledWith({
      targetKind: "note",
      targetId: "note-1",
      x: 340,
      y: 280,
      width: 320,
      height: 240,
    });
  });

  it("exposes unsafe markdown validation errors from note saves", () => {
    mockCreate.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    } as never);
    mockPatch.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
      isError: true,
      error: {
        isAxiosError: true,
        response: {
          status: 422,
          data: { detail: { code: "unsafe_markdown" } },
        },
      },
    } as never);
    mockDelete.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    } as never);
    mockPlacement.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    } as never);

    const { result } = renderHook(() =>
      useNotePlacementActions({
        projectId: "project-1",
        boardId: "board-1",
      }),
    );

    expect(result.current.unsafeContentError).toBe(true);
  });

  it.each([
    [409, "unsafe_markdown"],
    [422, "board_entity_validation_error"],
  ])(
    "does not classify status %s with code %s as unsafe markdown",
    (status, code) => {
      mockCreate.mockReturnValue({
        mutate: jest.fn(),
        isPending: false,
      } as never);
      mockPatch.mockReturnValue({
        mutate: jest.fn(),
        isPending: false,
        isError: true,
        error: {
          isAxiosError: true,
          response: { status, data: { detail: { code } } },
        },
      } as never);
      mockDelete.mockReturnValue({
        mutate: jest.fn(),
        isPending: false,
      } as never);
      mockPlacement.mockReturnValue({
        mutate: jest.fn(),
        isPending: false,
      } as never);

      const { result } = renderHook(() =>
        useNotePlacementActions({
          projectId: "project-1",
          boardId: "board-1",
        }),
      );

      expect(result.current.unsafeContentError).toBe(false);
    },
  );
});
