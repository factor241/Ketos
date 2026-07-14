import type { UseMutationResult } from "@tanstack/react-query";
import type { useMutationFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";

interface IPostRenameFile {
  id: string;
  name: string;
}

export const usePostRenameFileV2: useMutationFunctionType<
  undefined,
  IPostRenameFile,
  unknown,
  Error
> = (options?) => {
  const { mutate, queryClient } = UseRequestProcessor();

  const postRenameFileFn = async (
    payload: IPostRenameFile,
  ): Promise<unknown> => {
    const response = await api.put<unknown>(
      `${getURL("FILE_MANAGEMENT", { id: payload.id }, true)}?name=${encodeURI(payload.name)}`,
    );

    return response.data;
  };

  const mutation: UseMutationResult<unknown, Error, IPostRenameFile> = mutate(
    ["usePostRenameFileV2"],
    async (payload: IPostRenameFile) => {
      const res = await postRenameFileFn(payload);
      return res;
    },
    {
      onSettled: (data, error, variables, onMutateResult, context) => {
        queryClient.invalidateQueries({
          queryKey: ["useGetFilesV2"],
        });
        options?.onSettled?.(data, error, variables, onMutateResult, context);
      },
      ...options,
    },
  );

  return mutation;
};
