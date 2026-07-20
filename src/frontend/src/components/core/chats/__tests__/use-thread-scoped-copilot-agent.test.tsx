import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";

import {
  CHAT_RUNTIME_AGENT_ID,
  createThreadScopedAgentId,
  useThreadScopedCopilotAgent,
} from "../use-thread-scoped-copilot-agent";

const CHAT_ONE = "11111111-1111-4111-8111-111111111111";
const CHAT_TWO = "22222222-2222-4222-8222-222222222222";

const mockRegisterProxiedAgent = jest.fn();
let mockCopilotkit = {
  registerProxiedAgent: mockRegisterProxiedAgent,
};

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

function successfulRegistration() {
  return { agent: {}, unregister: jest.fn() };
}

beforeEach(() => {
  observedBindings.length = 0;
  mockRegisterProxiedAgent.mockReset();
  mockRegisterProxiedAgent.mockImplementation(successfulRegistration);
  mockCopilotkit = {
    registerProxiedAgent: mockRegisterProxiedAgent,
  };
});

describe("useThreadScopedCopilotAgent", () => {
  it("registers two local ids against one runtime id", () => {
    render(
      <>
        <BindingProbe chatId={CHAT_ONE} />
        <BindingProbe chatId={CHAT_TWO} />
      </>,
    );

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
    expect(
      screen.getAllByTestId("binding").map((node) => node.dataset.agentId),
    ).toEqual([
      `${CHAT_RUNTIME_AGENT_ID}--${CHAT_ONE}`,
      `${CHAT_RUNTIME_AGENT_ID}--${CHAT_TWO}`,
    ]);
  });

  it("cleans both StrictMode registration handles", () => {
    const firstUnregister = jest.fn();
    const secondUnregister = jest.fn();
    mockRegisterProxiedAgent
      .mockReturnValueOnce({ agent: {}, unregister: firstUnregister })
      .mockReturnValueOnce({ agent: {}, unregister: secondUnregister });

    const view = render(
      <StrictMode>
        <BindingProbe chatId={CHAT_ONE} />
      </StrictMode>,
    );

    expect(mockRegisterProxiedAgent).toHaveBeenCalledTimes(2);
    expect(firstUnregister).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(secondUnregister).toHaveBeenCalledTimes(1);
  });

  it("fails closed before replacing a changed chat id", () => {
    const firstUnregister = jest.fn();
    mockRegisterProxiedAgent
      .mockReturnValueOnce({ agent: {}, unregister: firstUnregister })
      .mockImplementation(successfulRegistration);
    const view = render(<BindingProbe chatId={CHAT_ONE} />);
    const observationStart = observedBindings.length;

    view.rerender(<BindingProbe chatId={CHAT_TWO} />);

    expect(firstUnregister).toHaveBeenCalledTimes(1);
    expect(mockRegisterProxiedAgent).toHaveBeenLastCalledWith({
      agentId: `${CHAT_RUNTIME_AGENT_ID}--${CHAT_TWO}`,
      runtimeAgentId: CHAT_RUNTIME_AGENT_ID,
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

    expect(screen.getByTestId("binding")).toHaveAttribute(
      "data-status",
      "error",
    );
    expect(screen.getByTestId("binding")).toHaveTextContent(
      "agent ID collision",
    );

    await user.click(screen.getByRole("button", { name: "retry" }));

    expect(mockRegisterProxiedAgent).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("binding")).toHaveAttribute(
      "data-status",
      "ready",
    );
  });

  it("rejects a malformed chat id before registration", () => {
    render(<BindingProbe chatId="not-a-uuid" />);

    expect(screen.getByTestId("binding")).toHaveAttribute(
      "data-status",
      "error",
    );
    expect(mockRegisterProxiedAgent).not.toHaveBeenCalled();
  });

  it("does not register again for an ordinary rerender", () => {
    const view = render(<BindingProbe chatId={CHAT_ONE} />);
    const localAgentId = screen.getByTestId("binding").dataset.agentId;

    view.rerender(<BindingProbe chatId={CHAT_ONE} />);

    expect(screen.getByTestId("binding")).toHaveAttribute(
      "data-agent-id",
      localAgentId,
    );
    expect(mockRegisterProxiedAgent).toHaveBeenCalledTimes(1);
  });

  it("fails closed before registering against a replacement core owner", () => {
    const firstUnregister = jest.fn();
    mockRegisterProxiedAgent
      .mockReturnValueOnce({ agent: {}, unregister: firstUnregister })
      .mockImplementation(successfulRegistration);
    const view = render(<BindingProbe chatId={CHAT_ONE} />);
    const observationStart = observedBindings.length;

    mockCopilotkit = {
      registerProxiedAgent: mockRegisterProxiedAgent,
    };
    view.rerender(<BindingProbe chatId={CHAT_ONE} />);

    expect(firstUnregister).toHaveBeenCalledTimes(1);
    expect(mockRegisterProxiedAgent).toHaveBeenCalledTimes(2);
    expect(observedBindings.slice(observationStart)).toContainEqual({
      localAgentId: `${CHAT_RUNTIME_AGENT_ID}--${CHAT_ONE}`,
      status: "registering",
    });
  });

  it("builds one deterministic local id without randomness", () => {
    const expected = `${CHAT_RUNTIME_AGENT_ID}--${CHAT_ONE}`;

    expect(createThreadScopedAgentId(CHAT_ONE)).toBe(expected);
    expect(createThreadScopedAgentId(CHAT_ONE)).toBe(expected);
    expect(createThreadScopedAgentId(CHAT_ONE)).toBe(expected);
  });
});
