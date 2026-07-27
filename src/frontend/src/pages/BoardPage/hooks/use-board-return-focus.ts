import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import type { Placement } from "@/types/board";
import { isUUID } from "@/utils/utils";

export function useBoardReturnFocus({
  placements,
  isLoading,
}: {
  placements: readonly Placement[];
  isLoading: boolean;
}): void {
  const [searchParams] = useSearchParams();
  const lastFocusedIdRef = useRef<string | null>(null);
  const ids = searchParams.getAll("focusPlacementId");
  const focusPlacementId = ids.length === 1 && isUUID(ids[0]) ? ids[0] : null;

  useEffect(() => {
    if (
      isLoading ||
      focusPlacementId === null ||
      lastFocusedIdRef.current === focusPlacementId
    )
      return;
    const placement = placements.find(
      (candidate) =>
        candidate.id === focusPlacementId &&
        candidate.targetKind === "automation",
    );
    if (!placement) return;

    let frame: number | null = null;
    let remainingFrames = 60;
    let focusedAtLeastOnce = false;
    let userInteracted = false;
    const stopForUser = () => {
      userInteracted = true;
      lastFocusedIdRef.current = focusPlacementId;
    };
    const removeInteractionListeners = () => {
      window.removeEventListener("keydown", stopForUser, true);
      window.removeEventListener("pointerdown", stopForUser, true);
    };
    const focusAndMonitor = () => {
      if (userInteracted || remainingFrames-- <= 0) {
        if (focusedAtLeastOnce) lastFocusedIdRef.current = focusPlacementId;
        frame = null;
        removeInteractionListeners();
        return;
      }
      const section = document.querySelector<HTMLElement>(
        `[data-id="${focusPlacementId}"] section`,
      );
      if (section) {
        const activeElement = document.activeElement;
        if (
          activeElement !== section &&
          !(activeElement instanceof Node && section.contains(activeElement))
        ) {
          section.focus({ preventScroll: true });
        }
        focusedAtLeastOnce = true;
      }
      frame = requestAnimationFrame(focusAndMonitor);
    };
    window.addEventListener("keydown", stopForUser, true);
    window.addEventListener("pointerdown", stopForUser, true);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(focusAndMonitor);
    });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      removeInteractionListeners();
    };
  }, [focusPlacementId, isLoading, placements]);
}
