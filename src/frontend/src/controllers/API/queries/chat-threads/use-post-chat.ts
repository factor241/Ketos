import type { useMutationFunctionType } from "@/types/api";
import type { ChatCreateInput, ChatThread } from "@/types/chat";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { chatThreadKeys } from "./keys";
import { type ChatThreadWire, chatCreatePayload, mapChatThread } from "./wire";

export const usePostChat: useMutationFunctionType<
  { projectId: string },
  ChatCreateInput,
  ChatThread
> = ({ projectId }, options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    chatThreadKeys.project(projectId),
    async (input) =>
      mapChatThread(
        (
          await api.post<ChatThreadWire>(
            `${getURL("PROJECTS")}/${projectId}/chats`,
            chatCreatePayload(input),
          )
        ).data,
      ),
    {
      ...options,
      retry: false,
      onSuccess: async (chat, ...args) => {
        queryClient.setQueryData(chatThreadKeys.detail(chat.id), chat);
        await queryClient.invalidateQueries({
          queryKey: chatThreadKeys.project(projectId),
        });
        await options?.onSuccess?.(chat, ...args);
      },
    },
  );
};
