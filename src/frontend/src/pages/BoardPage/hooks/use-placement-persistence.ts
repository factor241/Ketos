import axios from "axios";
import { useEffect, useRef } from "react";

import {
  useDeletePlacement,
  usePatchPlacement,
} from "@/controllers/API/queries/placements";
import type { Placement, PlacementDisplayState } from "@/types/board";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export function usePlacementPersistence({
  boardId,
  onConflict,
}: {
  boardId: string;
  onConflict?: () => void;
}) {
  const patch = usePatchPlacement(
    { boardId },
    {
      onError: (error) => {
        if (axios.isAxiosError(error) && error.response?.status === 409) {
          onConflict?.();
        }
      },
    },
  );
  const close = useDeletePlacement({ boardId });
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(
    () => () => {
      for (const timer of pending.current.values()) clearTimeout(timer);
      pending.current.clear();
    },
    [],
  );

  const update = (
    placement: Placement,
    values: Partial<
      Pick<Placement, "x" | "y" | "width" | "height" | "displayState">
    >,
  ) =>
    patch.mutate({
      placementId: placement.id,
      expectedRevision: placement.revision,
      ...values,
    });

  const queue = (
    key: string,
    placement: Placement,
    values: Partial<Pick<Placement, "x" | "y" | "width" | "height">>,
  ) => {
    const current = pending.current.get(key);
    if (current) clearTimeout(current);
    pending.current.set(
      key,
      setTimeout(() => {
        pending.current.delete(key);
        update(placement, values);
      }, 150),
    );
  };

  return {
    move: (placement: Placement, position: { x: number; y: number }) =>
      update(placement, { x: position.x, y: position.y }),
    queueMove: (placement: Placement, position: { x: number; y: number }) =>
      queue(`move:${placement.id}`, placement, position),
    resize: (placement: Placement, size: { width: number; height: number }) =>
      update(placement, {
        width: clamp(size.width, 240, 1600),
        height: clamp(size.height, 160, 1200),
      }),
    queueResize: (
      placement: Placement,
      size: { width: number; height: number },
    ) =>
      queue(`resize:${placement.id}`, placement, {
        width: clamp(size.width, 240, 1600),
        height: clamp(size.height, 160, 1200),
      }),
    setDisplayState: (
      placement: Placement,
      displayState: PlacementDisplayState,
    ) => update(placement, { displayState }),
    close: (placement: Placement) =>
      close.mutate({
        placementId: placement.id,
        expectedRevision: placement.revision,
      }),
    closeAndWait: (placement: Placement) =>
      close.mutateAsync({
        placementId: placement.id,
        expectedRevision: placement.revision,
      }),
    isPending: patch.isPending || close.isPending,
  };
}
