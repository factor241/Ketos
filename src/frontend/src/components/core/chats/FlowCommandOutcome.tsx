import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { CommandProposalResult } from "@/controllers/API/queries/commands";
import {
  useGetCommandProposal,
  useRestoreFlowSnapshot,
} from "@/controllers/API/queries/commands";

export type FlowCommandOutcomeProps = Readonly<{ proposalId: string }>;

const TERMINAL_STATUSES = new Set<CommandProposalResult["status"]>([
  "applied",
  "rejected",
  "stale",
  "failed",
]);

export function FlowCommandOutcome({ proposalId }: FlowCommandOutcomeProps) {
  const { t } = useTranslation();
  const proposal = useGetCommandProposal(
    { proposalId },
    {
      refetchInterval: (query) => {
        const data = query.state.data as CommandProposalResult | undefined;
        return data && TERMINAL_STATUSES.has(data.status) ? false : 250;
      },
      refetchOnWindowFocus: false,
    },
  );
  const [restoreResult, setRestoreResult] =
    useState<CommandProposalResult | null>(null);
  const restore = useRestoreFlowSnapshot({
    onSuccess: setRestoreResult,
  });
  const afterRevision = useMemo(() => {
    const value = proposal.data?.outcome?.afterRevision;
    return typeof value === "number" ? value : null;
  }, [proposal.data?.outcome]);
  const canRestore =
    proposal.data?.status === "applied" &&
    proposal.data.pinnedFlowVersionId !== null &&
    afterRevision !== null;

  if (proposal.isLoading) {
    return <p role="status">{t("flowCommand.outcomeLoading")}</p>;
  }
  if (proposal.isError || !proposal.data) {
    return <p role="alert">{t("flowCommand.outcomeError")}</p>;
  }
  if (restoreResult?.status === "applied") {
    return <p role="status">{t("flowCommand.restored")}</p>;
  }
  const outcomeLabel =
    proposal.data.status === "proposed"
      ? t("flowCommand.outcome.proposed")
      : proposal.data.status === "awaiting_confirmation"
        ? t("flowCommand.outcome.awaiting_confirmation")
        : proposal.data.status === "applied"
          ? t("flowCommand.outcome.applied")
          : proposal.data.status === "rejected"
            ? t("flowCommand.outcome.rejected")
            : proposal.data.status === "stale"
              ? t("flowCommand.outcome.stale")
              : t("flowCommand.outcome.failed");

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-t bg-muted/50 px-3 py-2 text-sm"
      data-testid={`flow-command-outcome-${proposalId}`}
    >
      <span>{outcomeLabel}</span>
      {canRestore ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={restore.isPending}
          disabled={restore.isPending}
          onClick={() =>
            restore.mutate({
              proposalId,
              idempotencyKey: `restore:${proposalId}:${afterRevision}`,
              expectedFlowRevision: afterRevision,
            })
          }
        >
          {restore.isPending
            ? t("flowCommand.restoreBusy")
            : t("flowCommand.restore")}
        </Button>
      ) : null}
      {restore.isError ? (
        <span role="alert" className="text-destructive">
          {t("flowCommand.restoreError")}
        </span>
      ) : null}
    </div>
  );
}

export default FlowCommandOutcome;
