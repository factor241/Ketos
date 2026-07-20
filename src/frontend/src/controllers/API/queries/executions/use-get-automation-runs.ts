import type { useQueryFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { executionQueryKeys } from "./execution-query-keys";
import type { BoardExecution, BoardExecutionScope } from "./types";

interface GetAutomationRunsParams extends BoardExecutionScope {
  limit?: number;
}

function validatedLimit(limit: number | undefined): number | undefined {
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > 50)
  ) {
    throw new RangeError(
      "Board execution list limit must be an integer from 1 to 50",
    );
  }
  return limit;
}

export const useGetAutomationRuns: useQueryFunctionType<
  GetAutomationRunsParams,
  BoardExecution[]
> = ({ boardId, flowId, limit }, options) => {
  const { query } = UseRequestProcessor();
  return query(
    executionQueryKeys.list(boardId, flowId),
    async () => {
      const requestLimit = validatedLimit(limit);
      return (
        await api.get<BoardExecution[]>(
          `${getURL("BOARDS")}/${encodeURIComponent(boardId)}/automations/${encodeURIComponent(flowId)}/runs`,
          requestLimit === undefined
            ? undefined
            : { params: { limit: requestLimit } },
        )
      ).data;
    },
    {
      ...options,
      enabled: Boolean(boardId && flowId) && (options?.enabled ?? true),
    },
  );
};
