import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { APIResponse, Locator, Page, Request } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

type Entity = { id: string; revision: number };
type Chat = Entity & {
  project_id: string;
  title: string;
  provider: string;
  model_name: string;
  context_policy: string;
};
type Placement = Entity & {
  target_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  display_state: string;
};
type Stage05Ids = {
  projectId: string;
  boardId: string;
  chatIds: [string, string];
  titles: [string, string];
  prompt: string;
  answer: string;
};

const repositoryRoot = path.resolve(process.cwd(), "../..");
const evidenceRoot = path.join(
  repositoryRoot,
  "docs/evidence/stage-05/product-design",
);
const runRoot = process.env.KETOS_MVP_RUN_DIR;
const idsPath = runRoot ? path.join(runRoot, "stage05-ids.json") : "";
const providerPort = Number(process.env.STAGE05_OPENAI_PORT ?? "18765");
const prompt =
  "Use the current date tool for UTC, then answer: durable chat ready.";
const answer = "Durable chat ready after the read-only UTC date check.";
let providerServer: Server;
const providerSockets = new Set<Socket>();
let providerCalls = 0;

function completionChunk(
  id: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
) {
  return JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: 1_721_500_000,
    model: "gpt-4o-mini",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

function sendSse(
  response: import("node:http").ServerResponse,
  chunks: string[],
) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const chunk of chunks) response.write(`data: ${chunk}\n\n`);
  response.end("data: [DONE]\n\n");
}

test.beforeAll(async () => {
  providerServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "gpt-4o-mini", object: "model", owned_by: "stage05" }],
        }),
      );
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      providerCalls += 1;
      const payload = JSON.parse(body) as {
        messages?: Array<{ role?: string }>;
      };
      const hasToolResult = payload.messages?.some(
        (message) => message.role === "tool",
      );
      if (!hasToolResult) {
        sendSse(response, [
          completionChunk(
            "chatcmpl-stage05-tool",
            {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call-stage05-current-date",
                  type: "function",
                  function: {
                    name: "get_current_date",
                    arguments: '{"timezone":"UTC"}',
                  },
                },
              ],
            },
            null,
          ),
          completionChunk("chatcmpl-stage05-tool", {}, "tool_calls"),
        ]);
        return;
      }
      sendSse(response, [
        completionChunk(
          "chatcmpl-stage05-answer",
          { role: "assistant", content: answer },
          null,
        ),
        completionChunk("chatcmpl-stage05-answer", {}, "stop"),
      ]);
    });
  });
  providerServer.on("connection", (socket) => {
    providerSockets.add(socket);
    socket.once("close", () => providerSockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    providerServer.once("error", reject);
    providerServer.listen(providerPort, "127.0.0.1", resolve);
  });
  mkdirSync(evidenceRoot, { recursive: true });
});

test.afterAll(() => {
  for (const socket of providerSockets) socket.destroy();
  providerSockets.clear();
  providerServer.closeAllConnections();
  providerServer.close();
  providerServer.unref();
});

async function createProject(page: Page): Promise<Entity> {
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      name: `Stage 05 chat ${Date.now().toString(36)}`,
      description: "",
      flows_list: [],
      components_list: [],
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createBoard(page: Page, projectId: string): Promise<Entity> {
  const response = await page.request.post(
    `/api/v1/projects/${projectId}/boards`,
    { data: { title: "Durable chat board" } },
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createChat(
  page: Page,
  projectId: string,
  title: string,
): Promise<Chat> {
  const response = await page.request.post(
    `/api/v1/projects/${projectId}/chats`,
    {
      data: {
        title,
        provider: "OpenAI",
        model_name: "gpt-4o-mini",
        context_policy: "board",
      },
    },
  );
  expect(response.status()).toBe(201);
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

const placementWrite = (page: Page, placementId: string, method = "PATCH") =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === method &&
      url.pathname === `/api/v1/placements/${placementId}` &&
      response.ok()
    );
  });

async function awaitPlacementCommit(
  response: Promise<APIResponse>,
  card: Locator,
) {
  const committed = (await (await response).json()) as Entity;
  await expect(card).toHaveAttribute(
    "data-placement-revision",
    String(committed.revision),
  );
  return committed;
}

function readDurableRows(chatId: string) {
  if (!runRoot) throw new Error("KETOS_MVP_RUN_DIR is required");
  const database = new DatabaseSync(
    path.join(runRoot, "backend", "ketos.sqlite3"),
  );
  try {
    const chat = database
      .prepare(
        "SELECT provider, model_name, context_policy FROM chat_thread WHERE replace(id, '-', '') = ?",
      )
      .get(chatId.replaceAll("-", "")) as Record<string, unknown>;
    const runs = database
      .prepare(
        "SELECT count(*) AS count FROM chat_run WHERE replace(chat_id, '-', '') = ?",
      )
      .get(chatId.replaceAll("-", "")) as { count: number };
    const messages = database
      .prepare(
        "SELECT text, is_output, chat_sequence FROM message WHERE replace(chat_id, '-', '') = ? ORDER BY chat_sequence",
      )
      .all(chatId.replaceAll("-", "")) as Array<Record<string, unknown>>;
    return { chat, runs, messages };
  } finally {
    database.close();
  }
}

const isChatRun = (request: Request) =>
  request.method() === "POST" &&
  request.url().includes("/api/copilotkit/agent/ketos-chat/run");

async function openBoard(
  page: Page,
  ids: Pick<Stage05Ids, "projectId" | "boardId">,
) {
  await awaitBootstrapTest(page, { skipModal: true });
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto(`/project/${ids.projectId}/board/${ids.boardId}`);
  await expect(
    page.getByRole("heading", { name: "Durable chat board" }),
  ).toBeVisible();
}

test.describe("Stage 05 durable CopilotKit chat", () => {
  test(
    "real API and DB preserve two chats, tool lifecycle, placement lifecycle and focus",
    { tag: ["@release", "@workspace", "@api", "@database", "@a11y"] },
    async ({ page, context }) => {
      test.skip(
        process.env.KETOS_FEATURE_MVP_CHAT === "false" ||
          process.env.STAGE05_RESTORE_ONLY === "true",
        "main launch only",
      );
      if (!runRoot) throw new Error("KETOS_MVP_RUN_DIR is required");
      await awaitBootstrapTest(page, { skipModal: true });
      const project = await createProject(page);
      const board = await createBoard(page, project.id);
      const ids: Stage05Ids = {
        projectId: project.id,
        boardId: board.id,
        chatIds: ["", ""],
        titles: ["Release evidence", "Operations notes"],
        prompt,
        answer,
      };
      await openBoard(page, ids);

      await expect(page.getByRole("region", { name: "Chats" })).toBeVisible();
      await expect(
        page.getByText("No chats yet", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(evidenceRoot, "01-empty.png"),
        fullPage: true,
      });

      const search = page.getByRole("searchbox", { name: "Search chats" });
      await search.fill("definitely missing");
      await expect(
        page.getByText("No chats match your search", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(evidenceRoot, "02-search-no-results.png"),
        fullPage: true,
      });
      await search.fill("");

      const first = await createChat(page, project.id, ids.titles[0]);
      const second = await createChat(page, project.id, ids.titles[1]);
      ids.chatIds = [first.id, second.id];
      writeFileSync(idsPath, JSON.stringify(ids, null, 2));
      await page.reload();
      await expect(
        page.getByRole("button", { name: ids.titles[0] }),
      ).toBeVisible();

      await page.getByRole("button", { name: ids.titles[0] }).click();
      await expect(
        page.getByRole("region", { name: ids.titles[0] }),
      ).toBeFocused();
      await page.getByRole("button", { name: ids.titles[1] }).click();
      await expect(
        page.getByRole("region", { name: ids.titles[1] }),
      ).toBeFocused();
      let placements = await readPlacements(page, board.id);
      expect(
        placements.filter((item) => item.target_id === first.id),
      ).toHaveLength(1);
      expect(
        placements.filter((item) => item.target_id === second.id),
      ).toHaveLength(1);

      for (const [index, chat] of [first, second].entries()) {
        const placement = placements.find(
          (item) => item.target_id === chat.id,
        )!;
        const response = await page.request.patch(
          `/api/v1/placements/${placement.id}`,
          {
            data: {
              expected_revision: placement.revision,
              x: index === 0 ? 40 : 560,
              y: 40,
            },
          },
        );
        expect(response.ok()).toBeTruthy();
      }
      await page.reload();
      const firstCard = page.getByRole("region", { name: ids.titles[0] });
      const secondCard = page.getByRole("region", { name: ids.titles[1] });
      await expect(firstCard).toBeVisible();
      await expect(secondCard).toBeVisible();
      await page.screenshot({
        path: path.join(evidenceRoot, "03-two-chats.png"),
        fullPage: true,
      });

      const runRequests: Request[] = [];
      page.on("request", (request) => {
        if (isChatRun(request)) runRequests.push(request);
      });
      const textarea = firstCard.getByTestId("copilot-chat-textarea");
      await textarea.fill(prompt);
      const runRequestPromise = page.waitForRequest(isChatRun);
      const runResponsePromise = page.waitForResponse((response) =>
        isChatRun(response.request()),
      );
      await firstCard.getByTestId("copilot-send-button").click();
      const runRequest = await runRequestPromise;
      const runBody = runRequest.postDataJSON() as {
        threadId: string;
        state?: Record<string, unknown>;
      };
      expect(runBody.threadId).toBe(first.id);
      const runResponse = await runResponsePromise;
      const runText = await runResponse.text();
      expect(runResponse.status()).toBe(200);
      expect(runText).toContain("get_current_date");
      expect(runText).toMatch(/TOOL_CALL_START|tool_call_start/i);
      expect(runText).toContain(answer);
      await expect(firstCard.getByText(answer, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      expect(runRequests).toHaveLength(1);
      expect(Object.keys(runBody.state ?? {}).sort()).toEqual(
        Object.keys(runBody.state ?? {})
          .filter((key) => ["boardId", "projectId"].includes(key))
          .sort(),
      );
      expect(providerCalls).toBe(2);
      const replayResponse = await page.request.post(
        "/api/copilotkit/agent/ketos-chat/run",
        { data: runBody },
      );
      expect(replayResponse.ok()).toBeTruthy();
      expect(await replayResponse.text()).toMatch(/replayed.*true/i);
      expect(providerCalls).toBe(2);

      const durable = readDurableRows(first.id);
      expect(durable.chat).toMatchObject({
        provider: "OpenAI",
        model_name: "gpt-4o-mini",
        context_policy: "board",
      });
      expect(durable.runs.count).toBe(1);
      expect(durable.messages.map((row) => row.text)).toEqual([prompt, answer]);
      expect(durable.messages.map((row) => row.chat_sequence)).toEqual([1, 2]);

      const initialPlacement = (await readPlacements(page, board.id)).find(
        (item) => item.target_id === first.id,
      )!;
      let write = placementWrite(page, initialPlacement.id);
      await firstCard.getByRole("button", { name: "Collapse chat" }).click();
      await awaitPlacementCommit(write, firstCard);
      await expect(firstCard).toHaveAttribute("aria-expanded", "false");
      await expect(firstCard.getByTestId("copilot-chat-textarea")).toHaveCount(
        0,
      );
      write = placementWrite(page, initialPlacement.id);
      await firstCard.getByRole("button", { name: "Expand chat" }).click();
      await awaitPlacementCommit(write, firstCard);
      await expect(
        firstCard.getByTestId("copilot-chat-textarea"),
      ).toBeVisible();
      write = placementWrite(page, initialPlacement.id);
      await firstCard.getByRole("button", { name: "Maximize chat" }).click();
      await awaitPlacementCommit(write, firstCard);
      await expect(firstCard).toHaveAttribute(
        "data-display-state",
        "maximized",
      );
      write = placementWrite(page, initialPlacement.id);
      await firstCard.getByRole("button", { name: "Restore chat" }).click();
      await awaitPlacementCommit(write, firstCard);
      await expect(
        firstCard.getByRole("button", { name: "Maximize chat" }),
      ).toBeFocused();

      await firstCard.focus();
      write = placementWrite(page, initialPlacement.id);
      await firstCard.press("Alt+ArrowRight");
      await awaitPlacementCommit(write, firstCard);
      write = placementWrite(page, initialPlacement.id);
      await firstCard.press("Control+Alt+ArrowDown");
      await awaitPlacementCommit(write, firstCard);
      placements = await readPlacements(page, board.id);
      const moved = placements.find((item) => item.target_id === first.id)!;
      expect(moved.x).toBe(initialPlacement.x + 10);
      expect(moved.height).toBe(initialPlacement.height + 10);

      await page.route(
        new RegExp(`/api/v1/projects/${project.id}/chats`),
        (route) => route.abort("connectionfailed"),
      );
      await search.fill("transport failure");
      await expect(page.getByRole("alert")).toContainText(
        "Chats could not be loaded",
        { timeout: 30_000 },
      );
      await context.setOffline(true);
      await expect(page.getByRole("status")).toContainText(
        "Connection lost. Reconnecting",
      );
      await page.screenshot({
        path: path.join(evidenceRoot, "04-error-reconnect.png"),
        fullPage: true,
      });
      await context.setOffline(false);
      await page.unroute(new RegExp(`/api/v1/projects/${project.id}/chats`));
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(
        page.getByRole("button", { name: ids.titles[0] }),
      ).toBeVisible();

      const closeResponse = placementWrite(page, initialPlacement.id, "DELETE");
      await firstCard
        .getByRole("button", { name: "Close chat placement" })
        .click();
      await closeResponse;
      await expect(firstCard).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Create chat" }),
      ).toBeFocused();
      await page.getByRole("button", { name: ids.titles[0] }).click();
      const replacedCard = page.getByRole("region", { name: ids.titles[0] });
      await expect(replacedCard).toBeFocused();
      const replacedPlacements = await readPlacements(page, board.id);
      const replacement = replacedPlacements.find(
        (item) => item.target_id === first.id,
      )!;
      expect(replacement.id).not.toBe(initialPlacement.id);
      await expect(
        replacedCard.getByText(answer, { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(evidenceRoot, "05-close-replace-focus.png"),
        fullPage: true,
      });
      writeFileSync(idsPath, JSON.stringify(ids, null, 2));
    },
  );

  test("mvp_chat off hides UI while owner API preserves server IDs", async ({
    page,
  }) => {
    test.skip(
      process.env.KETOS_FEATURE_MVP_CHAT !== "false",
      "flag-off controlled launch only",
    );
    const ids = JSON.parse(readFileSync(idsPath, "utf8")) as Stage05Ids;
    await openBoard(page, ids);
    await expect(page.getByRole("region", { name: "Chats" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: ids.titles[0] })).toHaveCount(
      0,
    );
    for (const chatId of ids.chatIds) {
      const response = await page.request.get(`/api/v1/chats/${chatId}`);
      expect(response.ok()).toBeTruthy();
      expect(((await response.json()) as Chat).id).toBe(chatId);
    }
  });

  test("mvp_chat re-enable restores the same chats and transcript", async ({
    page,
  }) => {
    test.skip(
      process.env.STAGE05_RESTORE_ONLY !== "true",
      "restore controlled launch only",
    );
    const ids = JSON.parse(readFileSync(idsPath, "utf8")) as Stage05Ids;
    await openBoard(page, ids);
    await expect(page.getByRole("region", { name: "Chats" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: ids.titles[0] }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: ids.titles[0] }),
    ).toBeVisible();
    await expect(page.getByText(ids.answer, { exact: true })).toBeVisible();
  });
});
