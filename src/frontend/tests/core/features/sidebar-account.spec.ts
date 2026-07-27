import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

const THEME_PREFERENCE_KEY = "ketos-theme-preference";
const TEST_SETUP_SESSION_KEY = "sidebar-account-test-setup";

test.describe("Project sidebar account", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ sessionKey, themePreferenceKey }) => {
        if (sessionStorage.getItem(sessionKey)) return;

        localStorage.setItem("ketos-language-preference", "en");
        localStorage.setItem(themePreferenceKey, "light");
        localStorage.setItem("ketos-is-dark", "false");
        sessionStorage.setItem(sessionKey, "true");
      },
      {
        sessionKey: TEST_SETUP_SESSION_KEY,
        themePreferenceKey: THEME_PREFERENCE_KEY,
      },
    );
  });

  test(
    "shows the account card in the project sidebar and closes its upward menu with Escape",
    { tag: ["@release", "@workspace", "@api"] },
    async ({ page }) => {
      await awaitBootstrapTest(page, { skipModal: true });

      const appHeader = page.getByTestId("app-header");
      const accountMenuButton = page.getByTestId("user_menu_button");

      await expect(appHeader).toBeVisible();
      await expect(appHeader.getByTestId("user_menu_button")).toHaveCount(0);
      await expect(accountMenuButton).toHaveCount(1);
      await expect(accountMenuButton).toBeVisible();
      await expect(accountMenuButton).toContainText("Ketos workspace");

      await accountMenuButton.click();

      const accountMenu = page.getByRole("menu");
      await expect(accountMenu).toBeVisible();
      await expect(accountMenu).toHaveAttribute("data-side", "top");
      await expect(page.getByTestId("menu_settings_button")).toBeVisible();

      await page.keyboard.press("Escape");

      await expect(accountMenu).toBeHidden();
      await expect(accountMenuButton).toHaveAttribute("aria-expanded", "false");
      await expect(accountMenuButton).toBeFocused();
    },
  );

  test(
    "labels theme choices and persists the selected body theme after reload",
    { tag: ["@release", "@workspace"] },
    async ({ page }) => {
      await awaitBootstrapTest(page, { skipModal: true });
      await page.getByTestId("user_menu_button").click();

      const lightButton = page.getByTestId("menu_light_button");
      const darkButton = page.getByTestId("menu_dark_button");
      const systemButton = page.getByTestId("menu_system_button");

      await expect(lightButton).toHaveText("Light");
      await expect(darkButton).toHaveText("Dark");
      await expect(systemButton).toHaveText("System");
      await expect(lightButton).toHaveAttribute("aria-checked", "true");

      await darkButton.click();

      await expect(page.locator("body")).toHaveClass(/\bdark\b/);
      await expect(darkButton).toHaveAttribute("aria-checked", "true");
      await expect
        .poll(() =>
          page.evaluate((themePreferenceKey) => {
            return localStorage.getItem(themePreferenceKey);
          }, THEME_PREFERENCE_KEY),
        )
        .toBe("dark");

      await page.reload();
      await page.getByTestId("mainpage_title").waitFor({ state: "visible" });

      await expect(page.locator("body")).toHaveClass(/\bdark\b/);
      await expect
        .poll(() =>
          page.evaluate((themePreferenceKey) => {
            return localStorage.getItem(themePreferenceKey);
          }, THEME_PREFERENCE_KEY),
        )
        .toBe("dark");

      await page.getByTestId("user_menu_button").click();
      await expect(page.getByTestId("menu_dark_button")).toHaveAttribute(
        "aria-checked",
        "true",
      );

      await page.getByTestId("menu_light_button").click();
      await expect(page.locator("body")).not.toHaveClass(/\bdark\b/);
    },
  );

  test(
    "reacts to system color-scheme changes while System is selected",
    { tag: ["@release", "@workspace"] },
    async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await awaitBootstrapTest(page, { skipModal: true });
      await page.getByTestId("user_menu_button").click();

      const systemButton = page.getByTestId("menu_system_button");
      await systemButton.click();

      await expect(systemButton).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("body")).not.toHaveClass(/\bdark\b/);
      await expect
        .poll(() =>
          page.evaluate((themePreferenceKey) => {
            return localStorage.getItem(themePreferenceKey);
          }, THEME_PREFERENCE_KEY),
        )
        .toBe("system");

      await page.emulateMedia({ colorScheme: "dark" });
      await expect(page.locator("body")).toHaveClass(/\bdark\b/);

      await page.emulateMedia({ colorScheme: "light" });
      await expect(page.locator("body")).not.toHaveClass(/\bdark\b/);
    },
  );

  test(
    "supports keyboard theme selection and returns focus after Escape",
    { tag: ["@release", "@workspace"] },
    async ({ page }) => {
      await awaitBootstrapTest(page, { skipModal: true });

      const accountMenuButton = page.getByTestId("user_menu_button");
      const settingsButton = page.getByTestId("menu_settings_button");
      const lightButton = page.getByTestId("menu_light_button");
      const darkButton = page.getByTestId("menu_dark_button");

      await accountMenuButton.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toBeVisible();

      await expect(settingsButton).toBeFocused();
      await page.keyboard.press("l");
      await expect(lightButton).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(darkButton).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(darkButton).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("body")).toHaveClass(/\bdark\b/);

      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toBeHidden();
      await expect(accountMenuButton).toBeFocused();
    },
  );

  test(
    "navigates to Settings from the sidebar account menu",
    { tag: ["@release", "@workspace", "@api"] },
    async ({ page }) => {
      await awaitBootstrapTest(page, { skipModal: true });
      const accountMenuButton = page.getByTestId("user_menu_button");
      await accountMenuButton.focus();
      await page.keyboard.press("Enter");

      const settingsButton = page.getByTestId("menu_settings_button");
      await expect(page.getByRole("menu")).toBeVisible();
      await expect(settingsButton).toBeFocused();

      await page.keyboard.press("Enter");
      await page.waitForURL(/\/settings\/(?:general|global-variables)$/);

      await expect(page.getByTestId("mainpage_title")).toHaveText("Settings");
      await expect(page.getByTestId("settings_menu_header")).toBeVisible();
    },
  );

  test(
    "opens the account card from the mobile project sidebar",
    { tag: ["@release", "@workspace"] },
    async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await awaitBootstrapTest(page, { skipModal: true });

      const accountMenuButton = page.getByTestId("user_menu_button");
      const sidebarTrigger = page
        .getByTestId("project-page")
        .locator('[data-sidebar="trigger"]');

      await expect(accountMenuButton).not.toBeInViewport();
      await expect(sidebarTrigger).toBeVisible();

      await sidebarTrigger.click();

      await expect(accountMenuButton).toBeInViewport();
      await expect(accountMenuButton).toContainText("Ketos workspace");
      await accountMenuButton.click();

      const accountMenu = page.getByRole("menu");
      await expect(accountMenu).toBeVisible();
      await expect(accountMenu).toHaveAttribute("data-side", "top");

      await page.keyboard.press("Escape");
      await expect(accountMenu).toBeHidden();
    },
  );
});
