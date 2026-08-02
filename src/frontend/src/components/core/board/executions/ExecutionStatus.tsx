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
  const reason =
    status === "queued"
      ? t("board.execution.reason.waitingToStart")
      : status === "running"
        ? t("board.execution.reason.flowRunning")
        : status === "succeeded"
          ? t("board.execution.reason.resultReady")
          : status === "failed"
            ? execution.reason === "enqueue_failed"
              ? t("board.execution.reason.enqueueFailed")
              : execution.reason === "timed_out"
                ? t("board.execution.reason.timedOut")
                : execution.reason === "backend_restarted"
                  ? t("board.execution.reason.backendRestarted")
                  : t("board.execution.reason.executionFailed")
            : status === "cancelled"
              ? execution.reason === "user_cancelled"
                ? t("board.execution.reason.cancelledByUser")
                : execution.reason === "system_cancelled"
                  ? t("board.execution.reason.cancelledBySystem")
                  : execution.reason === "backend_restarted"
                    ? t("board.execution.reason.backendRestarted")
                    : t("board.execution.reason.cancelled")
              : t("board.execution.reason.noAuthoritativeResponse");
  const label =
    status === "queued"
      ? t("board.execution.status.queued")
      : status === "running"
        ? t("board.execution.status.running")
        : status === "succeeded"
          ? t("board.execution.status.succeeded")
          : status === "failed"
            ? t("board.execution.status.failed")
            : status === "cancelled"
              ? t("board.execution.status.cancelled")
              : t("board.execution.status.unknown");
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
          <span className="block font-medium text-foreground">{label}</span>
          <span className="block text-xs text-muted-foreground">{reason}</span>
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
