import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Interrupt,
  InterruptCancelFn,
  InterruptResolveFn,
  UseInterruptConfig,
} from "@copilotkit/react-core/v2";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import CopilotKitInterruptProbe from "../copilotkit-interrupt-probe";

type ApprovalDecision = Readonly<{ approved: boolean }>;
type ProbeInterruptConfig = UseInterruptConfig<
  unknown,
  ApprovalDecision,
  true,
  unknown
>;

let mockInterruptConfig: ProbeInterruptConfig | undefined;
const mockUseInterrupt = jest.fn((config: ProbeInterruptConfig) => {
  mockInterruptConfig = config;
});

jest.mock("@copilotkit/react-core/v2", () => ({
  useInterrupt: (config: ProbeInterruptConfig) => mockUseInterrupt(config),
}));

const firstInterrupt: Interrupt = {
  id: "approval-alpha",
  reason: "confirmation",
  message: "Approve alpha change?",
};

const secondInterrupt: Interrupt = {
  id: "approval-beta",
  reason: "confirmation",
  message: "Approve beta change?",
};

function getInterruptConfig(): ProbeInterruptConfig {
  if (!mockInterruptConfig) {
    throw new Error("useInterrupt was not registered");
  }
  return mockInterruptConfig;
}

function renderInterrupts(
  interrupts: Interrupt[],
  resolve: InterruptResolveFn<ApprovalDecision>,
  cancel: InterruptCancelFn,
): void {
  const primaryInterrupt = interrupts[0] ?? null;
  const element: ReactElement = getInterruptConfig().render({
    event: { name: "on_interrupt", value: primaryInterrupt },
    interrupt: primaryInterrupt,
    interrupts,
    result: null,
    resolve,
    cancel,
  });

  render(element);
}

function createResolveMock() {
  return jest.fn<Promise<void>, [ApprovalDecision, string?]>(() =>
    Promise.resolve(),
  );
}

function createCancelMock() {
  return jest.fn<Promise<void>, [string?]>(() => Promise.resolve());
}

describe("CopilotKitInterruptProbe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInterruptConfig = undefined;
    render(<CopilotKitInterruptProbe />);
  });

  it("should register the official interrupt hook for the probe agent", () => {
    expect(mockUseInterrupt).toHaveBeenCalledTimes(1);
    expect(getInterruptConfig()).toEqual(
      expect.objectContaining({
        agentId: "ketos-mvp-probe",
        renderInChat: true,
      }),
    );
  });

  it("should render a distinct accessible card for every open interrupt", () => {
    renderInterrupts(
      [firstInterrupt, secondInterrupt],
      createResolveMock(),
      createCancelMock(),
    );

    expect(
      screen.getByRole("region", {
        name: "Approval request approval-alpha",
      }),
    ).toHaveTextContent("Approve alpha change?");
    expect(
      screen.getByRole("region", {
        name: "Approval request approval-beta",
      }),
    ).toHaveTextContent("Approve beta change?");
    expect(screen.getByText("approval-alpha")).toBeInTheDocument();
    expect(screen.getByText("approval-beta")).toBeInTheDocument();
  });

  it("should use the official reason when an interrupt has no message", () => {
    const interruptWithoutMessage: Interrupt = {
      id: "approval-no-message",
      reason: "confirmation",
    };
    renderInterrupts(
      [interruptWithoutMessage],
      createResolveMock(),
      createCancelMock(),
    );

    expect(screen.getByText("confirmation")).toBeInTheDocument();
  });

  it.each(["", "  \n\t  "])(
    "should fall back to the official reason when the message is blank",
    (message) => {
      const interruptWithBlankMessage: Interrupt = {
        id: "approval-blank-message",
        reason: "confirmation",
        message,
      };
      renderInterrupts(
        [interruptWithBlankMessage],
        createResolveMock(),
        createCancelMock(),
      );

      expect(screen.getByText("confirmation")).toBeInTheDocument();
    },
  );

  it("should resolve approval for only the selected interrupt", async () => {
    const user = userEvent.setup();
    const resolve = createResolveMock();
    renderInterrupts(
      [firstInterrupt, secondInterrupt],
      resolve,
      createCancelMock(),
    );

    await user.click(
      screen.getByRole("button", { name: "Approve approval-alpha" }),
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ approved: true }, "approval-alpha");
  });

  it("should resolve rejection for only the selected interrupt", async () => {
    const user = userEvent.setup();
    const resolve = createResolveMock();
    renderInterrupts(
      [firstInterrupt, secondInterrupt],
      resolve,
      createCancelMock(),
    );

    await user.click(
      screen.getByRole("button", { name: "Reject approval-beta" }),
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ approved: false }, "approval-beta");
  });

  it("should keep approval and rejection isolated across two open interrupts", async () => {
    const user = userEvent.setup();
    const resolve = createResolveMock();
    renderInterrupts(
      [firstInterrupt, secondInterrupt],
      resolve,
      createCancelMock(),
    );

    await user.click(
      screen.getByRole("button", { name: "Approve approval-alpha" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Reject approval-beta" }),
    );

    expect(resolve.mock.calls).toEqual([
      [{ approved: true }, "approval-alpha"],
      [{ approved: false }, "approval-beta"],
    ]);
  });

  it("should isolate pending decisions between interrupt cards", async () => {
    const user = userEvent.setup();
    let releaseFirstDecision: (() => void) | undefined;
    const resolve = jest.fn<Promise<void>, [ApprovalDecision, string?]>(
      (_decision, interruptId) =>
        interruptId === firstInterrupt.id
          ? new Promise<void>((release) => {
              releaseFirstDecision = release;
            })
          : Promise.resolve(),
    );
    renderInterrupts(
      [firstInterrupt, secondInterrupt],
      resolve,
      createCancelMock(),
    );

    await user.click(
      screen.getByRole("button", { name: "Approve approval-alpha" }),
    );

    expect(
      screen.getByRole("button", { name: "Approve approval-alpha" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Reject approval-alpha" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Approve approval-beta" }),
    ).toBeEnabled();
    releaseFirstDecision?.();
  });

  it("should submit only one decision for a rapid double click", async () => {
    const user = userEvent.setup();
    const resolve = createResolveMock();
    renderInterrupts([firstInterrupt], resolve, createCancelMock());

    await user.dblClick(
      screen.getByRole("button", { name: "Approve approval-alpha" }),
    );

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("should re-enable only the failed card for a deliberate retry", async () => {
    const user = userEvent.setup();
    const resolve = jest
      .fn<Promise<void>, [ApprovalDecision, string?]>()
      .mockRejectedValueOnce(new Error("secret upstream detail"))
      .mockResolvedValue(undefined);
    renderInterrupts(
      [firstInterrupt, secondInterrupt],
      resolve,
      createCancelMock(),
    );

    await user.click(
      screen.getByRole("button", { name: "Reject approval-alpha" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Reject approval-alpha" }),
      ).toBeEnabled();
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Decision could not be submitted. Try again.",
    );
    expect(
      screen.queryByText("secret upstream detail"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approve approval-beta" }),
    ).toBeEnabled();

    await user.click(
      screen.getByRole("button", { name: "Reject approval-alpha" }),
    );
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("should locally close and reopen an interrupt without resolving or cancelling", async () => {
    const user = userEvent.setup();
    const resolve = createResolveMock();
    const cancel = createCancelMock();
    renderInterrupts([firstInterrupt], resolve, cancel);

    await user.click(
      screen.getByRole("button", {
        name: "Close approval request approval-alpha",
      }),
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", {
        name: "Reopen approval request approval-alpha",
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Reopen approval request approval-alpha",
      }),
    );
    expect(
      screen.getByRole("region", {
        name: "Approval request approval-alpha",
      }),
    ).toHaveTextContent("Approve alpha change?");
  });

  it("should move focus to reopen when close is activated by keyboard", async () => {
    const user = userEvent.setup();
    const resolve = createResolveMock();
    const cancel = createCancelMock();
    renderInterrupts([firstInterrupt], resolve, cancel);
    const closeButton = screen.getByRole("button", {
      name: "Close approval request approval-alpha",
    });
    closeButton.focus();

    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("button", {
        name: "Reopen approval request approval-alpha",
      }),
    ).toHaveFocus();
    expect(resolve).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("should restore focus to the reopened card's close control", async () => {
    const user = userEvent.setup();
    renderInterrupts([firstInterrupt], createResolveMock(), createCancelMock());

    await user.click(
      screen.getByRole("button", {
        name: "Close approval request approval-alpha",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Reopen approval request approval-alpha",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Close approval request approval-alpha",
        }),
      ).toHaveFocus();
    });
  });

  it("should locally dismiss on Escape without resolving or cancelling", async () => {
    const user = userEvent.setup();
    const resolve = createResolveMock();
    const cancel = createCancelMock();
    renderInterrupts([firstInterrupt], resolve, cancel);
    const card = screen.getByRole("region", {
      name: "Approval request approval-alpha",
    });
    card.focus();

    await user.keyboard("{Escape}");

    expect(resolve).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", {
        name: "Reopen approval request approval-alpha",
      }),
    ).toBeInTheDocument();
  });

  it("should avoid forbidden transport and legacy event implementation", () => {
    const source = readFileSync(
      join(__dirname, "..", "copilotkit-interrupt-probe.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/\bany\b|\sas\s/);
    expect(source).not.toMatch(
      /\bevent\b|RunAgentInput|forwardedProps|\bresume\b|dispatchEvent|\bfetch\b|EventSource|CustomEvent|use-assistant-chat|use-post-assist-stream|apply-flow-update/,
    );
  });

  it("should preserve the installed exact decision and render mode generics", () => {
    const source = readFileSync(
      join(__dirname, "..", "copilotkit-interrupt-probe.tsx"),
      "utf8",
    );

    expect(source).toContain("useInterrupt<ApprovalDecision, true>");
    expect(source).toContain("resolve: InterruptResolveFn<ApprovalDecision>");
  });
});
