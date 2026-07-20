import type { ReactNode } from "react";

import type { PlacementDisplayState } from "@/types/board";

export interface BoardCardFrameProps {
  title: string;
  children: ReactNode;
  selected: boolean;
  displayState: PlacementDisplayState;
  width: number;
  height: number;
  placementRevision?: number;
  labels: {
    collapse: string;
    expand: string;
    maximize: string;
    restore: string;
    close: string;
    deleteEntity: string;
  };
  onDisplayStateChange: (state: PlacementDisplayState) => void;
  onClosePlacement: () => void;
  onRequestDeleteEntity: () => void;
  onResizeEnd: (size: { width: number; height: number }) => void;
  onKeyboardMove?: (delta: { x: number; y: number }) => void;
  onKeyboardResize?: (delta: { width: number; height: number }) => void;
}
