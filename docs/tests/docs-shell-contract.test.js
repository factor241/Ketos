const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const docsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(docsRoot, "..");

const read = (relativePath) =>
  fs.readFileSync(path.join(docsRoot, relativePath), "utf8");

const sha256 = (filePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const textExtensions = new Set([
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
  const staticFiles = listTextFiles(path.join(docsRoot, "static")).filter((filePath) => {
    const relativePath = path.relative(docsRoot, filePath);
    // Starter flows and llms outputs are regenerated in Task 17, not shell sources.
    return !relativePath.startsWith(`static${path.sep}files${path.sep}`) &&
      relativePath !== path.join("static", "llms.txt") &&
      relativePath !== path.join("static", "llms-full.txt");
  });
  return [...rootFiles, ...sourceDirectories.flatMap(listTextFiles), ...staticFiles];
}

test("historical upstream documentation is absent", () => {
  assert.deepEqual(JSON.parse(read("versions.json")), []);
  assert.equal(fs.existsSync(path.join(docsRoot, "versioned_docs")), false);
  assert.equal(fs.existsSync(path.join(docsRoot, "versioned_sidebars")), false);
});

test("the documentation shell and link contract are Ketos-only", () => {
  const shellFiles = shellSourceFiles();
  const config = read("docusaurus.config.js");
  const forbidden =
    /langflow(?:\.org|-ai)|docs\.langflow|twitter\.com|discord|algolia|docsearch|segment|trustarc|gtag|google-tag-manager|mendable|langflow\s+desktop/i;

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
    /(?:@|openapi\/)langflow/i,
    "the control plane must use only Ketos source and generated-artifact names",
  );
  assert.equal(fs.existsSync(path.join(docsRoot, "src/components/ChatWidget")), false);
  assert.equal(fs.existsSync(path.join(docsRoot, "src/plugins/segment")), false);
  assert.equal(fs.existsSync(path.join(docsRoot, "static/CNAME")), false);
});

test("the custom network-backed SearchBar is absent", () => {
  assert.equal(fs.existsSync(path.join(docsRoot, "src/theme/SearchBar")), false);
});

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
