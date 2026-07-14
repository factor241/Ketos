import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { mockAutoLoginDisabled } from "../../utils/auth/mock-auto-login-disabled";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

async function waitForProfilePatch(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /^\/api\/v1\/users\/[^/]+$/.test(new URL(response.url()).pathname),
    { timeout: 30_000 },
  );
}

async function selectWithPointer(
  page: Page,
  optionName: RegExp,
  expectedLocale: "en" | "ru",
): Promise<void> {
  if ((await page.locator("html").getAttribute("lang")) === expectedLocale) {
    return;
  }
  const profilePatch = waitForProfilePatch(page);
  await page.getByTestId("language-preference-select").click();
  await page.getByRole("option", { name: optionName }).click();
  expect((await profilePatch).ok()).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("lang", expectedLocale);
}

test.describe("dedicated Language settings acceptance", () => {
  test.describe.configure({ mode: "serial" });

  test(
    "sidebar, keyboard focus, authenticated profile, reload, and new tab preserve the final Russian choice",
    { tag: ["@release", "@regression", "@api"] },
    async ({ context, page }) => {
      await awaitBootstrapTest(page, { skipModal: true });
      await page.goto("/settings/mcp-client");

      const languageNavigation = page.getByTestId("sidebar-nav-language");
      await expect(languageNavigation).toBeVisible();
      await languageNavigation.focus();
      await expect(languageNavigation).toBeFocused();
      await languageNavigation.press("Enter");
      await expect(page).toHaveURL(/\/settings\/language$/);
      await expect(page.getByTestId("settings-language-page")).toBeVisible();

      await selectWithPointer(page, /^English/, "en");
      const select = page.getByTestId("language-preference-select");
      await select.focus();
      await expect(select).toBeFocused();
      await select.press("Space");
      const russianProfilePatch = waitForProfilePatch(page);
      await page
        .getByRole("option", { name: "Русский", exact: true })
        .press("Enter");
      expect((await russianProfilePatch).ok()).toBe(true);
      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
      await expect(page.getByRole("heading", { name: "Язык" })).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Выберите язык" }),
      ).toBeVisible();

      // Exercise ru -> en -> ru without waiting for a page reload. The hook
      // serializes profile PATCH transport, so the server must end on the last
      // choice even if an earlier response is slow.
      await selectWithPointer(page, /^English/, "en");
      await selectWithPointer(page, /^Русский$/, "ru");
      await expect
        .poll(async () => {
          const response = await page.request.get("/api/v1/users/whoami");
          if (!response.ok()) return `http-${response.status()}`;
          return (
            (await response.json()) as { preferred_locale?: string | null }
          ).preferred_locale;
        })
        .toBe("ru");

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
      expect(
        await page.evaluate(() => localStorage.getItem("languagePreference")),
      ).toBe("ru");

      const secondPage = await context.newPage();
      await secondPage.goto("/settings/language");
      await expect(secondPage.locator("html")).toHaveAttribute("lang", "ru");
      await expect(
        secondPage.getByTestId("settings-language-heading"),
      ).toHaveText("Язык");
      await secondPage.close();
    },
  );

  test(
    "unauthenticated shell restores the last-used local cache",
    { tag: ["@release", "@regression"] },
    async ({ page }) => {
      await mockAutoLoginDisabled(page);
      await page.addInitScript(() => {
        localStorage.setItem("languagePreference", "ru");
      });
      await page.goto("/login");
      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    },
  );
});
