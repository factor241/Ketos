export type I18nDiagnosticKind = "missing" | "failed_loading" | "fallback";

export interface I18nDiagnosticEntry {
  locale: string;
  key: string;
}

export interface I18nDiagnosticsSnapshot {
  strict: boolean;
  missing: I18nDiagnosticEntry[];
  failedLoading: I18nDiagnosticEntry[];
  fallback: I18nDiagnosticEntry[];
}

export interface I18nDiagnostics {
  record: (kind: I18nDiagnosticKind, locale: string, key: string) => void;
  reset: () => void;
  snapshot: () => I18nDiagnosticsSnapshot;
}

interface StrictModeEnv {
  MODE?: string;
  VITE_STRICT_RU_I18N?: string;
}

interface FallbackCheck {
  strict: boolean;
  locale: string;
  key: string;
  count?: number;
  sourceCatalog: Record<string, string>;
  targetCatalog: Record<string, string>;
}

const PLURAL_CATEGORIES = [
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
] as const;

function hasNonEmptyValue(
  catalog: Record<string, string>,
  key: string,
): boolean {
  return (
    Object.hasOwn(catalog, key) &&
    typeof catalog[key] === "string" &&
    catalog[key].length > 0
  );
}

function pluralKeysFor(key: string): string[] {
  return PLURAL_CATEGORIES.map((category) => `${key}_${category}`);
}

function hasPluralValue(catalog: Record<string, string>, key: string): boolean {
  return pluralKeysFor(key).some((candidate) =>
    hasNonEmptyValue(catalog, candidate),
  );
}

function selectedPluralKey(locale: string, key: string, count: number): string {
  const category = new Intl.PluralRules(locale, {
    type: "cardinal",
  }).select(count);
  return `${key}_${category}`;
}

export function isStrictRuTestMode(env: StrictModeEnv): boolean {
  return env.MODE === "test" && env.VITE_STRICT_RU_I18N === "true";
}

export function shouldRecordFallback({
  strict,
  locale,
  key,
  count,
  sourceCatalog,
  targetCatalog,
}: FallbackCheck): boolean {
  if (strict || locale.toLowerCase().split("-")[0] === "en") return false;
  if (hasNonEmptyValue(sourceCatalog, key)) {
    return !hasNonEmptyValue(targetCatalog, key);
  }

  if (!hasPluralValue(sourceCatalog, key)) return false;
  if (typeof count === "number") {
    return !hasNonEmptyValue(
      targetCatalog,
      selectedPluralKey(locale, key, count),
    );
  }
  return !hasPluralValue(targetCatalog, key);
}

export function createI18nDiagnostics(strict: boolean): I18nDiagnostics {
  const buckets: Record<
    I18nDiagnosticKind,
    Map<string, I18nDiagnosticEntry>
  > = {
    missing: new Map(),
    failed_loading: new Map(),
    fallback: new Map(),
  };

  const values = (kind: I18nDiagnosticKind) =>
    Array.from(buckets[kind].values()).sort(
      (left, right) =>
        left.locale.localeCompare(right.locale) ||
        left.key.localeCompare(right.key),
    );

  return {
    record(kind, locale, key) {
      const normalizedLocale = locale || "unknown";
      const normalizedKey = key || "unknown";
      buckets[kind].set(`${normalizedLocale}\0${normalizedKey}`, {
        locale: normalizedLocale,
        key: normalizedKey,
      });
    },
    reset() {
      Object.values(buckets).forEach((bucket) => bucket.clear());
    },
    snapshot() {
      return {
        strict,
        missing: values("missing"),
        failedLoading: values("failed_loading"),
        fallback: values("fallback"),
      };
    },
  };
}
