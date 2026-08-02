import i18next, { type PostProcessorModule } from "i18next";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_LANGUAGE,
  getLanguageDefinition,
  LANGUAGE_STORAGE_KEY,
  normalizeLanguage,
  syncDocumentLanguage,
} from "./constants/languages";
import {
  createI18nDiagnostics,
  isStrictRuTestMode,
  shouldRecordFallback,
} from "./i18n-diagnostics";
import en from "./locales/en.json";
import ru from "./locales/ru.json";

export const detectedLang = normalizeLanguage(
  typeof localStorage === "undefined"
    ? DEFAULT_LANGUAGE
    : localStorage.getItem(LANGUAGE_STORAGE_KEY),
);

const i18n = i18next.createInstance();
export const strictRuI18nTestMode = isStrictRuTestMode(import.meta.env);
export const i18nDiagnostics = createI18nDiagnostics(strictRuI18nTestMode);

if (typeof window !== "undefined") {
  window.__KETOS_I18N_DIAGNOSTICS__ = i18nDiagnostics;
}

const fallbackDiagnosticsProcessor: PostProcessorModule = {
  type: "postProcessor",
  name: "ketosFallbackDiagnostics",
  process(value, key, options) {
    const optionLocale = Array.isArray(options.lng)
      ? options.lng[0]
      : options.lng;
    const locale =
      i18n.resolvedLanguage || optionLocale || i18n.language || "unknown";
    const resolvedKey = Array.isArray(key) ? key[0] : key;
    const targetCatalog =
      (i18n.getResourceBundle(locale, "translation") as
        | Record<string, string>
        | undefined) ?? {};
    if (
      shouldRecordFallback({
        strict: strictRuI18nTestMode,
        locale,
        key: resolvedKey,
        count: typeof options.count === "number" ? options.count : undefined,
        sourceCatalog: en,
        targetCatalog,
      })
    ) {
      i18nDiagnostics.record("fallback", locale, resolvedKey);
    }
    return value;
  },
};

i18n
  .use(fallbackDiagnosticsProcessor)
  .use(initReactI18next)
  .init({
    showSupportNotice: false,
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: DEFAULT_LANGUAGE,
    // English intentionally remains the technical fallback for missing Russian keys.
    fallbackLng: strictRuI18nTestMode ? false : "en",
    saveMissing: strictRuI18nTestMode,
    missingKeyHandler: (languages, _namespace, key) => {
      const locale = Array.isArray(languages) ? languages[0] : languages;
      i18nDiagnostics.record(
        "missing",
        locale || i18n.resolvedLanguage || "unknown",
        key,
      );
    },
    postProcess: [fallbackDiagnosticsProcessor.name],
    returnNull: false,
    returnEmptyString: false,
    interpolation: {
      escapeValue: false,
    },
  });

i18n.on("languageChanged", syncDocumentLanguage);
syncDocumentLanguage(i18n.resolvedLanguage || i18n.language);

function canonicalI18nextLanguageCode(language: string): string {
  try {
    return Intl.getCanonicalLocales(language)[0] ?? language;
  } catch {
    return language;
  }
}

export async function loadLanguage(lang: string): Promise<void> {
  const definition = getLanguageDefinition(lang);
  const { code } = definition;
  const resourceLanguage = canonicalI18nextLanguageCode(code);
  if (i18n.hasResourceBundle(resourceLanguage, "translation")) return;
  try {
    const messages = await definition.loader();
    i18n.addResourceBundle(resourceLanguage, "translation", messages.default);
  } catch {
    i18nDiagnostics.record("failed_loading", code, "translation");
    // Unknown locale — no bundle file exists. i18next's fallbackLng: "en" takes over.
  }
}

export default i18n;
