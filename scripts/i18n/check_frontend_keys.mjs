#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../../src/frontend/node_modules/typescript/lib/typescript.js";

import {
  applyContractBaseline,
  DEFAULT_CONTRACT_BASELINE,
  issueIdentity,
  loadContractBaseline,
  parseFlatCatalog,
} from "./check_frontend_locales.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const DEFAULT_SOURCE_ROOT = path.join(REPO_ROOT, "src/frontend/src");
const DEFAULT_CATALOG = path.join(DEFAULT_SOURCE_ROOT, "locales/en.json");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];

function lineOf(sourceFile, node) {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function isTranslationCallee(expression) {
  if (ts.isIdentifier(expression)) return expression.text === "t";
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "i18n" &&
    expression.name.text === "t"
  );
}

function staticString(node) {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  return undefined;
}

function collectStaticBindings(sourceFile) {
  const bindings = new Map();

  function nearestScope(node) {
    let current = node.parent;
    while (current) {
      if (
        ts.isSourceFile(current) ||
        ts.isBlock(current) ||
        ts.isFunctionLike(current)
      ) {
        return current;
      }
      current = current.parent;
    }
    return sourceFile;
  }

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const name = node.name.text;
      const entries = bindings.get(name) ?? [];
      entries.push({
        initializer: node.initializer,
        position: node.getStart(sourceFile),
        scope: nearestScope(node),
      });
      bindings.set(name, entries);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return bindings;
}

function nearestBindingScope(node) {
  let current = node.parent;
  while (current) {
    if (
      ts.isSourceFile(current) ||
      ts.isBlock(current) ||
      ts.isFunctionLike(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function parentBindingScope(scope) {
  return scope ? nearestBindingScope(scope) : undefined;
}

function bindingInitializer(identifier, sourceFile, bindings) {
  const entries = bindings.get(identifier.text) ?? [];
  const usePosition = identifier.getStart(sourceFile);
  let scope = nearestBindingScope(identifier);
  while (scope) {
    const candidate = entries
      .filter((entry) => entry.scope === scope && entry.position < usePosition)
      .sort((left, right) => right.position - left.position)[0];
    if (candidate) return candidate.initializer;
    scope = parentBindingScope(scope);
  }
  return undefined;
}

function resolvedStaticString(
  node,
  sourceFile,
  bindings,
  resolving = new Set(),
) {
  const direct = staticString(node);
  if (direct !== undefined) return direct;
  if (ts.isParenthesizedExpression(node)) {
    return resolvedStaticString(
      node.expression,
      sourceFile,
      bindings,
      resolving,
    );
  }
  if (!ts.isIdentifier(node) || resolving.has(node.text)) return undefined;
  const initializer = bindingInitializer(node, sourceFile, bindings);
  if (!initializer) return undefined;
  const nextResolving = new Set(resolving).add(node.text);
  return resolvedStaticString(initializer, sourceFile, bindings, nextResolving);
}

function propertyNameText(name) {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

function literalDefaultValue(optionsNode, sourceFile, bindings) {
  if (!optionsNode || !ts.isObjectLiteralExpression(optionsNode))
    return undefined;
  for (const property of optionsNode.properties) {
    if (propertyNameText(property.name) !== "defaultValue") continue;
    if (ts.isPropertyAssignment(property)) {
      return resolvedStaticString(property.initializer, sourceFile, bindings);
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      return resolvedStaticString(property.name, sourceFile, bindings);
    }
  }
  return undefined;
}

export function extractTranslationCalls(source, sourcePath = "source.tsx") {
  const scriptKind = sourcePath.endsWith("x")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const staticBindings = collectStaticBindings(sourceFile);
  const literals = [];
  const dynamic = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      isTranslationCallee(node.expression) &&
      node.arguments.length
    ) {
      const key = staticString(node.arguments[0]);
      const base = {
        path: sourcePath,
        line: lineOf(sourceFile, node),
        defaultValue: literalDefaultValue(
          node.arguments[1],
          sourceFile,
          staticBindings,
        ),
      };
      if (key !== undefined) literals.push({ ...base, key });
      else
        dynamic.push({
          ...base,
          expression: node.arguments[0].getText(sourceFile),
        });
    }

    if (
      ts.isJsxAttribute(node) &&
      propertyNameText(node.name) === "i18nKey" &&
      node.initializer
    ) {
      let key;
      if (ts.isStringLiteral(node.initializer)) key = node.initializer.text;
      else if (ts.isJsxExpression(node.initializer))
        key = staticString(node.initializer.expression);
      if (key !== undefined) {
        literals.push({
          path: sourcePath,
          line: lineOf(sourceFile, node),
          key,
          kind: "Trans",
        });
      } else if (
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        dynamic.push({
          path: sourcePath,
          line: lineOf(sourceFile, node),
          expression: node.initializer.expression.getText(sourceFile),
          kind: "Trans",
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { literals, dynamic };
}

export function validateExactAllowlist(entries, label = "allowlist") {
  if (!Array.isArray(entries)) throw new Error(`${label} must be a JSON array`);
  const identities = new Set();
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    if (typeof entry.path !== "string" || !entry.path.trim()) {
      throw new Error(`${label}[${index}] requires a non-empty path`);
    }
    if (
      ["*", "?", "[", "]"].some((character) => entry.path.includes(character))
    ) {
      throw new Error(
        `${label}[${index}] path must be exact; glob patterns are forbidden`,
      );
    }
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      throw new Error(`${label}[${index}] requires a non-empty reason`);
    }
    const hasExpression =
      typeof entry.expression === "string" && entry.expression.length > 0;
    const hasValue = typeof entry.value === "string" && entry.value.length > 0;
    if (hasExpression === hasValue) {
      throw new Error(
        `${label}[${index}] requires exactly one of expression or value`,
      );
    }
    if (
      entry.catalogPrefix !== undefined &&
      typeof entry.catalogPrefix !== "string"
    ) {
      throw new Error(`${label}[${index}].catalogPrefix must be a string`);
    }
    const identity = `${entry.path}\0${hasExpression ? `expression:${entry.expression}` : `value:${entry.value}`}`;
    if (identities.has(identity))
      throw new Error(`${label}[${index}] duplicates an earlier exact entry`);
    identities.add(identity);
  }
  return entries;
}

function exactMatch(entries, call, field) {
  return entries.find(
    (entry) => entry.path === call.path && entry[field] === call[field],
  );
}

function looksLikeSentenceKey(key) {
  return !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(key);
}

function looksLikeEnglishDefault(value) {
  return /[A-Za-z]{2,}/.test(value);
}

function catalogResolution(catalog, key) {
  if (Object.hasOwn(catalog, key)) return [key];
  const pluralKeys = PLURAL_SUFFIXES.map((suffix) => `${key}_${suffix}`).filter(
    (candidate) => Object.hasOwn(catalog, candidate),
  );
  return pluralKeys;
}

export function checkFrontendKeys({
  catalog,
  files,
  dynamicAllowlist = [],
  defaultValueAllowlist = [],
  reportStale = true,
}) {
  validateExactAllowlist(dynamicAllowlist, "dynamic key allowlist");
  validateExactAllowlist(defaultValueAllowlist, "defaultValue allowlist");

  const issues = [];
  const usedCatalogKeys = new Set();

  for (const file of files) {
    const calls = extractTranslationCalls(file.source, file.path);
    for (const call of calls.literals) {
      if (looksLikeSentenceKey(call.key)) {
        issues.push({
          code: "sentence_as_key",
          path: call.path,
          line: call.line,
          key: call.key,
        });
      }

      const resolvedKeys = catalogResolution(catalog, call.key);
      if (!resolvedKeys.length) {
        issues.push({
          code: "missing_catalog_key",
          path: call.path,
          line: call.line,
          key: call.key,
        });
      } else {
        for (const key of resolvedKeys) usedCatalogKeys.add(key);
      }

      if (
        call.defaultValue !== undefined &&
        looksLikeEnglishDefault(call.defaultValue) &&
        !exactMatch(
          defaultValueAllowlist,
          { ...call, value: call.defaultValue },
          "value",
        )
      ) {
        issues.push({
          code: "english_default_value",
          path: call.path,
          line: call.line,
          key: call.key,
          value: call.defaultValue,
        });
      }
    }

    for (const call of calls.dynamic) {
      const allow = exactMatch(dynamicAllowlist, call, "expression");
      if (!allow) {
        issues.push({
          code: "unallowlisted_dynamic_key",
          path: call.path,
          line: call.line,
          expression: call.expression,
        });
      } else if (allow.catalogPrefix) {
        for (const key of Object.keys(catalog)) {
          if (key.startsWith(allow.catalogPrefix)) usedCatalogKeys.add(key);
        }
      }

      if (
        call.defaultValue !== undefined &&
        looksLikeEnglishDefault(call.defaultValue) &&
        !exactMatch(
          defaultValueAllowlist,
          { ...call, value: call.defaultValue },
          "value",
        )
      ) {
        issues.push({
          code: "english_default_value",
          path: call.path,
          line: call.line,
          expression: call.expression,
          value: call.defaultValue,
        });
      }
    }
  }

  if (reportStale) {
    for (const key of Object.keys(catalog)) {
      if (!usedCatalogKeys.has(key))
        issues.push({ code: "stale_catalog_key", key });
    }
  }

  return issues;
}

function shouldSkip(relativePath) {
  const parts = relativePath.split("/");
  const base = parts.at(-1);
  return (
    parts.some((part) =>
      [
        "locales",
        "icons",
        "__tests__",
        "__mocks__",
        "stories",
        "testUtils",
      ].includes(part),
    ) ||
    /\.(test|spec|stories)\.[^.]+$/.test(base) ||
    base.endsWith(".d.ts")
  );
}

export async function collectSourceFiles(sourceRoot = DEFAULT_SOURCE_ROOT) {
  const files = [];
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path
        .relative(REPO_ROOT, absolutePath)
        .split(path.sep)
        .join("/");
      if (shouldSkip(relativePath)) continue;
      if (entry.isDirectory()) await walk(absolutePath);
      else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push({
          path: relativePath,
          source: await fs.readFile(absolutePath, "utf8"),
        });
      }
    }
  }
  await walk(sourceRoot);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function readAllowlist(filePath, label) {
  if (!filePath) return [];
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  return validateExactAllowlist(parsed, label);
}

function parseCliArgs(argv) {
  const options = { useBaseline: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-root")
      options.sourceRoot = path.resolve(argv[++index]);
    else if (arg === "--catalog")
      options.catalogPath = path.resolve(argv[++index]);
    else if (arg === "--dynamic-allowlist")
      options.dynamicAllowlistPath = path.resolve(argv[++index]);
    else if (arg === "--default-value-allowlist")
      options.defaultValueAllowlistPath = path.resolve(argv[++index]);
    else if (arg === "--baseline")
      options.baselinePath = path.resolve(argv[++index]);
    else if (arg === "--no-baseline" || arg === "--strict")
      options.useBaseline = false;
    else if (arg === "--no-stale") options.reportStale = false;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function issueSummary(issues) {
  const counts = {};
  for (const issue of issues)
    counts[issue.code] = (counts[issue.code] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function formatIssue(issue) {
  const location = issue.path
    ? `${issue.path}${issue.line ? `:${issue.line}` : ""}`
    : "catalog";
  const value = issue.key ?? issue.expression ?? issue.value ?? "";
  return `${location} [${issue.code}]${value ? ` ${value}` : ""}`;
}

export async function runKeysCli(argv = process.argv.slice(2)) {
  try {
    const options = parseCliArgs(argv);
    const sourceRoot = options.sourceRoot ?? DEFAULT_SOURCE_ROOT;
    const catalogPath = options.catalogPath ?? DEFAULT_CATALOG;
    const catalog = parseFlatCatalog(
      await fs.readFile(catalogPath, "utf8"),
      catalogPath,
    );
    const files = await collectSourceFiles(sourceRoot);
    const dynamicAllowlist = await readAllowlist(
      options.dynamicAllowlistPath,
      "dynamic key allowlist",
    );
    const defaultValueAllowlist = await readAllowlist(
      options.defaultValueAllowlistPath,
      "defaultValue allowlist",
    );
    const issues = checkFrontendKeys({
      catalog,
      files,
      dynamicAllowlist,
      defaultValueAllowlist,
      reportStale: options.reportStale ?? true,
    });
    const result = {
      catalogPath,
      catalogKeyCount: Object.keys(catalog).length,
      sourceFileCount: files.length,
      issueCount: issues.length,
      counts: issueSummary(issues),
      issues,
    };
    let baseline;
    let reconciliation;
    if (options.useBaseline) {
      const baselinePath = options.baselinePath ?? DEFAULT_CONTRACT_BASELINE;
      baseline = await loadContractBaseline(baselinePath);
      reconciliation = applyContractBaseline("keys", issues, baseline);
      result.baselinePath = baselinePath;
      result.baselineCommit = baseline.baseline_commit;
    } else {
      reconciliation = {
        reviewedIssues: [],
        newIssues: issues,
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
        `Frontend key scan: ${result.sourceFileCount} files, ${result.catalogKeyCount} catalog keys`,
      );
      console.log(`Issue counts: ${JSON.stringify(result.counts)}`);
      for (const issue of issues) {
        const status = newIssues.has(issue) ? "NEW" : "REVIEWED";
        console.log(`  [${status}] ${formatIssue(issue)}`);
      }
      for (const entry of reconciliation.staleEntries) {
        console.log(
          `  [STALE BASELINE x${entry.count}] ${JSON.stringify(issueIdentity("keys", entry))}`,
        );
      }
      console.log(
        `Reviewed debt: ${result.reviewedDebtCount}; new: ${result.newIssueCount}; stale baseline: ${result.staleBaselineCount}`,
      );
      console.log(
        `Frontend key contract: ${result.blockingIssueCount ? "FAIL" : "PASS"} (${result.blockingIssueCount} blocking issue(s))`,
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
  process.exitCode = await runKeysCli();
}
