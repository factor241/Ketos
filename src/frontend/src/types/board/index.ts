export interface BoardRead {
  id: string;
  project_id: string;
  created_by_id: string;
  title: string;
  viewport_x: number;
  viewport_y: number;
  viewport_zoom: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface BoardCreate {
  title: string;
}

export interface BoardPatch extends BoardCreate {
  expected_revision: number;
}

export interface BoardViewportUpdate {
  x: number;
  y: number;
  zoom: number;
  expected_revision: number;
}

export type PlacementTargetKind = "note" | "chat" | "automation" | "job_result";

export type PlacementDisplayState = "normal" | "collapsed" | "maximized";

export interface Placement {
  id: string;
  boardId: string;
  targetKind: PlacementTargetKind;
  targetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  displayState: PlacementDisplayState;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlacementGeometryInput {
  x: number;
  y: number;
  width?: number;
  height?: number;
  zIndex?: number;
}

export interface PlacementCreateInput extends PlacementGeometryInput {
  targetKind: PlacementTargetKind;
  targetId: string;
}

export interface PlacementPatchInput {
  placementId: string;
  expectedRevision: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  displayState?: PlacementDisplayState;
}

export interface PlacementDeleteInput {
  placementId: string;
  expectedRevision: number;
}

export interface BoardNote {
  id: string;
  projectId: string;
  createdById: string;
  content: string;
  color: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoardNoteNodeData {
  placementId: string;
  targetId: string;
  targetKind: "note";
  note: BoardNote;
}

export interface BoardNoteCreateInput {
  content?: string;
  color?: string;
  placement: PlacementGeometryInput;
}

export interface BoardNotePatchInput {
  noteId: string;
  expectedRevision: number;
  content?: string;
  color?: string;
  unsavedDraft?: string;
}

export interface BoardNoteDeleteInput {
  noteId: string;
  expectedRevision: number;
}

export interface BoardNoteCreateResult {
  note: BoardNote;
  placement: Placement;
}

export interface BoardNoteConflict {
  code: "stale_revision";
  noteId: string;
  unsavedDraft: string;
}
