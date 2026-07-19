import { act, renderHook } from "@testing-library/react";
import type { ReactFlowInstance, Viewport } from "@xyflow/react";

import type { BoardRead } from "@/types/board";
import { useBoardViewport } from "../use-board-viewport";

const mockUsePutBoardViewport = jest.fn();
const mockStoreState = {
  mountedBoardId: null as string | null,
  hydrationPhase: "idle",
  isViewportGestureActive: false,
  pendingViewport: null as Viewport | null,
  mountBoard: jest.fn(),
  setHydrationPhase: jest.fn(),
  setViewportGestureActive: jest.fn(),
  setPendingViewport: jest.fn((viewport: Viewport) => {
    mockStoreState.pendingViewport = viewport;
  }),
  clearPendingViewport: jest.fn(() => {
    mockStoreState.pendingViewport = null;
  }),
  unmountBoard: jest.fn(),
};

jest.mock("@/controllers/API/queries/boards", () => ({
  usePutBoardViewport: (args: { projectId: string; boardId: string }) =>
    mockUsePutBoardViewport(args),
}));
jest.mock("@/stores/boardStore", () => ({
  __esModule: true,
  default: (selector: (state: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
}));

function makeBoard(id: string, revision: number, viewport: Viewport): BoardRead {
  return {
    id,
    project_id: "11111111-1111-4111-8111-111111111111",
    created_by_id: "22222222-2222-4222-8222-222222222222",
    title: "Board",
    viewport_x: viewport.x,
    viewport_y: viewport.y,
    viewport_zoom: viewport.zoom,
    revision,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function makeInstance(): ReactFlowInstance {
  return { setViewport: jest.fn() } as unknown as ReactFlowInstance;
}

describe("useBoardViewport", () => {
  const mutate = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockStoreState.pendingViewport = null;
    mockStoreState.setPendingViewport.mockImplementation((viewport) => {
      mockStoreState.pendingViewport = viewport;
    });
    mockStoreState.clearPendingViewport.mockImplementation(() => {
      mockStoreState.pendingViewport = null;
    });
    mockUsePutBoardViewport.mockReturnValue({ mutate });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("hydrates the exact server viewport before becoming ready", () => {
    const board = makeBoard("board-1", 4, { x: 18.25, y: -9.5, zoom: 1.375 });
    const instance = makeInstance();
    const { result } = renderHook(() =>
      useBoardViewport({ projectId: board.project_id, board, refetch: jest.fn() }),
    );

    expect(result.current.initialViewport).toEqual({ x: 18.25, y: -9.5, zoom: 1.375 });
    expect(mockStoreState.setHydrationPhase).toHaveBeenLastCalledWith("hydrating");
    act(() => result.current.onInstanceReady(instance));
    expect(instance.setViewport).toHaveBeenCalledWith(
      { x: 18.25, y: -9.5, zoom: 1.375 },
      { duration: 0 },
    );
    expect(mockStoreState.setHydrationPhase).toHaveBeenLastCalledWith("ready");
  });

  it("coalesces move-end events and saves x/y/zoom after 300 ms", () => {
    const board = makeBoard("board-1", 5, { x: 0, y: 0, zoom: 1 });
    const { result } = renderHook(() =>
      useBoardViewport({ projectId: board.project_id, board, refetch: jest.fn() }),
    );
    act(() => {
      result.current.onMoveStart();
      result.current.onMoveEnd(null, { x: 10, y: 20, zoom: 1.1 });
      jest.advanceTimersByTime(250);
      result.current.onMoveEnd(null, { x: 30, y: 40, zoom: 1.2 });
      jest.advanceTimersByTime(299);
    });
    expect(mutate).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(mutate).toHaveBeenCalledWith(
      { x: 30, y: 40, zoom: 1.2, expected_revision: 5 },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("uses the revision returned by the previous save", () => {
    const board = makeBoard("board-1", 7, { x: 0, y: 0, zoom: 1 });
    const { result } = renderHook(() =>
      useBoardViewport({ projectId: board.project_id, board, refetch: jest.fn() }),
    );
    act(() => {
      result.current.onMoveEnd(null, { x: 1, y: 2, zoom: 1.1 });
      jest.advanceTimersByTime(300);
    });
    act(() => {
      mutate.mock.calls[0][1].onSuccess(
        makeBoard("board-1", 8, { x: 1, y: 2, zoom: 1.1 }),
      );
      result.current.onMoveEnd(null, { x: 3, y: 4, zoom: 1.2 });
      jest.advanceTimersByTime(300);
    });
    expect(mutate).toHaveBeenNthCalledWith(
      2,
      { x: 3, y: 4, zoom: 1.2, expected_revision: 8 },
      expect.any(Object),
    );
  });

  it("flushes one last pending save during unmount", () => {
    const board = makeBoard("board-1", 3, { x: 0, y: 0, zoom: 1 });
    const { result, unmount } = renderHook(() =>
      useBoardViewport({ projectId: board.project_id, board, refetch: jest.fn() }),
    );
    act(() => result.current.onMoveEnd(null, { x: 12, y: 24, zoom: 0.8 }));
    act(() => unmount());
    expect(mutate).toHaveBeenCalledWith(
      { x: 12, y: 24, zoom: 0.8, expected_revision: 3 },
      expect.any(Object),
    );
    act(() => jest.advanceTimersByTime(300));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("does not send the old board timer under a new board id", () => {
    const oldMutate = jest.fn();
    const newMutate = jest.fn();
    mockUsePutBoardViewport.mockImplementation(({ boardId }) => ({
      mutate: boardId === "old-board" ? oldMutate : newMutate,
    }));
    const oldBoard = makeBoard("old-board", 2, { x: 0, y: 0, zoom: 1 });
    const newBoard = makeBoard("new-board", 11, { x: 100, y: 200, zoom: 0.5 });
    const { result, rerender } = renderHook(
      ({ board }) => useBoardViewport({ projectId: board.project_id, board, refetch: jest.fn() }),
      { initialProps: { board: oldBoard } },
    );
    act(() => {
      result.current.onMoveEnd(null, { x: 5, y: 6, zoom: 1.1 });
      rerender({ board: newBoard });
    });
    expect(oldMutate).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(300));
    expect(oldMutate).toHaveBeenCalledTimes(1);
    expect(newMutate).not.toHaveBeenCalled();
  });

  it("resolves 409 with refetched server viewport", async () => {
    const board = makeBoard("board-1", 9, { x: 0, y: 0, zoom: 1 });
    const server = makeBoard("board-1", 10, { x: -20, y: 15, zoom: 0.9 });
    const refetch = jest.fn().mockResolvedValue({ data: server });
    const instance = makeInstance();
    const { result } = renderHook(() =>
      useBoardViewport({ projectId: board.project_id, board, refetch }),
    );
    act(() => {
      result.current.onInstanceReady(instance);
      result.current.onMoveEnd(null, { x: 50, y: 60, zoom: 1.4 });
      jest.advanceTimersByTime(300);
    });
    await act(async () => {
      mutate.mock.calls[0][1].onError({ response: { status: 409 } });
      await Promise.resolve();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(instance.setViewport).toHaveBeenLastCalledWith(
      { x: -20, y: 15, zoom: 0.9 },
      { duration: 0 },
    );
    expect(result.current.conflict).toBe(true);
  });
});
