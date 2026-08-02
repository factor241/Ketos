/**
 * Tests for the loadLanguage lazy-loader in i18n.ts.
 *
 * jest.setup.js mocks react-i18next globally, but this file imports the real
 * i18n instance directly — so those tests are unaffected by the global mock.
 */

// Import the real i18n instance and loadLanguage (not the mock from jest.setup.js)
jest.unmock("react-i18next");

import { LANGUAGE_STORAGE_KEY } from "./constants/languages";
import i18n, { i18nDiagnostics, loadLanguage } from "./i18n";
import en from "./locales/en.json";
import ru from "./locales/ru.json";

describe("stored language detection", () => {
  afterEach(() => {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  });

  it.each(["fr", "ja-JP", "zh-CN"])(
    "normalizes the legacy stored locale '%s' to effective Russian",
    async (legacyLocale) => {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, legacyLocale);
      let isolatedModule!: typeof import("./i18n");

      await jest.isolateModulesAsync(async () => {
        isolatedModule = await import("./i18n");
      });

      expect(isolatedModule.detectedLang).toBe("ru");
      expect(isolatedModule.default.language).toBe("ru");
      expect(isolatedModule.default.resolvedLanguage).toBe("ru");
    },
  );
});

describe("loadLanguage", () => {
  beforeEach(() => {
    // Clear cached non-shipped bundles between tests.
    ["qa", "qps-ploc", "qps-Ploc"].forEach((lang) => {
      if (i18n.hasResourceBundle(lang, "translation")) {
        i18n.removeResourceBundle(lang, "translation");
      }
    });
  });

  it.each(["en", "ru"])(
    "does not add the statically loaded '%s' bundle again",
    async (language) => {
      const spy = jest.spyOn(i18n, "addResourceBundle");

      await loadLanguage(language);

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    },
  );

  it("statically bundles both shipped languages", () => {
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("ru", "translation")).toBe(true);
  });

  it.each(["fr", "ja-JP", "zh-CN"])(
    "falls the legacy locale '%s' back to the Russian bundle",
    async (legacyLocale) => {
      await loadLanguage(legacyLocale);

      expect(i18n.hasResourceBundle(legacyLocale, "translation")).toBe(false);
      expect(i18n.hasResourceBundle("ru", "translation")).toBe(true);
    },
  );

  it("initializes the effective language and document metadata as Russian", () => {
    expect(i18n.language).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
    expect(document.documentElement.dir).toBe("ltr");
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
      await i18n.changeLanguage("ru");
    }
  });

  it("updates the document language and direction after a language change", async () => {
    const originalLang = document.documentElement.lang;
    const originalDir = document.documentElement.dir;

    try {
      await i18n.changeLanguage("en");

      expect(document.documentElement.lang).toBe("en");
      expect(document.documentElement.dir).toBe("ltr");
    } finally {
      await i18n.changeLanguage("ru");
      document.documentElement.lang = originalLang;
      document.documentElement.dir = originalDir;
    }
  });

  it("records a real English fallback for E2E diagnostics", async () => {
    i18nDiagnostics.reset();
    i18n.addResourceBundle("qa", "translation", { "qa.present": "Present" });
    await i18n.changeLanguage("qa");

    const rendered = i18n.t("accordion.addVariable");

    expect(rendered).toBe(en["accordion.addVariable"]);
    expect(i18nDiagnostics.snapshot().fallback).toEqual([
      { locale: "qa", key: "accordion.addVariable" },
    ]);
    await i18n.changeLanguage("ru");
    i18n.removeResourceBundle("qa", "translation");
  });

  it.each([1, 2])(
    "records the actual English plural fallback for count %i",
    async (count) => {
      i18nDiagnostics.reset();
      i18n.removeResourceBundle("ru", "translation");
      i18n.addResourceBundle("ru", "translation", {
        "chat.sessionsDeletedSuccess_other": "Удалены сессии",
      });
      await i18n.changeLanguage("ru");

      try {
        const rendered = i18n.t("chat.sessionsDeletedSuccess", { count });
        const catalogKey =
          count === 1
            ? "chat.sessionsDeletedSuccess_one"
            : "chat.sessionsDeletedSuccess_other";

        expect(rendered).toBe(
          en[catalogKey].replace("{{count}}", String(count)),
        );
        expect(i18nDiagnostics.snapshot().fallback).toEqual([
          { locale: "ru", key: "chat.sessionsDeletedSuccess" },
        ]);
      } finally {
        i18n.removeResourceBundle("ru", "translation");
        i18n.addResourceBundle("ru", "translation", ru);
        await i18n.changeLanguage("ru");
      }
    },
  );
});
