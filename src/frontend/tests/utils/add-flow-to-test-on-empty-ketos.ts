import type { Page } from "@playwright/test";

import { TEXTS } from "../utils/constants/texts";

/**
 * Bootstraps a fresh Ketos install by creating a "Basic Prompting" flow
 * from the templates modal so subsequent assertions have a valid project
 * sidebar to work against. The empty-page CTA opens the templates modal
 * directly (it bypasses the welcome overlay used by the in-app "New Flow"
 * button), but a flaky runner can still race the modal mount — we wait
 * defensively for either the modal or the welcome overlay before
 * proceeding.
 */
export const addFlowToTestOnEmptyKetos = async (page: Page) => {
  await page.getByTestId("new_project_btn_empty_page").click();

  const modalSelector = '[data-testid="modal-title"]';
  const welcomeSelector = '[data-testid="flow-builder-welcome-panel"]';

  await Promise.race([
    page.waitForSelector(modalSelector, { timeout: 30000 }),
    page.waitForSelector(welcomeSelector, { timeout: 30000 }),
  ]);

  if ((await page.locator(welcomeSelector).count()) > 0) {
    await page.getByTestId("flow-builder-welcome-browse-more").click();
    await page.waitForSelector(modalSelector, { timeout: 30000 });
  }

  await page.getByTestId("side_nav_options_all-templates").click();
  await page
    .getByRole("heading", {
      name: new RegExp(
        `^(?:${TEXTS.templateBasicPrompting}|Основы работы с промптами)$`,
      ),
    })
    .click();

  // Template selection navigates into the new flow. Return explicitly to the
  // projects route so bootstrap callers do not depend on whichever Chevron
  // icon happens to be first after sidebar/header redesigns.
  await page.goto("/flows/");
  await page.getByTestId("mainpage_title").waitFor({ state: "visible" });
};
