export const LANGUAGE_STORAGE_KEY = "ketos-language-preference";

export const DEFAULT_LANGUAGE = "en" as const;

type TranslationCatalog = Record<string, string>;

export type LanguageDirection = "ltr" | "rtl";

export type LanguageDefinition = {
  code: string;
  label: string;
  locale: string;
  dir: LanguageDirection;
  loader: () => Promise<{ default: TranslationCatalog }>;
  shipped: boolean;
  hidden: boolean;
};

const makeLocaleLoader =
  (code: string): LanguageDefinition["loader"] =>
  () =>
    import(`../locales/${code}.json`);

const SHIPPED_LANGUAGES = [
  {
    code: "en",
    label: "English",
    locale: "en-US",
    dir: "ltr",
    loader: makeLocaleLoader("en"),
    shipped: true,
    hidden: false,
  },
  {
    code: "fr",
    label: "Français",
    locale: "fr-FR",
    dir: "ltr",
    loader: makeLocaleLoader("fr"),
    shipped: true,
    hidden: false,
  },
  {
    code: "es",
    label: "Español",
    locale: "es-ES",
    dir: "ltr",
    loader: makeLocaleLoader("es"),
    shipped: true,
    hidden: false,
  },
  {
    code: "de",
    label: "Deutsch",
    locale: "de-DE",
    dir: "ltr",
    loader: makeLocaleLoader("de"),
    shipped: true,
    hidden: false,
  },
  {
    code: "pt",
    label: "Português",
    locale: "pt-BR",
    dir: "ltr",
    loader: makeLocaleLoader("pt"),
    shipped: true,
    hidden: false,
  },
  {
    code: "ja",
    label: "日本語",
    locale: "ja-JP",
    dir: "ltr",
    loader: makeLocaleLoader("ja"),
    shipped: true,
    hidden: false,
  },
  {
    code: "zh-Hans",
    label: "中文",
    locale: "zh-CN",
    dir: "ltr",
    loader: makeLocaleLoader("zh-Hans"),
    shipped: true,
    hidden: false,
  },
  {
    code: "ru",
    label: "Русский",
    locale: "ru-RU",
    dir: "ltr",
    loader: makeLocaleLoader("ru"),
    shipped: true,
    hidden: false,
  },
] as const satisfies readonly LanguageDefinition[];

const PSEUDO_LANGUAGE = {
  code: "qps-ploc",
  label: "［Þšëüðö］",
  locale: "qps-ploc",
  dir: "ltr",
  loader: () => import("../i18n/pseudo-locale"),
  shipped: false,
  hidden: true,
} as const satisfies LanguageDefinition;

type SupportedLanguageDefinition =
  | (typeof SHIPPED_LANGUAGES)[number]
  | typeof PSEUDO_LANGUAGE;

export type SupportedLanguageCode =
  | (typeof SHIPPED_LANGUAGES)[number]["code"]
  | typeof PSEUDO_LANGUAGE.code;

export type LanguageFeatureFlags = {
  russianEnabled: boolean;
  pseudoEnabled: boolean;
};

export function createSupportedLanguages({
  russianEnabled,
  pseudoEnabled,
}: LanguageFeatureFlags): readonly SupportedLanguageDefinition[] {
  const shippedLanguages = russianEnabled
    ? SHIPPED_LANGUAGES
    : SHIPPED_LANGUAGES.filter(({ code }) => code !== "ru");

  return pseudoEnabled
    ? [...shippedLanguages, PSEUDO_LANGUAGE]
    : shippedLanguages;
}

export const RUSSIAN_LOCALE_ENABLED =
  import.meta.env.VITE_ENABLE_RUSSIAN_LOCALE !== "false";
export const PSEUDO_LOCALE_ENABLED = import.meta.env.MODE !== "production";

export const SUPPORTED_LANGUAGES = createSupportedLanguages({
  russianEnabled: RUSSIAN_LOCALE_ENABLED,
  pseudoEnabled: PSEUDO_LOCALE_ENABLED,
});

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map(
  ({ code }) => code,
);

const languageByCode = new Map<
  SupportedLanguageCode,
  SupportedLanguageDefinition
>(SUPPORTED_LANGUAGES.map((language) => [language.code, language] as const));

function createLanguageAliases(
  languages: readonly Pick<SupportedLanguageDefinition, "code" | "locale">[],
): Map<string, SupportedLanguageCode> {
  const aliases = new Map<string, SupportedLanguageCode>();

  for (const language of languages) {
    aliases.set(language.code.toLowerCase(), language.code);
    aliases.set(language.locale.toLowerCase(), language.code);
  }

  if (languages.some(({ code }) => code === "zh-Hans")) {
    for (const alias of ["zh-cn", "zh-sg", "zh-hans"]) {
      aliases.set(alias, "zh-Hans");
    }
  }

  return aliases;
}

function normalizeLanguageWithAliases(
  aliases: ReadonlyMap<string, SupportedLanguageCode>,
  language?: string | null,
): SupportedLanguageCode {
  const normalizedInput = language?.trim().toLowerCase();
  if (!normalizedInput) return DEFAULT_LANGUAGE;

  const exactMatch = aliases.get(normalizedInput);
  if (exactMatch) return exactMatch;

  const baseMatch = aliases.get(normalizedInput.split("-")[0]);
  return baseMatch ?? DEFAULT_LANGUAGE;
}

function isLanguageAliasSupported(
  aliases: ReadonlyMap<string, SupportedLanguageCode>,
  language?: string | null,
): boolean {
  const normalizedInput = language?.trim().toLowerCase();
  if (!normalizedInput) return false;

  return (
    aliases.has(normalizedInput) || aliases.has(normalizedInput.split("-")[0])
  );
}

export function normalizeLanguageAgainst(
  languages: readonly Pick<SupportedLanguageDefinition, "code" | "locale">[],
  language?: string | null,
): SupportedLanguageCode {
  return normalizeLanguageWithAliases(
    createLanguageAliases(languages),
    language,
  );
}

export function isLanguageSupportedAgainst(
  languages: readonly Pick<SupportedLanguageDefinition, "code" | "locale">[],
  language?: string | null,
): boolean {
  return isLanguageAliasSupported(createLanguageAliases(languages), language);
}

const aliases = createLanguageAliases(SUPPORTED_LANGUAGES);

export function normalizeLanguage(
  language?: string | null,
): SupportedLanguageCode {
  return normalizeLanguageWithAliases(aliases, language);
}

export function isLanguageSupported(language?: string | null): boolean {
  return isLanguageAliasSupported(aliases, language);
}

export function getLanguageDefinition(
  language?: string | null,
): (typeof SUPPORTED_LANGUAGES)[number] {
  const code = normalizeLanguage(language);
  return languageByCode.get(code) ?? languageByCode.get(DEFAULT_LANGUAGE)!;
}

export function syncDocumentLanguage(language?: string | null): void {
  if (typeof document === "undefined") return;

  const definition = getLanguageDefinition(language);
  document.documentElement.lang = definition.code;
  document.documentElement.dir = definition.dir;
}
