import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { CopilotKitBoardProvider } from "../CopilotKitBoardProvider";

const runtimeUrls: Array<string | undefined> = [];
jest.mock("@copilotkit/react-core/v2", () => ({
  CopilotKitProvider: ({
    children,
    runtimeUrl,
  }: {
    children: ReactNode;
    runtimeUrl?: string;
  }) => {
    runtimeUrls.push(runtimeUrl);
    return <div data-testid="copilotkit-provider">{children}</div>;
  },
}));

describe("CopilotKitBoardProvider", () => {
  beforeEach(() => {
    runtimeUrls.length = 0;
  });

  it("mounts one fixed same-origin provider for an enabled board", () => {
    render(
      <CopilotKitBoardProvider enabled>
        <span>board</span>
      </CopilotKitBoardProvider>,
    );

    expect(screen.getAllByTestId("copilotkit-provider")).toHaveLength(1);
    expect(runtimeUrls).toEqual(["/api/copilotkit"]);
  });

  it("hides only the provider surface when the flag is off", () => {
    render(
      <CopilotKitBoardProvider enabled={false}>
        <span>board</span>
      </CopilotKitBoardProvider>,
    );

    expect(screen.queryByTestId("copilotkit-provider")).not.toBeInTheDocument();
    expect(screen.getByText("board")).toBeInTheDocument();
    expect(runtimeUrls).toEqual([]);
  });
});
