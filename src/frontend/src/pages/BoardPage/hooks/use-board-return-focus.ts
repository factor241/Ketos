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

    let innerFrame: number | null = null;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        const section = document.querySelector<HTMLElement>(
          `[data-id="${focusPlacementId}"] section`,
        );
        if (!section) return;
        section.focus({ preventScroll: true });
        lastFocusedIdRef.current = focusPlacementId;
      });
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) cancelAnimationFrame(innerFrame);
    };
  }, [focusPlacementId, isLoading, placements]);
}
