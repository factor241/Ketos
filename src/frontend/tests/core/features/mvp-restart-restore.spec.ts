import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

type Entity = { id: string };
type RecoveryIds = Record<string, string>;

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../../..");
const BACKEND_PORT = 7860;

function stageRunRoot(): string {
  const tempRoot = process.env.TMPDIR;
  if (!tempRoot)
    throw new Error("TMPDIR must be redirected to Stage-09 external evidence");
  const candidates = readdirSync(tempRoot)
    .filter((name) => name.startsWith("ketos-stage01-playwright-"))
    .sort();
  if (candidates.length !== 1)
    throw new Error(
      `Expected one Playwright runtime root, found ${candidates.length}`,
    );
  return path.join(tempRoot, candidates[0]);
}

function listenerPid(): number {
  const output = execFileSync(
    "lsof",
    ["-nP", `-iTCP:${BACKEND_PORT}`, "-sTCP:LISTEN", "-t"],
    { encoding: "utf8" },
  ).trim();
  const pids = output
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  if (pids.length !== 1)
    throw new Error(`Expected one backend listener, got ${output}`);
  return pids[0];
}

function assertOwnedBackend(pid: number) {
  const cwdOutput = execFileSync(
    "lsof",
    ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
    {
      encoding: "utf8",
    },
  );
  const cwd = cwdOutput
    .split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
  if (!cwd || path.resolve(cwd) !== REPOSITORY_ROOT)
    throw new Error(
      `Refusing to signal unowned listener PID ${pid} with cwd ${cwd ?? "unknown"}`,
    );
  const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  if (
    !command.includes("uvicorn") ||
    !command.includes("ketos.main:create_app")
  )
    throw new Error(`Refusing to signal unexpected listener PID ${pid}`);
}

async function waitForHealth(expected: "up" | "down") {
  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(
            `http://127.0.0.1:${BACKEND_PORT}/health_check`,
          );
          return response.ok;
        } catch {
          return false;
        }
      },
      { timeout: 120_000 },
    )
    .toBe(expected === "up");
}

async function createEntity(
  page: Page,
  url: string,
  data: object,
  status = 201,
) {
  const response = await page.request.post(url, { data });
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as Entity & Record<string, unknown>;
}

function backendEnvironment(runtimeRoot: string): NodeJS.ProcessEnv {
  const backend = path.join(runtimeRoot, "backend");
  return {
    ...process.env,
    KETOS_DATABASE_URL: `sqlite:///${path.join(backend, "ketos.sqlite3")}`,
    KETOS_CONFIG_DIR: backend,
    KETOS_DATA_DIR: backend,
    KETOS_TEMP_DIR: backend,
    KETOS_AG_UI_BINDING_DB: path.join(
      runtimeRoot,
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
    PYTHONDONTWRITEBYTECODE: "1",
  };
}

function seedDurableState(runtimeRoot: string, ids: RecoveryIds): RecoveryIds {
  const source = `
import asyncio, json, runpy, sys
from pathlib import Path
module = runpy.run_path("scripts/mvp/restart_harness.py")
result = asyncio.run(module["_seed_durable_recovery_fixture"](data_dir=Path(sys.argv[2]), ids=json.loads(sys.argv[1])))
print(json.dumps(result))
`;
  const output = execFileSync(
    "uv",
    [
      "run",
      "python",
      "-c",
      source,
      JSON.stringify(ids),
      path.join(runtimeRoot, "backend"),
    ],
    {
      cwd: REPOSITORY_ROOT,
      env: backendEnvironment(runtimeRoot),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  return { ...ids, ...(JSON.parse(output.trim()) as RecoveryIds) };
}

async function primeRuntimeInterrupt(page: Page, ids: RecoveryIds) {
  const response = await page.request.post(
    "/api/copilotkit/agent/ketos-chat/run",
    {
      data: {
        threadId: ids.chat_id,
        runId: randomUUID(),
        state: { projectId: ids.project_id },
        messages: [],
        tools: [],
        context: [],
        forwardedProps: {},
      },
      headers: { accept: "text/event-stream" },
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
  const finished = events.find((event) => event.type === "RUN_FINISHED");
  expect(finished).toMatchObject({
    outcome: {
      type: "interrupt",
      interrupts: [{ id: ids.interrupt_id }],
    },
  });
}

function startReplacementBackend(
  runtimeRoot: string,
  logPath: string,
): ChildProcess {
  const child = spawn(
    "uv",
    [
      "run",
      "uvicorn",
      "--factory",
      "ketos.main:create_app",
      "--host",
      "127.0.0.1",
      "--port",
      String(BACKEND_PORT),
      "--loop",
      "asyncio",
      "--workers",
      "1",
      "--log-level",
      "error",
      "--no-access-log",
    ],
    {
      cwd: REPOSITORY_ROOT,
      env: backendEnvironment(runtimeRoot),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.once("exit", () => writeFileSync(logPath, Buffer.concat(chunks)));
  return child;
}

test.use({ trace: "off" });

test(
  "direct Board URL restores server state, transcript, draft, command, and prior-worker Job after PID change",
  { tag: ["@release", "@workspace", "@restart", "@a11y"] },
  async ({ page, context }, testInfo) => {
    const evidenceRoot = process.env.S09_RUN_DIR;
    const codeSha = process.env.S09_CODE_SHA;
    if (!evidenceRoot || !codeSha)
      throw new Error(
        "S09_RUN_DIR and S09_CODE_SHA are required for the Stage-09 browser gate",
      );
    const runtimeRoot = stageRunRoot();
    const processDir = path.join(evidenceRoot, "process");
    mkdirSync(processDir, { recursive: true, mode: 0o700 });
    const tracePath = testInfo.outputPath("stage09-trace.zip");
    const screenshotPath = testInfo.outputPath("stage09-restored.png");
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    await awaitBootstrapTest(page, { skipModal: true });
    await page.setViewportSize({ width: 1440, height: 900 });

    const whoami = await page.request.get("/api/v1/users/whoami");
    expect(whoami.ok(), await whoami.text()).toBeTruthy();
    const actorId = String(((await whoami.json()) as Entity).id);
    const project = await createEntity(page, "/api/v1/projects/", {
      name: `S09 browser ${Date.now().toString(36)}`,
      description: "Stage 09 browser restart proof",
      flows_list: [],
      components_list: [],
    });
    const board = await createEntity(
      page,
      `/api/v1/projects/${project.id}/boards`,
      {
        title: "Stage 09 restored board",
      },
    );
    const chat = await createEntity(
      page,
      `/api/v1/projects/${project.id}/chats`,
      {
        title: "Stage 09 restored chat",
        provider: "OpenAI",
        model_name: "gpt-5.4",
        context_policy: "board",
      },
    );
    const flow = await createEntity(page, "/api/v1/flows/", {
      name: "Stage 09 prior-worker flow",
      description: "Stage 09 Job recovery target",
      folder_id: project.id,
      data: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    });
    const chatPlacement = await createEntity(
      page,
      `/api/v1/boards/${board.id}/placements`,
      {
        target_kind: "chat",
        target_id: chat.id,
        x: 560,
        y: 180,
        width: 480,
        height: 360,
        z_index: 4,
      },
    );
    await createEntity(page, `/api/v1/boards/${board.id}/placements`, {
      target_kind: "automation",
      target_id: flow.id,
      x: 1080,
      y: 180,
      width: 420,
      height: 320,
      z_index: 5,
    });
    const noteCreated = await createEntity(
      page,
      `/api/v1/boards/${board.id}/board-notes`,
      {
        content: "authoritative server state",
        color: "neutral",
        placement: { x: 160, y: 240, width: 320, height: 240, z_index: 7 },
      },
    );
    const note = noteCreated.note as Entity;
    const notePlacement = noteCreated.placement as Entity;
    const ids = seedDurableState(runtimeRoot, {
      actor_id: actorId,
      project_id: project.id,
      board_id: board.id,
      chat_id: chat.id,
      flow_id: flow.id,
      note_id: note.id,
      placement_id: notePlacement.id,
    });
    await primeRuntimeInterrupt(page, ids);

    const pid1 = listenerPid();
    assertOwnedBackend(pid1);
    process.kill(pid1, "SIGTERM");
    await waitForHealth("down");
    let replacement: ChildProcess | null = null;
    let pid2 = 0;
    try {
      replacement = startReplacementBackend(
        runtimeRoot,
        path.join(processDir, "playwright-pid2.log"),
      );
      await waitForHealth("up");
      pid2 = listenerPid();
      expect(pid2).not.toBe(pid1);

      await page.addInitScript(
        ({ boardId, chatId }) => {
          localStorage.setItem(
            `ketos.board.restore.v1:${boardId}`,
            "{corrupted-json",
          );
          sessionStorage.setItem(
            `ketos-chat-draft-v1-${chatId}`,
            "unsent restart draft",
          );
        },
        { boardId: board.id, chatId: chat.id },
      );
      await page.goto(`/project/${project.id}/board/${board.id}`);
      await expect(
        page.getByRole("heading", { name: "Stage 09 restored board" }),
      ).toBeVisible();
      await expect(
        page.locator(`[data-id="${notePlacement.id}"]`),
      ).toContainText("authoritative server state");
      await expect(
        page.locator(`[data-id="${chatPlacement.id}"]`),
      ).toBeVisible();
      await expect(
        page.getByText("Persist this exact transcript across restart."),
      ).toBeVisible();
      await expect(
        page.getByText("Transcript committed before PID-1 stopped."),
      ).toBeVisible();
      await expect(page.getByText("Draft not sent")).toBeVisible();
      await expect(page.getByTestId("copilot-chat-textarea")).toHaveValue(
        "unsent restart draft",
      );
      await expect(
        page
          .locator('p[aria-live="polite"]')
          .filter({ hasText: "Board restored" }),
      ).toHaveCount(1);

      const confirmation = page.locator(
        `[data-interrupt-id="${ids.interrupt_id}"]`,
      );
      await expect(confirmation).toBeVisible();
      await expect(confirmation).toBeFocused();
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await confirmation.getByRole("button", { name: "Reject" }).click();
      await expect(confirmation).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.activeElement !== document.body &&
              document.activeElement instanceof HTMLElement &&
              document.activeElement.isConnected,
          ),
        )
        .toBe(true);
      const proposalResponse = await page.request.get(
        `/api/v1/command-proposals/${ids.proposal_id}`,
      );
      expect(proposalResponse.ok(), await proposalResponse.text()).toBeTruthy();
      expect(
        ((await proposalResponse.json()) as { status: string }).status,
      ).toBe("rejected");
      const history = await page.request.get(
        `/api/v1/boards/${board.id}/automations/${flow.id}/runs`,
      );
      expect(history.ok(), await history.text()).toBeTruthy();
      const jobs = (await history.json()) as Array<{
        job_id: string;
        status: string;
        reason: string | null;
      }>;
      expect(jobs.filter((job) => job.job_id === ids.job_id)).toEqual([
        expect.objectContaining({
          status: "failed",
          reason: "backend_restarted",
        }),
      ]);
      writeFileSync(
        path.join(processDir, "browser.json"),
        `${JSON.stringify(
          {
            schema_version: 1,
            code_sha: codeSha,
            pid_1: pid1,
            pid_2: pid2,
            pid_changed: true,
            persistent_ids: ids,
            outcomes: {
              direct_url: true,
              server_wins: true,
              transcript_restored: true,
              draft_preserved: true,
              focus_stable: true,
              live_region_single: true,
              interrupt_resolved_once: true,
              job_recovery_visible: true,
            },
            trace: path.relative(evidenceRoot, tracePath),
            screenshots: [path.relative(evidenceRoot, screenshotPath)],
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
    } finally {
      await context.tracing.stop({ path: tracePath });
      if (replacement?.pid) {
        try {
          process.kill(-replacement.pid, "SIGTERM");
        } catch {
          // The owned replacement already exited.
        }
      }
    }
  },
);
