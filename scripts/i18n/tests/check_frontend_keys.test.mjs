import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkFrontendKeys,
  collectSourceFiles,
  extractTranslationCalls,
  runKeysCli,
  validateExactAllowlist,
} from "../check_frontend_keys.mjs";
import {
  compactIssueIdentities,
  reconcileReviewedDebt,
} from "../check_frontend_locales.mjs";

async function withMutedConsole(callback) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await callback();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("extractTranslationCalls finds literal t and i18n.t keys", () => {
  const result = extractTranslationCalls(
    `const a = t("common.save");\nconst b = i18n.t('common.cancel');`,
    "src/example.tsx",
  );
  assert.deepEqual(
    result.literals.map(({ key }) => key),
    ["common.save", "common.cancel"],
  );
  assert.deepEqual(result.dynamic, []);
});

test("extractTranslationCalls records dynamic keys separately", () => {
  const result = extractTranslationCalls(
    `t(key); i18n.t(\`shortcuts.name.\${name}\`);`,
    "src/dynamic.ts",
  );
  assert.deepEqual(
    result.dynamic.map(({ expression }) => expression),
    ["key", ["`shortcuts.name.", "$", "{name}", "`"].join("")],
  );
});

test("extractTranslationCalls records dynamic Trans i18nKey expressions", () => {
  const result = extractTranslationCalls(
    `const key = getKey();\nconst view = <Trans i18nKey={key} />;`,
    "src/dynamic-trans.tsx",
  );

  assert.deepEqual(
    result.dynamic.map(({ expression }) => expression),
    ["key"],
  );
});

test("extractTranslationCalls resolves identifier-backed English defaultValue", () => {
  const result = extractTranslationCalls(
    `const fallback = "Preview not available";\nt("common.preview", { defaultValue: fallback });`,
    "src/default-value.ts",
  );

  assert.equal(result.literals[0].defaultValue, "Preview not available");
});

test("extractTranslationCalls resolves shorthand English defaultValue", () => {
  const result = extractTranslationCalls(
    `const defaultValue = "Preview not available";\nt("common.preview", { defaultValue });`,
    "src/default-value-shorthand.ts",
  );

  assert.equal(result.literals[0].defaultValue, "Preview not available");
});

test("extractTranslationCalls resolves duplicate binding names in lexical scopes", () => {
  const result = extractTranslationCalls(
    `
      function Preview() {
        const fallback = "Preview not available";
        return t("common.preview", { defaultValue: fallback });
      }
      function Unrelated() {
        const fallback = "Different local binding";
        return fallback;
      }
    `,
    "src/scoped-default-value.ts",
  );

  assert.equal(result.literals[0].defaultValue, "Preview not available");
});

test("checkFrontendKeys reports missing, stale, dynamic, sentence keys, and English defaultValue", () => {
  const issues = checkFrontendKeys({
    catalog: {
      "common.save": "Save",
      "catalog.stale": "Stale",
    },
    files: [
      {
        path: "src/example.tsx",
        source: `
          t("common.save");
          t("common.missing");
          t("This is a sentence");
          t(dynamicKey);
          t("common.preview", { defaultValue: "Preview not available" });
        `,
      },
    ],
  });
  const codes = issues.map((issue) => issue.code);
  assert.ok(codes.includes("missing_catalog_key"));
  assert.ok(codes.includes("stale_catalog_key"));
  assert.ok(codes.includes("unallowlisted_dynamic_key"));
  assert.ok(codes.includes("sentence_as_key"));
  assert.ok(codes.includes("english_default_value"));
});

test("exact allowlists require path, value or expression, and a reason", () => {
  assert.throws(() =>
    validateExactAllowlist([{ path: "src/a.ts", expression: "key" }]),
  );
  assert.throws(() =>
    validateExactAllowlist([
      {
        path: "src/**",
        expression: "key",
        reason: "A broad exemption must never be accepted.",
      },
    ]),
  );
  assert.doesNotThrow(() =>
    validateExactAllowlist([
      {
        path: "src/a.ts",
        expression: "key",
        reason: "Known bounded key family.",
      },
    ]),
  );
});

test("exact dynamic/defaultValue allowlists suppress only their reviewed match", () => {
  const issues = checkFrontendKeys({
    catalog: { "common.preview": "Preview" },
    files: [
      {
        path: "src/a.ts",
        source: `t(dynamicKey); t("common.preview", { defaultValue: "Preview" });`,
      },
      { path: "src/b.ts", source: `t(dynamicKey);` },
    ],
    dynamicAllowlist: [
      {
        path: "src/a.ts",
        expression: "dynamicKey",
        reason: "Known bounded key family.",
      },
    ],
    defaultValueAllowlist: [
      { path: "src/a.ts", value: "Preview", reason: "Compatibility fallback." },
    ],
    reportStale: false,
  });
  assert.deepEqual(
    issues.map((issue) => [issue.code, issue.path]),
    [["unallowlisted_dynamic_key", "src/b.ts"]],
  );
});

test("key debt baseline uses exact identities and multiset counts", () => {
  const current = [
    {
      code: "english_default_value",
      path: "src/a.ts",
      key: "common.preview",
      value: "Preview",
    },
    {
      code: "english_default_value",
      path: "src/a.ts",
      key: "common.preview",
      value: "Preview",
    },
  ];
  const entries = compactIssueIdentities("keys", current);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].count, 2);
  assert.equal(
    reconcileReviewedDebt("keys", current, entries).reviewedIssues.length,
    2,
  );
  const partiallyResolved = reconcileReviewedDebt(
    "keys",
    current.slice(0, 1),
    entries,
  );
  assert.equal(partiallyResolved.newIssues.length, 0);
  assert.equal(partiallyResolved.staleEntries.length, 1);
});

test("keys CLI blocks new, stale, and malformed baseline debt", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "ketos-key-contract-"),
  );
  const sourceRoot = path.join(directory, "src");
  const sourcePath = path.join(sourceRoot, "example.ts");
  const catalogPath = path.join(directory, "en.json");
  const baselinePath = path.join(directory, "baseline.json");
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(sourceRoot));
    await writeFile(sourcePath, 't("missing");');
    await writeFile(catalogPath, '{"a":"A"}');
    const files = await collectSourceFiles(sourceRoot);
    const issues = checkFrontendKeys({ catalog: { a: "A" }, files });
    const baseline = {
      schema_version: 1,
      baseline_commit: "def832f409c01f0acd3937b9317dde03d0273552",
      reason: "Reviewed test debt.",
      owner: "frontend-localization",
      review_date: "2026-07-11",
      issues: {
        locales: [],
        keys: compactIssueIdentities("keys", issues),
      },
    };
    await writeFile(baselinePath, JSON.stringify(baseline));
    const args = [
      "--source-root",
      sourceRoot,
      "--catalog",
      catalogPath,
      "--baseline",
      baselinePath,
      "--json",
    ];
    assert.equal(await withMutedConsole(() => runKeysCli(args)), 0);

    await writeFile(sourcePath, 't("a");');
    assert.equal(await withMutedConsole(() => runKeysCli(args)), 1);

    await writeFile(sourcePath, 't("missing"); t("new");');
    assert.equal(await withMutedConsole(() => runKeysCli(args)), 1);

    await writeFile(baselinePath, JSON.stringify({ ...baseline, owner: "" }));
    assert.equal(await withMutedConsole(() => runKeysCli(args)), 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
