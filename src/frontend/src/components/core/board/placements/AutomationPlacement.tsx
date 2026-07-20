import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Placement } from "@/types/board";
import type { AutomationSummary } from "@/types/flow/automation";

import { BoardCardFrame } from "../BoardCardFrame";

export type AutomationPlacementState =
  | { status: "loading" }
  | { status: "ready"; summary: AutomationSummary }
  | { status: "missing" }
  | { status: "error" };

type BoardCardFrameProps = ComponentProps<typeof BoardCardFrame>;

export interface AutomationPlacementProps {
  placement: Placement;
  selected: boolean;
  state: AutomationPlacementState;
  editHref: string;
  onRetry: () => void;
  onDisplayStateChange: BoardCardFrameProps["onDisplayStateChange"];
  onClosePlacement: BoardCardFrameProps["onClosePlacement"];
  onDeleteEntity: BoardCardFrameProps["onRequestDeleteEntity"];
  onResizeEnd: BoardCardFrameProps["onResizeEnd"];
  onKeyboardMove?: BoardCardFrameProps["onKeyboardMove"];
  onKeyboardResize?: BoardCardFrameProps["onKeyboardResize"];
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
  const runExplanationId = `automation-run-explanation-${placement.id}`;

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
      <div className="flex h-full min-h-0 flex-col gap-4">
        {effectiveStatus === "loading" ? (
          <div
            role="status"
            aria-label={t("board.automation.title")}
            className="space-y-3"
          >
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : null}

        {effectiveStatus === "ready" && validSummary !== null ? (
          <>
            <p className="min-h-0 flex-1 overflow-auto text-sm text-muted-foreground">
              {validSummary.description ||
                t("board.automation.descriptionEmpty")}
            </p>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button asChild variant="outline" ignoreTitleCase>
                <a href={editHref}>{t("board.automation.edit")}</a>
              </Button>
              <Button
                type="button"
                disabled
                ignoreTitleCase
                aria-describedby={runExplanationId}
              >
                {t("board.automation.run")}
              </Button>
            </div>
            <p id={runExplanationId} className="text-xs text-muted-foreground">
              {t("board.automation.runAvailableInNextStage")}
            </p>
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
