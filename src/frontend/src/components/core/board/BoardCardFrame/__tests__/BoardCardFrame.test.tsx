import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BoardCardFrame, type BoardCardFrameProps } from "..";

let resizerProps: Record<string, unknown> = {};
jest.mock("@xyflow/react", () => ({
  NodeResizer: (props: Record<string, unknown>) => {
    resizerProps = props;
    return <div data-testid="resizer" />;
  },
}));
const labels = {
  collapse: "Collapse card",
  expand: "Expand card",
  maximize: "Maximize card",
  restore: "Restore card",
  close: "Close placement",
  deleteEntity: "Delete note",
};
const makeProps = (
  overrides: Partial<BoardCardFrameProps> = {},
): BoardCardFrameProps => ({
  title: "Board note",
  children: <p>Body</p>,
  selected: true,
  displayState: "normal",
  width: 320,
  height: 240,
  labels,
  onDisplayStateChange: jest.fn(),
  onClose: jest.fn(),
  onDeleteEntity: jest.fn(),
  onResizeEnd: jest.fn(),
  onKeyboardMove: jest.fn(),
  onKeyboardResize: jest.fn(),
  ...overrides,
});
it("keeps close and entity delete distinct", async () => {
  const user = userEvent.setup();
  const p = makeProps();
  render(<BoardCardFrame {...p} />);
  await user.click(screen.getByRole("button", { name: labels.close }));
  expect(p.onClose).toHaveBeenCalled();
  expect(p.onDeleteEntity).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: labels.deleteEntity }));
  expect(p.onDeleteEntity).toHaveBeenCalled();
});
it("persists only bounded resize end", () => {
  const p = makeProps();
  render(<BoardCardFrame {...p} />);
  expect(resizerProps.onResize).toBeUndefined();
  (
    resizerProps.onResizeEnd as (
      event: unknown,
      size: { width: number; height: number },
    ) => void
  )(null, { width: 2000, height: 100 });
  expect(p.onResizeEnd).toHaveBeenCalledWith({ width: 1600, height: 160 });
});
it("changes display without geometry and handles keyboard", () => {
  const p = makeProps();
  render(<BoardCardFrame {...p} />);
  const frame = screen.getByRole("region");
  fireEvent.keyDown(frame, { key: "ArrowRight", shiftKey: true });
  expect(p.onKeyboardMove).toHaveBeenCalledWith({ x: 40, y: 0 });
  fireEvent.keyDown(frame, { key: "ArrowDown", altKey: true });
  expect(p.onKeyboardResize).toHaveBeenCalledWith({ width: 0, height: 10 });
});
