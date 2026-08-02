import type { Edge, Node } from "@xyflow/react";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import {
  customGetAppVersions,
  customGetLatestVersion,
} from "@/customization/utils/custom-get-app-latest-version";
import { getBaseUrl } from "@/customization/utils/urls";
import { api } from "../../controllers/API/api";
import type {
  VertexBuildTypeAPI,
  VerticesOrderTypeAPI,
} from "../../types/api/index";

export const getAppVersions = customGetAppVersions;
export const getLatestVersion = customGetLatestVersion;

export async function createApiKey(name: string, expiresAt?: string | null) {
  try {
    const payload: { name: string; expires_at?: string } = { name };
    if (expiresAt) {
      payload.expires_at = expiresAt;
    }
    const res = await api.post(`${getBaseUrl()}api_key/`, payload);
    if (res.status === 200) {
      return res.data;
    }
  } catch (error) {
    throw error;
  }
}

export async function getVerticesOrder(
  flowId: string,
  startNodeId?: string | null,
  stopNodeId?: string | null,
  nodes?: Node[],
  Edges?: Edge[],
): Promise<AxiosResponse<VerticesOrderTypeAPI>> {
  // nodeId is optional and is a query parameter
  // if nodeId is not provided, the API will return all vertices
  const config: AxiosRequestConfig = {};
  if (stopNodeId) {
    config["params"] = { stop_component_id: stopNodeId };
  } else if (startNodeId) {
    config["params"] = { start_component_id: startNodeId };
  }
  const data = {
    data: {},
  };
  if (nodes && Edges) {
    data["data"]["nodes"] = nodes;
    data["data"]["edges"] = Edges;
  }
  return await api.post(
    `${getBaseUrl()}build/${flowId}/vertices`,
    data,
    config,
  );
}

export async function postBuildVertex(
  flowId: string,
  vertexId: string,
  input_value: string,
  files?: string[],
): Promise<AxiosResponse<VertexBuildTypeAPI>> {
  // input_value is optional and is a query parameter
  const data = {};
  if (typeof input_value !== "undefined") {
    data["inputs"] = {
      input_value: input_value,
      client_request_time: Date.now(), // Add client timestamp in milliseconds
    };
  }
  if (data && files) {
    data["files"] = files;
  }
  return await api.post(
    `${getBaseUrl()}build/${flowId}/vertices/${vertexId}`,
    data,
  );
}
