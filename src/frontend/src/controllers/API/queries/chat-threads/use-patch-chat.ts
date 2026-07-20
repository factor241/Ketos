import type { useMutationFunctionType } from "@/types/api";
import type { ChatPatchInput, ChatThread } from "@/types/chat";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { chatThreadKeys } from "./keys";
import { type ChatThreadWire, chatPatchPayload, mapChatThread } from "./wire";

export const usePatchChat: useMutationFunctionType<
  undefined,
  ChatPatchInput,
  ChatThread
> = (options) => {
  const { mutate, queryClient } = UseRequestProcessor();
  return mutate(
    chatThreadKeys.all,
    async (input) =>
      mapChatThread(
        (
          await api.patch<ChatThreadWire>(
            `${getURL("CHAT_THREADS")}/${input.chatId}`,
            chatPatchPayload(input),
          )
        ).data,
      ),
    {
      ...options,
      retry: false,
      onSuccess: async (chat, ...args) => {
        queryClient.setQueryData(chatThreadKeys.detail(chat.id), chat);
        await queryClient.invalidateQueries({
          queryKey: chatThreadKeys.project(chat.projectId),
        });
        await options?.onSuccess?.(chat, ...args);
      },
    },
  );
};
