import {
  createI18nDiagnostics,
  isStrictRuTestMode,
  shouldRecordFallback,
} from "../i18n-diagnostics";

describe("strict RU i18n diagnostics", () => {
  it("can only be enabled in an explicit test build", () => {
    expect(
      isStrictRuTestMode({ MODE: "test", VITE_STRICT_RU_I18N: "true" }),
    ).toBe(true);
    expect(
      isStrictRuTestMode({ MODE: "production", VITE_STRICT_RU_I18N: "true" }),
    ).toBe(false);
    expect(isStrictRuTestMode({ MODE: "test" })).toBe(false);
  });

  it("deduplicates missing, failed-loading and fallback diagnostics", () => {
    const diagnostics = createI18nDiagnostics(true);

    diagnostics.record("missing", "ru", "flow.save");
    diagnostics.record("missing", "ru", "flow.save");
    diagnostics.record("failed_loading", "ru", "translation");
    diagnostics.record("fallback", "ru", "flow.save");

    expect(diagnostics.snapshot()).toEqual({
      strict: true,
      missing: [{ locale: "ru", key: "flow.save" }],
      failedLoading: [{ locale: "ru", key: "translation" }],
      fallback: [{ locale: "ru", key: "flow.save" }],
    });
  });

  it("can reset between E2E scenarios", () => {
    const diagnostics = createI18nDiagnostics(true);
    diagnostics.record("missing", "ru", "a");
    diagnostics.reset();

    expect(diagnostics.snapshot().missing).toEqual([]);
  });

  it("classifies only a real English catalog fallback", () => {
    const source = { "flow.save": "Save" };

    expect(
      shouldRecordFallback({
        strict: false,
        locale: "ru-RU",
        key: "flow.save",
        sourceCatalog: source,
        targetCatalog: {},
      }),
    ).toBe(true);
    expect(
      shouldRecordFallback({
        strict: true,
        locale: "ru",
        key: "flow.save",
        sourceCatalog: source,
        targetCatalog: {},
      }),
    ).toBe(false);
    expect(
      shouldRecordFallback({
        strict: false,
        locale: "ru",
        key: "user.flowName",
        sourceCatalog: source,
        targetCatalog: {},
      }),
    ).toBe(false);
  });

  it("classifies the base key emitted by i18next for a plural fallback", () => {
    expect(
      shouldRecordFallback({
        strict: false,
        locale: "ru",
        key: "chat.sessionsDeletedSuccess",
        sourceCatalog: {
          "chat.sessionsDeletedSuccess_one": "Deleted one session",
          "chat.sessionsDeletedSuccess_other": "Deleted {{count}} sessions",
        },
        targetCatalog: {},
      }),
    ).toBe(true);
  });

  it("classifies fallback caused by an empty target value", () => {
    expect(
      shouldRecordFallback({
        strict: false,
        locale: "ru",
        key: "flow.save",
        sourceCatalog: { "flow.save": "Save" },
        targetCatalog: { "flow.save": "" },
      }),
    ).toBe(true);
  });
});
