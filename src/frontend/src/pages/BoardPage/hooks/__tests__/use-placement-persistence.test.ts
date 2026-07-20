import { renderHook } from "@testing-library/react";

import {
  useDeletePlacement,
  usePatchPlacement,
} from "@/controllers/API/queries/placements";
import type { Placement } from "@/types/board";
import { usePlacementPersistence } from "../use-placement-persistence";

jest.mock("@/controllers/API/queries/placements");
const mockPatch = jest.mocked(usePatchPlacement);
const mockDelete = jest.mocked(useDeletePlacement);
const placement = {
  id: "placement-1",
  boardId: "board-1",
  targetKind: "note",
  targetId: "note-1",
  x: 1,
  y: 2,
  width: 320,
  height: 240,
  zIndex: 0,
  displayState: "normal",
  revision: 4,
  createdAt: "",
  updatedAt: "",
} satisfies Placement;

describe("usePlacementPersistence", () => {
  it("persists geometry/display with CAS and closes only the placement", () => {
    const patch = jest.fn();
    const remove = jest.fn();
    mockPatch.mockReturnValue({ mutate: patch, isPending: false } as never);
    mockDelete.mockReturnValue({ mutate: remove, isPending: false } as never);
    const { result } = renderHook(() =>
      usePlacementPersistence({ boardId: "board-1" }),
    );
    result.current.move(placement, { x: 20, y: 30 });
    expect(patch).toHaveBeenCalledWith({
      placementId: "placement-1",
      expectedRevision: 4,
      x: 20,
      y: 30,
    });
    result.current.resize(placement, { width: 10, height: 5000 });
    expect(patch).toHaveBeenLastCalledWith({
      placementId: "placement-1",
      expectedRevision: 4,
      width: 240,
      height: 1200,
    });
    result.current.setDisplayState(placement, "collapsed");
    expect(patch).toHaveBeenLastCalledWith({
      placementId: "placement-1",
      expectedRevision: 4,
      displayState: "collapsed",
    });
    result.current.close(placement);
    expect(remove).toHaveBeenCalledWith({
      placementId: "placement-1",
      expectedRevision: 4,
    });
  });
});
