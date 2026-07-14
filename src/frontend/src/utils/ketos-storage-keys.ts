export const ketosFlowSessionKey = (flowId: string | undefined): string =>
  `ketos-flow-session-${flowId ?? "unknown"}`;

export const ketosTableStateKey = (tableReference: string): string =>
  `ketos-table-state-${tableReference}`;
