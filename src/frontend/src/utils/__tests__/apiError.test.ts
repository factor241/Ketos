import {
  extractApiErrorDiagnosticMessages,
  extractApiErrorMessages,
} from "../apiError";

describe("extractApiErrorMessages", () => {
  it("resolves a stable code before legacy detail when a translator is provided", () => {
    const translate = jest.fn((key: string) => `translated:${key}`);
    const error = {
      response: {
        data: {
          code: "files.storage_error",
          detail: "raw storage exception",
        },
      },
    };

    expect(extractApiErrorMessages(error, translate)).toEqual([
      "translated:apiErrors.files.storageError",
    ]);
    expect(extractApiErrorMessages(error, translate)[0]).not.toContain(
      "raw storage exception",
    );
  });

  it("uses a localized generic fallback for a legacy response", () => {
    const translate = jest.fn((key: string) => `translated:${key}`);

    expect(
      extractApiErrorMessages(
        {
          response: {
            status: 418,
            data: { detail: "raw legacy backend detail" },
          },
        },
        translate,
      ),
    ).toEqual(["translated:errors.requestFailed"]);
  });

  it("uses the active app locale even when a caller omits a translator", () => {
    expect(
      extractApiErrorMessages({
        response: { data: { code: "files.storage_error" } },
      }),
    ).toEqual(["The file could not be saved. Try again."]);
  });

  it("returns a localized safe fallback for non-object errors", () => {
    expect(extractApiErrorMessages(null)).toEqual([
      "The request could not be completed. Please try again.",
    ]);
    expect(extractApiErrorMessages(undefined)).toEqual([
      "The request could not be completed. Please try again.",
    ]);
    expect(extractApiErrorMessages("boom")).toEqual([
      "The request could not be completed. Please try again.",
    ]);
    expect(extractApiErrorMessages(123)).toEqual([
      "The request could not be completed. Please try again.",
    ]);
  });

  it("does not expose response.data.detail from the safe UI helper", () => {
    const error = {
      response: { data: { detail: "Server not found" } },
      message: "Network Error",
    };

    expect(extractApiErrorMessages(error)).toEqual([
      "The request could not be completed. Please try again.",
    ]);
  });

  it("extracts msg fields only through the explicit diagnostic helper", () => {
    const error = {
      response: {
        data: {
          detail: [{ msg: "Field 'name' is required" }, { msg: "Bad input" }],
        },
      },
    };

    expect(extractApiErrorDiagnosticMessages(error)).toEqual([
      "Field 'name' is required",
      "Bad input",
    ]);
  });

  it("supports arrays mixing strings and objects", () => {
    const error = {
      response: {
        data: {
          detail: ["First", { msg: "Second" }],
        },
      },
    };

    expect(extractApiErrorDiagnosticMessages(error)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("JSON-stringifies array objects without a msg field", () => {
    const error = {
      response: {
        data: {
          detail: [{ code: 500, info: "crash" }],
        },
      },
    };

    expect(extractApiErrorDiagnosticMessages(error)).toEqual([
      '{"code":500,"info":"crash"}',
    ]);
  });

  it("falls back to error.message when array detail has no usable messages", () => {
    const error = {
      response: {
        data: {
          detail: ["", { msg: "" }],
        },
      },
      message: "Request failed",
    };

    expect(extractApiErrorDiagnosticMessages(error)).toEqual([
      "Request failed",
    ]);
  });

  it("falls back to error.message when detail is an empty array", () => {
    const error = {
      response: {
        data: {
          detail: [],
        },
      },
      message: "Request failed",
    };

    expect(extractApiErrorDiagnosticMessages(error)).toEqual([
      "Request failed",
    ]);
  });

  it("falls back to error.message when no detail is present", () => {
    expect(
      extractApiErrorDiagnosticMessages({ message: "Network Error" }),
    ).toEqual(["Network Error"]);
  });

  it("always returns at least one message", () => {
    const msgs = extractApiErrorMessages({});
    expect(Array.isArray(msgs)).toBe(true);
    expect(msgs.length).toBeGreaterThan(0);
  });
});
