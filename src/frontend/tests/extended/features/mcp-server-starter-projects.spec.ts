import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";
import { clearTestFolders } from "../../utils/clear-test-folders";
import { TEXTS } from "../../utils/constants/texts";
import { convertTestName } from "../../utils/convert-test-name";
import { navigateSettingsPages } from "../../utils/go-to-settings";

type Project = {
  id: string;
  name: string;
};

const getProjects = async (page: Page): Promise<Project[]> => {
  const response = await page.request.get("/api/v1/projects/");
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Project[];
};

const waitForNewProjects = async (
  page: Page,
  baselineIds: Set<string>,
  expectedCount: number,
): Promise<Project[]> => {
  await expect
    .poll(
      async () =>
        (await getProjects(page)).filter(({ id }) => !baselineIds.has(id))
          .length,
      { timeout: 30000 },
    )
    .toBe(expectedCount);
  return (await getProjects(page)).filter(({ id }) => !baselineIds.has(id));
};

const toMcpServerName = (projectName: string): string =>
  `ketos-${projectName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/[-\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()}`;

const expectStarterServer = async (page: Page) => {
  await expect(
    page.getByText("ketos-starter_project", { exact: true }),
  ).toHaveCount(1);
};

test(
  "user must be able to see starter projects for mcp servers",
  { tag: ["@release", "@workspace", "@components"] },
  async ({ page }) => {
    //starter mcp project

    await awaitBootstrapTest(page, {
      skipModal: true,
    });

    await clearTestFolders(page);
    const baselineProjects = await getProjects(page);
    const baselineIds = new Set(baselineProjects.map(({ id }) => id));

    await navigateSettingsPages(page, "Settings", "MCP Servers");

    await expectStarterServer(page);

    await page.getByTestId("icon-ChevronLeft").first().click();

    //add new folders

    await page.getByTestId("add-project-button").click();
    await waitForNewProjects(page, baselineIds, 1);
    await page.getByTestId("add-project-button").click();
    const createdProjects = await waitForNewProjects(page, baselineIds, 2);

    await navigateSettingsPages(page, "Settings", "MCP Servers");

    await expectStarterServer(page);

    for (const project of createdProjects) {
      await expect(
        page.getByText(toMcpServerName(project.name), { exact: true }),
      ).toHaveCount(1);
    }

    await page.getByTestId("icon-ChevronLeft").first().click();

    //rename a folder

    const projectToRename = createdProjects[0];
    const projectNameKey = convertTestName(projectToRename.name);
    const projectToRenameButton = page.getByTestId(
      `sidebar-nav-${projectToRename.name}`,
    );

    await projectToRenameButton.hover();
    await page
      .getByTestId(`more-options-button_${projectNameKey}`)
      .last()
      .click();
    await page.getByText("Rename", { exact: true }).last().click();
    await page.getByTestId("input-project").last().fill("renamed_project");
    await page.keyboard.press("Enter");

    await expect
      .poll(
        async () =>
          (await getProjects(page)).find(({ id }) => id === projectToRename.id)
            ?.name,
        { timeout: 30000 },
      )
      .toBe("renamed_project");

    await navigateSettingsPages(page, "Settings", "MCP Servers");

    await expectStarterServer(page);

    expect(
      await page.getByText("ketos-renamed_project", { exact: true }).count(),
    ).toBe(1);

    //delete a folder

    await page.getByTestId("icon-ChevronLeft").first().click();
    await page
      .getByTestId("sidebar-nav-renamed_project")
      .hover()
      .then(async () => {
        await page
          .getByTestId("more-options-button_renamed_project")
          .last()
          .click();
        await page.getByText(TEXTS.delete, { exact: true }).last().click();
        await page.getByText(TEXTS.delete, { exact: true }).last().click();
        await page.waitForTimeout(1000);
      });

    await navigateSettingsPages(page, "Settings", "MCP Servers");

    await expectStarterServer(page);
    expect(
      await page.getByText("ketos-renamed_project", { exact: true }).count(),
    ).toBe(0);
  },
);

test(
  "user must not be able to add duplicate mcp servers from starter projects",
  { tag: ["@release", "@workspace", "@components"] },
  async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await awaitBootstrapTest(page);

    await page.getByTestId("side_nav_options_all-templates").click();
    await page
      .getByRole("heading", { name: TEXTS.templateBasicPrompting })
      .click();

    await page.waitForSelector('[data-testid="sidebar-search-input"]', {
      timeout: 100000,
    });

    await page.getByTestId("icon-ChevronLeft").first().click();

    const projects = await getProjects(page);
    const project =
      projects.find(({ name }) => name === "Starter Project") ?? projects[0];
    expect(project).toBeDefined();
    await page.goto(`/mcp/folder/${project.id}`);
    await expect(page.getByTestId("mcp-server-title")).toBeVisible({
      timeout: 30000,
    });
    await page.getByText("JSON").last().click();
    await page.getByTestId("icon-copy").click();

    await navigateSettingsPages(page, "Settings", "MCP Servers");

    await page.getByTestId("add-mcp-server-button-page").click();
    await page.getByTestId("json-input").click();
    await page.keyboard.press(`ControlOrMeta+V`);
    await page.getByTestId("add-mcp-server-button").click();

    // Wait for error message to appear
    await expect(page.getByText("Server already exists.")).toBeVisible({
      timeout: 10000,
    });

    const numberOfErrors = await page
      .getByText("Server already exists.")
      .count();
    expect(numberOfErrors).toBe(1);
  },
);
