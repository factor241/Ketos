import { type Ref, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  useGetProjectChats,
  usePatchChat,
  usePostChat,
} from "@/controllers/API/queries/chat-threads";
import type { ChatContextPolicy, ChatThread } from "@/types/chat";

function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, []);
  return online;
}

export interface ChatListProps {
  projectId: string;
  createDefaults: {
    provider: string;
    modelName: string;
    contextPolicy: ChatContextPolicy;
  } | null;
  onOpen: (chat: ChatThread) => void | Promise<void>;
  onCreate?: (chat: ChatThread) => void;
  actionRef?: Ref<HTMLButtonElement>;
}

export function ChatList({
  projectId,
  createDefaults,
  onOpen,
  onCreate,
  actionRef,
}: ChatListProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const online = useOnlineStatus();
  const query = useGetProjectChats(
    { projectId, q: search },
    { enabled: online },
  );
  const creating = useRef(false);
  const opening = useRef<Set<string>>(new Set());
  const create = usePostChat({ projectId });
  const patch = usePatchChat();

  const createChat = async () => {
    if (creating.current || create.isPending || !createDefaults) return;
    creating.current = true;
    try {
      const chat = await create.mutateAsync({
        title: t("chat.defaultTitle"),
        ...createDefaults,
      });
      onCreate?.(chat);
      await onOpen(chat);
    } finally {
      creating.current = false;
    }
  };
  const openChat = async (chat: ChatThread) => {
    if (opening.current.has(chat.id)) return;
    opening.current.add(chat.id);
    try {
      await onOpen(chat);
    } finally {
      opening.current.delete(chat.id);
    }
  };
  const renameChat = (chat: ChatThread) => {
    const title = window
      .prompt(t("chat.actions.renamePrompt"), chat.title)
      ?.trim();
    if (!title || title === chat.title || patch.isPending) return;
    patch.mutate({
      chatId: chat.id,
      expectedRevision: chat.revision,
      title,
    });
  };
  const rows = query.data ?? [];

  return (
    <section
      aria-label={t("chat.list.label")}
      className="flex min-h-0 flex-col gap-3 bg-background p-3 text-foreground"
    >
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span>{t("chat.search.label")}</span>
          <input
            type="search"
            className="rounded-md border border-input bg-background px-3 py-2 text-foreground"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Button
          ref={actionRef}
          type="button"
          disabled={create.isPending || !createDefaults}
          onClick={() => void createChat()}
        >
          {t("chat.actions.create")}
        </Button>
      </div>
      {!online ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("chat.states.reconnect")}
        </p>
      ) : null}
      {query.isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("chat.states.loading")}
        </p>
      ) : query.isError ? (
        <div role="alert" className="flex items-center gap-2 text-destructive">
          <span>{t("chat.states.error")}</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("chat.actions.retry")}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(search.trim() ? "chat.states.noResults" : "chat.states.empty")}
        </p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-2 overflow-auto">
          {rows.map((chat) => (
            <li
              key={chat.id}
              className="flex items-center gap-2 rounded-md border border-border p-2"
            >
              <Button
                type="button"
                variant="ghost"
                className="min-w-0 flex-1 justify-start truncate"
                onClick={() => void openChat(chat)}
              >
                {chat.title}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => renameChat(chat)}
              >
                {t("chat.actions.rename")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default ChatList;
