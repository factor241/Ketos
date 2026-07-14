#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const TYPESCRIPT_PATH = path.join(
  DEFAULT_REPO_ROOT,
  "src/frontend/node_modules/typescript/lib/typescript.js",
);

if (!existsSync(TYPESCRIPT_PATH)) {
  throw new Error(
    `TypeScript is not installed at ${TYPESCRIPT_PATH}. Run the frontend dependency install first.`,
  );
}

const typescriptModule = await import(pathToFileURL(TYPESCRIPT_PATH).href);
const ts = typescriptModule.default ?? typescriptModule;

const SOURCE_RELATIVE_ROOT = "src/frontend/src";
const STATIC_HTML_RELATIVE_PATH = "src/frontend/index.html";
const ALLOWLIST_RELATIVE_PATH =
  "scripts/i18n/allowlists/frontend-hardcoded.json";
const DEBT_RELATIVE_PATH =
  "scripts/i18n/allowlists/frontend-hardcoded-debt.json";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  "__tests__",
  "__mocks__",
  "locales",
]);
const VISIBLE_PROPERTIES = new Set([
  "title",
  "placeholder",
  "aria-label",
  "aria-description",
  "alt",
  "label",
  "description",
  "tooltip",
  "headerName",
  "emptyMessage",
  "emptyText",
  "buttonText",
  "helperText",
  "caption",
  "message",
  "content",
  "text",
]);
const ALLOWED_DISPOSITIONS = new Set([
  "allowlist_exact",
  "already_semantic_key",
  "false_positive_scanner",
  "machine_contract",
  "semantic_key_required",
]);
const DISPLAY_BINARY_OPERATORS = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);
const TOAST_CALL_NAMES = new Set([
  "toast",
  "toast.error",
  "toast.info",
  "toast.message",
  "toast.success",
  "toast.warning",
  "showToast",
]);
const REQUIRED_ALLOWLIST_FIELDS = [
  "path",
  "value",
  "reason",
  "owner",
  "review_date",
];

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function normalizeValue(value) {
  return value.replace(/\s+/g, " ").trim();
}

function containsEnglish(value) {
  return /[A-Za-z]/.test(value);
}

function propertyName(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return null;
}

function stringValue(node, sourceFile) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    const source = node.getText(sourceFile);
    return source.length >= 2 ? source.slice(1, -1) : source;
  }
  if (ts.isJsxExpression(node)) return stringValue(node.expression, sourceFile);
  return null;
}

function displayStringValues(
  node,
  sourceFile,
  resolveBinding,
  resolving = new Set(),
) {
  if (!node) return [];
  const direct = stringValue(node, sourceFile);
  if (direct !== null) return [direct];
  if (ts.isIdentifier(node) && resolveBinding && !resolving.has(node.text)) {
    const initializer = resolveBinding(node);
    if (!initializer) return [];
    return displayStringValues(
      initializer,
      sourceFile,
      resolveBinding,
      new Set(resolving).add(node.text),
    );
  }
  if (
    ts.isJsxExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return displayStringValues(
      node.expression,
      sourceFile,
      resolveBinding,
      resolving,
    );
  }
  if (ts.isConditionalExpression(node)) {
    return [
      ...displayStringValues(
        node.whenTrue,
        sourceFile,
        resolveBinding,
        resolving,
      ),
      ...displayStringValues(
        node.whenFalse,
        sourceFile,
        resolveBinding,
        resolving,
      ),
    ];
  }
  if (
    ts.isBinaryExpression(node) &&
    DISPLAY_BINARY_OPERATORS.has(node.operatorToken.kind)
  ) {
    return [
      ...displayStringValues(node.left, sourceFile, resolveBinding, resolving),
      ...displayStringValues(node.right, sourceFile, resolveBinding, resolving),
    ];
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) =>
      displayStringValues(element, sourceFile, resolveBinding, resolving),
    );
  }
  return [];
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

function createBindingResolver(sourceFile) {
  const bindings = new Map();

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const entries = bindings.get(node.name.text) ?? [];
      entries.push({
        initializer: node.initializer,
        position: node.getStart(sourceFile),
        scope: nearestBindingScope(node),
      });
      bindings.set(node.name.text, entries);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return (identifier) => {
    const entries = bindings.get(identifier.text) ?? [];
    const usePosition = identifier.getStart(sourceFile);
    let scope = nearestBindingScope(identifier);
    while (scope) {
      const candidate = entries
        .filter(
          (entry) => entry.scope === scope && entry.position < usePosition,
        )
        .sort((left, right) => right.position - left.position)[0];
      if (candidate) return candidate.initializer;
      scope = nearestBindingScope(scope);
    }
    return undefined;
  };
}

function scriptKindFor(relativePath) {
  switch (path.extname(relativePath)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

export function scanSourceText(sourceText, { relativePath }) {
  const normalizedPath = normalizePath(relativePath);
  const sourceFile = ts.createSourceFile(
    normalizedPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(normalizedPath),
  );
  const sourceLines = sourceText.split(/\r?\n/);
  const resolveBinding = createBindingResolver(sourceFile);
  const candidates = [];
  const seen = new Set();

  function addCandidate(node, kind, rawValue, property = null) {
    if (typeof rawValue !== "string") return;
    const value = normalizeValue(rawValue);
    if (!value || !containsEnglish(value)) return;
    const start = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    const candidate = {
      relativePath: normalizedPath,
      line: start.line + 1,
      column: start.character + 1,
      kind,
      value,
      sourceExcerpt: sourceLines[start.line]?.trim() ?? "",
      ...(property ? { property } : {}),
    };
    const key = [
      candidate.relativePath,
      candidate.line,
      candidate.column,
      candidate.kind,
      candidate.property ?? "",
      candidate.value,
    ].join("\u0000");
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }

  function addDisplayCandidates(node, kind, expression, property = null) {
    for (const value of displayStringValues(
      expression,
      sourceFile,
      resolveBinding,
    )) {
      addCandidate(node, kind, value, property);
    }
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      addCandidate(node, "jsx_text", node.getText(sourceFile));
    } else if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) {
      addDisplayCandidates(node, "jsx_text", node.expression);
    } else if (ts.isJsxAttribute(node)) {
      const name = propertyName(node.name);
      if (name === "defaultValue") {
        addDisplayCandidates(node, "default_value", node.initializer, name);
      } else if (VISIBLE_PROPERTIES.has(name)) {
        addDisplayCandidates(
          node,
          "visible_jsx_attribute",
          node.initializer,
          name,
        );
      }
    } else if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name === "defaultValue") {
        addDisplayCandidates(node, "default_value", node.initializer, name);
      } else if (VISIBLE_PROPERTIES.has(name)) {
        addDisplayCandidates(
          node,
          "visible_object_property",
          node.initializer,
          name,
        );
      }
    } else if (ts.isShorthandPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name === "defaultValue") {
        addDisplayCandidates(node, "default_value", node.name, name);
      } else if (VISIBLE_PROPERTIES.has(name)) {
        addDisplayCandidates(node, "visible_object_property", node.name, name);
      }
    } else if (ts.isBindingElement(node)) {
      const name = propertyName(node.propertyName) ?? propertyName(node.name);
      if (name === "defaultValue") {
        addDisplayCandidates(node, "default_value", node.initializer, name);
      } else if (VISIBLE_PROPERTIES.has(name)) {
        addDisplayCandidates(node, "visible_default", node.initializer, name);
      }
    } else if (ts.isReturnStatement(node)) {
      addDisplayCandidates(node, "returned_display_string", node.expression);
    } else if (ts.isArrowFunction(node)) {
      addDisplayCandidates(node, "returned_display_string", node.body);
    } else if (ts.isCallExpression(node)) {
      const callName = node.expression.getText(sourceFile);
      if (TOAST_CALL_NAMES.has(callName)) {
        for (const argument of node.arguments) {
          addDisplayCandidates(node, "toast_message", argument);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates.sort(
    (left, right) =>
      left.line - right.line ||
      left.column - right.column ||
      left.kind.localeCompare(right.kind) ||
      left.value.localeCompare(right.value),
  );
}

export function scanStaticHtmlText(sourceText, { relativePath }) {
  const normalizedPath = normalizePath(relativePath);
  const sourceLines = sourceText.split(/\r?\n/);
  const candidates = [];
  const seen = new Set();
  const ignoredRanges = [];
  const ignoredPattern = /<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi;
  for (const match of sourceText.matchAll(ignoredPattern)) {
    ignoredRanges.push([match.index, match.index + match[0].length]);
  }

  function isIgnored(offset) {
    return ignoredRanges.some(([start, end]) => offset >= start && offset < end);
  }

  function addCandidate(offset, kind, rawValue, property = null) {
    const value = normalizeValue(rawValue.replace(/&[a-zA-Z#0-9]+;/g, " "));
    if (!value || !containsEnglish(value) || isIgnored(offset)) return;
    const prefix = sourceText.slice(0, offset);
    const line = prefix.split(/\r?\n/).length;
    const lastNewline = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf("\r"));
    const column = offset - lastNewline;
    const candidate = {
      relativePath: normalizedPath,
      line,
      column,
      kind,
      value,
      sourceExcerpt: sourceLines[line - 1]?.trim() ?? "",
      ...(property ? { property } : {}),
    };
    const identity = astCandidateIdentity(candidate);
    if (!seen.has(identity)) {
      seen.add(identity);
      candidates.push(candidate);
    }
  }

  const textPattern = />([^<]+)</g;
  for (const match of sourceText.matchAll(textPattern)) {
    addCandidate(match.index + 1, "static_html_text", match[1]);
  }

  const attributePattern = /\b(title|aria-label|aria-description|alt|placeholder)\s*=\s*(["'])(.*?)\2/gi;
  for (const match of sourceText.matchAll(attributePattern)) {
    const valueOffset = match.index + match[0].indexOf(match[3]);
    addCandidate(
      valueOffset,
      "static_html_attribute",
      match[3],
      match[1].toLowerCase(),
    );
  }

  return candidates.sort(
    (left, right) =>
      left.line - right.line ||
      left.column - right.column ||
      left.kind.localeCompare(right.kind) ||
      left.value.localeCompare(right.value),
  );
}

function validationError(message) {
  return new Error(`Invalid frontend hardcoded ledger: ${message}`);
}

function assertNonEmptyString(value, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw validationError(message);
  }
}

export function validateLedger(ledger) {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    throw validationError("root must be an object");
  }
  if (!ledger.baseline || typeof ledger.baseline !== "object") {
    throw validationError("baseline must be an object");
  }
  assertNonEmptyString(ledger.baseline.commit, "baseline.commit is required");
  if (!Array.isArray(ledger.entries)) {
    throw validationError("entries must be an array");
  }
  if (!Array.isArray(ledger.candidate_inventory)) {
    throw validationError("candidate_inventory must be an array");
  }

  const allowlistKeys = new Set();
  ledger.entries.forEach((entry, index) => {
    for (const field of REQUIRED_ALLOWLIST_FIELDS) {
      assertNonEmptyString(
        entry?.[field],
        `allowlist entry ${index} requires ${field}`,
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.review_date)) {
      throw validationError(
        `allowlist entry ${index} review_date must use YYYY-MM-DD`,
      );
    }
    if (/[*?[\]]/.test(entry.path)) {
      throw validationError(`allowlist entry ${index} path must be exact`);
    }
    const key = `${normalizePath(entry.path)}\u0000${entry.value}`;
    if (allowlistKeys.has(key)) {
      throw validationError(`duplicate allowlist path/value at entry ${index}`);
    }
    allowlistKeys.add(key);
  });

  const candidateIds = new Set();
  const actualTriageCounts = {};
  ledger.candidate_inventory.forEach((candidate, index) => {
    for (const field of [
      "candidate_id",
      "path",
      "source_excerpt",
      "disposition",
      "owner",
      "reason",
    ]) {
      assertNonEmptyString(
        candidate?.[field],
        `candidate_inventory entry ${index} requires ${field}`,
      );
    }
    if (!Number.isInteger(candidate.line) || candidate.line < 1) {
      throw validationError(
        `candidate_inventory entry ${index} requires a positive line`,
      );
    }
    if (!ALLOWED_DISPOSITIONS.has(candidate.disposition)) {
      throw validationError(
        `candidate_inventory entry ${index} has unsupported disposition ${candidate.disposition}`,
      );
    }
    if (candidateIds.has(candidate.candidate_id)) {
      throw validationError(`duplicate candidate_id ${candidate.candidate_id}`);
    }
    candidateIds.add(candidate.candidate_id);
    actualTriageCounts[candidate.disposition] =
      (actualTriageCounts[candidate.disposition] ?? 0) + 1;

    if (
      candidate.disposition === "semantic_key_required" &&
      (!Number.isInteger(candidate.target_task) || candidate.target_task < 1)
    ) {
      throw validationError(
        `candidate_inventory entry ${index} semantic debt requires target_task`,
      );
    }
    if (candidate.disposition === "allowlist_exact") {
      assertNonEmptyString(
        candidate.allowlist_value,
        `candidate_inventory entry ${index} allowlist_exact requires allowlist_value`,
      );
      const key = `${normalizePath(candidate.path)}\u0000${candidate.allowlist_value}`;
      if (!allowlistKeys.has(key)) {
        throw validationError(
          `candidate_inventory entry ${index} has no matching exact allowlist entry`,
        );
      }
    }
  });

  if (ledger.ast_baseline_inventory !== undefined) {
    if (!Array.isArray(ledger.ast_baseline_inventory)) {
      throw validationError("ast_baseline_inventory must be an array");
    }
    const astIdentities = new Set();
    ledger.ast_baseline_inventory.forEach((candidate, index) => {
      const allowedFields = new Set([
        "path",
        "line",
        "column",
        "kind",
        "property",
        "value",
        "source_excerpt",
      ]);
      const unknownFields = Object.keys(candidate ?? {}).filter(
        (field) => !allowedFields.has(field),
      );
      if (unknownFields.length) {
        throw validationError(
          `ast_baseline_inventory entry ${index} contains unknown field(s): ${unknownFields.join(", ")}`,
        );
      }
      for (const field of ["path", "kind", "value", "source_excerpt"]) {
        assertNonEmptyString(
          candidate?.[field],
          `ast_baseline_inventory entry ${index} requires ${field}`,
        );
      }
      for (const field of ["line", "column"]) {
        if (!Number.isInteger(candidate?.[field]) || candidate[field] < 1) {
          throw validationError(
            `ast_baseline_inventory entry ${index} requires a positive ${field}`,
          );
        }
      }
      if (
        candidate.property !== undefined &&
        (typeof candidate.property !== "string" || !candidate.property)
      ) {
        throw validationError(
          `ast_baseline_inventory entry ${index} property must be a non-empty string`,
        );
      }
      if (/[*?[\]]/.test(candidate.path)) {
        throw validationError(
          `ast_baseline_inventory entry ${index} path must be exact`,
        );
      }
      const identity = astCandidateIdentity(candidate);
      if (astIdentities.has(identity)) {
        throw validationError(
          `ast_baseline_inventory entry ${index} duplicates an earlier exact identity`,
        );
      }
      astIdentities.add(identity);
    });
    if (
      Number.isInteger(ledger.baseline.ast_candidate_count) &&
      ledger.baseline.ast_candidate_count !==
        ledger.ast_baseline_inventory.length
    ) {
      throw validationError(
        `baseline.ast_candidate_count expected ${ledger.baseline.ast_candidate_count}, found ${ledger.ast_baseline_inventory.length}`,
      );
    }
  }

  const expectedInventoryCount = ledger.baseline.raw_candidate_count;
  if (
    Number.isInteger(expectedInventoryCount) &&
    expectedInventoryCount !== ledger.candidate_inventory.length
  ) {
    throw validationError(
      `baseline.raw_candidate_count expected ${expectedInventoryCount}, found ${ledger.candidate_inventory.length}`,
    );
  }
  if (
    Number.isInteger(ledger.baseline.reproduced_raw_candidate_count) &&
    ledger.baseline.reproduced_raw_candidate_count !==
      ledger.candidate_inventory.length
  ) {
    throw validationError(
      `baseline.reproduced_raw_candidate_count expected ${ledger.baseline.reproduced_raw_candidate_count}, found ${ledger.candidate_inventory.length}`,
    );
  }
  if (Number.isInteger(ledger.baseline.reproduced_candidate_file_count)) {
    const actualFileCount = new Set(
      ledger.candidate_inventory.map((candidate) =>
        normalizePath(candidate.path),
      ),
    ).size;
    if (ledger.baseline.reproduced_candidate_file_count !== actualFileCount) {
      throw validationError(
        `baseline.reproduced_candidate_file_count expected ${ledger.baseline.reproduced_candidate_file_count}, found ${actualFileCount}`,
      );
    }
  }

  const triageCounts = ledger.baseline.triage_counts;
  if (!triageCounts || typeof triageCounts !== "object") {
    throw validationError("baseline.triage_counts must be an object");
  }
  const dispositions = new Set([
    ...Object.keys(triageCounts),
    ...Object.keys(actualTriageCounts),
  ]);
  for (const disposition of dispositions) {
    const expected = triageCounts[disposition] ?? 0;
    const actual = actualTriageCounts[disposition] ?? 0;
    if (expected !== actual) {
      throw validationError(
        `baseline.triage_counts.${disposition} expected ${expected}, found ${actual}`,
      );
    }
  }
  return ledger;
}

export function validateDebtLedger(debtLedger, allowlistEntries) {
  if (!debtLedger || typeof debtLedger !== "object" || Array.isArray(debtLedger)) {
    throw validationError("migration debt root must be an object");
  }
  assertNonEmptyString(debtLedger.active_wave, "migration debt active_wave is required");
  if (!Array.isArray(debtLedger.entries)) {
    throw validationError("migration debt entries must be an array");
  }
  if (!Array.isArray(debtLedger.static_html_baseline_inventory)) {
    throw validationError(
      "migration debt static_html_baseline_inventory must be an array",
    );
  }

  const allowlistKeys = new Set(
    allowlistEntries.map(
      (entry) => `${normalizePath(entry.path)}\u0000${normalizeValue(entry.value)}`,
    ),
  );
  const candidateIds = new Set();
  debtLedger.entries.forEach((entry, index) => {
    for (const field of [
      "candidate_id",
      "wave",
      "path",
      "kind",
      "value",
      "source_excerpt",
      "owner",
      "review_date",
      "reason",
    ]) {
      assertNonEmptyString(entry?.[field], `migration debt entry ${index} requires ${field}`);
    }
    for (const field of ["line", "column"]) {
      if (!Number.isInteger(entry?.[field]) || entry[field] < 1) {
        throw validationError(
          `migration debt entry ${index} requires a positive ${field}`,
        );
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.review_date)) {
      throw validationError(
        `migration debt entry ${index} review_date must use YYYY-MM-DD`,
      );
    }
    if (candidateIds.has(entry.candidate_id)) {
      throw validationError(`duplicate migration debt candidate_id ${entry.candidate_id}`);
    }
    candidateIds.add(entry.candidate_id);
    const allowlistKey = `${normalizePath(entry.path)}\u0000${normalizeValue(entry.value)}`;
    if (allowlistKeys.has(allowlistKey)) {
      throw validationError(
        `migration debt entry ${index} duplicates the permanent allowlist`,
      );
    }
  });
  return debtLedger;
}

function isProductionFile(relativePath) {
  const normalized = normalizePath(relativePath);
  const segments = normalized.split("/");
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment)))
    return false;
  const basename = path.basename(normalized);
  if (/\.(?:test|spec|stories?|story)\.[^.]+$/i.test(basename)) return false;
  return SOURCE_EXTENSIONS.has(path.extname(basename));
}

function listProductionFiles(repoRoot) {
  const sourceRoot = path.join(repoRoot, SOURCE_RELATIVE_ROOT);
  if (!existsSync(sourceRoot)) {
    throw new Error(`Frontend source root does not exist: ${sourceRoot}`);
  }
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) walk(absolutePath);
      } else if (entry.isFile()) {
        const relativePath = normalizePath(
          path.relative(repoRoot, absolutePath),
        );
        if (isProductionFile(relativePath)) files.push(relativePath);
      }
    }
  }
  walk(sourceRoot);
  return files.sort();
}

function runGit(repoRoot, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", allowFailure ? "ignore" : "pipe"],
    });
  } catch (error) {
    if (allowFailure) return null;
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

function baselineSource(repoRoot, baselineCommit, relativePath) {
  return runGit(
    repoRoot,
    ["show", `${baselineCommit}:${normalizePath(relativePath)}`],
    { allowFailure: true },
  );
}

function isAllowlisted(candidate, allowlistKeys) {
  return allowlistKeys.has(`${candidate.relativePath}\u0000${candidate.value}`);
}

function candidateMatchesEvidence(candidate, evidence, inventoryEntry) {
  return (
    candidate.relativePath === normalizePath(inventoryEntry.path) &&
    candidate.line === inventoryEntry.line &&
    candidate.kind === evidence.kind &&
    candidate.value === normalizeValue(evidence.value) &&
    candidate.sourceExcerpt === inventoryEntry.source_excerpt.trim() &&
    (evidence.property === undefined ||
      candidate.property === evidence.property)
  );
}

function astBaselineEntry(candidate) {
  return {
    path: normalizePath(candidate.relativePath ?? candidate.path),
    line: candidate.line,
    column: candidate.column,
    kind: candidate.kind,
    ...(candidate.property ? { property: candidate.property } : {}),
    value: normalizeValue(candidate.value),
    source_excerpt: candidate.sourceExcerpt ?? candidate.source_excerpt,
  };
}

function astCandidateIdentity(candidate) {
  const entry = astBaselineEntry(candidate);
  return [
    entry.path,
    entry.line,
    entry.column,
    entry.kind,
    entry.property ?? "",
    entry.value,
    entry.source_excerpt,
  ].join("\u0000");
}

function sortedAstBaseline(entries) {
  return [...entries].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.column - right.column ||
      left.kind.localeCompare(right.kind) ||
      left.value.localeCompare(right.value),
  );
}

function flattenCandidates(currentCandidatesByPath) {
  return [...currentCandidatesByPath.values()].flat();
}

function captureCandidates(files, sourceForPath, allowlistKeys) {
  const captured = [];
  for (const relativePath of files) {
    const sourceText = sourceForPath(relativePath);
    if (sourceText === null) continue;
    for (const candidate of scanSourceText(sourceText, { relativePath })) {
      if (!isAllowlisted(candidate, allowlistKeys)) {
        captured.push(astBaselineEntry(candidate));
      }
    }
  }
  return sortedAstBaseline(captured);
}

function scanCurrentStaticHtml(repoRoot) {
  const absolutePath = path.join(repoRoot, STATIC_HTML_RELATIVE_PATH);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new Error(`Frontend static HTML does not exist: ${absolutePath}`);
  }
  return scanStaticHtmlText(readFileSync(absolutePath, "utf8"), {
    relativePath: STATIC_HTML_RELATIVE_PATH,
  });
}

export function captureCurrentAstBaseline(
  repoRoot = DEFAULT_REPO_ROOT,
  entries = [],
) {
  const normalizedRepoRoot = path.resolve(repoRoot);
  const allowlistKeys = new Set(
    entries.map((entry) => `${normalizePath(entry.path)}\u0000${entry.value}`),
  );
  return captureCandidates(
    listProductionFiles(normalizedRepoRoot),
    (relativePath) =>
      readFileSync(path.join(normalizedRepoRoot, relativePath), "utf8"),
    allowlistKeys,
  );
}

function captureCommittedAstBaseline(repoRoot, baselineCommit, allowlistKeys) {
  runGit(repoRoot, ["cat-file", "-e", `${baselineCommit}^{commit}`]);
  const files = runGit(repoRoot, [
    "ls-tree",
    "-r",
    "--name-only",
    baselineCommit,
    "--",
    SOURCE_RELATIVE_ROOT,
  ])
    .split(/\r?\n/)
    .map((value) => normalizePath(value.trim()))
    .filter((value) => value && isProductionFile(value));
  return captureCandidates(
    files,
    (relativePath) => baselineSource(repoRoot, baselineCommit, relativePath),
    allowlistKeys,
  );
}

function reconcileAstBaseline(
  currentCandidatesByPath,
  baselineEntries,
  allowlistKeys,
) {
  const currentCandidates = flattenCandidates(currentCandidatesByPath).filter(
    (candidate) => !isAllowlisted(candidate, allowlistKeys),
  );
  const currentByIdentity = new Map(
    currentCandidates.map((candidate) => [
      astCandidateIdentity(candidate),
      candidate,
    ]),
  );
  const baselineByIdentity = new Map(
    baselineEntries.map((candidate) => [
      astCandidateIdentity(candidate),
      candidate,
    ]),
  );
  return {
    reviewed: currentCandidates.filter((candidate) =>
      baselineByIdentity.has(astCandidateIdentity(candidate)),
    ),
    added: currentCandidates.filter(
      (candidate) => !baselineByIdentity.has(astCandidateIdentity(candidate)),
    ),
    stale: baselineEntries.filter(
      (candidate) => !currentByIdentity.has(astCandidateIdentity(candidate)),
    ),
  };
}

function reconcileCandidateInventory(ledger, currentCandidatesByPath) {
  const reviewed = [];
  const stale = [];
  for (const inventoryEntry of ledger.candidate_inventory) {
    if (!inventoryEntry.ast_evidence?.length) continue;
    const candidates =
      currentCandidatesByPath.get(normalizePath(inventoryEntry.path)) ?? [];
    const remaining = [...candidates];
    const matched = inventoryEntry.ast_evidence.every((evidence) => {
      const index = remaining.findIndex((candidate) =>
        candidateMatchesEvidence(candidate, evidence, inventoryEntry),
      );
      if (index < 0) return false;
      remaining.splice(index, 1);
      return true;
    });
    if (matched) reviewed.push(inventoryEntry);
    else stale.push(inventoryEntry);
  }
  return { reviewed, stale };
}

function validateAllowlistSources(repoRoot, entries) {
  for (const [index, entry] of entries.entries()) {
    const absolutePath = path.join(repoRoot, entry.path);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw validationError(
        `allowlist entry ${index} path does not exist: ${entry.path}`,
      );
    }
    const sourceText = readFileSync(absolutePath, "utf8");
    const normalizedAstMatch = isProductionFile(entry.path)
      ? scanSourceText(sourceText, { relativePath: entry.path }).some(
          (candidate) => candidate.value === normalizeValue(entry.value),
        )
      : false;
    if (!sourceText.includes(entry.value) && !normalizedAstMatch) {
      throw validationError(
        `allowlist entry ${index} value is absent from ${entry.path}: ${entry.value}`,
      );
    }
  }
}

function printResult(result, stdout, stderr) {
  const destination = result.ok ? stdout : stderr;
  destination.write(
    `Frontend hardcoded scan: ${result.ok ? "PASS" : "FAIL"}\n`,
  );
  stdout.write(`Production files scanned: ${result.fileCount}\n`);
  stdout.write(`Static HTML files scanned: 1\n`);
  stdout.write(`AST English candidates: ${result.candidateCount}\n`);
  stdout.write(`Reviewed migration debt: ${result.reviewedDebt.length}\n`);
  stdout.write(`Blocking active-wave debt: ${result.blockingDebt.length}\n`);
  for (const candidate of result.blockingDebt) {
    stderr.write(
      `${candidate.path}:${candidate.line}:${candidate.column} ` +
        `[blocking_debt:${candidate.wave}] ${JSON.stringify(candidate.value)}\n`,
    );
  }
  stdout.write(`Exact allowlist entries: ${result.allowlistEntryCount}\n`);
  stdout.write(
    `New untracked system English: ${result.newCandidates.length}\n`,
  );
  for (const candidate of result.newCandidates) {
    stderr.write(
      `${candidate.relativePath}:${candidate.line}:${candidate.column} ` +
        `[${candidate.kind}] ${JSON.stringify(candidate.value)}\n`,
    );
  }
  stdout.write(
    `Stale exact AST baseline identities: ${result.staleAstBaselineCandidates.length}\n`,
  );
  for (const candidate of result.staleAstBaselineCandidates) {
    stderr.write(
      `${candidate.path}:${candidate.line}:${candidate.column} ` +
        `[stale_ast_baseline] ${JSON.stringify(candidate.value)}\n`,
    );
  }
  stdout.write(
    `Stale reviewed candidate identities: ${result.staleReviewedCandidates.length}\n`,
  );
  for (const candidate of result.staleReviewedCandidates) {
    stderr.write(
      `${candidate.path}:${candidate.line} [stale_reviewed_candidate] ` +
        `${candidate.candidate_id}\n`,
    );
  }
}

export async function runCheck({
  repoRoot = DEFAULT_REPO_ROOT,
  writeOutput = true,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const normalizedRepoRoot = path.resolve(repoRoot);
  const allowlistPath = path.join(normalizedRepoRoot, ALLOWLIST_RELATIVE_PATH);
  const debtPath = path.join(normalizedRepoRoot, DEBT_RELATIVE_PATH);
  let ledger;
  let debtLedger;
  try {
    ledger = JSON.parse(readFileSync(allowlistPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse ${allowlistPath}: ${error.message}`);
  }
  try {
    debtLedger = JSON.parse(readFileSync(debtPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse ${debtPath}: ${error.message}`);
  }
  validateLedger(ledger);
  validateDebtLedger(debtLedger, ledger.entries);
  validateAllowlistSources(normalizedRepoRoot, ledger.entries);

  const productionFiles = listProductionFiles(normalizedRepoRoot);
  const currentCandidatesByPath = new Map();
  for (const relativePath of productionFiles) {
    const sourceText = readFileSync(
      path.join(normalizedRepoRoot, relativePath),
      "utf8",
    );
    currentCandidatesByPath.set(
      relativePath,
      scanSourceText(sourceText, { relativePath }),
    );
  }
  const currentStaticHtmlCandidates = scanCurrentStaticHtml(normalizedRepoRoot);

  const allowlistKeys = new Set(
    ledger.entries.map(
      (entry) => `${normalizePath(entry.path)}\u0000${entry.value}`,
    ),
  );
  const astBaselineEntries =
    ledger.ast_baseline_inventory ??
    captureCommittedAstBaseline(
      normalizedRepoRoot,
      ledger.baseline.commit,
      allowlistKeys,
    );
  const astReconciliation = reconcileAstBaseline(
    currentCandidatesByPath,
    astBaselineEntries,
    allowlistKeys,
  );
  const staticHtmlReconciliation = reconcileAstBaseline(
    new Map([
      [
        STATIC_HTML_RELATIVE_PATH,
        currentStaticHtmlCandidates,
      ],
    ]),
    debtLedger.static_html_baseline_inventory,
    allowlistKeys,
  );
  const reviewedDebtIdentities = new Set(
    debtLedger.entries.map((entry) => astCandidateIdentity(entry)),
  );
  const newCandidates = [
    ...astReconciliation.reviewed,
    ...astReconciliation.added,
    ...staticHtmlReconciliation.reviewed,
    ...staticHtmlReconciliation.added,
  ].filter(
    (candidate) =>
      !reviewedDebtIdentities.has(astCandidateIdentity(candidate)),
  );

  newCandidates.sort(
    (left, right) =>
      left.relativePath.localeCompare(right.relativePath) ||
      left.line - right.line ||
      left.column - right.column,
  );
  const inventoryReconciliation = reconcileCandidateInventory(
    ledger,
    currentCandidatesByPath,
  );
  currentCandidatesByPath.set(
    STATIC_HTML_RELATIVE_PATH,
    currentStaticHtmlCandidates,
  );
  const currentByIdentity = new Map(
    flattenCandidates(currentCandidatesByPath).map((candidate) => [
      astCandidateIdentity(candidate),
      candidate,
    ]),
  );
  const reviewedDebt = debtLedger.entries.filter((entry) =>
    currentByIdentity.has(astCandidateIdentity(entry)),
  );
  const staleMigrationDebt = debtLedger.entries.filter(
    (entry) => !currentByIdentity.has(astCandidateIdentity(entry)),
  );
  const blockingDebt = reviewedDebt.filter(
    ({ wave }) => wave === debtLedger.active_wave,
  );
  const staleAstBaselineCandidates = [
    ...astReconciliation.stale,
    ...staticHtmlReconciliation.stale,
  ];
  const staleReviewedCandidates = inventoryReconciliation.stale;
  const result = {
    ok:
      newCandidates.length === 0 &&
      blockingDebt.length === 0 &&
      staleMigrationDebt.length === 0 &&
      staleAstBaselineCandidates.length === 0 &&
      staleReviewedCandidates.length === 0,
    fileCount: productionFiles.length,
    candidateCount: [...currentCandidatesByPath.values()].reduce(
      (total, candidates) => total + candidates.length,
      0,
    ),
    reviewedDebt,
    blockingDebt,
    staleMigrationDebt,
    newCandidates,
    staleAstBaselineCandidates,
    staleReviewedCandidates,
    allowlistEntryCount: ledger.entries.length,
  };
  if (writeOutput) printResult(result, stdout, stderr);
  return result;
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo-root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--repo-root requires a path");
      options.repoRoot = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

async function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(
        "Usage: node scripts/i18n/check_frontend_hardcoded.mjs [--repo-root PATH]\n",
      );
      return 0;
    }
    const result = await runCheck({ repoRoot: options.repoRoot });
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Frontend hardcoded scan: FAIL\n${error.message}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  process.exitCode = await main();
}
