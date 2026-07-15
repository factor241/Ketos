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
    expect(registry.DEFAULT_LANGUAGE).toBe("ru");

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

  it("ships exactly English and Russian as visible interface languages", () => {
    const visibleCodes = registry.SUPPORTED_LANGUAGES.filter(
      ({ hidden, shipped }) => shipped && !hidden,
    ).map(({ code }) => code);

    expect(visibleCodes).toEqual(["en", "ru"]);
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

  it("keeps English and Russian when the pseudo locale is disabled", () => {
    expect(registry.createSupportedLanguages).toEqual(expect.any(Function));
    if (!registry.createSupportedLanguages) return;

    const languages = registry.createSupportedLanguages({
      pseudoEnabled: false,
    });

    expect(languages.map(({ code }) => code)).toEqual(["en", "ru"]);
  });

  it.each([
    [undefined, "ru"],
    [null, "ru"],
    ["", "ru"],
    ["EN-us", "en"],
    ["ru", "ru"],
    ["ru-RU", "ru"],
    ["RU-ru", "ru"],
    ["rU-RU", "ru"],
    ["fr", "ru"],
    ["ja-JP", "ru"],
    ["zh-CN", "ru"],
    ["xx-ZZ", "ru"],
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

  it("does not expose a Russian rollback switch", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../constants/languages.ts"),
      "utf8",
    );

    const removedFlag = ["VITE", "ENABLE", "RUSSIAN", "LOCALE"].join("_");
    expect(source).not.toContain(removedFlag);
    expect(source).not.toContain("russianEnabled");
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

  it.each(["en", "ru"])(
    "returns early without throwing for statically loaded '%s'",
    async (language) => {
      await expect(loadLanguage(language)).resolves.toBeUndefined();
    },
  );
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
