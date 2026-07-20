import { renderHook } from "@testing-library/react";

import { useGetProjectBoardNotes } from "@/controllers/API/queries/board-notes";
import { useGetBoardPlacements } from "@/controllers/API/queries/placements";
import { useBoardScene } from "../use-board-scene";

jest.mock("@/controllers/API/queries/board-notes");
jest.mock("@/controllers/API/queries/placements");

const mockNotes = jest.mocked(useGetProjectBoardNotes);
const mockPlacements = jest.mocked(useGetBoardPlacements);

describe("useBoardScene", () => {
  it("loads a deterministic node-only scene and refreshes both resources", async () => {
    const refetchNotes = jest.fn();
    const refetchPlacements = jest.fn();
    mockNotes.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: refetchNotes,
    } as never);
    mockPlacements.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: refetchPlacements,
    } as never);

    const { result } = renderHook(() =>
      useBoardScene({ projectId: "project-1", boardId: "board-1" }),
    );

    expect(result.current.nodes).toEqual([]);
    expect(result.current.edges).toEqual([]);
    await result.current.refetch();
    expect(refetchNotes).toHaveBeenCalledTimes(1);
    expect(refetchPlacements).toHaveBeenCalledTimes(1);
  });
});
