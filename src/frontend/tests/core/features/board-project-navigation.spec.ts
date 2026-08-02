import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";

type Entity = { id: string };
type Project = Entity & { name: string };
type Board = Entity & { title: string };
type Flow = Entity & { name: string; folder_id: string };
type Placement = Entity & {
  board_id: string;
  target_id: string;
  target_kind: "automation";
};

async function createProject(page: Page): Promise<Project> {
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      name: `D4 navigation ${crypto.randomUUID().slice(0, 8)}`,
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
    { data: { title: "Primary workspace" } },
  );
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function createFlow(page: Page, projectId: string): Promise<Flow> {
  const response = await page.request.post("/api/v1/flows/", {
    data: {
      name: "Existing project automation",
      description: "Inventory acceptance",
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

async function awaitWorkspaceReady(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("project-sidebar")).toBeVisible();
}

test(
  "project plus menu scopes Board creation and automation continuation",
  { tag: ["@release", "@workspace", "@api", "@database", "@a11y"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page);
    const board = await createBoard(page, project.id);
    try {
      await page.reload();
      const trigger = page.getByTestId(
        `project-create-menu-trigger-${project.id}`,
      );
      await expect(trigger).toHaveAccessibleName(`Create in ${project.name}`);

      await trigger.press("Enter");
      const createBoardItem = page.getByTestId(
        `project-create-board-item-${project.id}`,
      );
      await expect(createBoardItem).toBeVisible();
      await createBoardItem.click();
      await expect(page.getByTestId("board-create-dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("board-create-dialog")).toBeHidden();
      await expect(trigger).toBeFocused();

      await trigger.press("Enter");
      const createAutomationItem = page.getByTestId(
        `project-create-automation-item-${project.id}`,
      );
      await expect(createAutomationItem).toBeVisible();
      await createAutomationItem.click();
      const picker = page.getByTestId("board-picker-dialog");
      await expect(picker).toBeVisible();
      await picker.getByRole("button", { name: board.title }).click();
      await expect(page).toHaveURL(
        new RegExp(
          `/project/${project.id}/board/${board.id}\\?open-add-automation=1`,
        ),
      );
      await expect(
        page.getByRole("heading", { name: "Automations" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Create and edit" }),
      ).toBeVisible();
    } finally {
      await deleteProject(page, project.id);
    }
  },
);

test(
  "Board inventory places an existing Flow and completes the editor round-trip",
  { tag: ["@release", "@workspace", "@api", "@database", "@a11y"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page);
    const board = await createBoard(page, project.id);
    const flow = await createFlow(page, project.id);
    try {
      await page.goto(`/project/${project.id}/boards?panel=automations`);
      await expect(
        page.getByRole("heading", { name: "Boards", exact: true }),
      ).toBeVisible();
      const inventory = page.getByRole("complementary", {
        name: "Automations",
      });
      await expect(inventory).toBeVisible();
      await expect(page.getByText(flow.name)).toBeVisible();
      await expect(page.getByText("Not placed on this Board")).toBeVisible();

      const placementPromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v1/boards/${board.id}/placements` &&
          response.status() === 201,
      );
      await page
        .getByRole("button", {
          name: `Place ${flow.name} on this Board`,
        })
        .click();
      const placement = (await (await placementPromise).json()) as Placement;
      expect(placement).toMatchObject({
        board_id: board.id,
        target_id: flow.id,
        target_kind: "automation",
      });
      await expect(page.getByText("Placed on this Board")).toBeVisible();

      await page
        .getByRole("button", {
          name: `Open ${flow.name} in the automation editor`,
        })
        .click();
      await expect(page).toHaveURL(
        new RegExp(
          `/flow/${flow.id}\\?returnBoardId=${board.id}&returnPlacementId=${placement.id}`,
        ),
      );
      await expect(page.locator("#react-flow-id")).toBeVisible();
      await page.getByTestId("return-to-board").click();
      await expect(page).toHaveURL(
        new RegExp(
          `/project/${project.id}/board/${board.id}\\?focusPlacementId=${placement.id}`,
        ),
      );
      await expect(
        page.locator(`[data-id="${placement.id}"] > section`),
      ).toBeFocused();
    } finally {
      await deleteProject(page, project.id);
    }
  },
);

test(
  "account resources remain in the account menu and legacy project URLs bridge once",
  { tag: ["@release", "@workspace", "@a11y"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page);
    try {
      await page.reload();
      await page.getByTestId("user_menu_button").click();
      await expect(page.getByTestId("account-menu-knowledge-bases")).toHaveText(
        "Knowledge Bases",
      );
      await expect(page.getByTestId("account-menu-my-files")).toHaveText(
        "My Files",
      );
      await expect(
        page.locator('[data-testid="project-sidebar"]').getByText("My Files"),
      ).toHaveCount(0);

      await page.goto(`/all/folder/${project.id}`);
      await expect(page).toHaveURL(
        new RegExp(`/project/${project.id}/boards\\?panel=automations$`),
      );
      const stableUrl = page.url();
      await expect(
        page.getByRole("heading", { name: "Boards", exact: true }),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(page.url()).toBe(stableUrl);
    } finally {
      await deleteProject(page, project.id);
    }
  },
);
