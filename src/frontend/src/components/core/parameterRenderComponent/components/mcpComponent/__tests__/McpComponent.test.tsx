import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { APIClassType, InputFieldType } from "@/types/api";
import McpComponent from "../index";

const mockRefetchMCPServers = jest.fn();
const mockMutateTemplate = jest.fn();
const mockSetErrorData = jest.fn();
const mockPostTemplateValue = { mutateAsync: jest.fn() };
const mockAddMcpServer = jest.fn();

jest.mock("@/CustomNodes/helpers/mutate-template", () => ({
  mutateTemplate: (...args: unknown[]) => mockMutateTemplate(...args),
}));

jest.mock("@/controllers/API/queries/mcp/use-get-mcp-servers", () => ({
  useGetMCPServers: jest.fn(() => ({
    data: [
      {
        name: "broken-server",
        mode: null,
        toolsCount: null,
        error: "Connection refused by MCP server",
      },
    ],
    refetch: mockRefetchMCPServers,
    isFetching: false,
  })),
}));

jest.mock("@/controllers/API/queries/mcp/use-add-mcp-server", () => ({
  useAddMCPServer: jest.fn(() => ({
    mutate: mockAddMcpServer,
  })),
}));

jest.mock("@/controllers/API/queries/nodes/use-post-template-value", () => ({
  usePostTemplateValue: jest.fn(() => mockPostTemplateValue),
}));

jest.mock("@/stores/alertStore", () => ({
  __esModule: true,
  default: (
    selector?: (state: { setErrorData: typeof mockSetErrorData }) => unknown,
  ) => {
    const state = { setErrorData: mockSetErrorData };
    return selector ? selector(state) : state;
  },
}));

jest.mock("@/stores/flowStore", () => {
  const mockFlowState = {
    updateBuildStatus: jest.fn(),
  };
  const useFlowStoreMock = Object.assign(
    jest.fn((selector?: (state: typeof mockFlowState) => unknown) =>
      selector ? selector(mockFlowState) : mockFlowState,
    ),
    { getState: () => mockFlowState },
  );
  return {
    __esModule: true,
    default: useFlowStoreMock,
  };
});

jest.mock("@/components/common/shadTooltipComponent", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: ({ name, className }: { name: string; className?: string }) => (
    <span data-testid={`icon-${name}`} className={className}>
      {name}
    </span>
  ),
}));

jest.mock("@/modals/addMcpServerModal", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock(
  "@/CustomNodes/GenericNode/components/ListSelectionComponent",
  () => ({
    __esModule: true,
    default: () => null,
  }),
);

describe("McpComponent", () => {
  const codeInputField: InputFieldType = {
    type: "code",
    required: false,
    list: false,
    show: true,
    readonly: false,
    value: "code",
  };

  const createNodeClass = (): APIClassType => ({
    template: { code: codeInputField },
    tool_mode: false,
    description: "Test MCP node",
    display_name: "MCP Tools",
    documentation: "",
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRefetchMCPServers.mockResolvedValue({});
    mockMutateTemplate.mockImplementation(
      (
        _value,
        _nodeId,
        nodeClass,
        setNodeClass,
        _postTemplateValue,
        _setErrorData,
        _parameterName,
        callback,
      ) => {
        setNodeClass(nodeClass);
        callback();
        return Promise.resolve();
      },
    );
  });

  it("shows the MCP server error and refreshes the node on demand", async () => {
    const user = userEvent.setup();
    const nodeClass = createNodeClass();

    render(
      <McpComponent
        id="mcp-server"
        value={{ name: "broken-server", config: {} }}
        disabled={false}
        handleOnNewValue={jest.fn()}
        editNode={false}
        nodeId="MCPTools-1"
        nodeClass={nodeClass}
        handleNodeClass={jest.fn()}
      />,
    );

    expect(screen.getByTestId("mcp-server-error")).toHaveTextContent(
      "Connection refused by MCP server",
    );

    await user.click(screen.getByTestId("refresh-mcp-server-button"));

    await waitFor(() => {
      expect(mockRefetchMCPServers).toHaveBeenCalled();
      expect(mockMutateTemplate).toHaveBeenCalledWith(
        { name: "broken-server", config: {} },
        "MCPTools-1",
        expect.any(Object),
        expect.any(Function),
        mockPostTemplateValue,
        mockSetErrorData,
        "mcp_server",
        expect.any(Function),
        false,
        true,
      );
    });

    expect(mockMutateTemplate.mock.calls[0][3]).toEqual(expect.any(Function));
  });

  it("does not continue a refresh after becoming disabled", async () => {
    let resolveRefetch!: (value: object) => void;
    mockRefetchMCPServers.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefetch = resolve;
      }),
    );
    const nodeClass = createNodeClass();
    const props = {
      id: "mcp-server",
      value: { name: "broken-server", config: {} },
      handleOnNewValue: jest.fn(),
      editNode: false,
      nodeId: "MCPTools-1",
      nodeClass,
      handleNodeClass: jest.fn(),
    };
    const user = userEvent.setup();
    const { rerender } = render(<McpComponent {...props} disabled={false} />);

    await user.click(screen.getByTestId("refresh-mcp-server-button"));
    rerender(<McpComponent {...props} disabled />);
    resolveRefetch({});

    await waitFor(() => expect(mockRefetchMCPServers).toHaveBeenCalled());
    expect(mockMutateTemplate).not.toHaveBeenCalled();
  });

  it("does not apply an in-flight refresh after becoming disabled", async () => {
    let completeMutation: () => void = () => undefined;
    mockMutateTemplate.mockImplementationOnce(
      (
        _value,
        _nodeId,
        nodeClass,
        setNodeClass,
        _postTemplateValue,
        _setErrorData,
        _parameterName,
        callback,
      ) =>
        new Promise<void>((resolve) => {
          completeMutation = () => {
            setNodeClass(nodeClass);
            callback();
            resolve();
          };
        }),
    );
    const nodeClass = createNodeClass();
    const handleNodeClass = jest.fn();
    const props = {
      id: "mcp-server",
      value: { name: "broken-server", config: {} },
      handleOnNewValue: jest.fn(),
      editNode: false,
      nodeId: "MCPTools-1",
      nodeClass,
      handleNodeClass,
    };
    const user = userEvent.setup();
    const { rerender } = render(<McpComponent {...props} disabled={false} />);

    await user.click(screen.getByTestId("refresh-mcp-server-button"));
    await waitFor(() => expect(mockMutateTemplate).toHaveBeenCalled());
    rerender(<McpComponent {...props} disabled />);
    await act(async () => completeMutation());

    expect(handleNodeClass).not.toHaveBeenCalled();
  });

  it("does not apply a late save success after becoming disabled", async () => {
    const nodeClass = createNodeClass();
    const handleOnNewValue = jest.fn();
    const props = {
      id: "mcp-server",
      value: { name: "new-server", config: { command: "serve" } },
      handleOnNewValue,
      editNode: false,
      nodeId: "MCPTools-1",
      nodeClass,
      handleNodeClass: jest.fn(),
    };
    const user = userEvent.setup();
    const { rerender } = render(<McpComponent {...props} disabled={false} />);

    await user.click(screen.getByRole("button", { name: "Save" }));
    const mutationOptions = mockAddMcpServer.mock.calls[0][1] as {
      onSuccess: () => void;
    };
    rerender(<McpComponent {...props} disabled />);
    act(() => mutationOptions.onSuccess());

    expect(handleOnNewValue).not.toHaveBeenCalled();
  });
});
