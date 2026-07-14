import type { UseMutationResult } from "@tanstack/react-query";
import type { Users, useMutationFunctionType } from "../../../../types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";

interface getUsersQueryParams {
  skip: number;
  limit: number;
  search?: string;
}

export const useGetUsers: useMutationFunctionType<
  undefined,
  getUsersQueryParams,
  Users[],
  Error
> = (options?) => {
  const { mutate } = UseRequestProcessor();

  async function getUsers({
    skip,
    limit,
    search,
  }: getUsersQueryParams): Promise<Array<Users>> {
    let url = `${getURL("USERS")}/?skip=${skip}&limit=${limit}`;
    if (search) {
      url += `&search=${encodeURIComponent(search)}`;
    }
    const res = await api.get(url);
    if (res.status === 200) {
      return res.data;
    }
    return [];
  }

  const mutation: UseMutationResult<Users[], Error, getUsersQueryParams> =
    mutate(["useGetUsers"], getUsers, options);

  return mutation;
};
