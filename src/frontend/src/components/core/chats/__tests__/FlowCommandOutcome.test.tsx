import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CommandProposalResult } from "@/controllers/API/queries/commands";
import { FlowCommandOutcome } from "../FlowCommandOutcome";

const mockGet = jest.fn();
const mockMutate = jest.fn();

jest.mock("@/controllers/API/queries/commands", () => ({
  useGetCommandProposal: (...args: unknown[]) => mockGet(...args),
  useRestoreFlowSnapshot: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
  }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

const proposal = (
  status: CommandProposalResult["status"],
): CommandProposalResult => ({
  id: "proposal-1",
  sourceKind: "ai_run",
  sourceProposalId: null,
  flowId: "flow-1",
  status,
  pinnedFlowVersionId: status === "applied" ? "version-1" : null,
  outcome: status === "applied" ? { code: "applied", afterRevision: 7 } : null,
});

describe("FlowCommandOutcome", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("polls awaiting proposals, stops at terminal state, and restores from server outcome", async () => {
    const user = userEvent.setup();
    mockGet.mockReturnValue({
      data: proposal("applied"),
      isLoading: false,
      isError: false,
    });

    render(<FlowCommandOutcome proposalId="proposal-1" />);

    const queryOptions = mockGet.mock.calls[0][1];
    expect(
      queryOptions.refetchInterval({
        state: { data: proposal("awaiting_confirmation") },
      }),
    ).toBe(250);
    expect(
      queryOptions.refetchInterval({ state: { data: proposal("applied") } }),
    ).toBe(false);
    expect(screen.getByText("flowCommand.outcome.applied")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /flowcommand\.restore/i }),
    );
    expect(mockMutate).toHaveBeenCalledWith({
      proposalId: "proposal-1",
      idempotencyKey: "restore:proposal-1:7",
      expectedFlowRevision: 7,
    });
  });

  it("renders an authoritative rejected outcome without a restore action", () => {
    mockGet.mockReturnValue({
      data: proposal("rejected"),
      isLoading: false,
      isError: false,
    });

    render(<FlowCommandOutcome proposalId="proposal-1" />);

    expect(
      screen.getByText("flowCommand.outcome.rejected"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /flowcommand\.restore/i }),
    ).not.toBeInTheDocument();
  });
});
