import type { Page } from "@playwright/test";
import { awaitBootstrapTest } from "../await-bootstrap-test";
import { TID } from "../constants/testIds";
import { TIMEOUTS } from "../constants/timeouts";

/**
 * Bootstrap the app and open a blank flow.
 *
 * Replaces the 3-line ritual that appears in 50+ spec files:
 *   await awaitBootstrapTest(page);
 *   await page.waitForSelector('[data-testid="blank-flow"]', { timeout: 30000 });
 *   await page.getByTestId("blank-flow").click();
 */
export async function openBlankFlow(page: Page): Promise<void> {
  await awaitBootstrapTest(page);
  await page.waitForSelector(`[data-testid="${TID.blankFlow}"]`, {
    timeout: TIMEOUTS.standard,
  });
  await page.getByTestId(TID.blankFlow).click();

  await page.locator("#react-flow-id").waitFor({
    state: "visible",
    timeout: TIMEOUTS.standard,
  });

  const sidebarSearch = page.getByTestId("sidebar-search-input");
  if (!(await sidebarSearch.isVisible())) {
    const sidebarTrigger = page.locator(
      '[data-testid="sidebar-trigger-search"]:visible',
    );
    const readySurface = await Promise.race([
      sidebarSearch
        .waitFor({ state: "visible", timeout: TIMEOUTS.standard })
        .then(() => "search" as const),
      sidebarTrigger
        .waitFor({ state: "visible", timeout: TIMEOUTS.standard })
        .then(() => "trigger" as const),
    ]);
    if (readySurface === "trigger") {
      await sidebarTrigger.click();
    }
  }
  await sidebarSearch.waitFor({
    state: "visible",
    timeout: TIMEOUTS.standard,
  });
}
