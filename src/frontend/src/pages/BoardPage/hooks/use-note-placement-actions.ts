import axios from "axios";

import {
  useDeleteBoardNote,
  usePatchBoardNote,
  usePostBoardNote,
} from "@/controllers/API/queries/board-notes";
import { usePostPlacement } from "@/controllers/API/queries/placements";
import type { BoardNote, BoardNoteConflict } from "@/types/board";

type BoardNoteErrorResponse = {
  detail?: {
    code?: string;
  };
};

function isUnsafeMarkdownError(error: unknown): boolean {
  return (
    axios.isAxiosError<BoardNoteErrorResponse>(error) &&
    error.response?.status === 422 &&
    error.response.data?.detail?.code === "unsafe_markdown"
  );
}

export function useNotePlacementActions({
  projectId,
  boardId,
  onConflict,
}: {
  projectId: string;
  boardId: string;
  onConflict?: (conflict: BoardNoteConflict) => void;
}) {
  const createMutation = usePostBoardNote({ projectId, boardId });
  const saveMutation = usePatchBoardNote({ projectId, onConflict });
  const deleteMutation = useDeleteBoardNote({ projectId });
  const placementMutation = usePostPlacement({ boardId });

  return {
    createAt: (center: { x: number; y: number }) =>
      createMutation.mutate({
        content: "",
        color: "#fff4cc",
        placement: {
          x: center.x - 160,
          y: center.y - 120,
          width: 320,
          height: 240,
        },
      }),
    save: (note: BoardNote, draft: string) =>
      saveMutation.mutate({
        noteId: note.id,
        expectedRevision: note.revision,
        content: draft,
        unsavedDraft: draft,
      }),
    replace: (note: BoardNote, center: { x: number; y: number }) =>
      placementMutation.mutate({
        targetKind: "note",
        targetId: note.id,
        x: center.x - 160,
        y: center.y - 120,
        width: 320,
        height: 240,
      }),
    deleteEntity: (note: BoardNote) =>
      deleteMutation.mutate({
        noteId: note.id,
        expectedRevision: note.revision,
      }),
    unsafeContentError:
      saveMutation.isError && isUnsafeMarkdownError(saveMutation.error),
    isPending:
      createMutation.isPending ||
      saveMutation.isPending ||
      deleteMutation.isPending ||
      placementMutation.isPending,
  };
}
