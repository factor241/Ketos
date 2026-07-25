import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useGetBoards } from "@/controllers/API/queries/boards";
import { BoardPickerDialog } from "../board-picker-dialog";

jest.mock("@/controllers/API/queries/boards", () => ({
  useGetBoards: jest.fn(),
}));

const mockBoards = jest.mocked(useGetBoards);
const refetch = jest.fn();

describe("BoardPickerDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows loading and project-scoped error Retry", async () => {
    mockBoards.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch,
    } as never);
    const { rerender } = render(
      <BoardPickerDialog
        open
        projectId="project-1"
        projectName="Research"
        onOpenChange={jest.fn()}
        onSelectBoard={jest.fn()}
        onCreateBoard={jest.fn()}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    mockBoards.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as never);
    rerender(
      <BoardPickerDialog
        open
        projectId="project-1"
        projectName="Research"
        onOpenChange={jest.fn()}
        onSelectBoard={jest.fn()}
        onCreateBoard={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mockBoards).toHaveBeenLastCalledWith(
      { projectId: "project-1" },
      expect.objectContaining({ enabled: true }),
    );
  });

  it("selects an existing Board or continues through Board creation", async () => {
    const onSelectBoard = jest.fn();
    const onCreateBoard = jest.fn();
    mockBoards.mockReturnValue({
      data: [{ id: "board-1", title: "Primary" }],
      isLoading: false,
      isError: false,
      refetch,
    } as never);
    const { rerender } = render(
      <BoardPickerDialog
        open
        projectId="project-1"
        projectName="Research"
        onOpenChange={jest.fn()}
        onSelectBoard={onSelectBoard}
        onCreateBoard={onCreateBoard}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /primary/i }));
    expect(onSelectBoard).toHaveBeenCalledWith("board-1");

    mockBoards.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch,
    } as never);
    rerender(
      <BoardPickerDialog
        open
        projectId="project-1"
        projectName="Research"
        onOpenChange={jest.fn()}
        onSelectBoard={onSelectBoard}
        onCreateBoard={onCreateBoard}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /create board/i }),
    );
    expect(onCreateBoard).toHaveBeenCalledTimes(1);
  });
});
