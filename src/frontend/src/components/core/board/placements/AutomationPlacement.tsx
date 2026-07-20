import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Placement } from "@/types/board";
import type { AutomationSummary } from "@/types/flow/automation";

import { BoardCardFrame } from "../BoardCardFrame";
import {
  ExecutionStatus,
  type RunAutomationPresentation,
} from "../executions/ExecutionStatus";
import { AutomationPreview } from "./AutomationPreview";

export type AutomationPlacementState =
  | { status: "loading" }
  | { status: "ready"; summary: AutomationSummary }
  | { status: "missing" }
  | { status: "error" };

type BoardCardFrameProps = ComponentProps<typeof BoardCardFrame>;

export interface AutomationExecutionControls {
  actionsEnabled: boolean;
  presentation: RunAutomationPresentation | undefined;
  isSubmitting: boolean;
  actionPending: boolean;
  requestRejected: boolean;
  run: () => void;
  cancel: () => void;
  checkStatus: () => void;
  runAgain: () => void;
  openResult: () => void;
}

export interface AutomationPlacementProps {
  placement: Placement;
  selected: boolean;
  state: AutomationPlacementState;
  editHref: string;
  onRetry: () => void;
  onDisplayStateChange: BoardCardFrameProps["onDisplayStateChange"];
  onClosePlacement: BoardCardFrameProps["onClosePlacement"];
  onDeleteEntity?: BoardCardFrameProps["onRequestDeleteEntity"];
  onResizeEnd: BoardCardFrameProps["onResizeEnd"];
  onKeyboardMove?: BoardCardFrameProps["onKeyboardMove"];
  onKeyboardResize?: BoardCardFrameProps["onKeyboardResize"];
  execution?: AutomationExecutionControls;
}

export function AutomationPlacement({
  placement,
  selected,
  state,
  editHref,
  onRetry,
  onDisplayStateChange,
  onClosePlacement,
  onDeleteEntity,
  onResizeEnd,
  onKeyboardMove,
  onKeyboardResize,
  execution,
}: AutomationPlacementProps) {
  const { t } = useTranslation();
  const validSummary =
    state.status === "ready" && state.summary.id === placement.targetId
      ? state.summary
      : null;
  const effectiveStatus =
    state.status === "ready" && validSummary === null
      ? "missing"
      : state.status;

  return (
    <BoardCardFrame
      title={validSummary?.name ?? t("board.automation.title")}
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
        deleteEntity: t("board.automation.delete"),
      }}
      onDisplayStateChange={onDisplayStateChange}
      onClosePlacement={onClosePlacement}
      onRequestDeleteEntity={onDeleteEntity}
      onResizeEnd={onResizeEnd}
      onKeyboardMove={onKeyboardMove}
      onKeyboardResize={onKeyboardResize}
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        {effectiveStatus === "loading" ? (
          <div
            role="status"
            aria-label={t("board.automation.loading")}
            className="space-y-3"
          >
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : null}

        {effectiveStatus === "ready" && validSummary !== null ? (
          <>
            <div className="[&>section>h3]:hidden">
              <AutomationPreview summary={validSummary} />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <Button asChild variant="outline" ignoreTitleCase>
                <a href={editHref}>{t("board.automation.edit")}</a>
              </Button>
              {execution?.actionsEnabled && !execution.presentation ? (
                <Button
                  type="button"
                  disabled={execution.actionPending}
                  loading={execution.isSubmitting}
                  ignoreTitleCase
                  onClick={execution.run}
                >
                  {t("board.automation.run")}
                </Button>
              ) : null}
            </div>
            {execution?.requestRejected ? (
              <p role="alert" className="text-xs text-destructive">
                {t("board.execution.requestRejected")}
              </p>
            ) : null}
            {execution?.presentation ? (
              <ExecutionStatus
                execution={execution.presentation}
                actionPending={execution.actionPending}
                actionsEnabled={execution.actionsEnabled}
                onCancel={execution.cancel}
                onCheckStatus={execution.checkStatus}
                onRunAgain={execution.runAgain}
                onOpenResult={execution.openResult}
              />
            ) : null}
          </>
        ) : null}

        {effectiveStatus === "missing" ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("board.automation.missing")}
          </p>
        ) : null}

        {effectiveStatus === "error" ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("board.automation.loadError")}
            </p>
            <Button
              type="button"
              variant="outline"
              ignoreTitleCase
              onClick={onRetry}
            >
              {t("board.automation.retry")}
            </Button>
          </div>
        ) : null}
      </div>
    </BoardCardFrame>
  );
}

export default AutomationPlacement;
