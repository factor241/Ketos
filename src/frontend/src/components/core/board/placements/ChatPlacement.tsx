import { CopilotChat } from "@copilotkit/react-core/v2";
import {
  type ComponentProps,
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useChatReconnect } from "@/controllers/API/queries/chat-threads";
import type { Placement, PlacementDisplayState } from "@/types/board";
import type { ChatThread } from "@/types/chat";
import FlowCommandOutcome from "../../chats/FlowCommandOutcome";
import { useFlowCommandInterrupt } from "../../chats/use-flow-command-interrupt";
import { useThreadScopedCopilotAgent } from "../../chats/use-thread-scoped-copilot-agent";
import { BoardCardFrame } from "../BoardCardFrame";

const CHAT_DRAFT_STORAGE_PREFIX = "ketos.chat.draft.v1:";
const ChatDraftContext = createContext<string | null>(null);

function readStoredDraft(chatId: string): string {
  try {
    return (
      window.sessionStorage.getItem(`${CHAT_DRAFT_STORAGE_PREFIX}${chatId}`) ??
      ""
    );
  } catch {
    return "";
  }
}

function writeStoredDraft(chatId: string, value: string): void {
  try {
    const key = `${CHAT_DRAFT_STORAGE_PREFIX}${chatId}`;
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // The draft is a best-effort, non-authoritative browser convenience.
  }
}

function DraftPreservingChatViewBase(
  props: ComponentProps<typeof CopilotChat.View>,
) {
  const { t } = useTranslation();
  const chatId = useContext(ChatDraftContext);
  if (chatId === null) throw new Error("Chat draft requires a durable chat ID");
  const initialDraftRef = useRef<string | null>(null);
  if (initialDraftRef.current === null)
    initialDraftRef.current = readStoredDraft(chatId);
  const [draft, setDraft] = useState(initialDraftRef.current);
  const [restoredDraft, setRestoredDraft] = useState(
    initialDraftRef.current.length > 0,
  );
  const onInputChange = useCallback(
    (value: string) => {
      writeStoredDraft(chatId, value);
      setDraft(value);
      props.onInputChange?.(value);
    },
    [chatId, props.onInputChange],
  );
  const onSubmitMessage = useCallback(
    (value: string) => {
      if (!props.onSubmitMessage) return;
      props.onSubmitMessage(value);
      writeStoredDraft(chatId, "");
      setDraft("");
      setRestoredDraft(false);
    },
    [chatId, props.onSubmitMessage],
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {restoredDraft ? (
        <p className="px-3 py-1 text-xs text-muted-foreground">
          {t("chat.draft.notSent")}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <CopilotChat.View
          {...props}
          inputValue={draft}
          onInputChange={onInputChange}
          onSubmitMessage={onSubmitMessage}
        />
      </div>
    </div>
  );
}

const DraftPreservingChatView = Object.assign(
  DraftPreservingChatViewBase,
  CopilotChat.View,
);

export interface ChatPlacementProps {
  chat: ChatThread;
  placement: Placement;
  selected: boolean;
  onDisplayStateChange: (state: PlacementDisplayState) => void;
  onClose: () => void;
  onArchive: () => void;
  onResizeEnd: (size: { width: number; height: number }) => void;
  onKeyboardMove?: (delta: { x: number; y: number }) => void;
  onKeyboardResize?: (delta: { width: number; height: number }) => void;
}

function ReadyChat({
  chatId,
  localAgentId,
}: Readonly<{ chatId: string; localAgentId: string }>) {
  const [resolvedProposalIds, setResolvedProposalIds] = useState<string[]>([]);
  const rememberResolvedProposal = useCallback((proposalId: string) => {
    setResolvedProposalIds((current) =>
      current.includes(proposalId) ? current : [...current, proposalId],
    );
  }, []);
  useFlowCommandInterrupt(localAgentId, rememberResolvedProposal);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <ChatDraftContext.Provider value={chatId}>
          <CopilotChat
            key={chatId}
            agentId={localAgentId}
            threadId={chatId}
            chatView={DraftPreservingChatView}
          />
        </ChatDraftContext.Provider>
      </div>
      {resolvedProposalIds.map((proposalId) => (
        <FlowCommandOutcome key={proposalId} proposalId={proposalId} />
      ))}
    </div>
  );
}

function ReconnectedChat({ chatId }: Readonly<{ chatId: string }>) {
  const { t } = useTranslation();
  const binding = useThreadScopedCopilotAgent(chatId);
  if (binding.status === "registering") {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">
          {t("chat.states.connecting")}
        </p>
      </div>
    );
  }
  if (binding.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <p role="alert" className="text-sm text-destructive">
          {t("chat.states.agentError")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={binding.retry}
        >
          {t("chat.actions.retry")}
        </Button>
      </div>
    );
  }
  return <ReadyChat chatId={chatId} localAgentId={binding.localAgentId} />;
}

export function ChatPlacement(props: ChatPlacementProps) {
  const { t } = useTranslation();
  const reconnect = useChatReconnect({ chatId: props.chat.id });
  const reconnectAnnouncement =
    reconnect.phase === "reconnecting"
      ? t("chat.states.reconnecting")
      : reconnect.phase === "restored"
        ? t("chat.states.restored")
        : reconnect.phase === "failed_recoverable"
          ? t("chat.states.failedRecoverable")
          : t("chat.states.unknown");
  return (
    <BoardCardFrame
      title={reconnect.chat?.title ?? props.chat.title}
      selected={props.selected}
      displayState={props.placement.displayState}
      width={props.placement.width}
      height={props.placement.height}
      placementRevision={props.placement.revision}
      labels={{
        collapse: t("chat.placement.collapse"),
        expand: t("chat.placement.expand"),
        maximize: t("chat.placement.maximize"),
        restore: t("chat.placement.restore"),
        close: t("chat.placement.close"),
        deleteEntity: t("chat.placement.archive"),
      }}
      onDisplayStateChange={props.onDisplayStateChange}
      onClosePlacement={props.onClose}
      onRequestDeleteEntity={props.onArchive}
      onResizeEnd={props.onResizeEnd}
      onKeyboardMove={props.onKeyboardMove}
      onKeyboardResize={props.onKeyboardResize}
    >
      <div className="h-full min-h-0 bg-background text-foreground">
        <p role="status" aria-live="polite" className="sr-only">
          {reconnectAnnouncement}
        </p>
        {reconnect.phase === "reconnecting" ? (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-sm text-muted-foreground">
              {t("chat.states.reconnecting")}
            </p>
          </div>
        ) : null}
        {reconnect.phase === "failed_recoverable" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <p role="alert" className="text-sm text-destructive">
              {t("chat.states.failedRecoverable")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void reconnect.retry()}
            >
              {t("chat.actions.retry")}
            </Button>
          </div>
        ) : null}
        {reconnect.phase === "unknown" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <p role="alert" className="text-sm text-destructive">
              {t("chat.states.unknown")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void reconnect.retry()}
            >
              {t("chat.actions.retry")}
            </Button>
          </div>
        ) : null}
        {reconnect.phase === "restored" && reconnect.chat ? (
          <ReconnectedChat chatId={reconnect.chat.id} />
        ) : null}
      </div>
    </BoardCardFrame>
  );
}

export default ChatPlacement;
