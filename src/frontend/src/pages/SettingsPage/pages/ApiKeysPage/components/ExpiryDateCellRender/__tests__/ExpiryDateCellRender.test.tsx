import { render, screen } from "@testing-library/react";
import type { CustomCellRendererProps } from "ag-grid-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import ExpiryDateCellRender from "../index";

jest.mock("@/components/core/dateReaderComponent", () => ({
  __esModule: true,
  default: ({ date }: { date: string }) => (
    <span data-testid="date-reader">{date}</span>
  ),
}));

const renderWithProvider = (ui: React.ReactElement) =>
  render(<TooltipProvider>{ui}</TooltipProvider>);

type TestCellRendererProps = CustomCellRendererProps<
  undefined,
  string | null | undefined,
  undefined
>;

const mockRowNode = {} as TestCellRendererProps["node"];
const mockGridApi = {} as TestCellRendererProps["api"];

function createCellRendererProps(
  value: TestCellRendererProps["value"],
): TestCellRendererProps {
  const eGridCell = document.createElement("div");

  return {
    api: mockGridApi,
    context: undefined,
    value,
    valueFormatted: null,
    data: undefined,
    node: mockRowNode,
    eGridCell,
    eParentOfValue: eGridCell,
    registerRowDragger: jest.fn(),
    setTooltip: jest.fn(),
  };
}

describe("ExpiryDateCellRender", () => {
  it("renders DateReader when a date value is provided", () => {
    renderWithProvider(
      <ExpiryDateCellRender
        {...createCellRendererProps("2025-06-01T00:00:00Z")}
      />,
    );
    expect(screen.getByTestId("date-reader")).toBeInTheDocument();
    expect(screen.getByTestId("date-reader")).toHaveTextContent(
      "2025-06-01T00:00:00Z",
    );
  });

  it("renders infinity symbol when value is null", () => {
    renderWithProvider(
      <ExpiryDateCellRender {...createCellRendererProps(null)} />,
    );
    expect(screen.getByText("∞")).toBeInTheDocument();
    expect(screen.queryByTestId("date-reader")).not.toBeInTheDocument();
  });

  it("renders infinity symbol when value is undefined", () => {
    renderWithProvider(
      <ExpiryDateCellRender {...createCellRendererProps(undefined)} />,
    );
    expect(screen.getByText("∞")).toBeInTheDocument();
    expect(screen.queryByTestId("date-reader")).not.toBeInTheDocument();
  });

  it("renders infinity symbol when value is an empty string", () => {
    renderWithProvider(
      <ExpiryDateCellRender {...createCellRendererProps("")} />,
    );
    expect(screen.getByText("∞")).toBeInTheDocument();
  });
});
