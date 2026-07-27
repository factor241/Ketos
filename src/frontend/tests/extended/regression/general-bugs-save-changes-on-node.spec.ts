import { type Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { adjustScreenView } from "../../utils/adjust-screen-view";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";
import { TEXTS } from "../../utils/constants/texts";
import { enableOptionalComponents } from "../../utils/enable-optional-components";
import { renameFlow } from "../../utils/rename-flow";

async function verifyTextareaValue(page: Page, value: string) {
  await page
    .getByTestId("textarea_str_input_value")
    .waitFor({ state: "visible" });
  const flowId = new URL(page.url()).pathname.split("/")[2];
  const savePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === `/api/v1/flows/${flowId}` &&
      response.ok(),
  );

  await page.getByTestId("textarea_str_input_value").fill(value);
  await expect(page.getByTestId("textarea_str_input_value")).toHaveValue(value);
  await page.getByTestId("app-header").first().click();
  await savePromise;

  await page.reload();
  await expect(page.getByTestId("textarea_str_input_value")).toHaveValue(
    value,
    { timeout: 10000 },
  );
}

test(
  "any changes on the node must be saved on user interaction",
  { tag: ["@release", "@components"] },
  async ({ page }) => {
    const randomValues = Array.from({ length: 4 }, () =>
      Math.random().toString(36).substring(2, 8),
    );

    const randomFlowName = Math.random().toString(36).substring(2, 8);

    await awaitBootstrapTest(page);
    await page.getByTestId("blank-flow").click();

    await enableOptionalComponents(page);

    await adjustScreenView(page);

    await renameFlow(page, { flowName: randomFlowName });

    await page.getByTestId("sidebar-search-input").click();
    await page.getByTestId("sidebar-search-input").fill(TEXTS.searchTextOutput);

    await page
      .getByTestId("input_outputText Output")
      .waitFor({ state: "visible" });
    await page.getByTestId("add-component-button-text-output").click();

    await page.waitForSelector('[data-testid="title-Text Output"]', {
      timeout: 5000,
      state: "visible",
    });

    await page.getByTestId("app-header").first().click();

    for (const value of randomValues) {
      try {
        await verifyTextareaValue(page, value);
      } catch (error) {
        console.error(`Failed to verify value: ${value}`, error);
        throw error;
      }
    }
  },
);
