import { act, renderHook } from "@testing-library/react";
import { AxiosError } from "axios";
import type { BoardExecution } from "@/controllers/API/queries/executions";
import {
  useGetAutomationRun,
  usePostAutomationRun,
  usePostCancelAutomationRun,
} from "@/controllers/API/queries/executions";

import { useRunAutomation } from "../use-run-automation";

jest.mock("@/controllers/API/queries/executions", () => ({
  useGetAutomationRun: jest.fn(),
  usePostAutomationRun: jest.fn(),
  usePostCancelAutomationRun: jest.fn(),
}));

const mockGetRun = useGetAutomationRun as jest.Mock;
const mockPostRun = usePostAutomationRun as jest.Mock;
const mockCancelRun = usePostCancelAutomationRun as jest.Mock;

const queued: BoardExecution = {
  job_id: "job-1",
  board_id: "board-1",
  flow_id: "flow-1",
  status: "queued",
  reason: null,
  created_timestamp: "2026-07-21T00:00:00Z",
  finished_timestamp: null,
  result: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useRunAutomation", () => {
  let post: jest.Mock;
  let cancel: jest.Mock;
  let refetch: jest.Mock;
  let detailPresentation: unknown;
  let postData: BoardExecution | undefined;
  let cancelData: BoardExecution | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    post = jest.fn();
    cancel = jest.fn();
    refetch = jest.fn();
    detailPresentation = undefined;
    postData = undefined;
    cancelData = undefined;
    mockPostRun.mockImplementation(() => ({
      mutateAsync: post,
      data: postData,
    }));
    mockCancelRun.mockImplementation(() => ({
      mutateAsync: cancel,
      data: cancelData,
      isPending: false,
    }));
    mockGetRun.mockImplementation(() => ({
      presentation: detailPresentation,
      refetch,
    }));
  });

  it("atomically reserves one intent for double activation before POST resolves", async () => {
    const request = deferred<BoardExecution>();
    post.mockReturnValue(request.promise);
    const uuid = jest
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000010");
    const { result } = renderHook(() =>
      useRunAutomation({ boardId: "board-1", flowId: "flow-1" }),
    );

    let first!: Promise<void>;
    act(() => {
      first = result.current.run();
      void result.current.run();
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      idempotencyKey: "00000000-0000-4000-8000-000000000010",
    });
    expect(uuid).toHaveBeenCalledTimes(1);
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      request.resolve(queued);
      await first;
    });
    expect(result.current.jobId).toBe("job-1");
    expect(result.current.isSubmitting).toBe(false);
    uuid.mockRestore();
  });

  it("keeps the same intent through pre-identity transport ambiguity", async () => {
    const intent = "00000000-0000-4000-8000-000000000011";
    const uuid = jest.spyOn(crypto, "randomUUID").mockReturnValue(intent);
    post
      .mockRejectedValueOnce(new AxiosError("offline"))
      .mockResolvedValueOnce(queued);
    const { result } = renderHook(() =>
      useRunAutomation({ boardId: "board-1", flowId: "flow-1" }),
    );

    await act(async () => result.current.run());
    expect(result.current.presentation).toEqual({
      status: "unknown",
      lastKnown: null,
    });

    await act(async () => result.current.checkStatus());
    expect(post).toHaveBeenNthCalledWith(1, { idempotencyKey: intent });
    expect(post).toHaveBeenNthCalledWith(2, { idempotencyKey: intent });
    expect(uuid).toHaveBeenCalledTimes(1);
    expect(result.current.jobId).toBe("job-1");
    uuid.mockRestore();
  });

  it("checks known unknown status by refetching instead of posting", async () => {
    post.mockResolvedValue(queued);
    const uuid = jest
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000012");
    const { result, rerender } = renderHook(() =>
      useRunAutomation({ boardId: "board-1", flowId: "flow-1" }),
    );
    await act(async () => result.current.run());
    detailPresentation = { status: "unknown", lastKnown: queued };
    rerender();

    await act(async () => result.current.checkStatus());
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(uuid).toHaveBeenCalledTimes(1);
    uuid.mockRestore();
  });

  it("creates a new intent only for deliberate rerun after failure", async () => {
    const firstIntent = "00000000-0000-4000-8000-000000000013";
    const secondIntent = "00000000-0000-4000-8000-000000000014";
    const uuid = jest
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(firstIntent)
      .mockReturnValueOnce(secondIntent);
    post.mockResolvedValue(queued);
    const { result, rerender } = renderHook(() =>
      useRunAutomation({ boardId: "board-1", flowId: "flow-1" }),
    );
    await act(async () => result.current.run());
    detailPresentation = {
      ...queued,
      status: "failed",
      reason: "execution_failed",
    };
    rerender();

    await act(async () => result.current.runAgain());

    expect(post).toHaveBeenNthCalledWith(1, { idempotencyKey: firstIntent });
    expect(post).toHaveBeenNthCalledWith(2, { idempotencyKey: secondIntent });
    expect(uuid).toHaveBeenCalledTimes(2);
    uuid.mockRestore();
  });

  it("cancels only authoritative queued/running jobs", async () => {
    post.mockResolvedValue(queued);
    cancel.mockResolvedValue({
      ...queued,
      status: "cancelled",
      reason: "user_cancelled",
    });
    const uuid = jest
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000015");
    const { result, rerender } = renderHook(() =>
      useRunAutomation({ boardId: "board-1", flowId: "flow-1" }),
    );
    await act(async () => result.current.run());
    detailPresentation = queued;
    rerender();
    await act(async () => result.current.cancel());
    expect(cancel).toHaveBeenCalledTimes(1);

    detailPresentation = { ...queued, status: "succeeded" };
    rerender();
    await act(async () => result.current.cancel());
    expect(cancel).toHaveBeenCalledTimes(1);
    uuid.mockRestore();
  });

  it("coalesces duplicate cancel activation and never claims cancel on failure", async () => {
    post.mockResolvedValue(queued);
    const cancelRequest = deferred<BoardExecution>();
    cancel.mockReturnValue(cancelRequest.promise);
    const uuid = jest
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000016");
    const { result, rerender } = renderHook(() =>
      useRunAutomation({ boardId: "board-1", flowId: "flow-1" }),
    );
    await act(async () => result.current.run());
    detailPresentation = queued;
    rerender();

    let first!: Promise<void>;
    act(() => {
      first = result.current.cancel();
      void result.current.cancel();
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result.current.actionPending).toBe(true);

    await act(async () => {
      cancelRequest.reject(new AxiosError("offline"));
      await first;
    });
    expect(result.current.presentation).toEqual(queued);
    expect(result.current.actionPending).toBe(false);
    uuid.mockRestore();
  });

  it("blocks a new generation until pending cancel is authoritative", async () => {
    const cancelRequest = deferred<BoardExecution>();
    post.mockResolvedValue(queued);
    cancel.mockReturnValue(cancelRequest.promise);
    const uuid = jest
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000017")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000018");
    const { result, rerender } = renderHook(() =>
      useRunAutomation({ boardId: "board-1", flowId: "flow-1" }),
    );
    await act(async () => result.current.run());
    detailPresentation = queued;
    rerender();

    let cancelling!: Promise<void>;
    act(() => {
      cancelling = result.current.cancel();
    });
    detailPresentation = {
      ...queued,
      status: "failed",
      reason: "execution_failed",
    };
    rerender();
    await act(async () => result.current.runAgain());
    expect(post).toHaveBeenCalledTimes(1);
    expect(uuid).toHaveBeenCalledTimes(1);

    await act(async () => {
      cancelRequest.resolve({
        ...queued,
        status: "cancelled",
        reason: "user_cancelled",
      });
      await cancelling;
    });
    await act(async () => result.current.runAgain());
    expect(post).toHaveBeenCalledTimes(2);
    expect(uuid).toHaveBeenCalledTimes(2);
    uuid.mockRestore();
  });
});
