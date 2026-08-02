export type RestoreFlowSnapshotInput = {
  proposalId: string;
  idempotencyKey: string;
  expectedFlowRevision: number;
};

export type CommandProposalResult = {
  id: string;
  sourceKind: "ai_run" | "server_restore";
  sourceProposalId: string | null;
  flowId: string;
  status:
    | "proposed"
    | "awaiting_confirmation"
    | "applied"
    | "rejected"
    | "stale"
    | "failed";
  pinnedFlowVersionId: string | null;
  outcome: Record<string, unknown> | null;
};
