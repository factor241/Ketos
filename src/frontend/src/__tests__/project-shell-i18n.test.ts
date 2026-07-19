import { readFileSync } from "node:fs";
import path from "node:path";

const readCatalog = (locale: string) =>
  JSON.parse(
    readFileSync(path.resolve(__dirname, `../locales/${locale}.json`), "utf8"),
  ) as Record<string, string>;

const keys = [
  "projectShell.heading",
  "projectShell.navigation",
  "projectShell.boards",
  "projectShell.flows",
  "projectShell.loading",
  "projectShell.emptyBoards",
  "projectShell.error",
  "projectShell.renameError",
] as const;

describe("project shell translations", () => {
  const en = readCatalog("en");
  const ru = readCatalog("ru");

  it.each(keys)("keeps %s non-empty in English and Russian", (key) => {
    expect(en[key]?.trim()).not.toBe("");
    expect(ru[key]?.trim()).not.toBe("");
  });

  it("keeps heading interpolation parity", () => {
    const tokens = (value: string) =>
      Array.from(value.matchAll(/{{\s*([^{}]+?)\s*}}/g), (match) => match[1]);
    expect(tokens(en["projectShell.heading"])).toEqual(["name"]);
    expect(tokens(ru["projectShell.heading"])).toEqual(["name"]);
  });

  it("uses every shell-state key from ProjectPage", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../pages/ProjectPage/index.tsx"),
      "utf8",
    );
    for (const key of keys.filter(
      (key) => key !== "projectShell.renameError",
    )) {
      expect(source).toContain(`t("${key}"`);
    }
  });
});
