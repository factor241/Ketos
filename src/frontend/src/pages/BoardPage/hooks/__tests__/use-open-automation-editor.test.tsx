import { act, renderHook } from "@testing-library/react";

const mockNavigate = jest.fn();

jest.mock("@/customization/hooks/use-custom-navigate", () => ({
  useCustomNavigate: () => mockNavigate,
}));

import { useOpenAutomationEditor } from "../use-open-automation-editor";

const args = {
  flowId: "11111111-1111-4111-8111-111111111111",
  boardId: "22222222-2222-4222-8222-222222222222",
  placementId: "33333333-3333-4333-8333-333333333333",
};
const expectedHref = `/flow/${args.flowId}?returnBoardId=${args.boardId}&returnPlacementId=${args.placementId}`;

describe("useOpenAutomationEditor", () => {
  beforeEach(() => jest.clearAllMocks());

  it("exposes a canonical href without navigating", () => {
    const { result } = renderHook(() => useOpenAutomationEditor(args));
    expect(result.current.href).toBe(expectedHref);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("uses custom same-tab navigation and keeps stable outputs", () => {
    const { result, rerender } = renderHook(() =>
      useOpenAutomationEditor(args),
    );
    const callback = result.current.openAutomationEditor;
    rerender();
    expect(result.current.href).toBe(expectedHref);
    expect(result.current.openAutomationEditor).toBe(callback);
    act(() => result.current.openAutomationEditor());
    expect(mockNavigate).toHaveBeenCalledWith(expectedHref);
  });
});
