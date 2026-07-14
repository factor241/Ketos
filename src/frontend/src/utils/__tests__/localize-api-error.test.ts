import {
  API_ERROR_KEY_BY_CODE,
  localizeApiErrorCode,
} from "../localize-api-error";

describe("localizeApiErrorCode", () => {
  const translate = jest.fn(
    (key: string, params?: Record<string, unknown>) =>
      `translated:${key}:${JSON.stringify(params ?? {})}`,
  );

  beforeEach(() => translate.mockClear());

  it("resolves a stable code before HTTP status or English detail", () => {
    const result = localizeApiErrorCode(
      {
        response: {
          status: 500,
          data: {
            code: "flows.not_found",
            detail: "sensitive English database detail",
            params: { flow_id: "flow-42" },
          },
        },
      },
      translate,
    );

    expect(result).toBe(
      'translated:apiErrors.flows.notFound:{"flow_id":"flow-42"}',
    );
    expect(translate).toHaveBeenCalledWith("apiErrors.flows.notFound", {
      flow_id: "flow-42",
    });
    expect(result).not.toContain("database detail");
  });

  it("uses a localized generic wrapper for an unknown code", () => {
    const result = localizeApiErrorCode(
      {
        response: {
          data: {
            code: "provider.secret_internal_failure",
            detail: "raw provider stack",
          },
        },
      },
      translate,
    );

    expect(result).toBe(
      'translated:apiErrors.unknownCode:{"code":"provider.secret_internal_failure"}',
    );
    expect(result).not.toContain("raw provider stack");
  });

  it("returns undefined for legacy responses without a stable code", () => {
    expect(
      localizeApiErrorCode(
        { response: { status: 404, data: { detail: "Not found" } } },
        translate,
      ),
    ).toBeUndefined();
    expect(translate).not.toHaveBeenCalled();
  });

  it("declares a frontend key for every first-wave backend code", () => {
    expect(Object.keys(API_ERROR_KEY_BY_CODE)).toHaveLength(31);
    expect(new Set(Object.values(API_ERROR_KEY_BY_CODE)).size).toBe(31);
  });

  it("drops nested and non-finite params before interpolation", () => {
    localizeApiErrorCode(
      {
        code: "files.too_large",
        params: {
          name: "report.pdf",
          max_size_mb: 10,
          infinity: Number.POSITIVE_INFINITY,
          nested: { secret: true },
        },
      },
      translate,
    );

    expect(translate).toHaveBeenCalledWith("apiErrors.files.tooLarge", {
      name: "report.pdf",
      max_size_mb: 10,
    });
  });
});
