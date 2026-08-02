import type { UseMutationResult } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { useMutationFunctionType } from "@/types/api";
import type { MCPServerType } from "@/types/mcp";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { extractApiErrorMessage } from "../../helpers/extract-api-error-message";
import { UseRequestProcessor } from "../../services/request-processor";
import {
  getMcpSuccessMessage,
  type McpSuccessTranslator,
} from "./mcp-success-messages";

interface DeleteMCPServerResponse {
  message: string;
}

interface DeleteMCPServerType {
  name: string;
}

export const useDeleteMCPServer: useMutationFunctionType<
  undefined,
  DeleteMCPServerType,
  DeleteMCPServerResponse
> = (options?) => {
  const { t } = useTranslation();
  const { mutate, queryClient } = UseRequestProcessor();

  async function deleteMCPServer(
    payload: MCPServerType,
  ): Promise<DeleteMCPServerResponse> {
    try {
      const res = await api.delete(
        `${getURL("MCP_SERVERS", undefined, true)}/${payload.name}`,
      );

      return {
        message:
          res.data?.message ||
          getMcpSuccessMessage("deleted", t as unknown as McpSuccessTranslator),
      };
    } catch (error: unknown) {
      throw new Error(
        extractApiErrorMessage(
          error as Parameters<typeof extractApiErrorMessage>[0],
          "Failed to delete MCP Server",
          (key, params) => t(key, params),
        ),
      );
    }
  }

  const mutation: UseMutationResult<
    DeleteMCPServerResponse,
    unknown,
    MCPServerType
  > = mutate(["useDeleteMCPServer"], deleteMCPServer, {
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.refetchQueries({
        queryKey: ["useGetMCPServers"],
      });
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });

  return mutation;
};
