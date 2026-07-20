import {
  Ban,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CloudOff,
  LoaderCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type {
  BoardExecution,
  BoardExecutionPresentation,
  BoardExecutionReason,
} from "@/controllers/API/queries/executions";

export type RunAutomationPresentation =
  | BoardExecutionPresentation
  | { status: "unknown"; lastKnown: BoardExecution | null };

export interface ExecutionStatusProps {
  execution: RunAutomationPresentation;
  actionPending?: boolean;
  actionsEnabled?: boolean;
  onCancel: () => void;
  onCheckStatus: () => void;
  onRunAgain: () => void;
  onOpenResult: () => void;
}

type ExecutionStatusKey =
  | "board.execution.status.queued"
  | "board.execution.status.running"
  | "board.execution.status.succeeded"
  | "board.execution.status.failed"
  | "board.execution.status.cancelled"
  | "board.execution.status.unknown";

type ExecutionReasonKey =
  | "board.execution.reason.waitingToStart"
  | "board.execution.reason.flowRunning"
  | "board.execution.reason.resultReady"
  | "board.execution.reason.enqueueFailed"
  | "board.execution.reason.timedOut"
  | "board.execution.reason.backendRestarted"
  | "board.execution.reason.executionFailed"
  | "board.execution.reason.cancelledByUser"
  | "board.execution.reason.cancelledBySystem"
  | "board.execution.reason.cancelled"
  | "board.execution.reason.noAuthoritativeResponse";

function failedReasonKey(reason: BoardExecutionReason): ExecutionReasonKey {
  switch (reason) {
    case "enqueue_failed":
      return "board.execution.reason.enqueueFailed";
    case "timed_out":
      return "board.execution.reason.timedOut";
    case "backend_restarted":
      return "board.execution.reason.backendRestarted";
    default:
      return "board.execution.reason.executionFailed";
  }
}

function cancelledReasonKey(reason: BoardExecutionReason): ExecutionReasonKey {
  if (reason === "user_cancelled")
    return "board.execution.reason.cancelledByUser";
  if (reason === "system_cancelled")
    return "board.execution.reason.cancelledBySystem";
  if (reason === "backend_restarted")
    return "board.execution.reason.backendRestarted";
  return "board.execution.reason.cancelled";
}

function statusLabelKey(
  status: RunAutomationPresentation["status"],
): ExecutionStatusKey {
  switch (status) {
    case "queued":
      return "board.execution.status.queued";
    case "running":
      return "board.execution.status.running";
    case "succeeded":
      return "board.execution.status.succeeded";
    case "failed":
      return "board.execution.status.failed";
    case "cancelled":
      return "board.execution.status.cancelled";
    default:
      return "board.execution.status.unknown";
  }
}

export function ExecutionStatus({
  execution,
  actionPending = false,
  actionsEnabled = true,
  onCancel,
  onCheckStatus,
  onRunAgain,
  onOpenResult,
}: ExecutionStatusProps) {
  const { t } = useTranslation();
  const status = execution.status;
  const reason: ExecutionReasonKey =
    status === "queued"
      ? "board.execution.reason.waitingToStart"
      : status === "running"
        ? "board.execution.reason.flowRunning"
        : status === "succeeded"
          ? "board.execution.reason.resultReady"
          : status === "failed"
            ? failedReasonKey(execution.reason)
            : status === "cancelled"
              ? cancelledReasonKey(execution.reason)
              : "board.execution.reason.noAuthoritativeResponse";
  const label = statusLabelKey(status);
  const icon =
    status === "queued" ? (
      <Clock3 aria-hidden="true" />
    ) : status === "running" ? (
      <LoaderCircle aria-hidden="true" className="animate-spin" />
    ) : status === "succeeded" ? (
      <CheckCircle2 aria-hidden="true" />
    ) : status === "failed" ? (
      <CircleAlert aria-hidden="true" />
    ) : status === "cancelled" ? (
      <Ban aria-hidden="true" />
    ) : (
      <CloudOff aria-hidden="true" />
    );

  return (
    <div
      data-execution-status={status}
      className="space-y-2 border-t border-border pt-2"
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="flex items-start gap-2 text-sm"
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
        <span className="min-w-0">
          <span className="block font-medium text-foreground">{t(label)}</span>
          <span className="block text-xs text-muted-foreground">
            {t(reason)}
          </span>
        </span>
      </div>
      {actionsEnabled ? (
        <div className="flex flex-wrap gap-2">
          {status === "queued" || status === "running" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={actionPending}
              onClick={onCancel}
              ignoreTitleCase
            >
              {t("board.execution.action.cancel")}
            </Button>
          ) : null}
          {status === "succeeded" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={actionPending}
              onClick={onOpenResult}
              ignoreTitleCase
            >
              {t("board.execution.action.openResult")}
            </Button>
          ) : null}
          {status === "failed" || status === "cancelled" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={actionPending}
              onClick={onRunAgain}
              ignoreTitleCase
            >
              {t("board.execution.action.runAgain")}
            </Button>
          ) : null}
          {status === "unknown" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={actionPending}
              onClick={onCheckStatus}
              ignoreTitleCase
            >
              {t("board.execution.action.checkStatus")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ExecutionStatus;
