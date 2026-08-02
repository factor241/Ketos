import type { useMutationFunctionType } from "@/types/api";
import type {
  CreateBoardAutomationInput,
  CreateBoardAutomationResult,
} from "@/types/board-command";
import type { AutomationSummary } from "@/types/flow/automation";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { automationSummaryKeys } from "../flows/use-get-automation-summaries";
import { placementKeys } from "../placements";
import { mapPlacement, type PlacementWire } from "../placements/wire";
import { boardKeys } from "./keys";

type AutomationWire = {
  id: string;
  name: string;
  description: string | null;
};

type CreateBoardAutomationWire = {
  automation: AutomationWire;
  placement: PlacementWire;
  idempotency_replayed: boolean;
};

function mapAutomation(wire: AutomationWire): AutomationSummary {
  return {
    id: wire.id,
    name: wire.name,
    description: wire.description,
  };
}

export const useCreateBoardAutomation: useMutationFunctionType<
  { boardId: string; projectId: string },
  CreateBoardAutomationInput,
  CreateBoardAutomationResult
> = ({ boardId, projectId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["board-automation-command", boardId],
    async ({ idempotencyKey, starter, placement }) => {
      const response = await api.post<CreateBoardAutomationWire>(
        `${getURL("BOARDS")}/${boardId}/automations`,
        {
          starter,
          placement: {
            x: placement.x,
            y: placement.y,
            width: placement.width ?? 320,
            height: placement.height ?? 240,
            z_index: placement.zIndex ?? 0,
          },
        },
        { headers: { "Idempotency-Key": idempotencyKey } },
      );
      return {
        automation: mapAutomation(response.data.automation),
        placement: mapPlacement(response.data.placement),
        idempotencyReplayed: response.data.idempotency_replayed,
      };
    },
    {
      ...options,
      retry: false,
      onSuccess: async (result, ...args) => {
        queryClient.setQueryData(
          placementKeys.detail(result.placement.id),
          result.placement,
        );
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: automationSummaryKeys.project(projectId),
          }),
          queryClient.invalidateQueries({
            queryKey: placementKeys.scene(boardId),
          }),
          queryClient.invalidateQueries({
            queryKey: boardKeys.detail(projectId, boardId),
          }),
        ]);
        await options?.onSuccess?.(result, ...args);
      },
    },
  );
};
