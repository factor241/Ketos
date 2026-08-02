import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

import { TEXTS } from "../../utils/constants/texts";

/**
 * Tests for folder deletion integrity
 *
 * These tests verify that:
 * 1. After deleting a folder, the UI properly updates (no stale data)
 * 2. Deleting a folder when another exists keeps the app functional
 * 3. Creating folders after deletion works correctly
 */

test(
  "deleting a folder should update the folder list immediately",
  { tag: ["@release", "@api", "@folder"] },
  async ({ page }) => {
    await awaitBootstrapTest(page, { skipModal: true });
    await expect(page.getByTestId("add-project-button")).toBeVisible();

    // Create a new folder
    await page.getByTestId("add-project-button").click();

    await page
      .locator("[data-testid='project-sidebar']")
      .getByText(TEXTS.labelNewProject)
      .last()
      .waitFor({ state: "visible", timeout: 10000 });

    // Rename the folder for easier identification
    await page
      .locator("[data-testid='project-sidebar']")
      .getByText(TEXTS.labelNewProject)
      .last()
      .dblclick();

    const folderInput = page.getByTestId("input-project");
    await folderInput.waitFor({ state: "visible", timeout: 10000 });
    await folderInput.fill("test-folder-to-delete");
    await page.keyboard.press("Enter");

    // Wait for the folder to be renamed
    await page.getByText("test-folder-to-delete").last().waitFor({
      state: "visible",
      timeout: 30000,
    });

    // Verify the folder exists in the sidebar
    const folderBeforeDelete = page.getByTestId(
      "sidebar-nav-test-folder-to-delete",
    );
    await expect(folderBeforeDelete).toBeVisible({ timeout: 5000 });

    // Delete the folder
    await folderBeforeDelete.hover();
    await page
      .getByTestId("more-options-button_test-folder-to-delete")
      .waitFor({ state: "visible", timeout: 5000 });
    await page.getByTestId("more-options-button_test-folder-to-delete").click();
    await page.getByTestId("btn-delete-project").click();
    await page.getByText(TEXTS.delete).last().click();

    // Verify success message
    await expect(page.getByText(TEXTS.toastProjectDeleted)).toBeVisible({
      timeout: 5000,
    });

    // Verify the folder is removed from the sidebar immediately (no stale data)
    await expect(
      page.getByTestId("sidebar-nav-test-folder-to-delete"),
    ).not.toBeVisible({ timeout: 5000 });

    // Verify the page is still functional by checking for the add project button
    await expect(page.getByTestId("add-project-button")).toBeVisible({
      timeout: 5000,
    });
  },
);

test(
  "deleting one folder should not affect other folders",
  { tag: ["@release", "@api", "@folder"] },
  async ({ page }) => {
    await awaitBootstrapTest(page, { skipModal: true });
    await expect(page.getByTestId("add-project-button")).toBeVisible();

    // Create first folder
    await page.getByTestId("add-project-button").click();

    await page
      .locator("[data-testid='project-sidebar']")
      .getByText(TEXTS.labelNewProject)
      .last()
      .waitFor({ state: "visible", timeout: 10000 });

    await page
      .locator("[data-testid='project-sidebar']")
      .getByText(TEXTS.labelNewProject)
      .last()
      .dblclick();

    const folderAlphaInput = page.getByTestId("input-project");
    await folderAlphaInput.waitFor({ state: "visible", timeout: 10000 });
    await folderAlphaInput.fill("folder-alpha");
    await page.keyboard.press("Enter");

    await page.getByText("folder-alpha").last().waitFor({
      state: "visible",
      timeout: 30000,
    });

    // Create second folder
    await page.getByTestId("add-project-button").click();

    await page
      .locator("[data-testid='project-sidebar']")
      .getByText(TEXTS.labelNewProject)
      .last()
      .waitFor({ state: "visible", timeout: 10000 });

    await page
      .locator("[data-testid='project-sidebar']")
      .getByText(TEXTS.labelNewProject)
      .last()
      .dblclick();

    const folderBetaInput = page.getByTestId("input-project");
    await folderBetaInput.waitFor({ state: "visible", timeout: 10000 });
    await folderBetaInput.fill("folder-beta");
    await page.keyboard.press("Enter");

    await page.getByText("folder-beta").last().waitFor({
      state: "visible",
      timeout: 30000,
    });

    // Verify both folders exist
    await expect(page.getByTestId("sidebar-nav-folder-alpha")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByTestId("sidebar-nav-folder-beta")).toBeVisible({
      timeout: 5000,
    });

    // Delete the first folder
    const folderAlpha = page.getByTestId("sidebar-nav-folder-alpha");
    await folderAlpha.hover();
    await page
      .getByTestId("more-options-button_folder-alpha")
      .waitFor({ state: "visible", timeout: 5000 });
    await page.getByTestId("more-options-button_folder-alpha").click();
    await page.getByTestId("btn-delete-project").click();
    await page.getByText(TEXTS.delete).last().click();

    // Verify success message
    await expect(page.getByText(TEXTS.toastProjectDeleted)).toBeVisible({
      timeout: 5000,
    });

    // Verify folder-alpha is removed
    await expect(page.getByTestId("sidebar-nav-folder-alpha")).not.toBeVisible({
      timeout: 5000,
    });

    // Verify folder-beta still exists and is accessible
    const folderBeta = page.getByTestId("sidebar-nav-folder-beta");
    await expect(folderBeta).toBeVisible({ timeout: 5000 });

    // Click on folder-beta to ensure the app is functional
    await folderBeta.click();

    // The page should still be functional
    await expect(page.getByTestId("mainpage_title")).toHaveText("Boards");

    // Clean up - delete the remaining folder
    await folderBeta.hover();
    await page
      .getByTestId("more-options-button_folder-beta")
      .waitFor({ state: "visible", timeout: 5000 });
    await page.getByTestId("more-options-button_folder-beta").click();
    await page.getByTestId("btn-delete-project").click();
    await page.getByText(TEXTS.delete).last().click();

    await expect(page.getByText(TEXTS.toastProjectDeleted)).toBeVisible({
      timeout: 5000,
    });
  },
);

test(
  "creating a new folder after deletion should work correctly",
  { tag: ["@release", "@api", "@folder"] },
  async ({ page }) => {
    await awaitBootstrapTest(page, { skipModal: true });
    await expect(page.getByTestId("add-project-button")).toBeVisible();

    // Create first folder
    await page.getByTestId("add-project-button").click();

    await page
      .locator("[data-testid='project-sidebar']")
      .getByText(TEXTS.labelNewProject)
      .last()
      .waitFor({ state: "visible", timeout: 10000 });

    await page
      .locator("[data-testid='project-sidebar']")
      .getByText(TEXTS.labelNewProject)
      .last()
      .dblclick();

    const folderOneInput = page.getByTestId("input-project");
    await folderOneInput.waitFor({ state: "visible", timeout: 10000 });
    await folderOneInput.fill("folder-one");
    await page.keyboard.press("Enter");

    await page.getByText("folder-one").last().waitFor({
      state: "visible",
      timeout: 30000,
    });

    // Delete the folder
    const folderOne = page.getByTestId("sidebar-nav-folder-one");
    await folderOne.hover();
    await page
      .getByTestId("more-options-button_folder-one")
      .waitFor({ state: "visible", timeout: 5000 });
    await page.getByTestId("more-options-button_folder-one").click();
    await page.getByTestId("btn-delete-project").click();
    await page.getByText(TEXTS.delete).last().click();

    await expect(page.getByText(TEXTS.toastProjectDeleted)).toBeVisible({
      timeout: 5000,
    });

    // Verify folder is deleted
    await expect(page.getByTestId("sidebar-nav-folder-one")).not.toBeVisible({
      timeout: 5000,
    });

    // Create a new folder immediately after deletion
    await page.getByTestId("add-project-button").click();

    await page
      .locator("[data-testid='project-sidebar']")
      .getByText(TEXTS.labelNewProject)
      .last()
      .waitFor({ state: "visible", timeout: 10000 });

    await page
      .locator("[data-testid='project-sidebar']")
      .getByText(TEXTS.labelNewProject)
      .last()
      .dblclick();

    const folderTwoInput = page.getByTestId("input-project");
    await folderTwoInput.waitFor({ state: "visible", timeout: 10000 });
    await folderTwoInput.fill("folder-two");
    await page.keyboard.press("Enter");

    // The new folder should be created successfully without any stale data issues
    await page.getByText("folder-two").last().waitFor({
      state: "visible",
      timeout: 30000,
    });

    const folderTwo = page.getByTestId("sidebar-nav-folder-two");
    await expect(folderTwo).toBeVisible({ timeout: 5000 });

    // Clean up
    await folderTwo.hover();
    await page
      .getByTestId("more-options-button_folder-two")
      .waitFor({ state: "visible", timeout: 5000 });
    await page.getByTestId("more-options-button_folder-two").click();
    await page.getByTestId("btn-delete-project").click();
    await page.getByText(TEXTS.delete).last().click();

    await expect(page.getByText(TEXTS.toastProjectDeleted)).toBeVisible({
      timeout: 5000,
    });
  },
);

test(
  "creating an automation after deleting all projects uses the new project",
  { tag: ["@release", "@api", "@folder"] },
  async ({ page }) => {
    await awaitBootstrapTest(page, { skipModal: true });

    const username = `projectless-${crypto.randomUUID().slice(0, 8)}`;
    const password = `Projectless-${crypto.randomUUID()}-aA1`;
    const userResponse = await page.request.post("/api/v1/users/", {
      data: { username, password },
    });
    expect(userResponse.status(), await userResponse.text()).toBe(201);
    const user = (await userResponse.json()) as { id: string };
    const activateResponse = await page.request.patch(
      `/api/v1/users/${user.id}`,
      { data: { is_active: true } },
    );
    expect(activateResponse.ok(), await activateResponse.text()).toBeTruthy();

    await page.route("**/api/v1/auto_login", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ auto_login: false }),
      }),
    );
    await page.addInitScript(() => {
      window.process = window.process || {};
      Object.defineProperty(window.process, "env", {
        value: { ...window.process.env, KETOS_AUTO_LOGIN: "false" },
        writable: true,
        configurable: true,
      });
    });

    try {
      const loginResponse = await page.request.post("/api/v1/login", {
        form: { username, password },
      });
      expect(loginResponse.status(), await loginResponse.text()).toBe(200);
      await page.goto("/");
      await expect(page.getByTestId("project-sidebar")).toBeVisible();

      const projectsResponse = await page.request.get("/api/v1/projects/");
      expect(projectsResponse.ok(), await projectsResponse.text()).toBeTruthy();
      const projects = (await projectsResponse.json()) as Array<{
        id: string;
        name: string;
      }>;
      for (const project of projects) {
        const response = await page.request.delete(
          `/api/v1/projects/${project.id}`,
        );
        expect(response.status(), await response.text()).toBe(204);
      }
      await page.reload();
      await expect(
        page
          .getByTestId("project-sidebar")
          .locator('[data-testid^="sidebar-nav-"]'),
      ).toHaveCount(0);

      const createProjectResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/v1/projects/" &&
          response.status() === 201,
      );
      await page.getByTestId("add-project-button").click();
      const project = (await (await createProjectResponse).json()) as {
        id: string;
        name: string;
      };
      await expect(
        page.getByTestId(`sidebar-nav-${project.name}`),
      ).toBeVisible();
      await expect(page).toHaveURL(
        new RegExp(`/project/${project.id}/boards(?:[/?#]|$)`),
      );

      await awaitBootstrapTest(page, { skipGoto: true });
      await page.getByTestId("side_nav_options_all-templates").click();
      await page
        .getByRole("heading", { name: TEXTS.templateBasicPrompting })
        .click();
      await page.waitForSelector('[data-testid="sidebar-search-input"]', {
        timeout: 30000,
      });

      const flowId = new URL(page.url()).pathname.match(
        /^\/flow\/([^/]+)/,
      )?.[1];
      expect(flowId).toBeTruthy();
      const flowResponse = await page.request.get(`/api/v1/flows/${flowId}`);
      expect(flowResponse.ok(), await flowResponse.text()).toBeTruthy();
      expect(
        ((await flowResponse.json()) as { folder_id: string }).folder_id,
      ).toBe(project.id);

      await page.getByTestId("icon-ChevronLeft").first().click();
      await expect(page).toHaveURL(
        new RegExp(`/project/${project.id}/boards(?:[/?#]|$)`),
      );
      await expect(
        page.getByRole("searchbox", { name: "Search project automations" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByText(TEXTS.templateBasicPrompting, { exact: true }),
      ).toBeVisible();
    } finally {
      const adminLogin = await page.request.post("/api/v1/login", {
        form: {
          username: TEXTS.authDefaultCredential,
          password: TEXTS.authDefaultPassword,
        },
      });
      expect(adminLogin.status(), await adminLogin.text()).toBe(200);
      const cleanup = await page.request.delete(`/api/v1/users/${user.id}`);
      expect(cleanup.ok(), await cleanup.text()).toBeTruthy();
    }
  },
);
