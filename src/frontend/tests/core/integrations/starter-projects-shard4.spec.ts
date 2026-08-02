import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

test(
  "user should be able to use fourth quarter of starter projects without any outdated components on the flow",
  { tag: ["@release", "@components"] },
  async ({ page }) => {
    test.skip(
      process.platform === "win32",
      "Flaky on Windows CI runners due to template-load workload; outdated-component check is OS-agnostic and covered by Linux/macOS runs",
    );

    await awaitBootstrapTest(page);

    const templatesData = [];
    let numberOfOutdatedComponents = 0;

    await page.getByTestId("side_nav_options_all-templates").click();
    // Avoid waitForLoadState("networkidle"): persistent connections
    // (MCP refresh, websockets) keep network busy and force the full 30s
    // timeout on every iteration. The toBeVisible() below already
    // auto-waits for actual readiness.
    await expect(page.getByTestId("text_card_container").first()).toBeVisible({
      timeout: 20000,
    });

    const numberOfTemplates = await page
      .getByTestId("text_card_container")
      .count();

    const thirdQuarterEnd = Math.ceil((numberOfTemplates * 3) / 4);

    console.log(
      `Total templates: ${numberOfTemplates}, Testing from ${thirdQuarterEnd} to ${numberOfTemplates - 1} (fourth quarter)`,
    );

    for (let i = thirdQuarterEnd; i < numberOfTemplates; i++) {
      const templateCard = page.getByTestId("text_card_container").nth(i);
      await expect(templateCard).toBeVisible({ timeout: 10000 });
      const exampleName = await templateCard.getAttribute("role");
      templatesData.push({ index: i, name: exampleName });
    }

    console.log(
      "Templates to test:",
      templatesData.map((t) => `${t.index}: ${t.name}`).join(", "),
    );

    for (let idx = 0; idx < templatesData.length; idx++) {
      const template = templatesData[idx];
      console.log(`Testing template ${template.index}: ${template.name}`);

      // Re-bootstrap between templates so each heavy flow gets a fresh
      // renderer instead of accumulating one long-lived SPA heap.
      if (idx > 0) {
        await awaitBootstrapTest(page);
        await page.getByTestId("side_nav_options_all-templates").click();
        await expect(
          page.getByTestId("text_card_container").first(),
        ).toBeVisible({ timeout: 20000 });
      }

      const targetTemplate = page
        .getByTestId("text_card_container")
        .nth(template.index);
      await expect(targetTemplate).toBeVisible({ timeout: 15000 });
      await targetTemplate.click();

      await expect(
        page.locator('[data-testid="div-generic-node"]').first(),
      ).toBeVisible({ timeout: 25000 });

      const updateButtonCount = await page
        .getByTestId("update-all-button")
        .count();
      if (updateButtonCount > 0) {
        console.error(`Outdated component on template: ${template.name}`);
        numberOfOutdatedComponents++;
      }
    }

    expect(numberOfOutdatedComponents).toBe(0);
  },
);
