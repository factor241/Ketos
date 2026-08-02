import type { Viewport } from "@xyflow/react";
import { create } from "zustand";

export type BoardHydrationPhase = "idle" | "hydrating" | "ready";

export interface BoardState {
  mountedBoardId: string | null;
  hydrationPhase: BoardHydrationPhase;
  isViewportGestureActive: boolean;
  pendingViewport: Viewport | null;
}

export interface BoardActions {
  mountBoard: (boardId: string) => void;
  setHydrationPhase: (phase: BoardHydrationPhase) => void;
  setViewportGestureActive: (active: boolean) => void;
  setPendingViewport: (viewport: Viewport) => void;
  clearPendingViewport: () => void;
  unmountBoard: () => void;
}

export type BoardStore = BoardState & BoardActions;

const initialBoardState: BoardState = {
  mountedBoardId: null,
  hydrationPhase: "idle",
  isViewportGestureActive: false,
  pendingViewport: null,
};

const useBoardStore = create<BoardStore>((set) => ({
  ...initialBoardState,
  mountBoard: (boardId) =>
    set({
      mountedBoardId: boardId,
      hydrationPhase: "hydrating",
      isViewportGestureActive: false,
      pendingViewport: null,
    }),
  setHydrationPhase: (hydrationPhase) => set({ hydrationPhase }),
  setViewportGestureActive: (isViewportGestureActive) =>
    set({ isViewportGestureActive }),
  setPendingViewport: (pendingViewport) => set({ pendingViewport }),
  clearPendingViewport: () => set({ pendingViewport: null }),
  unmountBoard: () => set(initialBoardState),
}));

export default useBoardStore;
