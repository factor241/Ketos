import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";

type Project = { id: string };
type Flow = { id: string; name: string };

async function createProject(page: Page): Promise<Project> {
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      name: `Bulk actions ${crypto.randomUUID().slice(0, 8)}`,
      description: "",
      flows_list: [],
      components_list: [],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function createFlow(
  page: Page,
  projectId: string,
  name: string,
): Promise<Flow> {
  const response = await page.request.post("/api/v1/flows/", {
    data: {
      name,
      description: "Bulk action acceptance",
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
  "supported bulk export and delete operations update the project inventory",
  { tag: ["@release", "@workspace", "@mainpage", "@api"] },
  async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("project-sidebar")).toBeVisible();
    const project = await createProject(page);
    const boardResponse = await page.request.post(
      `/api/v1/projects/${project.id}/boards`,
      { data: { title: "Bulk workspace" } },
    );
    expect(boardResponse.status(), await boardResponse.text()).toBe(201);
    const flows = await Promise.all([
      createFlow(page, project.id, `First ${crypto.randomUUID().slice(0, 8)}`),
      createFlow(page, project.id, `Second ${crypto.randomUUID().slice(0, 8)}`),
      createFlow(page, project.id, `Third ${crypto.randomUUID().slice(0, 8)}`),
    ]);

    try {
      await page.goto(`/project/${project.id}/boards?panel=automations`);
      const inventory = page.getByRole("complementary", {
        name: "Automations",
      });
      for (const flow of flows) {
        await expect(
          inventory.getByText(flow.name, { exact: true }),
        ).toBeVisible();
      }

      const exportResponse = await page.request.post(
        "/api/v1/flows/download/",
        { data: flows.map((flow) => flow.id) },
      );
      expect(exportResponse.status(), await exportResponse.text()).toBe(200);
      expect(exportResponse.headers()["content-type"]).toContain(
        "application/x-zip-compressed",
      );
      const zipBody = await exportResponse.body();
      expect(zipBody.byteLength).toBeGreaterThan(0);
      expect(zipBody.subarray(0, 2).toString("ascii")).toBe("PK");

      const deleted = [flows[0], flows[2]];
      const deleteResponse = await page.request.delete("/api/v1/flows/", {
        data: deleted.map((flow) => flow.id),
      });
      expect(deleteResponse.status(), await deleteResponse.text()).toBe(200);
      expect(await deleteResponse.json()).toEqual({ deleted: deleted.length });

      await page.reload();
      await expect(
        inventory.getByText(flows[1].name, { exact: true }),
      ).toBeVisible();
      for (const flow of deleted) {
        await expect(
          inventory.getByText(flow.name, { exact: true }),
        ).toHaveCount(0);
      }
    } finally {
      const cleanup = await page.request.delete(
        `/api/v1/projects/${project.id}`,
      );
      expect([204, 404]).toContain(cleanup.status());
    }
  },
);
