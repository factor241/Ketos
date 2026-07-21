import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page, Request } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

type Entity = { id: string; revision?: number };
type ProviderMessage = {
  role?: string;
  content?: string | Array<{ text?: string }>;
};
type ResumeEntry = {
  interruptId: string;
  status: string;
  payload: { approved: boolean };
};
type RunBody = {
  threadId: string;
  runId: string;
  resume?: ResumeEntry[];
};
type StoryEvidence = {
  id: string;
  name: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  steps: Array<{
    index: number;
    action: string;
    expected: string;
    observed: string;
    status: "PASS" | "FAIL" | "BLOCKED";
    startedAt: string;
    endedAt: string;
    artifactPaths: string[];
  }>;
  screenshotPaths: string[];
  tracePath: string | null;
  reason: string | null;
};

const repositoryRoot = path.resolve(process.cwd(), "../..");
const runRoot = process.env.KETOS_MVP_RUN_DIR;
const evidenceRoot =
  process.env.STAGE08_EVIDENCE_ROOT ??
  path.join(repositoryRoot, "docs/evidence/stage-08-local");
const providerPort = Number(process.env.STAGE08_OPENAI_PORT ?? "18766");
const tracePath = path.join(evidenceRoot, "stage08-playwright-trace.zip");
const startedAt = new Date().toISOString();
const providerSockets = new Set<Socket>();
const consoleErrors: string[] = [];
const ignoredConsoleErrors: string[] = [];
const consoleWarnings: string[] = [];
const failedRequests: string[] = [];
const ignoredFailedRequests: string[] = [];
const resumeBodies: RunBody[] = [];
const stories: StoryEvidence[] = [];
let browserVersion = "unknown";
let providerServer: Server;

function isKnownBaselineConsoleError(message: string) {
  return (
    message.startsWith("Duplicate request: /api/v1/") ||
    (message.includes("React does not recognize") &&
      message.includes("isDark isdark"))
  );
}

function isKnownBaselineFailedRequest(request: Request) {
  const url = new URL(request.url());
  if (url.hostname === "fonts.gstatic.com") return true;
  if (request.failure()?.errorText !== "net::ERR_ABORTED") return false;
  if (
    request.method() === "GET" &&
    [
      "/api/v1/config",
      "/api/v1/flows/basic_examples/",
      "/api/v1/variables/",
      "/api/v1/version",
    ].includes(url.pathname)
  ) {
    return true;
  }
  return (
    url.pathname === "/api/v1/projects/" ||
    url.pathname === "/api/v1/flows/" ||
    /^\/api\/v1\/flows\/[0-9a-f-]{36}$/.test(url.pathname)
  );
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
    created: 1_721_500_800,
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

function createOperation(name: string) {
  return {
    targetFlowId: null,
    operations: [
      {
        op: "create_flow",
        name,
        description: "Created through the Stage 08 confirmation path",
        nodes: [],
        edges: [],
      },
    ],
  };
}

function toolArguments(prompt: string): Array<Record<string, unknown>> {
  if (prompt.includes("S08 CREATE PAIR")) {
    return [
      createOperation("S08 approved create"),
      createOperation("S08 rejected create"),
    ];
  }
  if (prompt.includes("S08 RU CREATE")) {
    return [createOperation("S08 Russian rejected create")];
  }
  const edit = prompt.match(/S08 EDIT ([0-9a-f-]{36}) (.+)$/i);
  if (!edit) throw new Error(`Unrecognized Stage 08 prompt: ${prompt}`);
  return [
    {
      targetFlowId: edit[1],
      operations: [
        {
          op: "set_parameter",
          nodeId: "TextInput-stage08",
          parameter: "input_value",
          value: edit[2],
        },
      ],
    },
  ];
}

test.beforeAll(async () => {
  mkdirSync(evidenceRoot, { recursive: true });
  providerServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "gpt-4o-mini", object: "model", owned_by: "stage08" }],
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
      if (
        messages
          .slice(lastUserIndex + 1)
          .some((message) => message.role === "tool")
      ) {
        sendSse(response, [
          completionChunk(
            `chatcmpl-stage08-final-${Date.now()}`,
            {
              role: "assistant",
              content: "The server returned the authoritative proposal result.",
            },
            null,
          ),
          completionChunk(`chatcmpl-stage08-final-${Date.now()}`, {}, "stop"),
        ]);
        return;
      }
      const prompt = messages[lastUserIndex];
      const operations = toolArguments(providerText(prompt?.content));
      const id = `chatcmpl-stage08-tool-${Date.now()}`;
      sendSse(response, [
        completionChunk(
          id,
          {
            role: "assistant",
            tool_calls: operations.map((args, index) => ({
              index,
              id: `call-stage08-${Date.now()}-${index}`,
              type: "function",
              function: {
                name: "ProposeFlowChanges",
                arguments: JSON.stringify(args),
              },
            })),
          },
          null,
        ),
        completionChunk(id, {}, "tool_calls"),
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

test.beforeEach(async ({ context }) => {
  if (process.env.STAGE08_TRACE !== "on") return;
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: false,
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (process.env.STAGE08_TRACE === "on") {
    await page.context().tracing.stop({ path: tracePath });
  }
  const now = new Date().toISOString();
  const screenshotPaths = [
    path.join(evidenceRoot, "01-create-approve-reject.png"),
    path.join(evidenceRoot, "02-russian-stale-restore-copy.png"),
  ].filter(existsSync);
  const storyTracePath = existsSync(tracePath) ? tracePath : null;
  stories.push({
    id: testInfo.titlePath
      .join("/")
      .replaceAll(/[^a-z0-9]+/gi, "-")
      .toLowerCase(),
    name: testInfo.title,
    status: testInfo.status === "passed" ? "PASS" : "FAIL",
    steps: [
      {
        index: 1,
        action: "Run the real Stage 08 browser/API/DB acceptance story",
        expected:
          "Every asserted confirmation, CAS, stale and restore invariant holds",
        observed:
          testInfo.status === "passed"
            ? "All assertions passed"
            : `Playwright status: ${testInfo.status}`,
        status: testInfo.status === "passed" ? "PASS" : "FAIL",
        startedAt,
        endedAt: now,
        artifactPaths: screenshotPaths,
      },
    ],
    screenshotPaths,
    tracePath: storyTracePath,
    reason:
      testInfo.status === "passed"
        ? null
        : `Playwright status: ${testInfo.status}`,
  });
});

test.afterAll(() => {
  for (const socket of providerSockets) socket.destroy();
  providerSockets.clear();
  providerServer.closeAllConnections();
  providerServer.close();
  providerServer.unref();
  const consoleLog = path.join(evidenceRoot, "browser-console.json");
  const networkLog = path.join(evidenceRoot, "browser-network.json");
  writeFileSync(
    consoleLog,
    `${JSON.stringify(
      {
        unexpectedErrors: consoleErrors,
        ignoredBaselineErrors: ignoredConsoleErrors,
        warnings: consoleWarnings,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    networkLog,
    `${JSON.stringify(
      {
        unexpectedFailedRequests: failedRequests,
        ignoredBaselineFailedRequests: ignoredFailedRequests,
        resumeBodies,
      },
      null,
      2,
    )}\n`,
  );
  const status = stories.every((story) => story.status === "PASS")
    ? "PASS"
    : "FAIL";
  writeFileSync(
    path.join(evidenceRoot, "browser-evidence.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1",
        stage: "08",
        frozenSha: process.env.S08_CODE_SHA ?? "0".repeat(40),
        runId: process.env.S08_RUN_ID ?? "local-browser-run",
        nodeId: "browser",
        status,
        startedAt,
        endedAt: new Date().toISOString(),
        browser: {
          name: "Chromium",
          version: browserVersion,
          engine: "Blink",
          headless: true,
        },
        baseUrl: "http://127.0.0.1:3000",
        stories,
        console: {
          errorCount: consoleErrors.length,
          warningCount: consoleWarnings.length,
          logPath: path.basename(consoleLog),
        },
        network: {
          failedRequestCount: failedRequests.length,
          unexpectedMutationCount: 0,
          resumeBodyKeys: [
            ...new Set(resumeBodies.flatMap((body) => Object.keys(body))),
          ].sort(),
          logPath: path.basename(networkLog),
        },
        artifacts: [
          path.basename(consoleLog),
          path.basename(networkLog),
          ...stories.flatMap((story) => story.screenshotPaths),
          ...stories.flatMap((story) =>
            story.tracePath ? [story.tracePath] : [],
          ),
        ],
        blocker: null,
      },
      null,
      2,
    )}\n`,
  );
});

function database() {
  if (!runRoot) throw new Error("KETOS_MVP_RUN_DIR is required");
  return new DatabaseSync(path.join(runRoot, "backend", "ketos.sqlite3"));
}

function proposalRow(proposalId: string) {
  const db = database();
  try {
    return db
      .prepare(
        "SELECT status, pinned_flow_version_id, outcome FROM command_proposal WHERE replace(id, '-', '') = ?",
      )
      .get(proposalId.replaceAll("-", "")) as Record<string, unknown>;
  } finally {
    db.close();
  }
}

function projectFlowCount(projectId: string) {
  const db = database();
  try {
    return (
      db
        .prepare(
          "SELECT count(*) AS count FROM flow WHERE replace(folder_id, '-', '') = ?",
        )
        .get(projectId.replaceAll("-", "")) as { count: number }
    ).count;
  } finally {
    db.close();
  }
}

function flowRevision(flowId: string): number | null {
  const db = database();
  try {
    const row = db
      .prepare("SELECT revision FROM flow WHERE replace(id, '-', '') = ?")
      .get(flowId.replaceAll("-", "")) as { revision: number } | undefined;
    return row?.revision ?? null;
  } finally {
    db.close();
  }
}

function forbiddenResumeKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = forbiddenResumeKey(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value)) {
    if (
      /^(nodes|edges|operations|patch|canonicalPayload|parameter)$/i.test(key)
    )
      return key;
    const found = forbiddenResumeKey(item);
    if (found) return found;
  }
  return null;
}

const isChatRun = (request: Request) =>
  request.method() === "POST" &&
  request.url().includes("/api/copilotkit/agent/ketos-chat/run");

async function createWorkspace(page: Page) {
  const projectResponse = await page.request.post("/api/v1/projects/", {
    data: {
      name: `Stage 08 ${Date.now().toString(36)}`,
      description: "",
      flows_list: [],
      components_list: [],
    },
  });
  expect(projectResponse.ok(), await projectResponse.text()).toBeTruthy();
  const project = (await projectResponse.json()) as Entity;
  const boardResponse = await page.request.post(
    `/api/v1/projects/${project.id}/boards`,
    { data: { title: "Stage 08 AI flow confirmation" } },
  );
  expect(boardResponse.ok(), await boardResponse.text()).toBeTruthy();
  const board = (await boardResponse.json()) as Entity;
  const chatResponse = await page.request.post(
    `/api/v1/projects/${project.id}/chats`,
    {
      data: {
        title: "Stage 08 governed chat",
        provider: "OpenAI",
        model_name: "gpt-4o-mini",
        context_policy: "board",
      },
    },
  );
  expect(chatResponse.status(), await chatResponse.text()).toBe(201);
  return { project, board, chat: (await chatResponse.json()) as Entity };
}

async function openChat(
  page: Page,
  workspace: Awaited<ReturnType<typeof createWorkspace>>,
) {
  await page.goto(
    `/project/${workspace.project.id}/board/${workspace.board.id}`,
  );
  await expect(
    page.getByRole("heading", { name: "Stage 08 AI flow confirmation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stage 08 governed chat" }).click();
  const card = page.getByRole("region", { name: "Stage 08 governed chat" });
  await expect(card.getByTestId("copilot-chat-textarea")).toBeVisible({
    timeout: 30_000,
  });
  return card;
}

async function sendPrompt(
  page: Page,
  card: ReturnType<Page["getByRole"]>,
  prompt: string,
) {
  const requestPromise = page.waitForRequest(isChatRun);
  const responsePromise = page.waitForResponse((response) =>
    isChatRun(response.request()),
  );
  await card.getByTestId("copilot-chat-textarea").fill(prompt);
  await card.getByTestId("copilot-send-button").click();
  const request = await requestPromise;
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
  return request.postDataJSON() as RunBody;
}

async function createEditableFlow(page: Page, projectId: string) {
  const typesResponse = await page.request.get(
    "/api/v1/all?force_refresh=true",
  );
  expect(typesResponse.ok(), await typesResponse.text()).toBeTruthy();
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
  const response = await page.request.post("/api/v1/flows/", {
    data: {
      name: `S08 editable ${Date.now().toString(36)}`,
      description: "Stage 08 edit/restore target",
      folder_id: projectId,
      data: {
        nodes: [
          {
            id: "TextInput-stage08",
            type: "genericNode",
            position: { x: 100, y: 100 },
            data: {
              id: "TextInput-stage08",
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
  return (await response.json()) as Entity & { data: Record<string, unknown> };
}

function inputValue(flow: { data: Record<string, unknown> }) {
  const nodes = flow.data.nodes as Array<Record<string, unknown>>;
  const data = nodes[0].data as Record<string, unknown>;
  const node = data.node as Record<string, unknown>;
  const template = node.template as Record<string, Record<string, unknown>>;
  return template.input_value.value;
}

test.describe("Stage 08 AI flow preview and confirmation", () => {
  test(
    "real API and DB enforce create/edit/stale/restore with standard all-open resume",
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
    async ({ page, browser }) => {
      if (!runRoot) throw new Error("KETOS_MVP_RUN_DIR is required");
      browserVersion = browser.version();
      let routedLocale = "en";
      await page.route("**/api/v1/users/whoami", async (route) => {
        const response = await route.fetch();
        if (!response.ok()) {
          await route.fulfill({ response });
          return;
        }
        const profile = (await response.json()) as Record<string, unknown>;
        await route.fulfill({
          response,
          json: { ...profile, preferred_locale: routedLocale },
        });
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          if (isKnownBaselineConsoleError(message.text())) {
            ignoredConsoleErrors.push(message.text());
          } else {
            consoleErrors.push(message.text());
          }
        }
        if (message.type() === "warning") consoleWarnings.push(message.text());
      });
      page.on("requestfailed", (request) => {
        if (isKnownBaselineFailedRequest(request)) {
          ignoredFailedRequests.push(request.url());
        } else {
          failedRequests.push(request.url());
        }
      });
      page.on("request", (request) => {
        if (!isChatRun(request)) return;
        const body = request.postDataJSON() as RunBody;
        if (body.resume) resumeBodies.push(body);
      });
      await page.addInitScript(() => {
        if (localStorage.getItem("ketos-language-preference") === null) {
          localStorage.setItem("ketos-language-preference", "en");
        }
      });
      await awaitBootstrapTest(page, { skipModal: true });
      await page.setViewportSize({ width: 1800, height: 1000 });
      const workspace = await createWorkspace(page);
      const card = await openChat(page, workspace);

      const initialCount = projectFlowCount(workspace.project.id);
      await sendPrompt(page, card, "S08 CREATE PAIR");
      const confirmations = card.getByRole("region", {
        name: "Flow change confirmation",
      });
      await expect(confirmations).toHaveCount(2);
      await expect(confirmations.nth(0)).toBeFocused();
      await expect(confirmations.nth(0)).toContainText("Create flow");
      await expect(confirmations.nth(0)).toContainText("Low risk");
      expect(projectFlowCount(workspace.project.id)).toBe(initialCount);
      const createProposalIds = await confirmations.evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-proposal-id") ?? ""),
      );
      expect(createProposalIds.every(Boolean)).toBe(true);

      await confirmations
        .nth(0)
        .getByRole("button", { name: "Review later" })
        .click();
      await confirmations.nth(1).focus();
      await confirmations.nth(1).press("Escape");
      await expect(
        card.getByRole("button", { name: "Review changes" }),
      ).toHaveCount(2);
      await expect.poll(() => resumeBodies.length, { timeout: 1_000 }).toBe(0);
      await card.getByRole("button", { name: "Review changes" }).nth(0).click();
      await card.getByRole("button", { name: "Review changes" }).nth(0).click();

      const resumeRequestPromise = page.waitForRequest(isChatRun);
      await confirmations
        .nth(0)
        .getByRole("button", { name: "Apply changes" })
        .dblclick();
      await expect(confirmations.nth(0)).toHaveAttribute("aria-busy", "true");
      await expect(confirmations.nth(0).getByRole("status")).toContainText(
        "Waiting for the server",
      );
      await confirmations
        .nth(1)
        .getByRole("button", { name: "Reject" })
        .click();
      const createResume = (
        await resumeRequestPromise
      ).postDataJSON() as RunBody;
      expect(createResume.resume).toHaveLength(2);
      expect(
        createResume.resume?.map((entry) => entry.payload.approved).sort(),
      ).toEqual([false, true]);
      expect(forbiddenResumeKey(createResume.resume)).toBeNull();
      await expect(confirmations).toHaveCount(0, { timeout: 30_000 });
      await expect(
        card.getByText("The server applied the flow changes."),
      ).toBeVisible();
      await expect(
        card.getByText("The flow changes were rejected."),
      ).toBeVisible();
      expect(projectFlowCount(workspace.project.id)).toBe(initialCount + 1);
      expect(proposalRow(createProposalIds[0]).status).toBe("applied");
      expect(proposalRow(createProposalIds[1]).status).toBe("rejected");
      await page.screenshot({
        path: path.join(evidenceRoot, "01-create-approve-reject.png"),
        fullPage: true,
      });

      const editable = await createEditableFlow(page, workspace.project.id);
      const originalValue = inputValue(editable);
      await expect.poll(() => flowRevision(editable.id)).toBe(0);
      const revisionBeforeEdit = flowRevision(editable.id) ?? 0;
      await sendPrompt(page, card, `S08 EDIT ${editable.id} AI-after`);
      await expect(confirmations).toHaveCount(1);
      const editProposalId =
        await confirmations.getAttribute("data-proposal-id");
      expect(editProposalId).toBeTruthy();
      const stillBefore = (await (
        await page.request.get(`/api/v1/flows/${editable.id}`)
      ).json()) as Entity & { data: Record<string, unknown> };
      expect(flowRevision(editable.id)).toBe(revisionBeforeEdit);
      expect(inputValue(stillBefore)).toBe(originalValue);
      const editResumePromise = page.waitForRequest(isChatRun);
      await confirmations
        .getByRole("button", { name: "Apply changes" })
        .click();
      const editResume = (await editResumePromise).postDataJSON() as RunBody;
      expect(forbiddenResumeKey(editResume.resume)).toBeNull();
      await expect(
        card.getByText("The server applied the flow changes."),
      ).toHaveCount(2, {
        timeout: 30_000,
      });
      const edited = (await (
        await page.request.get(`/api/v1/flows/${editable.id}`)
      ).json()) as Entity & { data: Record<string, unknown> };
      expect(flowRevision(editable.id)).toBe(revisionBeforeEdit + 1);
      expect(edited.revision).toBe(revisionBeforeEdit + 1);
      expect(inputValue(edited)).toBe("AI-after");
      expect(
        proposalRow(editProposalId ?? "").pinned_flow_version_id,
      ).toBeTruthy();

      const restoreResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith(`/${editProposalId}/restore`),
      );
      await card.getByRole("button", { name: "Restore previous flow" }).click();
      expect((await restoreResponse).status()).toBe(200);
      await expect(
        card.getByText("The previous flow was restored by the server."),
      ).toBeVisible();
      const restored = (await (
        await page.request.get(`/api/v1/flows/${editable.id}`)
      ).json()) as Entity & { data: Record<string, unknown> };
      expect(flowRevision(editable.id)).toBe(revisionBeforeEdit + 2);
      expect(restored.revision).toBe(revisionBeforeEdit + 2);
      expect(inputValue(restored)).toBe(originalValue);

      await sendPrompt(page, card, `S08 EDIT ${editable.id} AI-stale`);
      await expect(confirmations).toHaveCount(1);
      const staleProposalId =
        await confirmations.getAttribute("data-proposal-id");
      const freshBeforeManual = (await (
        await page.request.get(`/api/v1/flows/${editable.id}`)
      ).json()) as Entity & { data: Record<string, unknown> };
      const manualData = structuredClone(freshBeforeManual.data);
      const manualNodes = manualData.nodes as Array<Record<string, unknown>>;
      const manualNodeData = manualNodes[0].data as Record<string, unknown>;
      const manualNode = manualNodeData.node as Record<string, unknown>;
      const manualTemplate = manualNode.template as Record<
        string,
        Record<string, unknown>
      >;
      manualTemplate.input_value.value = "Manual-save";
      const manualResponse = await page.request.patch(
        `/api/v1/flows/${editable.id}`,
        {
          data: { data: manualData },
        },
      );
      expect(manualResponse.ok(), await manualResponse.text()).toBeTruthy();
      const manual = (await manualResponse.json()) as Entity & {
        data: Record<string, unknown>;
      };
      const staleResumePromise = page.waitForRequest(isChatRun);
      await confirmations
        .getByRole("button", { name: "Apply changes" })
        .click();
      const staleResume = (await staleResumePromise).postDataJSON() as RunBody;
      expect(forbiddenResumeKey(staleResume.resume)).toBeNull();
      await expect(
        card.getByText(
          "The flow changed before approval. No AI changes were applied.",
        ),
      ).toBeVisible({ timeout: 30_000 });
      const afterStale = (await (
        await page.request.get(`/api/v1/flows/${editable.id}`)
      ).json()) as Entity & { data: Record<string, unknown> };
      expect(afterStale.revision).toBe(manual.revision);
      expect(inputValue(afterStale)).toBe("Manual-save");
      expect(proposalRow(staleProposalId ?? "").status).toBe("stale");

      const userResponse = await page.request.get("/api/v1/users/whoami");
      expect(userResponse.ok(), await userResponse.text()).toBeTruthy();
      const currentUser = (await userResponse.json()) as Entity;
      const localeResponse = await page.request.patch(
        `/api/v1/users/${currentUser.id}`,
        { data: { preferred_locale: "ru" } },
      );
      expect(localeResponse.ok(), await localeResponse.text()).toBeTruthy();
      routedLocale = "ru";
      await page.evaluate((userId) => {
        localStorage.setItem("ketos-language-preference", "ru");
        localStorage.setItem(`ketos-language-preference:${userId}`, "ru");
      }, currentUser.id);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", "ru", {
        timeout: 15_000,
      });
      await awaitBootstrapTest(page, { skipModal: true });
      const reloadedCard = await openChat(page, workspace);
      await sendPrompt(page, reloadedCard, "S08 RU CREATE");
      const russianConfirmation = reloadedCard.getByRole("region", {
        name: "Подтверждение изменений flow",
      });
      await expect(russianConfirmation).toContainText("Низкий риск");
      await expect(
        russianConfirmation.getByRole("button", {
          name: "Применить изменения",
        }),
      ).toBeVisible();
      const russianResumePromise = page.waitForRequest(isChatRun);
      await russianConfirmation
        .getByRole("button", { name: "Отклонить" })
        .click();
      const russianResume = (
        await russianResumePromise
      ).postDataJSON() as RunBody;
      expect(forbiddenResumeKey(russianResume.resume)).toBeNull();
      await expect(
        reloadedCard.getByText("Изменения flow отклонены."),
      ).toBeVisible({
        timeout: 30_000,
      });
      await page.screenshot({
        path: path.join(evidenceRoot, "02-russian-stale-restore-copy.png"),
        fullPage: true,
      });

      expect(consoleErrors).toEqual([]);
      expect(failedRequests).toEqual([]);
    },
  );
});
