import type { Page, Request } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

type Entity = { id: string };
type Project = Entity & { name: string };
type Board = Entity & { title: string };
type Flow = Entity & { folder_id: string };
type Placement = Entity & {
  target_kind: "automation" | "job_result";
  target_id: string;
};
type AutomationCommandResult = {
  automation: Flow;
  placement: Placement;
  idempotency_replayed: boolean;
};
type Execution = {
  job_id: string;
  board_id: string;
  flow_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  reason: string | null;
};

async function createProject(page: Page): Promise<Project> {
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      name: `S07 ${Date.now().toString(36)} execution`,
      description: "",
      flows_list: [],
      components_list: [],
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createBoard(page: Page, projectId: string): Promise<Board> {
  const response = await page.request.post(
    `/api/v1/projects/${projectId}/boards`,
    { data: { title: "Stage 07 execution" } },
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function placements(page: Page, boardId: string): Promise<Placement[]> {
  const response = await page.request.get(
    `/api/v1/boards/${boardId}/placements`,
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function installTrustedTextInput(page: Page, flowId: string) {
  const typesResponse = await page.request.get("/api/v1/all");
  expect(typesResponse.ok()).toBeTruthy();
  const types = (await typesResponse.json()) as Record<
    string,
    Record<string, unknown>
  >;
  const textInput = Object.values(types)
    .filter(
      (category): category is Record<string, unknown> =>
        typeof category === "object" && category !== null,
    )
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
            id: "TextInput-stage07",
            type: "genericNode",
            position: { x: 100, y: 100 },
            data: {
              id: "TextInput-stage07",
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

const hasApiKey = (request: Request) =>
  Object.keys(request.headers()).some(
    (name) => name.toLowerCase() === "x-api-key",
  );

test(
  "Board Automation runs through the session v1 Job facade and restores one durable Result",
  { tag: ["@release", "@workspace", "@api", "@database", "@a11y"] },
  async ({ page }) => {
    await awaitBootstrapTest(page, { skipModal: true });
    await page.setViewportSize({ width: 1440, height: 900 });

    const project = await createProject(page);
    const board = await createBoard(page, project.id);
    const boardRequests: Request[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.includes(
          `/api/v1/boards/${board.id}/automations/`,
        )
      )
        boardRequests.push(request);
    });

    await page.goto(`/project/${project.id}/board/${board.id}`);
    await expect(
      page.getByRole("heading", { name: "Stage 07 execution" }),
    ).toBeVisible();

    const automationCreated = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/v1/boards/${board.id}/automations` &&
        response.status() === 201,
    );
    await page.getByRole("button", { name: "Add automation" }).first().click();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const command = (await (
      await automationCreated
    ).json()) as AutomationCommandResult;
    const flow = command.automation;
    expect(command.placement.target_id).toBe(flow.id);
    expect(command.idempotency_replayed).toBe(false);
    await installTrustedTextInput(page, flow.id);
    await expect
      .poll(async () =>
        (await placements(page, board.id)).some(
          (item) => item.target_kind === "automation",
        ),
      )
      .toBe(true);
    const automation = (await placements(page, board.id)).find(
      (item) => item.target_kind === "automation",
    ) as Placement;

    const automationCard = page.locator(
      `[data-id="${automation.id}"] > section`,
    );
    const run = automationCard.getByRole("button", { name: "Run" });
    await expect(run).toBeEnabled();

    const createRun = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/v1/boards/${board.id}/automations/${flow.id}/runs`,
      { timeout: 60_000 },
    );
    await run.focus();
    await page.keyboard.press("Enter");
    const createResponse = await createRun;
    expect(createResponse.status(), await createResponse.text()).toBe(202);
    const accepted = (await createResponse.json()) as Execution;
    const idempotencyKey = (
      createResponse.request().postDataJSON() as {
        idempotency_key: string;
      }
    ).idempotency_key;

    expect(accepted.board_id).toBe(board.id);
    expect(accepted.flow_id).toBe(flow.id);
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(automationCard.getByRole("status")).toContainText(
      /Queued|Running|Succeeded/,
    );
    await expect(automationCard).toContainText("Succeeded", {
      timeout: 60_000,
    });
    await expect(automationCard).toContainText("The result is ready");

    await expect
      .poll(async () =>
        (await placements(page, board.id)).some(
          (item) =>
            item.target_kind === "job_result" &&
            item.target_id === accepted.job_id,
        ),
      )
      .toBe(true);
    const result = (await placements(page, board.id)).find(
      (item) =>
        item.target_kind === "job_result" && item.target_id === accepted.job_id,
    ) as Placement;
    const resultCard = page.locator(`[data-id="${result.id}"] > section`);
    await expect(resultCard).toBeVisible();
    await expect(resultCard).not.toBeFocused();

    const openResult = automationCard.getByRole("button", {
      name: "Open result",
    });
    await openResult.focus();
    await page.keyboard.press("Enter");
    await expect(resultCard).toBeFocused({ timeout: 15_000 });

    const replayOne = await page.request.post(
      `/api/v1/boards/${board.id}/automations/${flow.id}/runs`,
      { data: { idempotency_key: idempotencyKey } },
    );
    const replayTwo = await page.request.post(
      `/api/v1/boards/${board.id}/automations/${flow.id}/runs`,
      { data: { idempotency_key: idempotencyKey } },
    );
    expect(replayOne.status()).toBe(202);
    expect(replayTwo.status()).toBe(202);
    expect(((await replayOne.json()) as Execution).job_id).toBe(
      accepted.job_id,
    );
    expect(((await replayTwo.json()) as Execution).job_id).toBe(
      accepted.job_id,
    );

    await page.reload();
    await expect(
      page.locator(`[data-id="${automation.id}"] > section`),
    ).toContainText("Succeeded");
    await expect(
      page.locator(`[data-id="${result.id}"] > section`),
    ).toBeVisible();
    const restored = await placements(page, board.id);
    expect(
      restored.filter(
        (item) =>
          item.target_kind === "job_result" &&
          item.target_id === accepted.job_id,
      ),
    ).toHaveLength(1);

    const history = await page.request.get(
      `/api/v1/boards/${board.id}/automations/${flow.id}/runs`,
    );
    expect(history.ok()).toBeTruthy();
    expect(
      ((await history.json()) as Execution[]).filter(
        (execution) => execution.job_id === accepted.job_id,
      ),
    ).toHaveLength(1);
    expect(boardRequests.some(hasApiKey)).toBe(false);

    await page.goto(`/flow/${flow.id}`);
    await expect(page.locator("#react-flow-id")).toBeVisible();
  },
);

test(
  "Board execution renders failure, timeout, cancel, and both disconnect states without false success",
  { tag: ["@release", "@workspace", "@a11y"] },
  async ({ page, context }) => {
    await awaitBootstrapTest(page, { skipModal: true });
    const project = await createProject(page);
    const board = await createBoard(page, project.id);
    await page.goto(`/project/${project.id}/board/${board.id}`);

    const automationCreated = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/v1/boards/${board.id}/automations` &&
        response.status() === 201,
    );
    await page.getByRole("button", { name: "Add automation" }).first().click();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const command = (await (
      await automationCreated
    ).json()) as AutomationCommandResult;
    const flow = command.automation;
    expect(command.placement.target_id).toBe(flow.id);
    expect(command.idempotency_replayed).toBe(false);
    await expect
      .poll(async () =>
        (await placements(page, board.id)).some(
          (item) => item.target_kind === "automation",
        ),
      )
      .toBe(true);
    const automation = (await placements(page, board.id)).find(
      (item) => item.target_kind === "automation",
    ) as Placement;
    const card = page.locator(`[data-id="${automation.id}"] > section`);
    const runsPath = `/api/v1/boards/${board.id}/automations/${flow.id}/runs`;
    let outcome: "failure" | "timeout" | "cancel" = "failure";
    let current: Execution | null = null;
    let pollCount = 0;
    let jobCounter = 0;
    let offlineBeforeIdentity = false;
    let offlineAfterIdentity = false;
    let offlineIntentKey: string | null = null;
    const intentKeys: string[] = [];
    const dto = (
      status: Execution["status"],
      reason: string | null = null,
    ): Execution & {
      created_timestamp: string;
      finished_timestamp: string | null;
      result: null;
    } => ({
      job_id:
        current?.job_id ??
        `00000000-0000-4000-8000-${String(jobCounter).padStart(12, "0")}`,
      board_id: board.id,
      flow_id: flow.id,
      status,
      reason,
      created_timestamp: "2026-07-21T00:00:00Z",
      finished_timestamp: ["failed", "cancelled"].includes(status)
        ? "2026-07-21T00:00:01Z"
        : null,
      result: null,
    });

    await page.route(`**${runsPath}**`, async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === runsPath && request.method() === "GET") {
        await route.fulfill({ json: current ? [current] : [] });
        return;
      }
      if (pathname === runsPath && request.method() === "POST") {
        const body = request.postDataJSON() as { idempotency_key: string };
        intentKeys.push(body.idempotency_key);
        if (offlineBeforeIdentity) {
          if (offlineIntentKey !== body.idempotency_key) {
            offlineIntentKey = body.idempotency_key;
            jobCounter += 1;
            current = null;
            current = dto("queued");
            pollCount = 0;
          }
          await route.abort("failed");
          return;
        }
        if (offlineIntentKey === body.idempotency_key && current) {
          offlineIntentKey = null;
          await route.fulfill({ status: 202, json: current });
          return;
        }
        jobCounter += 1;
        current = null;
        current = dto("queued");
        pollCount = 0;
        await route.fulfill({ status: 202, json: current });
        return;
      }
      if (pathname.endsWith("/cancel") && request.method() === "POST") {
        current = dto("cancelled", "user_cancelled");
        await route.fulfill({ json: current });
        return;
      }
      if (request.method() === "GET") {
        if (offlineAfterIdentity) {
          await route.abort("failed");
          return;
        }
        pollCount += 1;
        if (pollCount === 1) current = dto("running");
        else if (outcome === "timeout") current = dto("failed", "timed_out");
        else current = dto("failed", "execution_failed");
        await route.fulfill({ json: current });
        return;
      }
      await route.fallback();
    });

    await card.getByRole("button", { name: "Run" }).click();
    await expect(card).toContainText("Failed", { timeout: 15_000 });
    await expect(card).toContainText("The automation failed");
    await expect(card).not.toContainText("Succeeded");

    outcome = "timeout";
    await card.getByRole("button", { name: "Run again" }).click();
    await expect(card).toContainText("The automation timed out", {
      timeout: 15_000,
    });
    await expect(card).not.toContainText("Succeeded");

    outcome = "cancel";
    await card.getByRole("button", { name: "Run again" }).click();
    await expect(card).toContainText("Running", { timeout: 10_000 });
    await card.getByRole("button", { name: "Cancel" }).click();
    await expect(card).toContainText("Cancelled by you");
    await expect(card).not.toContainText("Succeeded");

    offlineBeforeIdentity = true;
    outcome = "failure";
    await card.getByRole("button", { name: "Run again" }).click();
    await expect(card).toContainText("Status unavailable", {
      timeout: 20_000,
    });
    const preIdentityKey = intentKeys.at(-1);
    expect(new Set(intentKeys.slice(-3))).toEqual(new Set([preIdentityKey]));
    offlineBeforeIdentity = false;
    const postsBeforeReconnect = intentKeys.length;
    await page.reload();
    await expect(card).toContainText("Failed", { timeout: 15_000 });
    expect(intentKeys.at(-1)).toBe(preIdentityKey);
    expect(intentKeys).toHaveLength(postsBeforeReconnect);

    offlineAfterIdentity = true;
    const postCountBefore = intentKeys.length;
    await card.getByRole("button", { name: "Run again" }).click();
    await expect(card).toContainText("Status unavailable", {
      timeout: 20_000,
    });
    offlineAfterIdentity = false;
    await page.reload();
    await expect(card).toContainText("Failed", { timeout: 15_000 });
    expect(intentKeys).toHaveLength(postCountBefore + 1);

    const gatedPage = await context.newPage();
    await gatedPage.route("**/api/v1/config", async (route) => {
      const response = await route.fetch();
      const config = (await response.json()) as {
        feature_flags: Record<string, unknown>;
      };
      await route.fulfill({
        response,
        json: {
          ...config,
          feature_flags: {
            ...config.feature_flags,
            agentic_experience: false,
          },
        },
      });
    });
    await gatedPage.goto(`/project/${project.id}/board/${board.id}`);
    await expect(
      gatedPage.locator(`[data-id="${automation.id}"]`),
    ).toBeVisible();
    await expect(gatedPage.getByRole("button", { name: "Run" })).toHaveCount(0);
    expect(await placements(page, board.id)).toContainEqual(
      expect.objectContaining({ id: automation.id }),
    );
    await gatedPage.close();
  },
);
