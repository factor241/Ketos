import type { useQueryFunctionType } from "@/types/api";
import type { Placement } from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { placementKeys } from "./keys";
import { mapPlacement, type PlacementWire } from "./wire";

export const useGetBoardPlacements: useQueryFunctionType<
  { boardId: string },
  Placement[]
> = ({ boardId }, options) => {
  const { query } = UseRequestProcessor();
  return query(
    placementKeys.scene(boardId),
    async () =>
      (
        await api.get<PlacementWire[]>(
          `${getURL("BOARDS")}/${boardId}/placements`,
        )
      ).data.map(mapPlacement),
    {
      ...options,
      enabled: Boolean(boardId) && (options?.enabled ?? true),
    },
  );
};
