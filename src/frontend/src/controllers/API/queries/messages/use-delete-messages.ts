import type { UseMutationResult } from "@tanstack/react-query";
import type { useMutationFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";

interface DeleteMessagesParams {
  ids: string[];
}

export const useDeleteMessages: useMutationFunctionType<
  undefined,
  DeleteMessagesParams,
  unknown,
  Error
> = (options?) => {
  const { mutate, queryClient } = UseRequestProcessor();

  const deleteMessage = async ({
    ids,
  }: DeleteMessagesParams): Promise<unknown> => {
    const response = await api.delete(`${getURL("MESSAGES")}`, {
      data: ids,
    });

    return response.data;
  };

  const mutation: UseMutationResult<unknown, Error, DeleteMessagesParams> =
    mutate(["useDeleteMessages"], deleteMessage, {
      ...options,
      onSettled: (data, error, variables, onMutateResult, context) => {
        queryClient.invalidateQueries({
          queryKey: ["useGetSessionsFromFlowQuery"],
        });
        options?.onSettled?.(data, error, variables, onMutateResult, context);
      },
    });

  return mutation;
};
