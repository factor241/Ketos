jest.unmock("react-i18next");

import type {
  Interrupt,
  InterruptCancelFn,
  InterruptResolveFn,
  UseInterruptConfig,
} from "@copilotkit/react-core/v2";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

import i18n from "@/i18n";
import { useFlowCommandInterrupt } from "../use-flow-command-interrupt";

type Decision = Readonly<{ approved: boolean }>;
type Config = UseInterruptConfig<unknown, Decision, true, unknown>;

let interruptConfig: Config | undefined;
const mockOnResolved = jest.fn();
const mockUseInterrupt = jest.fn((config: Config) => {
  interruptConfig = config;
});

jest.mock("@copilotkit/react-core/v2", () => ({
  useInterrupt: (config: Config) => mockUseInterrupt(config),
}));

function Harness() {
  useFlowCommandInterrupt("ketos-chat--thread", mockOnResolved);
  return null;
}

function commandInterrupt(id: string): Interrupt {
  return {
    id,
    reason: "confirmation",
    metadata: {
      type: "ketos.flow-command-confirmation.v1",
      proposalId: `proposal-${id}`,
      proposalHash: "a".repeat(64),
      preview: {
        before: {
          revision: 3,
          hash: "b".repeat(64),
          nodeCount: 1,
          edgeCount: 0,
        },
        after: {
          revision: 4,
          hash: "c".repeat(64),
          nodeCount: 1,
          edgeCount: 0,
        },
        operationSummaries: [
          {
            index: 0,
            op: "set_parameter",
            status: "applied",
            summary: `Update ${id}`,
            affectedNodeIds: ["agent"],
            affectedEdges: [],
          },
        ],
        warnings: [],
        risk: "low",
        canRestore: true,
      },
    },
  };
}

function wrappedCommandInterrupt(id: string): Interrupt {
  const direct = commandInterrupt(id);
  const metadata = direct.metadata as Record<string, unknown>;
  const preview = metadata.preview as Record<string, unknown>;
  const before = preview.before as Record<string, unknown>;
  const after = preview.after as Record<string, unknown>;
  return {
    ...direct,
    metadata: {
      langgraph: {
        raw: {
          metadata: {
            ...metadata,
            preview: {
              ...preview,
              before: {
                revision: before.revision,
                hash: before.hash,
                node_count: before.nodeCount,
                edge_count: before.edgeCount,
              },
              after: {
                revision: after.revision,
                hash: after.hash,
                node_count: after.nodeCount,
                edge_count: after.edgeCount,
              },
            },
          },
        },
      },
    },
  };
}

function config(): Config {
  if (!interruptConfig) throw new Error("interrupt hook not registered");
  return interruptConfig;
}

function renderCommands(
  interrupts: Interrupt[],
  resolve: InterruptResolveFn<Decision>,
) {
  const cancel: InterruptCancelFn = jest.fn(() => Promise.resolve());
  const primary = interrupts[0] ?? null;
  const element: ReactElement = config().render({
    event: { name: "on_interrupt", value: primary },
    interrupt: primary,
    interrupts,
    result: null,
    resolve,
    cancel,
  });
  render(element);
  return cancel;
}

describe("FlowCommandConfirmation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ru");
    jest.clearAllMocks();
    interruptConfig = undefined;
    render(<Harness />);
  });

  it("filters by the Ketos metadata discriminator and renders every open command", () => {
    const first = commandInterrupt("one");
    const second = commandInterrupt("two");
    expect(config().agentId).toBe("ketos-chat--thread");
    expect(config().renderInChat).toBe(true);
    expect(config().enabled?.({ name: "on_interrupt", value: first })).toBe(
      true,
    );
    expect(
      config().enabled?.({
        name: "on_interrupt",
        value: { ...first, metadata: undefined },
      }),
    ).toBe(false);

    renderCommands(
      [first, second],
      jest.fn(() => Promise.resolve()),
    );
    expect(screen.getByText("Update one")).toBeInTheDocument();
    expect(screen.getByText("Update two")).toBeInTheDocument();
    expect(screen.getAllByText("Ревизия 3 → 4")).toHaveLength(2);
  });

  it("accepts the official AG-UI LangGraph wrapper and normalizes snapshot fields", () => {
    const wrapped = wrappedCommandInterrupt("wrapped");
    expect(config().enabled?.({ name: "on_interrupt", value: wrapped })).toBe(
      true,
    );

    renderCommands(
      [wrapped],
      jest.fn(() => Promise.resolve()),
    );

    expect(screen.getByText("Update wrapped")).toBeInTheDocument();
    expect(screen.getByText("Ревизия 3 → 4")).toBeInTheDocument();
  });

  it("submits exact per-interrupt decisions and dismisses locally without cancel", async () => {
    const user = userEvent.setup();
    const resolve = jest.fn<Promise<void>, [Decision, string?]>(() =>
      Promise.resolve(),
    );
    const cancel = renderCommands(
      [commandInterrupt("one"), commandInterrupt("two")],
      resolve,
    );
    const cards = screen.getAllByRole("region", {
      name: "Подтверждение изменений flow",
    });

    await user.click(
      within(cards[0]).getByRole("button", { name: "Применить изменения" }),
    );
    await user.click(
      within(cards[1]).getByRole("button", { name: "Отклонить" }),
    );
    expect(resolve.mock.calls).toEqual([
      [{ approved: true }, "one"],
      [{ approved: false }, "two"],
    ]);

    await user.click(
      within(cards[0]).getByRole("button", { name: "Проверить позже" }),
    );
    expect(cancel).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(
      within(cards[0]).getByRole("button", { name: "Проверить изменения" }),
    ).toBeEnabled();
  });

  it("publishes the proposal id before the runtime resume promise settles", async () => {
    const user = userEvent.setup();
    const resolve = jest.fn(() => new Promise<void>(() => undefined));
    renderCommands([commandInterrupt("pending")], resolve);

    await user.click(
      screen.getByRole("button", { name: "Применить изменения" }),
    );

    expect(resolve).toHaveBeenCalledWith({ approved: true }, "pending");
    expect(mockOnResolved).toHaveBeenCalledWith("proposal-pending");
  });
});
