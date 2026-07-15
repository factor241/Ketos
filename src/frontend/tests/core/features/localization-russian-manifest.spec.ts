import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { expect, test } from "../../fixtures";
import { mockAutoLoginDisabled } from "../../utils/auth/mock-auto-login-disabled";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";
import { TID } from "../../utils/constants/testIds";
import { TEXTS } from "../../utils/constants/texts";
import { ANIMATIONS, TIMEOUTS } from "../../utils/constants/timeouts";
import { addComponentFromSidebar } from "../../utils/flow/add-component-from-sidebar";
import { openTemplatesModal } from "../../utils/flow/new-project-flow";
import { RUSSIAN_OPTION_NAME } from "../../utils/localization-option-names";

type SurfaceKind =
  | "baseline"
  | "route"
  | "state"
  | "modal"
  | "overlay"
  | "primitive"
  | "feature"
  | "boundary";

type SurfaceRow = {
  kind: SurfaceKind;
  route: string;
  surface: string;
  state: string;
  flag: string;
  owner: string;
  namespace: string;
  textClass: string;
  testId: string;
  e2eStatus: string;
  visualStatus: string;
  reviewer: string;
  source: string;
};

type EvidenceMode =
  | "static-contract"
  | "live-executable"
  | "blocked-feature"
  | "blocked-fixture"
  | "blocked-product"
  | "blocked-manual";

type EvidenceGroup = {
  spec: string;
  testTitle: string;
  mode: EvidenceMode;
  reason?: string;
};

type I18nDiagnosticsSnapshot = {
  strict: boolean;
  missing: Array<{ locale: string; key: string }>;
  failedLoading: Array<{ locale: string; key: string }>;
  fallback: Array<{ locale: string; key: string }>;
};

type CoreRouteCase = {
  manifestId: string;
  path: string;
  expectedPath: RegExp;
  readySelector: string;
  expectedRussian?: string;
  forbiddenEnglish?: string;
};

const REPOSITORY_ROOT = resolve(__dirname, "../../../../../");
const MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  "docs/localization/ru/surface-manifest.csv",
);
const EN_CATALOG_PATH = resolve(
  REPOSITORY_ROOT,
  "src/frontend/src/locales/en.json",
);
const THIS_SPEC =
  "src/frontend/tests/core/features/localization-russian-manifest.spec.ts";
const LANGUAGE_STORAGE_KEY = "ketos-language-preference";
const TASK_17_A11Y_SPEC =
  "src/frontend/tests/core/features/localization-russian-a11y.spec.ts";
const TASK_17_ERROR_SPEC =
  "src/frontend/tests/core/features/localization-russian-errors.spec.ts";

const MANIFEST_COLUMNS = [
  "kind",
  "route",
  "surface",
  "state",
  "flag",
  "owner",
  "namespace",
  "text_class",
  "test_id",
  "e2e_status",
  "visual_status",
  "reviewer",
  "source",
] as const;

const EXPECTED_KIND_COUNTS: Record<SurfaceKind, number> = {
  baseline: 6,
  route: 36,
  state: 16,
  modal: 30,
  overlay: 57,
  primitive: 5,
  feature: 8,
  boundary: 7,
};

const CORE_ROUTE_IDS = new Set([
  "route-root",
  "route-index-redirect",
  "route-assets-redirect",
  "route-files",
  "route-knowledge-bases",
  "route-flows",
  "route-components",
  "route-all",
  "route-mcp",
  "route-settings-redirect",
  "route-settings-general",
  "route-settings-language",
  "route-settings-global-variables",
  "route-settings-model-providers",
  "route-settings-db-providers",
  "route-settings-mcp-servers",
  "route-settings-mcp-client",
  "route-settings-api-keys",
  "route-settings-shortcuts",
  "route-settings-messages",
  "route-account-delete",
  "route-admin",
  "route-wildcard",
]);

const PUBLIC_ROUTE_IDS = new Set([
  "route-login",
  "route-signup",
  "route-admin-login",
]);

const DYNAMIC_ROUTE_IDS = new Set([
  "route-components-folder",
  "route-all-folder",
  "route-mcp-folder",
  "route-flow-editor",
  "route-flow-folder-editor",
  "route-flow-view",
]);

const FIXTURE_BLOCKED_ROUTE_IDS = new Set(["route-knowledge-chunks"]);

const REPRESENTATIVE_OVERLAY_IDS = new Set([
  "state-modal-open",
  "state-tooltip-popover",
  "modal-templates",
  "overlay-alert-dropdown",
  "overlay-account-profile-menu",
  "overlay-canvas-controls",
  "overlay-canvas-zoom-actions",
  "overlay-canvas-help",
]);

const DISABLED_FEATURE_TOKENS = new Set([
  "ENABLE_CUSTOM_PARAM",
  "ENABLE_EXTENSION_RELOAD",
  "BASENAME",
  "wxo_deployments",
]);

const EVIDENCE_GROUPS = {
  "governance-contract": {
    spec: THIS_SPEC,
    testTitle:
      "surface manifest has 165 unique rows and a deterministic evidence mapping",
    mode: "static-contract",
  },
  "core-routes": {
    spec: THIS_SPEC,
    testTitle:
      "Russian core routes and redirects render their localized route landmarks",
    mode: "live-executable",
  },
  "public-routes": {
    spec: THIS_SPEC,
    testTitle: "Russian public auth routes render in manual-auth mode",
    mode: "live-executable",
  },
  "dynamic-routes": {
    spec: THIS_SPEC,
    testTitle:
      "Russian flow and folder routes use real flow and folder identifiers",
    mode: "live-executable",
  },
  "public-playground-route": {
    spec: THIS_SPEC,
    testTitle:
      "Russian public playground uses a deterministic Chat Input flow and passes visual accessibility gates",
    mode: "blocked-product",
    reason:
      "The deterministic PUBLIC Chat Input route reaches the Russian UI, but axe currently reports critical button-name and serious nested-interactive violations.",
  },
  "preference-state": {
    spec: THIS_SPEC,
    testTitle:
      "Russian preference survives reload and a new tab after a rapid language race",
    mode: "live-executable",
  },
  "representative-overlays": {
    spec: THIS_SPEC,
    testTitle:
      "Russian template modal, notification tooltip, menus, and canvas overlays render localized text",
    mode: "live-executable",
  },
  "task-17-error": {
    spec: TASK_17_ERROR_SPEC,
    testTitle:
      "stable flow error code renders Russian UI without leaking backend diagnostics",
    mode: "live-executable",
  },
  "task-17-visual": {
    spec: TASK_17_A11Y_SPEC,
    testTitle:
      "matches the Russian width, theme and 200 percent zoom visual matrix",
    mode: "live-executable",
  },
  "feature-config-blocked": {
    spec: THIS_SPEC,
    testTitle: "BLOCKED feature-configured Task 18 surfaces",
    mode: "blocked-feature",
    reason:
      "Requires separate builds with custom parameter, extension reload, BASENAME, and wxo deployment flags enabled.",
  },
  "data-fixture-blocked": {
    spec: THIS_SPEC,
    testTitle: "BLOCKED fixture-dependent Task 18 routes",
    mode: "blocked-fixture",
    reason: "Requires an ingested knowledge-base source with chunks.",
  },
  "state-fixture-blocked": {
    spec: THIS_SPEC,
    testTitle: "BLOCKED exhaustive Task 18 state fixtures",
    mode: "blocked-fixture",
    reason:
      "Requires deterministic loading, empty, populated, permission, network, locked, version, notification, and maximal-flag fixtures.",
  },
  "surface-fixture-blocked": {
    spec: THIS_SPEC,
    testTitle: "BLOCKED exhaustive Task 18 modal and overlay openings",
    mode: "blocked-fixture",
    reason:
      "Each remaining modal, dialog, popover, drawer, context menu, and primitive must be opened with its real prerequisite state.",
  },
  "manual-review-blocked": {
    spec: THIS_SPEC,
    testTitle: "BLOCKED Task 18 manual reviewer and topology sign-off",
    mode: "blocked-manual",
    reason:
      "Requires human linguistic screenshot review plus same-origin, separate-origin, and custom-BASENAME runs.",
  },
} as const satisfies Record<string, EvidenceGroup>;

type EvidenceGroupId = keyof typeof EVIDENCE_GROUPS;

const CORE_ROUTE_CASES: CoreRouteCase[] = [
  {
    manifestId: "route-root",
    path: "/",
    expectedPath: /^\/flows\/?$/,
    readySelector: '[data-testid="flows-btn"]',
    expectedRussian: "Сценарии",
    forbiddenEnglish: "Flows",
  },
  {
    manifestId: "route-index-redirect",
    path: "/",
    expectedPath: /^\/flows\/?$/,
    readySelector: '[data-testid="flows-btn"]',
    expectedRussian: "Сценарии",
    forbiddenEnglish: "Flows",
  },
  {
    manifestId: "route-assets-redirect",
    path: "/assets",
    expectedPath: /^\/assets\/files\/?$/,
    readySelector: '[data-testid="mainpage_title"]',
    expectedRussian: "Файлы",
    forbiddenEnglish: "Files",
  },
  {
    manifestId: "route-files",
    path: "/assets/files",
    expectedPath: /^\/assets\/files\/?$/,
    readySelector: '[data-testid="mainpage_title"]',
    expectedRussian: "Файлы",
    forbiddenEnglish: "Files",
  },
  {
    manifestId: "route-knowledge-bases",
    path: "/assets/knowledge-bases",
    expectedPath: /^\/assets\/knowledge-bases\/?$/,
    readySelector: '[data-testid="mainpage_title"]',
    expectedRussian: "Базы знаний",
    forbiddenEnglish: "Knowledge",
  },
  {
    manifestId: "route-flows",
    path: "/flows/",
    expectedPath: /^\/flows\/?$/,
    readySelector: '[data-testid="flows-btn"]',
    expectedRussian: "Сценарии",
    forbiddenEnglish: "Flows",
  },
  {
    manifestId: "route-components",
    path: "/components/",
    expectedPath: /^\/components\/?$/,
    readySelector: '[data-testid="cards-wrapper"]',
  },
  {
    manifestId: "route-all",
    path: "/all/",
    expectedPath: /^\/all\/?$/,
    readySelector: '[data-testid="cards-wrapper"]',
  },
  {
    manifestId: "route-mcp",
    path: "/mcp/",
    expectedPath: /^\/mcp\/?$/,
    readySelector: '[data-testid="mcp-btn"]',
    expectedRussian: "MCP-сервер",
    forbiddenEnglish: "MCP Server",
  },
  {
    manifestId: "route-settings-redirect",
    path: "/settings",
    expectedPath: /^\/settings\/general\/?$/,
    readySelector: '[data-testid="settings_menu_header"]',
    expectedRussian: "Общие",
    forbiddenEnglish: "General",
  },
  {
    manifestId: "route-settings-general",
    path: "/settings/general",
    expectedPath: /^\/settings\/general\/?$/,
    readySelector: '[data-testid="settings_menu_header"]',
    expectedRussian: "Общие",
    forbiddenEnglish: "General",
  },
  {
    manifestId: "route-settings-language",
    path: "/settings/language",
    expectedPath: /^\/settings\/language\/?$/,
    readySelector: '[data-testid="settings-language-heading"]',
    expectedRussian: "Язык",
    forbiddenEnglish: "Language",
  },
  {
    manifestId: "route-settings-global-variables",
    path: "/settings/global-variables",
    expectedPath: /^\/settings\/global-variables\/?$/,
    readySelector: '[data-testid="settings_menu_header"]',
    expectedRussian: "Глобальные переменные",
    forbiddenEnglish: "Global Variables",
  },
  {
    manifestId: "route-settings-model-providers",
    path: "/settings/model-providers",
    expectedPath: /^\/settings\/model-providers\/?$/,
    readySelector: '[data-testid="settings_menu_header"]',
    expectedRussian: "Провайдеры моделей",
    forbiddenEnglish: "Model Providers",
  },
  {
    manifestId: "route-settings-db-providers",
    path: "/settings/db-providers",
    expectedPath: /^\/settings\/db-providers\/?$/,
    readySelector: '[data-testid="settings_menu_header"]',
    expectedRussian: "Провайдеры БД",
    forbiddenEnglish: "DB Providers",
  },
  {
    manifestId: "route-settings-mcp-servers",
    path: "/settings/mcp-servers",
    expectedPath: /^\/settings\/mcp-servers\/?$/,
    readySelector: '[data-testid="settings_menu_header"]',
    expectedRussian: "MCP-серверы",
    forbiddenEnglish: "MCP Servers",
  },
  {
    manifestId: "route-settings-mcp-client",
    path: "/settings/mcp-client",
    expectedPath: /^\/settings\/mcp-client\/?$/,
    readySelector: "main h2",
    expectedRussian: "Клиент Ketos MCP",
    forbiddenEnglish: "Ketos MCP Client",
  },
  {
    manifestId: "route-settings-api-keys",
    path: "/settings/api-keys",
    expectedPath: /^\/settings\/api-keys\/?$/,
    readySelector: '[data-testid="settings_menu_header"]',
    expectedRussian: "API-ключи Ketos",
    forbiddenEnglish: "Ketos API Keys",
  },
  {
    manifestId: "route-settings-shortcuts",
    path: "/settings/shortcuts",
    expectedPath: /^\/settings\/shortcuts\/?$/,
    readySelector: '[data-testid="settings_menu_header"]',
    expectedRussian: "Сочетания клавиш",
    forbiddenEnglish: "Shortcuts",
  },
  {
    manifestId: "route-settings-messages",
    path: "/settings/messages",
    expectedPath: /^\/settings\/messages\/?$/,
    readySelector: '[data-testid="settings_menu_header"]',
    expectedRussian: "Сообщения",
    forbiddenEnglish: "Messages",
  },
  {
    manifestId: "route-account-delete",
    path: "/account/delete",
    expectedPath: /^\/account\/delete\/?$/,
    readySelector: ".text-2xl",
    expectedRussian: "Удалить учётную запись",
    forbiddenEnglish: "Delete your account",
  },
  {
    manifestId: "route-admin",
    path: "/admin",
    expectedPath: /^\/admin\/?$/,
    readySelector: ".main-page-nav-title",
    expectedRussian: "Страница администратора",
    forbiddenEnglish: "Admin Page",
  },
  {
    manifestId: "route-wildcard",
    path: "/taREDACTED_OPENAI_API_KEY",
    expectedPath: /^\/flows\/?$/,
    readySelector: '[data-testid="flows-btn"]',
    expectedRussian: "Сценарии",
    forbiddenEnglish: "Flows",
  },
];

const CATALOG_NAMESPACES = [
  ...new Set(
    Object.keys(
      JSON.parse(readFileSync(EN_CATALOG_PATH, "utf8")) as Record<
        string,
        string
      >,
    ).map((key) => key.split(".")[0]),
  ),
].sort();

const VISIBLE_TRANSLATION_KEY = new RegExp(
  `\\b(?:${CATALOG_NAMESPACES.map((namespace) =>
    namespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|")})\\.[A-Za-z][\\w.-]*\\b`,
);

function parseManifest(): SurfaceRow[] {
  const lines = readFileSync(MANIFEST_PATH, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  const header = lines.shift()?.split(",") ?? [];

  if (JSON.stringify(header) !== JSON.stringify(MANIFEST_COLUMNS)) {
    throw new Error(`surface-manifest header drift: ${JSON.stringify(header)}`);
  }

  return lines.map((line, index) => {
    const columns = line.split(",");
    if (columns.length !== MANIFEST_COLUMNS.length) {
      throw new Error(
        `surface-manifest row ${index + 2} has ${columns.length} columns instead of ${MANIFEST_COLUMNS.length}`,
      );
    }
    if (columns.some((column) => column.trim().length === 0)) {
      throw new Error(`surface-manifest row ${index + 2} has an empty field`);
    }

    return {
      kind: columns[0] as SurfaceKind,
      route: columns[1],
      surface: columns[2],
      state: columns[3],
      flag: columns[4],
      owner: columns[5],
      namespace: columns[6],
      textClass: columns[7],
      testId: columns[8],
      e2eStatus: columns[9],
      visualStatus: columns[10],
      reviewer: columns[11],
      source: columns[12],
    };
  });
}

function hasDisabledFeature(row: SurfaceRow): boolean {
  return row.flag
    .split("+")
    .some((token) => DISABLED_FEATURE_TOKENS.has(token));
}

function evidenceGroupFor(row: SurfaceRow): EvidenceGroupId {
  if (row.kind === "baseline" || row.kind === "boundary") {
    return "governance-contract";
  }

  if (row.kind === "route") {
    if (CORE_ROUTE_IDS.has(row.testId)) return "core-routes";
    if (PUBLIC_ROUTE_IDS.has(row.testId)) return "public-routes";
    if (DYNAMIC_ROUTE_IDS.has(row.testId)) return "dynamic-routes";
    if (row.testId === "route-playground") return "public-playground-route";
    if (FIXTURE_BLOCKED_ROUTE_IDS.has(row.testId)) {
      return "data-fixture-blocked";
    }
    if (hasDisabledFeature(row)) return "feature-config-blocked";
    throw new Error(`unmapped route row: ${row.testId}`);
  }

  if (row.testId === "state-backend-error") return "task-17-error";
  if (row.testId === "state-mobile-sidebar") return "task-17-visual";
  if (REPRESENTATIVE_OVERLAY_IDS.has(row.testId)) {
    return "representative-overlays";
  }
  if (hasDisabledFeature(row)) return "feature-config-blocked";
  if (row.kind === "state" || row.kind === "feature") {
    return "state-fixture-blocked";
  }
  if (
    row.kind === "modal" ||
    row.kind === "overlay" ||
    row.kind === "primitive"
  ) {
    return "surface-fixture-blocked";
  }

  throw new Error(`unmapped manifest row: ${row.testId}`);
}

function validateManifestAtDiscovery(rows: SurfaceRow[]): void {
  const errors: string[] = [];
  if (rows.length !== 165)
    errors.push(`expected 165 rows, received ${rows.length}`);

  const uniqueIds = new Set(rows.map((row) => row.testId));
  if (uniqueIds.size !== rows.length) {
    const duplicates = rows
      .map((row) => row.testId)
      .filter((id, index, ids) => ids.indexOf(id) !== index);
    errors.push(
      `duplicate test_id values: ${[...new Set(duplicates)].join(", ")}`,
    );
  }

  for (const [kind, expected] of Object.entries(EXPECTED_KIND_COUNTS)) {
    const actual = rows.filter((row) => row.kind === kind).length;
    if (actual !== expected)
      errors.push(`${kind}: expected ${expected}, received ${actual}`);
  }

  const mapped = new Map<EvidenceGroupId, SurfaceRow[]>();
  for (const row of rows) {
    if (!/^[a-z][a-z0-9-]+$/.test(row.testId)) {
      errors.push(`${row.testId}: test_id must be stable kebab-case`);
    }

    const groupId = evidenceGroupFor(row);
    const group = EVIDENCE_GROUPS[groupId];
    mapped.set(groupId, [...(mapped.get(groupId) ?? []), row]);

    if (group.mode.startsWith("blocked-") && !group.reason) {
      errors.push(`${groupId}: blocked evidence group has no reason`);
    }

    if (/^(?:src|docs|scripts)\//.test(row.source)) {
      const sourcePath = resolve(REPOSITORY_ROOT, row.source);
      if (!existsSync(sourcePath))
        errors.push(`${row.testId}: missing source ${row.source}`);
    }
  }

  const representedRows = [...mapped.values()].reduce(
    (total, groupRows) => total + groupRows.length,
    0,
  );
  if (representedRows !== rows.length) {
    errors.push(
      `evidence mapping covers ${representedRows}/${rows.length} rows`,
    );
  }

  for (const [groupId, groupRows] of mapped) {
    const group = EVIDENCE_GROUPS[groupId];
    const evidencePath = resolve(REPOSITORY_ROOT, group.spec);
    if (!existsSync(evidencePath)) {
      errors.push(`${groupId}: missing evidence spec ${group.spec}`);
      continue;
    }
    const evidenceSource = readFileSync(evidencePath, "utf8");
    if (!evidenceSource.includes(group.testTitle)) {
      errors.push(
        `${groupId}: ${groupRows.length} rows point to missing test title ${JSON.stringify(group.testTitle)}`,
      );
    }
  }

  const currentRouteIds = new Set(
    CORE_ROUTE_CASES.map((route) => route.manifestId),
  );
  for (const routeId of CORE_ROUTE_IDS) {
    if (!currentRouteIds.has(routeId))
      errors.push(`${routeId}: no runtime route case`);
  }

  if (errors.length > 0) {
    throw new Error(
      `Task 18 surface-manifest contract failed:\n- ${errors.join("\n- ")}`,
    );
  }
}

const MANIFEST_ROWS = parseManifest();

// Playwright evaluates the module during `--list`; keep the deterministic
// 165-row contract at discovery time so it cannot be mistaken for a live UI
// PASS when the servers were never started.
validateManifestAtDiscovery(MANIFEST_ROWS);

test.describe.configure({ mode: "serial" });

async function bootstrapToMainPage(page: Page): Promise<void> {
  try {
    await awaitBootstrapTest(page, { skipModal: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const path = new URL(page.url()).pathname;
    const isKnownFreshDatabaseState =
      message.includes('id="new-project-btn"') && path.startsWith("/flow/");
    if (!isKnownFreshDatabaseState) throw error;

    await page.goto("/flows/");
    await expect(page.getByTestId("mainpage_title")).toBeVisible({
      timeout: 30_000,
    });
  }
}

async function selectRussian(page: Page): Promise<void> {
  await page.goto("/settings/language");
  await expect(page.getByTestId("settings-language-page")).toBeVisible({
    timeout: 30_000,
  });

  if ((await page.locator("html").getAttribute("lang")) !== "ru") {
    await page.getByTestId("language-preference-select").click();
    const savedPreference = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.includes("/api/v1/users/"),
    );
    await page.getByRole("option", { name: RUSSIAN_OPTION_NAME }).click();
    expect((await savedPreference).ok()).toBe(true);
  }

  await expect(page.locator("html")).toHaveAttribute("lang", "ru", {
    timeout: 30_000,
  });
}

async function authenticateManualSuperuser(page: Page): Promise<void> {
  await page.route("**/api/v1/auto_login", (route) => {
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ auto_login: false }),
    });
  });
  await page.context().clearCookies();
  await page.goto("/login");

  await page
    .locator('input[type="username"]')
    .fill(TEXTS.authDefaultCredential);
  await page.locator('input[type="password"]').fill(TEXTS.authDefaultPassword);
  const loginResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/api/v1/login"),
  );
  await page.locator('button[type="submit"]').click();
  expect((await loginResponse).ok()).toBe(true);
  await expect(page.getByTestId("flows-btn")).toBeVisible({
    timeout: 60_000,
  });
  await selectRussian(page);
}

async function expectNoI18nDiagnostics(
  page: Page,
  evidenceId: string,
): Promise<void> {
  const diagnostics = await page.evaluate<I18nDiagnosticsSnapshot | null>(
    () => window.__KETOS_I18N_DIAGNOSTICS__?.snapshot() ?? null,
  );

  expect(diagnostics, `${evidenceId}: diagnostics bridge`).not.toBeNull();
  expect(diagnostics?.missing, `${evidenceId}: missing keys`).toEqual([]);
  expect(diagnostics?.failedLoading, `${evidenceId}: failed bundles`).toEqual(
    [],
  );
  expect(diagnostics?.fallback, `${evidenceId}: fallback events`).toEqual([]);
}

async function expectStrictRussianSurface(
  page: Page,
  evidenceId: string,
): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("lang", "ru", {
    timeout: 30_000,
  });
  const visibleText = await page.locator("body").innerText();
  expect(visibleText, `${evidenceId}: replacement glyph`).not.toContain("�");
  expect(
    visibleText,
    `${evidenceId}: semantic translation key leaked into visible text`,
  ).not.toMatch(VISIBLE_TRANSLATION_KEY);
  await expectNoI18nDiagnostics(page, evidenceId);
}

test(
  "surface manifest has 165 unique rows and a deterministic evidence mapping",
  { tag: ["@release", "@regression"] },
  async ({ page }) => {
    await bootstrapToMainPage(page);

    expect(MANIFEST_ROWS).toHaveLength(165);
    expect(new Set(MANIFEST_ROWS.map((row) => row.testId)).size).toBe(165);

    const groups = MANIFEST_ROWS.map(evidenceGroupFor);
    expect(groups).toHaveLength(165);
    expect(groups.every((group) => group in EVIDENCE_GROUPS)).toBe(true);
  },
);

test(
  "Russian core routes and redirects render their localized route landmarks",
  { tag: ["@release", "@regression", "@api"] },
  async ({ page }) => {
    await bootstrapToMainPage(page);
    await selectRussian(page);

    for (const routeCase of CORE_ROUTE_CASES) {
      await test.step(`${routeCase.manifestId}: ${routeCase.path}`, async () => {
        if (routeCase.manifestId === "route-admin") {
          await authenticateManualSuperuser(page);
        }
        await page.goto(routeCase.path);
        await expect
          .poll(() => new URL(page.url()).pathname, {
            message: `${routeCase.manifestId}: final pathname`,
            timeout: 30_000,
          })
          .toMatch(routeCase.expectedPath);

        const landmark = page.locator(routeCase.readySelector).first();
        await expect(landmark).toBeVisible({ timeout: 30_000 });
        if (routeCase.expectedRussian) {
          await expect(landmark).toContainText(routeCase.expectedRussian);
        }
        if (routeCase.forbiddenEnglish) {
          await expect(landmark).not.toContainText(routeCase.forbiddenEnglish);
        }
        await expectStrictRussianSurface(page, routeCase.manifestId);
      });
    }
  },
);

test(
  "Russian public auth routes render in manual-auth mode",
  { tag: ["@release", "@regression", "@api"] },
  async ({ page }) => {
    await bootstrapToMainPage(page);
    await selectRussian(page);
    await mockAutoLoginDisabled(page);
    await page.context().clearCookies();

    const publicRoutes = [
      {
        manifestId: "route-login",
        path: "/login",
        heading: "Вход в Ketos",
        forbidden: "Sign in to Ketos",
      },
      {
        manifestId: "route-signup",
        path: "/signup",
        heading: "Регистрация в Ketos",
        forbidden: "Sign up to Ketos",
      },
      {
        manifestId: "route-admin-login",
        path: "/login/admin",
        heading: "Администратор",
        forbidden: "Administrator",
      },
    ];

    for (const routeCase of publicRoutes) {
      await test.step(`${routeCase.manifestId}: ${routeCase.path}`, async () => {
        await page.goto(routeCase.path);
        await expect
          .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
          .toBe(routeCase.path);
        const heading = page.getByText(routeCase.heading, { exact: true });
        await expect(heading).toBeVisible({ timeout: 30_000 });
        await expect(
          page.getByText(routeCase.forbidden, { exact: true }),
        ).toHaveCount(0);
        await expectStrictRussianSurface(page, routeCase.manifestId);
      });
    }
  },
);

test(
  "Russian flow and folder routes use real flow and folder identifiers",
  { tag: ["@release", "@workspace", "@regression", "@api"] },
  async ({ page }) => {
    const browserErrors: string[] = [];
    const routeNetworkEvents: string[] = [];
    const isRouteDependency = (url: string) =>
      /^\/api\/v1\/(?:all|flows|monitor\/builds)(?:\/|$)/.test(
        new URL(url).pathname,
      );
    page.on("request", (request) => {
      if (isRouteDependency(request.url())) {
        routeNetworkEvents.push(`request ${request.method()} ${request.url()}`);
      }
    });
    page.on("response", (response) => {
      if (isRouteDependency(response.url())) {
        routeNetworkEvents.push(
          `response ${response.status()} ${response.url()}`,
        );
      }
    });
    page.on("requestfailed", (request) => {
      if (isRouteDependency(request.url())) {
        routeNetworkEvents.push(
          `failed ${request.failure()?.errorText ?? "unknown"} ${request.url()}`,
        );
      }
    });
    page.on("pageerror", (error) => {
      browserErrors.push(error.stack ?? error.message);
    });
    page.on("console", (message) => {
      const text = message.text();
      if (
        message.type() === "error" &&
        !text.includes("React does not recognize the `%s` prop")
      ) {
        browserErrors.push(text);
      }
    });

    await bootstrapToMainPage(page);
    await selectRussian(page);
    await page.goto("/flows/");
    await expect(page.getByTestId("new-project-btn")).toBeVisible({
      timeout: 30_000,
    });

    const createdFlow = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/api/v1/flows/"),
    );
    await page.getByTestId("new-project-btn").click();
    const flowResponse = await createdFlow;
    expect(flowResponse.status()).toBe(201);
    const flow = (await flowResponse.json()) as {
      id: string;
      folder_id: string | null;
    };
    expect(flow.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(flow.folder_id).toMatch(/^[0-9a-f-]{36}$/i);
    await page.keyboard.press("Escape");

    const routeCases = [
      {
        manifestId: "route-flow-editor",
        path: `/flow/${flow.id}/`,
        expectedPath: new RegExp(`^/flow/${flow.id}/?$`),
        readySelector: "#react-flow-id",
      },
      {
        manifestId: "route-flow-folder-editor",
        path: `/flow/${flow.id}/folder/${flow.folder_id}/`,
        expectedPath: new RegExp(
          `^/flow/${flow.id}/folder/${flow.folder_id}/?$`,
        ),
        readySelector: "#react-flow-id",
      },
      {
        manifestId: "route-flow-view",
        path: `/flow/${flow.id}/view`,
        expectedPath: new RegExp(`^/flow/${flow.id}/view/?$`),
        readySelector: "#react-flow-id",
      },
      {
        manifestId: "route-components-folder",
        path: `/components/folder/${flow.folder_id}`,
        expectedPath: new RegExp(`^/components/folder/${flow.folder_id}/?$`),
        readySelector: '[data-testid="cards-wrapper"]',
      },
      {
        manifestId: "route-all-folder",
        path: `/all/folder/${flow.folder_id}`,
        expectedPath: new RegExp(`^/all/folder/${flow.folder_id}/?$`),
        readySelector: '[data-testid="cards-wrapper"]',
      },
      {
        manifestId: "route-mcp-folder",
        path: `/mcp/folder/${flow.folder_id}`,
        expectedPath: new RegExp(`^/mcp/folder/${flow.folder_id}/?$`),
        readySelector: '[data-testid="cards-wrapper"]',
      },
    ];

    for (const routeCase of routeCases) {
      await test.step(`${routeCase.manifestId}: ${routeCase.path}`, async () => {
        routeNetworkEvents.length = 0;
        browserErrors.length = 0;
        await page.goto(routeCase.path);
        await expect
          .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
          .toMatch(routeCase.expectedPath);
        await expect(
          page.locator(routeCase.readySelector).first(),
          `${routeCase.manifestId}: final URL ${page.url()}\nroute network\n${routeNetworkEvents.join("\n")}\nbrowser errors\n${browserErrors.join("\n")}`,
        ).toBeVisible({ timeout: 30_000 });
        if (routeCase.manifestId === "route-flow-view") {
          await expect(
            page.getByRole("region", {
              name: "(Только чтение)",
              exact: true,
            }),
            `${routeCase.manifestId}: localized read-only landmark`,
          ).toBeVisible();
          await expect(
            page.getByRole("region", { name: "(Read-Only)", exact: true }),
          ).toHaveCount(0);
        } else {
          await expect(
            page.getByRole("button", { name: "Уведомления", exact: true }),
            `${routeCase.manifestId}: localized application landmark`,
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: "Notifications", exact: true }),
          ).toHaveCount(0);
        }
        await expectStrictRussianSurface(page, routeCase.manifestId);
      });
    }
  },
);

test(
  "Russian preference survives reload and a new tab after a rapid language race",
  { tag: ["@release", "@regression", "@api"] },
  async ({ context, page }) => {
    await bootstrapToMainPage(page);
    await selectRussian(page);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru", {
      timeout: 30_000,
    });
    expect(
      await page.evaluate(
        (storageKey) => localStorage.getItem(storageKey),
        LANGUAGE_STORAGE_KEY,
      ),
    ).toBe("ru");

    const secondPage = await context.newPage();
    await secondPage.goto("/settings/language");
    await expect(secondPage.locator("html")).toHaveAttribute("lang", "ru", {
      timeout: 30_000,
    });
    await expect(
      secondPage.getByTestId("settings-language-heading"),
    ).toContainText("Язык");
    await expectNoI18nDiagnostics(secondPage, "preference-new-tab");
    await secondPage.close();

    await page.getByTestId("language-preference-select").click();
    await page.getByRole("option", { name: /^English/ }).click();

    await page.getByTestId("language-preference-select").click();
    await page.getByRole("option", { name: RUSSIAN_OPTION_NAME }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "ru", {
      timeout: 30_000,
    });
    expect(
      await page.evaluate(
        (storageKey) => localStorage.getItem(storageKey),
        LANGUAGE_STORAGE_KEY,
      ),
    ).toBe("ru");
    await expect
      .poll(
        async () => {
          const response = await page.request.get("/api/v1/users/whoami");
          if (!response.ok()) return `http-${response.status()}`;
          const profile = (await response.json()) as {
            preferred_locale?: string | null;
          };
          return profile.preferred_locale;
        },
        {
          message:
            "rapid language race must leave the persisted profile in Russian",
          timeout: 30_000,
        },
      )
      .toBe("ru");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru", {
      timeout: 30_000,
    });
    await expectStrictRussianSurface(page, "preference-race-final");
  },
);

test(
  "Russian template modal, notification tooltip, menus, and canvas overlays render localized text",
  { tag: ["@release", "@workspace", "@regression", "@api"] },
  async ({ page }) => {
    await bootstrapToMainPage(page);
    await selectRussian(page);
    await page.goto("/flows/");

    await page.getByTestId("notification_button").hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible({ timeout: 5_000 });
    await expect(tooltip).toContainText("Уведомления");

    await page.getByTestId("notification_button").click();
    await expect(
      page.getByTestId("notification-dropdown-content"),
    ).toBeVisible();
    await expect(
      page.getByTestId("notification-dropdown-content"),
    ).toContainText("Уведомления");
    await page.getByTestId("close-notifications-button").click();

    await page.getByTestId("user-profile-settings").click();
    await expect(page.getByTestId("menu_settings_button")).toContainText(
      "Настройки",
    );
    await page.keyboard.press("Escape");

    await openTemplatesModal(page);
    const templateModalTitle = page.getByTestId("modal-title");
    await expect(templateModalTitle).toBeVisible({ timeout: 30_000 });
    await expect(templateModalTitle).toContainText(/[А-Яа-яЁё]/);
    await page.keyboard.press("Escape");

    await expect(page.locator("#react-flow-id")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("canvas_controls_dropdown").click();
    await expect(page.getByTestId("zoom_in")).toContainText("Увеличить");
    await page.keyboard.press("Escape");

    await page.getByTestId("canvas_controls_dropdown_help").click();
    await expect(
      page.getByTestId("canvas_controls_dropdown_shortcuts"),
    ).toContainText("Сочетания клавиш");
    await expectStrictRussianSurface(page, "representative-overlays");
  },
);

test(
  "Russian public playground uses a deterministic Chat Input flow and passes visual accessibility gates",
  { tag: ["@release", "@workspace", "@regression", "@api"] },
  async ({ context, page }, testInfo) => {
    await bootstrapToMainPage(page);
    await selectRussian(page);
    await page.goto("/flows/");
    await expect(page.getByTestId(TID.newProjectBtn)).toBeVisible({
      timeout: TIMEOUTS.standard,
    });

    const createdFlow = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/api/v1/flows/"),
    );
    await page.getByTestId(TID.newProjectBtn).click();
    expect((await createdFlow).status()).toBe(201);

    const welcomeComponents = page.getByTestId(
      "flow-builder-welcome-faux-rail-components",
    );
    await expect(welcomeComponents).toBeVisible({
      timeout: TIMEOUTS.standard,
    });
    await welcomeComponents.click();
    await expect(page.getByTestId(TID.sidebarSearchInput)).toBeVisible({
      timeout: TIMEOUTS.standard,
    });

    await addComponentFromSidebar(page, {
      search: "chat input",
      testId: "input_outputВход чата",
      hoverAdd: true,
      addButtonSlug: "вход-чата",
    });
    await expect(page.getByTestId(TID.divGenericNode)).toHaveCount(1, {
      timeout: TIMEOUTS.standard,
    });

    await page.getByTestId(TID.publishButton).click();
    await expect(page.getByTestId(TID.shareablePlayground)).toBeVisible({
      timeout: TIMEOUTS.medium,
    });
    await page.getByTestId(TID.publishSwitch).click();
    await expect(page.getByTestId(TID.publishSwitch)).toBeChecked({
      checked: true,
    });
    await page.waitForTimeout(ANIMATIONS.publishTogglePropagation);

    const playgroundOpened = context.waitForEvent("page");
    await page.getByTestId(TID.shareablePlayground).click();
    const playgroundPage = await playgroundOpened;
    await playgroundPage.waitForLoadState("domcontentloaded");
    await expect
      .poll(() => new URL(playgroundPage.url()).pathname, {
        message: "route-playground: public route must remain mounted",
        timeout: TIMEOUTS.long,
      })
      .toMatch(/^\/playground\/[0-9a-f-]{36}\/?$/i);

    const input = playgroundPage.getByTestId(TID.inputChatPlayground);
    await expect(input).toBeVisible({ timeout: TIMEOUTS.long });
    await expect(input).toHaveAttribute("placeholder", "Отправить сообщение…");
    await expect(playgroundPage.locator("html")).toHaveAttribute("lang", "ru");

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await input.evaluate((element) => element === document.activeElement))
        break;
      await playgroundPage.keyboard.press("Tab");
    }
    await expect(input).toBeFocused();
    expect(
      await input.evaluate((element) => element.matches(":focus-visible")),
    ).toBe(true);

    const accessibilityTree = await playgroundPage
      .locator("body")
      .ariaSnapshot();
    expect(accessibilityTree).not.toMatch(
      /\b(?:Playground|New Chat|Send message|Chat sessions)\b/i,
    );
    const axeResults = await new AxeBuilder({ page: playgroundPage })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const seriousOrCritical = axeResults.violations
      .filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      )
      .map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map((node) => node.target),
      }));
    expect(
      await playgroundPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      "route-playground: unexpected document horizontal overflow",
    ).toBe(true);
    await expectNoI18nDiagnostics(playgroundPage, "route-playground");

    const screenshotPath = testInfo.outputPath("route-playground-ru.png");
    await playgroundPage.screenshot({
      path: screenshotPath,
      animations: "disabled",
      caret: "hide",
      fullPage: false,
    });
    await testInfo.attach("route-playground-ru", {
      path: screenshotPath,
      contentType: "image/png",
    });
    await playgroundPage.close();

    test.fail(
      seriousOrCritical.length > 0,
      "route-playground is fixture-unblocked but remains R7 BLOCKED until critical button-name and serious nested-interactive axe violations are fixed.",
    );
    expect(seriousOrCritical).toEqual([]);
  },
);

test(
  "BLOCKED feature-configured Task 18 surfaces",
  { tag: ["@release", "@regression"] },
  async ({ page }) => {
    test.skip(
      true,
      "Requires separate feature builds: ENABLE_CUSTOM_PARAM, ENABLE_EXTENSION_RELOAD, BASENAME, and wxo_deployments.",
    );
    await awaitBootstrapTest(page, { skipModal: true });
  },
);

test(
  "BLOCKED fixture-dependent Task 18 routes",
  { tag: ["@release", "@regression", "@api"] },
  async ({ page }) => {
    test.skip(true, "Requires a knowledge-base source with ingested chunks.");
    await awaitBootstrapTest(page, { skipModal: true });
  },
);

test(
  "BLOCKED exhaustive Task 18 state fixtures",
  { tag: ["@release", "@regression", "@api"] },
  async ({ page }) => {
    test.skip(
      true,
      "Requires deterministic fixtures for every loading/empty/error/permission/locked/version/notification/feature state.",
    );
    await awaitBootstrapTest(page, { skipModal: true });
  },
);

test(
  "BLOCKED exhaustive Task 18 modal and overlay openings",
  { tag: ["@release", "@regression", "@api"] },
  async ({ page }) => {
    test.skip(
      true,
      "Requires opening every remaining manifest modal, overlay, context menu, drawer, popover, and primitive with real prerequisites.",
    );
    await awaitBootstrapTest(page, { skipModal: true });
  },
);

test(
  "BLOCKED Task 18 manual reviewer and topology sign-off",
  { tag: ["@release", "@regression"] },
  async ({ page }) => {
    test.skip(
      true,
      "Requires human linguistic screenshot review and separate same-origin, separate-origin, and BASENAME deployments.",
    );
    await awaitBootstrapTest(page, { skipModal: true });
  },
);
