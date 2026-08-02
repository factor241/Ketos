import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { renameFlow } from "../../utils/rename-flow";

type Project = { id: string };
type Flow = { id: string; name: string; folder_id: string };

async function createProject(page: Page): Promise<Project> {
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      name: `Rename ${crypto.randomUUID().slice(0, 8)}`,
      description: "",
      flows_list: [],
      components_list: [],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function createFlow(page: Page, projectId: string): Promise<Flow> {
  const response = await page.request.post("/api/v1/flows/", {
    data: {
      name: "Rename candidate",
      description: "Rename acceptance",
      folder_id: projectId,
      data: {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

test(
  "automation name edited in the editor persists in the project inventory",
  { tag: ["@release", "@workspace", "@components", "@api"] },
  async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("project-sidebar")).toBeVisible();
    const project = await createProject(page);
    const boardResponse = await page.request.post(
      `/api/v1/projects/${project.id}/boards`,
      { data: { title: "Rename workspace" } },
    );
    expect(boardResponse.status(), await boardResponse.text()).toBe(201);
    const flow = await createFlow(page, project.id);
    const renamed = `Renamed ${crypto.randomUUID().slice(0, 8)}`;

    try {
      await page.goto(`/flow/${flow.id}`);
      await expect(page.locator("#react-flow-id")).toBeVisible();
      await renameFlow(page, { flowName: renamed });

      const storedResponse = await page.request.get(`/api/v1/flows/${flow.id}`);
      expect(storedResponse.status(), await storedResponse.text()).toBe(200);
      expect((await storedResponse.json()) as Flow).toMatchObject({
        id: flow.id,
        name: renamed,
        folder_id: project.id,
      });

      await page.goto(`/project/${project.id}/boards?panel=automations`);
      const inventory = page.getByRole("complementary", {
        name: "Automations",
      });
      await expect(inventory.getByText(renamed, { exact: true })).toBeVisible();
      await inventory
        .getByRole("button", {
          name: `Open ${renamed} in the automation editor`,
        })
        .click();
      await expect(page).toHaveURL(new RegExp(`/flow/${flow.id}(?:[?#]|$)`));
      await expect(page.getByTestId("flow_name")).toHaveText(renamed);
    } finally {
      const cleanup = await page.request.delete(
        `/api/v1/projects/${project.id}`,
      );
      expect([204, 404]).toContain(cleanup.status());
    }
  },
);
