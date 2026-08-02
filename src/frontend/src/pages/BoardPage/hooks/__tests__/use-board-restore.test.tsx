import { act, renderHook } from "@testing-library/react";

import { useGetBoard } from "@/controllers/API/queries/boards";
import useBoardStore from "@/stores/boardStore";
import type { BoardRead } from "@/types/board";
import { useBoardRestore } from "../use-board-restore";

jest.mock("@/controllers/API/queries/boards", () => ({
  useGetBoard: jest.fn(),
}));

const mockedUseGetBoard = jest.mocked(useGetBoard);
const board: BoardRead = {
  id: "board-1",
  project_id: "project-1",
  created_by_id: "user-1",
  title: "Server board",
  viewport_x: 120,
  viewport_y: -35,
  viewport_zoom: 1.25,
  revision: 17,
  created_at: "2026-07-21T00:00:00Z",
  updated_at: "2026-07-21T00:01:00Z",
};

type MockQuery = {
  data?: BoardRead;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: jest.Mock;
};

const makeQuery = (overrides: Partial<MockQuery> = {}): MockQuery => ({
  data: undefined,
  error: null,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe("useBoardRestore", () => {
  let query: MockQuery;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    query = makeQuery({ isLoading: true });
    mockedUseGetBoard.mockImplementation(
      () => query as unknown as ReturnType<typeof useGetBoard>,
    );
    useBoardStore.getState().unmountBoard();
    frames = [];
    globalThis.requestAnimationFrame = jest.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    globalThis.cancelAnimationFrame = jest.fn();
    document.body.replaceChildren();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.replaceChildren();
    jest.clearAllMocks();
  });

  const flushFrames = () => {
    while (frames.length) {
      const current = frames;
      frames = [];
      current.forEach((callback, index) => callback(index));
    }
  };

  it("uses only exact server state despite corrupted browser caches", () => {
    localStorage.setItem("ketos-board-board-1", "{broken");
    sessionStorage.setItem(
      "ketos-board-board-1",
      JSON.stringify({ revision: 999, viewport_x: 999 }),
    );
    const getItem = jest.spyOn(Storage.prototype, "getItem");
    query = makeQuery({ data: board });

    const { result } = renderHook(() =>
      useBoardRestore({ projectId: "project-1", boardId: "board-1" }),
    );

    expect(result.current.phase).toBe("restored");
    expect(result.current.board).toBe(board);
    expect(getItem).not.toHaveBeenCalled();
  });

  it("clears transient board state before a changed route hydrates", () => {
    useBoardStore.setState({
      mountedBoardId: "stale-board",
      hydrationPhase: "ready",
      isViewportGestureActive: true,
      pendingViewport: { x: 1, y: 2, zoom: 3 },
    });
    const { rerender } = renderHook(
      ({ boardId }) => useBoardRestore({ projectId: "project-1", boardId }),
      { initialProps: { boardId: "board-1" } },
    );
    expect(useBoardStore.getState()).toMatchObject({
      mountedBoardId: null,
      hydrationPhase: "idle",
      isViewportGestureActive: false,
      pendingViewport: null,
    });
    useBoardStore.setState({
      mountedBoardId: "board-1",
      hydrationPhase: "ready",
      isViewportGestureActive: true,
      pendingViewport: { x: 9, y: 8, zoom: 0.5 },
    });
    rerender({ boardId: "board-2" });
    expect(useBoardStore.getState().mountedBoardId).toBeNull();
    expect(useBoardStore.getState().pendingViewport).toBeNull();
  });

  it("exposes the full server-driven phase matrix", () => {
    const { result, rerender } = renderHook(() =>
      useBoardRestore({ projectId: "project-1", boardId: "board-1" }),
    );
    expect(result.current).toMatchObject({
      phase: "hydrating",
      announcementKey: "board.restore.hydrating",
    });
    const firstAnnouncement = result.current.announcementKey;
    rerender();
    expect(result.current.announcementKey).toBe(firstAnnouncement);
    query = makeQuery({ data: board, isFetching: true });
    rerender();
    expect(result.current).toMatchObject({
      phase: "reconnecting",
      board,
      announcementKey: "board.restore.reconnecting",
    });
    query = makeQuery({ data: board });
    rerender();
    expect(result.current).toMatchObject({
      phase: "restored",
      announcementKey: "board.restore.restored",
    });
    query = makeQuery({ error: new Error("offline"), isError: true });
    rerender();
    expect(result.current).toMatchObject({
      phase: "failed_recoverable",
      board,
    });
    query = makeQuery({ data: { ...board, id: "foreign" } });
    rerender();
    expect(result.current).toMatchObject({ phase: "unknown", board: null });
  });

  it("refetches one observed 409 once and never merges local state", () => {
    const conflict = { response: { status: 409 } };
    const refetch = jest.fn().mockResolvedValue(undefined);
    query = makeQuery({ error: conflict, isError: true, refetch });
    const { result, rerender } = renderHook(() =>
      useBoardRestore({ projectId: "project-1", boardId: "board-1" }),
    );
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("hydrating");
    rerender();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("unknown");
  });

  it("restores placement focus once and falls back without focusing a composer", () => {
    document.body.innerHTML = `
      <h1 id="board-heading" tabindex="-1">Board</h1>
      <div data-id="placement-123"><section tabindex="-1"><textarea id="chat-composer"></textarea><button id="action">Action</button></section></div>
      <div data-testid="board-canvas" tabindex="-1"></div>`;
    const action = document.getElementById("action") as HTMLButtonElement;
    const section = document.querySelector(
      '[data-id="placement-123"] section',
    ) as HTMLElement;
    const focus = jest.spyOn(section, "focus");
    action.focus();
    query = makeQuery({ data: board, isFetching: true });
    const { rerender } = renderHook(() =>
      useBoardRestore({ projectId: "project-1", boardId: "board-1" }),
    );
    query = makeQuery({ data: board });
    rerender();
    act(flushFrames);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(section);
    rerender();
    act(flushFrames);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("uses heading then canvas as deterministic direct-URL focus fallbacks", () => {
    const heading = document.createElement("h1");
    heading.id = "board-heading";
    heading.tabIndex = -1;
    document.body.append(heading);
    query = makeQuery({ data: board });
    const first = renderHook(() =>
      useBoardRestore({ projectId: "project-1", boardId: "board-1" }),
    );
    act(flushFrames);
    expect(heading).toHaveFocus();
    first.unmount();

    heading.remove();
    const canvas = document.createElement("div");
    canvas.dataset.testid = "board-canvas";
    canvas.tabIndex = -1;
    document.body.append(canvas);
    query = makeQuery({ data: { ...board, id: "board-2" } });
    renderHook(() =>
      useBoardRestore({ projectId: "project-1", boardId: "board-2" }),
    );
    act(flushFrames);
    expect(canvas).toHaveFocus();
  });
});
