import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const adaptersRoot = path.join(repositoryRoot, ".claude", "skills");
const projectRoot = "/Volumes/Projects/ketos_canvas_mod_main";
const expectedAdapters = [
  "start",
  "graph",
  "ingest",
  "query",
  "lint",
  "save",
  "research",
  "run-review",
  "security-review",
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
const canonicalTargets = new Map(
  expectedAdapters.map((adapter) => [
    adapter,
    `skills/${
      adapter === "start" || adapter === "graph"
        ? adapter
        : `raytsystem-${adapter}`
    }/SKILL.md`,
  ]),
);

async function readAdapter(adapter) {
  const adapterPath = path.join(adaptersRoot, adapter, "SKILL.md");
  await access(adapterPath);
  return readFile(adapterPath, "utf8");
}

test("Claude Code exposes every project RaytSystem adapter", async () => {
  for (const adapter of expectedAdapters) {
    const source = await readAdapter(adapter);
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);

    assert.ok(frontmatter, `${adapter} must start with YAML frontmatter`);
    assert.match(frontmatter[1], new RegExp(`^name: ${adapter}$`, "m"));
    assert.match(frontmatter[1], /^description: .+/m);
  }
});

test("all ten adapters point to canonical root skills and the global CLI", async () => {
  for (const adapter of expectedAdapters) {
    const source = await readAdapter(adapter);
    const canonicalSkill = canonicalTargets.get(adapter);

    assert.ok(
      source.includes(canonicalSkill),
      `${adapter} must delegate to ${canonicalSkill}`,
    );
    await access(path.join(repositoryRoot, canonicalSkill));
    assert.ok(
      source.includes(`--root ${projectRoot}`),
      `${adapter} must use the explicit Ketos project root`,
    );
    assert.match(
      source,
      /global [`"]raytsystem[`"] executable/,
      `${adapter} must use the globally installed raytsystem executable`,
    );
    assert.doesNotMatch(
      source,
      /uv\s+run\s+raytsystem/,
      `${adapter} must not invoke raytsystem through uv`,
    );
  }
});

test("read-only adapters override canonical preflight with --no-write and reject --write", async () => {
  for (const adapter of readOnlyAdapters) {
    const source = await readAdapter(adapter);
    const preflight = source.match(
      /`([^`\n]*\braytsystem agent preflight\b[^`\n]*)`/i,
    )?.[1];

    assert.ok(preflight, `${adapter} must include an agent preflight command`);
    assert.match(
      preflight,
      /(?:^|\s)--no-write(?:\s|$)/,
      `${adapter} must explicitly override canonical preflight as no-write`,
    );
    assert.doesNotMatch(
      preflight,
      /(?:^|\s)--write(?:\s|$)/,
      `${adapter} must reject write authority`,
    );
  }
});

test("watch fails closed until canonical references and allowlisted dependencies are ready", async () => {
  const source = await readAdapter("watch");
  const referenceRoot = "skills/raytsystem-watch/references";

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
