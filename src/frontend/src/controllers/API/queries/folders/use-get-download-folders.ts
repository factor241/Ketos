import type { UseMutationResult } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import { customGetDownloadTypeFolders } from "@/customization/utils/custom-get-download-folders";
import type { useMutationFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";

interface IGetDownloadFolders {
  folderId: string;
}

export const useGetDownloadFolders: useMutationFunctionType<
  undefined,
  IGetDownloadFolders,
  AxiosResponse<Blob>,
  Error
> = (options?) => {
  const { mutate } = UseRequestProcessor();

  const downloadFoldersFn = async (
    payload: IGetDownloadFolders,
  ): Promise<AxiosResponse<Blob>> => {
    const response = await api.get<Blob>(
      `${getURL("PROJECTS")}/download/${payload.folderId}`,
      customGetDownloadTypeFolders(),
    );
    return response;
  };

  const mutation: UseMutationResult<
    AxiosResponse<Blob>,
    Error,
    IGetDownloadFolders
  > = mutate(["useGetDownloadFolders"], downloadFoldersFn, options);

  return mutation;
};
