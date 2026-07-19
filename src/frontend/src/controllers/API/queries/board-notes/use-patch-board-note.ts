import axios from "axios";
import type { useMutationFunctionType } from "@/types/api";
import type {
  BoardNote,
  BoardNoteConflict,
  BoardNotePatchInput,
} from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { boardNoteKeys } from "./keys";
import { type BoardNoteWire, mapBoardNote } from "./wire";

type PatchMutation = useMutationFunctionType<
  { projectId: string },
  BoardNotePatchInput,
  BoardNote
>;

export interface UsePatchBoardNoteParams {
  projectId: string;
  onConflict?: (conflict: BoardNoteConflict) => void;
}

export const usePatchBoardNote = (
  { projectId, onConflict }: UsePatchBoardNoteParams,
  options?: Parameters<PatchMutation>[1],
): ReturnType<PatchMutation> => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    boardNoteKeys.all,
    async ({ noteId, expectedRevision, content, color }: BoardNotePatchInput) =>
      mapBoardNote(
        (
          await api.patch<BoardNoteWire>(`${getURL("BOARD_NOTES")}/${noteId}`, {
            ...(content === undefined ? {} : { content }),
            ...(color === undefined ? {} : { color }),
            expected_revision: expectedRevision,
          })
        ).data,
      ),
    {
      ...options,
      retry: false,
      onSuccess: async (note, ...args) => {
        queryClient.setQueryData(boardNoteKeys.detail(note.id), note);
        queryClient.setQueryData<BoardNote[]>(
          boardNoteKeys.project(projectId),
          (notes) => notes?.map((item) => (item.id === note.id ? note : item)),
        );
        await options?.onSuccess?.(note, ...args);
      },
      onError: async (error, input, ...args) => {
        if (axios.isAxiosError(error) && error.response?.status === 409) {
          onConflict?.({
            code: "stale_revision",
            noteId: input.noteId,
            unsavedDraft: input.unsavedDraft ?? input.content ?? "",
          });
          await queryClient.refetchQueries({
            queryKey: boardNoteKeys.detail(input.noteId),
            exact: true,
          });
          await queryClient.refetchQueries({
            queryKey: boardNoteKeys.project(projectId),
          });
        }
        await options?.onError?.(error, input, ...args);
      },
    },
  );
};
