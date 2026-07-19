import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import CopilotKitProbe from "../copilotkit-probe";

const mockProviderRuntimeUrls: Array<string | undefined> = [];
const mockChatAgentIds: Array<string | undefined> = [];

jest.mock("@copilotkit/react-core/v2", () => ({
  CopilotKitProvider: ({
    children,
    runtimeUrl,
  }: {
    children: ReactNode;
    runtimeUrl?: string;
  }) => {
    mockProviderRuntimeUrls.push(runtimeUrl);
    return <div data-testid="copilotkit-provider">{children}</div>;
  },
  CopilotChat: ({ agentId }: { agentId?: string }) => {
    mockChatAgentIds.push(agentId);
    return <div data-testid="copilotkit-chat" />;
  },
  useInterrupt: jest.fn(),
}));

describe("CopilotKitProbe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProviderRuntimeUrls.length = 0;
    mockChatAgentIds.length = 0;
  });

  it("should render exactly one provider with the fixed same-origin runtime", () => {
    render(<CopilotKitProbe />);

    expect(screen.getAllByTestId("copilotkit-provider")).toHaveLength(1);
    expect(mockProviderRuntimeUrls).toEqual(["/api/copilotkit"]);
  });

  it("should render exactly one stock chat for the fixed probe agent", () => {
    render(<CopilotKitProbe />);

    expect(screen.getAllByTestId("copilotkit-chat")).toHaveLength(1);
    expect(mockChatAgentIds).toEqual(["ketos-mvp-probe"]);
  });

  it("should remain isolated from the legacy assistant and custom chat renderers", () => {
    const source = readFileSync(
      join(__dirname, "..", "copilotkit-probe.tsx"),
      "utf8",
    );

    expect(source.match(/<CopilotKitProvider\b/g)).toHaveLength(1);
    expect(source).not.toMatch(
      /assistant-panel|use-assistant-chat|use-post-assist-stream|apply-flow-update/,
    );
    expect(source).not.toMatch(
      /renderToolCalls|renderActivityMessages|renderCustomMessages|frontendTools|humanInTheLoop|chatView\s*=/,
    );
  });

  it("imports the admitted stock CopilotKit stylesheet exactly once", () => {
    const source = readFileSync(
      join(__dirname, "..", "copilotkit-probe.tsx"),
      "utf8",
    );

    expect(
      source.match(/@copilotkit\/react-core\/v2\/styles\.css/g),
    ).toHaveLength(1);
  });
});
