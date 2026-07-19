import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const repositoryRoot = path.resolve(__dirname, "../..");
const runtimeRoot = path.resolve(__dirname, "../copilot-runtime");
const runRoot =
  process.env.KETOS_MVP_RUN_DIR ??
  path.join(tmpdir(), `ketos-stage01-playwright-${process.pid}`);
const backendDataRoot = path.join(runRoot, "backend");
const bindingRoot = path.join(runRoot, "binding");
const checkpointRoot = path.join(runRoot, "checkpoint");

for (const directory of [
  runRoot,
  backendDataRoot,
  bindingRoot,
  checkpointRoot,
]) {
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
    trace: "retain-on-failure",
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
        KETOS_DATABASE_URL: `sqlite:///${path.join(backendDataRoot, "ketos.sqlite3")}`,
        KETOS_CONFIG_DIR: backendDataRoot,
        KETOS_DATA_DIR: backendDataRoot,
        KETOS_TEMP_DIR: backendDataRoot,
        KETOS_AG_UI_BINDING_DB: path.join(bindingRoot, "run-bindings.ledger"),
        KETOS_AG_UI_CHECKPOINT_DB: path.join(
          checkpointRoot,
          "langgraph-checkpoints.sqlite3",
        ),
        KETOS_AUTO_LOGIN: "true",
        KETOS_DEACTIVATE_TRACING: "true",
        KETOS_FEATURE_MVP_WORKSPACE: "true",
        KETOS_FEATURE_MVP_CHAT: "true",
        KETOS_LOG_LEVEL: "ERROR",
        LANGGRAPH_STRICT_MSGPACK: "true",
        DO_NOT_TRACK: "true",
      },
    },
    {
      command: "npm run build && exec node --enable-source-maps dist/server.js",
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
