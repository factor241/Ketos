import { readFileSync } from "node:fs";
import path from "node:path";

type Catalog = Record<string, string>;

const LOCALES_DIR = path.resolve(__dirname, "../locales");
const IDENTICAL_ALLOWLIST_PATH = path.resolve(
  __dirname,
  "../../../../scripts/i18n/allowlists/english-identical-values.json",
);
const SHIPPED_LOCALES = ["de", "en", "es", "fr", "ja", "pt", "ru", "zh-Hans"];
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const SEMANTIC_KEYS = [
  "assistant.filePreviewUnavailable",
  "assistant.emptyFile",
  "common.empty",
  "sidebar.bundles.reload.action",
  "sidebar.bundles.reload.failure.network",
  "sidebar.bundles.reload.failure.structural",
  "sidebar.bundles.reload.inProgress",
  "sidebar.bundles.reload.overflowAria",
  "sidebar.bundles.reload.success.noChanges",
  "sidebar.bundles.reload.success.warnings",
  "sidebar.bundles.reload.success.withChanges",
] as const;

function readCatalog(locale: string): Catalog {
  return JSON.parse(
    readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Catalog;
}

function interpolationTokens(value: string): string[] {
  return Array.from(value.matchAll(/{{\s*([^{}]+?)\s*}}/g))
    .map((match) => match[1].trim())
    .sort();
}

function numericTagSignature(value: string): string[] {
  return Array.from(value.matchAll(/<(\/)?(\d+)(?:\s[^>]*)?(\/?)>/g))
    .map(
      (match) =>
        `${match[1] ? "close" : match[3] ? "self" : "open"}:${match[2]}`,
    )
    .sort();
}

function protectedMachineFragments(value: string): string[] {
  const withoutInterpolation = value.replace(/{{[^{}]*}}/g, "");
  return [
    ...(withoutInterpolation.match(/\{[^{}]*\}/g) ?? []),
    ...(value.match(/`[^`]+`/g) ?? []),
    ...(value.match(/https?:\/\/[^\s)]+/g) ?? []),
    ...Array.from(value.matchAll(/\]\(([^)]+)\)/g), (match) => match[1]),
    ...(value.match(/[A-Za-z_]\w*\[\d+\]\.[A-Za-z_]\w*/g) ?? []),
    ...(value.match(
      /\.[A-Za-z_]\w*\s*\|\s*[A-Za-z_]\w*\(\.[A-Za-z_]\w*\s*[><=!]+\s*[^)]+\)/g,
    ) ?? []),
  ].sort();
}

function sourceValueFor(en: Catalog, targetKey: string): string | undefined {
  if (targetKey in en) return en[targetKey];
  const match = targetKey.match(PLURAL_SUFFIX);
  if (!match) return undefined;
  const base = targetKey.slice(0, -match[0].length);
  return en[`${base}_other`] ?? en[`${base}_one`];
}

describe("frontend locale catalog contract", () => {
  const en = readCatalog("en");

  it.each(SHIPPED_LOCALES)(
    "keeps %s flat, non-empty, and token-compatible",
    (locale) => {
      const catalog = readCatalog(locale);

      for (const [key, value] of Object.entries(catalog)) {
        expect(typeof value).toBe("string");
        expect(value.trim()).not.toBe("");
        const source = sourceValueFor(en, key);
        expect(source).toBeDefined();
        expect(interpolationTokens(value)).toEqual(
          interpolationTokens(source!),
        );
        expect(numericTagSignature(value)).toEqual(
          numericTagSignature(source!),
        );
        if (locale === "ru") {
          expect(protectedMachineFragments(value)).toEqual(
            protectedMachineFragments(source!),
          );
        }
      }
    },
  );

  it.each(SHIPPED_LOCALES)(
    "contains all Task 7 semantic keys in %s",
    (locale) => {
      const catalog = readCatalog(locale);
      for (const key of SEMANTIC_KEYS)
        expect(catalog[key]).toEqual(expect.any(String));
    },
  );

  it.each(SHIPPED_LOCALES)(
    "contains no legacy product brand values in %s",
    (locale) => {
      const catalog = readCatalog(locale);
      const legacyBrand = new RegExp(["lang", "flow"].join(""), "i");
      const legacyValues = Object.entries(catalog).filter(([, value]) =>
        legacyBrand.test(value),
      );
      expect(legacyValues).toEqual([]);
    },
  );

  it("removes the two English sentence-as-key catalog entries", () => {
    expect(en).not.toHaveProperty("Preview not available for this file.");
    expect(en).not.toHaveProperty("(empty file)");
  });

  it("requires an exact reviewed allowlist for every English-identical Russian value", () => {
    const ru = readCatalog("ru");
    const allowlist = JSON.parse(
      readFileSync(IDENTICAL_ALLOWLIST_PATH, "utf8"),
    ) as {
      schema_version: number;
      source_locale: string;
      target_locale: string;
      entries: Array<{
        key: string;
        value: string;
        reason: string;
        owner: string;
        reviewer: string;
        review_date: string;
      }>;
    };

    expect(allowlist.schema_version).toBe(1);
    expect(allowlist.source_locale).toBe("en");
    expect(allowlist.target_locale).toBe("ru");

    const reviewed = allowlist.entries.map((entry) => {
      expect(entry.reason.trim()).not.toBe("");
      expect(entry.owner.trim()).not.toBe("");
      expect(entry.reviewer.trim()).not.toBe("");
      expect(entry.review_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      return `${entry.key}\u0000${entry.value}`;
    });
    expect(new Set(reviewed).size).toBe(reviewed.length);

    const identical = Object.keys(en)
      .filter((key) => en[key] === ru[key])
      .map((key) => `${key}\u0000${en[key]}`)
      .sort();
    expect(reviewed.sort()).toEqual(identical);
  });
});
