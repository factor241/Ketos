import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CatalogContractError,
  checkLocaleCatalog,
  compactIssueIdentities,
  extractInterpolationTokens,
  extractNumericTransTags,
  getPluralCategories,
  parseFlatCatalog,
  reconcileReviewedDebt,
  runLocaleCli,
  validateContractBaseline,
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

function baselineFixture(issues = { locales: [], keys: [] }) {
  return {
    schema_version: 1,
    baseline_commit: "def832f409c01f0acd3937b9317dde03d0273552",
    reason: "Reviewed test debt.",
    owner: "frontend-localization",
    review_date: "2026-07-11",
    issues,
  };
}

test("parseFlatCatalog accepts a flat string catalog", () => {
  assert.deepEqual(
    parseFlatCatalog(
      '{"common.save":"Save","common.cancel":"Cancel"}',
      "en.json",
    ),
    { "common.save": "Save", "common.cancel": "Cancel" },
  );
});

test("parseFlatCatalog rejects invalid JSON, nested values, arrays, and empty keys", () => {
  for (const source of [
    "{",
    '{"common":{"save":"Save"}}',
    '{"common.save":["Save"]}',
    '{"":"Save"}',
  ]) {
    assert.throws(
      () => parseFlatCatalog(source, "bad.json"),
      CatalogContractError,
    );
  }
});

test("token extractors preserve interpolation multiplicity and numeric Trans tags", () => {
  assert.deepEqual(
    extractInterpolationTokens("Hi {{name}} {{ name }} {{count}} {{name}}"),
    ["count", "name", "name", "name"],
  );
  assert.deepEqual(
    extractNumericTransTags("Open <1>{{name}}</1> or <3>docs</3>"),
    ["1", "3"],
  );
});

test("locale comparison reports missing, extra, empty, and token/tag parity errors", () => {
  const issues = checkLocaleCatalog({
    source: {
      "a.title": "Hello {{name}}",
      "a.help": "Read <1>the docs</1>",
      "a.keep": "Keep",
    },
    target: {
      "a.title": "Привет",
      "a.help": "Читайте <2>документацию</2>",
      "a.extra": "Лишнее",
      "a.keep": "   ",
    },
    locale: "ru",
  });
  const codes = issues.map((issue) => issue.code);
  assert.ok(codes.includes("missing_interpolation_token"));
  assert.ok(codes.includes("numeric_tag_mismatch"));
  assert.ok(codes.includes("extra_key"));
  assert.ok(codes.includes("empty_value"));
});

test("plural groups use the selected locale categories and source other as fallback", () => {
  assert.deepEqual(getPluralCategories("ru"), ["one", "few", "many", "other"]);
  const incomplete = checkLocaleCatalog({
    source: { item_one: "{{count}} item", item_other: "{{count}} items" },
    target: {
      item_one: "{{count}} элемент",
      item_other: "{{count}} элементов",
    },
    locale: "ru",
  });
  assert.deepEqual(
    incomplete
      .filter((issue) => issue.code === "missing_plural_category")
      .map((issue) => issue.category),
    ["few", "many"],
  );

  const complete = checkLocaleCatalog({
    source: { item_one: "{{count}} item", item_other: "{{count}} items" },
    target: {
      item_one: "{{count}} элемент",
      item_few: "{{count}} элемента",
      item_many: "{{count}} элементов",
      item_other: "{{count}} элемента",
    },
    locale: "ru",
  });
  assert.deepEqual(complete, []);
});

test("an exact reviewed locale baseline passes while new, changed, and resolved debt blocks", () => {
  const current = [
    {
      code: "missing_plural_category",
      locale: "ru",
      key: "items",
      category: "few",
    },
  ];
  const entries = compactIssueIdentities("locales", current);
  assert.deepEqual(reconcileReviewedDebt("locales", current, entries), {
    reviewedIssues: current,
    newIssues: [],
    staleEntries: [],
  });

  const changed = [{ ...current[0], category: "many" }];
  const changedResult = reconcileReviewedDebt("locales", changed, entries);
  assert.equal(changedResult.newIssues.length, 1);
  assert.equal(changedResult.staleEntries.length, 1);

  const resolvedResult = reconcileReviewedDebt("locales", [], entries);
  assert.equal(resolvedResult.newIssues.length, 0);
  assert.equal(resolvedResult.staleEntries.length, 1);
});

test("baseline metadata and exact identities reject malformed or broad entries", () => {
  const valid = baselineFixture();
  assert.doesNotThrow(() => validateContractBaseline(valid));
  assert.throws(() => validateContractBaseline({ ...valid, reason: "" }));
  assert.throws(() =>
    validateContractBaseline({
      ...valid,
      issues: {
        locales: [],
        keys: [
          {
            code: "unallowlisted_dynamic_key",
            path: "src/**",
            expression: "key",
            count: 1,
          },
        ],
      },
    }),
  );
});

test("locale CLI rejects an empty English source value", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "ketos-empty-source-contract-"),
  );
  try {
    await writeFile(path.join(directory, "en.json"), '{"a":"   "}');
    await writeFile(path.join(directory, "ru.json"), '{"a":"Перевод"}');

    const exitCode = await withMutedConsole(() =>
      runLocaleCli([
        "--locales-dir",
        directory,
        "--locale",
        "ru",
        "--strict",
        "--json",
      ]),
    );

    assert.equal(exitCode, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("locale CLI blocks new, stale, and malformed baseline debt", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "ketos-locale-contract-"),
  );
  const baselinePath = path.join(directory, "baseline.json");
  try {
    await writeFile(path.join(directory, "en.json"), '{"a":"A"}');
    await writeFile(path.join(directory, "ru.json"), "{}");
    const missing = [{ code: "missing_key", locale: "ru", key: "a" }];
    const baseline = baselineFixture({
      locales: compactIssueIdentities("locales", missing),
      keys: [],
    });
    await writeFile(baselinePath, JSON.stringify(baseline));
    const args = [
      "--locales-dir",
      directory,
      "--locale",
      "ru",
      "--baseline",
      baselinePath,
      "--json",
    ];
    assert.equal(await withMutedConsole(() => runLocaleCli(args)), 0);

    await writeFile(path.join(directory, "ru.json"), '{"a":"А"}');
    assert.equal(await withMutedConsole(() => runLocaleCli(args)), 1);

    await writeFile(path.join(directory, "en.json"), '{"a":"A","b":"B"}');
    await writeFile(path.join(directory, "ru.json"), "{}");
    assert.equal(await withMutedConsole(() => runLocaleCli(args)), 1);

    await writeFile(baselinePath, JSON.stringify({ ...baseline, reason: "" }));
    assert.equal(await withMutedConsole(() => runLocaleCli(args)), 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
