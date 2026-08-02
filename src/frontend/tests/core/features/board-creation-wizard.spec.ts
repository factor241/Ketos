import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";

type Project = { id: string; name: string };
type Board = { id: string; project_id: string; title: string };
type Flow = { id: string; folder_id: string; name: string };
type Placement = {
  id: string;
  board_id: string;
  target_id: string;
  target_kind: "automation";
};
type BootstrapResult = {
  board: Board;
  automation: Flow | null;
  placement: Placement | null;
  idempotency_replayed: boolean;
};

async function createProject(page: Page, label: string): Promise<Project> {
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      name: `D4 ${label} ${crypto.randomUUID().slice(0, 8)}`,
      description: "",
      flows_list: [],
      components_list: [],
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

async function openWizard(page: Page, projectId: string) {
  await page.goto(`/project/${projectId}/boards`);
  await page.getByRole("button", { name: "Create board" }).first().click();
  await expect(page.getByTestId("board-create-dialog")).toBeVisible();
  await expect(page.getByTestId("board-name-input")).toBeFocused();
}

async function submitStarter(
  page: Page,
  projectId: string,
  title: string,
  starterTestId: string,
): Promise<BootstrapResult> {
  await openWizard(page, projectId);
  await page.getByTestId("board-name-input").fill(title);
  const starter = page.getByTestId(starterTestId);
  await starter.locator("..").click();
  await expect(starter).toBeChecked();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/v1/projects/${projectId}/boards/bootstrap`,
  );
  await page.getByTestId("board-create-submit").click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  const result = (await response.json()) as BootstrapResult;
  await expect(page).toHaveURL(
    new RegExp(`/project/${projectId}/board/${result.board.id}`),
  );
  return result;
}

test(
  "clean, Simple Agent, and RAG starters create one atomic Board result each",
  { tag: ["@release", "@workspace", "@api", "@database", "@a11y"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page, "wizard starters");
    try {
      const cases = [
        ["Clean acceptance", "board-template-clean", null],
        ["Agent acceptance", "board-template-simple-agent", "Simple Agent"],
        [
          "RAG acceptance",
          "board-template-vector-store-rag",
          "Vector Store RAG",
        ],
      ] as const;

      for (const [title, starterTestId, expectedAutomationName] of cases) {
        const result = await submitStarter(
          page,
          project.id,
          title,
          starterTestId,
        );
        expect(result.board).toMatchObject({
          project_id: project.id,
          title,
        });
        expect(result.idempotency_replayed).toBe(false);
        if (expectedAutomationName === null) {
          expect(result.automation).toBeNull();
          expect(result.placement).toBeNull();
        } else {
          expect(result.automation).toMatchObject({
            folder_id: project.id,
            name: expectedAutomationName,
          });
          expect(result.placement).toMatchObject({
            board_id: result.board.id,
            target_id: result.automation?.id,
            target_kind: "automation",
          });
        }
      }
    } finally {
      await deleteProject(page, project.id);
    }
  },
);

test(
  "gallery selection clones a real template into the disposable project",
  { tag: ["@release", "@workspace", "@api", "@database"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page, "wizard gallery");
    try {
      await openWizard(page, project.id);
      await page.getByTestId("board-name-input").fill("Gallery acceptance");
      await page.getByTestId("board-template-browse-more").click();
      const gallery = page.getByTestId("board-create-dialog");
      const template = gallery.locator("ul button").first();
      await expect(template).toBeVisible();
      const templateName = (await template.innerText()).split("\n")[0].trim();
      await template.click();
      await expect(gallery).toContainText(`Selected template: ${templateName}`);

      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v1/projects/${project.id}/boards/bootstrap`,
      );
      await page.getByTestId("board-create-submit").click();
      const response = await responsePromise;
      expect(response.status(), await response.text()).toBe(201);
      const result = (await response.json()) as BootstrapResult;
      expect(result.automation).toMatchObject({
        folder_id: project.id,
        name: templateName,
      });
      expect(result.placement?.target_id).toBe(result.automation?.id);
    } finally {
      await deleteProject(page, project.id);
    }
  },
);

test(
  "synchronous double submit emits one compound command",
  { tag: ["@release", "@workspace", "@api", "@database"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page, "wizard duplicate");
    try {
      await openWizard(page, project.id);
      await page.getByTestId("board-name-input").fill("Exactly once");
      let commandCount = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname ===
            `/api/v1/projects/${project.id}/boards/bootstrap`
        ) {
          commandCount += 1;
        }
      });
      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v1/projects/${project.id}/boards/bootstrap`,
      );
      await page.getByTestId("board-create-submit").evaluate((button) => {
        const form = button.closest("form");
        if (!(form instanceof HTMLFormElement)) {
          throw new Error("Board creation form is missing");
        }
        form.requestSubmit();
        form.requestSubmit();
      });
      const response = await responsePromise;
      expect(response.status(), await response.text()).toBe(201);
      await expect
        .poll(async () => {
          const boards = await page.request.get(
            `/api/v1/projects/${project.id}/boards`,
          );
          return ((await boards.json()) as Board[]).length;
        })
        .toBe(1);
      expect(commandCount).toBe(1);
    } finally {
      await deleteProject(page, project.id);
    }
  },
);

test(
  "injected first command failure leaves no orphan and retry reuses the key",
  { tag: ["@release", "@workspace", "@api", "@database", "@a11y"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page, "wizard rollback");
    const commandPath = `/api/v1/projects/${project.id}/boards/bootstrap`;
    const keys: string[] = [];
    let failNext = true;
    await page.route(`**${commandPath}`, async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (failNext) {
        failNext = false;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "injected placement failure" }),
        });
        return;
      }
      await route.continue();
    });

    try {
      await openWizard(page, project.id);
      await page.getByTestId("board-name-input").fill("Retryable Board");
      const starter = page.getByTestId("board-template-simple-agent");
      await starter.locator("..").click();
      await expect(starter).toBeChecked();
      await page.getByTestId("board-create-submit").click();
      await expect(page.getByRole("alert")).toContainText(
        "The Board could not be created",
      );
      const boardsAfterFailure = await page.request.get(
        `/api/v1/projects/${project.id}/boards`,
      );
      expect((await boardsAfterFailure.json()) as Board[]).toEqual([]);
      const flowsAfterFailure = await page.request.get(
        `/api/v1/flows/?automation_summaries=true&folder_id=${project.id}`,
      );
      expect((await flowsAfterFailure.json()) as Flow[]).toEqual([]);

      const retryPromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === commandPath &&
          response.status() === 201,
      );
      await page.getByTestId("board-create-submit").click();
      const retry = await retryPromise;
      const result = (await retry.json()) as BootstrapResult;
      expect(result.automation?.folder_id).toBe(project.id);
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe(keys[1]);
    } finally {
      await page.unroute(`**${commandPath}`);
      await deleteProject(page, project.id);
    }
  },
);
