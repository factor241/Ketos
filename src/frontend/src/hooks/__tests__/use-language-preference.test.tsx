import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { LANGUAGE_STORAGE_KEY } from "@/constants/languages";

let mockEvents: string[] = [];

const mockNormalizeLanguage = jest.fn();
const mockIsLanguageSupported = jest.fn();
const mockLoadLanguage = jest.fn();
const mockChangeLanguage = jest.fn();
const mockResetTypes = jest.fn(() => {
  mockEvents.push("resetTypes");
});
const mockApiPatch = jest.fn();
const mockSetUserData = jest.fn();
let mockUserData: {
  id: string;
  preferred_locale?: string | null;
} | null = null;

const mockI18n = {
  language: "ru",
  resolvedLanguage: "ru",
  changeLanguage: (language: string) => mockChangeLanguage(language),
  dir: jest.fn(() => "ltr"),
};

jest.mock("@/constants/languages", () => {
  const actual = jest.requireActual("@/constants/languages") as Record<
    string,
    unknown
  >;

  return {
    ...actual,
    isLanguageSupported: (language?: string | null) =>
      mockIsLanguageSupported(
        language,
        actual.isLanguageSupported as (value?: string | null) => boolean,
      ),
    normalizeLanguage: (language?: string | null) => {
      mockEvents.push(`normalize:${String(language)}`);
      return mockNormalizeLanguage(
        language,
        actual.normalizeLanguage as (value?: string | null) => string,
      );
    },
  };
});

jest.mock("@/i18n", () => ({
  __esModule: true,
  default: mockI18n,
  loadLanguage: (language: string) => mockLoadLanguage(language),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: mockI18n,
    t: (key: string) => key,
  }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

const mockTypesState = {
  // Keep both names available so this test describes the reset behaviour rather
  // than coupling the provider to the store's current implementation detail.
  resetTypes: mockResetTypes,
  setTypes: mockResetTypes,
};

const mockUseTypesStore = Object.assign(
  jest.fn((selector: (state: typeof mockTypesState) => unknown) =>
    selector(mockTypesState),
  ),
  { getState: () => mockTypesState },
);

jest.mock("@/stores/typesStore", () => ({
  useTypesStore: mockUseTypesStore,
}));

jest.mock("@/stores/authStore", () => ({
  __esModule: true,
  default: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      userData: mockUserData,
      setUserData: mockSetUserData,
    }),
}));

jest.mock("@/controllers/API/api", () => ({
  api: {
    patch: (...args: unknown[]) => mockApiPatch(...args),
  },
}));

import {
  LanguagePreferenceProvider,
  useLanguagePreference,
} from "../use-language-preference";

const localStorageGetItem = jest.spyOn(Storage.prototype, "getItem");
const localStorageSetItem = jest.spyOn(Storage.prototype, "setItem");

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderPreference = ({ strict = false } = {}) => {
  const queryClient = createQueryClient();

  const Wrapper = ({ children }: { children: ReactNode }) => {
    const tree = (
      <QueryClientProvider client={queryClient}>
        <LanguagePreferenceProvider>{children}</LanguagePreferenceProvider>
      </QueryClientProvider>
    );

    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };

  return {
    queryClient,
    ...renderHook(() => useLanguagePreference(), { wrapper: Wrapper }),
  };
};

const dispatchStorage = (key: string | null, newValue: string | null) => {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
};

let htmlLanguage = "ru";
let htmlDirection = "ltr";
let originalLanguageDescriptor: PropertyDescriptor | undefined;
let originalDirectionDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  mockEvents = [];
  window.history.replaceState({}, "", "/");

  mockI18n.language = "ru";
  mockI18n.resolvedLanguage = "ru";
  mockUserData = null;
  mockSetUserData.mockImplementation((user) => {
    mockUserData = user;
  });
  mockApiPatch.mockResolvedValue({ data: null });

  mockNormalizeLanguage.mockImplementation(
    (
      language: string | null | undefined,
      normalize: (value?: string | null) => string,
    ) => normalize(language),
  );
  mockIsLanguageSupported.mockImplementation(
    (
      language: string | null | undefined,
      isSupported: (value?: string | null) => boolean,
    ) => isSupported(language),
  );
  mockLoadLanguage.mockImplementation(async (language: string) => {
    mockEvents.push(`load:${language}`);
  });
  mockChangeLanguage.mockImplementation(async (language: string) => {
    mockEvents.push(`change:start:${language}`);
    mockI18n.language = language;
    mockI18n.resolvedLanguage = language;
    mockEvents.push(`change:end:${language}`);
  });

  localStorageGetItem.mockReturnValue(null);
  localStorageSetItem.mockImplementation((key: string, value: string) => {
    mockEvents.push(`storage:${key}=${value}`);
  });

  const html = document.documentElement;
  originalLanguageDescriptor = Object.getOwnPropertyDescriptor(html, "lang");
  originalDirectionDescriptor = Object.getOwnPropertyDescriptor(html, "dir");
  htmlLanguage = "ru";
  htmlDirection = "ltr";
  Object.defineProperty(html, "lang", {
    configurable: true,
    get: () => htmlLanguage,
    set: (value: string) => {
      htmlLanguage = value;
      mockEvents.push(`html.lang:${value}`);
    },
  });
  Object.defineProperty(html, "dir", {
    configurable: true,
    get: () => htmlDirection,
    set: (value: string) => {
      htmlDirection = value;
      mockEvents.push(`html.dir:${value}`);
    },
  });
});

afterEach(() => {
  const html = document.documentElement;
  if (originalLanguageDescriptor) {
    Object.defineProperty(html, "lang", originalLanguageDescriptor);
  } else {
    Reflect.deleteProperty(html, "lang");
  }
  if (originalDirectionDescriptor) {
    Object.defineProperty(html, "dir", originalDirectionDescriptor);
  } else {
    Reflect.deleteProperty(html, "dir");
  }
});

afterAll(() => {
  localStorageGetItem.mockRestore();
  localStorageSetItem.mockRestore();
});

describe("useLanguagePreference", () => {
  it("normalizes the initial i18next locale into the supported registry", () => {
    mockI18n.language = "unknown-locale";
    mockI18n.resolvedLanguage = "unknown-locale";

    const { result } = renderPreference();

    expect(result.current.language).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
    expect(mockNormalizeLanguage).toHaveBeenCalledWith(
      "unknown-locale",
      expect.any(Function),
    );
  });

  it("exposes the provider contract and commits an explicit change in the required order", async () => {
    const changeGate = deferred<void>();
    mockChangeLanguage.mockImplementation(async (language: string) => {
      mockEvents.push(`change:start:${language}`);
      await changeGate.promise;
      mockI18n.language = language;
      mockI18n.resolvedLanguage = language;
      mockEvents.push(`change:end:${language}`);
    });

    const { queryClient, result } = renderPreference();
    jest
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(async (filters) => {
        mockEvents.push(
          `invalidate:${JSON.stringify(filters?.queryKey ?? null)}`,
        );
      });

    expect(Object.keys(result.current).sort()).toEqual([
      "changeLanguage",
      "language",
    ]);
    expect(result.current.language).toBe("ru");

    let transition!: Promise<void>;
    act(() => {
      transition = result.current.changeLanguage("EN-us");
    });

    await waitFor(() =>
      expect(mockEvents).toEqual([
        "normalize:ru",
        "normalize:EN-us",
        "load:en",
        "change:start:en",
      ]),
    );

    await act(async () => {
      changeGate.resolve();
      await transition;
    });

    expect(mockEvents).toEqual([
      "normalize:ru",
      "normalize:EN-us",
      "load:en",
      "change:start:en",
      "change:end:en",
      "html.lang:en",
      "html.dir:ltr",
      `storage:${LANGUAGE_STORAGE_KEY}=en`,
      "resetTypes",
      'invalidate:["useGetTypes"]',
    ]);
    expect(result.current.language).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(mockResetTypes).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["useGetTypes"],
    });
  });

  it("normalizes a same-language request and then performs no work", async () => {
    const { queryClient, result } = renderPreference();
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.changeLanguage("RU-ru");
    });

    expect(mockEvents).toEqual(["normalize:ru", "normalize:RU-ru"]);
    expect(mockLoadLanguage).not.toHaveBeenCalled();
    expect(mockChangeLanguage).not.toHaveBeenCalled();
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(mockResetTypes).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("applies a same-origin storage transition without writing back to storage", async () => {
    const { queryClient, result } = renderPreference();
    const invalidate = jest
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue();

    act(() => dispatchStorage(LANGUAGE_STORAGE_KEY, "en-US"));

    await waitFor(() => expect(result.current.language).toBe("en"));

    expect(mockLoadLanguage).toHaveBeenCalledWith("en");
    expect(mockChangeLanguage).toHaveBeenCalledWith("en");
    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(mockResetTypes).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("ignores foreign, deleted, and duplicate storage values", async () => {
    const { queryClient } = renderPreference();
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");

    act(() => {
      dispatchStorage("another-key", "fr");
      dispatchStorage(LANGUAGE_STORAGE_KEY, null);
      dispatchStorage(LANGUAGE_STORAGE_KEY, "ru-RU");
    });
    await act(async () => Promise.resolve());

    expect(mockLoadLanguage).not.toHaveBeenCalled();
    expect(mockChangeLanguage).not.toHaveBeenCalled();
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(mockResetTypes).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each(["fr", "ja-JP", "zh-CN"])(
    "keeps Russian when the current preference key receives legacy locale '%s'",
    async (legacyLocale) => {
      const { result } = renderPreference();

      act(() => dispatchStorage(LANGUAGE_STORAGE_KEY, legacyLocale));
      await act(async () => Promise.resolve());

      expect(result.current.language).toBe("ru");
      expect(document.documentElement.lang).toBe("ru");
      expect(mockLoadLanguage).not.toHaveBeenCalled();
      expect(mockChangeLanguage).not.toHaveBeenCalled();
    },
  );

  it("keeps exactly one active storage listener in StrictMode and cleans it up", async () => {
    const activeStorageListeners =
      new Set<EventListenerOrEventListenerObject>();
    const realAddEventListener = window.addEventListener.bind(window);
    const realRemoveEventListener = window.removeEventListener.bind(window);
    const addSpy = jest
      .spyOn(window, "addEventListener")
      .mockImplementation((type, listener, options) => {
        if (type === "storage") activeStorageListeners.add(listener);
        realAddEventListener(type, listener, options);
      });
    const removeSpy = jest
      .spyOn(window, "removeEventListener")
      .mockImplementation((type, listener, options) => {
        if (type === "storage") activeStorageListeners.delete(listener);
        realRemoveEventListener(type, listener, options);
      });

    const { unmount } = renderPreference({ strict: true });

    await waitFor(() => expect(activeStorageListeners.size).toBe(1));
    expect(
      addSpy.mock.calls.filter(([type]) => type === "storage").length -
        removeSpy.mock.calls.filter(([type]) => type === "storage").length,
    ).toBe(1);

    unmount();

    expect(activeStorageListeners.size).toBe(0);
    expect(
      addSpy.mock.calls.filter(([type]) => type === "storage").length -
        removeSpy.mock.calls.filter(([type]) => type === "storage").length,
    ).toBe(0);
  });

  it("lets a rapid English to Russian selection commit only the latest transition", async () => {
    mockI18n.language = "qps-ploc";
    mockI18n.resolvedLanguage = "qps-ploc";
    const englishLoad = deferred<void>();
    mockLoadLanguage.mockImplementation(async (language: string) => {
      mockEvents.push(`load:${language}`);
      if (language === "en") await englishLoad.promise;
    });

    const { queryClient, result } = renderPreference();
    const invalidate = jest
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue();

    let englishTransition!: Promise<void>;
    act(() => {
      englishTransition = result.current.changeLanguage("en");
    });
    await waitFor(() => expect(mockLoadLanguage).toHaveBeenCalledWith("en"));

    await act(async () => {
      await result.current.changeLanguage("ru");
    });

    expect(result.current.language).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");

    await act(async () => {
      englishLoad.resolve();
      await englishTransition;
    });

    expect(result.current.language).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
    expect(mockChangeLanguage).toHaveBeenCalledTimes(1);
    expect(mockChangeLanguage).toHaveBeenCalledWith("ru");
    expect(window.localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      LANGUAGE_STORAGE_KEY,
      "ru",
    );
    expect(mockResetTypes).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("serializes the i18next commit phase so a late older change cannot win", async () => {
    mockI18n.language = "qps-ploc";
    mockI18n.resolvedLanguage = "qps-ploc";
    const englishChange = deferred<void>();
    mockChangeLanguage.mockImplementation(async (language: string) => {
      mockEvents.push(`change:start:${language}`);
      if (language === "en") await englishChange.promise;
      mockI18n.language = language;
      mockI18n.resolvedLanguage = language;
      mockEvents.push(`change:end:${language}`);
    });

    const { queryClient, result } = renderPreference();
    const invalidate = jest
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue();

    let englishTransition!: Promise<void>;
    act(() => {
      englishTransition = result.current.changeLanguage("en");
    });
    await waitFor(() => expect(mockEvents).toContain("change:start:en"));

    let russianTransition!: Promise<void>;
    act(() => {
      russianTransition = result.current.changeLanguage("ru");
    });
    await waitFor(() => expect(mockLoadLanguage).toHaveBeenCalledWith("ru"));
    expect(mockEvents).not.toContain("change:start:ru");

    await act(async () => {
      englishChange.resolve();
      await englishTransition;
      await russianTransition;
    });

    expect(mockI18n.language).toBe("ru");
    expect(result.current.language).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
    expect(window.localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      LANGUAGE_STORAGE_KEY,
      "ru",
    );
    expect(mockResetTypes).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("leaves state, DOM, types, storage, and query cache untouched when loading fails", async () => {
    const failure = new Error("locale bundle failed to load");
    mockLoadLanguage.mockImplementationOnce(async (language: string) => {
      mockEvents.push(`load:${language}`);
      throw failure;
    });

    const { queryClient, result } = renderPreference();
    const cachedTypes = { language: "ru", componentCount: 3 };
    queryClient.setQueryData(["useGetTypes"], cachedTypes);
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.changeLanguage("en");
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toBe(failure);
    expect(result.current.language).toBe("ru");
    expect(mockI18n.language).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
    expect(document.documentElement.dir).toBe("ltr");
    expect(mockChangeLanguage).not.toHaveBeenCalled();
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(mockResetTypes).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(["useGetTypes"])).toBe(cachedTypes);
    expect(queryClient.getQueryState(["useGetTypes"])?.isInvalidated).toBe(
      false,
    );
  });

  it("treats the authenticated profile as authoritative and refreshes both caches", async () => {
    mockUserData = { id: "user-1", preferred_locale: "ru-RU" };

    const { result } = renderPreference();

    await waitFor(() => expect(result.current.language).toBe("ru"));

    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      LANGUAGE_STORAGE_KEY,
      "ru",
    );
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      `${LANGUAGE_STORAGE_KEY}:user-1`,
      "ru",
    );
    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  it("does not overwrite a legacy profile locale while applying the Russian fallback", async () => {
    mockUserData = { id: "user-1", preferred_locale: "fr" };

    const { result } = renderPreference();

    await waitFor(() =>
      expect(mockNormalizeLanguage).toHaveBeenCalledWith(
        "fr",
        expect.any(Function),
      ),
    );

    expect(result.current.language).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(mockApiPatch).not.toHaveBeenCalled();
    expect(mockUserData?.preferred_locale).toBe("fr");
  });

  it("honors the test-only pseudo locale query without persisting it to the profile", async () => {
    window.history.replaceState({}, "", "/?locale=qps-ploc");
    mockUserData = { id: "user-1", preferred_locale: "en" };

    const { result } = renderPreference();

    await waitFor(() => expect(result.current.language).toBe("qps-ploc"));
    expect(mockLoadLanguage).toHaveBeenCalledWith("qps-ploc");
    expect(mockChangeLanguage).toHaveBeenCalledWith("qps-ploc");
    expect(mockApiPatch).not.toHaveBeenCalled();
    expect(localStorageSetItem).not.toHaveBeenCalledWith(
      `${LANGUAGE_STORAGE_KEY}:user-1`,
      "qps-ploc",
    );
  });

  it("persists an explicit authenticated choice locally before syncing the profile", async () => {
    mockUserData = { id: "user-1", preferred_locale: "ru" };
    const updatedUser = { id: "user-1", preferred_locale: "en" };
    mockApiPatch.mockImplementation(async () => {
      mockEvents.push("profile:patch");
      return { data: updatedUser };
    });
    const { result } = renderPreference();
    await waitFor(() =>
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        `${LANGUAGE_STORAGE_KEY}:user-1`,
        "ru",
      ),
    );
    mockEvents = [];
    localStorageSetItem.mockClear();

    await act(async () => result.current.changeLanguage("en-US"));

    expect(result.current.language).toBe("en");
    expect(localStorageSetItem).toHaveBeenNthCalledWith(
      1,
      LANGUAGE_STORAGE_KEY,
      "en",
    );
    expect(localStorageSetItem).toHaveBeenNthCalledWith(
      2,
      `${LANGUAGE_STORAGE_KEY}:user-1`,
      "en",
    );
    expect(mockEvents.indexOf("profile:patch")).toBeGreaterThan(
      mockEvents.indexOf(`storage:${LANGUAGE_STORAGE_KEY}:user-1=en`),
    );
    expect(mockApiPatch).toHaveBeenCalledWith("/api/v1/users/user-1", {
      preferred_locale: "en",
    });
    expect(mockSetUserData).toHaveBeenCalledWith(updatedUser);
  });

  it("serializes authenticated ru to en to ru profile writes and publishes only the latest response", async () => {
    mockUserData = { id: "user-1", preferred_locale: "en" };
    const firstRussianPatch = deferred<void>();
    const englishPatch = deferred<void>();
    const finalRussianPatch = deferred<void>();
    const patchGates = [firstRussianPatch, englishPatch, finalRussianPatch];
    let persistedLocale = "en";

    mockApiPatch.mockImplementation(
      async (_url: string, payload: { preferred_locale: string }) => {
        const gate = patchGates[mockApiPatch.mock.calls.length - 1];
        await gate.promise;
        persistedLocale = payload.preferred_locale;
        return {
          data: { id: "user-1", preferred_locale: payload.preferred_locale },
        };
      },
    );

    const { result } = renderPreference();
    await waitFor(() =>
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        `${LANGUAGE_STORAGE_KEY}:user-1`,
        "en",
      ),
    );
    mockSetUserData.mockClear();

    const transitions: Promise<void>[] = [];
    act(() => {
      transitions.push(result.current.changeLanguage("ru"));
    });
    await waitFor(() => expect(result.current.language).toBe("ru"));

    act(() => {
      transitions.push(result.current.changeLanguage("en"));
    });
    await waitFor(() => expect(result.current.language).toBe("en"));

    act(() => {
      transitions.push(result.current.changeLanguage("ru"));
    });
    await waitFor(() => expect(result.current.language).toBe("ru"));

    // A second request must not reach the server while the first response can
    // still be reordered. Serial transport makes server persistence follow the
    // user's selection order even when individual responses are arbitrarily slow.
    expect(mockApiPatch).toHaveBeenCalledTimes(1);

    await act(async () => firstRussianPatch.resolve());
    await waitFor(() => expect(mockApiPatch).toHaveBeenCalledTimes(2));
    expect(mockSetUserData).not.toHaveBeenCalled();

    await act(async () => englishPatch.resolve());
    await waitFor(() => expect(mockApiPatch).toHaveBeenCalledTimes(3));
    expect(mockSetUserData).not.toHaveBeenCalled();

    await act(async () => {
      finalRussianPatch.resolve();
      await Promise.all(transitions);
    });

    expect(persistedLocale).toBe("ru");
    expect(mockSetUserData).toHaveBeenCalledTimes(1);
    expect(mockSetUserData).toHaveBeenCalledWith({
      id: "user-1",
      preferred_locale: "ru",
    });
  });

  it("keeps the local authenticated choice when profile synchronization fails", async () => {
    mockUserData = { id: "user-1", preferred_locale: "ru" };
    const profileFailure = new Error("profile locale save failed");
    mockApiPatch.mockRejectedValue(profileFailure);
    const { result } = renderPreference();
    await waitFor(() =>
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        `${LANGUAGE_STORAGE_KEY}:user-1`,
        "ru",
      ),
    );

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.changeLanguage("en");
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toBe(profileFailure);
    expect(result.current.language).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      LANGUAGE_STORAGE_KEY,
      "en",
    );
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      `${LANGUAGE_STORAGE_KEY}:user-1`,
      "en",
    );
    expect(mockResetTypes).toHaveBeenCalledTimes(1);
  });

  it("isolates cross-tab events by authenticated user", async () => {
    mockUserData = { id: "user-2", preferred_locale: "ru" };
    const { result } = renderPreference();
    await waitFor(() =>
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        `${LANGUAGE_STORAGE_KEY}:user-2`,
        "ru",
      ),
    );
    mockChangeLanguage.mockClear();

    act(() => {
      dispatchStorage(LANGUAGE_STORAGE_KEY, "ru");
      dispatchStorage(`${LANGUAGE_STORAGE_KEY}:user-1`, "ja");
    });
    await act(async () => Promise.resolve());

    expect(result.current.language).toBe("ru");
    expect(mockChangeLanguage).not.toHaveBeenCalled();

    act(() => dispatchStorage(`${LANGUAGE_STORAGE_KEY}:user-2`, "en"));
    await waitFor(() => expect(result.current.language).toBe("en"));
    expect(mockChangeLanguage).toHaveBeenCalledWith("en");
  });
});
