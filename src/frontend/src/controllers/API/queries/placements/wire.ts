import type {
  Placement,
  PlacementCreateInput,
  PlacementDisplayState,
  PlacementPatchInput,
  PlacementTargetKind,
} from "@/types/board";

export interface PlacementWire {
  id: string;
  board_id: string;
  target_kind: PlacementTargetKind;
  target_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  display_state: PlacementDisplayState;
  revision: number;
  created_at: string;
  updated_at: string;
}

export function mapPlacement(wire: PlacementWire): Placement {
  return {
    id: wire.id,
    boardId: wire.board_id,
    targetKind: wire.target_kind,
    targetId: wire.target_id,
    x: wire.x,
    y: wire.y,
    width: wire.width,
    height: wire.height,
    zIndex: wire.z_index,
    displayState: wire.display_state,
    revision: wire.revision,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  };
}

export function placementCreatePayload(input: PlacementCreateInput) {
  return {
    target_kind: input.targetKind,
    target_id: input.targetId,
    x: input.x,
    y: input.y,
    width: input.width ?? 320,
    height: input.height ?? 240,
    z_index: input.zIndex ?? 0,
  };
}

export function placementPatchPayload({
  placementId: _placementId,
  expectedRevision,
  displayState,
  zIndex,
  ...geometry
}: PlacementPatchInput) {
  return {
    ...geometry,
    ...(zIndex === undefined ? {} : { z_index: zIndex }),
    ...(displayState === undefined ? {} : { display_state: displayState }),
    expected_revision: expectedRevision,
  };
}
