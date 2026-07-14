import { render, screen } from "@testing-library/react";
import { CanvasReadOnlyProvider } from "@/contexts/canvas-read-only-context";
import NodeUpdateComponent from "../index";

describe("NodeUpdateComponent canvas read-only contract", () => {
  it("keeps status visible without update or dismiss mutations", () => {
    const handleUpdateCode = jest.fn();
    const setDismissAll = jest.fn();

    render(
      <CanvasReadOnlyProvider readOnly>
        <NodeUpdateComponent
          hasBreakingChange={false}
          showNode
          handleUpdateCode={handleUpdateCode}
          loadingUpdate={false}
          setDismissAll={setDismissAll}
        />
      </CanvasReadOnlyProvider>,
    );

    expect(
      screen.getByText("Update ready", { exact: true }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("update-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dismiss-warning-bar")).not.toBeInTheDocument();
    expect(handleUpdateCode).not.toHaveBeenCalled();
    expect(setDismissAll).not.toHaveBeenCalled();
  });
});
