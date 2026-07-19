import type { Viewport } from "@xyflow/react";
import { act } from "@testing-library/react";

import useBoardStore, { type BoardStore } from "../boardStore";

const initialState = {
  mountedBoardId: null,
  hydrationPhase: "idle" as const,
  isViewportGestureActive: false,
  pendingViewport: null,
};

const transientState = (state: BoardStore) => ({
  mountedBoardId: state.mountedBoardId,
  hydrationPhase: state.hydrationPhase,
  isViewportGestureActive: state.isViewportGestureActive,
  pendingViewport: state.pendingViewport,
});

describe("useBoardStore", () => {
  beforeEach(() => {
    act(() => useBoardStore.setState(initialState));
  });

  afterEach(() => jest.restoreAllMocks());

  it("exposes only transient state and its frozen action API", () => {
    const state = useBoardStore.getState();
    expect(Object.keys(state).sort()).toEqual(
      [
        "clearPendingViewport",
        "hydrationPhase",
        "isViewportGestureActive",
        "mountBoard",
        "mountedBoardId",
        "pendingViewport",
        "setHydrationPhase",
        "setPendingViewport",
        "setViewportGestureActive",
        "unmountBoard",
      ].sort(),
    );
    expect(transientState(state)).toEqual(initialState);
  });

  it("mounts a board in the hydrating phase", () => {
    act(() => useBoardStore.getState().mountBoard("board-a"));
    expect(transientState(useBoardStore.getState())).toEqual({
      mountedBoardId: "board-a",
      hydrationPhase: "hydrating",
      isViewportGestureActive: false,
      pendingViewport: null,
    });
  });

  it("atomically clears gesture and pending viewport when switching", () => {
    act(() => {
      const store = useBoardStore.getState();
      store.mountBoard("board-a");
      store.setHydrationPhase("ready");
      store.setViewportGestureActive(true);
      store.setPendingViewport({ x: 12, y: -8, zoom: 1.5 });
    });
    const snapshots: ReturnType<typeof transientState>[] = [];
    const unsubscribe = useBoardStore.subscribe((state) =>
      snapshots.push(transientState(state)),
    );
    act(() => useBoardStore.getState().mountBoard("board-b"));
    unsubscribe();
    expect(snapshots).toEqual([
      {
        mountedBoardId: "board-b",
        hydrationPhase: "hydrating",
        isViewportGestureActive: false,
        pendingViewport: null,
      },
    ]);
  });

  it("restores the exact initial transient state when unmounted", () => {
    act(() => {
      const store = useBoardStore.getState();
      store.mountBoard("board-a");
      store.setHydrationPhase("ready");
      store.setViewportGestureActive(true);
      store.setPendingViewport({ x: 5, y: 10, zoom: 2 });
      store.unmountBoard();
    });
    expect(transientState(useBoardStore.getState())).toEqual(initialState);
  });

  it("updates and clears each transient viewport field", () => {
    const viewport: Viewport = { x: 100, y: 200, zoom: 0.75 };
    act(() => {
      const store = useBoardStore.getState();
      store.setHydrationPhase("ready");
      store.setViewportGestureActive(true);
      store.setPendingViewport(viewport);
    });
    expect(transientState(useBoardStore.getState())).toEqual({
      mountedBoardId: null,
      hydrationPhase: "ready",
      isViewportGestureActive: true,
      pendingViewport: viewport,
    });
    act(() => useBoardStore.getState().clearPendingViewport());
    expect(useBoardStore.getState().pendingViewport).toBeNull();
  });

  it("does not invoke localStorage", () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem");
    const setItem = jest.spyOn(Storage.prototype, "setItem");
    const removeItem = jest.spyOn(Storage.prototype, "removeItem");
    act(() => {
      const store = useBoardStore.getState();
      store.mountBoard("board-a");
      store.setPendingViewport({ x: 1, y: 2, zoom: 1 });
      store.clearPendingViewport();
      store.unmountBoard();
    });
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
