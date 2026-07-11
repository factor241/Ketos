import { createInstance } from "i18next";
import en from "../locales/en.json";
import ru from "../locales/ru.json";

type Catalog = Record<string, string>;

const source = en as Catalog;
const target = ru as Catalog;
const SOURCE_SUFFIX = /^(.*)_(one|other)$/;
const REQUIRED_CATEGORIES = ["one", "few", "many", "other"] as const;

function withRenderedCount(value: string, count: number): string {
  return value.replace(/{{\s*count\s*}}/g, String(count));
}

function sourcePluralGroups(): string[] {
  const forms = new Map<string, Set<string>>();
  for (const key of Object.keys(source)) {
    const match = key.match(SOURCE_SUFFIX);
    if (!match) continue;
    const categories = forms.get(match[1]) ?? new Set<string>();
    categories.add(match[2]);
    forms.set(match[1], categories);
  }
  return Array.from(forms.entries())
    .filter(
      ([, categories]) => categories.has("one") && categories.has("other"),
    )
    .map(([base]) => base)
    .sort();
}

describe("Russian cardinal plurals", () => {
  const groups = sourcePluralGroups();
  const pluralI18n = createInstance();
  const translatePlural = pluralI18n.t as unknown as (
    key: string,
    options: { count: number },
  ) => string;

  beforeAll(async () => {
    await pluralI18n.init({
      lng: "ru",
      fallbackLng: false,
      resources: { ru: { translation: target } },
      interpolation: { escapeValue: false },
      showSupportNotice: false,
    });
  });

  it("covers all 37 source plural groups with one/few/many/other", () => {
    expect(groups).toHaveLength(37);
    for (const base of groups) {
      for (const category of REQUIRED_CATEGORIES) {
        expect(target[`${base}_${category}`]).toEqual(expect.any(String));
        expect(target[`${base}_${category}`].trim()).not.toBe("");
      }
    }
  });

  it.each([
    [0, "many"],
    [1, "one"],
    [2, "few"],
    [5, "many"],
    [11, "many"],
    [21, "one"],
    [22, "few"],
    [25, "many"],
    [101, "one"],
  ])("selects %s as the %s category", (count, expectedCategory) => {
    expect(new Intl.PluralRules("ru-RU").select(count)).toBe(expectedCategory);
    for (const base of groups) {
      expect(target[`${base}_${expectedCategory}`]).toEqual(expect.any(String));
      expect(translatePlural(base, { count })).toBe(
        withRenderedCount(target[`${base}_${expectedCategory}`], count),
      );
    }
  });

  it("keeps the decimal-only other category available", () => {
    expect(new Intl.PluralRules("ru-RU").select(1.5)).toBe("other");
    for (const base of groups) {
      expect(target[`${base}_other`]).toEqual(expect.any(String));
      expect(translatePlural(base, { count: 1.5 })).toBe(
        withRenderedCount(target[`${base}_other`], 1.5),
      );
    }
  });
});
