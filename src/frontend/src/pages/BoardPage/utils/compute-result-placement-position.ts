import type { Placement, PlacementGeometryInput } from "@/types/board";

const RESULT_GAP = 32;
const STACK_GAP = 24;
const RESULT_WIDTH = 420;
const RESULT_HEIGHT = 280;

function overlaps(
  candidate: Required<
    Pick<PlacementGeometryInput, "x" | "y" | "width" | "height">
  >,
  placement: Placement,
): boolean {
  return (
    candidate.x < placement.x + placement.width &&
    candidate.x + candidate.width > placement.x &&
    candidate.y < placement.y + placement.height &&
    candidate.y + candidate.height > placement.y
  );
}

export function computeResultPlacementGeometry(
  automationPlacement: Placement,
  placements: readonly Placement[],
): Required<PlacementGeometryInput> {
  const x = automationPlacement.x + automationPlacement.width + RESULT_GAP;
  let y = automationPlacement.y;
  const ordered = [...placements].sort(
    (left, right) =>
      left.y - right.y || left.x - right.x || left.id.localeCompare(right.id),
  );

  while (true) {
    const candidate = {
      x,
      y,
      width: RESULT_WIDTH,
      height: RESULT_HEIGHT,
    };
    const collisions = ordered.filter((placement) =>
      overlaps(candidate, placement),
    );
    if (collisions.length === 0) break;
    y = Math.max(
      ...collisions.map(
        (placement) => placement.y + placement.height + STACK_GAP,
      ),
    );
  }

  return {
    x,
    y,
    width: RESULT_WIDTH,
    height: RESULT_HEIGHT,
    zIndex:
      Math.max(
        automationPlacement.zIndex,
        ...placements.map((item) => item.zIndex),
      ) + 1,
  };
}
