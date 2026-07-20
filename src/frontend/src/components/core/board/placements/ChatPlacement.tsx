import { CopilotChat } from "@copilotkit/react-core/v2";
import { useTranslation } from "react-i18next";

import type { Placement, PlacementDisplayState } from "@/types/board";
import type { ChatThread } from "@/types/chat";
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

export function ChatPlacement(props: ChatPlacementProps) {
  const { t } = useTranslation();
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
        <CopilotChat
          key={props.chat.id}
          agentId="ketos-chat"
          threadId={props.chat.id}
        />
      </div>
    </BoardCardFrame>
  );
}

export default ChatPlacement;
