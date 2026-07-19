import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../routes.tsx"), "utf8");

describe("project route contract", () => {
  it("registers the lazy Project Boards route exactly once", () => {
    expect(
      source.match(/path="project\/:projectId\/boards"/g) ?? [],
    ).toHaveLength(1);
    expect(source).toContain('lazy(() => import("./pages/ProjectPage"))');
  });

  it("preserves legacy routes", () => {
    expect(source).toContain('path="all/"');
    expect(source).toContain('path="folder/:folderId"');
    expect(source).toContain('path="flow/:id/"');
    expect(source).toContain('path="settings"');
    expect(source).not.toContain('path="projects');
  });
});
