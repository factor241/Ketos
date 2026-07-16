import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const watchRoots = [
  path.join(repositoryRoot, "skills", "raytsystem-watch"),
  path.join(repositoryRoot, "raytsystem", "skills", "raytsystem-watch"),
];
const requiredReferences = [
  "tool-contracts.md",
  "sources-and-modes.md",
  "security-and-retention.md",
  "output-schema.md",
  "compatibility-report.md",
];
const videoTools = [
  "video.probe",
  "video.download",
  "video.transcript",
  "video.extract_audio",
  "video.extract_frames",
  "video.ocr_frames",
  "video.inspect_frames",
  "video.summarize_timeline",
];

test("both watch procedures publish the complete reference set", async () => {
  for (const watchRoot of watchRoots) {
    const skill = await readFile(path.join(watchRoot, "SKILL.md"), "utf8");
    for (const reference of requiredReferences) {
      const referencePath = path.join(watchRoot, "references", reference);
      await access(referencePath);
      assert.ok(
        skill.includes(`references/${reference}`),
        `${path.relative(repositoryRoot, watchRoot)} must link ${reference}`,
      );
    }
  }
});

test("tool contracts document the exact governed video surface", async () => {
  for (const watchRoot of watchRoots) {
    const source = await readFile(
      path.join(watchRoot, "references", "tool-contracts.md"),
      "utf8",
    );
    assert.match(source, /\b1\.2\.0\b/);
    assert.match(source, /\bcli_dependencies\b/);
    assert.match(source, /\bdestination-bound\b/i);
    assert.match(source, /\bgeneric shell\b/i);
    for (const toolId of videoTools) {
      assert.ok(source.includes(`\`${toolId}\``), `${toolId} must be documented`);
    }
  }
});

test("compatibility remains pending with exact capability blockers", async () => {
  for (const [index, watchRoot] of watchRoots.entries()) {
    const skill = await readFile(path.join(watchRoot, "SKILL.md"), "utf8");
    const report = await readFile(
      path.join(watchRoot, "references", "compatibility-report.md"),
      "utf8",
    );
    const combined = `${skill}\n${report}`;

    if (index === 0) {
      assert.match(skill, /^test_status:\s*pending$/m);
    }
    assert.match(report, /^qualification_status:\s*pending$/m);
    assert.match(combined, /\bdefault_cli_local_executor_unavailable\b/);
    assert.match(combined, /\bdestination_bound_download_executor_unavailable\b/);
    assert.match(combined, /\bhost_visual_analysis_required\b/);
    assert.match(report, /\bffmpeg\b/i);
    assert.match(report, /\bffprobe\b/i);
    assert.match(report, /\byt-dlp\b/i);
    assert.match(report, /\btesseract\b/i);
    assert.match(report, /\beng\b/);
    assert.match(report, /\brus\b/);
  }
});
