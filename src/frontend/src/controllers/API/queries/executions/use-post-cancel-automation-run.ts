import type { useMutationFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { executionQueryKeys } from "./execution-query-keys";
import type { BoardExecution, BoardExecutionDetailScope } from "./types";

export const usePostCancelAutomationRun: useMutationFunctionType<
  BoardExecutionDetailScope,
  void,
  BoardExecution
> = ({ boardId, flowId, jobId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  const detailKey = executionQueryKeys.detail(boardId, flowId, jobId);
  return mutate(
    detailKey,
    async () =>
      (
        await api.post<BoardExecution>(
          `${getURL("BOARDS")}/${encodeURIComponent(boardId)}/automations/${encodeURIComponent(flowId)}/runs/${encodeURIComponent(jobId)}/cancel`,
        )
      ).data,
    {
      ...options,
      retry: false,
      onSuccess: async (execution, ...args) => {
        queryClient.setQueryData(detailKey, execution);
        await queryClient.invalidateQueries({
          queryKey: executionQueryKeys.list(boardId, flowId),
        });
        await options?.onSuccess?.(execution, ...args);
      },
    },
  );
};
