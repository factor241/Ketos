#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "ops", "knowledge-corpus-manifest.json");
const langflowLockPath = path.join(root, "references", "langflow-upstream.lock.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const langflowLock = JSON.parse(await readFile(langflowLockPath, "utf8"));

const expectedTotals = {
  candidates: { count: 1754, bytes: 31068661 },
  included: { count: 1587, bytes: 17500285 },
  excluded: { count: 167, bytes: 13568376 },
  json: { count: 446, bytes: 10382185 },
  documents: { count: 1125, bytes: 7055273 },
  ingestion: { count: 814, bytes: 13034721 },
};

const runtimeSegments = new Set([
  ".cache",
  ".docusaurus",
  ".git",
  ".pytest_cache",
  ".raytsystem",
  ".venv",
  "__pycache__",
  "blob-report",
  "build",
  "coverage",
  "dist",
  "graphify-out",
  "htmlcov",
  "node_modules",
  "playwright-report",
  "test-results",
  "venv",
]);

const generatedPathPatterns = [
  /(^|\/)ledger\/generations\//,
  /(^|\/)knowledge\/(?:\.projection\.json|graph\.json|hot\.md|index\.md|_raw\/|normalized\/)/,
  /(^|\/)package-lock\.json$/,
  /^docs\/openapi\/openapi\.json$/,
  /(^|\/)evals\/[^/]+\/results\//,
  /^src\/kfx\/src\/kfx\/_assets\/(?:component_index|stable_hash_history)\.json$/,
  /(^|\/)THIRD-PARTY-JS-LICENSES\.txt$/,
];

function metrics(entries) {
  return {
    count: entries.length,
    bytes: entries.reduce((total, entry) => total + entry.size, 0),
  };
}

function groupedMetrics(entries, key) {
  const grouped = new Map();
  for (const entry of entries) {
    const value = entry[key];
    const current = grouped.get(value) ?? { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += entry.size;
    grouped.set(value, current);
  }
  return Object.fromEntries([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function groupedCounts(entries, key) {
  const grouped = new Map();
  for (const entry of entries) {
    grouped.set(entry[key], (grouped.get(entry[key]) ?? 0) + 1);
  }
  return Object.fromEntries([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function extension(filePath) {
  return path.posix.extname(filePath).toLowerCase();
}

function isRuntimeOrGenerated(filePath) {
  if (filePath === "ops" || filePath.startsWith("ops/")) {
    return true;
  }
  if (filePath.split("/").some((segment) => runtimeSegments.has(segment))) {
    return true;
  }
  return generatedPathPatterns.some((pattern) => pattern.test(filePath));
}

function gitOutput(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function assertLangflowLockConsistency(lock) {
  const provenanceId = `langflow-upstream@${lock.tag}`;
  const upstreamRoot = path.join(root, "references", "langflow-upstream");
  const provenance = manifest.provenance_sources.find((source) => source.id === provenanceId);

  assert.equal(
    lock.url,
    "https://github.com/langflow-ai/langflow.git",
    "LangFlow lock URL must identify the official upstream repository",
  );
  assert.equal(
    lock.base_ketos_tag,
    lock.tag,
    "LangFlow lock base Ketos tag must match the pinned upstream tag",
  );
  assert.equal(
    lock.merge_base,
    lock.sha,
    "LangFlow lock merge-base must match the pinned upstream SHA",
  );
  assert.ok(Number.isInteger(lock.commits_ahead), "LangFlow lock commits-ahead must be an integer");
  assert.ok(provenance, `${provenanceId} provenance derived from the lock must be present`);
  assert.equal(
    provenance.revision,
    lock.sha,
    "LangFlow lock SHA must match manifest provenance",
  );
  assert.deepEqual(provenance, {
    id: provenanceId,
    status: "present",
    path: "references/langflow-upstream",
    revision: lock.sha,
    expected_revision: lock.sha,
    tag: lock.tag,
    dirty: false,
    scope: "tracked documentation under docs/ plus key tracked root Markdown, MDX, and text documents",
  });

  assert.equal(
    gitOutput(upstreamRoot, ["remote", "get-url", "origin"]),
    lock.url,
    "LangFlow checkout remote must match the lock URL",
  );
  assert.equal(
    gitOutput(upstreamRoot, ["rev-parse", "HEAD"]),
    lock.sha,
    "LangFlow checkout HEAD must match the lock SHA",
  );
  assert.equal(
    gitOutput(upstreamRoot, ["rev-parse", `${lock.tag}^{commit}`]),
    lock.sha,
    "LangFlow checkout tag must resolve to the lock SHA",
  );
  assert.equal(
    gitOutput(upstreamRoot, ["describe", "--tags", "--exact-match", "HEAD"]),
    lock.tag,
    "LangFlow checkout HEAD must match the lock tag",
  );
  assert.equal(
    gitOutput(upstreamRoot, ["status", "--porcelain"]),
    "",
    "LangFlow checkout must remain clean",
  );
  assert.equal(
    gitOutput(root, ["rev-parse", "HEAD"]),
    lock.current_fork_head,
    "Ketos HEAD must match the fork head recorded in the LangFlow lock",
  );
  assert.equal(
    gitOutput(root, ["rev-parse", `${lock.base_ketos_tag}^{commit}`]),
    lock.sha,
    "Ketos base tag must resolve to the pinned upstream SHA",
  );
  assert.equal(
    gitOutput(root, ["merge-base", "HEAD", `${lock.base_ketos_tag}^{commit}`]),
    lock.merge_base,
    "Ketos merge-base must match the LangFlow lock",
  );
  assert.equal(
    Number(gitOutput(root, ["rev-list", "--count", `${lock.base_ketos_tag}^{commit}..HEAD`])),
    lock.commits_ahead,
    "Ketos commits-ahead count must match the LangFlow lock",
  );

  return { provenanceId, upstreamRoot };
}

test("manifest explicitly prunes test-results and emits no runtime or generated paths", () => {
  assert.ok(
    manifest.scope.root_prunes.includes("test-results"),
    "scope.root_prunes must explicitly include test-results",
  );

  const leakedPaths = manifest.included.filter((entry) => isRuntimeOrGenerated(entry.path));
  assert.deepEqual(
    leakedPaths,
    [],
    `runtime/generated paths must never be included: ${leakedPaths
      .map((entry) => entry.path)
      .join(", ")}`,
  );

  assert.deepEqual(
    manifest.excluded.find((entry) => entry.path === "test-results/.last-run.json"),
    {
      path: "test-results/.last-run.json",
      provenance: "ketos",
      type: "json",
      size: 45,
      reason: "runtime-test-report",
    },
    "test-results audit metadata must remain excluded without a content hash",
  );

  const includedPaths = new Set(manifest.included.map((entry) => entry.path));
  const excludedPaths = new Set(manifest.excluded.map((entry) => entry.path));
  assert.equal(includedPaths.size, manifest.included.length, "included paths must be unique");
  assert.equal(excludedPaths.size, manifest.excluded.length, "excluded paths must be unique");
  assert.deepEqual(
    [...includedPaths].filter((filePath) => excludedPaths.has(filePath)),
    [],
    "included and excluded paths must be disjoint",
  );
});

test("manifest sizes and included hashes match current working-tree bytes", async () => {
  for (const entry of [...manifest.included, ...manifest.excluded]) {
    const absolutePath = path.join(root, entry.path);
    const fileStat = await stat(absolutePath);
    assert.ok(fileStat.isFile(), `${entry.path} must resolve to a regular file`);
    assert.equal(fileStat.size, entry.size, `${entry.path} size must match the manifest`);
  }

  for (const entry of manifest.included) {
    const bytes = await readFile(path.join(root, entry.path));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.match(entry.sha256, /^[a-f0-9]{64}$/, `${entry.path} must have a SHA-256 digest`);
    assert.equal(sha256, entry.sha256, `${entry.path} hash must match current bytes`);
  }
});

test("LangFlow lock drift is rejected by provenance validation", () => {
  assert.throws(
    () =>
      assertLangflowLockConsistency({
        ...langflowLock,
        sha: "0".repeat(40),
        merge_base: "0".repeat(40),
      }),
    /LangFlow lock SHA must match manifest provenance/,
  );
});

test("LangFlow upstream provenance is present, pinned, and hashes current tracked files", async () => {
  const { provenanceId, upstreamRoot } = assertLangflowLockConsistency(langflowLock);

  const trackedPaths = new Set(
    execFileSync("git", ["-C", upstreamRoot, "ls-files", "-z"], { encoding: "utf8" })
      .split("\0")
      .filter(Boolean),
  );
  const upstreamEntries = manifest.included.filter(
    (entry) => entry.provenance === provenanceId,
  );
  const upstreamExclusions = manifest.excluded.filter(
    (entry) => entry.provenance === provenanceId,
  );
  const expectedCandidatePaths = [...trackedPaths]
    .filter(
      (filePath) =>
        [".md", ".mdx", ".txt"].includes(extension(filePath)) &&
        (filePath.startsWith("docs/") || !filePath.includes("/")),
    )
    .map((filePath) => `references/langflow-upstream/${filePath}`)
    .sort();
  const emittedCandidatePaths = [...upstreamEntries, ...upstreamExclusions]
    .map((entry) => entry.path)
    .sort();

  assert.deepEqual(
    emittedCandidatePaths,
    expectedCandidatePaths,
    "every focused tracked LangFlow document candidate must be included or individually excluded",
  );
  assert.deepEqual(groupedCounts(upstreamExclusions, "reason"), {
    "documentation-fixture": 3,
    "generated-api-example-result": 33,
    "sensitive-content": 96,
  });
  for (const entry of upstreamExclusions) {
    assert.ok(
      ["documentation-fixture", "generated-api-example-result", "sensitive-content"].includes(
        entry.reason,
      ),
      `${entry.path} must have a concrete approved exclusion reason`,
    );
  }

  assert.ok(upstreamEntries.length > 0, `${provenanceId} must contribute included files`);

  for (const entry of upstreamEntries) {
    assert.ok(
      entry.path.startsWith("references/langflow-upstream/"),
      `${entry.path} must stay inside the pinned LangFlow checkout`,
    );
    const upstreamPath = entry.path.slice("references/langflow-upstream/".length);
    assert.ok(trackedPaths.has(upstreamPath), `${upstreamPath} must be tracked at the pinned commit`);
    assert.ok(
      upstreamPath.startsWith("docs/") || !upstreamPath.includes("/"),
      `${upstreamPath} must be a docs/ or key root document`,
    );
    assert.ok(
      [".md", ".mdx", ".txt"].includes(extension(upstreamPath)),
      `${upstreamPath} must stay inside the focused documentation extension scope`,
    );
    const bytes = await readFile(path.join(root, entry.path));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256, entry.sha256, `${entry.path} hash must match pinned upstream bytes`);
  }
});

test("secret-shape policy metadata excludes secret evidence from the manifest", () => {
  assert.deepEqual(manifest.scope.sensitivity_policy, {
    scanner: "raytsystem_secret_patterns",
    scanner_version: "1.2.0",
    protected_names_and_sensitive_content:
      "excluded; no matched content or secret values are stored",
  });

  const sensitiveEntries = manifest.excluded.filter((entry) =>
    ["protected-name", "sensitive-content"].includes(entry.reason),
  );
  assert.ok(sensitiveEntries.length > 0, "the manifest must record sensitivity exclusions");

  for (const entry of sensitiveEntries) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["path", "provenance", "reason", "size", "type"],
      `${entry.path} must expose metadata only`,
    );
  }
});

test("summary and eligibility aggregates are derived from emitted entries", () => {
  const candidates = [...manifest.included, ...manifest.excluded];
  assert.deepEqual(manifest.summary.candidates, metrics(candidates));
  assert.deepEqual(manifest.summary.included, metrics(manifest.included));
  assert.deepEqual(manifest.summary.excluded, metrics(manifest.excluded));
  assert.deepEqual(
    manifest.summary.included_by_provenance,
    groupedMetrics(manifest.included, "provenance"),
  );
  assert.deepEqual(manifest.summary.included_by_type, groupedMetrics(manifest.included, "type"));
  assert.deepEqual(manifest.summary.excluded_by_reason, groupedCounts(manifest.excluded, "reason"));
  assert.deepEqual(
    manifest.summary.excluded_by_provenance,
    groupedMetrics(manifest.excluded, "provenance"),
  );

  assert.deepEqual(manifest.summary.candidates, expectedTotals.candidates);
  assert.deepEqual(manifest.summary.included, expectedTotals.included);
  assert.deepEqual(manifest.summary.excluded, expectedTotals.excluded);
  assert.deepEqual(manifest.summary.included_by_type.json, expectedTotals.json);

  const documentsExtensions = new Set(manifest.eligibility.documents.extensions);
  const documents = manifest.included.filter(
    (entry) =>
      documentsExtensions.has(extension(entry.path)) &&
      entry.size <= manifest.eligibility.documents.max_bytes,
  );
  assert.deepEqual(manifest.eligibility.documents.count, documents.length);
  assert.deepEqual(manifest.eligibility.documents.bytes, metrics(documents).bytes);
  assert.deepEqual(
    manifest.eligibility.documents.by_provenance,
    groupedMetrics(documents, "provenance"),
  );
  assert.deepEqual(manifest.eligibility.documents.by_type, groupedMetrics(documents, "type"));
  assert.deepEqual(metrics(documents), expectedTotals.documents);

  const ingestionExtensions = new Set(manifest.eligibility.ingestion.extensions);
  const ingestion = manifest.included.filter(
    (entry) =>
      ingestionExtensions.has(extension(entry.path)) &&
      entry.size <= manifest.eligibility.ingestion.max_bytes,
  );
  assert.deepEqual(manifest.eligibility.ingestion.count, ingestion.length);
  assert.deepEqual(manifest.eligibility.ingestion.bytes, metrics(ingestion).bytes);
  assert.deepEqual(
    manifest.eligibility.ingestion.by_provenance,
    groupedMetrics(ingestion, "provenance"),
  );
  assert.deepEqual(manifest.eligibility.ingestion.by_type, groupedMetrics(ingestion, "type"));
  assert.deepEqual(metrics(ingestion), expectedTotals.ingestion);
});
