import { render, screen } from "@testing-library/react";
import {
  CanvasReadOnlyProvider,
  useCanvasReadOnly,
} from "../canvas-read-only-context";

function ReadOnlyProbe() {
  return <output>{useCanvasReadOnly() ? "read-only" : "editable"}</output>;
}

describe("CanvasReadOnlyProvider", () => {
  it("defaults consumers to editable outside a provider", () => {
    render(<ReadOnlyProbe />);

    expect(screen.getByText("editable")).toBeInTheDocument();
  });

  it("shares the read-only state with nested canvas components", () => {
    render(
      <CanvasReadOnlyProvider readOnly>
        <ReadOnlyProbe />
      </CanvasReadOnlyProvider>,
    );

    expect(screen.getByText("read-only")).toBeInTheDocument();
  });
});
