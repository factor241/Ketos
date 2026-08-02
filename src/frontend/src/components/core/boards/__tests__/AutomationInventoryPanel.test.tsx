import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useGetAutomationSummaries } from "@/controllers/API/queries/flows/use-get-automation-summaries";
import type { Placement } from "@/types/board";
import { AutomationInventoryPanel } from "../AutomationInventoryPanel";

jest.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: jest.fn() },
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) =>
      values?.name ? `${key}:${values.name}` : key,
  }),
}));

jest.mock(
  "@/controllers/API/queries/flows/use-get-automation-summaries",
  () => ({
    useGetAutomationSummaries: jest.fn(),
  }),
);

const summaries = [
  { id: "flow-placed", name: "Placed Flow", description: null },
  { id: "flow-unplaced", name: "Unplaced Flow", description: "Description" },
];

const placement: Placement = {
  id: "placement-1",
  boardId: "board-1",
  targetKind: "automation",
  targetId: "flow-placed",
  x: 0,
  y: 0,
  width: 320,
  height: 240,
  zIndex: 0,
  displayState: "normal",
  revision: 0,
  createdAt: "2026-07-25T00:00:00Z",
  updatedAt: "2026-07-25T00:00:00Z",
};

describe("AutomationInventoryPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useGetAutomationSummaries as jest.Mock).mockReturnValue({
      data: summaries,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it("shows every project Flow with explicit placed and unplaced state", () => {
    render(
      <AutomationInventoryPanel
        projectId="project-1"
        placements={[placement]}
        onPlace={jest.fn()}
        onOpen={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("complementary", {
        name: "board.automation.inventory.title",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Placed Flow")).toBeInTheDocument();
    expect(screen.getByText("Unplaced Flow")).toBeInTheDocument();
    expect(
      screen.getByText("board.automation.inventory.placed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("board.automation.inventory.unplaced"),
    ).toBeInTheDocument();
  });

  it("places the original Flow and opens through the caller-owned Board context", async () => {
    const user = userEvent.setup();
    const onPlace = jest.fn();
    const onOpen = jest.fn();
    render(
      <AutomationInventoryPanel
        projectId="project-1"
        placements={[placement]}
        onPlace={onPlace}
        onOpen={onOpen}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "board.automation.inventory.place:Unplaced Flow",
      }),
    );
    expect(onPlace).toHaveBeenCalledWith(summaries[1]);

    await user.click(
      screen.getByRole("button", {
        name: "board.automation.inventory.open:Placed Flow",
      }),
    );
    expect(onOpen).toHaveBeenCalledWith(summaries[0], placement);
  });

  it("searches without losing the placement status", async () => {
    const user = userEvent.setup();
    render(
      <AutomationInventoryPanel
        projectId="project-1"
        placements={[placement]}
        onPlace={jest.fn()}
        onOpen={jest.fn()}
      />,
    );

    await user.type(
      screen.getByRole("searchbox", {
        name: "board.automation.inventory.search",
      }),
      "unplaced",
    );

    expect(screen.queryByText("Placed Flow")).not.toBeInTheDocument();
    expect(screen.getByText("Unplaced Flow")).toBeInTheDocument();
    expect(
      screen.getByText("board.automation.inventory.unplaced"),
    ).toBeInTheDocument();
  });

  it("coalesces repeated actions for the same Flow while placement is pending", async () => {
    const user = userEvent.setup();
    let finishPlacement: (() => void) | undefined;
    const onPlace = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPlacement = resolve;
        }),
    );
    render(
      <AutomationInventoryPanel
        projectId="project-1"
        placements={[placement]}
        onPlace={onPlace}
        onOpen={jest.fn()}
      />,
    );
    const placeButton = screen.getByRole("button", {
      name: "board.automation.inventory.place:Unplaced Flow",
    });

    await user.click(placeButton);
    await user.click(placeButton);

    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(placeButton).toBeDisabled();
    finishPlacement?.();
  });
});
