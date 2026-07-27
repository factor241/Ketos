import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";

type Project = { id: string; name: string };
type Board = { id: string };
type Flow = {
  id: string;
  name: string;
  description: string;
  folder_id: string;
  data: {
    nodes: unknown[];
    edges: unknown[];
    viewport: { x: number; y: number; zoom: number };
  };
};

async function awaitWorkspaceReady(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("project-sidebar")).toBeVisible();
}

async function createProject(page: Page): Promise<Project> {
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      name: `Actions ${crypto.randomUUID().slice(0, 8)}`,
      description: "",
      flows_list: [],
      components_list: [],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function createBoard(page: Page, projectId: string): Promise<Board> {
  const response = await page.request.post(
    `/api/v1/projects/${projectId}/boards`,
    { data: { title: "Actions workspace" } },
  );
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
      description: "Actions acceptance",
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

async function deleteProject(page: Page, projectId: string) {
  const response = await page.request.delete(`/api/v1/projects/${projectId}`);
  expect([204, 404]).toContain(response.status());
}

test(
  "automation export returns the current project flow",
  { tag: ["@release", "@workspace", "@api"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page);
    await createBoard(page, project.id);
    const flow = await createFlow(
      page,
      project.id,
      `Export ${crypto.randomUUID().slice(0, 8)}`,
    );

    try {
      await page.goto(`/project/${project.id}/boards?panel=automations`);
      const inventory = page.getByRole("complementary", {
        name: "Automations",
      });
      await expect(
        inventory.getByText(flow.name, { exact: true }),
      ).toBeVisible();

      const response = await page.request.post("/api/v1/flows/download/", {
        data: [flow.id],
      });
      expect(response.status(), await response.text()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/json");
      const exported = (await response.json()) as Partial<Flow>;
      expect(exported).toMatchObject({
        name: flow.name,
        description: flow.description,
        data: flow.data,
      });
      expect(exported.id).toBe(flow.id);
      expect(exported).not.toHaveProperty("folder_id");
      expect(exported).not.toHaveProperty("user_id");
    } finally {
      await deleteProject(page, project.id);
    }
  },
);

test(
  "automation JSON upload is reflected in the selected project inventory",
  { tag: ["@release", "@api", "@workspace"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page);
    await createBoard(page, project.id);
    const importedName = `Imported ${crypto.randomUUID().slice(0, 8)}`;

    try {
      const response = await page.request.post("/api/v1/flows/upload/", {
        params: { folder_id: project.id },
        multipart: {
          file: {
            name: "imported-flow.json",
            mimeType: "application/json",
            buffer: Buffer.from(
              JSON.stringify({
                name: importedName,
                description: "Uploaded through the supported API",
                data: {
                  nodes: [],
                  edges: [],
                  viewport: { x: 0, y: 0, zoom: 1 },
                },
              }),
            ),
          },
        },
      });
      expect(response.status(), await response.text()).toBe(201);
      const imported = (await response.json()) as Flow[];
      expect(imported).toHaveLength(1);
      expect(imported[0]).toMatchObject({
        name: importedName,
        folder_id: project.id,
      });
      expect(imported[0].id).toBeTruthy();

      await page.goto(`/project/${project.id}/boards?panel=automations`);
      const inventory = page.getByRole("complementary", {
        name: "Automations",
      });
      await expect(
        inventory.getByText(importedName, { exact: true }),
      ).toBeVisible();
    } finally {
      await deleteProject(page, project.id);
    }
  },
);

test(
  "automation clone created through the supported API preserves graph data in the primary workspace",
  { tag: ["@release", "@workspace", "@api"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page);
    await createBoard(page, project.id);
    const original = await createFlow(
      page,
      project.id,
      `Original ${crypto.randomUUID().slice(0, 8)}`,
    );
    const copyResponse = await page.request.post("/api/v1/flows/", {
      data: {
        name: `${original.name} copy`,
        description: original.description,
        folder_id: project.id,
        data: original.data,
      },
    });
    expect(copyResponse.status(), await copyResponse.text()).toBe(201);
    const copy = (await copyResponse.json()) as Flow;

    try {
      expect(copy.id).not.toBe(original.id);
      expect(copy.data).toEqual(original.data);
      await page.goto(`/project/${project.id}/boards?panel=automations`);
      const inventory = page.getByRole("complementary", {
        name: "Automations",
      });
      await expect(
        inventory.getByText(original.name, { exact: true }),
      ).toBeVisible();
      await expect(
        inventory.getByText(copy.name, { exact: true }),
      ).toBeVisible();
    } finally {
      await deleteProject(page, project.id);
    }
  },
);
