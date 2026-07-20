import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";

import {
  CHAT_RUNTIME_AGENT_ID,
  createThreadScopedAgentId,
  useThreadScopedCopilotAgent,
} from "../use-thread-scoped-copilot-agent";

const CHAT_ONE = "11111111-1111-4111-8111-111111111111";
const CHAT_TWO = "22222222-2222-4222-8222-222222222222";

const mockApiGet = jest.fn();
const mockRegisterProxiedAgent = jest.fn();
const mockSetMessages = jest.fn();
type MockAgent = {
  messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  setMessages: jest.Mock;
  subscribe: jest.Mock;
};
let registeredAgents: MockAgent[] = [];
let mockCopilotkit = {
  registerProxiedAgent: mockRegisterProxiedAgent,
};

jest.mock("@/controllers/API/api", () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

jest.mock("@copilotkit/react-core/v2", () => ({
  useCopilotKit: () => ({
    copilotkit: mockCopilotkit,
  }),
}));

type ObservedBinding = {
  localAgentId: string;
  status: "registering" | "ready" | "error";
};

const observedBindings: ObservedBinding[] = [];

function BindingProbe({ chatId }: { chatId: string }) {
  const binding = useThreadScopedCopilotAgent(chatId);
  observedBindings.push({
    localAgentId: binding.localAgentId,
    status: binding.status,
  });
  return (
    <section
      data-testid="binding"
      data-agent-id={binding.localAgentId}
      data-status={binding.status}
    >
      {binding.error?.message ?? "no-error"}
      <button type="button" onClick={binding.retry}>
        retry
      </button>
    </section>
  );
}

function successfulRegistration(unregister: unknown = jest.fn()) {
  const unregisterFn =
    typeof unregister === "function" ? unregister : jest.fn();
  const agent: MockAgent = {
    messages: [],
    setMessages: jest.fn(),
    subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
  };
  agent.setMessages.mockImplementation((messages: MockAgent["messages"]) => {
    agent.messages = messages;
    mockSetMessages(messages);
  });
  registeredAgents.push(agent);
  return { agent, unregister: unregisterFn };
}

beforeEach(() => {
  observedBindings.length = 0;
  registeredAgents = [];
  mockApiGet.mockReset();
  mockApiGet.mockResolvedValue({ data: [] });
  mockRegisterProxiedAgent.mockReset();
  mockRegisterProxiedAgent.mockImplementation(successfulRegistration);
  mockSetMessages.mockReset();
  mockCopilotkit = {
    registerProxiedAgent: mockRegisterProxiedAgent,
  };
});

describe("useThreadScopedCopilotAgent", () => {
  it("registers two local ids against one runtime id", async () => {
    render(
      <>
        <BindingProbe chatId={CHAT_ONE} />
        <BindingProbe chatId={CHAT_TWO} />
      </>,
    );

    await waitFor(() => {
      expect(mockRegisterProxiedAgent.mock.calls).toEqual([
        [
          {
            agentId: `${CHAT_RUNTIME_AGENT_ID}--${CHAT_ONE}`,
            runtimeAgentId: CHAT_RUNTIME_AGENT_ID,
          },
        ],
        [
          {
            agentId: `${CHAT_RUNTIME_AGENT_ID}--${CHAT_TWO}`,
            runtimeAgentId: CHAT_RUNTIME_AGENT_ID,
          },
        ],
      ]);
    });
    expect(
      screen.getAllByTestId("binding").map((node) => node.dataset.agentId),
    ).toEqual([
      `${CHAT_RUNTIME_AGENT_ID}--${CHAT_ONE}`,
      `${CHAT_RUNTIME_AGENT_ID}--${CHAT_TWO}`,
    ]);
  });

  it("cleans the surviving StrictMode registration handle", async () => {
    const unregister = jest.fn();
    mockRegisterProxiedAgent.mockImplementation(() =>
      successfulRegistration(unregister),
    );

    const view = render(
      <StrictMode>
        <BindingProbe chatId={CHAT_ONE} />
      </StrictMode>,
    );

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mockRegisterProxiedAgent).toHaveBeenCalledTimes(1),
    );
    view.unmount();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("fails closed before replacing a changed chat id", async () => {
    const firstUnregister = jest.fn();
    mockRegisterProxiedAgent
      .mockReturnValueOnce(successfulRegistration(firstUnregister))
      .mockImplementation(successfulRegistration);
    const view = render(<BindingProbe chatId={CHAT_ONE} />);
    await waitFor(() =>
      expect(mockRegisterProxiedAgent).toHaveBeenCalledTimes(1),
    );
    const observationStart = observedBindings.length;

    view.rerender(<BindingProbe chatId={CHAT_TWO} />);

    expect(firstUnregister).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mockRegisterProxiedAgent).toHaveBeenLastCalledWith({
        agentId: `${CHAT_RUNTIME_AGENT_ID}--${CHAT_TWO}`,
        runtimeAgentId: CHAT_RUNTIME_AGENT_ID,
      });
    });
    expect(observedBindings.slice(observationStart)).toContainEqual({
      localAgentId: `${CHAT_RUNTIME_AGENT_ID}--${CHAT_TWO}`,
      status: "registering",
    });
  });

  it("renders a collision error and retry creates one registration generation", async () => {
    mockRegisterProxiedAgent
      .mockImplementationOnce(() => {
        throw new Error("agent ID collision");
      })
      .mockImplementation(successfulRegistration);
    const user = userEvent.setup();
    render(<BindingProbe chatId={CHAT_ONE} />);

    await waitFor(() =>
      expect(screen.getByTestId("binding")).toHaveAttribute(
        "data-status",
        "error",
      ),
    );
    expect(screen.getByTestId("binding")).toHaveTextContent(
      "agent ID collision",
    );

    await user.click(screen.getByRole("button", { name: "retry" }));

    await waitFor(() =>
      expect(mockRegisterProxiedAgent).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(screen.getByTestId("binding")).toHaveAttribute(
        "data-status",
        "ready",
      ),
    );
  });

  it("rejects a malformed chat id before registration", () => {
    render(<BindingProbe chatId="not-a-uuid" />);

    expect(screen.getByTestId("binding")).toHaveAttribute(
      "data-status",
      "error",
    );
    expect(mockApiGet).not.toHaveBeenCalled();
    expect(mockRegisterProxiedAgent).not.toHaveBeenCalled();
  });

  it("does not register again for an ordinary rerender", async () => {
    const view = render(<BindingProbe chatId={CHAT_ONE} />);
    const localAgentId = screen.getByTestId("binding").dataset.agentId;
    await waitFor(() =>
      expect(mockRegisterProxiedAgent).toHaveBeenCalledTimes(1),
    );

    view.rerender(<BindingProbe chatId={CHAT_ONE} />);

    expect(screen.getByTestId("binding")).toHaveAttribute(
      "data-agent-id",
      localAgentId,
    );
    expect(mockRegisterProxiedAgent).toHaveBeenCalledTimes(1);
  });

  it("fails closed before registering against a replacement core owner", async () => {
    const firstUnregister = jest.fn();
    mockRegisterProxiedAgent
      .mockReturnValueOnce(successfulRegistration(firstUnregister))
      .mockImplementation(successfulRegistration);
    const view = render(<BindingProbe chatId={CHAT_ONE} />);
    await waitFor(() =>
      expect(mockRegisterProxiedAgent).toHaveBeenCalledTimes(1),
    );
    const observationStart = observedBindings.length;

    mockCopilotkit = {
      registerProxiedAgent: mockRegisterProxiedAgent,
    };
    view.rerender(<BindingProbe chatId={CHAT_ONE} />);

    expect(firstUnregister).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mockRegisterProxiedAgent).toHaveBeenCalledTimes(2),
    );
    expect(observedBindings.slice(observationStart)).toContainEqual({
      localAgentId: `${CHAT_RUNTIME_AGENT_ID}--${CHAT_ONE}`,
      status: "registering",
    });
  });

  it("hydrates the registered agent with the ordered durable transcript", async () => {
    mockApiGet.mockResolvedValue({
      data: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          role: "assistant",
          content: "answer",
          sequence: 2,
        },
        {
          id: "11111111-1111-4111-8111-111111111111",
          role: "user",
          content: "prompt",
          sequence: 1,
        },
      ],
    });

    render(<BindingProbe chatId={CHAT_ONE} />);

    await waitFor(() =>
      expect(screen.getByTestId("binding")).toHaveAttribute(
        "data-status",
        "ready",
      ),
    );
    expect(mockApiGet).toHaveBeenCalledWith(
      `/api/v1/chats/${CHAT_ONE}/messages`,
    );
    expect(mockSetMessages).toHaveBeenCalledWith([
      {
        id: "11111111-1111-4111-8111-111111111111",
        role: "user",
        content: "prompt",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        role: "assistant",
        content: "answer",
      },
    ]);

    const agent = registeredAgents.at(-1)!;
    agent.messages = [];
    agent.subscribe.mock.calls[0][0].onRunFinalized();
    expect(mockSetMessages).toHaveBeenCalledTimes(2);
    expect(agent.messages.map((message) => message.content)).toEqual([
      "prompt",
      "answer",
    ]);
  });

  it("builds one deterministic local id without randomness", () => {
    const expected = `${CHAT_RUNTIME_AGENT_ID}--${CHAT_ONE}`;

    expect(createThreadScopedAgentId(CHAT_ONE)).toBe(expected);
    expect(createThreadScopedAgentId(CHAT_ONE)).toBe(expected);
    expect(createThreadScopedAgentId(CHAT_ONE)).toBe(expected);
  });
});
