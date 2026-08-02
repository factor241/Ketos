#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];
const PLURAL_KEY_RE = /^(.*)_(zero|one|two|few|many|other)$/;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const DEFAULT_LOCALES_DIR = path.join(REPO_ROOT, "src/frontend/src/locales");
export const DEFAULT_CONTRACT_BASELINE = path.join(
  SCRIPT_DIR,
  "allowlists/frontend-contract-baseline.json",
);

const BASELINE_FIELDS = {
  locales: [
    "code",
    "locale",
    "key",
    "category",
    "token",
    "sourceTags",
    "targetTags",
  ],
  keys: ["code", "path", "key", "expression", "value"],
};
const BASELINE_TOP_LEVEL_FIELDS = [
  "schema_version",
  "baseline_commit",
  "reason",
  "owner",
  "review_date",
  "issues",
];

export class CatalogContractError extends Error {
  constructor(
    message,
    { code = "invalid_catalog", sourceName = "catalog" } = {},
  ) {
    super(`${sourceName}: ${message}`);
    this.name = "CatalogContractError";
    this.code = code;
    this.sourceName = sourceName;
  }
}

function assertExactObjectFields(value, allowedFields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const unknown = Object.keys(value).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unknown.length)
    throw new Error(
      `${label} contains unknown field(s): ${unknown.join(", ")}`,
    );
}

function containsPathGlob(value) {
  return ["*", "?", "[", "]"].some((character) => value.includes(character));
}

export function issueIdentity(scope, issue) {
  const fields = BASELINE_FIELDS[scope];
  if (!fields) throw new Error(`Unknown baseline scope: ${scope}`);
  if (
    !issue ||
    typeof issue !== "object" ||
    typeof issue.code !== "string" ||
    !issue.code
  ) {
    throw new Error(`${scope} issue requires a non-empty code`);
  }
  const identity = {};
  for (const field of fields) {
    if (issue[field] !== undefined) {
      identity[field] = Array.isArray(issue[field])
        ? [...issue[field]]
        : issue[field];
    }
  }
  return identity;
}

function identityKey(scope, issue) {
  return JSON.stringify(issueIdentity(scope, issue));
}

export function compactIssueIdentities(scope, issues) {
  const compacted = new Map();
  for (const issue of issues) {
    const identity = issueIdentity(scope, issue);
    const key = JSON.stringify(identity);
    const existing = compacted.get(key);
    if (existing) existing.count += 1;
    else compacted.set(key, { ...identity, count: 1 });
  }
  return [...compacted.values()].sort((a, b) =>
    identityKey(scope, a).localeCompare(identityKey(scope, b)),
  );
}

function validateBaselineEntry(scope, entry, index) {
  const label = `baseline.issues.${scope}[${index}]`;
  assertExactObjectFields(entry, [...BASELINE_FIELDS[scope], "count"], label);
  if (typeof entry.code !== "string" || !entry.code.trim()) {
    throw new Error(`${label} requires a non-empty code`);
  }
  if (!Number.isInteger(entry.count) || entry.count < 1) {
    throw new Error(`${label}.count must be a positive integer`);
  }
  if (
    scope === "locales" &&
    (typeof entry.locale !== "string" || !entry.locale)
  ) {
    throw new Error(`${label} requires an exact locale`);
  }
  if (scope === "keys") {
    if (entry.code === "stale_catalog_key") {
      if (typeof entry.key !== "string" || !entry.key) {
        throw new Error(`${label} requires an exact key`);
      }
    } else if (typeof entry.path !== "string" || !entry.path) {
      throw new Error(`${label} requires an exact path`);
    }
  }
  if (entry.path && containsPathGlob(entry.path)) {
    throw new Error(`${label}.path must be exact; glob patterns are forbidden`);
  }
  if (entry.key?.includes("*")) {
    throw new Error(
      `${label}.key must be exact; wildcard values are forbidden`,
    );
  }
  for (const field of BASELINE_FIELDS[scope]) {
    if (entry[field] === undefined) continue;
    if (field === "sourceTags" || field === "targetTags") {
      if (
        !Array.isArray(entry[field]) ||
        entry[field].some((value) => typeof value !== "string")
      ) {
        throw new Error(`${label}.${field} must be an array of strings`);
      }
    } else if (typeof entry[field] !== "string") {
      throw new Error(`${label}.${field} must be a string`);
    }
  }
  return entry;
}

export function validateContractBaseline(baseline) {
  assertExactObjectFields(baseline, BASELINE_TOP_LEVEL_FIELDS, "baseline");
  if (baseline.schema_version !== 1)
    throw new Error("baseline.schema_version must equal 1");
  if (!/^[0-9a-f]{40}$/.test(baseline.baseline_commit ?? "")) {
    throw new Error(
      "baseline.baseline_commit must be a 40-character lowercase Git SHA",
    );
  }
  for (const field of ["reason", "owner"]) {
    if (typeof baseline[field] !== "string" || !baseline[field].trim()) {
      throw new Error(`baseline.${field} must be a non-empty string`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseline.review_date ?? "")) {
    throw new Error("baseline.review_date must use YYYY-MM-DD");
  }
  assertExactObjectFields(
    baseline.issues,
    ["locales", "keys"],
    "baseline.issues",
  );
  for (const scope of ["locales", "keys"]) {
    if (!Array.isArray(baseline.issues[scope])) {
      throw new Error(`baseline.issues.${scope} must be an array`);
    }
    const identities = new Set();
    for (const [index, entry] of baseline.issues[scope].entries()) {
      validateBaselineEntry(scope, entry, index);
      const key = identityKey(scope, entry);
      if (identities.has(key)) {
        throw new Error(
          `baseline.issues.${scope}[${index}] duplicates an earlier identity`,
        );
      }
      identities.add(key);
    }
  }
  return baseline;
}

export async function loadContractBaseline(
  filePath = DEFAULT_CONTRACT_BASELINE,
) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath}: unable to read baseline (${error.message})`);
  }
  return validateContractBaseline(parsed);
}

export function reconcileReviewedDebt(scope, issues, baselineEntries) {
  if (!Array.isArray(issues) || !Array.isArray(baselineEntries)) {
    throw new Error("issues and baseline entries must be arrays");
  }
  const remaining = new Map();
  const entryByIdentity = new Map();
  for (const entry of baselineEntries) {
    validateBaselineEntry(scope, entry, entryByIdentity.size);
    const key = identityKey(scope, entry);
    if (entryByIdentity.has(key))
      throw new Error(`duplicate ${scope} baseline identity`);
    entryByIdentity.set(key, entry);
    remaining.set(key, entry.count);
  }

  const reviewedIssues = [];
  const newIssues = [];
  for (const issue of issues) {
    const key = identityKey(scope, issue);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      reviewedIssues.push(issue);
      remaining.set(key, count - 1);
    } else newIssues.push(issue);
  }

  const staleEntries = [];
  for (const [key, count] of remaining) {
    if (count > 0) staleEntries.push({ ...entryByIdentity.get(key), count });
  }
  return { reviewedIssues, newIssues, staleEntries };
}

export function applyContractBaseline(scope, issues, baseline) {
  validateContractBaseline(baseline);
  return reconcileReviewedDebt(scope, issues, baseline.issues[scope]);
}

export function parseFlatCatalog(text, sourceName = "catalog") {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CatalogContractError(`invalid JSON (${error.message})`, {
      code: "invalid_json",
      sourceName,
    });
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new CatalogContractError("top-level value must be an object", {
      sourceName,
    });
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (!key.trim()) {
      throw new CatalogContractError("keys must be non-empty strings", {
        sourceName,
      });
    }
    if (typeof value !== "string") {
      throw new CatalogContractError(
        `key ${JSON.stringify(key)} must contain a string (nested objects and arrays are forbidden)`,
        { sourceName },
      );
    }
  }

  return parsed;
}

export function extractInterpolationTokens(value) {
  const tokens = [];
  const regex = /{{\s*([^{}]+?)\s*}}/g;
  for (const match of value.matchAll(regex)) tokens.push(match[1].trim());
  return tokens.sort();
}

export function extractNumericTransTags(value) {
  const tags = new Set();
  const regex = /<\/?(\d+)(?:\s[^>]*)?\/?>/g;
  for (const match of value.matchAll(regex)) tags.add(match[1]);
  return [...tags].sort((a, b) => Number(a) - Number(b));
}

function numericTagSignature(value) {
  const signature = [];
  const regex = /<(\/)?(\d+)(?:\s[^>]*)?(\/?)>/g;
  for (const match of value.matchAll(regex)) {
    const direction = match[1] ? "close" : match[3] ? "self" : "open";
    signature.push(`${direction}:${match[2]}`);
  }
  return signature.sort();
}

export function getPluralCategories(locale) {
  const supported = new Set(
    new Intl.PluralRules(locale, { type: "cardinal" }).resolvedOptions()
      .pluralCategories,
  );
  return PLURAL_SUFFIXES.filter((category) => supported.has(category));
}

function pluralCandidates(catalog) {
  const candidates = new Map();
  for (const key of Object.keys(catalog)) {
    const match = key.match(PLURAL_KEY_RE);
    if (!match) continue;
    const [, base, category] = match;
    if (!candidates.has(base)) candidates.set(base, new Map());
    candidates.get(base).set(category, key);
  }
  return candidates;
}

function pluralGroups(catalog) {
  const candidates = pluralCandidates(catalog);
  return new Map(
    [...candidates].filter(([, forms]) => forms.has("other") && forms.size > 1),
  );
}

function multisetDifference(left, right) {
  const remaining = new Map();
  for (const value of right)
    remaining.set(value, (remaining.get(value) ?? 0) + 1);
  const difference = [];
  for (const value of left) {
    const count = remaining.get(value) ?? 0;
    if (count > 0) remaining.set(value, count - 1);
    else difference.push(value);
  }
  return difference;
}

function compareValueContracts({
  sourceValue,
  targetValue,
  key,
  locale,
  issues,
}) {
  const sourceTokens = extractInterpolationTokens(sourceValue);
  const targetTokens = extractInterpolationTokens(targetValue);
  for (const token of multisetDifference(sourceTokens, targetTokens)) {
    issues.push({ code: "missing_interpolation_token", locale, key, token });
  }
  for (const token of multisetDifference(targetTokens, sourceTokens)) {
    issues.push({ code: "extra_interpolation_token", locale, key, token });
  }

  const sourceTags = numericTagSignature(sourceValue);
  const targetTags = numericTagSignature(targetValue);
  if (JSON.stringify(sourceTags) !== JSON.stringify(targetTags)) {
    issues.push({
      code: "numeric_tag_mismatch",
      locale,
      key,
      sourceTags: extractNumericTransTags(sourceValue),
      targetTags: extractNumericTransTags(targetValue),
    });
  }
}

function checkValue({ sourceValue, targetValue, key, locale, issues }) {
  if (!targetValue.trim()) {
    issues.push({ code: "empty_value", locale, key });
    return;
  }
  compareValueContracts({ sourceValue, targetValue, key, locale, issues });
}

export function checkLocaleCatalog({
  source,
  target,
  locale,
  sourceLocale = "en",
  sourceName = "en",
  targetName = locale,
}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new CatalogContractError("source catalog must be a flat object", {
      sourceName,
    });
  }
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new CatalogContractError("target catalog must be a flat object", {
      sourceName: targetName,
    });
  }

  const issues = [];
  for (const [key, sourceValue] of Object.entries(source)) {
    if (!sourceValue.trim()) {
      issues.push({ code: "empty_source_value", locale: sourceLocale, key });
    }
  }
  const sourceGroups = pluralGroups(source);
  const targetCandidates = pluralCandidates(target);
  const sourcePluralKeys = new Set(
    [...sourceGroups.values()].flatMap((forms) => [...forms.values()]),
  );
  const targetKeysHandledAsPlural = new Set();

  for (const [base, sourceForms] of sourceGroups) {
    const targetForms = targetCandidates.get(base) ?? new Map();
    const expectedCategories = getPluralCategories(locale);

    for (const category of expectedCategories) {
      const targetKey = targetForms.get(category);
      if (!targetKey) {
        issues.push({
          code: "missing_plural_category",
          locale,
          key: base,
          category,
        });
        continue;
      }
      targetKeysHandledAsPlural.add(targetKey);
      const sourceKey =
        sourceForms.get(category) ??
        sourceForms.get("other") ??
        sourceForms.values().next().value;
      checkValue({
        sourceValue: source[sourceKey],
        targetValue: target[targetKey],
        key: targetKey,
        locale,
        issues,
      });
    }

    for (const [category, targetKey] of targetForms) {
      targetKeysHandledAsPlural.add(targetKey);
      if (!expectedCategories.includes(category)) {
        issues.push({
          code: "extra_plural_category",
          locale,
          key: base,
          category,
        });
      }
    }
  }

  for (const [key, sourceValue] of Object.entries(source)) {
    if (sourcePluralKeys.has(key)) continue;
    if (!(key in target)) {
      issues.push({ code: "missing_key", locale, key });
      continue;
    }
    checkValue({ sourceValue, targetValue: target[key], key, locale, issues });
  }

  for (const key of Object.keys(target)) {
    if (key in source || targetKeysHandledAsPlural.has(key)) continue;
    issues.push({ code: "extra_key", locale, key });
  }

  return issues;
}

export async function checkLocaleDirectory({
  localesDir = DEFAULT_LOCALES_DIR,
  sourceLocale = "en",
  locales,
} = {}) {
  const sourcePath = path.join(localesDir, `${sourceLocale}.json`);
  const source = parseFlatCatalog(
    await fs.readFile(sourcePath, "utf8"),
    sourcePath,
  );
  const fileNames = (await fs.readdir(localesDir))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const selectedLocales = locales?.length
    ? locales
    : fileNames
        .map((name) => name.slice(0, -5))
        .filter((locale) => locale !== sourceLocale);

  const reports = [];
  for (const locale of selectedLocales) {
    const targetPath = path.join(localesDir, `${locale}.json`);
    try {
      const target = parseFlatCatalog(
        await fs.readFile(targetPath, "utf8"),
        targetPath,
      );
      reports.push({
        locale,
        path: targetPath,
        keyCount: Object.keys(target).length,
        issues: checkLocaleCatalog({
          source,
          target,
          locale,
          sourceLocale,
          sourceName: sourcePath,
          targetName: targetPath,
        }),
      });
    } catch (error) {
      reports.push({
        locale,
        path: targetPath,
        keyCount: 0,
        issues: [
          {
            code: error.code ?? "invalid_catalog",
            locale,
            message: error.message,
          },
        ],
      });
    }
  }

  return {
    sourceLocale,
    sourcePath,
    sourceKeyCount: Object.keys(source).length,
    reports,
    issueCount: reports.reduce(
      (count, report) => count + report.issues.length,
      0,
    ),
  };
}

function parseCliArgs(argv) {
  const options = { locales: [], useBaseline: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--locales-dir")
      options.localesDir = path.resolve(argv[++index]);
    else if (arg === "--source-locale") options.sourceLocale = argv[++index];
    else if (arg === "--locale") options.locales.push(argv[++index]);
    else if (arg === "--baseline")
      options.baselinePath = path.resolve(argv[++index]);
    else if (arg === "--no-baseline" || arg === "--strict")
      options.useBaseline = false;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.locales.length) delete options.locales;
  return options;
}

function formatIssue(issue) {
  const details = [issue.key, issue.category, issue.token, issue.message]
    .filter(Boolean)
    .join(" :: ");
  return `${issue.locale ?? "catalog"} [${issue.code}]${details ? ` ${details}` : ""}`;
}

export async function runLocaleCli(argv = process.argv.slice(2)) {
  try {
    const options = parseCliArgs(argv);
    const result = await checkLocaleDirectory(options);
    const rawIssues = result.reports.flatMap((report) => report.issues);
    let baseline;
    let reconciliation;
    if (options.useBaseline) {
      const baselinePath = options.baselinePath ?? DEFAULT_CONTRACT_BASELINE;
      baseline = await loadContractBaseline(baselinePath);
      reconciliation = applyContractBaseline("locales", rawIssues, baseline);
      result.baselinePath = baselinePath;
      result.baselineCommit = baseline.baseline_commit;
    } else {
      reconciliation = {
        reviewedIssues: [],
        newIssues: rawIssues,
        staleEntries: [],
      };
      result.baselinePath = null;
      result.baselineCommit = null;
    }
    result.reviewedDebtCount = reconciliation.reviewedIssues.length;
    result.newIssueCount = reconciliation.newIssues.length;
    result.staleBaselineCount = reconciliation.staleEntries.reduce(
      (count, entry) => count + entry.count,
      0,
    );
    result.blockingIssueCount =
      result.newIssueCount + result.staleBaselineCount;
    result.reviewedIssues = reconciliation.reviewedIssues;
    result.newIssues = reconciliation.newIssues;
    result.staleBaselineEntries = reconciliation.staleEntries;
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      const newIssues = new Set(reconciliation.newIssues);
      console.log(
        `Frontend locale source ${result.sourceLocale}: ${result.sourceKeyCount} keys`,
      );
      for (const report of result.reports) {
        console.log(
          `${report.locale}: ${report.keyCount} keys, ${report.issues.length} issue(s)`,
        );
        for (const issue of report.issues) {
          const status = newIssues.has(issue) ? "NEW" : "REVIEWED";
          console.log(`  [${status}] ${formatIssue(issue)}`);
        }
      }
      for (const entry of reconciliation.staleEntries) {
        console.log(
          `  [STALE BASELINE x${entry.count}] ${JSON.stringify(issueIdentity("locales", entry))}`,
        );
      }
      console.log(
        `Reviewed debt: ${result.reviewedDebtCount}; new: ${result.newIssueCount}; stale baseline: ${result.staleBaselineCount}`,
      );
      console.log(
        `Frontend locale contract: ${result.blockingIssueCount ? "FAIL" : "PASS"} (${result.blockingIssueCount} blocking issue(s))`,
      );
    }
    return result.blockingIssueCount ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await runLocaleCli();
}
