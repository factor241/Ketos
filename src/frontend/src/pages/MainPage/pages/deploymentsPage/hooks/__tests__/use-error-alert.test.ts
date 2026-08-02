import { act, renderHook } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetErrorData = jest.fn();

jest.mock("@/stores/alertStore", () => ({
  __esModule: true,
  default: (selector: (s: { setErrorData: jest.Mock }) => unknown) =>
    selector({ setErrorData: mockSetErrorData }),
}));

import { useErrorAlert } from "../use-error-alert";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useErrorAlert", () => {
  beforeEach(() => {
    mockSetErrorData.mockClear();
  });

  it("does not expose an exception message", () => {
    const { result } = renderHook(() => useErrorAlert());

    act(() => {
      result.current("Delete failed", new Error("network failure"));
    });

    expect(mockSetErrorData).toHaveBeenCalledWith({
      title: "Delete failed",
      list: ["The request could not be completed. Please try again."],
    });
  });

  it("uses the semantic request failure for non-Error values", () => {
    const { result } = renderHook(() => useErrorAlert());

    act(() => {
      result.current("Oops", "just a string");
    });

    expect(mockSetErrorData).toHaveBeenCalledWith({
      title: "Oops",
      list: ["The request could not be completed. Please try again."],
    });
  });

  it("localizes a stable deployment error code before the generic fallback", () => {
    const { result } = renderHook(() => useErrorAlert());

    act(() => {
      result.current("Update failed", {
        response: {
          status: 404,
          data: {
            code: "deployments.not_found",
            detail: "provider-internal text",
            params: { deployment_id: "dep-1" },
          },
        },
      });
    });

    expect(mockSetErrorData).toHaveBeenCalledWith({
      title: "Update failed",
      list: ["The deployment was not found."],
    });
  });

  it("uses fallback message for null errors", () => {
    const { result } = renderHook(() => useErrorAlert());

    act(() => {
      result.current("Error", null);
    });

    expect(mockSetErrorData).toHaveBeenCalledWith({
      title: "Error",
      list: ["The request could not be completed. Please try again."],
    });
  });

  it("uses fallback message for undefined errors", () => {
    const { result } = renderHook(() => useErrorAlert());

    act(() => {
      result.current("Error", undefined);
    });

    expect(mockSetErrorData).toHaveBeenCalledWith({
      title: "Error",
      list: ["The request could not be completed. Please try again."],
    });
  });

  it("returns a stable callback reference across re-renders", () => {
    const { result, rerender } = renderHook(() => useErrorAlert());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("supports different titles and errors in successive calls", () => {
    const { result } = renderHook(() => useErrorAlert());

    act(() => {
      result.current("First error", new Error("error one"));
    });
    act(() => {
      result.current("Second error", new Error("error two"));
    });

    expect(mockSetErrorData).toHaveBeenCalledTimes(2);
    expect(mockSetErrorData).toHaveBeenNthCalledWith(1, {
      title: "First error",
      list: ["The request could not be completed. Please try again."],
    });
    expect(mockSetErrorData).toHaveBeenNthCalledWith(2, {
      title: "Second error",
      list: ["The request could not be completed. Please try again."],
    });
  });
});
