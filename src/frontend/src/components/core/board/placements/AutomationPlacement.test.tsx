import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";

import type { Placement } from "@/types/board";

import { AutomationPlacement } from "./AutomationPlacement";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

jest.mock("../BoardCardFrame", () => ({
  BoardCardFrame: ({
    title,
    children,
    onDisplayStateChange,
    onClosePlacement,
    onRequestDeleteEntity,
    onResizeEnd,
  }: {
    title: string;
    children: ReactNode;
    onDisplayStateChange: (state: "collapsed") => void;
    onClosePlacement: () => void;
    onRequestDeleteEntity: () => void;
    onResizeEnd: (size: { width: number; height: number }) => void;
  }) => (
    <section>
      <h2 data-testid="frame-title">{title}</h2>
      {children}
      <button type="button" onClick={() => onDisplayStateChange("collapsed")}>
        frame-collapse
      </button>
      <button type="button" onClick={onClosePlacement}>
        frame-close
      </button>
      <button type="button" onClick={onRequestDeleteEntity}>
        frame-delete
      </button>
      <button
        type="button"
        onClick={() => onResizeEnd({ width: 480, height: 320 })}
      >
        frame-resize
      </button>
    </section>
  ),
}));

const placement: Placement = {
  id: "placement-1",
  boardId: "board-1",
  targetKind: "automation",
  targetId: "flow-1",
  x: 10,
  y: 20,
  width: 420,
  height: 280,
  zIndex: 1,
  displayState: "normal",
  revision: 3,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

function createProps(
  overrides: Partial<ComponentProps<typeof AutomationPlacement>> = {},
): ComponentProps<typeof AutomationPlacement> {
  return {
    placement,
    selected: false,
    state: { status: "loading" },
    editHref:
      "/flow/flow-1?returnBoardId=board-1&returnPlacementId=placement-1",
    onRetry: jest.fn(),
    onDisplayStateChange: jest.fn(),
    onClosePlacement: jest.fn(),
    onDeleteEntity: jest.fn(),
    onResizeEnd: jest.fn(),
    ...overrides,
  };
}

describe("AutomationPlacement", () => {
  it("renders an accessible loading skeleton without editor actions", () => {
    render(<AutomationPlacement {...createProps()} />);
    expect(
      screen.getByRole("status", { name: "board.automation.title" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "board.automation.edit" }),
    ).not.toBeInTheDocument();
  });

  it("renders a matching summary, real Edit href, and explained disabled Run", () => {
    const editHref =
      "/flow/flow-1?returnBoardId=board-1&returnPlacementId=placement-1";
    render(
      <AutomationPlacement
        {...createProps({
          state: {
            status: "ready",
            summary: {
              id: "flow-1",
              name: "Customer onboarding",
              description: "Prepare and send the onboarding sequence.",
            },
          },
          editHref,
        })}
      />,
    );
    expect(screen.getByTestId("frame-title")).toHaveTextContent(
      "Customer onboarding",
    );
    expect(
      screen.getByText("Prepare and send the onboarding sequence."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "board.automation.edit" }),
    ).toHaveAttribute("href", editHref);
    const runButton = screen.getByRole("button", {
      name: "board.automation.run",
    });
    expect(runButton).toBeDisabled();
    expect(runButton).toHaveAttribute(
      "aria-describedby",
      "automation-run-explanation-placement-1",
    );
    expect(
      screen.getByText("board.automation.runAvailableInNextStage"),
    ).toHaveAttribute("id", "automation-run-explanation-placement-1");
  });

  it("renders the empty-description message", () => {
    render(
      <AutomationPlacement
        {...createProps({
          state: {
            status: "ready",
            summary: {
              id: "flow-1",
              name: "Untitled details",
              description: null,
            },
          },
        })}
      />,
    );
    expect(
      screen.getByText("board.automation.descriptionEmpty"),
    ).toBeInTheDocument();
  });

  it("renders missing for an absent or mismatched Flow without deletion", () => {
    const onDeleteEntity = jest.fn();
    const { rerender } = render(
      <AutomationPlacement
        {...createProps({ state: { status: "missing" }, onDeleteEntity })}
      />,
    );
    expect(screen.getByText("board.automation.missing")).toBeInTheDocument();
    rerender(
      <AutomationPlacement
        {...createProps({
          state: {
            status: "ready",
            summary: {
              id: "another-flow",
              name: "Wrong Flow",
              description: "Must not be displayed.",
            },
          },
          onDeleteEntity,
        })}
      />,
    );
    expect(screen.getByText("board.automation.missing")).toBeInTheDocument();
    expect(screen.queryByText("Wrong Flow")).not.toBeInTheDocument();
    expect(onDeleteEntity).not.toHaveBeenCalled();
  });

  it("shows a safe error and retries without deleting", async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    const onDeleteEntity = jest.fn();
    render(
      <AutomationPlacement
        {...createProps({
          state: { status: "error" },
          onRetry,
          onDeleteEntity,
        })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "board.automation.loadError",
    );
    await user.click(
      screen.getByRole("button", { name: "board.automation.retry" }),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDeleteEntity).not.toHaveBeenCalled();
  });

  it("keeps close and explicit entity deletion separate", async () => {
    const user = userEvent.setup();
    const onClosePlacement = jest.fn();
    const onDeleteEntity = jest.fn();
    render(
      <AutomationPlacement
        {...createProps({ onClosePlacement, onDeleteEntity })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "frame-close" }));
    expect(onClosePlacement).toHaveBeenCalledTimes(1);
    expect(onDeleteEntity).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "frame-delete" }));
    expect(onDeleteEntity).toHaveBeenCalledTimes(1);
  });

  it("does not import editor runtime or raw Flow payloads", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/components/core/board/placements/AutomationPlacement.tsx",
      ),
      "utf8",
    );
    for (const token of [
      "flowStore",
      "FlowPage",
      "PageComponent",
      "ViewPage",
      "ReactFlowProvider",
      "useReactFlow",
      "FlowType",
    ])
      expect(source).not.toContain(token);
    expect(source).not.toMatch(/\.data\b/);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
