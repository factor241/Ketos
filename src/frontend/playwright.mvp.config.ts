import { mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const repositoryRoot = path.resolve(__dirname, "../..");
const runtimeRoot = path.resolve(__dirname, "../copilot-runtime");
const runRoot =
  process.env.KETOS_MVP_RUN_DIR ??
  path.join(realpathSync(tmpdir()), `ketos-stage01-playwright-${process.pid}`);
const backendDataRoot =
  process.env.KETOS_DATA_DIR ?? path.join(runRoot, "backend");
const databaseUrl =
  process.env.KETOS_DATABASE_URL ??
  `sqlite:///${path.join(backendDataRoot, "ketos.sqlite3")}`;
const bindingRoot = path.join(runRoot, "binding");
const traceMode =
  process.env.STAGE08_TRACE === "on"
    ? ("off" as const)
    : ("retain-on-failure" as const);

for (const directory of [runRoot, backendDataRoot, bindingRoot]) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 5 * 60 * 1000,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    actionTimeout: 20_000,
    trace: traceMode,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command:
        "uv run uvicorn --factory ketos.main:create_app --host 127.0.0.1 --port 7860 --loop asyncio --log-level error --no-access-log",
      cwd: repositoryRoot,
      url: "http://127.0.0.1:7860/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        KETOS_DATABASE_URL: databaseUrl,
        KETOS_CONFIG_DIR: backendDataRoot,
        KETOS_DATA_DIR: backendDataRoot,
        KETOS_TEMP_DIR: backendDataRoot,
        KETOS_AG_UI_BINDING_DB: path.join(bindingRoot, "run-bindings.ledger"),
        KETOS_AUTO_LOGIN: "true",
        KETOS_DEACTIVATE_TRACING: "true",
        KETOS_FEATURE_MVP_WORKSPACE: "true",
        KETOS_FEATURE_MVP_CHAT: process.env.KETOS_FEATURE_MVP_CHAT ?? "true",
        KETOS_AGENTIC_EXPERIENCE: "true",
        KETOS_LOG_LEVEL: "ERROR",
        LANGGRAPH_STRICT_MSGPACK: "true",
        DO_NOT_TRACK: "true",
        OPENAI_API_KEY:
          process.env.STAGE10_DETERMINISTIC_OPENAI_API_KEY ??
          "stage10-deterministic-test-key",
        OPENAI_BASE_URL: `http://127.0.0.1:${
          process.env.STAGE10_OPENAI_PORT ?? "18767"
        }/v1`,
      },
    },
    {
      command:
        "npm run build && exec node --preserve-symlinks-main --enable-source-maps dist/server.js",
      cwd: runtimeRoot,
      url: "http://127.0.0.1:8788/api/copilotkit/info",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "exec ./node_modules/.bin/vite --host 127.0.0.1 --port 3000 --strictPort",
      cwd: __dirname,
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_PROXY_TARGET: "http://127.0.0.1:7860",
      },
    },
  ],
});
