const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockQuery = jest.fn();
const mockMutate = jest.fn();
const mockSetQueryData = jest.fn();
const mockInvalidateQueries = jest.fn();

jest.mock("@/controllers/API/api", () => ({
  api: { get: mockApiGet, post: mockApiPost },
}));

jest.mock("@/controllers/API/helpers/constants", () => ({
  getURL: jest.fn(() => "/api/v1/boards"),
}));

jest.mock("@/controllers/API/services/request-processor", () => ({
  UseRequestProcessor: jest.fn(() => ({
    query: mockQuery,
    mutate: mockMutate,
    queryClient: {
      setQueryData: mockSetQueryData,
      invalidateQueries: mockInvalidateQueries,
    },
  })),
}));

import {
  executionQueryKeys,
  useGetAutomationRun,
  useGetAutomationRuns,
  usePostAutomationRun,
  usePostCancelAutomationRun,
} from "..";

const execution = {
  job_id: "00000000-0000-4000-8000-000000000001",
  board_id: "00000000-0000-4000-8000-000000000002",
  flow_id: "00000000-0000-4000-8000-000000000003",
  status: "queued" as const,
  reason: null,
  created_timestamp: "2026-07-21T00:00:00Z",
  finished_timestamp: null,
  result: null,
};

describe("board execution query contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReturnValue({
      data: undefined,
      error: null,
      failureCount: 0,
    });
    mockMutate.mockImplementation((_key, mutationFn, options) => ({
      mutationFn,
      options,
    }));
  });

  it("uses the frozen detail and list query keys", () => {
    expect(executionQueryKeys.detail("board-1", "flow-1", "job-1")).toEqual([
      "board-executions",
      "board-1",
      "flow-1",
      "job-1",
    ]);
    expect(executionQueryKeys.list("board-1", "flow-1")).toEqual([
      "board-executions",
      "board-1",
      "flow-1",
      "list",
    ]);
  });

  it("posts one caller-owned idempotency key unchanged through retries", async () => {
    mockApiPost.mockResolvedValue({ data: execution });
    const mutation = usePostAutomationRun({
      boardId: "board-1",
      flowId: "flow-1",
    }) as unknown as {
      mutationFn: (variables: { idempotencyKey: string }) => Promise<unknown>;
    };

    const variables = { idempotencyKey: "intent-fixed-1" };
    await mutation.mutationFn(variables);
    await mutation.mutationFn(variables);

    expect(mockApiPost).toHaveBeenNthCalledWith(
      1,
      "/api/v1/boards/board-1/automations/flow-1/runs",
      { idempotency_key: "intent-fixed-1" },
    );
    expect(mockApiPost).toHaveBeenNthCalledWith(
      2,
      "/api/v1/boards/board-1/automations/flow-1/runs",
      { idempotency_key: "intent-fixed-1" },
    );
    expect(mockMutate.mock.calls[0][0]).toEqual(
      executionQueryKeys.list("board-1", "flow-1"),
    );
  });

  it("gets one run and lists runs through the session API", async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: execution })
      .mockResolvedValueOnce({ data: [execution] });

    useGetAutomationRun({
      boardId: "board-1",
      flowId: "flow-1",
      jobId: "job-1",
    });
    const detailFn = mockQuery.mock.calls[0][1];
    await detailFn();

    useGetAutomationRuns({
      boardId: "board-1",
      flowId: "flow-1",
      limit: 12,
    });
    const listFn = mockQuery.mock.calls[1][1];
    await listFn();

    expect(mockApiGet).toHaveBeenNthCalledWith(
      1,
      "/api/v1/boards/board-1/automations/flow-1/runs/job-1",
    );
    expect(mockApiGet).toHaveBeenNthCalledWith(
      2,
      "/api/v1/boards/board-1/automations/flow-1/runs",
      { params: { limit: 12 } },
    );
  });

  it.each([0, 51, 1.5, Number.NaN])(
    "rejects invalid list limit %s before HTTP",
    async (limit) => {
      useGetAutomationRuns({
        boardId: "board-1",
        flowId: "flow-1",
        limit,
      });
      const listFn = mockQuery.mock.calls[0][1];

      await expect(listFn()).rejects.toThrow(RangeError);
      expect(mockApiGet).not.toHaveBeenCalled();
    },
  );

  it("cancels server-side and stores the authoritative returned DTO", async () => {
    const cancelled = {
      ...execution,
      status: "cancelled" as const,
      reason: "user_cancelled" as const,
    };
    mockApiPost.mockResolvedValue({ data: cancelled });
    const mutation = usePostCancelAutomationRun({
      boardId: "board-1",
      flowId: "flow-1",
      jobId: "job-1",
    }) as unknown as {
      mutationFn: () => Promise<unknown>;
      options: { onSuccess: (data: typeof cancelled) => Promise<void> };
    };

    const result = await mutation.mutationFn();
    await mutation.options.onSuccess(result as typeof cancelled);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/api/v1/boards/board-1/automations/flow-1/runs/job-1/cancel",
    );
    expect(mockSetQueryData).toHaveBeenCalledWith(
      executionQueryKeys.detail("board-1", "flow-1", "job-1"),
      cancelled,
    );
  });
});
