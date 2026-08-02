import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { addNewUserAndLogin } from "../../utils/add-new-user-and-loggin";
import { openTemplatesModal } from "../../utils/flow/new-project-flow";

async function verifyCurrentOnboarding(page: Page) {
  await page.goto("/");
  await page
    .locator('[data-testid="project-sidebar"], [data-testid="mainpage_title"]')
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });

  // The retired community-link progress widget must not leak into the
  // unified Board workspace. Onboarding now continues through the welcome
  // overlay and its templates picker.
  await expect(page.getByTestId("get_started_progress_title")).toHaveCount(0);
  await expect(page.getByTestId("get_started_progress_percentage")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("empty_page_github_button")).toHaveCount(0);
  await expect(page.getByTestId("empty_page_discord_button")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /github|discord/i })).toHaveCount(
    0,
  );

  await openTemplatesModal(page, { modalTimeout: 60_000 });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("modal-title")).toBeVisible();
  await expect(dialog.getByTestId("blank-flow")).toBeVisible();
}

test(
  "admin user continues through the current unified workspace onboarding",
  { tag: ["@release", "@api", "@workspace"] },
  async ({ page }) => {
    await verifyCurrentOnboarding(page);
  },
);

test(
  "normal user continues through the current unified workspace onboarding",
  { tag: ["@release", "@api", "@workspace"] },
  async ({ page }) => {
    await addNewUserAndLogin(page);
    await verifyCurrentOnboarding(page);
  },
);
