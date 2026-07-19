import axios from "axios";
import type { useMutationFunctionType } from "@/types/api";
import type { BoardNoteDeleteInput } from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { placementKeys } from "../placements/keys";
import { boardNoteKeys } from "./keys";

export const useDeleteBoardNote: useMutationFunctionType<
  { projectId: string },
  BoardNoteDeleteInput,
  void
> = ({ projectId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    boardNoteKeys.all,
    async ({ noteId, expectedRevision }: BoardNoteDeleteInput) => {
      await api.delete(`${getURL("BOARD_NOTES")}/${noteId}`, {
        params: {
          expected_revision: expectedRevision,
          confirm_entity_delete: true,
        },
      });
    },
    {
      ...options,
      retry: false,
      onSuccess: async (data, input, ...args) => {
        queryClient.removeQueries({
          queryKey: boardNoteKeys.detail(input.noteId),
          exact: true,
        });
        await queryClient.invalidateQueries({
          queryKey: boardNoteKeys.project(projectId),
        });
        await queryClient.invalidateQueries({ queryKey: placementKeys.all });
        await options?.onSuccess?.(data, input, ...args);
      },
      onError: async (error, input, ...args) => {
        if (axios.isAxiosError(error) && error.response?.status === 409) {
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
