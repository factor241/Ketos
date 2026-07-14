import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupportedLanguageCode } from "../constants/languages";
import * as languageRegistry from "../constants/languages";
import i18n, { loadLanguage } from "../i18n";

const shippedLanguageCode: SupportedLanguageCode = "ru";
// @ts-expect-error Unsupported values must not widen SupportedLanguageCode to string.
const unsupportedLanguageCode: SupportedLanguageCode = "not-a-language";
void unsupportedLanguageCode;

type RegistryEntry = {
  code: string;
  label: string;
  locale: string;
  dir: "ltr" | "rtl";
  loader: () => Promise<unknown>;
  shipped: boolean;
  hidden: boolean;
};

type LanguageRegistry = {
  createSupportedLanguages?: (options: {
    russianEnabled: boolean;
    pseudoEnabled: boolean;
  }) => readonly Partial<RegistryEntry>[];
  DEFAULT_LANGUAGE?: string;
  isLanguageSupportedAgainst?: (
    languages: readonly Partial<RegistryEntry>[],
    language?: string | null,
  ) => boolean;
  normalizeLanguageAgainst?: (
    languages: readonly Partial<RegistryEntry>[],
    language?: string | null,
  ) => string;
  RUSSIAN_LOCALE_ENABLED?: boolean;
  SUPPORTED_LANGUAGES: readonly Partial<RegistryEntry>[];
  SUPPORTED_LANGUAGE_CODES?: readonly string[];
  normalizeLanguage?: (language?: string | null) => string;
};

const registry = languageRegistry as unknown as LanguageRegistry;

describe("language registry", () => {
  it("keeps the supported-language code type closed over known locales", () => {
    expect(shippedLanguageCode).toBe("ru");
  });

  it("is the single source for the default, supported codes, and metadata", () => {
    expect(registry.DEFAULT_LANGUAGE).toBe("en");

    const registryCodes = registry.SUPPORTED_LANGUAGES.map(
      (language) => language.code,
    );
    expect(registry.SUPPORTED_LANGUAGE_CODES).toEqual(registryCodes);
    expect(new Set(registryCodes).size).toBe(registryCodes.length);

    expect(registry.SUPPORTED_LANGUAGES).not.toContainEqual(
      expect.objectContaining({ code: "en-XA" }),
    );
    expect(registry.SUPPORTED_LANGUAGES).toContainEqual(
      expect.objectContaining({
        code: "qps-ploc",
        shipped: false,
        hidden: true,
      }),
    );
    registry.SUPPORTED_LANGUAGES.forEach((language) => {
      expect(language).toEqual(
        expect.objectContaining({
          code: expect.any(String),
          label: expect.any(String),
          locale: expect.any(String),
          dir: expect.stringMatching(/^(ltr|rtl)$/),
          loader: expect.any(Function),
          shipped: expect.any(Boolean),
          hidden: expect.any(Boolean),
        }),
      );
    });
  });

  it("ships Russian with its canonical metadata", () => {
    expect(registry.SUPPORTED_LANGUAGES).toContainEqual(
      expect.objectContaining({
        code: "ru",
        label: "Русский",
        locale: "ru-RU",
        dir: "ltr",
        loader: expect.any(Function),
        shipped: true,
        hidden: false,
      }),
    );
  });

  it("can remove Russian from the active registry without removing English", () => {
    expect(registry.createSupportedLanguages).toEqual(expect.any(Function));
    if (!registry.createSupportedLanguages) return;

    const languages = registry.createSupportedLanguages({
      russianEnabled: false,
      pseudoEnabled: false,
    });

    expect(languages.map(({ code }) => code)).toContain("en");
    expect(languages.map(({ code }) => code)).not.toContain("ru");
    expect(languages.map(({ code }) => code)).not.toContain("qps-ploc");
  });

  it("falls a disabled Russian preference back to English", () => {
    expect(registry.createSupportedLanguages).toEqual(expect.any(Function));
    expect(registry.normalizeLanguageAgainst).toEqual(expect.any(Function));
    if (
      !registry.createSupportedLanguages ||
      !registry.normalizeLanguageAgainst
    ) {
      return;
    }

    const languages = registry.createSupportedLanguages({
      russianEnabled: false,
      pseudoEnabled: false,
    });

    expect(registry.normalizeLanguageAgainst(languages, "ru-RU")).toBe("en");
  });

  it("distinguishes a disabled preference from an enabled alias", () => {
    expect(registry.createSupportedLanguages).toEqual(expect.any(Function));
    expect(registry.isLanguageSupportedAgainst).toEqual(expect.any(Function));
    if (
      !registry.createSupportedLanguages ||
      !registry.isLanguageSupportedAgainst
    ) {
      return;
    }

    const languages = registry.createSupportedLanguages({
      russianEnabled: false,
      pseudoEnabled: false,
    });

    expect(registry.isLanguageSupportedAgainst(languages, "ru-RU")).toBe(false);
    expect(registry.isLanguageSupportedAgainst(languages, "EN-us")).toBe(true);
  });

  it("keeps Russian available when the rollback flag is enabled", () => {
    expect(registry.createSupportedLanguages).toEqual(expect.any(Function));
    if (!registry.createSupportedLanguages) return;

    const languages = registry.createSupportedLanguages({
      russianEnabled: true,
      pseudoEnabled: false,
    });

    expect(languages.map(({ code }) => code)).toContain("ru");
    expect(languages.map(({ code }) => code)).not.toContain("qps-ploc");
  });

  it("re-enables a preserved Russian preference after a flag rollback", () => {
    expect(registry.createSupportedLanguages).toEqual(expect.any(Function));
    expect(registry.normalizeLanguageAgainst).toEqual(expect.any(Function));
    if (
      !registry.createSupportedLanguages ||
      !registry.normalizeLanguageAgainst
    ) {
      return;
    }

    const persistedProfilePreference = "ru";
    const effectiveLanguages = [true, false, true].map((russianEnabled) => {
      const languages = registry.createSupportedLanguages!({
        russianEnabled,
        pseudoEnabled: false,
      });
      return registry.normalizeLanguageAgainst!(
        languages,
        persistedProfilePreference,
      );
    });

    expect(effectiveLanguages).toEqual(["ru", "en", "ru"]);
    expect(persistedProfilePreference).toBe("ru");
  });

  it.each([
    [undefined, "en"],
    [null, "en"],
    ["", "en"],
    ["EN-us", "en"],
    ["ru", "ru"],
    ["ru-RU", "ru"],
    ["RU-ru", "ru"],
    ["rU-RU", "ru"],
    ["fr-FR", "fr"],
    ["zh-Hans", "zh-Hans"],
    ["ZH-HANS", "zh-Hans"],
    ["zh-CN", "zh-Hans"],
    ["ZH-sg", "zh-Hans"],
    ["xx-ZZ", "en"],
  ])("normalizes %p to %s", (input, expected) => {
    expect(registry.normalizeLanguage).toEqual(expect.any(Function));
    if (!registry.normalizeLanguage) return;

    expect(registry.normalizeLanguage(input)).toBe(expected);
  });

  it("does not duplicate the supported-language registry in i18n.ts", () => {
    const source = readFileSync(path.resolve(__dirname, "../i18n.ts"), "utf8");

    expect(source).toMatch(/from ["']\.\/constants\/languages["']/);
    expect(source).not.toMatch(/const\s+SUPPORTED_LANGUAGES\s*=/);
  });

  it("excludes the hidden pseudo locale from production builds", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../constants/languages.ts"),
      "utf8",
    );

    expect(source).toMatch(/MODE\s*!==\s*["']production["']/);
  });

  it("defaults the Russian rollback switch to enabled", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../constants/languages.ts"),
      "utf8",
    );

    expect(source).toMatch(/VITE_ENABLE_RUSSIAN_LOCALE\s*!==\s*["']false["']/);
  });
});

describe("loadLanguage", () => {
  beforeEach(() => {
    // Remove any bundles added by previous tests so each test starts clean.
    jest.resetModules();
  });

  it("resolves without throwing for an unknown locale", async () => {
    await expect(loadLanguage("xx")).resolves.toBeUndefined();
  });

  it("does not register a bundle for an unknown locale", async () => {
    await loadLanguage("xx");
    expect(i18n.hasResourceBundle("xx", "translation")).toBe(false);
  });

  it("returns early without throwing for 'en'", async () => {
    await expect(loadLanguage("en")).resolves.toBeUndefined();
  });
});

describe("application bootstrap", () => {
  it("loads the detected bundle before the first React render", async () => {
    let resolveLoad!: () => void;
    const pendingLoad = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });
    const mockLoadLanguage = jest.fn(() => pendingLoad);
    const mockChangeLanguage = jest.fn().mockResolvedValue(undefined);
    const mockRender = jest.fn();
    const mockCreateRoot = jest.fn(() => ({ render: mockRender }));
    const mockReportWebVitals = jest.fn();
    const originalBody = document.body.innerHTML;

    try {
      document.body.innerHTML = '<div id="root"></div>';
      jest.resetModules();
      jest.doMock("../i18n", () => ({
        __esModule: true,
        default: { changeLanguage: mockChangeLanguage },
        detectedLang: "ru",
        loadLanguage: mockLoadLanguage,
      }));
      jest.doMock("react-dom/client", () => ({
        __esModule: true,
        default: { createRoot: mockCreateRoot },
        createRoot: mockCreateRoot,
      }));
      jest.doMock("../customization/custom-App", () => ({
        __esModule: true,
        default: () => null,
      }));
      jest.doMock("../reportWebVitals", () => ({
        __esModule: true,
        default: mockReportWebVitals,
      }));

      jest.isolateModules(() => {
        require("../index");
      });

      expect(mockLoadLanguage).toHaveBeenCalledTimes(1);
      expect(mockLoadLanguage).toHaveBeenCalledWith("ru");
      expect(mockCreateRoot).not.toHaveBeenCalled();
      expect(mockRender).not.toHaveBeenCalled();
      expect(mockChangeLanguage).not.toHaveBeenCalled();

      resolveLoad();
      await pendingLoad;
      await Promise.resolve();
      await Promise.resolve();

      expect(mockChangeLanguage).toHaveBeenCalledTimes(1);
      expect(mockChangeLanguage).toHaveBeenCalledWith("ru");
      expect(mockLoadLanguage.mock.invocationCallOrder[0]).toBeLessThan(
        mockChangeLanguage.mock.invocationCallOrder[0],
      );
      expect(mockChangeLanguage.mock.invocationCallOrder[0]).toBeLessThan(
        mockCreateRoot.mock.invocationCallOrder[0],
      );
      expect(mockCreateRoot).toHaveBeenCalledTimes(1);
      expect(mockRender).toHaveBeenCalledTimes(1);
      expect(mockReportWebVitals).toHaveBeenCalledTimes(1);
    } finally {
      document.body.innerHTML = originalBody;
      jest.dontMock("../i18n");
      jest.dontMock("react-dom/client");
      jest.dontMock("../customization/custom-App");
      jest.dontMock("../reportWebVitals");
      jest.resetModules();
    }
  });
});
