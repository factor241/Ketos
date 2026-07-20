/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import { TextDecoder, TextEncoder } from "node:util";

Object.defineProperties(globalThis, {
  TextDecoder: { configurable: true, value: TextDecoder },
  TextEncoder: { configurable: true, value: TextEncoder },
});

const { CopilotKitCore, ProxiedCopilotRuntimeAgent } =
  jest.requireActual<typeof import("@copilotkit/core")>("@copilotkit/core");

const CHAT_ONE = "11111111-1111-4111-8111-111111111111";
const CHAT_TWO = "22222222-2222-4222-8222-222222222222";

describe("pinned CopilotKit proxied-agent contract", () => {
  it("shows why one registry id cannot own two thread ids", () => {
    const core = new CopilotKitCore({ deferInitialConnection: true });
    const registered = core.registerProxiedAgent({
      agentId: "ketos-chat",
      runtimeAgentId: "ketos-chat",
    });
    const firstConsumer = core.getAgent("ketos-chat");
    const secondConsumer = core.getAgent("ketos-chat");

    expect(firstConsumer).toBe(secondConsumer);
    if (!firstConsumer || !secondConsumer) {
      throw new Error("The registered dependency-contract agent is required");
    }
    firstConsumer.threadId = CHAT_ONE;
    secondConsumer.threadId = CHAT_TWO;
    expect(firstConsumer.threadId).toBe(CHAT_TWO);
    registered.unregister();
  });

  it("keeps two local proxies distinct while routing both to ketos-chat", () => {
    const core = new CopilotKitCore({ deferInitialConnection: true });
    const first = core.registerProxiedAgent({
      agentId: `ketos-chat--${CHAT_ONE}`,
      runtimeAgentId: "ketos-chat",
    });
    const second = core.registerProxiedAgent({
      agentId: `ketos-chat--${CHAT_TWO}`,
      runtimeAgentId: "ketos-chat",
    });

    expect(first.agent).not.toBe(second.agent);
    expect(first.agent).toBeInstanceOf(ProxiedCopilotRuntimeAgent);
    expect(second.agent).toBeInstanceOf(ProxiedCopilotRuntimeAgent);
    expect(first.agent.runtimeAgentId).toBe("ketos-chat");
    expect(second.agent.runtimeAgentId).toBe("ketos-chat");

    first.unregister();
    second.unregister();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(core.getAgent(`ketos-chat--${CHAT_ONE}`)).toBeUndefined();
    expect(core.getAgent(`ketos-chat--${CHAT_TWO}`)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
