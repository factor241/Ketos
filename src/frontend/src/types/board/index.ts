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
