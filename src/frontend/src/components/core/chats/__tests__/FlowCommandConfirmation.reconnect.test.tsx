import type { InterruptResolveFn } from "@copilotkit/react-core/v2";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FlowCommandInterrupt } from "@/types/flow";
import { FlowCommandConfirmation } from "../FlowCommandConfirmation";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

const command = (id: string): FlowCommandInterrupt => ({
  interrupt: { id, reason: "confirmation" },
  metadata: {
    type: "ketos.flow-command-confirmation.v1",
    proposalId: `proposal-${id}`,
    proposalHash: "a".repeat(64),
    preview: {
      before: { revision: 1, hash: "b".repeat(64), nodeCount: 1, edgeCount: 0 },
      after: { revision: 2, hash: "c".repeat(64), nodeCount: 1, edgeCount: 0 },
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
});

describe("FlowCommandConfirmation reconnect", () => {
  it("keeps an in-flight interrupt one-use and busy across remount", async () => {
    const user = userEvent.setup();
    const resolve = jest.fn(() => new Promise<void>(() => undefined));
    const current = command("reconnect-one-use");
    const first = render(
      <FlowCommandConfirmation commands={[current]} resolve={resolve} />,
    );
    await user.click(
      screen.getByRole("button", { name: "flowCommand.approve" }),
    );
    expect(resolve).toHaveBeenCalledWith(
      { approved: true },
      "reconnect-one-use",
    );
    first.unmount();
    render(<FlowCommandConfirmation commands={[current]} resolve={resolve} />);
    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "flowCommand.approve" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "flowCommand.reject" }),
    ).toBeDisabled();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("allows retry after a rejected resolution", async () => {
    const user = userEvent.setup();
    const resolve = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined) as InterruptResolveFn<{
      approved: boolean;
    }>;
    render(
      <FlowCommandConfirmation
        commands={[command("reconnect-retry")]}
        resolve={resolve}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "flowCommand.approve" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "flowCommand.submitError",
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "flowCommand.approve" }),
    );
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("announces and focuses only the first presentation of an interrupt", () => {
    const external = document.createElement("button");
    external.textContent = "external";
    document.body.append(external);
    external.focus();
    const current = command("reconnect-presentation");
    const first = render(
      <FlowCommandConfirmation
        commands={[current]}
        resolve={jest.fn(() => Promise.resolve())}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "flowCommand.restored",
    );
    expect(screen.getByRole("region")).toHaveFocus();
    first.unmount();
    external.focus();
    render(
      <FlowCommandConfirmation
        commands={[current]}
        resolve={jest.fn(() => Promise.resolve())}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(external).toHaveFocus();
  });
});
