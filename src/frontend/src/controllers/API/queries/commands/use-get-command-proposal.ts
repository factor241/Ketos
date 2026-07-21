import type { useQueryFunctionType } from "@/types/api";
import { api } from "../../api";
import { UseRequestProcessor } from "../../services/request-processor";
import type { CommandProposalResult } from "./types";

export const useGetCommandProposal: useQueryFunctionType<
  { proposalId: string },
  CommandProposalResult
> = ({ proposalId }, options) => {
  const { query } = UseRequestProcessor();
  return query(
    ["useGetCommandProposal", proposalId],
    async () =>
      (
        await api.get<CommandProposalResult>(
          `/api/v1/command-proposals/${proposalId}`,
        )
      ).data,
    {
      ...options,
      enabled: Boolean(proposalId) && (options?.enabled ?? true),
      retry: false,
    },
  );
};
