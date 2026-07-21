import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import type { Placement } from "@/types/board";
import type { ChatThread } from "@/types/chat";
import { ChatPlacement } from "./ChatPlacement";

const CHAT_ONE = "11111111-1111-4111-8111-111111111111";
const CHAT_TWO = "22222222-2222-4222-8222-222222222222";
const mockStockSubmit = jest.fn();
const mockUseChatReconnect = jest.fn();
const mockUseThreadScopedCopilotAgent = jest.fn();
const mountedChats: Array<{
  agentId?: string;
  threadId?: string;
  chatView?: React.ComponentType<Record<string, unknown>>;
}> = [];

jest.mock("@/controllers/API/queries/chat-threads", () => ({
  useChatReconnect: (input: { chatId: string }) => mockUseChatReconnect(input),
}));
jest.mock("../../chats/use-thread-scoped-copilot-agent", () => ({
  useThreadScopedCopilotAgent: (chatId: string) =>
    mockUseThreadScopedCopilotAgent(chatId),
}));
jest.mock("../../chats/use-flow-command-interrupt", () => ({
  useFlowCommandInterrupt: jest.fn(),
}));
jest.mock("../../chats/FlowCommandOutcome", () => () => null);
jest.mock("@copilotkit/react-core/v2", () => {
  const View = (props: {
    inputValue?: string;
    onInputChange?: (value: string) => void;
    onSubmitMessage?: (value: string) => void;
  }) => (
    <div>
      <textarea
        aria-label="stock-composer"
        value={props.inputValue ?? ""}
        onChange={(event) => props.onInputChange?.(event.target.value)}
      />
      <button
        type="button"
        onClick={() => props.onSubmitMessage?.(props.inputValue ?? "")}
      >
        stock-send
      </button>
    </div>
  );
  const CopilotChat = Object.assign(
    (props: {
      agentId?: string;
      threadId?: string;
      chatView?: React.ComponentType<Record<string, unknown>>;
    }) => {
      mountedChats.push(props);
      const ChatView = props.chatView;
      return ChatView ? (
        <ChatView
          inputValue=""
          onInputChange={jest.fn()}
          onSubmitMessage={mockStockSubmit}
        />
      ) : null;
    },
    { View },
  );
  return { CopilotChat };
});
jest.mock("../BoardCardFrame", () => ({
  BoardCardFrame: ({
    title,
    children,
  }: {
    title: string;
    children: ReactNode;
  }) => <section aria-label={title}>{children}</section>,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

const chat = {
  id: CHAT_ONE,
  projectId: "project-1",
  createdById: "actor-1",
  title: "Cached title",
  provider: "test",
  modelName: "test",
  contextPolicy: "board",
  archived: false,
  revision: 1,
  createdAt: "2026-07-21T00:00:00Z",
  updatedAt: "2026-07-21T00:00:00Z",
} satisfies ChatThread;
const placement = {
  id: "placement-1",
  boardId: "board-1",
  targetKind: "chat",
  targetId: CHAT_ONE,
  x: 0,
  y: 0,
  width: 480,
  height: 360,
  zIndex: 1,
  displayState: "normal",
  revision: 1,
  createdAt: "2026-07-21T00:00:00Z",
  updatedAt: "2026-07-21T00:00:00Z",
} satisfies Placement;
const callbacks = {
  onDisplayStateChange: jest.fn(),
  onClose: jest.fn(),
  onArchive: jest.fn(),
  onResizeEnd: jest.fn(),
};

describe("ChatPlacement restart reconnect", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mountedChats.length = 0;
    mockStockSubmit.mockReset();
    mockUseChatReconnect.mockReset();
    mockUseThreadScopedCopilotAgent.mockReset();
    mockUseChatReconnect.mockReturnValue({
      phase: "restored",
      chat: { ...chat, title: "Server title" },
      announcementKey: "chat.states.restored",
      retry: jest.fn(),
    });
    mockUseThreadScopedCopilotAgent.mockImplementation((chatId: string) => ({
      status: "ready",
      localAgentId: `ketos-chat--${chatId}`,
      error: null,
      retry: jest.fn(),
    }));
  });

  it("does not bind an agent before authenticated thread restoration", () => {
    mockUseChatReconnect.mockReturnValue({
      phase: "reconnecting",
      chat: null,
      announcementKey: "chat.states.reconnecting",
      retry: jest.fn(),
    });
    render(
      <ChatPlacement
        chat={chat}
        placement={placement}
        selected
        {...callbacks}
      />,
    );
    expect(mockUseThreadScopedCopilotAgent).not.toHaveBeenCalled();
    expect(mountedChats).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent(
      "chat.states.reconnecting",
    );
  });

  it("binds stock CopilotChat to the exact restored server thread", () => {
    render(
      <ChatPlacement
        chat={chat}
        placement={placement}
        selected
        {...callbacks}
      />,
    );
    expect(mockUseThreadScopedCopilotAgent).toHaveBeenCalledWith(CHAT_ONE);
    expect(mountedChats).toEqual([
      expect.objectContaining({
        agentId: `ketos-chat--${CHAT_ONE}`,
        threadId: CHAT_ONE,
      }),
    ]);
    expect(
      screen.getByRole("region", { name: "Server title" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("fails closed for an unknown server result", () => {
    mockUseChatReconnect.mockReturnValue({
      phase: "unknown",
      chat: null,
      announcementKey: "chat.states.unknown",
      retry: jest.fn(),
    });
    render(
      <ChatPlacement
        chat={chat}
        placement={placement}
        selected
        {...callbacks}
      />,
    );
    expect(mockUseThreadScopedCopilotAgent).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("chat.states.unknown");
  });

  it("restores and preserves an unsent stock-composer draft without auto-send", () => {
    const key = `ketos.chat.draft.v1:${CHAT_ONE}`;
    sessionStorage.setItem(key, "unsent restart draft");
    const view = render(
      <ChatPlacement
        chat={chat}
        placement={placement}
        selected
        {...callbacks}
      />,
    );
    expect(screen.getByText("chat.draft.notSent")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "stock-composer" })).toHaveValue(
      "unsent restart draft",
    );
    expect(mockStockSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "stock-composer" }), {
      target: { value: "edited draft" },
    });
    expect(sessionStorage.getItem(key)).toBe("edited draft");
    view.unmount();
    render(
      <ChatPlacement
        chat={chat}
        placement={placement}
        selected
        {...callbacks}
      />,
    );
    expect(screen.getByRole("textbox", { name: "stock-composer" })).toHaveValue(
      "edited draft",
    );
  });

  it("clears only the submitted chat draft and isolates another chat", () => {
    const firstKey = `ketos.chat.draft.v1:${CHAT_ONE}`;
    const secondKey = `ketos.chat.draft.v1:${CHAT_TWO}`;
    sessionStorage.setItem(firstKey, "send me");
    sessionStorage.setItem(secondKey, "leave me");
    render(
      <ChatPlacement
        chat={chat}
        placement={placement}
        selected
        {...callbacks}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "stock-send" }));
    expect(mockStockSubmit).toHaveBeenCalledWith("send me");
    expect(sessionStorage.getItem(firstKey)).toBeNull();
    expect(sessionStorage.getItem(secondKey)).toBe("leave me");
  });
});
