import { getLocalizedApiErrorMessage } from "../localized-api-error";

const translate = (key: string) => `translated:${key}`;

describe("getLocalizedApiErrorMessage", () => {
  it.each([
    [401, "errors.unauthorized"],
    [403, "errors.forbidden"],
    [409, "errors.conflict"],
    [422, "errors.validation"],
    [429, "errors.rateLimited"],
    [503, "errors.serverUnavailable"],
  ])("maps HTTP %i to a semantic translation key", (status, key) => {
    expect(
      getLocalizedApiErrorMessage(
        { response: { status, data: { detail: "raw backend detail" } } },
        translate,
        { fallbackKey: "errors.requestFailed" },
      ),
    ).toBe(`translated:${key}`);
  });

  it("supports a context-specific status mapping", () => {
    expect(
      getLocalizedApiErrorMessage(
        { response: { status: 401, data: { detail: "invalid credentials" } } },
        translate,
        {
          fallbackKey: "errors.requestFailed",
          statusKeys: { 401: "auth.invalidCredentials" },
        },
      ),
    ).toBe("translated:auth.invalidCredentials");
  });

  it("never exposes raw backend detail or exception messages", () => {
    const rawDetail = "sensitive internal database detail";
    const result = getLocalizedApiErrorMessage(
      {
        message: "stack trace fragment",
        response: { status: 418, data: { detail: rawDetail } },
      },
      translate,
      { fallbackKey: "errors.requestFailed" },
    );

    expect(result).toBe("translated:errors.requestFailed");
    expect(result).not.toContain(rawDetail);
    expect(result).not.toContain("stack trace");
  });
});
