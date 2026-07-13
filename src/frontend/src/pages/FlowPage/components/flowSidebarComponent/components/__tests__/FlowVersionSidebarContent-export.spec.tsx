import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";

type FlowStoreState = {
  currentFlow: typeof mockCurrentFlow;
  nodes: unknown[];
  edges: unknown[];
  autoSaveFlow: undefined;
  inspectionPanelVisible: boolean;
};
type CallableStore<T> = {
  (selector: (state: T) => unknown): unknown;
  getState: () => T;
  setState: jest.Mock;
  subscribe?: jest.Mock;
};
type DivProps = React.ComponentProps<"div">;

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

const invalidateQueriesMock = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

const downloadFlowMock = jest.fn();
const removeApiKeysMock = jest.fn((flow: unknown) => flow);

jest.mock("@/utils/reactflowUtils", () => ({
  downloadFlow: (...args: unknown[]) => downloadFlowMock(...args),
  processFlows: jest.fn(),
  removeApiKeys: (flow: unknown) => removeApiKeysMock(flow),
}));

// API mock — used by handleExportEntry to fetch the full version entry
const apiGetMock = jest.fn();
jest.mock("@/controllers/API/api", () => ({
  api: { get: (...args: unknown[]) => apiGetMock(...args), post: jest.fn() },
}));
jest.mock("@/controllers/API/helpers/constants", () => ({
  getURL: () => "/api/v1/flows",
}));

// Query-hook mocks — returns the FlowVersionListResponse wrapper shape
const mockVersions = [
  {
    id: "entry-1",
    flow_id: "flow-1",
    user_id: "user-1",
    version_number: 1,
    version_tag: "v1",
    description: "first version",
    created_at: "2026-01-01T00:00:00Z",
  },
];

jest.mock("@/controllers/API/queries/flow-version", () => ({
  useGetFlowVersions: () => ({
    data: { entries: mockVersions, max_entries: 50 },
    isLoading: false,
    isError: false,
  }),
  useGetFlowVersionEntry: () => ({
    data: null,
    isLoading: false,
    isError: false,
  }),
  useDeleteVersionEntry: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock("@/hooks/flows/use-apply-flow-to-canvas", () => ({
  __esModule: true,
  default: () => jest.fn(),
}));

// Store mocks
const mockCurrentFlow = {
  id: "flow-1",
  name: "Test Flow",
  description: "A test flow",
  data: { nodes: [{ id: "draft-node" }], edges: [] },
};

jest.mock("@/stores/flowStore", () => {
  const state: FlowStoreState = {
    currentFlow: mockCurrentFlow,
    nodes: [],
    edges: [],
    autoSaveFlow: undefined,
    inspectionPanelVisible: false,
  };
  const store = ((selector: (value: FlowStoreState) => unknown) =>
    selector(state)) as CallableStore<FlowStoreState>;
  store.getState = () => state;
  store.setState = jest.fn();
  store.subscribe = jest.fn(() => jest.fn());
  return { __esModule: true, default: store };
});

const setErrorDataMock = jest.fn();
jest.mock("@/stores/alertStore", () => ({
  __esModule: true,
  default: (
    selector: (state: {
      setSuccessData: jest.Mock;
      setErrorData: jest.Mock;
    }) => unknown,
  ) =>
    selector({
      setSuccessData: jest.fn(),
      setErrorData: setErrorDataMock,
    }),
}));

jest.mock("@/utils/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => (
    <span data-testid={`icon-${name}`} />
  ),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...rest }: React.ComponentProps<"button">) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}));

jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: DivProps) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: DivProps) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: DivProps) => (
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: DivProps) => <>{children}</>,
}));

jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: () => <input type="checkbox" />,
}));

jest.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ setActiveSection: jest.fn() }),
  SidebarGroupLabel: ({ children, className }: DivProps) => (
    <div className={className}>{children}</div>
  ),
  SidebarMenu: ({ children, className }: DivProps) => (
    <div className={className}>{children}</div>
  ),
  SidebarMenuButton: ({
    children,
    onClick,
    isActive,
    className,
  }: DivProps & { isActive?: boolean }) => (
    <div
      role="button"
      onClick={onClick}
      className={`cursor-pointer ${className ?? ""} ${isActive ? "active" : ""}`}
    >
      {children}
    </div>
  ),
  SidebarMenuItem: ({ children }: DivProps) => <div>{children}</div>,
}));

jest.mock("lodash", () => ({
  cloneDeep: jest.fn((obj: unknown) =>
    obj === undefined ? undefined : JSON.parse(JSON.stringify(obj)),
  ),
}));

jest.mock("@/stores/versionPreviewStore", () => {
  const state = {
    previewNodes: null,
    previewEdges: null,
    previewLabel: null,
    previewId: null,
    isPreviewLoading: false,
    didRestore: false,
    setPreview: jest.fn(),
    clearPreview: jest.fn(),
    setPreviewLoading: jest.fn(),
  };
  const store = ((selector: (value: typeof state) => unknown) =>
    selector(state)) as CallableStore<typeof state>;
  store.getState = () => state;
  store.setState = jest.fn();
  return { __esModule: true, default: store };
});

// ---------------------------------------------------------------------------
// Import the component AFTER all mocks are set up
// ---------------------------------------------------------------------------

import FlowVersionSidebarContent from "../FlowVersionSidebarContent";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FlowVersionSidebarContent export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exports a version entry using removeApiKeys + downloadFlow", async () => {
    const user = userEvent.setup();
    const versionData = {
      nodes: [{ id: "version-node", data: { node: { template: {} } } }],
      edges: [],
    };

    apiGetMock.mockResolvedValueOnce({
      data: {
        ...mockVersions[0],
        data: versionData,
        version_tag: "v1",
      },
    });

    render(<FlowVersionSidebarContent flowId="flow-1" />);

    // Find the Export menu items — there's one for each version entry
    const exportItems = screen.getAllByRole("menuitem", { name: /Export/i });
    expect(exportItems.length).toBeGreaterThan(0);

    await user.click(exportItems[0]);

    await waitFor(() => {
      expect(apiGetMock).toHaveBeenCalledWith(
        "/api/v1/flows/flow-1/versions/entry-1",
      );
    });

    await waitFor(() => {
      expect(removeApiKeysMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "flow-1",
          data: versionData,
          name: "Test Flow_v1",
          description: "A test flow",
          is_component: false,
        }),
      );
    });

    await waitFor(() => {
      expect(downloadFlowMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: versionData }),
        "Test Flow_v1",
        expect.any(String),
      );
    });
  });

  it("exports a version entry with the correct flow name and description", async () => {
    const user = userEvent.setup();
    const versionData = {
      nodes: [{ id: "v1-node" }],
      edges: [],
    };

    apiGetMock.mockResolvedValueOnce({
      data: { ...mockVersions[0], data: versionData, version_tag: "v1" },
    });

    render(<FlowVersionSidebarContent flowId="flow-1" />);

    const exportItems = screen.getAllByRole("menuitem", { name: /Export/i });
    await user.click(exportItems[0]);

    await waitFor(() => {
      expect(downloadFlowMock).toHaveBeenCalledWith(
        expect.anything(),
        "Test Flow_v1",
        "A test flow",
      );
    });
  });

  it("shows error when export fails", async () => {
    const user = userEvent.setup();

    apiGetMock.mockRejectedValueOnce({
      response: { data: { detail: "Server error" } },
    });

    render(<FlowVersionSidebarContent flowId="flow-1" />);

    const exportItems = screen.getAllByRole("menuitem", { name: /Export/i });
    await user.click(exportItems[0]);

    await waitFor(() => {
      expect(setErrorDataMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to export version",
        }),
      );
    });

    // downloadFlow should NOT have been called
    expect(downloadFlowMock).not.toHaveBeenCalled();
  });
});
