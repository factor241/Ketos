import { expect, test } from "../../fixtures";
import { openBlankFlow } from "../../utils/flow/open-blank-flow";

test(
  "user should be able to copy JSON from output",
  { tag: ["@release", "@workspace"] },
  async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openBlankFlow(page);
    await page.waitForSelector('[data-testid="disclosure-data sources"]', {
      timeout: 3000,
      state: "visible",
    });

    await page.getByTestId("disclosure-data sources").click();

    await page
      .getByTestId("data_sourceAPI Request")
      .hover()
      .then(async () => {
        await page.getByTestId("add-component-button-api-request").click();

        await page.waitForTimeout(500);

        await page
          .getByTestId("popover-anchor-input-url_input")
          .first()
          .fill("http://ketos.localhost:7860/health");
      });

    await page.getByTestId("button_run_api request").click();

    await page.waitForSelector("text=Running", {
      timeout: 30000,
      state: "visible",
    });

    const apiResponseOutput = page.getByTestId(
      "output-inspection-api response-apirequest",
    );
    await expect(apiResponseOutput).toBeEnabled({ timeout: 120000 });
    const buildSuccessToast = page.getByText("Flow built successfully", {
      exact: true,
    });
    await expect(buildSuccessToast).toBeVisible({ timeout: 30000 });
    await expect(buildSuccessToast).toBeHidden({ timeout: 30000 });
    await apiResponseOutput.click();

    await page.waitForSelector("text=Component Output", { timeout: 30000 });

    await page.getByTitle("Copy JSON to clipboard").click();

    await page.waitForSelector("text=JSON copied to clipboard", {
      timeout: 30000,
    });

    await page.getByText("tree").last().click();

    await page.waitForTimeout(1000);

    await page.locator(".jse-key").first().click();

    await page.waitForTimeout(500);

    await page.getByTitle("Copy (Ctrl+C)").click();

    await page.waitForSelector("text=Copied to clipboard", { timeout: 30000 });
  },
);
