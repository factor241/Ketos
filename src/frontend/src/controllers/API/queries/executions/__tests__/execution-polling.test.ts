import { AxiosError } from "axios";

const mockQuery = jest.fn();

jest.mock("@/controllers/API/services/request-processor", () => ({
  UseRequestProcessor: jest.fn(() => ({ query: mockQuery })),
}));

jest.mock("@/controllers/API/api", () => ({
  api: { get: jest.fn() },
}));

jest.mock("@/controllers/API/helpers/constants", () => ({
  getURL: jest.fn(() => "/api/v1/boards"),
}));

import type { BoardExecution } from "../types";
import {
  executionRetryDelay,
  useGetAutomationRun,
} from "../use-get-automation-run";

const baseExecution: BoardExecution = {
  job_id: "job-1",
  board_id: "board-1",
  flow_id: "flow-1",
  status: "queued",
  reason: null,
  created_timestamp: "2026-07-21T00:00:00Z",
  finished_timestamp: null,
  result: null,
};

describe("board execution polling and presentation", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(["queued", "running"] as const)(
    "polls %s every 1000 ms",
    (status) => {
      mockQuery.mockReturnValue({
        data: { ...baseExecution, status },
        error: null,
        failureCount: 0,
      });
      useGetAutomationRun({
        boardId: "board-1",
        flowId: "flow-1",
        jobId: "job-1",
      });
      const options = mockQuery.mock.calls[0][2];
      expect(
        options.refetchInterval({
          state: { data: { ...baseExecution, status } },
        }),
      ).toBe(1000);
    },
  );

  it.each(["succeeded", "failed", "cancelled"] as const)(
    "stops polling on authoritative %s",
    (status) => {
      mockQuery.mockReturnValue({
        data: { ...baseExecution, status },
        error: null,
        failureCount: 0,
      });
      useGetAutomationRun({
        boardId: "board-1",
        flowId: "flow-1",
        jobId: "job-1",
      });
      const options = mockQuery.mock.calls[0][2];
      expect(
        options.refetchInterval({
          state: { data: { ...baseExecution, status } },
        }),
      ).toBe(false);
    },
  );

  it("does not poll without an authoritative DTO", () => {
    mockQuery.mockReturnValue({
      data: undefined,
      error: { isAxiosError: true, response: { status: 404 } },
      failureReason: null,
      failureCount: 1,
    });
    useGetAutomationRun({
      boardId: "board-1",
      flowId: "flow-1",
      jobId: "job-1",
    });
    const options = mockQuery.mock.calls[0][2];

    expect(options.refetchInterval({ state: { data: undefined } })).toBe(false);
  });

  it("exposes transport loss as unknown while preserving the cached DTO", () => {
    const terminal = { ...baseExecution, status: "succeeded" as const };
    mockQuery.mockReturnValue({
      data: terminal,
      error: null,
      failureReason: new AxiosError("offline"),
      failureCount: 1,
    });

    const result = useGetAutomationRun({
      boardId: "board-1",
      flowId: "flow-1",
      jobId: "job-1",
    });

    expect(result.data).toBe(terminal);
    expect(result.presentation).toEqual({
      status: "unknown",
      lastKnown: terminal,
    });
  });

  it("does not turn an HTTP response error into unknown", () => {
    const terminal = { ...baseExecution, status: "failed" as const };
    mockQuery.mockReturnValue({
      data: terminal,
      error: { isAxiosError: true, response: { status: 503 } },
      failureCount: 1,
    });

    const result = useGetAutomationRun({
      boardId: "board-1",
      flowId: "flow-1",
      jobId: "job-1",
    });

    expect(result.presentation).toBe(terminal);
  });

  it("does not invent an unknown state without a known job", () => {
    mockQuery.mockReturnValue({
      data: undefined,
      error: new AxiosError("offline"),
      failureCount: 1,
    });

    const result = useGetAutomationRun({
      boardId: "board-1",
      flowId: "flow-1",
      jobId: "job-1",
    });

    expect(result.presentation).toBeUndefined();
  });

  it("uses bounded exponential retry delays", () => {
    expect([0, 1, 2, 3, 20].map(executionRetryDelay)).toEqual([
      1000, 2000, 4000, 8000, 8000,
    ]);
  });
});
