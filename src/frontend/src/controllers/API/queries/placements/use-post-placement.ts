import type { useMutationFunctionType } from "@/types/api";
import type { Placement, PlacementCreateInput } from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { placementKeys } from "./keys";
import {
  mapPlacement,
  type PlacementWire,
  placementCreatePayload,
} from "./wire";

export const usePostPlacement: useMutationFunctionType<
  { boardId: string },
  PlacementCreateInput,
  Placement
> = ({ boardId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    placementKeys.all,
    async (input: PlacementCreateInput) =>
      mapPlacement(
        (
          await api.post<PlacementWire>(
            `${getURL("BOARDS")}/${boardId}/placements`,
            placementCreatePayload(input),
          )
        ).data,
      ),
    {
      ...options,
      retry: false,
      onSuccess: async (placement, ...args) => {
        queryClient.setQueryData(placementKeys.detail(placement.id), placement);
        await queryClient.invalidateQueries({
          queryKey: placementKeys.scene(boardId),
        });
        await options?.onSuccess?.(placement, ...args);
      },
    },
  );
};
