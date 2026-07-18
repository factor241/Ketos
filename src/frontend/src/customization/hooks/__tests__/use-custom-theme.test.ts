import { act, renderHook } from "@testing-library/react";

jest.unmock("@/stores/darkStore");

const storage = new Map<string, string>();
const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();
let systemPrefersDark = false;

const localStorageMock = {
  getItem: jest.fn((key: string) => storage.get(key) ?? null),
  setItem: jest.fn((key: string, value: string) => {
    storage.set(key, value);
  }),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

const mediaQueryList = {
  get matches() {
    return systemPrefersDark;
  },
  media: "(prefers-color-scheme: dark)",
  onchange: null,
  addListener: jest.fn(),
  removeListener: jest.fn(),
  addEventListener: jest.fn(
    (_event: string, listener: (event: MediaQueryListEvent) => void) => {
      mediaListeners.add(listener);
    },
  ),
  removeEventListener: jest.fn(
    (_event: string, listener: (event: MediaQueryListEvent) => void) => {
      mediaListeners.delete(listener);
    },
  ),
  dispatchEvent: jest.fn(),
};

window.matchMedia = jest.fn(() => mediaQueryList as MediaQueryList);
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

const { useDarkStore } = require("@/stores/darkStore");
const useTheme = require("../use-custom-theme").default;

const dispatchSystemThemeChange = (matches: boolean) => {
  systemPrefersDark = matches;
  const event = { matches } as MediaQueryListEvent;
  [...mediaListeners].forEach((listener) => listener(event));
};

describe("useTheme", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clear();
    mediaListeners.clear();
    systemPrefersDark = false;
    useDarkStore.setState({ dark: false });
  });

  it("should preserve an explicit light preference when another instance still listens for system changes", () => {
    const persistentHook = renderHook(() => useTheme());
    const preferenceHook = renderHook(() => useTheme());

    expect(persistentHook.result.current.systemTheme).toBe(true);
    expect(persistentHook.result.current.dark).toBe(false);

    act(() => {
      preferenceHook.result.current.setThemePreference("light");
    });
    act(() => {
      dispatchSystemThemeChange(true);
    });

    expect(preferenceHook.result.current.dark).toBe(false);
  });

  it("should preserve an explicit dark preference when another instance still listens for system changes", () => {
    systemPrefersDark = true;
    const persistentHook = renderHook(() => useTheme());
    const preferenceHook = renderHook(() => useTheme());

    expect(persistentHook.result.current.systemTheme).toBe(true);
    expect(persistentHook.result.current.dark).toBe(true);

    act(() => {
      preferenceHook.result.current.setThemePreference("dark");
    });
    act(() => {
      dispatchSystemThemeChange(false);
    });

    expect(preferenceHook.result.current.dark).toBe(true);
  });

  it("should keep following the system after the hook that selected System unmounts", () => {
    storage.set("ketos-theme-preference", "light");
    const persistentHook = renderHook(() => useTheme());
    const preferenceHook = renderHook(() => useTheme());

    expect(persistentHook.result.current.systemTheme).toBe(false);

    act(() => {
      preferenceHook.result.current.setThemePreference("system");
    });
    preferenceHook.unmount();
    act(() => {
      dispatchSystemThemeChange(true);
    });

    expect(persistentHook.result.current.dark).toBe(true);
  });
});
