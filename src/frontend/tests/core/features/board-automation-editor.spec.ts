import type { APIResponse, Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

type Entity = { id: string };
type Project = Entity & { name: string };
type Flow = Entity & {
  name: string;
  description: string | null;
  folder_id: string;
};
type Placement = Entity & {
  board_id: string;
  target_id: string;
  target_kind: "automation";
  x: number;
  y: number;
  width: number;
  height: number;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function createProject(page: Page, name: string): Promise<Project> {
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      name,
      description: "",
      flows_list: [],
      components_list: [],
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createBoard(
  page: Page,
  projectId: string,
): Promise<Entity & { title: string }> {
  const response = await page.request.post(
    `/api/v1/projects/${projectId}/boards`,
    { data: { title: "Automation roundtrip" } },
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function readPlacements(
  page: Page,
  boardId: string,
): Promise<Placement[]> {
  const response = await page.request.get(
    `/api/v1/boards/${boardId}/placements`,
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}

const isWrite = (response: APIResponse, method: string, pathname: string) =>
  response.request().method() === method &&
  new URL(response.url()).pathname === pathname &&
  response.ok();

test(
  "Automation Placement uses one existing Flow editor and durable Board return",
  { tag: ["@release", "@workspace", "@api", "@database", "@a11y"] },
  async ({ page, context }) => {
    await awaitBootstrapTest(page, { skipModal: true });
    await page.setViewportSize({ width: 1440, height: 900 });

    const projectsBefore = await page.request.get("/api/v1/projects/");
    expect(projectsBefore.ok()).toBeTruthy();
    const defaultProject = ((await projectsBefore.json()) as Project[])[0];
    expect(defaultProject.id).toMatch(UUID);

    const project = await createProject(
      page,
      `S06 ${Date.now().toString(36)} automation`,
    );
    expect(project.id).not.toBe(defaultProject.id);
    const board = await createBoard(page, project.id);
    await page.goto(`/project/${project.id}/board/${board.id}`);
    await expect(
      page.getByRole("heading", { name: "Automation roundtrip" }),
    ).toBeVisible();

    const flowCreate = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/flows/" &&
        response.status() === 201,
    );
    const placementCreate = page.waitForResponse((response) =>
      isWrite(response, "POST", `/api/v1/boards/${board.id}/placements`),
    );
    await page.getByRole("button", { name: "Add automation" }).first().click();
    await page.getByRole("button", { name: "Add automation" }).last().click();

    const flow = (await (await flowCreate).json()) as Flow;
    const placement = (await (await placementCreate).json()) as Placement;
    expect(flow.id).toMatch(UUID);
    expect(flow.folder_id).toBe(project.id);
    expect(placement).toMatchObject({
      board_id: board.id,
      target_kind: "automation",
      target_id: flow.id,
    });
    expect(await readPlacements(page, board.id)).toHaveLength(1);

    const card = page.locator(`[data-id="${placement.id}"] > section`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(flow.name);
    await expect(card.getByRole("button", { name: "Run" })).toHaveCount(0);
    const edit = card.getByRole("link", { name: "Edit automation" });
    const editorHref = await edit.getAttribute("href");
    expect(editorHref).toBe(
      `/flow/${flow.id}?returnBoardId=${board.id}&returnPlacementId=${placement.id}`,
    );

    await edit.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/flow/${flow.id}\\?`));
    await expect(page.locator("#react-flow-id")).toBeVisible();
    await expect(page.getByTestId("return-to-board")).toBeVisible();

    const savedName = `S06 saved ${Date.now().toString(36)}`;
    await page.getByTestId("flow_name").click();
    const nameInput = page.getByTestId("input-flow-name");
    await nameInput.fill(savedName);
    const flowPatch = page.waitForResponse((response) =>
      isWrite(response, "PATCH", `/api/v1/flows/${flow.id}`),
    );
    await page.getByTestId("save-flow-settings").click();
    await flowPatch;
    await expect(page.getByTestId("input-flow-name")).toBeHidden();

    const durableEditorUrl = page.url();
    expect(durableEditorUrl).toContain(`returnBoardId=${board.id}`);
    expect(durableEditorUrl).toContain(`returnPlacementId=${placement.id}`);
    await page.reload();
    await expect(page.getByTestId("flow_name")).toHaveText(savedName);
    await expect(page.getByTestId("return-to-board")).toBeVisible();

    const newTab = await context.newPage();
    await newTab.goto(durableEditorUrl);
    await expect(newTab.locator("#react-flow-id")).toBeVisible();
    await expect(newTab.getByTestId("return-to-board")).toBeVisible();
    await newTab.getByTestId("return-to-board").focus();
    await newTab.keyboard.press("Enter");
    await expect(newTab).toHaveURL(
      new RegExp(
        `/project/${project.id}/board/${board.id}\\?focusPlacementId=${placement.id}`,
      ),
    );
    const returnedCard = newTab.locator(
      `[data-id="${placement.id}"] > section`,
    );
    await expect(returnedCard).toBeFocused();
    const placementsAfterReturn = await readPlacements(newTab, board.id);
    expect(placementsAfterReturn).toHaveLength(1);
    expect(placementsAfterReturn[0]).toMatchObject({
      id: placement.id,
      target_id: flow.id,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    });

    const foreignProject = await createProject(
      page,
      `S06 foreign ${Date.now().toString(36)}`,
    );
    const foreignBoard = await createBoard(page, foreignProject.id);
    const invalidTab = await context.newPage();
    await invalidTab.goto(
      `/flow/${flow.id}?returnBoardId=${foreignBoard.id}&returnPlacementId=${placement.id}`,
    );
    await expect(invalidTab.locator("#react-flow-id")).toBeVisible();
    await expect(invalidTab.getByTestId("return-to-board")).toHaveCount(0);

    for (const suffix of ["", `/folder/${project.id}`, "/view"]) {
      await invalidTab.goto(`/flow/${flow.id}${suffix}`);
      await expect(invalidTab.locator("#react-flow-id")).toBeVisible();
      await expect(invalidTab.getByTestId("return-to-board")).toHaveCount(0);
    }

    const flagOffPage = await context.newPage();
    await flagOffPage.route("**/api/v1/config", async (route) => {
      const response = await route.fetch();
      const config = (await response.json()) as {
        feature_flags: Record<string, unknown>;
      };
      await route.fulfill({
        response,
        json: {
          ...config,
          feature_flags: { ...config.feature_flags, mvp_workspace: false },
        },
      });
    });
    await flagOffPage.goto(`/project/${project.id}/board/${board.id}`);
    await expect(flagOffPage).toHaveURL(/\/flows\/?$/);
    await expect(
      flagOffPage.getByRole("button", { name: "Add automation" }),
    ).toHaveCount(0);
    await flagOffPage.goto(`/flow/${flow.id}`);
    await expect(flagOffPage.locator("#react-flow-id")).toBeVisible();
    expect(await readPlacements(page, board.id)).toHaveLength(1);
    const storedFlow = await page.request.get(`/api/v1/flows/${flow.id}`);
    expect(storedFlow.ok()).toBeTruthy();
    expect(((await storedFlow.json()) as Flow).name).toBe(savedName);

    await newTab.close();
    await invalidTab.close();
    await flagOffPage.close();
  },
);
