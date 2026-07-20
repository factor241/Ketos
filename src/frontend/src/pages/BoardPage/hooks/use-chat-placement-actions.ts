import { useRef } from "react";

import { usePatchChat } from "@/controllers/API/queries/chat-threads";
import { usePostPlacement } from "@/controllers/API/queries/placements";
import type { Placement } from "@/types/board";
import type { ChatThread } from "@/types/chat";

export function useChatPlacementActions({ boardId }: { boardId: string }) {
  const placementMutation = usePostPlacement({ boardId });
  const archiveMutation = usePatchChat();
  const opening = useRef<Set<string>>(new Set());

  return {
    open: async (
      chat: ChatThread,
      placements: readonly Placement[],
      center: { x: number; y: number },
    ): Promise<Placement> => {
      const existing = placements.find(
        (placement) =>
          placement.targetKind === "chat" && placement.targetId === chat.id,
      );
      if (existing) return existing;
      if (opening.current.has(chat.id)) {
        throw new Error("chat placement creation already in progress");
      }
      opening.current.add(chat.id);
      try {
        return await placementMutation.mutateAsync({
          targetKind: "chat",
          targetId: chat.id,
          x: center.x - 240,
          y: center.y - 180,
          width: 480,
          height: 360,
        });
      } finally {
        opening.current.delete(chat.id);
      }
    },
    archive: (chat: ChatThread) =>
      archiveMutation.mutate({
        chatId: chat.id,
        expectedRevision: chat.revision,
        archived: true,
      }),
    isPending: placementMutation.isPending || archiveMutation.isPending,
  };
}
