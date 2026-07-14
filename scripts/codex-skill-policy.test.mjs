import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.join(root, ".agents", "skills");
const expectedSkills = [
  "backend-code-review",
  "component-refactoring",
  "e2e-testing",
  "frontend-code-review",
  "frontend-query-mutation",
  "frontend-testing",
];

test("the repository exposes only the six approved Langflow skills", async () => {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const actual = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(actual, expectedSkills);
});

test("every skill has valid minimal YAML frontmatter", async () => {
  for (const skill of expectedSkills) {
    const source = await readFile(path.join(skillsRoot, skill, "SKILL.md"), "utf8");
    const match = source.match(/^---\n([\s\S]*?)\n---\n/);

    assert.ok(match, `${skill} must start with YAML frontmatter`);
    assert.match(match[1], new RegExp(`^name: ${skill}$`, "m"));
    assert.match(match[1], /^description: .+/m);
    assert.doesNotMatch(match[1], /[<>]/, `${skill} frontmatter cannot contain angle brackets`);
  }
});
