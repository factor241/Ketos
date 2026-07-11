/**
 * Tests for the loadLanguage lazy-loader in i18n.ts.
 *
 * jest.setup.js mocks react-i18next globally, but this file imports the real
 * i18n instance directly — so those tests are unaffected by the global mock.
 */

// Import the real i18n instance and loadLanguage (not the mock from jest.setup.js)
jest.unmock("react-i18next");

import i18n, { i18nDiagnostics, loadLanguage } from "./i18n";

describe("loadLanguage", () => {
  beforeEach(() => {
    // Clear cached non-English bundles between tests
    [
      "fr",
      "ja",
      "es",
      "de",
      "pt",
      "ru",
      "zh-Hans",
      "qps-ploc",
      "qps-Ploc",
    ].forEach((lang) => {
      if (i18n.hasResourceBundle(lang, "translation")) {
        i18n.removeResourceBundle(lang, "translation");
      }
    });
  });

  it("does not call addResourceBundle for 'en' (already statically loaded)", async () => {
    const spy = jest.spyOn(i18n, "addResourceBundle");
    await loadLanguage("en");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("always has 'en' bundle available (statically bundled)", () => {
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
  });

  it("loads and registers a new language bundle", async () => {
    expect(i18n.hasResourceBundle("fr", "translation")).toBe(false);
    await loadLanguage("fr");
    expect(i18n.hasResourceBundle("fr", "translation")).toBe(true);
  });

  it("does not call addResourceBundle if language is already cached", async () => {
    await loadLanguage("fr");
    const spy = jest.spyOn(i18n, "addResourceBundle");
    await loadLanguage("fr");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("loads multiple different languages independently", async () => {
    await loadLanguage("fr");
    await loadLanguage("ja");
    expect(i18n.hasResourceBundle("fr", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("ja", "translation")).toBe(true);
  });

  it("normalizes a mixed-case regional alias before loading Russian", async () => {
    i18nDiagnostics.reset();
    await loadLanguage("RU-ru");

    expect(i18n.hasResourceBundle("RU-ru", "translation")).toBe(false);
    expect(i18n.hasResourceBundle("ru", "translation")).toBe(true);
    expect(i18nDiagnostics.snapshot().failedLoading).toEqual([]);
  });

  it("loads the hidden pseudo locale under i18next's canonical code", async () => {
    await loadLanguage("qps-ploc");

    expect(i18n.hasResourceBundle("qps-Ploc", "translation")).toBe(true);
    expect(i18n.getResource("qps-Ploc", "translation", "crash.title")).toMatch(
      /^［.+］$/,
    );
  });

  it("renders pseudo strings after changing to the hidden query locale", async () => {
    await loadLanguage("qps-ploc");
    await i18n.changeLanguage("qps-ploc");

    try {
      expect(i18n.resolvedLanguage).toBe("qps-Ploc");
      expect(i18n.t("settings.languageTitle")).toMatch(/^［.+］$/);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("updates the document language and direction after a language change", async () => {
    const originalLang = document.documentElement.lang;
    const originalDir = document.documentElement.dir;

    try {
      await loadLanguage("fr");
      await i18n.changeLanguage("fr");

      expect(document.documentElement.lang).toBe("fr");
      expect(document.documentElement.dir).toBe("ltr");
    } finally {
      await i18n.changeLanguage("en");
      document.documentElement.lang = originalLang;
      document.documentElement.dir = originalDir;
    }
  });

  it("records a real English fallback for E2E diagnostics", async () => {
    i18nDiagnostics.reset();
    i18n.addResourceBundle("qa", "translation", { "qa.present": "Present" });
    await i18n.changeLanguage("qa");

    i18n.t("accordion.addVariable");

    expect(i18nDiagnostics.snapshot().fallback).toEqual([
      { locale: "qa", key: "accordion.addVariable" },
    ]);
    await i18n.changeLanguage("en");
    i18n.removeResourceBundle("qa", "translation");
  });

  it.each([1, 2])(
    "records the actual English plural fallback for count %i",
    async (count) => {
      i18nDiagnostics.reset();
      i18n.addResourceBundle("ru", "translation", {
        "chat.sessionsDeletedSuccess_other": "Удалены сессии",
      });
      await i18n.changeLanguage("ru");

      try {
        i18n.t("chat.sessionsDeletedSuccess", { count });

        expect(i18nDiagnostics.snapshot().fallback).toEqual([
          { locale: "ru", key: "chat.sessionsDeletedSuccess" },
        ]);
      } finally {
        await i18n.changeLanguage("en");
        i18n.removeResourceBundle("ru", "translation");
      }
    },
  );
});
