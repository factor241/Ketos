import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const checkerUrl = new URL("../check_frontend_hardcoded.mjs", import.meta.url)
  .href;

async function loadChecker() {
  return import(checkerUrl);
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createFixture({
  baselineSource = "export {};\n",
  staticHtml = "<!doctype html><html><head><title>Лангфлоу</title></head><body><noscript lang=\"ru\">Включите скрипты.</noscript></body></html>\n",
  candidateInventory = [],
  entries = [],
  migrationDebt = [],
  activeWave = "R1",
} = {}) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "langflow-hardcoded-"));
  const sourceDir = path.join(repoRoot, "src/frontend/src");
  const frontendDir = path.join(repoRoot, "src/frontend");
  const allowlistDir = path.join(repoRoot, "scripts/i18n/allowlists");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(allowlistDir, { recursive: true });
  writeFileSync(path.join(sourceDir, "Baseline.tsx"), baselineSource);
  writeFileSync(path.join(frontendDir, "index.html"), staticHtml);

  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "i18n-test@example.com");
  git(repoRoot, "config", "user.name", "i18n test");
  git(repoRoot, "add", "src/frontend/src/Baseline.tsx", "src/frontend/index.html");
  git(repoRoot, "commit", "-qm", "baseline");
  const commit = git(repoRoot, "rev-parse", "HEAD");

  const triageCounts = candidateInventory.reduce((counts, candidate) => {
    counts[candidate.disposition] = (counts[candidate.disposition] ?? 0) + 1;
    return counts;
  }, {});
  const ledger = {
    schema_version: 1,
    baseline: {
      commit,
      raw_candidate_count: candidateInventory.length,
      reproduced_raw_candidate_count: candidateInventory.length,
      reproduced_candidate_file_count: new Set(
        candidateInventory.map(({ path: value }) => value),
      ).size,
      triage_counts: triageCounts,
    },
    entries,
    debt_ownership: [],
    candidate_inventory: candidateInventory,
    static_html_inventory: [],
  };
  writeFileSync(
    path.join(allowlistDir, "frontend-hardcoded.json"),
    `${JSON.stringify(ledger, null, 2)}\n`,
  );
  writeFileSync(
    path.join(allowlistDir, "frontend-hardcoded-debt.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        active_wave: activeWave,
        entries: migrationDebt,
        static_html_baseline_inventory: [],
      },
      null,
      2,
    )}\n`,
  );
  return { repoRoot, sourceDir, frontendDir, ledger };
}

function debtEntry(overrides = {}) {
  return {
    candidate_id: "active-debt-1",
    wave: "R1",
    path: "src/frontend/src/Baseline.tsx",
    line: 1,
    column: 32,
    kind: "jsx_text",
    value: "Reviewed active debt",
    source_excerpt:
      "export const Demo = () => <div>Reviewed active debt</div>;",
    owner: "frontend-localization",
    review_date: "2026-07-12",
    reason: "System-owned text scheduled for migration in the active wave.",
    ...overrides,
  };
}

test("AST scan finds JSX text, visible attributes, object/default values, returned strings, and defaultValue", async () => {
  const { scanSourceText } = await loadChecker();
  const sourceText = `
    const metadata = { label: "Provider", defaultValue: "Fallback sentence" };
    export function Demo({ placeholder = "Choose model" }) {
      function status() { return \`Ready now\`; }
      return <button title="Open panel">Create flow</button>;
    }
  `;

  const candidates = scanSourceText(sourceText, {
    relativePath: "src/frontend/src/Demo.tsx",
  });
  const observed = candidates.map(({ kind, value }) => `${kind}:${value}`);

  assert.ok(observed.includes("jsx_text:Create flow"));
  assert.ok(observed.includes("visible_jsx_attribute:Open panel"));
  assert.ok(observed.includes("visible_object_property:Provider"));
  assert.ok(observed.includes("visible_default:Choose model"));
  assert.ok(observed.includes("returned_display_string:Ready now"));
  assert.ok(observed.includes("default_value:Fallback sentence"));
});

test("AST scan finds English string literals inside JSX expressions", async () => {
  const { scanSourceText } = await loadChecker();
  const candidates = scanSourceText(
    `export const Demo = () => <div>{"New English text"}</div>;`,
    { relativePath: "src/frontend/src/Demo.tsx" },
  );

  assert.ok(
    candidates.some(
      ({ kind, value }) => kind === "jsx_text" && value === "New English text",
    ),
  );
});

test("AST scan finds every English literal returned by a conditional", async () => {
  const { scanSourceText } = await loadChecker();
  const candidates = scanSourceText(
    `function status(ready) { return ready ? "Ready now" : "Still waiting"; }`,
    { relativePath: "src/frontend/src/status.ts" },
  );

  assert.deepEqual(
    candidates
      .filter(({ kind }) => kind === "returned_display_string")
      .map(({ value }) => value),
    ["Ready now", "Still waiting"],
  );
});

test("AST scan finds conditional literals in visible JSX attributes", async () => {
  const { scanSourceText } = await loadChecker();
  const candidates = scanSourceText(
    `export const Demo = ({ ready }) => <button title={ready ? "Ready now" : "Still waiting"} />;`,
    { relativePath: "src/frontend/src/Demo.tsx" },
  );

  assert.deepEqual(
    candidates
      .filter(({ kind }) => kind === "visible_jsx_attribute")
      .map(({ value }) => value),
    ["Ready now", "Still waiting"],
  );
});

test("AST scan ignores machine sentinels used only by returned comparisons", async () => {
  const { scanSourceText } = await loadChecker();
  const candidates = scanSourceText(
    `function isTest(env) { return env.MODE === "test" && env.FLAG === "true"; }`,
    { relativePath: "src/frontend/src/runtime.ts" },
  );

  assert.deepEqual(candidates, []);
});

test("allowlist entries require exact path, value, reason, owner, and review_date", async () => {
  const { validateLedger } = await loadChecker();
  const { ledger } = createFixture({
    entries: [
      {
        path: "src/frontend/src/Approved.tsx",
        value: "Approved Brand",
        owner: "localization-governance",
        review_date: "2026-07-11",
      },
    ],
  });

  assert.throws(() => validateLedger(ledger), /allowlist entry 0.*reason/i);
});

test("baseline debt ledger rejects inconsistent triage counts", async () => {
  const { validateLedger } = await loadChecker();
  const candidate = {
    candidate_id: "debt-1",
    path: "src/frontend/src/Baseline.tsx",
    line: 1,
    source_excerpt: "<div>Existing debt</div>",
    disposition: "semantic_key_required",
    owner: "frontend-localization",
    reason: "Reviewed baseline debt.",
    target_task: 9,
    ast_evidence: [{ kind: "jsx_text", value: "Existing debt" }],
  };
  const { ledger } = createFixture({ candidateInventory: [candidate] });
  ledger.baseline.triage_counts.semantic_key_required = 2;

  assert.throws(
    () => validateLedger(ledger),
    /triage_counts.*semantic_key_required/i,
  );
});

test("active-wave reviewed system-owned debt fails the gate", async () => {
  const { runCheck } = await loadChecker();
  const candidate = debtEntry();
  const { repoRoot } = createFixture({
    baselineSource: `${candidate.source_excerpt}\n`,
    migrationDebt: [candidate],
  });

  const result = await runCheck({ repoRoot, writeOutput: false });

  assert.equal(result.ok, false);
  assert.equal(result.blockingDebt.length, 1);
  assert.equal(result.newCandidates.length, 0);
});

test("permanent allowlist cannot also classify the same text as migration debt", async () => {
  const { runCheck } = await loadChecker();
  const entry = {
    path: "src/frontend/src/Baseline.tsx",
    value: "Reviewed active debt",
    reason: "Exact reviewed product name.",
    owner: "localization-governance",
    review_date: "2026-07-12",
  };
  const debt = debtEntry();
  const { repoRoot } = createFixture({
    baselineSource: `${debt.source_excerpt}\n`,
    entries: [entry],
    migrationDebt: [debt],
  });

  await assert.rejects(
    runCheck({ repoRoot, writeOutput: false }),
    /migration debt.*permanent allowlist/i,
  );
});

test("removing reviewed baseline debt makes the ledger stale and fails", async () => {
  const { runCheck } = await loadChecker();
  const candidate = {
    candidate_id: "debt-stale",
    path: "src/frontend/src/Baseline.tsx",
    line: 1,
    source_excerpt:
      "export const Demo = () => <div>Existing English debt</div>;",
    disposition: "semantic_key_required",
    owner: "frontend-localization",
    reason: "Reviewed baseline debt assigned to the frontend wave.",
    target_task: 9,
    ast_evidence: [{ kind: "jsx_text", value: "Existing English debt" }],
  };
  const { repoRoot, sourceDir } = createFixture({
    baselineSource: `${candidate.source_excerpt}\n`,
    candidateInventory: [candidate],
  });
  writeFileSync(path.join(sourceDir, "Baseline.tsx"), "export {};\n");

  const result = await runCheck({ repoRoot, writeOutput: false });

  assert.equal(
    result.ok,
    false,
    "resolved debt must invalidate its ledger row",
  );
});

test("moving reviewed debt cannot inherit the old candidate identity", async () => {
  const { runCheck } = await loadChecker();
  const candidate = {
    candidate_id: "debt-moved",
    path: "src/frontend/src/Baseline.tsx",
    line: 1,
    source_excerpt:
      "export const Demo = () => <div>Existing English debt</div>;",
    disposition: "semantic_key_required",
    owner: "frontend-localization",
    reason: "Reviewed baseline debt assigned to the frontend wave.",
    target_task: 9,
    ast_evidence: [{ kind: "jsx_text", value: "Existing English debt" }],
  };
  const { repoRoot, sourceDir } = createFixture({
    baselineSource: `${candidate.source_excerpt}\n`,
    candidateInventory: [candidate],
  });
  writeFileSync(
    path.join(sourceDir, "Baseline.tsx"),
    `const moved = true;\n${candidate.source_excerpt}\n`,
  );

  const result = await runCheck({ repoRoot, writeOutput: false });

  assert.equal(result.ok, false, "moved debt must require a new exact review");
});

test("moving uninventoried baseline English cannot inherit a coarse fingerprint", async () => {
  const { runCheck } = await loadChecker();
  const baselineSource =
    "export const Demo = () => <div>Uninventoried English debt</div>;";
  const { repoRoot, sourceDir } = createFixture({
    baselineSource: `${baselineSource}\n`,
  });
  writeFileSync(
    path.join(sourceDir, "Baseline.tsx"),
    `const moved = true;\n${baselineSource}\n`,
  );

  const result = await runCheck({ repoRoot, writeOutput: false });

  assert.equal(
    result.ok,
    false,
    "every baseline candidate must have an exact reviewed identity",
  );
});

test("unchanged uninventoried baseline English is blocking current debt", async () => {
  const { runCheck } = await loadChecker();
  const baselineSource =
    "export const Demo = () => <div>Uninventoried English debt</div>;";
  const { repoRoot } = createFixture({
    baselineSource: `${baselineSource}\n`,
  });

  const result = await runCheck({ repoRoot, writeOutput: false });

  assert.equal(result.ok, false);
  assert.ok(
    result.newCandidates.some(
      ({ value }) => value === "Uninventoried English debt",
    ),
    "a committed AST baseline is evidence, not an implicit allowlist",
  );
});

test("changing an inventoried source excerpt or column invalidates its identity", async () => {
  const { runCheck } = await loadChecker();
  const candidate = {
    candidate_id: "debt-context-changed",
    path: "src/frontend/src/Baseline.tsx",
    line: 1,
    source_excerpt:
      "export const Demo = () => <div>Existing English debt</div>;",
    disposition: "semantic_key_required",
    owner: "frontend-localization",
    reason: "Reviewed baseline debt assigned to the frontend wave.",
    target_task: 9,
    ast_evidence: [{ kind: "jsx_text", value: "Existing English debt" }],
  };
  const { repoRoot, sourceDir } = createFixture({
    baselineSource: `${candidate.source_excerpt}\n`,
    candidateInventory: [candidate],
  });
  writeFileSync(
    path.join(sourceDir, "Baseline.tsx"),
    "export const Demo = () => <section><div>Existing English debt</div></section>;\n",
  );

  const result = await runCheck({ repoRoot, writeOutput: false });

  assert.equal(
    result.ok,
    false,
    "same-line text in a new AST context must require a new exact review",
  );
});

test("allowlisting is exact by path and value", async () => {
  const { runCheck } = await loadChecker();
  const entry = {
    path: "src/frontend/src/Approved.tsx",
    value: "Approved Brand",
    reason: "Exact reviewed product name.",
    owner: "localization-governance",
    review_date: "2026-07-11",
  };
  const { repoRoot, sourceDir } = createFixture({ entries: [entry] });
  writeFileSync(
    path.join(sourceDir, "Approved.tsx"),
    "export const Approved = () => <span>Approved Brand</span>;\n",
  );
  writeFileSync(
    path.join(sourceDir, "WrongPath.tsx"),
    "export const Wrong = () => <span>Approved Brand</span>;\n",
  );

  const result = await runCheck({ repoRoot, writeOutput: false });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.newCandidates.map(({ relativePath, value }) => [
      relativePath,
      value,
    ]),
    [["src/frontend/src/WrongPath.tsx", "Approved Brand"]],
  );
});

test("new untracked system English and defaultValue fail the gate", async () => {
  const { runCheck } = await loadChecker();
  const { repoRoot, sourceDir } = createFixture();
  writeFileSync(
    path.join(sourceDir, "NewSurface.tsx"),
    `
      const options = { defaultValue: "New fallback sentence" };
      export const NewSurface = () => <div>New untracked English</div>;
    `,
  );

  const result = await runCheck({ repoRoot, writeOutput: false });

  assert.equal(result.ok, false);
  assert.ok(
    result.newCandidates.some(
      ({ kind, value }) =>
        kind === "default_value" && value === "New fallback sentence",
    ),
  );
  assert.ok(
    result.newCandidates.some(
      ({ kind, value }) =>
        kind === "jsx_text" && value === "New untracked English",
    ),
  );
});

for (const mutation of [
  {
    name: "JSX text",
    source: `export const Demo = () => <div>New English surface</div>;`,
    expectedKind: "jsx_text",
  },
  {
    name: "formatted JSX",
    source: `export const Demo = ({ count }) => <div>{"Found " + count + " files"}</div>;`,
    expectedKind: "jsx_text",
  },
  {
    name: "aria-label",
    source: `export const Demo = () => <button aria-label="Open settings" />;`,
    expectedKind: "visible_jsx_attribute",
  },
  {
    name: "tooltip",
    source: `export const Demo = () => <Icon tooltip="Delete flow" />;`,
    expectedKind: "visible_jsx_attribute",
  },
  {
    name: "toast",
    source: `export function save() { toast.success("Flow saved successfully"); }`,
    expectedKind: "toast_message",
  },
]) {
  test(`${mutation.name} English mutation fails the real gate`, async () => {
    const { runCheck } = await loadChecker();
    const { repoRoot, sourceDir } = createFixture();
    writeFileSync(path.join(sourceDir, "Mutation.tsx"), `${mutation.source}\n`);

    const result = await runCheck({ repoRoot, writeOutput: false });

    assert.equal(result.ok, false);
    assert.ok(
      result.newCandidates.some(
        ({ kind, relativePath }) =>
          kind === mutation.expectedKind &&
          relativePath === "src/frontend/src/Mutation.tsx",
      ),
    );
  });
}

test("current static HTML English mutation is rescanned and fails the gate", async () => {
  const { runCheck } = await loadChecker();
  const { repoRoot, frontendDir } = createFixture({
    staticHtml:
      '<!doctype html><html><head><title>Langflow</title></head><body><noscript lang="ru">Включите скрипты.</noscript></body></html>\n',
    entries: [
      {
        path: "src/frontend/index.html",
        value: "Langflow",
        reason: "Exact product brand in the static title.",
        owner: "localization-governance",
        review_date: "2026-07-12",
      },
    ],
  });
  writeFileSync(
    path.join(frontendDir, "index.html"),
    "<!doctype html><html><head><title>Langflow</title></head><body><noscript>Enable JavaScript now</noscript></body></html>\n",
  );

  const result = await runCheck({ repoRoot, writeOutput: false });

  assert.equal(result.ok, false);
  assert.ok(
    result.newCandidates.some(
      ({ kind, relativePath, value }) =>
        kind === "static_html_text" &&
        relativePath === "src/frontend/index.html" &&
        value === "Enable JavaScript now",
    ),
  );
});

test("production AST scope scans JS and JSX files", async () => {
  const { runCheck } = await loadChecker();
  const { repoRoot, sourceDir } = createFixture();
  writeFileSync(
    path.join(sourceDir, "NewSurface.jsx"),
    "export const NewSurface = () => <div>New JSX English</div>;\n",
  );
  writeFileSync(
    path.join(sourceDir, "NewConfig.js"),
    'export const metadata = { label: "New JS label", defaultValue: "New JS fallback" };\n',
  );

  const result = await runCheck({ repoRoot, writeOutput: false });

  assert.equal(result.ok, false);
  assert.ok(
    result.newCandidates.some(
      ({ kind, value }) => kind === "jsx_text" && value === "New JSX English",
    ),
  );
  assert.ok(
    result.newCandidates.some(
      ({ kind, value }) =>
        kind === "visible_object_property" && value === "New JS label",
    ),
  );
  assert.ok(
    result.newCandidates.some(
      ({ kind, value }) =>
        kind === "default_value" && value === "New JS fallback",
    ),
  );
});

test("production AST scope scans TSX icon sources but excludes test files", async () => {
  const { runCheck } = await loadChecker();
  const { repoRoot, sourceDir } = createFixture();
  const iconDir = path.join(sourceDir, "icons");
  const testDir = path.join(sourceDir, "__tests__");
  mkdirSync(iconDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });
  writeFileSync(
    path.join(iconDir, "VisibleIcon.tsx"),
    "export const VisibleIcon = () => <text>Visible icon label</text>;\n",
  );
  writeFileSync(
    path.join(testDir, "Ignored.test.tsx"),
    "export const Ignored = () => <div>Test-only English</div>;\n",
  );

  const result = await runCheck({ repoRoot, writeOutput: false });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.newCandidates.map(({ value }) => value),
    ["Visible icon label"],
  );
});
