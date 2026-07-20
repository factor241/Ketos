import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type ReactNode } from "react";

import type { BoardExecution } from "@/controllers/API/queries/executions";
import type { Placement } from "@/types/board";

import { ResultPlacement } from "./ResultPlacement";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

jest.mock("../BoardCardFrame", () => ({
  BoardCardFrame: ({
    title,
    children,
    onClosePlacement,
  }: {
    title: string;
    children: ReactNode;
    onClosePlacement: () => void;
  }) => (
    <section aria-label={title}>
      {children}
      <button type="button" onClick={onClosePlacement}>
        frame-close
      </button>
    </section>
  ),
}));

const placement: Placement = {
  id: "placement-result-1",
  boardId: "board-1",
  targetKind: "job_result",
  targetId: "job-1",
  x: 20,
  y: 40,
  width: 420,
  height: 280,
  zIndex: 2,
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

function callbacks() {
  return {
    onDisplayStateChange: jest.fn(),
    onClose: jest.fn(),
    onResizeEnd: jest.fn(),
    onKeyboardMove: jest.fn(),
    onKeyboardResize: jest.fn(),
  };
}

describe("ResultPlacement", () => {
  it("renders text as inert literal content", () => {
    const malicious =
      '<script>alert("owned")</script><img src=x onerror=alert(1)>';
    const { container } = render(
      <ResultPlacement
        placement={placement}
        execution={{
          ...execution,
          result: { kind: "text", value: malicious, truncated: false },
        }}
        selected={false}
        {...callbacks()}
      />,
    );

    expect(screen.getByTestId("job-result-value")).toHaveTextContent(malicious);
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("bounds JSON display and treats prototype/script-shaped values as data", () => {
    const hostile = JSON.parse(
      `{"__proto__":{"polluted":true},"markup":"<svg onload=alert(1)>","huge":"${"x".repeat(30000)}"}`,
    );
    const { container } = render(
      <ResultPlacement
        placement={placement}
        execution={{
          ...execution,
          result: { kind: "json", value: hostile, truncated: false },
        }}
        selected={false}
        {...callbacks()}
      />,
    );

    const rendered = screen.getByTestId("job-result-value").textContent ?? "";
    expect(rendered).toContain('"__proto__"');
    expect(rendered).toContain("<svg onload=alert(1)>");
    expect(rendered.length).toBeLessThanOrEqual(24 * 1024);
    expect(screen.getByText("board.result.truncated")).toBeVisible();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it.each([
    ["failed", "execution_failed", "board.execution.reason.executionFailed"],
    ["failed", "timed_out", "board.execution.reason.timedOut"],
    ["cancelled", "user_cancelled", "board.execution.reason.cancelledByUser"],
    [
      "cancelled",
      "system_cancelled",
      "board.execution.reason.cancelledBySystem",
    ],
  ] as const)("renders bounded %s reason %s", (status, reason, key) => {
    render(
      <ResultPlacement
        placement={placement}
        execution={{ ...execution, status, reason, result: null }}
        selected={false}
        {...callbacks()}
      />,
    );

    expect(screen.getByText(key)).toBeVisible();
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
  });

  it("does not render mismatched or nonterminal execution content", () => {
    const { rerender } = render(
      <ResultPlacement
        placement={{ ...placement, targetId: "other-job" }}
        execution={execution}
        selected={false}
        {...callbacks()}
      />,
    );
    expect(screen.getByText("board.result.unavailable")).toBeVisible();
    expect(screen.queryByText("done")).not.toBeInTheDocument();

    rerender(
      <ResultPlacement
        placement={placement}
        execution={{ ...execution, status: "running", result: null }}
        selected={false}
        {...callbacks()}
      />,
    );
    expect(screen.getByText("board.result.unavailable")).toBeVisible();
  });

  it("delegates close and permits the owner to restore trigger focus", async () => {
    const user = userEvent.setup();
    const triggerRef = createRef<HTMLButtonElement>();
    const onClose = jest.fn(() => triggerRef.current?.focus());
    render(
      <>
        <button ref={triggerRef} type="button">
          automation-trigger
        </button>
        <ResultPlacement
          placement={placement}
          execution={execution}
          selected={false}
          {...callbacks()}
          onClose={onClose}
        />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "frame-close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "automation-trigger" }),
    ).toHaveFocus();
  });

  it("has no generic, Markdown, HTML-injection or Flow runtime path", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/components/core/board/placements/ResultPlacement.tsx",
      ),
      "utf8",
    );
    for (const token of [
      "dangerouslySetInnerHTML",
      "ReactMarkdown",
      "objectRender",
      "DOMPurify",
      "flowStore",
      "FlowPage",
      "useReactFlow",
    ])
      expect(source).not.toContain(token);
  });
});
