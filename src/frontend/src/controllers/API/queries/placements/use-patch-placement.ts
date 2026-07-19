import axios from "axios";
import type { useMutationFunctionType } from "@/types/api";
import type { Placement, PlacementPatchInput } from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { placementKeys } from "./keys";
import {
  mapPlacement,
  type PlacementWire,
  placementPatchPayload,
} from "./wire";

export const usePatchPlacement: useMutationFunctionType<
  { boardId: string },
  PlacementPatchInput,
  Placement
> = ({ boardId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    placementKeys.all,
    async (input: PlacementPatchInput) =>
      mapPlacement(
        (
          await api.patch<PlacementWire>(
            `${getURL("PLACEMENTS")}/${input.placementId}`,
            placementPatchPayload(input),
          )
        ).data,
      ),
    {
      ...options,
      retry: false,
      onSuccess: async (placement, ...args) => {
        queryClient.setQueryData(placementKeys.detail(placement.id), placement);
        queryClient.setQueryData<Placement[]>(
          placementKeys.scene(boardId),
          (scene) =>
            scene?.map((item) => (item.id === placement.id ? placement : item)),
        );
        await options?.onSuccess?.(placement, ...args);
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
