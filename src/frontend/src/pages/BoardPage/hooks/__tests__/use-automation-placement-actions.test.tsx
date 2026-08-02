import { act, renderHook } from "@testing-library/react";

import { useCreateBoardAutomation } from "@/controllers/API/queries/boards";
import { usePostPlacement } from "@/controllers/API/queries/placements";
import useAlertStore from "@/stores/alertStore";
import type { Placement } from "@/types/board";
import { useAutomationPlacementActions } from "../use-automation-placement-actions";

jest.mock("@/controllers/API/queries/boards", () => ({
  useCreateBoardAutomation: jest.fn(),
}));
jest.mock("@/controllers/API/queries/placements", () => ({
  usePostPlacement: jest.fn(),
}));
jest.mock("@/stores/alertStore", () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

const mockUseCreateBoardAutomation = useCreateBoardAutomation as jest.Mock;
const mockUsePostPlacement = usePostPlacement as jest.Mock;
const mockGetAlertState = useAlertStore.getState as jest.Mock;
const mockCreateAutomation = jest.fn();
const mockPostPlacement = jest.fn();
const mockSetErrorData = jest.fn();
const idempotencyKey = "11111111-1111-4111-8111-111111111111";

const summary = { id: "flow-1", name: "Daily report", description: "" };
const placement: Placement = {
  id: "placement-1",
  boardId: "board-1",
  targetKind: "automation",
  targetId: "flow-1",
  x: 20,
  y: 30,
  width: 360,
  height: 240,
  zIndex: 0,
  displayState: "normal",
  revision: 0,
  createdAt: "",
  updatedAt: "",
};
const created = {
  automation: { id: "created-flow", name: "Created", description: null },
  placement: { ...placement, targetId: "created-flow" },
  idempotencyReplayed: false,
};

describe("useAutomationPlacementActions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: jest.fn(() => idempotencyKey),
    });
    mockUseCreateBoardAutomation.mockReturnValue({
      mutateAsync: mockCreateAutomation,
      isPending: false,
    });
    mockUsePostPlacement.mockReturnValue({
      mutateAsync: mockPostPlacement,
      isPending: false,
    });
    mockGetAlertState.mockReturnValue({ setErrorData: mockSetErrorData });
  });

  it("rejects an empty project before creating anything", async () => {
    const { result } = renderHook(() =>
      useAutomationPlacementActions({ projectId: "   ", boardId: "board-1" }),
    );

    await expect(
      result.current.createAndPlace({ x: 200, y: 200 }),
    ).rejects.toThrow("project");
    expect(mockCreateAutomation).not.toHaveBeenCalled();
    expect(mockPostPlacement).not.toHaveBeenCalled();
  });

  it("places one existing automation and avoids a present duplicate", async () => {
    mockPostPlacement.mockResolvedValue(placement);
    const { result } = renderHook(() =>
      useAutomationPlacementActions({
        projectId: "project-1",
        boardId: "board-1",
      }),
    );

    await act(async () => {
      await result.current.placeExisting(summary, [], { x: 200, y: 180 });
    });
    expect(mockPostPlacement).toHaveBeenCalledWith({
      targetKind: "automation",
      targetId: "flow-1",
      x: 20,
      y: 60,
      width: 360,
      height: 240,
    });
    await expect(
      result.current.placeExisting(summary, [placement], { x: 0, y: 0 }),
    ).resolves.toBe(placement);
    expect(mockPostPlacement).toHaveBeenCalledTimes(1);
    expect(mockCreateAutomation).not.toHaveBeenCalled();
  });

  it("creates Flow and Placement through one atomic command", async () => {
    mockCreateAutomation.mockResolvedValue(created);
    const { result } = renderHook(() =>
      useAutomationPlacementActions({
        projectId: "  project-1  ",
        boardId: "board-1",
      }),
    );

    await act(async () => {
      await result.current.createAndPlace({ x: 200, y: 180 });
    });
    expect(mockCreateAutomation).toHaveBeenCalledTimes(1);
    expect(mockCreateAutomation).toHaveBeenCalledWith({
      idempotencyKey,
      starter: {
        kind: "blank_automation",
        name: "board.automation.defaultName",
      },
      placement: {
        x: 20,
        y: 60,
        width: 360,
        height: 240,
      },
    });
    expect(mockPostPlacement).not.toHaveBeenCalled();
  });

  it("exposes only a bounded error when the atomic command fails", async () => {
    mockCreateAutomation.mockRejectedValue(
      new Error("secret backend command detail"),
    );
    const { result } = renderHook(() =>
      useAutomationPlacementActions({
        projectId: "project-1",
        boardId: "board-1",
      }),
    );

    await expect(
      result.current.createAndPlace({ x: 200, y: 180 }),
    ).rejects.toThrow("secret backend command detail");
    expect(mockPostPlacement).not.toHaveBeenCalled();
    expect(mockSetErrorData).toHaveBeenCalledWith({
      title: "board.automation.placementError",
      list: ["errors.generic"],
    });
    expect(JSON.stringify(mockSetErrorData.mock.calls)).not.toContain(
      "secret backend command detail",
    );
  });

  it("does not submit a second create while the first intent is pending", async () => {
    let resolve!: (value: typeof created) => void;
    mockCreateAutomation.mockReturnValue(
      new Promise<typeof created>((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() =>
      useAutomationPlacementActions({
        projectId: "project-1",
        boardId: "board-1",
      }),
    );

    const first = result.current.createAndPlace({ x: 200, y: 180 });
    await expect(
      result.current.createAndPlace({ x: 200, y: 180 }),
    ).rejects.toThrow("already in flight");
    expect(mockCreateAutomation).toHaveBeenCalledTimes(1);
    resolve(created);
    await first;
  });

  it("re-places the same canonical Flow after close without creating another Flow", async () => {
    mockPostPlacement.mockResolvedValue(placement);
    const { result } = renderHook(() =>
      useAutomationPlacementActions({
        projectId: "project-1",
        boardId: "board-1",
      }),
    );

    await act(async () => {
      await result.current.placeExisting(summary, [], { x: 200, y: 180 });
      await result.current.placeExisting(summary, [], { x: 240, y: 220 });
    });
    expect(mockPostPlacement).toHaveBeenCalledTimes(2);
    expect(mockPostPlacement.mock.calls[0][0].targetId).toBe("flow-1");
    expect(mockPostPlacement.mock.calls[1][0].targetId).toBe("flow-1");
    expect(mockCreateAutomation).not.toHaveBeenCalled();
  });
});
