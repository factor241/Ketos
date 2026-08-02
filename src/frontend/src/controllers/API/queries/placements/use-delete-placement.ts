import axios from "axios";
import type { useMutationFunctionType } from "@/types/api";
import type { PlacementDeleteInput } from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { placementKeys } from "./keys";

export const useDeletePlacement: useMutationFunctionType<
  { boardId: string },
  PlacementDeleteInput,
  void
> = ({ boardId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    placementKeys.all,
    async ({ placementId, expectedRevision }: PlacementDeleteInput) => {
      await api.delete(`${getURL("PLACEMENTS")}/${placementId}`, {
        params: { expected_revision: expectedRevision },
      });
    },
    {
      ...options,
      retry: false,
      onSuccess: async (data, input, ...args) => {
        queryClient.removeQueries({
          queryKey: placementKeys.detail(input.placementId),
          exact: true,
        });
        await queryClient.invalidateQueries({
          queryKey: placementKeys.scene(boardId),
        });
        await options?.onSuccess?.(data, input, ...args);
      },
      onError: async (error, input, ...args) => {
        if (axios.isAxiosError(error) && error.response?.status === 409) {
          await queryClient.refetchQueries({
            queryKey: placementKeys.detail(input.placementId),
            exact: true,
          });
          await queryClient.refetchQueries({
            queryKey: placementKeys.scene(boardId),
          });
        }
        await options?.onError?.(error, input, ...args);
      },
    },
  );
};
