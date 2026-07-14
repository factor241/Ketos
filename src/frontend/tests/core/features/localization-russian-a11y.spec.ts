import AxeBuilder from "@axe-core/playwright";
import { expect, type KetosPage, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

type Theme = "light" | "dark";
type UiLocale = "ru" | "qps-ploc";

type OverflowViolation = {
  clientHeight: number;
  clientWidth: number;
  clippedText: boolean;
  rectLeft: number;
  rectRight: number;
  selector: string;
  scrollHeight: number;
  scrollWidth: number;
  text: string;
};

const VIEWPORT_WIDTHS = [1024, 1280, 1440] as const;
const THEMES: readonly Theme[] = ["light", "dark"];
const ZOOM_LEVELS = [100, 200] as const;
const VIEWPORT_HEIGHT = 900;

// React Flow intentionally manages a transformed, pannable surface wider than
// its viewport. No other application surface is exempt from the overflow gate.
const CANVAS_OVERFLOW_ALLOWLIST = [
  '[data-testid="react-flow-id"]',
  ".react-flow",
  ".react-flow__pane",
  ".react-flow__viewport",
].join(",");

const FORBIDDEN_RU_ACCESSIBILITY_FALLBACK =
  /\b(?:Settings|Language|Select language|Choose the display language|Recommended|Back|General|Flows|Components|Files|Knowledge|Messages|Shortcuts|Model Providers|DB Providers|Global Variables|MCP Servers|MCP Client)\b/i;

async function bootstrap(page: KetosPage, pseudo = false): Promise<void> {
  if (pseudo) {
    await page.goto("/?locale=qps-ploc");
    await awaitBootstrapTest(page, { skipGoto: true, skipModal: true });
  } else {
    await awaitBootstrapTest(page, { skipModal: true });
  }
}

async function openLanguageSettings(
  page: KetosPage,
  locale: UiLocale,
): Promise<void> {
  const suffix = locale === "qps-ploc" ? "?locale=qps-ploc" : "";
  await page.goto(`/settings/language${suffix}`);
  await expect(page.getByTestId("settings-language-page")).toBeVisible({
    timeout: 30_000,
  });
}

async function selectOption(
  page: KetosPage,
  optionName: RegExp,
  expectedLanguage: "en" | "ru",
): Promise<void> {
  const profileUpdate =
    (await page.locator("html").getAttribute("lang")) === expectedLanguage
      ? null
      : waitForLocaleProfileUpdate(page);
  await page.getByTestId("language-preference-select").click();
  await page.getByRole("option", { name: optionName }).click();
  if (profileUpdate) await expectSuccessfulLocaleProfileUpdate(profileUpdate);
  await expect(page.locator("html")).toHaveAttribute("lang", expectedLanguage);
}

function waitForLocaleProfileUpdate(page: KetosPage) {
  return page.waitForResponse(
    (response) => {
      const { pathname } = new URL(response.url());
      return (
        response.request().method() === "PATCH" &&
        /^\/api\/v1\/users\/[^/]+$/.test(pathname)
      );
    },
    { timeout: 30_000 },
  );
}

async function expectSuccessfulLocaleProfileUpdate(
  responsePromise: ReturnType<typeof waitForLocaleProfileUpdate>,
): Promise<void> {
  const response = await responsePromise;
  expect(
    response.ok(),
    `Locale profile update failed with ${response.status()} at ${response.url()}`,
  ).toBe(true);
}

async function ensureRussian(page: KetosPage): Promise<void> {
  await openLanguageSettings(page, "ru");
  if ((await page.locator("html").getAttribute("lang")) !== "ru") {
    await selectOption(page, /^Русский$/, "ru");
  }
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByTestId("settings-language-heading")).toHaveText(
    "Язык",
  );

  // Re-enter the route so visual captures never contain the transient saved
  // status left by the language preference mutation.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("settings-language-page")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
}

async function ensurePseudo(page: KetosPage): Promise<void> {
  await openLanguageSettings(page, "qps-ploc");
  await expect(page.locator("html")).toHaveAttribute("lang", "qps-ploc");
  await expectNoI18nDiagnostics(page);
  await expect(page.getByTestId("settings-language-heading")).toHaveText(
    /^［.+］$/,
  );
}

async function focusLanguageSelectWithKeyboard(
  page: KetosPage,
): Promise<void> {
  await page.getByTestId("settings-language-heading").click();
  const select = page.getByTestId("language-preference-select");

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.keyboard.press("Tab");
    if (
      await select.evaluate((element) => element === document.activeElement)
    ) {
      break;
    }
  }

  await expect(select).toBeFocused();
  expect(
    await select.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
}

async function setTheme(page: KetosPage, theme: Theme): Promise<void> {
  await page.evaluate((nextTheme) => {
    localStorage.setItem("themePreference", nextTheme);
    localStorage.setItem("isDark", String(nextTheme === "dark"));
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("settings-language-page")).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(() =>
      page.locator("body").evaluate((body) => body.classList.contains("dark")),
    )
    .toBe(theme === "dark");
}

async function setViewportAndZoom(
  page: KetosPage,
  physicalWidth: (typeof VIEWPORT_WIDTHS)[number],
  percent: 100 | 200,
): Promise<void> {
  const scale = percent / 100;
  const cssWidth = Math.floor(physicalWidth / scale);
  const cssHeight = Math.floor(VIEWPORT_HEIGHT / scale);
  await page.setViewportSize({ width: cssWidth, height: cssHeight });
  await page.evaluate(async () => {
    // Browser zoom changes the effective CSS viewport. Keep CSS zoom disabled:
    // scaling the already-laid-out page would hide overflow instead of testing
    // responsive reflow.
    document.documentElement.style.removeProperty("zoom");
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  await expect
    .poll(() => page.evaluate(() => window.innerWidth))
    .toBe(cssWidth);
  await expect
    .poll(() => page.evaluate(() => window.innerHeight))
    .toBe(cssHeight);
}

async function scanUnexpectedOverflow(
  page: KetosPage,
): Promise<OverflowViolation[]> {
  return page.evaluate((canvasAllowlist) => {
    const selectorFor = (element: Element): string => {
      const testId = element.getAttribute("data-testid");
      if (testId) return `[data-testid="${testId}"]`;
      const id = element.getAttribute("id");
      if (id) return `#${id}`;
      const classes = Array.from(element.classList).slice(0, 3).join(".");
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`;
    };

    const root = document.documentElement;
    const rootOverflow: OverflowViolation[] =
      root.scrollWidth > root.clientWidth + 1
        ? [
            {
              clientHeight: root.clientHeight,
              clientWidth: root.clientWidth,
              clippedText: false,
              rectLeft: 0,
              rectRight: root.scrollWidth,
              selector: "html",
              scrollHeight: root.scrollHeight,
              scrollWidth: root.scrollWidth,
              text: "document horizontal overflow",
            },
          ]
        : [];

    const elementOverflow = Array.from(
      document.body.querySelectorAll<HTMLElement>("*"),
    )
      .filter((element) => {
        if (element.closest(canvasAllowlist)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const visuallyHidden =
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0" ||
          style.clip === "rect(0px, 0px, 0px, 0px)" ||
          rect.width <= 1 ||
          rect.height <= 1;
        if (visuallyHidden) return false;

        const horizontalOverflow =
          element.scrollWidth > element.clientWidth + 1;
        const crossesViewport =
          (rect.left < -1 && rect.right > 0) ||
          (rect.right > window.innerWidth + 1 && rect.left < window.innerWidth);
        const verticalOverflow =
          element.scrollHeight > element.clientHeight + 1;
        const hasOwnText = Array.from(element.childNodes).some(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            Boolean(node.textContent?.trim()),
        );
        const clippedText =
          hasOwnText &&
          ((horizontalOverflow &&
            ["clip", "hidden"].includes(style.overflowX)) ||
            (verticalOverflow && ["clip", "hidden"].includes(style.overflowY)));

        return horizontalOverflow || clippedText || crossesViewport;
      })
      .slice(0, 30)
      .map((element) => {
        const style = getComputedStyle(element);
        const hasOwnText = Array.from(element.childNodes).some(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            Boolean(node.textContent?.trim()),
        );
        const clippedText =
          hasOwnText &&
          ((element.scrollWidth > element.clientWidth + 1 &&
            ["clip", "hidden"].includes(style.overflowX)) ||
            (element.scrollHeight > element.clientHeight + 1 &&
              ["clip", "hidden"].includes(style.overflowY)));
        return {
          clientHeight: element.clientHeight,
          clientWidth: element.clientWidth,
          clippedText,
          rectLeft: Math.round(element.getBoundingClientRect().left),
          rectRight: Math.round(element.getBoundingClientRect().right),
          selector: selectorFor(element),
          scrollHeight: element.scrollHeight,
          scrollWidth: element.scrollWidth,
          text: (element.textContent ?? "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 120),
        };
      });
    return [...rootOverflow, ...elementOverflow].slice(0, 30);
  }, CANVAS_OVERFLOW_ALLOWLIST);
}

async function expectNoI18nDiagnostics(page: KetosPage): Promise<void> {
  const diagnostics = await page.evaluate(() =>
    window.__KETOS_I18N_DIAGNOSTICS__?.snapshot(),
  );
  expect(diagnostics).toBeDefined();
  expect(diagnostics?.missing).toEqual([]);
  expect(diagnostics?.failedLoading).toEqual([]);
  expect(diagnostics?.fallback).toEqual([]);
}

async function expectNoSeriousAxeViolations(page: KetosPage): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('[data-testid="settings-language-page"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const seriousOrCritical = results.violations
    .filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    )
    .map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target),
    }));
  expect(seriousOrCritical).toEqual([]);
}

async function expectCyrillicGlyphCoverage(page: KetosPage): Promise<void> {
  const glyphState = await page
    .getByTestId("settings-language-page")
    .evaluate(async (surface) => {
      await document.fonts.ready;
      const heading = surface.querySelector("h2");
      if (!heading) return null;
      const style = getComputedStyle(heading);
      const cyrillicSample = "Язык интерфейса: Сценарий, Компонент, Настройки";
      return {
        bodyText: surface.textContent ?? "",
        fontFamily: style.fontFamily,
        fontLoaded: document.fonts.check(
          `${style.fontSize} ${style.fontFamily}`,
          cyrillicSample,
        ),
      };
    });

  expect(glyphState).not.toBeNull();
  expect(glyphState?.fontFamily).toContain("Inter");
  expect(glyphState?.fontLoaded).toBe(true);
  expect(glyphState?.bodyText).not.toMatch(/[�□]/u);
}

async function runVisualMatrix(
  page: KetosPage,
  locale: UiLocale,
): Promise<void> {
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);

    for (const width of VIEWPORT_WIDTHS) {
      for (const zoom of ZOOM_LEVELS) {
        await setViewportAndZoom(page, width, zoom);
        expect(
          await scanUnexpectedOverflow(page),
          `${locale}/${theme}/${width}px/${zoom}% has unexpected overflow or clipped text`,
        ).toEqual([]);
        await expect(page).toHaveScreenshot(
          `localization-${locale}-${theme}-${width}-${zoom}.png`,
          {
            animations: "disabled",
            caret: "hide",
            fullPage: false,
            maxDiffPixelRatio: 0.01,
          },
        );
      }
    }
  }
  await setViewportAndZoom(page, 1440, 100);
}

test.describe("Russian localization visual and accessibility gates", () => {
  test.describe.configure({ mode: "serial" });

  test(
    "selects Russian by keyboard and exposes a clean Russian accessibility surface",
    { tag: ["@release", "@regression"] },
    async ({ page }) => {
      await bootstrap(page);
      await openLanguageSettings(page, "ru");

      // Establish a deterministic starting point, then perform the required RU
      // selection using keyboard input only.
      await selectOption(page, /^English/, "en");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await focusLanguageSelectWithKeyboard(page);
      await page.keyboard.press("Space");
      const russianOption = page.getByRole("option", { name: "Русский" });
      await expect(russianOption).toBeVisible();
      const profileUpdate = waitForLocaleProfileUpdate(page);
      await russianOption.press("Enter");
      await expectSuccessfulLocaleProfileUpdate(profileUpdate);

      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
      await expect(page.getByRole("heading", { name: "Язык" })).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Выберите язык" }),
      ).toBeVisible();
      await expect(
        page.getByTestId("language-preference-select"),
      ).toContainText("Русский");

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("settings-language-page")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator("html")).toHaveAttribute("lang", "ru");

      const accessibilityTree = await page.locator("body").ariaSnapshot();
      const accessibilityNames = accessibilityTree
        .split("\n")
        // Route values are machine identifiers and intentionally remain English.
        .filter((line) => !line.trimStart().startsWith("- /url:"))
        .join("\n");
      expect(accessibilityNames).not.toMatch(
        FORBIDDEN_RU_ACCESSIBILITY_FALLBACK,
      );
      await expectNoI18nDiagnostics(page);
      await expectCyrillicGlyphCoverage(page);
      await expectNoSeriousAxeViolations(page);
      expect(await scanUnexpectedOverflow(page)).toEqual([]);
    },
  );

  test(
    "keeps qps-ploc hidden while exposing its expanded catalog through the dev query override",
    { tag: ["@release", "@regression"] },
    async ({ page }) => {
      await bootstrap(page, true);
      await ensurePseudo(page);

      await page.getByTestId("language-preference-select").click();
      await expect(
        page.getByRole("option", { name: /Pseudo \(test only\)/ }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");

      await expect(
        page.getByTestId("settings-language-heading"),
      ).toHaveAccessibleName(/^［.+］$/);
      await expect(
        page.getByRole("combobox", { name: /^［.+］$/ }),
      ).toBeVisible();
      await expectNoI18nDiagnostics(page);
      await expectNoSeriousAxeViolations(page);
      expect(await scanUnexpectedOverflow(page)).toEqual([]);
    },
  );

  test(
    "matches the Russian width, theme and 200 percent zoom visual matrix",
    { tag: ["@release", "@regression"] },
    async ({ page }) => {
      test.slow();
      await bootstrap(page);
      await ensureRussian(page);
      await runVisualMatrix(page, "ru");
    },
  );

  test(
    "matches the pseudo width, theme and 200 percent zoom visual matrix",
    { tag: ["@release", "@regression"] },
    async ({ page }) => {
      test.slow();
      await bootstrap(page, true);
      await ensurePseudo(page);
      await runVisualMatrix(page, "qps-ploc");
    },
  );
});
