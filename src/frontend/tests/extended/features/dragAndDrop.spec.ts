import type { Page } from "@playwright/test";
import { readFileSync } from "fs";
import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";
import { TEXTS } from "../../utils/constants/texts";
import { waitForNewProjectButton } from "../../utils/flow/new-project-flow";

async function uploadAutomation(
  page: Page,
  contents: string | Buffer,
  name: string,
) {
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-project-button").last().click(),
  ]);
  await fileChooser.setFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.isBuffer(contents) ? contents : Buffer.from(contents),
  });
}

test(
  "user should be able to import an old collection without crashing the application",
  { tag: ["@release", "@mainpage"] },
  async ({ page }) => {
    await awaitBootstrapTest(page);

    //add a new flow just to have the workspace available
    await page.getByTestId("side_nav_options_all-templates").click();
    await page
      .getByRole("heading", { name: TEXTS.templateBasicPrompting })
      .click();

    await page.waitForSelector('[data-testid="canvas_controls_dropdown"]', {
      timeout: 100000,
    });

    await page.waitForSelector('[data-testid="sidebar-search-input"]', {
      timeout: 100000,
    });

    await page.getByTestId("icon-ChevronLeft").first().click();

    await page.waitForSelector("text=starter project", {
      timeout: 5000,
    });

    await waitForNewProjectButton(page, { timeout: 100000 });

    const uploadResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/projects/upload/") &&
        response.request().method() === "POST",
    );
    await uploadAutomation(
      page,
      readFileSync("tests/assets/collection.json"),
      "collection.json",
    );
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.ok()).toBeTruthy();

    const importedProject = page.getByTestId("sidebar-nav-collection");
    await expect(importedProject).toBeVisible({ timeout: 120000 });
    await importedProject.click();
    await expect(importedProject).toHaveAttribute("data-active", "true");

    const inventory = page.getByRole("complementary", {
      name: "Automations",
    });
    await expect(inventory).toBeVisible();
    await inventory
      .getByRole("searchbox", { name: "Search project automations" })
      .fill("Getting Started: Simple python function applied to each output");
    await expect(
      inventory
        .getByText(
          /^Getting Started: Simple python function applied to each output(?: \(\d+\))*$/,
        )
        .first(),
    ).toBeVisible({ timeout: 120000 });
    await expect(page.getByText("Restart Ketos", { exact: true })).toBeHidden();
  },
);

test(
  "user should be able to import a flow from the unified workspace",
  { tag: ["@release"] },
  async ({ page }) => {
    await awaitBootstrapTest(page);

    //add a new flow just to have the workspace available
    await page.getByTestId("side_nav_options_all-templates").click();
    await page
      .getByRole("heading", { name: TEXTS.templateBasicPrompting })
      .click();

    await page.waitForSelector('[data-testid="canvas_controls_dropdown"]', {
      timeout: 100000,
    });

    await page.waitForSelector('[data-testid="sidebar-search-input"]', {
      timeout: 100000,
    });

    await page.getByTestId("icon-ChevronLeft").first().click();

    await page.waitForSelector("text=starter project", {
      timeout: 5000,
    });

    await waitForNewProjectButton(page, { timeout: 100000 });
    // Read your file into a buffer.
    const randomName = Math.random().toString(36).substring(2, 15);
    const jsonContent = JSON.parse(
      readFileSync("tests/assets/flow_test_drag_and_drop.json", "utf-8"),
    );
    const jsonContentWithNewName = JSON.stringify({
      ...jsonContent,
      name: randomName,
      data: {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });

    const uploadResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/flows/") &&
        response.request().method() === "POST",
    );
    await uploadAutomation(
      page,
      jsonContentWithNewName,
      "flow_test_drag_and_drop.json",
    );
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.ok()).toBeTruthy();
    expect((await uploadResponse.json()).name).toBe(randomName);

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Project: Starter Project" }),
    ).toBeVisible({ timeout: 120000 });
    const inventory = page.getByRole("complementary", {
      name: "Automations",
    });
    await expect(inventory).toBeVisible();
    await expect(inventory.getByText(randomName, { exact: true })).toBeVisible({
      timeout: 120000,
    });
    await expect(page.getByText("Restart Ketos", { exact: true })).toBeHidden();
  },
);
