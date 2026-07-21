import { CopilotChat } from "@copilotkit/react-core/v2";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { Placement, PlacementDisplayState } from "@/types/board";
import type { ChatThread } from "@/types/chat";
import FlowCommandOutcome from "../../chats/FlowCommandOutcome";
import { useFlowCommandInterrupt } from "../../chats/use-flow-command-interrupt";
import { useThreadScopedCopilotAgent } from "../../chats/use-thread-scoped-copilot-agent";
import { BoardCardFrame } from "../BoardCardFrame";

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
        <CopilotChat key={chatId} agentId={localAgentId} threadId={chatId} />
      </div>
      {resolvedProposalIds.map((proposalId) => (
        <FlowCommandOutcome key={proposalId} proposalId={proposalId} />
      ))}
    </div>
  );
}

export function ChatPlacement(props: ChatPlacementProps) {
  const { t } = useTranslation();
  const binding = useThreadScopedCopilotAgent(props.chat.id);
  return (
    <BoardCardFrame
      title={props.chat.title}
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
        {binding.status === "registering" ? (
          <div className="flex h-full items-center justify-center p-4">
            <p role="status" className="text-sm text-muted-foreground">
              {t("chat.states.connecting")}
            </p>
          </div>
        ) : null}
        {binding.status === "error" ? (
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
        ) : null}
        {binding.status === "ready" ? (
          <ReadyChat
            chatId={props.chat.id}
            localAgentId={binding.localAgentId}
          />
        ) : null}
      </div>
    </BoardCardFrame>
  );
}

export default ChatPlacement;
