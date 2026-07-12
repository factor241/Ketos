import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const frontendRoot = resolve(__dirname, "../..");
const upstreamBrand = ["lang", "flow"].join("");

const read = (relativePath: string) =>
  readFileSync(resolve(frontendRoot, relativePath), "utf8");

function productionTypeScriptSource(directory: string): string {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = resolve(directory, name);
      if (statSync(path).isDirectory()) {
        return name === "__tests__" || name === "docs"
          ? []
          : [productionTypeScriptSource(path)];
      }
      return /\.(?:ts|tsx)$/.test(name) &&
        !/\.(?:test|spec)\.(?:ts|tsx)$/.test(name)
        ? [readFileSync(path, "utf8")]
        : [];
    })
    .join("\n");
}

describe("Task 8 Ketos frontend cutover", () => {
  it("uses a Ketos-only HTML and PWA shell", () => {
    const html = read("index.html");
    const manifest = JSON.parse(read("public/manifest.json"));

    expect(html).toContain("<title>Ketos</title>");
    expect(html).toContain("Для работы Ketos необходимо включить JavaScript.");
    expect(html).not.toMatch(new RegExp(upstreamBrand, "i"));
    expect(manifest).toMatchObject({
      name: "Ketos",
      short_name: "Ketos",
    });
    expect(JSON.stringify(manifest)).not.toMatch(
      new RegExp(upstreamBrand, "i"),
    );
  });

  it("does not register Store routes or state bootstrapping", () => {
    expect(read("src/routes.tsx")).not.toMatch(/CustomRoutesStore/);
    expect(read("src/contexts/authContext.tsx")).not.toMatch(
      /useStoreStore|checkHasStore|fetchApiData/,
    );
    expect(
      existsSync(
        resolve(
          frontendRoot,
          "src/controllers/API/queries/api-keys/use-post-add-api-key.ts",
        ),
      ),
    ).toBe(false);
    expect(read("src/constants/constants.ts")).not.toContain("api_key/store");
  });

  it("does not expose hosted widget markup or upstream actions", () => {
    expect(
      existsSync(
        resolve(frontendRoot, "src/modals/apiModal/utils/get-widget-code.tsx"),
      ),
    ).toBe(false);
    const sources = [
      "src/components/common/crashErrorComponent/index.tsx",
      "src/pages/AppInitPage/index.tsx",
    ]
      .map(read)
      .join("\n");

    expect(sources).not.toMatch(
      new RegExp(
        `<${upstreamBrand}-chat|github\\.com/${upstreamBrand}-ai|discord\\.com/invite|${upstreamBrand}\\.org/desktop`,
        "i",
      ),
    );
  });

  it("uses only Ketos-namespaced browser state keys", () => {
    const files = productionTypeScriptSource(resolve(frontendRoot, "src"));

    const oldStorageTokens = [
      ["access_token", "lf"].join("_"),
      ["apikey_tkn", "lflw"].join("_"),
      ["auto_login", "lf"].join("_"),
      ["refresh_token", "lf"].join("_"),
    ];
    expect(files).not.toMatch(new RegExp(oldStorageTokens.join("|")));

    const directLiteralKeys = Array.from(
      files.matchAll(
        /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*["'`](.*?)["'`]/g,
      ),
      (match) => match[1],
    );
    expect(directLiteralKeys).not.toEqual([]);
    expect(directLiteralKeys.every((key) => key.startsWith("ketos-"))).toBe(
      true,
    );
  });

  it("namespaces anonymous flow session state instead of using raw flow ids", () => {
    const sources = [
      "src/controllers/API/queries/messages/use-get-messages.ts",
      "src/controllers/API/queries/messages/use-get-sessions-from-flow.ts",
      "src/controllers/API/queries/messages/use-delete-sessions.ts",
      "src/controllers/API/queries/messages/use-put-update-messages.ts",
      "src/controllers/API/queries/messages/use-rename-session.ts",
      "src/modals/IOModal/playground-modal.tsx",
    ]
      .map(read)
      .join("\n");

    expect(sources).not.toMatch(
      /sessionStorage\.(?:getItem|setItem)\((?:window\.)?(?:id \?\? ""|flowId|currentFlowId)/,
    );
    expect(sources).toContain("ketosFlowSessionKey");
  });
});
