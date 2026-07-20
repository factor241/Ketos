import { fireEvent, render, screen } from "@testing-library/react";

import type { BoardNote, Placement } from "@/types/board";
import { BoardNotePlacement } from "../BoardNotePlacement";

jest.mock("../../BoardCardFrame", () => ({
  BoardCardFrame: ({
    children,
    onClose,
    onDeleteEntity,
  }: {
    children: React.ReactNode;
    onClose: () => void;
    onDeleteEntity: () => void;
  }) => (
    <div>
      <button onClick={onClose}>close placement</button>
      <button onClick={onDeleteEntity}>delete note</button>
      {children}
    </div>
  ),
}));
jest.mock("../../BoardNoteMarkdown", () => ({
  BoardNoteMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

const note = {
  id: "note-1",
  projectId: "project-1",
  createdById: "user-1",
  content: "old",
  color: "not-a-color",
  revision: 1,
  createdAt: "",
  updatedAt: "",
} satisfies BoardNote;
const placement = {
  id: "placement-1",
  boardId: "board-1",
  targetKind: "note",
  targetId: "note-1",
  x: 0,
  y: 0,
  width: 320,
  height: 240,
  zIndex: 0,
  displayState: "normal",
  revision: 1,
  createdAt: "",
  updatedAt: "",
} satisfies Placement;

describe("BoardNotePlacement", () => {
  it("keeps placement close separate from entity deletion and controls the draft", () => {
    const onClose = jest.fn();
    const onDeleteEntity = jest.fn();
    const onDraftChange = jest.fn();
    render(
      <BoardNotePlacement
        note={note}
        placement={placement}
        selected={false}
        draft="draft"
        onDraftChange={onDraftChange}
        onSave={jest.fn()}
        onDisplayStateChange={jest.fn()}
        onClose={onClose}
        onDeleteEntity={onDeleteEntity}
        onResizeEnd={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close placement/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDeleteEntity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /delete note/i }));
    expect(onDeleteEntity).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "changed" },
    });
    expect(onDraftChange).toHaveBeenCalledWith("changed");
  });
});
