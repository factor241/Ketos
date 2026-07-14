import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const frontendRoot = resolve(__dirname, "../..");
const upstreamBrand = ["lang", "flow"].join("");
const upstreamExecutor = ["l", "fx"].join("");
const upstreamEnvPrefix = ["LANG", "FLOW"].join("");

const read = (relativePath: string) =>
  readFileSync(resolve(frontendRoot, relativePath), "utf8");

function productionFrontendSource(directory: string): string {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = resolve(directory, name);
      if (statSync(path).isDirectory()) {
        return name === "__tests__" || name === "docs"
          ? []
          : [productionFrontendSource(path)];
      }
      return /\.(?:css|html|js|jsx|ts|tsx)$/.test(name) &&
        !/\.(?:stories|test|spec)\.(?:js|jsx|ts|tsx)$/.test(name)
        ? [readFileSync(path, "utf8")]
        : [];
    })
    .join("\n");
}

function rootFrontendConfigSource(): string {
  return readdirSync(frontendRoot)
    .filter(
      (name) =>
        /^(?:\.env(?:\..*)?|.*\.(?:cjs|js|json|mjs|mts|ts))$/.test(name) &&
        !/(?:^|\/)(?:package-lock|pnpm-lock)\.yaml$/.test(name) &&
        name !== "package-lock.json",
    )
    .map((name) => resolve(frontendRoot, name))
    .filter((path) => statSync(path).isFile())
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

function task8ProductionSource(): string {
  return [
    read("src/constants/constants.ts"),
    productionFrontendSource(resolve(frontendRoot, "src/customization")),
    read("src/i18n.ts"),
    read("src/vite-env.d.ts"),
    read("src/utils/decorate-wxo-url.ts"),
    read("vite.config.mts"),
    read("package.json"),
  ].join("\n");
}

describe("Task 8 Ketos frontend cutover", () => {
  it("recursively keeps Task 8 production sources Ketos-only", () => {
    const sources = task8ProductionSource();
    const allProductionSources = [
      productionFrontendSource(resolve(frontendRoot, "src")),
      rootFrontendConfigSource(),
    ].join("\n");
    const controllerSources = productionFrontendSource(
      resolve(frontendRoot, "src/controllers/API"),
    );

    expect(sources).not.toMatch(new RegExp(upstreamBrand, "i"));
    expect(sources).not.toMatch(
      new RegExp(
        `${upstreamEnvPrefix}_(?:AUTO_LOGIN|MCP_COMPOSER_ENABLED|EXTENSION_RELOAD_ENABLED|WXO_UTM_SOURCE)|__${upstreamEnvPrefix}_I18N_DIAGNOSTICS__|${upstreamEnvPrefix}_SUPPORTED_TYPES`,
      ),
    );
    expect(allProductionSources).not.toMatch(
      new RegExp(
        `${upstreamEnvPrefix}_(?:AUTO_LOGIN|ENABLE_EXTENSION_RELOAD|EXTENSION_RELOAD_ENABLED|MCP_COMPOSER_ENABLED|WXO_UTM_SOURCE)|env${upstreamBrand}|\\b(?:${upstreamBrand} run|${upstreamExecutor} extension dev)\\b|\\bdefault[^\\n]{0,80}["'\`]${upstreamBrand}["'\`]`,
        "i",
      ),
    );
    expect(allProductionSources).not.toMatch(
      new RegExp(`(?<![a-z0-9])${upstreamBrand}(?![a-z0-9])`, "i"),
    );
    expect(allProductionSources).not.toMatch(
      new RegExp(`(?<![a-z0-9])${upstreamExecutor}(?![a-z0-9])`, "i"),
    );
    expect(sources).not.toMatch(
      /\b(?:STORE_DESC|STORE_TITLE|STORE_PAGINATION_SIZE|STORE_PAGINATION_PAGE|STORE_PAGINATION_ROWS_COUNT|NO_API_KEY|INSERT_API_KEY|INVALID_API_KEY|CREATE_API_KEY|SAVE_API_KEY_ALERT|CHAT_FORM_DIALOG_SUBTITLE|CHAT_CANNOT_OPEN_TITLE|CHAT_CANNOT_OPEN_DESCRIPTION|CHAT_FIRST_INITIAL_TEXT|CHAT_SECOND_INITIAL_TEXT)\b/,
    );
    expect(sources).not.toContain(`${upstreamEnvPrefix}_CHAT_TITLE`);
    expect(JSON.parse(read("package.json"))).toMatchObject({
      name: "ketos-frontend",
    });
    expect(read("src/utils/decorate-wxo-url.ts")).toContain(
      'DEFAULT_UTM_SOURCE = "ketos"',
    );
    expect(controllerSources).not.toMatch(
      new RegExp(`x-${upstreamBrand}-global-var-`, "i"),
    );

    for (const assistantHook of [
      "src/controllers/API/queries/assistant/use-template-assistant.ts",
      "src/controllers/API/queries/assistant/use-system-message-gen.ts",
    ]) {
      const source = read(assistantHook);

      expect(source).toContain('"X-Ketos-Global-Var-COMPONENT_ID"');
      expect(source).toContain('"X-Ketos-Global-Var-FLOW_ID"');
      expect(source).toContain('"X-Ketos-Global-Var-FIELD_NAME"');
    }
  });

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
    const files = productionFrontendSource(resolve(frontendRoot, "src"));

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

  it("keeps compiled runtime strings and selectors Ketos-only", () => {
    const runtimeSurfaces = [
      "src/constants/dbProviderConstants.ts",
      "src/utils/buildUtils.ts",
      "src/pages/Playground/index.tsx",
      "src/pages/SettingsPage/pages/McpClientPage/index.tsx",
      "src/components/common/safari-scroll-fix.tsx",
      "src/components/core/playgroundComponent/sliding-container/components/flow-page-sliding-container.tsx",
      "src/components/core/parameterRenderComponent/components/sortableListComponent/index.tsx",
      "src/modals/IOModal/components/chatView/chatInput/components/voice-assistant/hooks/use-start-conversation.ts",
      "src/components/common/ImageViewer/index.tsx",
      "src/components/core/csvOutputComponent/index.tsx",
      "src/components/core/pdfViewer/Error/index.tsx",
      "src/components/core/pdfViewer/noData/index.tsx",
      "src/style/applies.css",
    ]
      .map(read)
      .join("\n");

    expect(runtimeSurfaces).not.toMatch(
      new RegExp(`(?<![a-z0-9])${upstreamBrand}(?![a-z0-9])`, "i"),
    );
    expect(runtimeSurfaces).not.toMatch(
      new RegExp(`(?<![a-z0-9])${upstreamExecutor}(?![a-z0-9])`, "i"),
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
