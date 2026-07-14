import type { UseQueryResult } from "@tanstack/react-query";
import type { useQueryFunctionType } from "@/types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";

export interface IngestionJobStatusResponse {
  job_id: string;
  status: string;
  created_at: string | null;
  finished_at: string | null;
}

interface GetIngestionJobStatusParams {
  job_id: string | null;
}

function hasIngestionStatus(
  value: unknown,
): value is Pick<IngestionJobStatusResponse, "status"> {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof value.status === "string"
  );
}

export const useGetIngestionJobStatus: useQueryFunctionType<
  GetIngestionJobStatusParams,
  IngestionJobStatusResponse
> = (params, options?) => {
  const { query } = UseRequestProcessor();

  const getStatusFn = async (): Promise<IngestionJobStatusResponse> => {
    const url = `${getURL("KNOWLEDGE_BASES")}/jobs/${params?.job_id}`;
    const res = await api.get(url);
    return res.data;
  };

  const queryResult: UseQueryResult<IngestionJobStatusResponse, Error> = query(
    ["useGetIngestionJobStatus", params?.job_id],
    getStatusFn,
    {
      enabled: !!params?.job_id,
      refetchInterval: (query) => {
        const data = query.state.data;
        if (
          hasIngestionStatus(data) &&
          ["completed", "failed", "cancelled"].includes(data.status)
        ) {
          return false;
        }
        return 6000;
      },
      refetchOnWindowFocus: false,
      ...options,
    },
  );

  return queryResult;
};
