import { renderHook } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";

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
  afterEach(() => jest.useRealTimers());

  it("persists geometry/display with CAS and closes only the placement", async () => {
    const patch = jest.fn();
    const remove = jest.fn().mockResolvedValue(undefined);
    mockPatch.mockReturnValue({ mutate: patch, isPending: false } as never);
    mockDelete.mockReturnValue({
      mutateAsync: remove,
      isPending: false,
    } as never);
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
    await result.current.closeAndWait(placement);
    expect(remove).toHaveBeenCalledWith({
      placementId: "placement-1",
      expectedRevision: 4,
    });
  });

  it("debounces keyboard auto-repeat into one final geometry PATCH", () => {
    jest.useFakeTimers();
    const patch = jest.fn();
    mockPatch.mockReturnValue({ mutate: patch, isPending: false } as never);
    mockDelete.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    } as never);
    const { result } = renderHook(() =>
      usePlacementPersistence({ boardId: "board-1" }),
    );

    result.current.queueMove(placement, { x: 11, y: 12 });
    result.current.queueMove(placement, { x: 21, y: 22 });
    result.current.queueMove(placement, { x: 31, y: 32 });
    expect(patch).not.toHaveBeenCalled();
    jest.advanceTimersByTime(150);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({
      placementId: placement.id,
      expectedRevision: placement.revision,
      x: 31,
      y: 32,
    });
  });

  it("announces a stale geometry conflict after server-truth refetch", () => {
    mockPatch.mockReturnValue({ mutate: jest.fn(), isPending: false } as never);
    mockDelete.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    } as never);
    const onConflict = jest.fn();
    renderHook(() =>
      usePlacementPersistence({ boardId: "board-1", onConflict }),
    );
    const options = mockPatch.mock.calls.at(-1)?.[1] as {
      onError: (error: unknown) => void;
    };
    options.onError(
      new AxiosError("Conflict", "ERR_BAD_REQUEST", undefined, undefined, {
        data: {},
        status: 409,
        statusText: "Conflict",
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
    );
    expect(onConflict).toHaveBeenCalledTimes(1);
  });
});
