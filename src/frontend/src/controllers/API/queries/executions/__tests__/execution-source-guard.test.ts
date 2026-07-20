import fs from "node:fs";
import path from "node:path";

const sourceFiles = [
  "types.ts",
  "execution-query-keys.ts",
  "use-post-automation-run.ts",
  "use-get-automation-run.ts",
  "use-get-automation-runs.ts",
  "use-post-cancel-automation-run.ts",
  "index.ts",
];

const hookFiles = sourceFiles.filter((file) => file.startsWith("use-"));

describe("board execution transport source guard", () => {
  it.each(sourceFiles)("keeps %s on the shared session transport", (file) => {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");

    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/x-api-key/i);
    expect(source).not.toMatch(/from\s+["']axios["']/);
    expect(source).not.toMatch(/axios\.create\s*\(/);
    expect(source).not.toMatch(/\bauthorization\b/i);
    expect(source).not.toMatch(/crypto\.randomUUID|randomUUID|uuidv4|nanoid/);
  });

  it.each(hookFiles)(
    "routes %s through the shared request processor",
    (file) => {
      const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");

      expect(source).toContain("UseRequestProcessor");
      expect(source).toContain("../../api");
      expect(source).toContain('getURL("BOARDS")');
    },
  );
});
