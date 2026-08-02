// tests/globalTeardown.ts

import { execFileSync } from "node:child_process";
import fs from "fs";
import path from "path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const replacementRegistryName = "stage10-replacement-processes.json";

type ReplacementRegistry = {
  schema: "ketos.stage10.replacement-processes.v1";
  process_groups: Array<{
    pid: number;
    role: "backend" | "frontend";
    command_fragment: string;
  }>;
};

function processTarget(pid: number) {
  return process.platform === "win32" ? pid : -pid;
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(processTarget(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function ownsExpectedProcessGroup(
  replacement: ReplacementRegistry["process_groups"][number],
): boolean {
  if (process.platform === "win32") return true;
  try {
    const output = execFileSync(
      "/bin/ps",
      ["-o", "pgid=", "-o", "command=", "-p", String(replacement.pid)],
      { encoding: "utf8" },
    ).trim();
    const match = output.match(/^(\d+)\s+(.+)$/);
    return (
      Number(match?.[1]) === replacement.pid &&
      Boolean(match?.[2]?.includes(replacement.command_fragment))
    );
  } catch {
    return !isProcessGroupAlive(replacement.pid);
  }
}

async function stopStage10Replacements(runRoot: string) {
  const registryPath = path.join(runRoot, replacementRegistryName);
  if (!fs.existsSync(registryPath)) return;

  let registry: ReplacementRegistry;
  try {
    registry = JSON.parse(
      fs.readFileSync(registryPath, "utf8"),
    ) as ReplacementRegistry;
  } catch (error) {
    throw new Error("Unable to read Stage10 replacement registry", {
      cause: error,
    });
  }
  if (
    registry.schema !== "ketos.stage10.replacement-processes.v1" ||
    !Array.isArray(registry.process_groups) ||
    registry.process_groups.some(
      (replacement) =>
        !Number.isSafeInteger(replacement.pid) ||
        replacement.pid <= 1 ||
        !["backend", "frontend"].includes(replacement.role) ||
        typeof replacement.command_fragment !== "string" ||
        replacement.command_fragment.length < 4,
    )
  ) {
    throw new Error("Refusing invalid Stage10 replacement process registry");
  }

  const replacements = registry.process_groups.filter(
    (replacement, index, entries) =>
      entries.findIndex((entry) => entry.pid === replacement.pid) === index,
  );
  for (const replacement of replacements) {
    if (!ownsExpectedProcessGroup(replacement)) {
      throw new Error(
        `Refusing to signal unexpected ${replacement.role} process group ${replacement.pid}`,
      );
    }
    try {
      process.kill(processTarget(replacement.pid), "SIGTERM");
    } catch {
      // The owned replacement may already have exited.
    }
  }
  const deadline = Date.now() + 5_000;
  while (
    replacements.some((replacement) => isProcessGroupAlive(replacement.pid)) &&
    Date.now() < deadline
  ) {
    await sleep(100);
  }
  for (const replacement of replacements.filter((entry) =>
    isProcessGroupAlive(entry.pid),
  )) {
    try {
      process.kill(processTarget(replacement.pid), "SIGKILL");
    } catch {
      // A process that exited between the check and signal is already clean.
    }
  }
  const killDeadline = Date.now() + 2_000;
  while (
    replacements.some((replacement) => isProcessGroupAlive(replacement.pid)) &&
    Date.now() < killDeadline
  ) {
    await sleep(100);
  }
  const survivors = replacements.filter((replacement) =>
    isProcessGroupAlive(replacement.pid),
  );
  if (survivors.length > 0) {
    throw new Error(
      `Stage10 replacement cleanup left ${survivors.length} process group(s) alive`,
    );
  }
}

// On Windows, the uvicorn process can still hold SQLite file handles when
// teardown runs. POSIX allows unlinking files with open handles; Win32 does
// not, surfacing as EBUSY/EPERM. Retry with backoff, fall back to walking the
// tree and removing children individually, and never throw out of teardown.
async function removeWithRetry(target: string): Promise<boolean> {
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      if (!fs.existsSync(target)) return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") {
        throw err;
      }
    }
    await sleep(200 * 2 ** i);
  }
  return !fs.existsSync(target);
}

function removeChildrenBestEffort(target: string): string[] {
  const failed: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return failed;
  }
  for (const entry of entries) {
    const childPath = path.join(target, entry.name);
    try {
      fs.rmSync(childPath, { recursive: true, force: true });
    } catch {
      failed.push(childPath);
    }
  }
  return failed;
}

export default async () => {
  console.warn("Removing the temp database");
  const configuredRunRoot = process.env.KETOS_MVP_RUN_DIR;
  const tempDbPath = configuredRunRoot ?? path.join(__dirname, "..", "temp");
  if (
    configuredRunRoot &&
    (path.dirname(configuredRunRoot) !== "/Volumes/Projects" ||
      !/^ketos-playwright(?:-focus)?\.[A-Za-z0-9]+$/.test(
        path.basename(configuredRunRoot),
      ))
  ) {
    console.warn(
      `Refusing to remove unexpected Playwright run root: ${configuredRunRoot}`,
    );
    return;
  }
  console.warn("tempDbPath", tempDbPath);

  if (!fs.existsSync(tempDbPath)) {
    console.warn("Temp database directory does not exist, skipping removal");
    return;
  }

  try {
    await stopStage10Replacements(tempDbPath);
  } catch (error) {
    console.error("Error while stopping Stage10 replacements:", error);
    throw error;
  }

  try {
    if (await removeWithRetry(tempDbPath)) {
      console.warn("Successfully removed the temp database");
      return;
    }

    const stragglers = removeChildrenBestEffort(tempDbPath);
    if (await removeWithRetry(tempDbPath)) {
      console.warn(
        "Successfully removed the temp database after per-file fallback",
      );
      return;
    }

    console.warn(
      `Temp database directory still present after retries; leaving it for the runner workspace cleanup. Files that resisted removal: ${stragglers.length}`,
    );
  } catch (error) {
    console.error("Error while removing the temp database:", error);
  }
};
