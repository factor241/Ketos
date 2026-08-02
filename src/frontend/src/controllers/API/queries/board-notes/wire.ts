import type {
  BoardNote,
  BoardNoteCreateInput,
  BoardNoteCreateResult,
} from "@/types/board";
import { mapPlacement, type PlacementWire } from "../placements/wire";

export interface BoardNoteWire {
  id: string;
  project_id: string;
  created_by_id: string;
  content: string;
  color: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface BoardNoteCreateWireResult {
  note: BoardNoteWire;
  placement: PlacementWire;
}

export function mapBoardNote(wire: BoardNoteWire): BoardNote {
  return {
    id: wire.id,
    projectId: wire.project_id,
    createdById: wire.created_by_id,
    content: wire.content,
    color: wire.color,
    revision: wire.revision,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  };
}

export function mapBoardNoteCreateResult(
  wire: BoardNoteCreateWireResult,
): BoardNoteCreateResult {
  return {
    note: mapBoardNote(wire.note),
    placement: mapPlacement(wire.placement),
  };
}

export function boardNoteCreatePayload(input: BoardNoteCreateInput) {
  return {
    content: input.content ?? "",
    color: input.color ?? "neutral",
    placement: {
      x: input.placement.x,
      y: input.placement.y,
      width: input.placement.width ?? 320,
      height: input.placement.height ?? 240,
      z_index: input.placement.zIndex ?? 0,
    },
  };
}
