import type { useMutationFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { executionQueryKeys } from "./execution-query-keys";
import type {
  BoardExecution,
  BoardExecutionScope,
  PostAutomationRunVariables,
} from "./types";

function runsUrl({ boardId, flowId }: BoardExecutionScope): string {
  return `${getURL("BOARDS")}/${encodeURIComponent(boardId)}/automations/${encodeURIComponent(flowId)}/runs`;
}

export const usePostAutomationRun: useMutationFunctionType<
  BoardExecutionScope,
  PostAutomationRunVariables,
  BoardExecution
> = (scope, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    executionQueryKeys.list(scope.boardId, scope.flowId),
    async ({ idempotencyKey }: PostAutomationRunVariables) =>
      (
        await api.post<BoardExecution>(runsUrl(scope), {
          idempotency_key: idempotencyKey,
        })
      ).data,
    {
      ...options,
      onSuccess: async (execution, ...args) => {
        queryClient.setQueryData(
          executionQueryKeys.detail(
            scope.boardId,
            scope.flowId,
            execution.job_id,
          ),
          execution,
        );
        await queryClient.invalidateQueries({
          queryKey: executionQueryKeys.list(scope.boardId, scope.flowId),
        });
        await options?.onSuccess?.(execution, ...args);
      },
    },
  );
};
