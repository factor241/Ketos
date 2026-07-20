import { fireEvent, render, screen } from "@testing-library/react";

import { useGetAutomationSummaries } from "@/controllers/API/queries/flows/use-get-automation-summaries";
import { AutomationSelector } from "../AutomationSelector";

jest.mock(
  "@/controllers/API/queries/flows/use-get-automation-summaries",
  () => ({ useGetAutomationSummaries: jest.fn() }),
);
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

const mockQuery = useGetAutomationSummaries as jest.Mock;
const summaries = [
  { id: "flow-1", name: "Daily report", description: "First" },
  { id: "flow-2", name: "Weekly report", description: "Second" },
];

describe("AutomationSelector", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders loading, empty, and bounded retryable error states", () => {
    mockQuery.mockReturnValue({
      isLoading: true,
      isError: false,
      refetch: jest.fn(),
    });
    const { rerender } = render(
      <AutomationSelector projectId="project-1" onSelect={jest.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "board.automation.selector.loading",
    );

    mockQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    rerender(<AutomationSelector projectId="project-1" onSelect={jest.fn()} />);
    expect(
      screen.getByText("board.automation.selector.empty"),
    ).toBeInTheDocument();

    const refetch = jest.fn();
    mockQuery.mockReturnValue({
      isLoading: false,
      isError: true,
      refetch,
    });
    rerender(<AutomationSelector projectId="project-1" onSelect={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "board.automation.selector.loadError",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "board.automation.selector.retry",
      }),
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("filters, navigates by keyboard, and selects owner-visible summaries", () => {
    const onSelect = jest.fn();
    mockQuery.mockReturnValue({
      data: summaries,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    render(<AutomationSelector projectId="project-1" onSelect={onSelect} />);
    const input = screen.getByLabelText("board.automation.selector.search");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(summaries[1]);

    fireEvent.change(input, { target: { value: "daily" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(summaries[0]);
    expect(screen.queryByText("Weekly report")).not.toBeInTheDocument();
  });

  it("selects by click and honors disabled input", () => {
    const onSelect = jest.fn();
    const onCreate = jest.fn();
    mockQuery.mockReturnValue({
      data: summaries,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    const { rerender } = render(
      <AutomationSelector
        projectId="project-1"
        onSelect={onSelect}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "board.automation.add" }),
    );
    expect(onCreate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Daily report" }));
    expect(onSelect).toHaveBeenCalledWith(summaries[0]);

    rerender(
      <AutomationSelector projectId="project-1" onSelect={onSelect} disabled />,
    );
    expect(
      screen.getByLabelText("board.automation.selector.search"),
    ).toBeDisabled();
  });
});
