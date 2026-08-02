import { renderTypedErrorList } from "../typed-error-formatting";

describe("renderTypedErrorList", () => {
  it("uses a semantic key for the diagnostics title", () => {
    const result = renderTypedErrorList(
      [
        {
          code: "reload_failed",
          message: "Module could not be imported",
          hint: "",
          location: null,
          content: null,
          ref_url: null,
        },
      ],
      (key) => `translated:${key}`,
    );

    expect(result).toEqual({
      title: "translated:extensions.reloadDiagnostics",
      list: ["[reload_failed] translated:apiErrors.extensions.reloadFailed"],
    });
  });

  it("uses a localized generic wrapper for unknown codes and hides raw diagnostics", () => {
    const result = renderTypedErrorList(
      [
        {
          code: "provider-secret-failure",
          message: "internal provider token abc123",
          hint: "inspect /private/provider/path",
          location: "/private/provider/path",
          content: "abc123",
          ref_url: null,
        },
      ],
      (key, params) =>
        `${key}:${typeof params?.code === "string" ? params.code : ""}`,
    );

    expect(result?.list).toEqual([
      "[provider-secret-failure] apiErrors.unknownCode:provider-secret-failure",
    ]);
    expect(JSON.stringify(result)).not.toContain("abc123");
    expect(JSON.stringify(result)).not.toContain("/private/provider/path");
  });
});
