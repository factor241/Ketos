import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import DeleteConfirmationModal from "../index";

describe("DeleteConfirmationModal", () => {
  it("uses its button child as the dialog trigger without nesting buttons", () => {
    const { container } = render(
      <DeleteConfirmationModal onConfirm={jest.fn()}>
        <Button data-testid="delete-trigger">Delete</Button>
      </DeleteConfirmationModal>,
    );

    expect(screen.getByTestId("delete-trigger")).toBeInTheDocument();
    expect(container.querySelector("button button")).not.toBeInTheDocument();
  });
});
