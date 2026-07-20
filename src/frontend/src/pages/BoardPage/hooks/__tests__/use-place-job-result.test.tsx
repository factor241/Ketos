import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { BoardExecution } from "@/controllers/API/queries/executions";
import {
  useGetBoardPlacements,
  usePostPlacement,
} from "@/controllers/API/queries/placements";
import type { Placement } from "@/types/board";

import { usePlaceJobResult } from "../use-place-job-result";

jest.mock("@/controllers/API/queries/placements", () => ({
  useGetBoardPlacements: jest.fn(),
  usePostPlacement: jest.fn(),
}));

const mockGetPlacements = useGetBoardPlacements as jest.Mock;
const mockPostPlacement = usePostPlacement as jest.Mock;

const automationPlacement: Placement = {
  id: "automation-placement",
  boardId: "board-1",
  targetKind: "automation",
  targetId: "flow-1",
  x: 100,
  y: 200,
  width: 420,
  height: 280,
  zIndex: 3,
  displayState: "normal",
  revision: 1,
  createdAt: "2026-07-21T00:00:00Z",
  updatedAt: "2026-07-21T00:00:00Z",
};

const execution: BoardExecution = {
  job_id: "job-1",
  board_id: "board-1",
  flow_id: "flow-1",
  status: "succeeded",
  reason: null,
  created_timestamp: "2026-07-21T00:00:00Z",
  finished_timestamp: "2026-07-21T00:00:01Z",
  result: { kind: "text", value: "done", truncated: false },
};

const resultPlacement: Placement = {
  ...automationPlacement,
  id: "result-placement",
  targetKind: "job_result",
  targetId: "job-1",
  x: 552,
  zIndex: 4,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("usePlaceJobResult", () => {
  let placements: Placement[];
  let post: jest.Mock;
  let refetch: jest.Mock;
  let onOpen: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    placements = [automationPlacement];
    post = jest.fn().mockResolvedValue(resultPlacement);
    refetch = jest.fn().mockResolvedValue({ data: placements });
    onOpen = jest.fn();
    mockGetPlacements.mockImplementation(() => ({
      data: placements,
      isLoading: false,
      refetch,
    }));
    mockPostPlacement.mockImplementation(() => ({
      mutateAsync: post,
      isPending: false,
    }));
  });

  it.each(["succeeded", "failed", "cancelled"] as const)(
    "automatically creates one adjacent placement for terminal %s",
    async (status) => {
      const { rerender } = renderHook(() =>
        usePlaceJobResult({
          boardId: "board-1",
          automationPlacement,
          execution: { ...execution, status },
          onOpen,
        }),
      );

      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      expect(post).toHaveBeenCalledWith({
        targetKind: "job_result",
        targetId: "job-1",
        x: 552,
        y: 200,
        width: 420,
        height: 280,
        zIndex: 4,
      });
      expect(onOpen).not.toHaveBeenCalled();
      rerender();
      expect(post).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["queued", "running"] as const)(
    "never creates for nonterminal %s",
    async (status) => {
      renderHook(() =>
        usePlaceJobResult({
          boardId: "board-1",
          automationPlacement,
          execution: { ...execution, status, result: null },
          onOpen,
        }),
      );
      await act(async () => undefined);
      expect(post).not.toHaveBeenCalled();
    },
  );

  it("rejects a terminal execution from another board or flow", async () => {
    const { rerender } = renderHook(
      ({ candidate }: { candidate: BoardExecution }) =>
        usePlaceJobResult({
          boardId: "board-1",
          automationPlacement,
          execution: candidate,
          onOpen,
        }),
      { initialProps: { candidate: { ...execution, board_id: "board-2" } } },
    );
    await act(async () => undefined);
    expect(post).not.toHaveBeenCalled();

    rerender({ candidate: { ...execution, flow_id: "flow-2" } });
    await act(async () => undefined);
    expect(post).not.toHaveBeenCalled();
  });

  it("reuses an existing placement on reload and focuses only on explicit open", async () => {
    placements = [automationPlacement, resultPlacement];
    const { result } = renderHook(() =>
      usePlaceJobResult({
        boardId: "board-1",
        automationPlacement,
        execution,
        onOpen,
      }),
    );

    await act(async () => undefined);
    expect(post).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    act(() => result.current.openResult());
    expect(onOpen).toHaveBeenCalledWith("result-placement");
  });

  it("resolves a unique conflict by refetching the existing placement", async () => {
    post.mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
    refetch.mockResolvedValue({
      data: [automationPlacement, resultPlacement],
    });
    const { result } = renderHook(() =>
      usePlaceJobResult({
        boardId: "board-1",
        automationPlacement,
        execution,
        onOpen,
      }),
    );

    await waitFor(() =>
      expect(result.current.placement).toEqual(resultPlacement),
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("coalesces rapid A to B to A materialization per execution key", async () => {
    const requestA = deferred<Placement>();
    const requestB = deferred<Placement>();
    post.mockImplementation((input: { targetId: string }) =>
      input.targetId === "job-1" ? requestA.promise : requestB.promise,
    );
    const executionB: BoardExecution = { ...execution, job_id: "job-2" };
    const { rerender } = renderHook(
      ({ candidate }: { candidate: BoardExecution }) =>
        usePlaceJobResult({
          boardId: "board-1",
          automationPlacement,
          execution: candidate,
          onOpen,
        }),
      { initialProps: { candidate: execution } },
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    rerender({ candidate: executionB });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    rerender({ candidate: execution });
    await act(async () => undefined);
    expect(post).toHaveBeenCalledTimes(2);

    await act(async () => {
      requestA.resolve(resultPlacement);
      requestB.resolve({
        ...resultPlacement,
        id: "result-placement-2",
        targetId: "job-2",
      });
      await Promise.all([requestA.promise, requestB.promise]);
    });
  });

  it("contains no Flow write, selection, focus or viewport side effect", () => {
    const source = readFileSync(
      join(process.cwd(), "src/pages/BoardPage/hooks/use-place-job-result.ts"),
      "utf8",
    );
    for (const token of [
      "flowStore",
      "Flow.data",
      "useReactFlow",
      "fitView",
      ".focus(",
      "setNodes",
      "setSelected",
      "setQueryData",
      "invalidateQueries",
    ])
      expect(source).not.toContain(token);
  });
});
