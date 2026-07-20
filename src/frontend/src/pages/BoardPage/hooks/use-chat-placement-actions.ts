import { useRef } from "react";

import { usePatchChat } from "@/controllers/API/queries/chat-threads";
import { usePostPlacement } from "@/controllers/API/queries/placements";
import type { Placement } from "@/types/board";
import type { ChatThread } from "@/types/chat";

const CHAT_WIDTH = 480;
const CHAT_HEIGHT = 360;
const PLACEMENT_GAP = 40;

type Position = { x: number; y: number };

function collides(position: Position, placements: readonly Placement[]) {
  return placements.some(
    (placement) =>
      position.x < placement.x + placement.width + PLACEMENT_GAP &&
      position.x + CHAT_WIDTH + PLACEMENT_GAP > placement.x &&
      position.y < placement.y + placement.height + PLACEMENT_GAP &&
      position.y + CHAT_HEIGHT + PLACEMENT_GAP > placement.y,
  );
}

export function findChatPlacementPosition(
  placements: readonly Placement[],
  center: Position,
): Position {
  const desired = {
    x: Math.max(0, center.x - CHAT_WIDTH / 2),
    y: Math.max(0, center.y - CHAT_HEIGHT / 2),
  };
  const adjacent = placements.flatMap((placement) => [
    {
      x: placement.x - CHAT_WIDTH - PLACEMENT_GAP,
      y: placement.y,
    },
    {
      x: placement.x + placement.width + PLACEMENT_GAP,
      y: placement.y,
    },
    {
      x: placement.x,
      y: placement.y + placement.height + PLACEMENT_GAP,
    },
    {
      x: placement.x,
      y: placement.y - CHAT_HEIGHT - PLACEMENT_GAP,
    },
  ]);
  const candidates = [desired, ...adjacent]
    .filter((position) => position.x >= 0 && position.y >= 0)
    .filter((position) => !collides(position, placements));
  if (candidates[0]) return candidates[0];

  for (let row = 1; row <= placements.length + 1; row += 1) {
    const fallback = {
      x: desired.x,
      y: desired.y + row * (CHAT_HEIGHT + PLACEMENT_GAP),
    };
    if (!collides(fallback, placements)) return fallback;
  }
  return desired;
}

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
        const position = findChatPlacementPosition(placements, center);
        return await placementMutation.mutateAsync({
          targetKind: "chat",
          targetId: chat.id,
          ...position,
          width: CHAT_WIDTH,
          height: CHAT_HEIGHT,
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
