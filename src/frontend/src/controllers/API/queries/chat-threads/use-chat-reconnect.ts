import { useMemo } from "react";

import type { ChatThread } from "@/types/chat";
import { useGetChat } from "./use-get-chat";

export type ChatReconnectPhase =
  | "reconnecting"
  | "restored"
  | "failed_recoverable"
  | "unknown";

export type ChatReconnectResult = {
  phase: ChatReconnectPhase;
  chat: ChatThread | null;
  announcementKey: ChatReconnectAnnouncementKey;
  retry: ReturnType<typeof useGetChat>["refetch"];
};

const ANNOUNCEMENT_KEYS = {
  reconnecting: "chat.states.reconnecting",
  restored: "chat.states.restored",
  failed_recoverable: "chat.states.failedRecoverable",
  unknown: "chat.states.unknown",
} as const satisfies Record<ChatReconnectPhase, string>;
export type ChatReconnectAnnouncementKey =
  (typeof ANNOUNCEMENT_KEYS)[ChatReconnectPhase];

export function useChatReconnect({
  chatId,
}: {
  chatId: string;
}): ChatReconnectResult {
  const query = useGetChat({ chatId });
  return useMemo(() => {
    const exactChat = query.data?.id === chatId ? query.data : null;
    let phase: ChatReconnectPhase;
    if (query.isLoading || query.isFetching) phase = "reconnecting";
    else if (query.isError) phase = "failed_recoverable";
    else if (exactChat) phase = "restored";
    else phase = "unknown";
    return {
      phase,
      chat: exactChat,
      announcementKey: ANNOUNCEMENT_KEYS[phase],
      retry: query.refetch,
    };
  }, [
    chatId,
    query.data,
    query.isError,
    query.isFetching,
    query.isLoading,
    query.refetch,
  ]);
}
