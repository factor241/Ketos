import type { useMutationFunctionType } from "@/types/api";
import type {
  BoardNoteCreateInput,
  BoardNoteCreateResult,
} from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { placementKeys } from "../placements/keys";
import { boardNoteKeys } from "./keys";
import {
  type BoardNoteCreateWireResult,
  boardNoteCreatePayload,
  mapBoardNoteCreateResult,
} from "./wire";

export const usePostBoardNote: useMutationFunctionType<
  { projectId: string; boardId: string },
  BoardNoteCreateInput,
  BoardNoteCreateResult
> = ({ projectId, boardId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    boardNoteKeys.all,
    async (input: BoardNoteCreateInput) =>
      mapBoardNoteCreateResult(
        (
          await api.post<BoardNoteCreateWireResult>(
            `${getURL("BOARDS")}/${boardId}/board-notes`,
            boardNoteCreatePayload(input),
          )
        ).data,
      ),
    {
      ...options,
      retry: false,
      onSuccess: async (result, ...args) => {
        queryClient.setQueryData(
          boardNoteKeys.detail(result.note.id),
          result.note,
        );
        queryClient.setQueryData(
          placementKeys.detail(result.placement.id),
          result.placement,
        );
        await queryClient.invalidateQueries({
          queryKey: boardNoteKeys.project(projectId),
        });
        await queryClient.invalidateQueries({
          queryKey: placementKeys.scene(boardId),
        });
        await options?.onSuccess?.(result, ...args);
      },
    },
  );
};
