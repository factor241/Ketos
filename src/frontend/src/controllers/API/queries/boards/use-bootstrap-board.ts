import type { useMutationFunctionType } from "@/types/api";
import type { BoardRead } from "@/types/board";
import type {
  BootstrapBoardInput,
  BootstrapBoardResult,
} from "@/types/board-command";
import type { AutomationSummary } from "@/types/flow/automation";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { automationSummaryKeys } from "../flows/use-get-automation-summaries";
import { mapPlacement, type PlacementWire } from "../placements/wire";
import { boardKeys } from "./keys";

type AutomationWire = AutomationSummary;
type BootstrapBoardWire = {
  board: BoardRead;
  automation: AutomationWire | null;
  placement: PlacementWire | null;
  idempotency_replayed: boolean;
};

export const useBootstrapBoard: useMutationFunctionType<
  { projectId: string },
  BootstrapBoardInput,
  BootstrapBoardResult
> = ({ projectId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    ["board-bootstrap-command", projectId],
    async ({ title, starter, idempotencyKey }) => {
      const response = await api.post<BootstrapBoardWire>(
        `${getURL("PROJECTS")}/${projectId}/boards/bootstrap`,
        { title, starter },
        { headers: { "Idempotency-Key": idempotencyKey } },
      );
      return {
        board: response.data.board,
        automation: response.data.automation,
        placement: response.data.placement
          ? mapPlacement(response.data.placement)
          : null,
        idempotencyReplayed: response.data.idempotency_replayed,
      };
    },
    {
      ...options,
      retry: false,
      onSuccess: async (result, ...args) => {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: boardKeys.list(projectId),
          }),
          queryClient.invalidateQueries({
            queryKey: automationSummaryKeys.project(projectId),
          }),
        ]);
        await options?.onSuccess?.(result, ...args);
      },
    },
  );
};
