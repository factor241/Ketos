import { expect, test } from "../../fixtures";
import { adjustScreenView } from "../../utils/adjust-screen-view";
import { openBlankFlow } from "../../utils/flow/open-blank-flow";

test(
  "user should be able to manually save a flow when the auto_save is off",
  { tag: ["@release", "@api", "@database", "@components"] },
  async ({ page }) => {
    await page.route("**/api/v1/config", async (route) => {
      const response = await route.fetch();
      const config: unknown = await response.json();
      if (
        typeof config !== "object" ||
        config === null ||
        Array.isArray(config)
      ) {
        throw new Error("Expected /api/v1/config to return a JSON object");
      }
      await route.fulfill({
        response,
        json: {
          ...config,
          type: "full",
          auto_saving: false,
          frontend_timeout: 0,
        },
      });
    });
    await openBlankFlow(page);
    const flowId = new URL(page.url()).pathname
      .split("/")
      .filter(Boolean)
      .at(-1);
    if (!flowId) {
      throw new Error(`Flow id is missing from editor URL: ${page.url()}`);
    }
    const ensureEditorReady = async () => {
      await page.locator("#react-flow-id").waitFor({
        state: "visible",
        timeout: 30_000,
      });
      const sidebarSearch = page.getByTestId("sidebar-search-input");
      if (!(await sidebarSearch.isVisible())) {
        await page
          .locator('[data-testid="sidebar-trigger-search"]:visible')
          .click();
      }
      await sidebarSearch.waitFor({ state: "visible", timeout: 30_000 });
    };
    page.on("dialog", (dialog) => void dialog.accept());

    await page.getByTestId("sidebar-search-input").click();
    await page.getByTestId("sidebar-search-input").fill("NVIDIA");

    await page.waitForSelector('[data-testid="nvidiaNVIDIA"]', {
      timeout: 3000,
    });

    await page
      .getByTestId("nvidiaNVIDIA")
      .dragTo(page.locator('//*[@id="react-flow-id"]'));
    await page.mouse.up();

    await page.waitForSelector('[data-testid="canvas_controls_dropdown"]', {
      timeout: 5000,
    });

    await adjustScreenView(page);

    expect(await page.getByTestId("save-flow-button").isEnabled()).toBeTruthy();

    const unsavedRead = await page.request.get(`/api/v1/flows/${flowId}`);
    expect(unsavedRead.ok(), await unsavedRead.text()).toBe(true);
    const unsavedFlow = (await unsavedRead.json()) as {
      data: { nodes: unknown[] };
    };
    expect(unsavedFlow.data.nodes).toHaveLength(0);

    await page.reload();
    await ensureEditorReady();

    const nvidiaNode = await page.getByTestId("div-generic-node").count();
    expect(nvidiaNode).toBe(0);

    await page.getByTestId("sidebar-search-input").click();
    await page.getByTestId("sidebar-search-input").fill("NVIDIA");

    await page.keyboard.press("Escape");
    await page.locator('//*[@id="react-flow-id"]').click();

    const lastNvidiaModel = page.getByTestId("nvidiaNVIDIA").last();
    await lastNvidiaModel.scrollIntoViewIfNeeded();

    try {
      await lastNvidiaModel.hover({ timeout: 5000 });

      // Wait for the add component button to appear
      await page.getByTestId("add-component-button-nvidia").waitFor({
        state: "visible",
        timeout: 5000,
      });

      await page.getByTestId("add-component-button-nvidia").click();
    } catch (error) {
      console.error("Failed to hover or find add component button:", error);
      throw error;
    }

    // Wait for fit view button
    await page.waitForSelector('[data-testid="canvas_controls_dropdown"]', {
      timeout: 5000,
    });

    await adjustScreenView(page);

    const firstSave = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "PATCH" &&
        url.pathname === `/api/v1/flows/${flowId}`
      );
    });
    await page.getByTestId("save-flow-button").click();
    expect((await firstSave).ok()).toBe(true);

    await page.reload();
    await ensureEditorReady();

    await expect(page.getByTestId("title-NVIDIA").first()).toBeVisible({
      timeout: 5000,
    });

    await page.getByTestId("sidebar-search-input").click();
    await page.getByTestId("sidebar-search-input").fill("NVIDIA");

    await page.waitForSelector('[data-testid="nvidiaNVIDIA"]', {
      timeout: 3000,
    });

    await page
      .getByTestId("nvidiaNVIDIA")
      .dragTo(page.locator('//*[@id="react-flow-id"]'));
    await page.mouse.up();

    await page.waitForSelector('[data-testid="canvas_controls_dropdown"]', {
      timeout: 5000,
    });

    await adjustScreenView(page);

    const secondSave = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "PATCH" &&
        url.pathname === `/api/v1/flows/${flowId}`
      );
    });
    await page.getByTestId("save-flow-button").click();
    expect((await secondSave).ok()).toBe(true);

    await page.reload();
    await ensureEditorReady();

    await expect(page.getByTestId("title-NVIDIA").first()).toBeVisible({
      timeout: 5000,
    });

    const nvidiaNumber = await page.getByTestId("title-NVIDIA").count();
    expect(nvidiaNumber).toBe(2);
  },
);
