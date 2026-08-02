import type { Placement } from "@/types/board";

import { computeResultPlacementGeometry } from "../compute-result-placement-position";

const automation: Placement = {
  id: "automation-placement",
  boardId: "board-1",
  targetKind: "automation",
  targetId: "flow-1",
  x: 100,
  y: 200,
  width: 420,
  height: 280,
  zIndex: 3,
  displayState: "normal",
  revision: 1,
  createdAt: "2026-07-21T00:00:00Z",
  updatedAt: "2026-07-21T00:00:00Z",
};

describe("computeResultPlacementGeometry", () => {
  it("places the first result beside the automation in logical coordinates", () => {
    expect(computeResultPlacementGeometry(automation, [])).toEqual({
      x: 552,
      y: 200,
      width: 420,
      height: 280,
      zIndex: 4,
    });
  });

  it("deterministically advances below occupied result rectangles", () => {
    const occupied: Placement[] = [
      {
        ...automation,
        id: "result-b",
        targetKind: "job_result",
        targetId: "job-b",
        x: 552,
        y: 504,
        zIndex: 7,
      },
      {
        ...automation,
        id: "result-a",
        targetKind: "job_result",
        targetId: "job-a",
        x: 552,
        y: 200,
        zIndex: 6,
      },
    ];

    expect(computeResultPlacementGeometry(automation, occupied)).toEqual({
      x: 552,
      y: 808,
      width: 420,
      height: 280,
      zIndex: 8,
    });
    expect(
      computeResultPlacementGeometry(automation, [...occupied].reverse()),
    ).toEqual(computeResultPlacementGeometry(automation, occupied));
  });

  it("ignores non-overlapping cards but raises z-index above the scene", () => {
    expect(
      computeResultPlacementGeometry(automation, [
        { ...automation, id: "left", x: -500, y: -500, zIndex: 12 },
      ]),
    ).toEqual({ x: 552, y: 200, width: 420, height: 280, zIndex: 13 });
  });
});
