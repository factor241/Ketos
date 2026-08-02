import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useGetModelProviders } from "@/controllers/API/queries/models/use-get-model-providers";
import { useGetBoardPlacements } from "@/controllers/API/queries/placements";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import { useCreateBoardChat } from "@/pages/BoardPage/hooks/use-create-board-chat";
import { useBoardReturnContext } from "@/pages/FlowPage/hooks/use-board-return-context";
import useAlertStore from "@/stores/alertStore";
import useFlowStore from "@/stores/flowStore";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { useSessionManager } from "../../playgroundComponent/hooks/use-session-manager";
import { CanvasCreateChatButton } from "../CanvasCreateChatButton";

let mockWorkspaceEnabled = true;
let mockChatEnabled = true;

jest.mock("@/pages/FlowPage/hooks/use-board-return-context", () => ({
  useBoardReturnContext: jest.fn(),
}));
jest.mock("@/pages/BoardPage/hooks/use-create-board-chat", () => ({
  useCreateBoardChat: jest.fn(),
}));
jest.mock(
  "@/components/core/playgroundComponent/hooks/use-session-manager",
  () => ({ useSessionManager: jest.fn() }),
);
jest.mock("@/controllers/API/queries/models/use-get-model-providers", () => ({
  useGetModelProviders: jest.fn(),
}));
jest.mock("@/controllers/API/queries/placements", () => ({
  useGetBoardPlacements: jest.fn(),
}));
jest.mock("@/customization/hooks/use-custom-navigate", () => ({
  useCustomNavigate: jest.fn(),
}));
jest.mock("@/stores/flowStore", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("@/stores/playgroundStore", () => ({
  usePlaygroundStore: jest.fn(),
}));
jest.mock("@/stores/utilityStore", () => ({
  useUtilityStore: jest.fn((selector) =>
    selector({
      featureFlags: {
        mvp_workspace: mockWorkspaceEnabled,
        mvp_chat: mockChatEnabled,
      },
    }),
  ),
}));
jest.mock("@/stores/alertStore", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("@/components/common/shadTooltipComponent", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/modals/modelProviderModal", () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">provider-configuration</div> : null,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));

const FLOW_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const AUTOMATION_PLACEMENT_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const CHAT_PLACEMENT_ID = "55555555-5555-4555-8555-555555555555";

const mockReturn = useBoardReturnContext as jest.Mock;
const mockCreateBoardChat = useCreateBoardChat as jest.Mock;
const mockProviders = useGetModelProviders as jest.Mock;
const mockPlacements = useGetBoardPlacements as jest.Mock;
const mockSessionManager = useSessionManager as jest.Mock;
const mockNavigateHook = useCustomNavigate as jest.Mock;
const mockFlowStore = useFlowStore as unknown as jest.Mock;
const mockPlaygroundStore = usePlaygroundStore as unknown as jest.Mock;
const mockAlertStore = useAlertStore as unknown as jest.Mock;

describe("CanvasCreateChatButton", () => {
  const createSession = jest.fn();
  const setNewChatOnPlayground = jest.fn();
  const setIsOpen = jest.fn();
  const navigate = jest.fn();
  const create = jest.fn();
  const setErrorData = jest.fn();
  const refetchProviders = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkspaceEnabled = true;
    mockChatEnabled = true;
    mockFlowStore.mockImplementation((selector) =>
      selector({
        currentFlow: { id: FLOW_ID },
        setNewChatOnPlayground,
      }),
    );
    mockPlaygroundStore.mockImplementation((selector) =>
      selector({ setIsOpen }),
    );
    mockSessionManager.mockReturnValue({ createSession });
    mockNavigateHook.mockReturnValue(navigate);
    mockCreateBoardChat.mockReturnValue({ create, isPending: false });
    mockProviders.mockReturnValue({
      data: [
        {
          provider: "OpenAI",
          is_enabled: true,
          models: [{ model_name: "gpt-4o", metadata: {} }],
        },
      ],
      isLoading: false,
      isError: false,
      refetch: refetchProviders,
    });
    mockPlacements.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockReturn.mockReturnValue({
      hasBoardReturnIntent: false,
      status: "absent",
      context: null,
      returnUrl: null,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockAlertStore.mockImplementation((selector) => selector({ setErrorData }));
  });

  it("creates a new standalone Playground session for the current Flow only", () => {
    render(<CanvasCreateChatButton />);

    fireEvent.click(
      screen.getByRole("button", { name: "chat.actions.create" }),
    );

    expect(mockSessionManager).toHaveBeenCalledWith({ flowId: FLOW_ID });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(setNewChatOnPlayground).toHaveBeenCalledWith(true);
    expect(setIsOpen).toHaveBeenCalledWith(true);
    expect(create).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("creates one atomic Board chat and returns with its Placement focused", async () => {
    mockReturn.mockReturnValue({
      hasBoardReturnIntent: true,
      status: "valid",
      context: {
        project_id: PROJECT_ID,
        board_id: BOARD_ID,
        placement_id: AUTOMATION_PLACEMENT_ID,
        flow_id: FLOW_ID,
      },
      returnUrl: `/project/${PROJECT_ID}/board/${BOARD_ID}?focusPlacementId=${AUTOMATION_PLACEMENT_ID}`,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    create.mockResolvedValue({
      chat: { id: "chat-created" },
      placement: { id: CHAT_PLACEMENT_ID },
      idempotencyReplayed: false,
    });
    render(<CanvasCreateChatButton />);

    fireEvent.click(
      screen.getByRole("button", { name: "chat.actions.createInBoard" }),
    );

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        `/project/${PROJECT_ID}/board/${BOARD_ID}?focusPlacementId=${CHAT_PLACEMENT_ID}`,
        { replace: true },
      ),
    );
    expect(mockCreateBoardChat).toHaveBeenCalledWith({
      boardId: BOARD_ID,
      projectId: PROJECT_ID,
    });
    expect(create).toHaveBeenCalledWith({
      title: "chat.defaultTitle",
      provider: "OpenAI",
      modelName: "gpt-4o",
      placement: { x: 340, y: 280, width: 480, height: 360, zIndex: 0 },
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("fails closed for an invalid Board return intent", () => {
    mockReturn.mockReturnValue({
      hasBoardReturnIntent: true,
      status: "invalid",
      context: null,
      returnUrl: null,
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
    });
    render(<CanvasCreateChatButton />);

    fireEvent.click(
      screen.getByRole("button", { name: "chat.actions.createInBoard" }),
    );

    expect(setErrorData).toHaveBeenCalledWith({
      title: "chat.create.invalidBoardContext",
    });
    expect(create).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("opens provider configuration without sending either create path", () => {
    mockProviders.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: refetchProviders,
    });
    render(<CanvasCreateChatButton />);

    fireEvent.click(
      screen.getByRole("button", { name: "chat.actions.create" }),
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "provider-configuration",
    );
    expect(create).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("stays discoverable but disabled with an accessible reason when flags deny chat", () => {
    mockWorkspaceEnabled = false;
    mockChatEnabled = false;
    render(<CanvasCreateChatButton />);

    const button = screen.getByTestId("canvas-create-chat-button");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(createSession).not.toHaveBeenCalled();
    const descriptionId = button.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId as string)).toHaveTextContent(
      "chat.create.disabled",
    );
  });

  it("reports provider query failure without opening configuration", () => {
    mockProviders.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchProviders,
    });
    render(<CanvasCreateChatButton />);

    fireEvent.click(
      screen.getByRole("button", { name: "chat.actions.create" }),
    );

    expect(setErrorData).toHaveBeenCalledWith({
      title: "chat.create.providerLoadError",
    });
    expect(refetchProviders).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("places a returned Board chat without colliding with existing geometry", async () => {
    mockReturn.mockReturnValue({
      hasBoardReturnIntent: true,
      status: "valid",
      context: {
        project_id: PROJECT_ID,
        board_id: BOARD_ID,
        placement_id: AUTOMATION_PLACEMENT_ID,
        flow_id: FLOW_ID,
      },
      returnUrl: null,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockPlacements.mockReturnValue({
      data: [
        {
          id: "existing",
          boardId: BOARD_ID,
          targetKind: "automation",
          targetId: FLOW_ID,
          x: 340,
          y: 280,
          width: 480,
          height: 360,
          zIndex: 7,
          displayState: "normal",
          revision: 0,
          createdAt: "2026-07-25T00:00:00Z",
          updatedAt: "2026-07-25T00:00:00Z",
        },
      ],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    create.mockResolvedValue({
      chat: { id: "chat-created" },
      placement: { id: CHAT_PLACEMENT_ID },
      idempotencyReplayed: false,
    });
    render(<CanvasCreateChatButton />);

    fireEvent.click(
      screen.getByRole("button", { name: "chat.actions.createInBoard" }),
    );

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: {
          x: 860,
          y: 280,
          width: 480,
          height: 360,
          zIndex: 8,
        },
      }),
    );
  });
});
