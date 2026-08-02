import type {
  Interrupt,
  InterruptCancelFn,
  InterruptResolveFn,
  UseInterruptConfig,
} from "@copilotkit/react-core/v2";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

import { useFlowCommandInterrupt } from "../use-flow-command-interrupt";

type Decision = Readonly<{ approved: boolean }>;
type Config = UseInterruptConfig<unknown, Decision, true, unknown>;
let captured: Config | undefined;
const mockUseInterrupt = jest.fn((config: Config) => {
  captured = config;
});

jest.mock("@copilotkit/react-core/v2", () => ({
  useInterrupt: (config: Config) => mockUseInterrupt(config),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

function Harness() {
  useFlowCommandInterrupt("ketos-chat--reconnect");
  return null;
}

function wrappedInterrupt(type = "ketos.flow-command-confirmation.v1") {
  return {
    id: "wrapped-reconnect-interrupt",
    reason: "confirmation",
    metadata: {
      langgraph: {
        raw: {
          metadata: {
            type,
            proposalId: "proposal-reconnect",
            proposalHash: "a".repeat(64),
            preview: {
              before: {
                revision: 1,
                hash: "b".repeat(64),
                node_count: 1,
                edge_count: 0,
              },
              after: {
                revision: 2,
                hash: "c".repeat(64),
                node_count: 1,
                edge_count: 0,
              },
              operationSummaries: [
                {
                  index: 0,
                  op: "set_parameter",
                  status: "applied",
                  summary: "Update prompt",
                  affectedNodeIds: ["agent"],
                  affectedEdges: [],
                },
              ],
              warnings: [],
              risk: "low",
              canRestore: true,
            },
          },
        },
      },
    },
  } as Interrupt;
}

function config(): Config {
  if (!captured) throw new Error("interrupt hook not registered");
  return captured;
}

function renderInterrupt(
  interrupt: Interrupt,
  resolve: InterruptResolveFn<Decision>,
) {
  const cancel: InterruptCancelFn = jest.fn(() => Promise.resolve());
  const element: ReactElement = config().render({
    event: { name: "on_interrupt", value: interrupt },
    interrupt,
    interrupts: [interrupt],
    result: null,
    resolve,
    cancel,
  });
  return { ...render(element), cancel };
}

it("keeps the official wrapper and exact standard resolve contract", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const interrupt = wrappedInterrupt();
  expect(config().agentId).toBe("ketos-chat--reconnect");
  expect(config().renderInChat).toBe(true);
  expect(config().enabled?.({ name: "on_interrupt", value: interrupt })).toBe(
    true,
  );
  const resolve = jest.fn(() => new Promise<void>(() => undefined));
  const view = renderInterrupt(interrupt, resolve);
  await user.click(screen.getByRole("button", { name: "flowCommand.approve" }));
  expect(resolve).toHaveBeenCalledWith(
    { approved: true },
    "wrapped-reconnect-interrupt",
  );
  expect(view.cancel).not.toHaveBeenCalled();
  view.unmount();
  renderInterrupt(interrupt, resolve);
  expect(
    screen.getByRole("button", { name: "flowCommand.approve" }),
  ).toBeDisabled();
  expect(resolve).toHaveBeenCalledTimes(1);
});

it("continues to reject non-standard reconnect metadata", () => {
  render(<Harness />);
  expect(
    config().enabled?.({
      name: "on_interrupt",
      value: wrappedInterrupt("attacker.command"),
    }),
  ).toBe(false);
});
