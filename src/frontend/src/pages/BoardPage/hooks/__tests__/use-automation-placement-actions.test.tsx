import { act, renderHook } from "@testing-library/react";

import { usePostPlacement } from "@/controllers/API/queries/placements";
import useAddFlow from "@/hooks/flows/use-add-flow";
import useAlertStore from "@/stores/alertStore";
import type { Placement } from "@/types/board";
import { useAutomationPlacementActions } from "../use-automation-placement-actions";

jest.mock("@/controllers/API/queries/placements", () => ({
  usePostPlacement: jest.fn(),
}));
jest.mock("@/hooks/flows/use-add-flow", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("@/stores/alertStore", () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

const mockUsePostPlacement = usePostPlacement as jest.Mock;
const mockUseAddFlow = useAddFlow as jest.Mock;
const mockGetAlertState = useAlertStore.getState as jest.Mock;
const mockAddFlow = jest.fn();
const mockMutateAsync = jest.fn();
const mockSetErrorData = jest.fn();

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

describe("useAutomationPlacementActions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAddFlow.mockReturnValue(mockAddFlow);
    mockUsePostPlacement.mockReturnValue({
      mutateAsync: mockMutateAsync,
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
    expect(mockAddFlow).not.toHaveBeenCalled();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("places one existing automation and avoids a present duplicate", async () => {
    mockMutateAsync.mockResolvedValue(placement);
    const { result } = renderHook(() =>
      useAutomationPlacementActions({
        projectId: "project-1",
        boardId: "board-1",
      }),
    );
    await act(async () => {
      await result.current.placeExisting(summary, [], { x: 200, y: 180 });
    });
    expect(mockMutateAsync).toHaveBeenCalledWith({
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
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("creates exactly one Flow in the Board project and one Placement", async () => {
    mockAddFlow.mockResolvedValue("created-flow");
    mockMutateAsync.mockResolvedValue({
      ...placement,
      targetId: "created-flow",
    });
    const { result } = renderHook(() =>
      useAutomationPlacementActions({
        projectId: "  project-1  ",
        boardId: "board-1",
      }),
    );
    await act(async () => {
      await result.current.createAndPlace({ x: 200, y: 180 });
    });
    expect(mockAddFlow).toHaveBeenCalledTimes(1);
    expect(mockAddFlow).toHaveBeenCalledWith({
      new_blank: true,
      targetProjectId: "project-1",
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        targetKind: "automation",
        targetId: "created-flow",
      }),
    );
  });

  it("keeps a created Flow and exposes only a bounded placement error", async () => {
    mockAddFlow.mockResolvedValue("created-flow");
    mockMutateAsync.mockRejectedValue(
      new Error("secret backend placement detail"),
    );
    const { result } = renderHook(() =>
      useAutomationPlacementActions({
        projectId: "project-1",
        boardId: "board-1",
      }),
    );
    await expect(
      result.current.createAndPlace({ x: 200, y: 180 }),
    ).rejects.toThrow("secret backend placement detail");
    expect(mockAddFlow).toHaveBeenCalledTimes(1);
    expect(mockSetErrorData).toHaveBeenCalledWith({
      title: "board.automation.placementError",
      list: ["errors.generic"],
    });
    expect(JSON.stringify(mockSetErrorData.mock.calls)).not.toContain(
      "secret backend placement detail",
    );
  });

  it("re-places the same canonical Flow after close without creating another Flow", async () => {
    mockMutateAsync.mockResolvedValue(placement);
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
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
    expect(mockMutateAsync.mock.calls[0][0].targetId).toBe("flow-1");
    expect(mockMutateAsync.mock.calls[1][0].targetId).toBe("flow-1");
    expect(mockAddFlow).not.toHaveBeenCalled();
  });
});
