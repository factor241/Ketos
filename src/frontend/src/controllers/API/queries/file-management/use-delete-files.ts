import type { UseMutationResult } from "@tanstack/react-query";
import type { useMutationFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";

interface IDeleteFiles {
  ids: string[];
}

interface DeleteFilesResponse {
  message: string;
}

export const useDeleteFilesV2: useMutationFunctionType<
  undefined,
  IDeleteFiles,
  DeleteFilesResponse,
  Error
> = (options?) => {
  const { mutate, queryClient } = UseRequestProcessor();

  const deleteFileFn = async (
    params: IDeleteFiles,
  ): Promise<DeleteFilesResponse> => {
    const response = await api.delete<DeleteFilesResponse>(
      `${getURL("FILE_MANAGEMENT", { mode: "batch/" }, true)}`,
      {
        data: params.ids,
      },
    );

    return response.data;
  };

  const mutation: UseMutationResult<DeleteFilesResponse, Error, IDeleteFiles> =
    mutate(["useDeleteFilesV2"], deleteFileFn, {
      onSettled: (data, error, variables, onMutateResult, context) => {
        queryClient.invalidateQueries({
          queryKey: ["useGetFilesV2"],
        });
        options?.onSettled?.(data, error, variables, onMutateResult, context);
      },
      ...options,
    });

  return mutation;
};
