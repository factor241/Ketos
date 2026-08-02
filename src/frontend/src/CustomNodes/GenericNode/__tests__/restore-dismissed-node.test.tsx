import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  APIClassType,
  CustomComponentRequest,
  InputFieldType,
} from "@/types/api";
import type { ComponentsToUpdateType } from "@/types/zustand/flow";
import type { processNodeAdvancedFields } from "../../helpers/process-node-advanced-fields";
import GenericNode from "../index";

const mockUpdateNodeInternals = jest.fn();
const mockValidateComponentCode = jest.fn();
const mockUpdateNodeCode = jest.fn();
const mockProcessNodeAdvancedFields = jest.fn();
const mockSetErrorData = jest.fn();
const mockTakeSnapshot = jest.fn();
const mockDeleteNode = jest.fn();
const mockSetNode = jest.fn();
const mockSetEdges = jest.fn();
const mockRemoveDismissedNodes = jest.fn();
const mockRegisterNodeUpdate = jest.fn();
const mockCompleteNodeUpdate = jest.fn();

type MockFlowStoreState = {
  deleteNode: typeof mockDeleteNode;
  setNode: typeof mockSetNode;
  edges: [];
  setEdges: typeof mockSetEdges;
  dismissedNodes: string[];
  addDismissedNodes: jest.Mock;
  removeDismissedNodes: typeof mockRemoveDismissedNodes;
  dismissedNodesLegacy: string[];
  addDismissedNodesLegacy: jest.Mock;
  componentsToUpdate: ComponentsToUpdateType[];
  nodes: Array<{ id: string; selected: boolean }>;
  rightClickedNodeId: string | null;
};

const inputField = (value: string): InputFieldType => ({
  type: "code",
  required: false,
  list: false,
  show: true,
  readonly: false,
  value,
});

const promptNodeClass = (value: string): APIClassType => ({
  display_name: "Prompt",
  description: "Prompt node",
  documentation: "",
  template: { code: inputField(value) },
  outputs: [],
});

let mockTemplates: Record<string, APIClassType>;
let mockFlowStoreState: MockFlowStoreState;

jest.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => mockUpdateNodeInternals,
}));

jest.mock("react-hotkeys-hook", () => ({
  useHotkeys: jest.fn(),
}));

jest.mock("zustand/react/shallow", () => ({
  useShallow: (selector: (state: unknown) => unknown) => selector,
}));

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    "data-testid": dataTestId,
    unstyled: _unstyled,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: (event?: React.MouseEvent<HTMLButtonElement>) => void;
    "data-testid"?: string;
    unstyled?: boolean;
  }) => (
    <button onClick={onClick} data-testid={dataTestId} {...props}>
      {children}
    </button>
  ),
}));

jest.mock(
  "@/controllers/API/queries/nodes/use-post-validate-component-code",
  () => ({
    usePostValidateComponentCode: () => ({
      mutate: mockValidateComponentCode,
    }),
  }),
);

jest.mock("@/shared/hooks/use-alternate", () => ({
  useAlternate: () => [false, jest.fn(), jest.fn()],
}));

jest.mock("../../../pages/FlowPage/components/nodeToolbarComponent", () => ({
  __esModule: true,
  default: ({
    isOutdated,
    isUserEdited,
    updateNode,
  }: {
    isOutdated: boolean;
    isUserEdited: boolean;
    updateNode: () => void;
  }) =>
    isOutdated ? (
      <div>
        <span>{isUserEdited ? "Restore" : "Update"}</span>
        <button data-testid="restore-node-button" onClick={updateNode}>
          Restore Node
        </button>
      </div>
    ) : null,
}));

jest.mock("../../../shared/hooks/use-change-on-unfocus", () => ({
  useChangeOnUnfocus: jest.fn(),
}));

jest.mock("../../../stores/alertStore", () => ({
  __esModule: true,
  default: (selector: (state: unknown) => unknown) =>
    selector({
      setErrorData: mockSetErrorData,
    }),
}));

jest.mock("../../../stores/flowStore", () => {
  const useFlowStore = (
    selector?: (state: typeof mockFlowStoreState) => unknown,
  ) => (selector ? selector(mockFlowStoreState) : mockFlowStoreState);
  useFlowStore.getState = () => mockFlowStoreState;

  return {
    __esModule: true,
    default: useFlowStore,
    registerNodeUpdate: (nodeId: string) => mockRegisterNodeUpdate(nodeId),
    completeNodeUpdate: (nodeId: string) => mockCompleteNodeUpdate(nodeId),
  };
});

jest.mock("../../../stores/flowsManagerStore", () => ({
  __esModule: true,
  default: (selector: (state: unknown) => unknown) =>
    selector({
      takeSnapshot: mockTakeSnapshot,
    }),
}));

jest.mock("../../../stores/utilityStore", () => ({
  useUtilityStore: (selector: (state: unknown) => unknown) =>
    selector({
      allowCustomComponents: true,
    }),
}));

jest.mock("../../../stores/shortcuts", () => ({
  useShortcutsStore: (selector: (state: unknown) => unknown) =>
    selector({
      shortcuts: [],
    }),
}));

jest.mock("../../../stores/typesStore", () => ({
  useTypesStore: (selector: (state: unknown) => unknown) =>
    selector({
      types: {},
      templates: mockTemplates,
    }),
}));

jest.mock("../../hooks/use-update-node-code", () => ({
  __esModule: true,
  default: () => mockUpdateNodeCode,
}));

jest.mock("../../helpers/process-node-advanced-fields", () => ({
  processNodeAdvancedFields: (
    ...args: Parameters<typeof processNodeAdvancedFields>
  ) => mockProcessNodeAdvancedFields(...args),
}));

jest.mock("../components/NodeDescription", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../components/NodeName", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../components/NodeOutputParameter/NodeOutputs", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../components/NodeUpdateComponent", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../components/NodeLegacyComponent", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../components/nodeIcon", () => ({
  NodeIcon: () => null,
}));

jest.mock("../components/RenderInputParameters", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../hooks/use-get-build-status", () => ({
  useBuildStatus: () => null,
}));

jest.mock("@/customization/components/custom-NodeStatus", () => ({
  CustomNodeStatus: () => null,
}));

jest.mock("@/modals/updateComponentModal", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/utils/reactflowUtils", () => ({
  scapedJSONStringfy: jest.fn(),
}));

jest.mock("@/utils/utils", () => ({
  cn: (...classes: string[]) => classes.filter(Boolean).join(" "),
  classNames: (...classes: string[]) => classes.filter(Boolean).join(" "),
}));

describe("GenericNode dismissed update recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockTemplates = {
      Prompt: promptNodeClass("server_code"),
    };

    mockFlowStoreState = {
      deleteNode: mockDeleteNode,
      setNode: mockSetNode,
      edges: [],
      setEdges: mockSetEdges,
      dismissedNodes: ["node-1"],
      addDismissedNodes: jest.fn(),
      removeDismissedNodes: mockRemoveDismissedNodes,
      dismissedNodesLegacy: [],
      addDismissedNodesLegacy: jest.fn(),
      componentsToUpdate: [
        {
          id: "node-1",
          display_name: "Prompt",
          outdated: true,
          blocked: false,
          breakingChange: false,
          userEdited: true,
        },
      ],
      nodes: [
        {
          id: "node-1",
          selected: true,
        },
      ],
      rightClickedNodeId: null,
    };

    mockProcessNodeAdvancedFields.mockReturnValue(
      promptNodeClass("server_code"),
    );

    mockValidateComponentCode.mockImplementation(
      (
        _payload,
        { onSuccess }: { onSuccess: (value: CustomComponentRequest) => void },
      ) => {
        onSuccess({
          data: promptNodeClass("server_code"),
          type: "Prompt",
        });
      },
    );
  });

  it("restores a dismissed outdated node through the single-node update flow", async () => {
    const user = userEvent.setup();

    render(
      <GenericNode
        selected={true}
        data={{
          id: "node-1",
          type: "Prompt",
          node: promptNodeClass("old_code"),
        }}
      />,
    );

    expect(screen.getByText("Restore")).toBeInTheDocument();

    await user.click(screen.getByTestId("restore-node-button"));

    await waitFor(() => {
      expect(mockTakeSnapshot).toHaveBeenCalled();
      expect(mockRegisterNodeUpdate).toHaveBeenCalledWith("node-1");
      expect(mockUpdateNodeCode).toHaveBeenCalledWith(
        expect.any(Object),
        "server_code",
        "code",
        "Prompt",
      );
      expect(mockRemoveDismissedNodes).toHaveBeenCalledWith(["node-1"]);
      expect(mockCompleteNodeUpdate).toHaveBeenCalledWith("node-1");
    });
  });
});
