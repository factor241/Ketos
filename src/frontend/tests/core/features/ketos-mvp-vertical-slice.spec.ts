import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Entity = { id: string; revision: number };
type Placement = Entity & {
  target_kind: "note" | "chat" | "automation" | "job_result";
  target_id: string;
  x: number;
  y: number;
};
type Flow = Entity & {
  name: string;
  description: string | null;
  folder_id: string;
  data: Record<string, Json>;
};
type Run = {
  job_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
};
type ProviderMessage = {
  role?: string;
  content?: string | Array<{ text?: string }>;
};

const repositoryRoot = path.resolve(process.cwd(), "../..");
const frontendRoot = path.resolve(repositoryRoot, "src/frontend");
const runRoot = process.env.KETOS_MVP_RUN_DIR;
const databaseUrl = process.env.KETOS_DATABASE_URL;
const dataDir = process.env.KETOS_DATA_DIR;
const ledgerPath = process.env.KETOS_STAGE10_ENTITY_LEDGER;
const providerPort = Number(process.env.STAGE10_OPENAI_PORT ?? "18767");
const providerSockets = new Set<import("node:net").Socket>();
const replacementProcesses: ChildProcess[] = [];
let providerServer: Server;

function requireEnvironment() {
  if (!runRoot || !databaseUrl || !dataDir || !ledgerPath) {
    throw new Error(
      "KETOS_MVP_RUN_DIR, KETOS_DATABASE_URL, KETOS_DATA_DIR, and " +
        "KETOS_STAGE10_ENTITY_LEDGER are required",
    );
  }
  if (
    process.env.KETOS_STAGE10_ACCEPTANCE_MODE === "1" &&
    (!process.env.S10_CODE_SHA ||
      !process.env.KETOS_MVP_EVIDENCE_OWNER ||
      !process.env.KETOS_MVP_EVIDENCE_RETENTION_POLICY)
  ) {
    throw new Error(
      "acceptance mode requires S10_CODE_SHA, evidence owner, and retention policy",
    );
  }
  return { runRoot, databaseUrl, dataDir, ledgerPath };
}

function providerText(content: ProviderMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => item.text ?? "").join(" ");
}

function completionChunk(
  id: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
) {
  return JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: 1_722_000_000,
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

function toolArguments(prompt: string) {
  const match = prompt.match(/^S10 (REJECT|APPROVE) ([0-9a-f-]{36})$/i);
  if (!match) return null;
  return {
    targetFlowId: match[2],
    operations: [
      {
        op: "set_parameter",
        nodeId: "TextInput-stage10",
        parameter: "input_value",
        value:
          match[1].toUpperCase() === "REJECT" ? "Rejected-AI" : "Approved-AI",
      },
    ],
  };
}

test.beforeAll(async () => {
  requireEnvironment();
  providerServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "gpt-4o-mini", object: "model", owned_by: "stage10" }],
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
      const payload = JSON.parse(body) as { messages?: ProviderMessage[] };
      const messages = payload.messages ?? [];
      let lastUserIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === "user") {
          lastUserIndex = index;
          break;
        }
      }
      const lastUser = messages[lastUserIndex];
      const prompt = providerText(lastUser?.content);
      const id = `chatcmpl-stage10-${Date.now()}`;
      const toolAfterLastUser = messages
        .slice(lastUserIndex + 1)
        .some((message) => message.role === "tool");
      appendFileSync(
        path.join(
          requireEnvironment().runRoot,
          "provider-request-shapes.jsonl",
        ),
        `${JSON.stringify({
          sequence: messages.length,
          roles: messages.map((message) => message.role ?? "unknown"),
          last_user_index: lastUserIndex,
          prompt_kind: prompt.startsWith("S10 REJECT")
            ? "reject"
            : prompt.startsWith("S10 APPROVE")
              ? "approve"
              : prompt.includes("independent B")
                ? "chat_b"
                : "chat_a",
          tool_after_last_user: toolAfterLastUser,
        })}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      if (toolAfterLastUser) {
        sendSse(response, [
          completionChunk(
            id,
            {
              role: "assistant",
              content: "The authoritative command result was recorded.",
            },
            null,
          ),
          completionChunk(id, {}, "stop"),
        ]);
        return;
      }
      const args = toolArguments(prompt);
      if (args) {
        sendSse(response, [
          completionChunk(
            id,
            {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `call-stage10-${Date.now()}`,
                  type: "function",
                  function: {
                    name: "ProposeFlowChanges",
                    arguments: JSON.stringify(args),
                  },
                },
              ],
            },
            null,
          ),
          completionChunk(id, {}, "tool_calls"),
        ]);
        return;
      }
      const reply = prompt.includes("independent B")
        ? "Independent reply B"
        : "Independent reply A";
      sendSse(response, [
        completionChunk(id, { role: "assistant", content: reply }, null),
        completionChunk(id, {}, "stop"),
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
});

test.afterAll(async () => {
  for (const child of replacementProcesses) {
    if (child.pid && processExists(child.pid))
      process.kill(child.pid, "SIGTERM");
  }
  for (const socket of providerSockets) socket.destroy();
  providerSockets.clear();
  providerServer.closeAllConnections();
  await Promise.race([
    new Promise<void>((resolve) => providerServer.close(() => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
});

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function flowHash(flow: Flow): string {
  const material = {
    data: flow.data as Json,
    description: flow.description,
    name: flow.name,
  };
  return createHash("sha256").update(canonical(material)).digest("hex");
}

async function createProject(page: Page): Promise<Entity> {
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      name: `Stage 10 ${Date.now().toString(36)}`,
      description: "",
      flows_list: [],
      components_list: [],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function createBoard(page: Page, projectId: string): Promise<Entity> {
  const response = await page.request.post(
    `/api/v1/projects/${projectId}/boards`,
    { data: { title: "Ketos MVP vertical slice" } },
  );
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function placements(page: Page, boardId: string): Promise<Placement[]> {
  const response = await page.request.get(
    `/api/v1/boards/${boardId}/placements`,
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function createChat(page: Page, projectId: string, title: string) {
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
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as Entity;
}

async function sendChat(page: Page, title: string, prompt: string) {
  await page.getByRole("button", { name: title }).click();
  const card = page.getByRole("region", { name: title });
  const runResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        "/api/copilotkit/agent/ketos-chat/run",
  );
  await card.getByTestId("copilot-chat-textarea").fill(prompt);
  await card.getByTestId("copilot-send-button").click();
  const response = await runResponse;
  expect(response.status()).toBe(200);
  return card;
}

async function createEditableFlow(
  page: Page,
  projectId: string,
): Promise<Flow> {
  const typesResponse = await page.request.get(
    "/api/v1/all?force_refresh=true",
  );
  expect(typesResponse.ok(), await typesResponse.text()).toBeTruthy();
  const types = (await typesResponse.json()) as Record<
    string,
    Record<string, unknown>
  >;
  const textInput = Object.values(types)
    .map((category) => category.TextInput)
    .find(
      (component): component is Record<string, Json> =>
        typeof component === "object" && component !== null,
    );
  expect(textInput).toBeDefined();
  const response = await page.request.post("/api/v1/flows/", {
    data: {
      name: "Stage 10 Automation",
      description: "Vertical slice target",
      folder_id: projectId,
      data: {
        nodes: [
          {
            id: "TextInput-stage10",
            type: "genericNode",
            position: { x: 100, y: 100 },
            data: {
              id: "TextInput-stage10",
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
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

function listenerPid(port: number): number {
  const output = execFileSync(
    "/usr/sbin/lsof",
    ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"],
    { encoding: "utf8" },
  ).trim();
  const pids = output.split(/\s+/).filter(Boolean).map(Number);
  if (pids.length !== 1 || !Number.isSafeInteger(pids[0])) {
    throw new Error(`expected one listener on ${port}, observed ${output}`);
  }
  return pids[0];
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 120_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("timed out waiting for owned process state");
}

async function stopListener(port: number): Promise<number> {
  const pid = listenerPid(port);
  process.kill(pid, "SIGTERM");
  await waitUntil(() => !processExists(pid), 15_000).catch(() => {
    if (processExists(pid)) process.kill(pid, "SIGKILL");
  });
  await waitUntil(() => {
    try {
      listenerPid(port);
      return false;
    } catch {
      return true;
    }
  });
  expect(processExists(pid)).toBe(false);
  return pid;
}

async function waitHttp(url: string) {
  await waitUntil(async () => {
    try {
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  });
}

function startBackend(): ChildProcess {
  const env = requireEnvironment();
  mkdirSync(path.join(env.runRoot, "binding"), {
    recursive: true,
    mode: 0o700,
  });
  return spawn(
    "uv",
    [
      "run",
      "uvicorn",
      "--factory",
      "ketos.main:create_app",
      "--host",
      "127.0.0.1",
      "--port",
      "7860",
      "--loop",
      "asyncio",
      "--workers",
      "1",
      "--log-level",
      "error",
      "--no-access-log",
    ],
    {
      cwd: repositoryRoot,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        KETOS_DATABASE_URL: env.databaseUrl,
        KETOS_CONFIG_DIR: env.dataDir,
        KETOS_DATA_DIR: env.dataDir,
        KETOS_TEMP_DIR: env.dataDir,
        KETOS_AG_UI_BINDING_DB: path.join(
          env.runRoot,
          "binding",
          "run-bindings.ledger",
        ),
        KETOS_AUTO_LOGIN: "true",
        KETOS_DEACTIVATE_TRACING: "true",
        KETOS_FEATURE_MVP_WORKSPACE: "true",
        KETOS_FEATURE_MVP_CHAT: "true",
        KETOS_AGENTIC_EXPERIENCE: "true",
        KETOS_LOG_LEVEL: "ERROR",
        LANGGRAPH_STRICT_MSGPACK: "true",
        DO_NOT_TRACK: "true",
        OPENAI_API_KEY: "stage10-deterministic-test-key",
        OPENAI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
      },
    },
  );
}

function startFrontend(): ChildProcess {
  return spawn(
    "./node_modules/.bin/vite",
    ["--host", "127.0.0.1", "--port", "3000", "--strictPort"],
    {
      cwd: frontendRoot,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        VITE_PROXY_TARGET: "http://127.0.0.1:7860",
      },
    },
  );
}

function writeLedger(payload: Record<string, Json>) {
  const target = requireEnvironment().ledgerPath;
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  const descriptor = openSync(temporary, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    linkSync(temporary, target);
  } finally {
    unlinkSync(temporary);
  }
  chmodSync(target, 0o600);
}

test(
  "one owner completes the ten-step Ketos MVP vertical slice on one database",
  {
    tag: [
      "@release",
      "@workspace",
      "@api",
      "@database",
      "@a11y",
      "@localization",
    ],
  },
  async ({ page }) => {
    const env = requireEnvironment();
    const startedAt = new Date().toISOString();
    await awaitBootstrapTest(page, { skipModal: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    const whoAmI = await page.request.get("/api/v1/users/whoami");
    expect(whoAmI.ok(), await whoAmI.text()).toBeTruthy();
    const actor = (await whoAmI.json()) as Entity;
    const locale = await page.request.patch(`/api/v1/users/${actor.id}`, {
      data: { preferred_locale: "en" },
    });
    expect(locale.ok(), await locale.text()).toBeTruthy();

    // 1. Project and Board.
    const project = await createProject(page);
    const board = await createBoard(page, project.id);
    const boardUrl = `/project/${project.id}/board/${board.id}`;
    await page.goto(boardUrl);
    await expect(page).toHaveURL(new RegExp(`${boardUrl}$`));
    await expect(
      page.getByRole("heading", { name: "Ketos MVP vertical slice" }),
    ).toBeVisible();

    // 2. Durable edited/moved Note with sanitized Markdown rendering.
    const markdown =
      "**Stage 10 bold**\n\n- one\n- two\n\n[Ketos](https://example.com)";
    const addNote = page.getByRole("button", {
      name: /Add note|Добавить заметку/i,
    });
    await expect(addNote).toBeVisible();
    await expect(addNote).toBeEnabled();
    const [noteResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v1/boards/${board.id}/board-notes`,
      ),
      addNote.click(),
    ]);
    expect(noteResponse.status(), await noteResponse.text()).toBe(201);
    const noteCreate = (await noteResponse.json()) as {
      note: Entity;
      placement: Placement;
    };
    const noteCard = page.getByRole("region", { name: "Note" });
    await expect(noteCard).toBeVisible();
    await noteCard.getByRole("textbox", { name: "Edit note" }).fill(markdown);
    const [notePatch] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname ===
            `/api/v1/board-notes/${noteCreate.note.id}` &&
          response.ok(),
      ),
      noteCard.getByRole("button", { name: "Save note" }).click(),
    ]);
    const note = (await notePatch.json()) as Entity;
    await noteCard.focus();
    const [placementPatch] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname ===
            `/api/v1/placements/${noteCreate.placement.id}` &&
          response.ok(),
      ),
      page.keyboard.press("Alt+ArrowRight"),
    ]);
    const notePlacement = (await placementPatch.json()) as Placement;
    await page.reload();
    const restoredNoteCard = page.getByRole("region", { name: "Note" });
    await expect(restoredNoteCard).toBeVisible();
    await restoredNoteCard
      .getByRole("button", { name: "Note preview" })
      .click();
    await expect(restoredNoteCard.getByText("Stage 10 bold")).toHaveJSProperty(
      "tagName",
      "STRONG",
    );
    await expect(restoredNoteCard.getByRole("list")).toBeVisible();
    await expect(
      restoredNoteCard.getByRole("link", { name: "Ketos" }),
    ).toHaveAttribute("rel", "noopener noreferrer");

    // 3. Two independent durable Chat threads and replies.
    const chatA = await createChat(page, project.id, "Stage 10 Chat A");
    const chatB = await createChat(page, project.id, "Stage 10 Chat B");
    await page.reload();
    const cardA = await sendChat(page, "Stage 10 Chat A", "independent A");
    await expect(cardA.getByText("Independent reply A")).toBeVisible({
      timeout: 60_000,
    });
    const cardB = await sendChat(page, "Stage 10 Chat B", "independent B");
    await expect(cardB.getByText("Independent reply B")).toBeVisible({
      timeout: 60_000,
    });
    expect(chatA.id).not.toBe(chatB.id);
    const messagesA = await page.request.get(
      `/api/v1/chats/${chatA.id}/messages`,
    );
    const messagesB = await page.request.get(
      `/api/v1/chats/${chatB.id}/messages`,
    );
    expect(messagesA.ok()).toBeTruthy();
    expect(messagesB.ok()).toBeTruthy();
    expect(JSON.stringify(await messagesA.json())).toContain(
      "Independent reply A",
    );
    expect(JSON.stringify(await messagesB.json())).toContain(
      "Independent reply B",
    );

    // 4. Existing Flow editor roundtrip and manual save.
    let flow = await createEditableFlow(page, project.id);
    const automationResponse = await page.request.post(
      `/api/v1/boards/${board.id}/placements`,
      {
        data: {
          target_kind: "automation",
          target_id: flow.id,
          x: 560,
          y: 180,
          width: 420,
          height: 320,
          z_index: 4,
        },
      },
    );
    expect(automationResponse.status(), await automationResponse.text()).toBe(
      201,
    );
    const automation = (await automationResponse.json()) as Placement;
    await page.goto(
      `/flow/${flow.id}?returnBoardId=${board.id}&returnPlacementId=${automation.id}`,
    );
    await expect(page.locator("#react-flow-id")).toBeVisible();
    await page.getByTestId("flow_name").click();
    await page.getByTestId("input-flow-name").fill("Stage 10 Manually Saved");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname === `/api/v1/flows/${flow.id}` &&
          response.ok(),
      ),
      page.getByTestId("save-flow-settings").click(),
    ]);
    await page.getByTestId("return-to-board").click();
    await expect(page).toHaveURL(
      new RegExp(`${boardUrl}\\?focusPlacementId=${automation.id}$`),
    );
    await expect(
      page.locator(`[data-id="${automation.id}"] > section`),
    ).toBeFocused();

    // 5. queued -> running -> succeeded and one durable Job Result.
    const automationCard = page.locator(
      `[data-id="${automation.id}"] > section`,
    );
    const runAutomation = automationCard.getByRole("button", { name: "Run" });
    await expect(runAutomation).toBeVisible();
    await expect(runAutomation).toBeEnabled();
    const [runResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v1/boards/${board.id}/automations/${flow.id}/runs`,
      ),
      runAutomation.click(),
    ]);
    const run = (await runResponse.json()) as Run;
    await expect(automationCard).toContainText("Succeeded", {
      timeout: 60_000,
    });
    await expect
      .poll(async () =>
        (await placements(page, board.id)).some(
          (item) =>
            item.target_kind === "job_result" && item.target_id === run.job_id,
        ),
      )
      .toBe(true);
    const resultPlacement = (await placements(page, board.id)).find(
      (item) =>
        item.target_kind === "job_result" && item.target_id === run.job_id,
    );
    expect(resultPlacement).toBeDefined();

    // 6. Reject one server proposal, then approve one fresh proposal.
    flow = (await (
      await page.request.get(`/api/v1/flows/${flow.id}`)
    ).json()) as Flow;
    const beforeRejectRevision = flow.revision;
    const beforeRejectHash = flowHash(flow);
    const governed = await sendChat(
      page,
      "Stage 10 Chat A",
      `S10 REJECT ${flow.id}`,
    );
    const rejectConfirmation = governed.getByRole("region", {
      name: "Flow change confirmation",
    });
    const rejectedProposalId =
      (await rejectConfirmation.getAttribute("data-proposal-id")) ?? "";
    await rejectConfirmation.getByRole("button", { name: "Reject" }).click();
    await expect(
      governed.getByText("The flow changes were rejected."),
    ).toBeVisible({ timeout: 60_000 });
    flow = (await (
      await page.request.get(`/api/v1/flows/${flow.id}`)
    ).json()) as Flow;
    expect(flow.revision).toBe(beforeRejectRevision);
    expect(flowHash(flow)).toBe(beforeRejectHash);

    const approveCard = await sendChat(
      page,
      "Stage 10 Chat A",
      `S10 APPROVE ${flow.id}`,
    );
    const approveConfirmation = approveCard.getByRole("region", {
      name: "Flow change confirmation",
    });
    const approvedProposalId =
      (await approveConfirmation.getAttribute("data-proposal-id")) ?? "";
    await approveConfirmation
      .getByRole("button", { name: "Apply changes" })
      .click();
    await expect(
      approveCard.getByText("The server applied the flow changes."),
    ).toBeVisible({ timeout: 60_000 });
    flow = (await (
      await page.request.get(`/api/v1/flows/${flow.id}`)
    ).json()) as Flow;
    expect(flow.revision).toBe(beforeRejectRevision + 1);
    const approvedHash = flowHash(flow);
    expect(approvedHash).not.toBe(beforeRejectHash);

    // 7. Stop both initial listeners, prove death, and start replacements.
    const backendPid1 = await stopListener(7860);
    const frontendPid1 = await stopListener(3000);
    const backendReplacement = startBackend();
    replacementProcesses.push(backendReplacement);
    await waitHttp("http://127.0.0.1:7860/health");
    const backendPid2 = listenerPid(7860);
    const frontendReplacement = startFrontend();
    replacementProcesses.push(frontendReplacement);
    await waitHttp("http://127.0.0.1:3000");
    const frontendPid2 = listenerPid(3000);
    expect(backendPid2).not.toBe(backendPid1);
    expect(frontendPid2).not.toBe(frontendPid1);
    expect(
      existsSync(
        path.join(env.dataDir, "mvp", "langgraph-checkpoints.sqlite3"),
      ),
    ).toBe(true);

    // 8. Restore the exact server-owned board state after both restarts.
    await page.goto(boardUrl, { waitUntil: "commit" });
    await expect(
      page.getByRole("heading", { name: "Ketos MVP vertical slice" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Note" })).toBeVisible();
    await expect(
      page.locator(`[data-id="${automation.id}"] > section`),
    ).toContainText("Stage 10 Manually Saved");
    const restoredPlacements = await placements(page, board.id);
    expect(
      restoredPlacements.some((item) => item.id === notePlacement.id),
    ).toBe(true);
    expect(restoredPlacements.some((item) => item.id === automation.id)).toBe(
      true,
    );
    expect(
      restoredPlacements.some((item) => item.id === resultPlacement?.id),
    ).toBe(true);

    // 9. The single account Settings entry returns to the exact Board URL.
    await page.getByTestId("user_menu_button").click();
    await expect(page.getByTestId("menu_settings_button")).toHaveCount(1);
    await page.getByTestId("menu_settings_button").click();
    await expect(page).toHaveURL(/\/settings\/(?:general|global-variables)/);
    await expect(page.getByTestId("settings_menu_header")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${project.id}.*${board.id}`));

    // 10. Supported config seam hides and restores routes without deleting data.
    let flagsEnabled = false;
    await page.route("**/api/v1/config", async (route) => {
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
            mvp_workspace: flagsEnabled,
            mvp_chat: flagsEnabled,
          },
        },
      });
    });
    await page.goto(boardUrl);
    await expect(page).toHaveURL(/\/flows\/?$/);
    flagsEnabled = true;
    await page.goto(boardUrl);
    await expect(
      page.getByRole("heading", { name: "Ketos MVP vertical slice" }),
    ).toBeVisible();
    const projectRead = await page.request.get(
      `/api/v1/projects/${project.id}`,
    );
    const boardRead = await page.request.get(`/api/v1/boards/${board.id}`);
    const noteRead = await page.request.get(
      `/api/v1/board-notes/${noteCreate.note.id}`,
    );
    const chatReadA = await page.request.get(`/api/v1/chats/${chatA.id}`);
    const chatReadB = await page.request.get(`/api/v1/chats/${chatB.id}`);
    const flowRead = await page.request.get(`/api/v1/flows/${flow.id}`);
    for (const response of [
      projectRead,
      boardRead,
      noteRead,
      chatReadA,
      chatReadB,
      flowRead,
    ]) {
      expect(response.ok(), await response.text()).toBeTruthy();
    }

    writeLedger({
      schema: "ketos.stage10.entity-ledger.v1",
      s10_code_sha:
        process.env.S10_CODE_SHA ??
        execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
          cwd: repositoryRoot,
          encoding: "utf8",
        }).trim(),
      owner: process.env.KETOS_MVP_EVIDENCE_OWNER ?? "development",
      retention_policy:
        process.env.KETOS_MVP_EVIDENCE_RETENTION_POLICY ?? "development-only",
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      command: [
        "./node_modules/.bin/playwright",
        "test",
        "-c",
        "playwright.mvp.config.ts",
        "tests/core/features/ketos-mvp-vertical-slice.spec.ts",
        "--project=chromium",
        "--workers=1",
      ],
      cwd: frontendRoot,
      exit_code: 0,
      verdict: "PASS",
      acceptance_run_redacted: "$KETOS_STAGE10_ACCEPTANCE_RUN_DIR",
      entities: [
        { kind: "Project", id: project.id, revision: project.revision },
        { kind: "Board", id: board.id, revision: board.revision },
        { kind: "BoardNote", id: noteCreate.note.id, revision: note.revision },
        { kind: "ChatThread", id: chatA.id },
        { kind: "ChatThread", id: chatB.id },
        { kind: "Flow", id: flow.id, revision: flow.revision },
        { kind: "Job", id: run.job_id },
        { kind: "CommandProposal", id: rejectedProposalId },
        { kind: "CommandProposal", id: approvedProposalId },
        { kind: "Placement", id: resultPlacement?.id ?? "" },
      ],
      project_id: project.id,
      board_id: board.id,
      note_id: noteCreate.note.id,
      note_revision: note.revision,
      note_placement_id: notePlacement.id,
      chat_ids: [chatA.id, chatB.id],
      langgraph_thread_ids: [chatA.id, chatB.id],
      flow_id: flow.id,
      flow_revision_after_reject: beforeRejectRevision,
      flow_hash_after_reject: beforeRejectHash,
      flow_revision_after_approve: flow.revision,
      flow_hash_after_approve: approvedHash,
      automation_placement_id: automation.id,
      job_id: run.job_id,
      result_placement_id: resultPlacement?.id ?? null,
      rejected_proposal_id: rejectedProposalId,
      approved_proposal_id: approvedProposalId,
      backend_pid_1: backendPid1,
      backend_pid_2: backendPid2,
      frontend_pid_1: frontendPid1,
      frontend_pid_2: frontendPid2,
      backend_listener_1_dead: true,
      frontend_listener_1_dead: true,
      backend_readiness_2: true,
      frontend_readiness_2: true,
      feature_flags_off_on: true,
      canonical_saver: path.join(
        env.dataDir,
        "mvp",
        "langgraph-checkpoints.sqlite3",
      ),
    });
  },
);
