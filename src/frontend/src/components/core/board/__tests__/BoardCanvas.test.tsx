import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactFlowInstance, Viewport } from "@xyflow/react";

import BoardCanvas, { BoardCanvas as NamedBoardCanvas } from "../index";

let flowProps: Record<string, unknown> = {};
let controlsProps: Record<string, unknown> = {};
let viewport: Viewport = { x: 10, y: 20, zoom: 1 };
const setViewport = jest.fn(async (next: Viewport) => {
  viewport = next;
  return true;
});
const instance = {
  setViewport,
  getViewport: jest.fn(() => viewport),
} as unknown as ReactFlowInstance;

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("@xyflow/react", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    BackgroundVariant: { Dots: "dots" },
    ReactFlowProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement("div", { "data-testid": "provider" }, children),
    ReactFlow: (props: Record<string, unknown> & { children?: ReactNode }) => {
      flowProps = props;
      React.useEffect(() => {
        (props.onInit as ((value: ReactFlowInstance) => void) | undefined)?.(instance);
      }, [props.onInit]);
      return React.createElement("div", { "data-testid": "react-flow" }, props.children);
    },
    Background: ({ variant }: { variant?: string }) =>
      React.createElement("div", { "data-testid": "background", "data-variant": variant }),
    MiniMap: () => React.createElement("div", { "data-testid": "minimap" }),
    Controls: (props: Record<string, unknown> & { children?: ReactNode }) => {
      controlsProps = props;
      return React.createElement(
        "div",
        { "data-testid": "controls" },
        React.createElement("button", { type: "button", "aria-label": "zoom in" }),
        React.createElement("button", { type: "button", "aria-label": "zoom out" }),
        props.children,
      );
    },
    ControlButton: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement("button", { type: "button", ...props }, children),
  };
});

const initialViewport: Viewport = { x: 10, y: 20, zoom: 1 };

function renderCanvas(onMoveEnd = jest.fn(), onMoveStart = jest.fn()) {
  return {
    onMoveEnd,
    onMoveStart,
    ...render(
      <BoardCanvas
        initialViewport={initialViewport}
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
      />,
    ),
  };
}

beforeEach(() => {
  viewport = { ...initialViewport };
  flowProps = {};
  controlsProps = {};
  setViewport.mockClear();
});

it("exports one BoardCanvas implementation", () => {
  expect(BoardCanvas).toBe(NamedBoardCanvas);
});

it("renders the exact empty non-interactive React Flow contract", () => {
  const { onMoveEnd, onMoveStart } = renderCanvas();
  expect(flowProps).toEqual(
    expect.objectContaining({
      nodes: [],
      edges: [],
      fitView: false,
      defaultViewport: initialViewport,
      minZoom: 0.5,
      maxZoom: 2,
      nodesDraggable: false,
      nodesConnectable: false,
      elementsSelectable: false,
      onMoveStart,
      onMoveEnd,
    }),
  );
  expect(screen.getByTestId("background")).toHaveAttribute("data-variant", "dots");
  expect(screen.getByTestId("minimap")).toBeInTheDocument();
  expect(controlsProps.showFitView).toBe(false);
  expect(screen.getByRole("button", { name: "zoom in" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "zoom out" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /fit/i })).not.toBeInTheDocument();
});

it("moves focus into and back out of the labelled canvas", async () => {
  const user = userEvent.setup();
  renderCanvas();
  const entry = screen.getByRole("button", { name: "board.canvas.open" });
  const region = screen.getByRole("region", { name: "board.canvas.label" });
  entry.focus();
  await user.keyboard("{Enter}");
  expect(region).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(entry).toHaveFocus();
  await user.click(entry);
  expect(region).toHaveFocus();
});

it("pans 40 pixels and 160 pixels with Shift through persistence", async () => {
  const user = userEvent.setup();
  const { onMoveEnd } = renderCanvas();
  const region = screen.getByRole("region", { name: "board.canvas.label" });
  region.focus();
  await user.keyboard("{ArrowRight}");
  expect(setViewport).toHaveBeenNthCalledWith(
    1,
    { x: -30, y: 20, zoom: 1 },
    { duration: 0 },
  );
  await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
  expect(setViewport).toHaveBeenNthCalledWith(
    2,
    { x: -30, y: -140, zoom: 1 },
    { duration: 0 },
  );
  expect(onMoveEnd).toHaveBeenCalledTimes(2);
});

it("clamps zoom and resets from keyboard and control", async () => {
  const user = userEvent.setup();
  const { onMoveEnd } = renderCanvas();
  const region = screen.getByRole("region", { name: "board.canvas.label" });
  region.focus();
  viewport = { x: 5, y: 6, zoom: 1.9 };
  fireEvent.keyDown(region, { key: "+" });
  fireEvent.keyDown(region, { key: "+" });
  expect(setViewport).toHaveBeenNthCalledWith(2, { x: 5, y: 6, zoom: 2 }, { duration: 0 });
  viewport = { x: 5, y: 6, zoom: 0.6 };
  fireEvent.keyDown(region, { key: "-" });
  expect(setViewport).toHaveBeenNthCalledWith(3, { x: 5, y: 6, zoom: 0.5 }, { duration: 0 });
  await user.keyboard("0");
  await user.click(screen.getByRole("button", { name: "board.viewport.reset" }));
  expect(setViewport).toHaveBeenLastCalledWith({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
  expect(onMoveEnd).toHaveBeenCalledTimes(5);
});
