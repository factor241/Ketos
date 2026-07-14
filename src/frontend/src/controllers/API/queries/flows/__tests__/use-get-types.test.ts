const mockApiGet = jest.fn();
const mockSetTypes = jest.fn();
const mockRecomputeComponentsToUpdateIfNeeded = jest.fn();
const mockI18n = { language: "ru" };
const mockQuery = jest.fn(
  (
    _key: readonly unknown[],
    fn: () => Promise<unknown>,
    _options: Record<string, unknown>,
  ) => {
    const result: {
      data: unknown;
      isLoading: boolean;
      error: unknown;
    } = {
      data: null,
      isLoading: false,
      error: null,
    };
    fn()
      .then((data: unknown) => {
        result.data = data;
      })
      .catch((error: unknown) => {
        result.error = error;
      });
    return result;
  },
);

const mockUseTypesStore = Object.assign(
  jest.fn((selector: (state: { setTypes: typeof mockSetTypes }) => unknown) =>
    selector({
      setTypes: mockSetTypes,
    }),
  ),
  {
    getState: () => ({
      types: {},
    }),
  },
);

jest.mock("@/controllers/API/api", () => ({
  api: {
    get: mockApiGet,
  },
}));

jest.mock("@/controllers/API/helpers/constants", () => ({
  getURL: jest.fn((key) => `/api/v1/${key.toLowerCase()}`),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: mockI18n,
    t: (key: string) => key,
  }),
}));

jest.mock("@/controllers/API/services/request-processor", () => ({
  UseRequestProcessor: jest.fn(() => ({
    query: mockQuery,
  })),
}));

jest.mock("@/stores/flowStore", () => ({
  __esModule: true,
  recomputeComponentsToUpdateIfNeeded: mockRecomputeComponentsToUpdateIfNeeded,
  syncNodeTranslations: jest.fn(),
}));

jest.mock("@/stores/flowsManagerStore", () => ({
  __esModule: true,
  default: (selector: (state: { setIsLoading: jest.Mock }) => unknown) =>
    selector({
      setIsLoading: jest.fn(),
    }),
}));

jest.mock("@/stores/typesStore", () => ({
  useTypesStore: mockUseTypesStore,
}));

import { useGetTypes } from "../use-get-types";

describe("useGetTypes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockI18n.language = "ru";
  });

  it("scopes the component-types query key to the active language", () => {
    mockApiGet.mockResolvedValue({ data: {} });

    useGetTypes();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toEqual(["useGetTypes", "ru"]);
  });

  it("recomputes componentsToUpdate after templates load", async () => {
    const responseData = {
      test_category: {
        TestComponent: {
          template: {},
        },
      },
    };
    mockApiGet.mockResolvedValue({ data: responseData });

    useGetTypes();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSetTypes).toHaveBeenCalledWith(responseData);
    expect(mockRecomputeComponentsToUpdateIfNeeded).toHaveBeenCalledTimes(1);
  });
});
