import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import type {
  BoardExecution,
  BoardExecutionReason,
  JsonValue,
} from "@/controllers/API/queries/executions";
import type { Placement } from "@/types/board";

import { BoardCardFrame } from "../BoardCardFrame";

const MAX_TEXT_CODEPOINTS = 8192;
const MAX_JSON_CHARACTERS = 24 * 1024;

type BoardCardFrameProps = ComponentProps<typeof BoardCardFrame>;

export interface ResultPlacementProps {
  placement: Placement;
  execution: BoardExecution;
  selected: boolean;
  onDisplayStateChange: BoardCardFrameProps["onDisplayStateChange"];
  onClose: BoardCardFrameProps["onClosePlacement"];
  onResizeEnd: BoardCardFrameProps["onResizeEnd"];
  onKeyboardMove?: BoardCardFrameProps["onKeyboardMove"];
  onKeyboardResize?: BoardCardFrameProps["onKeyboardResize"];
}

function bounded(value: string, limit: number): [string, boolean] {
  const characters = Array.from(value);
  return characters.length > limit
    ? [characters.slice(0, limit).join(""), true]
    : [value, false];
}

function serializeJson(value: JsonValue): [string, boolean] {
  try {
    return bounded(JSON.stringify(value, null, 2), MAX_JSON_CHARACTERS);
  } catch {
    return ["", true];
  }
}

type TerminalStatusKey =
  | "board.execution.status.failed"
  | "board.execution.status.cancelled";

type ResultReasonKey =
  | "board.execution.reason.enqueueFailed"
  | "board.execution.reason.timedOut"
  | "board.execution.reason.cancelledByUser"
  | "board.execution.reason.cancelledBySystem"
  | "board.execution.reason.backendRestarted"
  | "board.execution.reason.executionFailed";

function reasonKey(reason: BoardExecutionReason): ResultReasonKey {
  switch (reason) {
    case "enqueue_failed":
      return "board.execution.reason.enqueueFailed";
    case "timed_out":
      return "board.execution.reason.timedOut";
    case "user_cancelled":
      return "board.execution.reason.cancelledByUser";
    case "system_cancelled":
      return "board.execution.reason.cancelledBySystem";
    case "backend_restarted":
      return "board.execution.reason.backendRestarted";
    default:
      return "board.execution.reason.executionFailed";
  }
}

function terminalStatusKey(status: "failed" | "cancelled"): TerminalStatusKey {
  return status === "failed"
    ? "board.execution.status.failed"
    : "board.execution.status.cancelled";
}

export function ResultPlacement({
  placement,
  execution,
  selected,
  onDisplayStateChange,
  onClose,
  onResizeEnd,
  onKeyboardMove,
  onKeyboardResize,
}: ResultPlacementProps) {
  const { t } = useTranslation();
  const validTarget =
    placement.targetKind === "job_result" &&
    placement.targetId === execution.job_id &&
    placement.boardId === execution.board_id;
  const terminal = ["succeeded", "failed", "cancelled"].includes(
    execution.status,
  );
  let renderedValue = "";
  let clientTruncated = false;
  if (validTarget && execution.status === "succeeded" && execution.result) {
    [renderedValue, clientTruncated] =
      execution.result.kind === "text"
        ? bounded(execution.result.value, MAX_TEXT_CODEPOINTS)
        : serializeJson(execution.result.value);
  }

  return (
    <BoardCardFrame
      title={t("board.result.title")}
      selected={selected}
      displayState={placement.displayState}
      width={placement.width}
      height={placement.height}
      placementRevision={placement.revision}
      labels={{
        collapse: t("board.placement.collapse"),
        expand: t("board.placement.expand"),
        maximize: t("board.placement.maximize"),
        restore: t("board.placement.restore"),
        close: t("board.placement.close"),
        deleteEntity: t("board.result.delete"),
      }}
      onDisplayStateChange={onDisplayStateChange}
      onClosePlacement={onClose}
      onResizeEnd={onResizeEnd}
      onKeyboardMove={onKeyboardMove}
      onKeyboardResize={onKeyboardResize}
    >
      {!validTarget || !terminal ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("board.result.unavailable")}
        </p>
      ) : execution.status === "succeeded" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            {t("board.execution.status.succeeded")}
          </p>
          {execution.result ? (
            <pre
              data-testid="job-result-value"
              className="max-h-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 font-mono text-xs text-foreground"
            >
              {renderedValue}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("board.result.empty")}
            </p>
          )}
          {execution.result?.truncated || clientTruncated ? (
            <p className="text-xs text-muted-foreground">
              {t("board.result.truncated")}
            </p>
          ) : null}
        </div>
      ) : execution.status === "failed" || execution.status === "cancelled" ? (
        <div role="status" className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {t(terminalStatusKey(execution.status))}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(reasonKey(execution.reason))}
          </p>
        </div>
      ) : null}
    </BoardCardFrame>
  );
}

export default ResultPlacement;
