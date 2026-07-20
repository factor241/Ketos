import type { useQueryFunctionType } from "@/types/api";
import type { ChatThread } from "@/types/chat";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { chatThreadKeys } from "./keys";
import { type ChatThreadWire, mapChatThread } from "./wire";

export const useGetChat: useQueryFunctionType<
  { chatId: string },
  ChatThread
> = ({ chatId }, options) => {
  const { query } = UseRequestProcessor();
  return query(
    chatThreadKeys.detail(chatId),
    async () =>
      mapChatThread(
        (await api.get<ChatThreadWire>(`${getURL("CHAT_THREADS")}/${chatId}`))
          .data,
      ),
    {
      ...options,
      enabled: Boolean(chatId) && (options?.enabled ?? true),
    },
  );
};
