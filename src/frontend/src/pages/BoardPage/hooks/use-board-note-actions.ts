import {
  useDeleteBoardNote,
  usePatchBoardNote,
  usePostBoardNote,
} from "@/controllers/API/queries/board-notes";
import type { BoardNote, BoardNoteConflict } from "@/types/board";

export function useBoardNoteActions({
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
    deleteEntity: (note: BoardNote) =>
      deleteMutation.mutate({
        noteId: note.id,
        expectedRevision: note.revision,
      }),
    isPending:
      createMutation.isPending ||
      saveMutation.isPending ||
      deleteMutation.isPending,
  };
}
