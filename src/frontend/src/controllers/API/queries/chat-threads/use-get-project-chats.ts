import type { useQueryFunctionType } from "@/types/api";
import type { ChatThread } from "@/types/chat";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { chatThreadKeys } from "./keys";
import { type ChatThreadWire, mapChatThread } from "./wire";

export interface ProjectChatsParams {
  projectId: string;
  q?: string;
  includeArchived?: boolean;
}

export const useGetProjectChats: useQueryFunctionType<
  ProjectChatsParams,
  ChatThread[]
> = ({ projectId, q = "", includeArchived = false }, options) => {
  const { query } = UseRequestProcessor();
  return query(
    chatThreadKeys.list(projectId, q, includeArchived),
    async () =>
      (
        await api.get<ChatThreadWire[]>(
          `${getURL("PROJECTS")}/${projectId}/chats`,
          {
            params: {
              ...(q.trim() ? { q: q.trim() } : {}),
              include_archived: includeArchived,
            },
          },
        )
      ).data.map(mapChatThread),
    {
      ...options,
      enabled: Boolean(projectId) && (options?.enabled ?? true),
    },
  );
};
