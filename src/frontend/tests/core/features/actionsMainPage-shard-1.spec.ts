import { expect, test } from "../../fixtures";
import { adjustScreenView } from "../../utils/adjust-screen-view";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";
import { TEXTS } from "../../utils/constants/texts";
import { openTemplatesModal } from "../../utils/flow/new-project-flow";
import { renameFlow } from "../../utils/rename-flow";

test(
  "automation deletion is reflected in the primary project workspace",
  { tag: ["@release", "@mainpage"] },
  async ({ page }) => {
    await awaitBootstrapTest(page);

    await page.getByTestId("side_nav_options_all-templates").click();
    await page
      .getByRole("heading", { name: TEXTS.templateBasicPrompting })
      .click();

    await page.waitForSelector('[data-testid="sidebar-search-input"]', {
      timeout: 100000,
    });

    const flowId = new URL(page.url()).pathname.match(/^\/flow\/([^/]+)/)?.[1];
    expect(flowId).toBeTruthy();
    const flowName = `Delete inventory ${crypto.randomUUID().slice(0, 8)}`;
    await renameFlow(page, { flowName });
    await page.getByTestId("icon-ChevronLeft").first().click();

    await expect(page.getByText(flowName, { exact: true })).toBeVisible();
    const deleteResponse = await page.request.delete(`/api/v1/flows/${flowId}`);
    expect(deleteResponse.status(), await deleteResponse.text()).toBe(200);
    await page.reload();
    await expect(page.getByText(flowName, { exact: true })).toHaveCount(0);
  },
);

test("search flows", { tag: ["@release", "@mainpage"] }, async ({ page }) => {
  await awaitBootstrapTest(page);

  await page.getByTestId("side_nav_options_all-templates").click();
  await page
    .getByRole("heading", { name: TEXTS.templateBasicPrompting })
    .click();

  await page.waitForSelector('[data-testid="sidebar-search-input"]', {
    timeout: 100000,
  });

  await page.getByTestId("icon-ChevronLeft").first().click();

  await openTemplatesModal(page);
  await page.getByTestId("side_nav_options_all-templates").click();
  await page.getByRole("heading", { name: "Memory Chatbot" }).click();

  await page.waitForSelector('[data-testid="sidebar-search-input"]', {
    timeout: 100000,
  });

  await page.getByTestId("icon-ChevronLeft").first().click();
  await openTemplatesModal(page);
  await page.getByTestId("side_nav_options_all-templates").click();
  await page.getByRole("heading", { name: "Document Q&A" }).click();

  await page.waitForSelector('[data-testid="sidebar-search-input"]', {
    timeout: 100000,
  });

  const projectId = new URL(page.url()).pathname.match(
    /\/folder\/([^/]+)/,
  )?.[1];
  expect(projectId).toBeTruthy();
  await page.goto(`/project/${projectId}/boards`);
  const inventory = page.getByRole("complementary", { name: "Automations" });
  const search = inventory.getByRole("searchbox", {
    name: "Search project automations",
  });
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill("Memory Chatbot");
  await expect(
    inventory.getByText("Memory Chatbot", { exact: true }),
  ).toBeVisible();
  await expect(
    inventory.getByText("Document Q&A", { exact: true }),
  ).toHaveCount(0);
  await expect(
    inventory.getByText(TEXTS.templateBasicPrompting, { exact: true }),
  ).toHaveCount(0);
});

test(
  "search components",
  { tag: ["@release", "@mainpage"] },
  async ({ page }) => {
    await awaitBootstrapTest(page);

    if (await page.getByTestId("components-btn").isVisible()) {
      await page.getByTestId("side_nav_options_all-templates").click();
      await page
        .getByRole("heading", { name: TEXTS.templateBasicPrompting })
        .click();

      await adjustScreenView(page, { numberOfZoomOut: 2 });

      await page.getByText(TEXTS.componentChatInput).first().click();
      await page.waitForSelector('[data-testid="more-options-modal"]', {
        timeout: 1000,
      });
      await page.getByTestId("more-options-modal").click();

      await page.getByTestId("icon-SaveAll").first().click();
      await page.keyboard.press("Escape");
      await page
        .getByText("Prompt", {
          exact: true,
        })
        .first()
        .click();
      await page.getByTestId("more-options-modal").click();

      await page.getByTestId("icon-SaveAll").first().click();
      await page.keyboard.press("Escape");

      await page
        .getByText("OpenAI", {
          exact: true,
        })
        .first()
        .click();
      await page.getByTestId("more-options-modal").click();

      await page.getByTestId("icon-SaveAll").first().click();
      await page.keyboard.press("Escape");

      await page.waitForSelector('[data-testid="sidebar-search-input"]', {
        timeout: 100000,
      });

      await page.getByTestId("icon-ChevronLeft").first().click();

      const exitButton = await page
        .getByText(TEXTS.exit, { exact: true })
        .count();

      if (exitButton > 0) {
        await page.getByText(TEXTS.exit, { exact: true }).click();
      }

      await page.getByTestId("components-btn").click();
      await page.getByPlaceholder("Search components").fill("Chat Input");
      await expect(
        page.getByText(TEXTS.componentChatInput, { exact: true }),
      ).toBeVisible();
      await page.getByText("Prompt", { exact: true }).isHidden();
      await page.getByText("OpenAI", { exact: true }).isHidden();
    }
  },
);
