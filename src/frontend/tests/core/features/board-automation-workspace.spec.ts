import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";

type Project = { id: string };
type Board = { id: string; title: string };
type Flow = { id: string; folder_id: string; name: string };
type Placement = {
  id: string;
  board_id: string;
  target_id: string;
  target_kind: "automation" | "chat" | "job_result";
};
type AutomationResult = {
  automation: Flow;
  placement: Placement;
  idempotency_replayed: boolean;
};
type BoardChatResult = {
  chat: {
    id: string;
    project_id: string;
    provider: string;
    model_name: string;
    context_policy: "board";
  };
  placement: Placement;
  idempotency_replayed: boolean;
};

async function createProject(page: Page): Promise<Project> {
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      name: `D4 workspace ${crypto.randomUUID().slice(0, 8)}`,
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
    { data: { title: "Automation workspace" } },
  );
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function deleteProject(page: Page, projectId: string) {
  const response = await page.request.delete(`/api/v1/projects/${projectId}`, {
    timeout: 30_000,
  });
  expect([204, 404]).toContain(response.status());
}

async function awaitWorkspaceReady(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("project-sidebar")).toBeVisible();
}

async function readPlacements(
  page: Page,
  boardId: string,
): Promise<Placement[]> {
  const response = await page.request.get(
    `/api/v1/boards/${boardId}/placements`,
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function installTrustedTextInput(page: Page, flowId: string) {
  const typesResponse = await page.request.get("/api/v1/all");
  expect(typesResponse.ok(), await typesResponse.text()).toBeTruthy();
  const types = (await typesResponse.json()) as Record<
    string,
    Record<string, unknown>
  >;
  const textInput = Object.values(types)
    .map((category) => category.TextInput)
    .find(
      (component): component is Record<string, unknown> =>
        typeof component === "object" && component !== null,
    );
  expect(textInput).toBeDefined();

  const update = await page.request.patch(`/api/v1/flows/${flowId}`, {
    data: {
      data: {
        nodes: [
          {
            id: "TextInput-block-d",
            type: "genericNode",
            position: { x: 100, y: 100 },
            data: {
              id: "TextInput-block-d",
              type: "TextInput",
              node: textInput,
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    },
  });
  expect(update.ok(), await update.text()).toBeTruthy();
}

test(
  "Board automation uses the full Flow editor, saves, returns, runs, and keeps chat scopes separate",
  { tag: ["@release", "@workspace", "@api", "@database", "@a11y"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page);
    const board = await createBoard(page, project.id);
    await page.route(/\/api\/v1\/models(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            provider: "OpenAI",
            models: [{ model_name: "gpt-4o-mini", metadata: {} }],
            is_enabled: true,
            is_configured: true,
          },
        ]),
      });
    });

    try {
      await page.goto(`/project/${project.id}/board/${board.id}`);
      await expect(
        page.getByRole("heading", { name: board.title }),
      ).toBeVisible();

      const automationPromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v1/boards/${board.id}/automations`,
        { timeout: 30_000 },
      );
      await page.getByRole("button", { name: "Add automation" }).click();
      await page.getByRole("button", { name: "Create and edit" }).click();
      const automationResponse = await automationPromise;
      expect(automationResponse.status(), await automationResponse.text()).toBe(
        201,
      );
      const automation = (await automationResponse.json()) as AutomationResult;
      expect(automation.idempotency_replayed).toBe(false);
      expect(automation.placement).toMatchObject({
        board_id: board.id,
        target_id: automation.automation.id,
        target_kind: "automation",
      });
      await expect(page).toHaveURL(
        new RegExp(`/flow/${automation.automation.id}\\?returnBoardId=`),
      );
      await expect(page.locator("#react-flow-id")).toBeVisible({
        timeout: 60_000,
      });

      for (const category of ["input & output", "data sources", "processing"]) {
        await expect(page.getByTestId(`disclosure-${category}`)).toBeVisible();
      }

      const savedName = `Saved D4 ${crypto.randomUUID().slice(0, 8)}`;
      await page.getByTestId("flow_name").click();
      await page.getByTestId("input-flow-name").fill(savedName);
      const savePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname ===
            `/api/v1/flows/${automation.automation.id}` &&
          response.ok(),
      );
      await page.getByTestId("save-flow-settings").click();
      await savePromise;
      await page.getByTestId("return-to-board").click();
      await expect(page).toHaveURL(
        new RegExp(
          `/project/${project.id}/board/${board.id}\\?focusPlacementId=${automation.placement.id}`,
        ),
      );
      await expect(
        page.locator(`[data-id="${automation.placement.id}"] > section`),
      ).toBeFocused();

      await installTrustedTextInput(page, automation.automation.id);
      await page.reload();
      const automationCard = page.locator(
        `[data-id="${automation.placement.id}"] > section`,
      );
      await expect(automationCard).toContainText(savedName);
      const runPromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v1/boards/${board.id}/automations/${automation.automation.id}/runs`,
      );
      await automationCard.getByRole("button", { name: "Run" }).click();
      const runResponse = await runPromise;
      expect(runResponse.status(), await runResponse.text()).toBe(202);
      await expect(automationCard.getByRole("status")).toContainText(
        /Queued|Running|Succeeded/,
      );

      let boardChatCommands = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === `/api/v1/boards/${board.id}/chats`
        ) {
          boardChatCommands += 1;
        }
      });
      const boardChatPromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v1/boards/${board.id}/chats`,
      );
      const boardChatButton = page.getByRole("button", {
        name: "Create chat in Board",
      });
      await expect(boardChatButton).toBeEnabled();
      await boardChatButton.click();
      const boardChatResponse = await boardChatPromise;
      expect(boardChatResponse.status(), await boardChatResponse.text()).toBe(
        201,
      );
      const boardChat = (await boardChatResponse.json()) as BoardChatResult;
      expect(boardChat).toMatchObject({
        chat: {
          project_id: project.id,
          provider: "OpenAI",
          model_name: "gpt-4o-mini",
          context_policy: "board",
        },
        placement: {
          board_id: board.id,
          target_kind: "chat",
        },
        idempotency_replayed: false,
      });

      const boardChatPlacementCount = (
        await readPlacements(page, board.id)
      ).filter((placement) => placement.target_kind === "chat").length;
      expect(boardChatPlacementCount).toBe(1);
      await page.goto(`/flow/${automation.automation.id}`);
      const standaloneChat = page.getByTestId("canvas-create-chat-button");
      await expect(standaloneChat).toHaveAccessibleName("Create chat");
      await standaloneChat.click();
      await expect(
        page.getByRole("region", { name: "Chat panel" }),
      ).toBeVisible();
      expect(boardChatCommands).toBe(1);
      expect(
        (await readPlacements(page, board.id)).filter(
          (placement) => placement.target_kind === "chat",
        ),
      ).toHaveLength(1);
    } finally {
      await page.unroute(/\/api\/v1\/models(?:\?.*)?$/);
      await page
        .goto("/", { waitUntil: "commit", timeout: 10_000 })
        .catch(() => undefined);
      await deleteProject(page, project.id);
    }
  },
);
