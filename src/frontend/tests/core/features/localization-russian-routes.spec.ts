import type { Page } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

type RouteSmokeCase = {
  manifestId: string;
  path: string;
  readyTestId: string;
  expectedRussian: string;
  forbiddenEnglish: string;
};

type I18nDiagnosticsSnapshot = {
  missing: Array<{ locale: string; key: string }>;
  failedLoading: Array<{ locale: string; key: string }>;
  fallback: Array<{ locale: string; key: string }>;
};

const ROUTE_SMOKE_CASES: RouteSmokeCase[] = [
  {
    manifestId: "route-flows",
    path: "/flows/",
    readyTestId: "flows-btn",
    expectedRussian: "Сценарии",
    forbiddenEnglish: "Flows",
  },
  {
    manifestId: "route-mcp",
    path: "/mcp/",
    readyTestId: "mcp-btn",
    expectedRussian: "MCP-сервер",
    forbiddenEnglish: "MCP Server",
  },
  {
    manifestId: "route-files",
    path: "/assets/files",
    readyTestId: "mainpage_title",
    expectedRussian: "Файлы",
    forbiddenEnglish: "Files",
  },
  {
    manifestId: "route-settings-language",
    path: "/settings/language",
    readyTestId: "settings-language-heading",
    expectedRussian: "Язык",
    forbiddenEnglish: "Language",
  },
  {
    manifestId: "route-settings-global-variables",
    path: "/settings/global-variables",
    readyTestId: "settings_menu_header",
    expectedRussian: "Глобальные переменные",
    forbiddenEnglish: "Global Variables",
  },
];

const VISIBLE_TRANSLATION_KEY =
  /\b(?:apiErrors|common|errors|files|globalVars|mainPage|nav|settings)\.[A-Za-z][\w.-]*\b/;

function getManifestRouteIds(): Set<string> {
  const manifestPath = resolve(
    __dirname,
    "../../../../../docs/localization/ru/surface-manifest.csv",
  );
  const rows = readFileSync(manifestPath, "utf8").split(/\r?\n/).slice(1);

  return new Set(
    rows
      .map((row) => row.split(","))
      .filter((columns) => columns[0] === "route")
      .map((columns) => columns[8])
      .filter(Boolean),
  );
}

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
    await page.getByRole("option", { name: "Русский", exact: true }).click();
    expect((await savedPreference).ok()).toBe(true);
    await expect(page.getByTestId("language-preference-select")).toContainText(
      "Русский",
    );
  }

  await expect(page.locator("html")).toHaveAttribute("lang", "ru", {
    timeout: 30_000,
  });
}

async function expectNoI18nDiagnostics(
  page: Page,
  routeName: string,
): Promise<void> {
  const diagnostics = await page.evaluate<I18nDiagnosticsSnapshot | null>(
    () => window.__KETOS_I18N_DIAGNOSTICS__?.snapshot() ?? null,
  );

  expect(
    diagnostics,
    `${routeName}: diagnostics bridge is available`,
  ).not.toBeNull();
  expect(diagnostics?.missing, `${routeName}: missing keys`).toEqual([]);
  expect(diagnostics?.failedLoading, `${routeName}: failed bundles`).toEqual(
    [],
  );
  expect(diagnostics?.fallback, `${routeName}: English fallbacks`).toEqual([]);
}

test(
  "Russian route smoke stays mapped to the surface manifest without runtime fallbacks",
  { tag: ["@release", "@regression", "@api"] },
  async ({ page }) => {
    await bootstrapToMainPage(page);
    await selectRussian(page);

    const manifestRouteIds = getManifestRouteIds();
    expect(
      ROUTE_SMOKE_CASES.filter(
        ({ manifestId }) => !manifestRouteIds.has(manifestId),
      ).map(({ manifestId }) => manifestId),
      "every runtime route smoke must reference a surface-manifest row",
    ).toEqual([]);

    for (const routeCase of ROUTE_SMOKE_CASES) {
      await test.step(`${routeCase.manifestId}: ${routeCase.path}`, async () => {
        await page.goto(routeCase.path);
        await expect(page.locator("html")).toHaveAttribute("lang", "ru", {
          timeout: 30_000,
        });

        const routeLandmark = page.getByTestId(routeCase.readyTestId).first();
        await expect(routeLandmark).toBeVisible({ timeout: 30_000 });
        await expect(routeLandmark).toContainText(routeCase.expectedRussian);
        await expect(routeLandmark).not.toContainText(
          routeCase.forbiddenEnglish,
        );

        const visibleText = await page.locator("body").innerText();
        expect(
          visibleText,
          `${routeCase.manifestId}: replacement glyph`,
        ).not.toContain("�");
        expect(
          visibleText,
          `${routeCase.manifestId}: semantic translation key leaked into the DOM`,
        ).not.toMatch(VISIBLE_TRANSLATION_KEY);
        await expectNoI18nDiagnostics(page, routeCase.manifestId);
      });
    }
  },
);
