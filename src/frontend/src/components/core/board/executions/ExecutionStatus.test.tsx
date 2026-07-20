import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { BoardExecution } from "@/controllers/API/queries/executions";

import { ExecutionStatus } from "./ExecutionStatus";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

const execution: BoardExecution = {
  job_id: "job-1",
  board_id: "board-1",
  flow_id: "flow-1",
  status: "queued",
  reason: null,
  created_timestamp: "2026-07-21T00:00:00Z",
  finished_timestamp: null,
  result: null,
};

const actions = {
  onCancel: jest.fn(),
  onCheckStatus: jest.fn(),
  onRunAgain: jest.fn(),
  onOpenResult: jest.fn(),
};

describe("ExecutionStatus", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [
      "queued",
      "board.execution.status.queued",
      "board.execution.reason.waitingToStart",
      "board.execution.action.cancel",
    ],
    [
      "running",
      "board.execution.status.running",
      "board.execution.reason.flowRunning",
      "board.execution.action.cancel",
    ],
    [
      "succeeded",
      "board.execution.status.succeeded",
      "board.execution.reason.resultReady",
      "board.execution.action.openResult",
    ],
    [
      "failed",
      "board.execution.status.failed",
      "board.execution.reason.executionFailed",
      "board.execution.action.runAgain",
    ],
    [
      "cancelled",
      "board.execution.status.cancelled",
      "board.execution.reason.cancelled",
      "board.execution.action.runAgain",
    ],
  ] as const)(
    "renders %s with label, bounded reason, icon and safe action",
    (status, label, reason, action) => {
      const { container } = render(
        <ExecutionStatus
          execution={{
            ...execution,
            status,
            reason: status === "failed" ? "execution_failed" : null,
          }}
          {...actions}
        />,
      );

      expect(screen.getByText(label)).toBeVisible();
      expect(screen.getByText(reason)).toBeVisible();
      expect(screen.getByRole("button", { name: action })).toBeVisible();
      expect(container.querySelector("svg")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    },
  );

  it.each([
    ["enqueue_failed", "board.execution.reason.enqueueFailed"],
    ["execution_failed", "board.execution.reason.executionFailed"],
    ["timed_out", "board.execution.reason.timedOut"],
    ["backend_restarted", "board.execution.reason.backendRestarted"],
  ] as const)("maps failed reason %s without raw output", (reason, key) => {
    render(
      <ExecutionStatus
        execution={{ ...execution, status: "failed", reason }}
        {...actions}
      />,
    );

    expect(screen.getByText(key)).toBeVisible();
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
  });

  it.each([
    ["user_cancelled", "board.execution.reason.cancelledByUser"],
    ["system_cancelled", "board.execution.reason.cancelledBySystem"],
  ] as const)("maps cancellation reason %s", (reason, key) => {
    render(
      <ExecutionStatus
        execution={{ ...execution, status: "cancelled", reason }}
        {...actions}
      />,
    );
    expect(screen.getByText(key)).toBeVisible();
  });

  it("renders unknown with only Check status and never blind Run again", async () => {
    const user = userEvent.setup();
    render(
      <ExecutionStatus
        execution={{ status: "unknown", lastKnown: execution }}
        {...actions}
      />,
    );

    expect(screen.getByText("board.execution.status.unknown")).toBeVisible();
    expect(
      screen.getByText("board.execution.reason.noAuthoritativeResponse"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "board.execution.action.runAgain" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "board.execution.action.checkStatus",
      }),
    );
    expect(actions.onCheckStatus).toHaveBeenCalledTimes(1);
  });

  it("dispatches only the action owned by the current authoritative state", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ExecutionStatus execution={execution} {...actions} />,
    );
    await user.click(
      screen.getByRole("button", { name: "board.execution.action.cancel" }),
    );
    expect(actions.onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <ExecutionStatus
        execution={{ ...execution, status: "succeeded" }}
        {...actions}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "board.execution.action.openResult" }),
    );
    expect(actions.onOpenResult).toHaveBeenCalledTimes(1);
  });
});
