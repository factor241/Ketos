import type { useMutationFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";

interface IDeleteBuilds {
  flowId: string;
}

// add types for error handling and success
export const useDeleteBuilds: useMutationFunctionType<
  undefined,
  IDeleteBuilds
> = (options) => {
  const { mutate } = UseRequestProcessor();

  const deleteBuildsFn = async (payload: IDeleteBuilds): Promise<unknown> => {
    const config = {};
    config["params"] = { flow_id: payload.flowId };
    const res = await api.delete<unknown>(`${getURL("BUILDS")}`, config);
    return res.data;
  };

  const mutation = mutate(["useDeleteBuilds"], deleteBuildsFn, options);

  return mutation;
};
