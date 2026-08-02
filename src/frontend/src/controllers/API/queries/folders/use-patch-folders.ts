import type { AddFolderType, FolderType } from "@/pages/MainPage/entities";
import type { useMutationFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";

interface IPatchPatchFolders {
  data: AddFolderType;
  folderId: string;
}

export const usePatchFolders: useMutationFunctionType<
  undefined,
  IPatchPatchFolders,
  FolderType
> = (options?) => {
  const { mutate, queryClient } = UseRequestProcessor();

  const patchFoldersFn = async (
    newFolder: IPatchPatchFolders,
  ): Promise<FolderType> => {
    const payload = {
      name: newFolder.data.name,
      description: newFolder.data.description,
      flows_list: newFolder.data.flows ?? [],
      components_list: newFolder.data.components ?? [],
    };

    const res = await api.patch(
      `${getURL("PROJECTS")}/${newFolder.folderId}`,
      payload,
    );
    return res.data;
  };

  const mutation = mutate(["usePatchFolders"], patchFoldersFn, {
    ...options,
    onSettled: (_data, _error, variables) => {
      queryClient.refetchQueries({ queryKey: ["useGetFolders"] });
      queryClient.refetchQueries({
        queryKey: ["useGetFolder", variables.folderId],
      });
    },
  });

  return mutation;
};
