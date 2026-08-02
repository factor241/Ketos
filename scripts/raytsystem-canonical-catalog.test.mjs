import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const projectRoot = "/Volumes/Projects/ketos_canvas_mod_main";
const coreSkills = [
  "start",
  "graph",
  "raytsystem-ingest",
  "raytsystem-lint",
  "raytsystem-query",
  "raytsystem-research",
  "raytsystem-run-review",
  "raytsystem-save",
  "raytsystem-security-review",
];
const mediaSkills = ["raytsystem-watch"];
const canonicalSkills = [...coreSkills, ...mediaSkills];

async function globalRaytSystemPython() {
  const { stdout } = await execFileAsync("sh", ["-lc", "command -v raytsystem"]);
  const executable = stdout.trim();
  assert.ok(executable, "the globally installed raytsystem executable must be on PATH");

  const firstLine = (await readFile(executable, "utf8")).split("\n", 1)[0];
  assert.match(firstLine, /^#!/, "raytsystem must expose a Python entrypoint");

  const interpreter = firstLine.slice(2).trim();
  if (interpreter.startsWith("/usr/bin/env ")) {
    return interpreter.slice("/usr/bin/env ".length).trim();
  }
  return interpreter;
}

async function loadCatalog() {
  const python = await globalRaytSystemPython();
  const program = [
    "import json",
    "import sys",
    "from pathlib import Path",
    "from raytsystem.catalog import CatalogService",
    "snapshot = CatalogService(Path(sys.argv[1])).load()",
    "print(json.dumps(snapshot.to_dict(), sort_keys=True))",
  ].join("; ");
  const { stdout } = await execFileAsync(python, ["-c", program, repositoryRoot], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function frontmatter(source, skillId) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${skillId} must start with YAML frontmatter`);

  const value = (key) => match[1].match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?$`, "m"))?.[1];
  return {
    name: value("name"),
    testStatus: value("test_status"),
    version: value("version"),
  };
}

function bashCommands(source) {
  return [...source.matchAll(/```bash\n([\s\S]*?)```/g)]
    .flatMap((match) => match[1].split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.startsWith("raytsystem "));
}

test("canonical RaytSystem skills are owned once by two user-trusted skill-only packs", async () => {
  const snapshot = await loadCatalog();
  const packs = new Map(snapshot.packs.map((pack) => [pack.pack_id, pack]));
  const corePack = packs.get("pack_raytsystem_core");
  const mediaPack = packs.get("pack_raytsystem_media");

  assert.ok(corePack, "pack_raytsystem_core must exist");
  assert.ok(mediaPack, "pack_raytsystem_media must exist");
  assert.equal(corePack.trust_class, "user");
  assert.equal(mediaPack.trust_class, "user");
  assert.deepEqual(corePack.agent_ids, []);
  assert.deepEqual(mediaPack.agent_ids, []);
  assert.deepEqual([...corePack.skill_ids].sort(), [...coreSkills].sort());
  assert.deepEqual([...mediaPack.skill_ids].sort(), [...mediaSkills].sort());

  await assert.rejects(access(path.join(repositoryRoot, "packs", "raytsystem-core", "agents")));
  await assert.rejects(access(path.join(repositoryRoot, "packs", "raytsystem-media", "agents")));

  const owners = new Map();
  for (const pack of snapshot.packs) {
    for (const skillId of pack.skill_ids) {
      const current = owners.get(skillId) ?? [];
      current.push(pack.pack_id);
      owners.set(skillId, current);
    }
  }
  for (const skillId of canonicalSkills) {
    assert.deepEqual(owners.get(skillId), [
      skillId === "raytsystem-watch" ? "pack_raytsystem_media" : "pack_raytsystem_core",
    ]);
  }
});

test("canonical procedures use the global CLI with the explicit Ketos root", async () => {
  for (const skillId of canonicalSkills) {
    const skillDirectory = path.join(repositoryRoot, "skills", skillId);
    const skillPath = path.join(skillDirectory, "SKILL.md");
    const source = await readFile(skillPath, "utf8");
    const metadata = frontmatter(source, skillId);

    assert.equal(metadata.name, skillId);
    assert.equal(metadata.version, "1.0.0-ketos.1");
    assert.equal(metadata.testStatus, skillId === "raytsystem-watch" ? "pending" : "pass");
    assert.doesNotMatch(source, /\buv\s+run\s+raytsystem\b/i);

    const commands = bashCommands(source);
    assert.ok(commands.length > 0, `${skillId} must include a RaytSystem command`);
    for (const command of commands) {
      assert.match(command, /^raytsystem\s+/);
      assert.match(
        command,
        new RegExp(`(?:^|\\s)--root ${projectRoot.replaceAll("/", "\\/")}(?:\\s|$)`),
        `${skillId} command must use the explicit project root: ${command}`,
      );
    }

    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("#")) {
        continue;
      }
      await access(path.resolve(skillDirectory, target));
    }
  }
});
