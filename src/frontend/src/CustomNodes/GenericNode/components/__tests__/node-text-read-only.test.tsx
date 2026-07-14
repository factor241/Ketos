import { render, screen } from "@testing-library/react";
import { CanvasReadOnlyProvider } from "@/contexts/canvas-read-only-context";
import NodeDescription from "../NodeDescription";
import NodeName from "../NodeName";

const setNode = jest.fn();
const takeSnapshot = jest.fn();

jest.mock("@/stores/flowStore", () => ({
  __esModule: true,
  default: (selector: (state: { setNode: typeof setNode }) => unknown) =>
    selector({ setNode }),
}));

jest.mock("@/stores/flowsManagerStore", () => ({
  __esModule: true,
  default: (
    selector: (state: { takeSnapshot: typeof takeSnapshot }) => unknown,
  ) => selector({ takeSnapshot }),
}));

describe("node text read-only contract", () => {
  beforeEach(() => {
    setNode.mockReset();
    takeSnapshot.mockReset();
  });

  it("does not expose the node-name editor", () => {
    render(
      <CanvasReadOnlyProvider readOnly>
        <NodeName
          display_name="Input"
          selected
          nodeId="node-1"
          showNode
          beta={false}
          editNameDescription
          toggleEditNameDescription={jest.fn()}
          setHasChangedNodeDescription={jest.fn()}
        />
      </CanvasReadOnlyProvider>,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(takeSnapshot).not.toHaveBeenCalled();
    expect(setNode).not.toHaveBeenCalled();
  });

  it("does not expose the description editor", () => {
    render(
      <CanvasReadOnlyProvider readOnly>
        <NodeDescription
          description="Description"
          selected
          nodeId="node-1"
          editNameDescription
          setEditNameDescription={jest.fn()}
        />
      </CanvasReadOnlyProvider>,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByTestId("generic-node-desc")).toBeInTheDocument();
    expect(takeSnapshot).not.toHaveBeenCalled();
    expect(setNode).not.toHaveBeenCalled();
  });
});
