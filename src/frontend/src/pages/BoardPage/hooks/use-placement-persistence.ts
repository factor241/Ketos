import {
  useDeletePlacement,
  usePatchPlacement,
} from "@/controllers/API/queries/placements";
import type { Placement, PlacementDisplayState } from "@/types/board";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export function usePlacementPersistence({ boardId }: { boardId: string }) {
  const patch = usePatchPlacement({ boardId });
  const close = useDeletePlacement({ boardId });

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

  return {
    move: (placement: Placement, position: { x: number; y: number }) =>
      update(placement, { x: position.x, y: position.y }),
    resize: (placement: Placement, size: { width: number; height: number }) =>
      update(placement, {
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
    isPending: patch.isPending || close.isPending,
  };
}
