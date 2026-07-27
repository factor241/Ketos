import { act, renderHook } from "@testing-library/react";
import { useSearchParams } from "react-router-dom";

import type { Placement } from "@/types/board";
import { useBoardReturnFocus } from "../use-board-return-focus";

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useSearchParams: jest.fn(),
}));

const mockedUseSearchParams = jest.mocked(useSearchParams);
const AUTOMATION_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

const placement = (id: string, targetKind: Placement["targetKind"]) =>
  ({ id, targetKind }) as Placement;

function setSearch(search = "") {
  mockedUseSearchParams.mockReturnValue([
    new URLSearchParams(search),
    jest.fn(),
  ]);
}

describe("useBoardReturnFocus", () => {
  let callbacks: FrameRequestCallback[];
  beforeEach(() => {
    callbacks = [];
    globalThis.requestAnimationFrame = jest.fn((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    globalThis.cancelAnimationFrame = jest.fn();
    setSearch();
  });
  afterEach(() => document.body.replaceChildren());

  const flush = () => {
    const current = callbacks;
    callbacks = [];
    current.forEach((callback, index) => callback(index));
  };
  const mount = (id: string) => {
    const wrapper = document.createElement("div");
    wrapper.dataset.id = id;
    const section = document.createElement("section");
    section.tabIndex = -1;
    wrapper.append(section);
    document.body.append(wrapper);
    return section;
  };

  it.each([
    [""],
    ["focusPlacementId=bad"],
    [`focusPlacementId=${AUTOMATION_ID}&focusPlacementId=${SECOND_ID}`],
  ])("ignores absent, malformed, or duplicate input: %s", (search) => {
    setSearch(search);
    const focus = jest.spyOn(mount(AUTOMATION_ID), "focus");
    renderHook(() =>
      useBoardReturnFocus({
        placements: [placement(AUTOMATION_ID, "automation")],
        isLoading: false,
      }),
    );
    act(() => {
      flush();
      flush();
    });
    expect(focus).not.toHaveBeenCalled();
  });

  it("waits for hydration then focuses exact automation once", () => {
    setSearch(`focusPlacementId=${AUTOMATION_ID}`);
    const focus = jest.spyOn(mount(AUTOMATION_ID), "focus");
    const placements = [placement(AUTOMATION_ID, "automation")];
    const { rerender } = renderHook(
      ({ isLoading }) => useBoardReturnFocus({ placements, isLoading }),
      { initialProps: { isLoading: true } },
    );
    act(() => {
      flush();
      flush();
    });
    expect(focus).not.toHaveBeenCalled();
    rerender({ isLoading: false });
    act(() => {
      flush();
      flush();
    });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    rerender({ isLoading: false });
    act(() => {
      flush();
      flush();
    });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("refocuses a replacement card when hydration detaches the focused section", () => {
    setSearch(`focusPlacementId=${AUTOMATION_ID}`);
    const original = mount(AUTOMATION_ID);
    renderHook(() =>
      useBoardReturnFocus({
        placements: [placement(AUTOMATION_ID, "automation")],
        isLoading: false,
      }),
    );
    act(() => {
      flush();
      flush();
    });
    expect(original).toHaveFocus();

    const replacement = document.createElement("section");
    replacement.tabIndex = -1;
    const replacementFocus = jest.spyOn(replacement, "focus");
    original.parentElement?.replaceChildren(replacement);
    expect(document.body).toHaveFocus();

    act(() => flush());

    expect(replacementFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(replacement).toHaveFocus();
  });

  it("does not steal focus back after pointer interaction", () => {
    setSearch(`focusPlacementId=${AUTOMATION_ID}`);
    const original = mount(AUTOMATION_ID);
    renderHook(() =>
      useBoardReturnFocus({
        placements: [placement(AUTOMATION_ID, "automation")],
        isLoading: false,
      }),
    );
    act(() => {
      flush();
      flush();
    });

    const userTarget = document.createElement("button");
    document.body.append(userTarget);
    act(() => {
      userTarget.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      userTarget.focus();
    });
    original.remove();
    act(() => flush());

    expect(userTarget).toHaveFocus();
  });

  it("ignores stale and wrong-kind placement, then accepts a changed valid id", () => {
    setSearch(`focusPlacementId=${AUTOMATION_ID}`);
    const firstFocus = jest.spyOn(mount(AUTOMATION_ID), "focus");
    const secondFocus = jest.spyOn(mount(SECOND_ID), "focus");
    const { rerender } = renderHook(
      ({ placements }) => useBoardReturnFocus({ placements, isLoading: false }),
      { initialProps: { placements: [placement(AUTOMATION_ID, "note")] } },
    );
    act(() => {
      flush();
      flush();
    });
    expect(firstFocus).not.toHaveBeenCalled();
    setSearch(`focusPlacementId=${SECOND_ID}`);
    rerender({ placements: [placement(SECOND_ID, "automation")] });
    act(() => {
      flush();
      flush();
    });
    expect(secondFocus).toHaveBeenCalledTimes(1);
  });
});
