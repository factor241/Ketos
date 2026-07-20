import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BoardNoteDeleteDialog } from "../BoardNoteDeleteDialog";

describe("BoardNoteDeleteDialog", () => {
  it("focuses the safe action and requires explicit destructive confirmation", async () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    render(
      <BoardNoteDeleteDialog
        open
        title="Delete note?"
        description="This deletes the entity."
        cancelLabel="Cancel"
        confirmLabel="Delete entity"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /cancel/i })).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole("button", { name: /delete entity/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    const onCancel = jest.fn();
    render(
      <BoardNoteDeleteDialog
        open
        title="Delete note?"
        description="Description"
        cancelLabel="Cancel"
        confirmLabel="Delete entity"
        onCancel={onCancel}
        onConfirm={jest.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
