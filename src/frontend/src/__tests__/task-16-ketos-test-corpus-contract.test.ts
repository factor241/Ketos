import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const frontendRoot = resolve(__dirname, "../..");
const testCorpusRoot = resolve(frontendRoot, "tests");
const upstreamPackage = ["lang", "flow"].join("");
const upstreamSdk = ["l", "f", "x"].join("");

function filesRecursively(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? filesRecursively(path) : [path];
  });
}

function corpusFiles(): string[] {
  return [
    ...filesRecursively(testCorpusRoot),
    resolve(frontendRoot, "playwright.config.ts"),
    resolve(frontendRoot, "src/utils/testUtils/mockData/mockAPIData.ts"),
    resolve(frontendRoot, "tsconfig.json"),
  ].filter((path) => !/\.(?:png|jpg|jpeg|gif|webp|ico)$/i.test(path));
}

describe("Task 16 Ketos-only frontend test corpus", () => {
  it("rejects historical package imports, environment ABI and documentation paths", () => {
    const sources = corpusFiles()
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(sources).not.toMatch(
      new RegExp(`(?:from|import)\\s+${upstreamPackage}(?:\\.|\\b)`, "i"),
    );
    expect(sources).not.toMatch(
      new RegExp(`(?:from|import)\\s+${upstreamSdk}(?:\\.|\\b)`, "i"),
    );
    expect(sources).not.toMatch(
      new RegExp(`${upstreamPackage}_[A-Z0-9_]+`, "i"),
    );
    expect(sources).not.toMatch(
      new RegExp(`\\b${upstreamSdk.toUpperCase()}_[A-Z0-9_]+`),
    );
    expect(sources).not.toContain(
      `__${upstreamPackage.toUpperCase()}_I18N_DIAGNOSTICS__`,
    );
    expect(sources).not.toMatch(
      new RegExp(`https?://docs\\.${upstreamPackage}\\.org(?:/|\\b)`, "i"),
    );
  });

  it("rejects historical helper and fixture filenames", () => {
    const relativePaths = filesRecursively(testCorpusRoot).map((path) =>
      relative(frontendRoot, path).split(sep).join("/"),
    );

    expect(relativePaths.join("\n")).not.toMatch(
      new RegExp(
        `${upstreamPackage}|(?:^|[-_.])${upstreamSdk}(?:[-_.]|$)`,
        "i",
      ),
    );
    expect(relativePaths.join("\n")).not.toMatch(
      /(?:^|[/_.-])(?:old|outdated|legacy)(?:[/_.-]|$)/i,
    );
  });
});
