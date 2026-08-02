import { act, renderHook } from "@testing-library/react";

const localStorageMock = {
  getItem: jest.fn(() => null),
  setItem: jest.fn(),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

jest.unmock("@/stores/darkStore");
const { useDarkStore } = require("../darkStore");

describe("useDarkStore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  it("persists theme state only under the Ketos key", () => {
    const { result } = renderHook(() => useDarkStore());

    act(() => result.current.setDark(true));

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "ketos-is-dark",
      "true",
    );
  });

  it("updates current and latest versions", () => {
    const { result } = renderHook(() => useDarkStore());

    act(() => {
      result.current.refreshVersion("1.0.0");
      result.current.refreshLatestVersion("1.1.0");
    });

    expect(result.current.version).toBe("1.0.0");
    expect(result.current.latestVersion).toBe("1.1.0");
  });

  it("does not expose upstream social counters or refresh actions", () => {
    const { result } = renderHook(() => useDarkStore());

    expect(result.current).not.toHaveProperty("stars");
    expect(result.current).not.toHaveProperty("discordCount");
    expect(result.current).not.toHaveProperty("refreshStars");
    expect(result.current).not.toHaveProperty("refreshDiscordCount");
  });
});
