import { type Page } from "@playwright/test";

export const navigateSettingsPages = async (
  page: Page,
  pageName: string,
  settingsMenuName: string,
) => {
  if (!pageName) {
    return;
  }
  const accountMenu = page
    .locator(
      '[data-testid="user_menu_button"], [data-testid="user-profile-settings"]',
    )
    .first();
  await accountMenu.click();
  const settingsItem = page.getByTestId("menu_settings_button");
  if (await settingsItem.isVisible()) {
    await settingsItem.click();
  } else {
    await page.getByText(`${pageName}`).first().click();
  }

  if (settingsMenuName) {
    await page.getByText(`${settingsMenuName}`).first().click();
    await page.waitForSelector('[data-testid="settings_menu_header"]', {
      timeout: 5000,
    });
    await page.waitForTimeout(500);
  }
};
