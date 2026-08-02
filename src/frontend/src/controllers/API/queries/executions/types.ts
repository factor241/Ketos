import type { UseQueryResult } from "@tanstack/react-query";

export type BoardExecutionStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type BoardExecutionReason =
  | "enqueue_failed"
  | "execution_failed"
  | "timed_out"
  | "user_cancelled"
  | "system_cancelled"
  | "backend_restarted"
  | null;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type BoardExecutionResult =
  | { kind: "text"; value: string; truncated: boolean }
  | { kind: "json"; value: JsonValue; truncated: boolean };

export interface BoardExecution {
  job_id: string;
  board_id: string;
  flow_id: string;
  status: BoardExecutionStatus;
  reason: BoardExecutionReason;
  created_timestamp: string;
  finished_timestamp: string | null;
  result: BoardExecutionResult | null;
}

export interface UnknownBoardExecutionPresentation {
  status: "unknown";
  lastKnown: BoardExecution;
}

export type BoardExecutionPresentation =
  | BoardExecution
  | UnknownBoardExecutionPresentation;

export type BoardExecutionQueryResult = UseQueryResult<
  BoardExecution,
  Error
> & {
  presentation: BoardExecutionPresentation | undefined;
};

export interface BoardExecutionScope {
  boardId: string;
  flowId: string;
}

export interface BoardExecutionDetailScope extends BoardExecutionScope {
  jobId: string;
}

export interface PostAutomationRunVariables {
  idempotencyKey: string;
}
