import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.join(root, ".agents", "skills");
const projectRoot = "/Volumes/Projects/ketos_canvas_mod_main";
const orchestrationSkill = "main-agent-tool-orchestration";
const requiredPreSkill =
  "**REQUIRED PRE-SKILL:** Read and follow `main-agent-tool-orchestration` before using this skill.";
const ketosSkills = [
  "backend-code-review",
  "component-refactoring",
  "e2e-testing",
  "frontend-code-review",
  "frontend-query-mutation",
  "frontend-testing",
];
const raytAdapters = [
  "graph",
  "ingest",
  "lint",
  "query",
  "research",
  "run-review",
  "save",
  "security-review",
  "start",
  "watch",
];
const readOnlyAdapters = [
  "lint",
  "query",
  "research",
  "run-review",
  "security-review",
];
const watchRequiredReferences = [
  "tool-contracts.md",
  "sources-and-modes.md",
  "security-and-retention.md",
  "output-schema.md",
  "compatibility-report.md",
];
const expectedSkills = [orchestrationSkill, ...ketosSkills, ...raytAdapters].sort();
const canonicalSkillTargets = new Map(
  raytAdapters.map((skill) => [
    skill,
    path.join(
      root,
      "raytsystem",
      "skills",
      ["graph", "start"].includes(skill) ? skill : `raytsystem-${skill}`,
      "SKILL.md",
    ),
  ]),
);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("the repository exposes the exact Ketos and RaytSystem skill union", async () => {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const actual = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(actual, expectedSkills);
});

test("every skill has valid minimal YAML frontmatter without duplicate names", async () => {
  const declaredNames = [];

  for (const skill of expectedSkills) {
    const source = await readFile(path.join(skillsRoot, skill, "SKILL.md"), "utf8");
    const match = source.match(/^---\n([\s\S]*?)\n---\n/);

    assert.ok(match, `${skill} must start with YAML frontmatter`);
    assert.match(match[1], new RegExp(`^name: ${skill}$`, "m"));
    assert.match(match[1], /^description: .+/m);
    assert.doesNotMatch(match[1], /[<>]/, `${skill} frontmatter cannot contain angle brackets`);
    declaredNames.push(match[1].match(/^name: (.+)$/m)?.[1]);
  }

  assert.equal(new Set(declaredNames).size, expectedSkills.length);
  assert.deepEqual(declaredNames.sort(), expectedSkills);
});

test("AGENTS requires the orchestration skill at the start of every session", async () => {
  const source = await readFile(path.join(root, "AGENTS.md"), "utf8");

  assert.match(source, /at the start of every session/i);
  assert.ok(
    source.includes(".agents/skills/main-agent-tool-orchestration/SKILL.md"),
    "AGENTS must point to the canonical session-start skill",
  );
  assert.match(source, /only the main agent may (?:call|use).*tools/i);
  assert.match(source, /subagents? must not call any tool/i);
});

test("the orchestration skill selects capabilities and keeps every tool in the main agent", async () => {
  const source = await readFile(
    path.join(skillsRoot, orchestrationSkill, "SKILL.md"),
    "utf8",
  );

  assert.match(source, /beginning of every Codex session/i);
  assert.match(source, /available tools/i);
  assert.match(source, /available plugins/i);
  assert.match(source, /installed skills/i);
  assert.match(source, /only the main agent may call tools/i);
  assert.match(source, /subagents? must not call any tool/i);
  assert.match(source, /code or unified diff text/i);
  assert.ok(source.includes("`BLOCKED: missing context`"));
});

test("every other skill inherits the main-agent-only execution boundary", async () => {
  for (const skill of expectedSkills.filter((name) => name !== orchestrationSkill)) {
    const source = await readFile(path.join(skillsRoot, skill, "SKILL.md"), "utf8");

    assert.ok(source.includes(requiredPreSkill), `${skill} must require the pre-skill`);
    assert.match(source, /only the main agent may use tools or execute this skill/i);
    assert.match(source, /subagents? must not call\s+any tool/i);
    assert.match(source, /code or unified diff text/i);
  }
});

test("every RaytSystem adapter links to its canonical skill", async () => {
  for (const skill of raytAdapters) {
    const adapterPath = path.join(skillsRoot, skill, "SKILL.md");
    const source = await readFile(adapterPath, "utf8");
    const target = canonicalSkillTargets.get(skill);
    const relativeTarget = path.relative(path.dirname(adapterPath), target);

    assert.match(
      source,
      new RegExp(`\\]\\(${escapeRegExp(relativeTarget.replaceAll(path.sep, "/"))}\\)`),
      `${skill} must link to ${relativeTarget}`,
    );
    await readFile(target, "utf8");
  }
});

test("every RaytSystem adapter uses only the global root-scoped CLI", async () => {
  for (const skill of raytAdapters) {
    const source = await readFile(path.join(skillsRoot, skill, "SKILL.md"), "utf8");
    const commands = [...source.matchAll(/`([^`\n]*\braytsystem\b[^`\n]*)`/gi)].map(
      (match) => match[1],
    );

    assert.ok(commands.length > 0, `${skill} must include a RaytSystem CLI command`);
    assert.doesNotMatch(
      source,
      /\buv\s+run\s+raytsystem\b/i,
      `${skill} cannot invoke RaytSystem through uv`,
    );

    for (const command of commands) {
      assert.match(
        command,
        /^raytsystem\s+/,
        `${skill} must invoke the global raytsystem executable: ${command}`,
      );
      if (command === "raytsystem tool list --json") {
        continue;
      }
      assert.match(
        command,
        new RegExp(`(?:^|\\s)--root ${escapeRegExp(projectRoot)}(?:\\s|$)`),
        `${skill} command must use the explicit Ketos root: ${command}`,
      );
    }
  }
});

test("read-only RaytSystem adapters preflight with --no-write and reject --write", async () => {
  for (const skill of readOnlyAdapters) {
    const source = await readFile(path.join(skillsRoot, skill, "SKILL.md"), "utf8");
    const preflight = source.match(
      /`([^`\n]*\braytsystem agent preflight\b[^`\n]*)`/i,
    )?.[1];

    assert.ok(preflight, `${skill} must include an agent preflight command`);
    assert.match(
      preflight,
      /(?:^|\s)--no-write(?:\s|$)/,
      `${skill} preflight must explicitly remain no-write`,
    );
    assert.doesNotMatch(
      preflight,
      /(?:^|\s)--write(?:\s|$)/,
      `${skill} preflight must reject write authority`,
    );
  }
});

test("watch fails closed until canonical references and allowlisted dependencies are ready", async () => {
  const source = await readFile(path.join(skillsRoot, "watch", "SKILL.md"), "utf8");
  const referenceRoot =
    "../../../raytsystem/skills/raytsystem-watch/references";

  for (const reference of watchRequiredReferences) {
    assert.ok(
      source.includes(`${referenceRoot}/${reference}`),
      `watch must check canonical reference ${reference}`,
    );
  }

  assert.ok(
    source.includes("`raytsystem tool list --json`"),
    "watch must inspect Tool Hub readiness through the rootless tool list command",
  );
  assert.match(source, /\bcli_dependencies\b/, "watch must inspect CLI dependencies");
  assert.match(source, /\ballowlisted\b/i, "watch must require allowlisted dependencies");
  assert.match(source, /\bBLOCKED\b/, "watch must return BLOCKED when readiness fails");
  assert.doesNotMatch(
    source,
    /`raytsystem tool watch\b/i,
    "watch must not advertise execution as ready before readiness is proven",
  );
});
