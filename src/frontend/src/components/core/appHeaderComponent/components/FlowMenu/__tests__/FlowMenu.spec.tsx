import { fireEvent, render, screen } from "@testing-library/react";
import MenuBar from "../index";

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...rest }) =>
    asChild ? children : <button {...rest}>{children}</button>,
}));
jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: ({ name }) => <span data-testid="icon">{name}</span>,
}));
jest.mock("@/components/common/shadTooltipComponent", () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
}));
jest.mock("@/components/core/flowSettingsComponent", () => ({
  __esModule: true,
  default: () => <div data-testid="flow-settings" />,
}));
jest.mock(
  "@/controllers/API/queries/flows/use-get-refresh-flows-query",
  () => ({ __esModule: true, useGetRefreshFlowsQuery: () => ({}) }),
);
jest.mock("@/controllers/API/queries/folders/use-get-folders", () => ({
  __esModule: true,
  useGetFoldersQuery: () => ({
    data: [{ id: "f1", name: "Folder" }],
    isFetched: true,
  }),
}));
const mockSave = jest.fn(() => Promise.resolve());
const mockNavigate = jest.fn();
let mockReturnUrl: string | null = null;
jest.mock("@/hooks/flows/use-save-flow", () => ({
  __esModule: true,
  default: () => mockSave,
}));
jest.mock("@/hooks/use-unsaved-changes", () => ({
  __esModule: true,
  useUnsavedChanges: () => true,
}));
jest.mock("@/customization/hooks/use-custom-navigate", () => ({
  __esModule: true,
  useCustomNavigate: () => mockNavigate,
}));
jest.mock("@/pages/FlowPage/hooks/use-board-return-context", () => ({
  useBoardReturnContext: () => ({
    returnUrl: mockReturnUrl,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("@/stores/flowsManagerStore", () => ({
  __esModule: true,
  default: (sel) =>
    sel({
      autoSaving: false,
      saveLoading: false,
      currentFlow: { updated_at: new Date().toISOString() },
    }),
}));
jest.mock("@/stores/alertStore", () => ({
  __esModule: true,
  default: (sel) => sel({ setSuccessData: jest.fn() }),
}));
jest.mock("@/stores/flowStore", () => ({
  __esModule: true,
  default: (sel) =>
    sel({
      onFlowPage: true,
      isBuilding: false,
      currentFlow: {
        id: "1",
        name: "Flow",
        folder_id: "f1",
        icon: "Workflow",
        gradient: "0",
        locked: false,
      },
    }),
}));
jest.mock("@/stores/shortcuts", () => ({
  __esModule: true,
  useShortcutsStore: (sel) => sel({ changesSave: "mod+s" }),
}));

// Avoid pulling utils that depend on darkStore
jest.mock("@/utils/utils", () => ({
  __esModule: true,
  cn: (...args) => args.filter(Boolean).join(" "),
  getNumberFromString: () => 0,
}));

// styleUtils imports lucide dynamic icons; stub to avoid resolution
jest.mock("lucide-react/dynamicIconImports", () => ({}), { virtual: true });

describe("FlowMenu MenuBar", () => {
  beforeEach(() => {
    mockReturnUrl = null;
    mockNavigate.mockClear();
  });
  it("renders current folder and flow name, enables save", async () => {
    render(<MenuBar />);
    expect(screen.getByTestId("menu_bar_wrapper")).toBeInTheDocument();
    expect(screen.getByText("Folder")).toBeInTheDocument();
    expect(screen.getByTestId("flow_name").textContent).toBe("Flow");

    const saveBtn = screen.getByTestId("save-flow-button");
    expect(saveBtn).not.toBeDisabled();
  });

  it("clicking save calls save flow", () => {
    mockSave.mockClear();
    render(<MenuBar />);
    fireEvent.click(screen.getByTestId("save-flow-button"));
    expect(mockSave).toHaveBeenCalled();
  });

  it("shows a real validated Return href and navigates once in the same tab", () => {
    mockReturnUrl =
      "/project/project-id/board/board-id?focusPlacementId=placement-id";
    render(<MenuBar />);
    const link = screen.getByTestId("return-to-board");
    expect(link).toHaveAttribute("href", mockReturnUrl);
    fireEvent.click(link);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(mockReturnUrl);
  });

  it("hides Return on a direct Flow route without validated context", () => {
    render(<MenuBar />);
    expect(screen.queryByTestId("return-to-board")).not.toBeInTheDocument();
  });
});
