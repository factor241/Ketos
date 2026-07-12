import { Cookies } from "react-cookie";

// Mock all complex dependencies to avoid import issues
jest.mock("@/stores/authStore", () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
}));

jest.mock("@/stores/darkStore", () => ({
  useDarkStore: {
    getState: () => ({}),
    setState: jest.fn(),
    subscribe: jest.fn(),
    destroy: jest.fn(),
  },
}));

jest.mock("@/stores/alertStore", () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
}));

jest.mock("@/utils/styleUtils", () => ({}));

jest.mock(
  "@/components/core/parameterRenderComponent/components/tableComponent/components/tableAutoCellRender",
  () => () => null,
);

jest.mock(
  "@/components/core/parameterRenderComponent/components/tableComponent/components/tableDropdownCellEditor",
  () => () => null,
);

// Jest can't find this module to mock it, let's skip this mock

// Jest can't find this module either

// Mock react-cookie
jest.mock("react-cookie");

import { setAuthCookie } from "@/utils/utils";

describe("setAuthCookie", () => {
  let mockCookies: jest.Mocked<Cookies>;

  beforeEach(() => {
    mockCookies = {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
    } as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should set a cookie with correct options", () => {
    const tokenName = "ketos_access_token";
    const tokenValue = "test-access-token";

    setAuthCookie(mockCookies, tokenName, tokenValue);

    // Test environment uses HTTP, so expect non-secure cookies
    expect(mockCookies.set).toHaveBeenCalledWith(tokenName, tokenValue, {
      path: "/",
      secure: false,
      sameSite: "lax",
    });
  });

  it("should handle different token types", () => {
    const testCases = [
      { tokenName: "ketos_access_token", value: "access-123" },
      { tokenName: "ketos_refresh_token", value: "refresh-456" },
      { tokenName: "ketos_api_token", value: "api-789" },
    ];

    testCases.forEach(({ tokenName, value }) => {
      setAuthCookie(mockCookies, tokenName, value);

      // Test environment uses HTTP, so expect non-secure cookies
      expect(mockCookies.set).toHaveBeenCalledWith(tokenName, value, {
        path: "/",
        secure: false,
        sameSite: "lax",
      });
    });
  });

  it("should handle empty string values", () => {
    const tokenName = "test_token";
    const tokenValue = "";

    setAuthCookie(mockCookies, tokenName, tokenValue);

    // Test environment uses HTTP, so expect non-secure cookies
    expect(mockCookies.set).toHaveBeenCalledWith(tokenName, tokenValue, {
      path: "/",
      secure: false,
      sameSite: "lax",
    });
  });

  it("should use correct cookie options for security", () => {
    setAuthCookie(mockCookies, "test_token", "test_value");

    const cookieOptions = mockCookies.set.mock.calls[0][2];

    // Test environment uses HTTP, so expect non-secure cookies
    expect(cookieOptions).toEqual({
      path: "/",
      secure: false,
      sameSite: "lax",
    });

    // Ensure httpOnly is NOT set (removed from utils.ts)
    expect(cookieOptions).not.toHaveProperty("httpOnly");
  });

  it("should handle special characters in token values", () => {
    const tokenName = "test_token";
    const tokenValue = "token-with-special-chars_@#$%";

    setAuthCookie(mockCookies, tokenName, tokenValue);

    // Test environment uses HTTP, so expect non-secure cookies
    expect(mockCookies.set).toHaveBeenCalledWith(tokenName, tokenValue, {
      path: "/",
      secure: false,
      sameSite: "lax",
    });
  });
});
