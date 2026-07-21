import type { useMutationFunctionType } from "@/types/api";
import { api } from "../../api";
import { UseRequestProcessor } from "../../services/request-processor";
import type { CommandProposalResult, RestoreFlowSnapshotInput } from "./types";

export const useRestoreFlowSnapshot: useMutationFunctionType<
  undefined,
  RestoreFlowSnapshotInput,
  CommandProposalResult
> = (options) => {
  const { mutate } = UseRequestProcessor();
  return mutate(
    ["useRestoreFlowSnapshot"],
    async ({ proposalId, idempotencyKey, expectedFlowRevision }) =>
      (
        await api.post<CommandProposalResult>(
          `/api/v1/command-proposals/${proposalId}/restore`,
          {
            idempotency_key: idempotencyKey,
            expected_flow_revision: expectedFlowRevision,
          },
        )
      ).data,
    { ...options, retry: false },
  );
};
