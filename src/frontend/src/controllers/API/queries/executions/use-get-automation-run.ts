import type { UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { executionQueryKeys } from "./execution-query-keys";
import type {
  BoardExecution,
  BoardExecutionDetailScope,
  BoardExecutionPresentation,
  BoardExecutionQueryResult,
} from "./types";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

export const executionRetryDelay = (attemptIndex: number): number =>
  Math.min(1000 * 2 ** attemptIndex, 8000);

export function isTerminalBoardExecution(execution: BoardExecution): boolean {
  return TERMINAL_STATUSES.has(execution.status);
}

function presentationFor(
  data: BoardExecution | undefined,
  error: Error | null,
  failureCount: number,
): BoardExecutionPresentation | undefined {
  if (data && failureCount > 0 && isTransportFailure(error)) {
    return { status: "unknown", lastKnown: data };
  }
  return data;
}

function isTransportFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "isAxiosError" in error &&
    error.isAxiosError === true &&
    (!("response" in error) || error.response === undefined)
  );
}

export function useGetAutomationRun(
  { boardId, flowId, jobId }: BoardExecutionDetailScope,
  options?: Omit<
    UseQueryOptions<BoardExecution, Error>,
    "queryFn" | "queryKey"
  >,
): BoardExecutionQueryResult {
  const { query } = UseRequestProcessor();
  const result = query(
    executionQueryKeys.detail(boardId, flowId, jobId),
    async () =>
      (
        await api.get<BoardExecution>(
          `${getURL("BOARDS")}/${encodeURIComponent(boardId)}/automations/${encodeURIComponent(flowId)}/runs/${encodeURIComponent(jobId)}`,
        )
      ).data,
    {
      ...options,
      enabled:
        Boolean(boardId && flowId && jobId) && (options?.enabled ?? true),
      refetchInterval: (queryState) => {
        const execution = queryState.state.data as BoardExecution | undefined;
        return execution && !isTerminalBoardExecution(execution) ? 1000 : false;
      },
      refetchOnWindowFocus: false,
      retry: (failureCount, error) =>
        failureCount < 3 && isTransportFailure(error),
      retryDelay: executionRetryDelay,
    },
  ) as UseQueryResult<BoardExecution, Error>;

  return {
    ...result,
    presentation: presentationFor(
      result.data,
      result.failureReason ?? result.error,
      result.failureCount,
    ),
  };
}
