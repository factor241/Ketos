const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const docsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(docsRoot, "..");
const upstreamProduct = ["lang", "flow"].join("");
const upstreamExecutor = ["l", "fx"].join("");
const upstreamEnvPrefix = ["LANG", "FLOW"].join("");

const read = (relativePath) =>
  fs.readFileSync(path.join(docsRoot, relativePath), "utf8");

const sha256 = (filePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const textExtensions = new Set([
  ".md",
  ".mdc",
  ".mdx",
  ".py",
  ".sh",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const stage7OwnedRoots = [
  path.join(repoRoot, "README.md"),
  path.join(repoRoot, "DEVELOPMENT.md"),
  path.join(repoRoot, "DESIGN.md"),
  path.join(repoRoot, "BUNDLE_API.md"),
  path.join(repoRoot, "RELEASE.md"),
  path.join(repoRoot, "AGENTS.md"),
  path.join(repoRoot, "AGENTS-example.md"),
  path.join(repoRoot, ".agents", "skills"),
  path.join(repoRoot, ".cursor"),
  path.join(repoRoot, ".vscode"),
  path.join(docsRoot, "docs"),
  path.join(docsRoot, "localization", "ru"),
  path.join(docsRoot, "openapi", "generate_openapi.py"),
];

function listTextFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTextFiles(absolutePath);
    return textExtensions.has(path.extname(entry.name).toLowerCase())
      ? [absolutePath]
      : [];
  });
}

function shellSourceFiles() {
  const rootFiles = [
    "docusaurus.config.js",
    "package.json",
    "sidebars.js",
    "versions.json",
  ].map((relativePath) => path.join(docsRoot, relativePath));
  const sourceDirectories = [
    "css",
    "src/clientModules",
    "src/components",
    "src/plugins",
    "src/theme",
  ].map((relativePath) => path.join(docsRoot, relativePath));
  const staticRoot = path.join(docsRoot, "static");
  const excludedStaticFiles = new Set(["llms-full.txt", "llms.txt"]);
  const staticFiles = listTextFiles(staticRoot).filter((filePath) => {
    const relativePath = path.relative(staticRoot, filePath);
    return (
      !relativePath.startsWith(`files${path.sep}`) &&
      !excludedStaticFiles.has(relativePath)
    );
  });
  return [
    ...rootFiles,
    ...sourceDirectories.flatMap(listTextFiles),
    ...staticFiles,
  ];
}

test("historical upstream documentation is absent", () => {
  assert.deepEqual(JSON.parse(read("versions.json")), []);
  assert.equal(fs.existsSync(path.join(docsRoot, "versioned_docs")), false);
  assert.equal(fs.existsSync(path.join(docsRoot, "versioned_sidebars")), false);
});

test("the documentation shell and link contract are Ketos-only", () => {
  const shellFiles = shellSourceFiles();
  const config = read("docusaurus.config.js");
  const forbidden = new RegExp(
    `${upstreamProduct}(?:\\.org|-ai)|docs\\.${upstreamProduct}|twitter\\.com|discord|algolia|docsearch|segment|trustarc|gtag|google-tag-manager|mendable|${upstreamProduct}\\s+desktop`,
    "i",
  );

  assert.match(config, /Ketos Documentation/);
  assert.match(config, /https:\/\/docs\.ketos\.test/);
  assert.match(config, /https:\/\/git\.ketos\.test\/ketos\/ketos/);
  for (const filePath of shellFiles) {
    const relativePath = path.relative(docsRoot, filePath);
    assert.doesNotMatch(
      `${relativePath}\n${fs.readFileSync(filePath, "utf8")}`,
      forbidden,
      `${relativePath} contains a forbidden shell integration or upstream link`,
    );
  }
  assert.doesNotMatch(
    read("docusaurus.config.js"),
    new RegExp(`(?:@|openapi/)${upstreamProduct}`, "i"),
    "the control plane must use only Ketos source and generated-artifact names",
  );
  assert.equal(fs.existsSync(path.join(docsRoot, "src/components/ChatWidget")), false);
  assert.equal(fs.existsSync(path.join(docsRoot, "src/plugins/segment")), false);
  assert.equal(fs.existsSync(path.join(docsRoot, "static/CNAME")), false);
});

test("the custom network-backed SearchBar is absent", () => {
  assert.equal(fs.existsSync(path.join(docsRoot, "src/theme/SearchBar")), false);
});

test("Stage 7 current documentation has no removed product contract", () => {
  const forbidden = new RegExp(
    `${upstreamProduct}|\\b${upstreamExecutor}\\b|${upstreamEnvPrefix}_|${upstreamExecutor.toUpperCase()}_|${upstreamProduct}-ai|docs\\.${upstreamProduct}|api\\.${upstreamProduct}|github\\.com/${upstreamProduct}-ai|fetch_openapi_spec|access_token_lf`,
    "i",
  );
  const files = stage7OwnedRoots.flatMap((entry) => {
    if (!fs.existsSync(entry)) return [];
    return fs.statSync(entry).isDirectory() ? listTextFiles(entry) : [entry];
  });
  assert.ok(files.length > 0, "Stage 7 scanner must inspect owned files");
  for (const filePath of files) {
    assert.doesNotMatch(
      `${path.relative(repoRoot, filePath)}\n${fs.readFileSync(filePath, "utf8")}`,
      forbidden,
      `${path.relative(repoRoot, filePath)} contains a removed product contract`,
    );
  }
  assert.equal(fs.existsSync(path.join(docsRoot, "openapi", "fetch_openapi_spec.py")), false);
});

test("the current manual is nine pages with executable API-key examples", () => {
  const pages = listTextFiles(path.join(docsRoot, "docs")).filter(
    (filePath) => path.extname(filePath) === ".mdx",
  );
  assert.equal(pages.length, 9, "the explicit sidebar owns exactly nine current pages");

  const authentication = read("docs/api/authentication.mdx");
  const runFlow = read("docs/api/run-flow.mdx");
  const files = read("docs/api/files.mdx");
  const docsRule = fs.readFileSync(
    path.join(repoRoot, ".cursor", "rules", "docs_development.mdc"),
    "utf8",
  );
  const design = fs.readFileSync(path.join(repoRoot, "DESIGN.md"), "utf8");
  const docsReadme = read("README.md");

  for (const source of [authentication, runFlow, files, docsRule, design, docsReadme]) {
    assert.match(source, /x-api-key/i);
    assert.doesNotMatch(source, /Authorization:\s*Bearer\s*\$?\{?KETOS_API_KEY/i);
  }
  assert.match(authentication, /Bearer[^\n]*(?:JWT|OAuth)|(?:JWT|OAuth)[^\n]*Bearer/i);
  assert.match(design, /Bearer[\s\S]{0,80}(?:JWT|OAuth)|(?:JWT|OAuth)[\s\S]{0,80}Bearer/i);
  assert.match(docsReadme, /Bearer[\s\S]{0,80}(?:JWT|OAuth)|(?:JWT|OAuth)[\s\S]{0,80}Bearer/i);
  assert.match(runFlow, /```bash[\s\S]*```python[\s\S]*```javascript/);
});

test("the local API example harness targets current pages and has a non-network syntax mode", () => {
  const script = fs.readFileSync(path.join(repoRoot, "scripts", "test-api-examples-local.sh"), "utf8");
  const makefile = fs.readFileSync(path.join(repoRoot, "Makefile"), "utf8");

  assert.match(script, /docs\/docs\/api\/run-flow\.mdx/);
  assert.match(script, /uv run ketos run/);
  assert.match(script, /KETOS_API_KEY/);
  assert.match(script, /api\/v1\/flows\//);
  assert.match(script, /export KETOS_FLOW_ID/);
  assert.match(script, /extract_fence bash/);
  assert.match(script, /extract_fence python/);
  assert.match(script, /extract_fence javascript/);
  assert.doesNotMatch(script, /api\/v1\/users\/whoami/);
  assert.doesNotMatch(
    script,
    new RegExp(`docs/docs/API-Reference|${upstreamEnvPrefix}_|uv run ${upstreamProduct}`),
  );
  assert.match(script, /if \[\[ "\$EXECUTE_MODE" != "true" \]\]; then[\s\S]*exit 0/);
  assert.match(makefile, /api_examples_local_syntax:[\s\S]*EXECUTE_MODE=false/);
});

test("obsolete localization snapshots are removed and current governance is assigned", () => {
  const obsolete = [
    "localization/ru/r0-audit-snapshot.md",
    "localization/ru/task-18-acceptance.md",
  ];
  for (const relativePath of obsolete) {
    assert.equal(fs.existsSync(path.join(docsRoot, relativePath)), false, relativePath);
  }
  for (const relativePath of [
    "localization/ru/r11-canary-evidence.template.json",
    "localization/ru/r11-zero-budget-metrics.json",
  ]) {
    assert.equal(fs.existsSync(path.join(docsRoot, relativePath)), true, relativePath);
  }
  assert.equal(fs.existsSync(path.join(docsRoot, "localization/ru/README.md")), true);
});

test("the footer attributes Ketos modifications without a blanket legal claim", () => {
  const config = read("docusaurus.config.js");
  assert.match(config, /Ketos modifications/);
  assert.doesNotMatch(config, /copyright:\s*`?©[^\n]*Ketos(?:`|,)/);
});

test("retained documentation media is canonical or explicitly local", () => {
  const allowed = new Set([
    "ketos-docs-dark.svg",
    "ketos-docs-light.svg",
    "ketos-favicon.ico",
    "ketos-favicon.svg",
    "ketos-social-1200x630.png",
  ]);
  const mediaExtensions = new Set([".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
  const retained = [path.join(docsRoot, "static", "img"), path.join(docsRoot, "static", "logos")]
    .flatMap((directory) => fs.existsSync(directory) ? listAllFiles(directory) : [])
    .filter((filePath) => mediaExtensions.has(path.extname(filePath).toLowerCase()));
  assert.deepEqual(retained.map((filePath) => path.basename(filePath)).sort(), [...allowed].sort());
});

function listAllFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listAllFiles(absolutePath) : [absolutePath];
  });
}

test("documentation brand assets are exact Task 2 outputs", () => {
  const assetCopies = [
    ["brand/assets/generated/favicon/ketos-favicon.ico", "static/img/ketos-favicon.ico"],
    ["brand/assets/generated/favicon/ketos-favicon.svg", "static/img/ketos-favicon.svg"],
    ["brand/assets/generated/svg/ketos-horizontal-color.svg", "static/img/ketos-docs-light.svg"],
    ["brand/assets/generated/svg/ketos-horizontal-white.svg", "static/img/ketos-docs-dark.svg"],
    ["brand/assets/generated/social/ketos-social-1200x630.png", "static/img/ketos-social-1200x630.png"],
  ];

  for (const [canonical, consumer] of assetCopies) {
    const canonicalPath = path.join(repoRoot, canonical);
    const consumerPath = path.join(docsRoot, consumer);
    assert.equal(fs.existsSync(consumerPath), true, `${consumer} must exist`);
    assert.equal(sha256(consumerPath), sha256(canonicalPath), `${consumer} hash`);
  }
});
