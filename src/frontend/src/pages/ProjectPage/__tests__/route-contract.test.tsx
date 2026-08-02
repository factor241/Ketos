import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../../../routes.tsx"), "utf8");

describe("project route contract", () => {
  it("registers the nested lazy Project Boards route and board detail route exactly once", () => {
    expect(source.match(/path="project\/:projectId"/g) ?? []).toHaveLength(1);
    expect(source.match(/path="boards"/g) ?? []).toHaveLength(1);
    expect(
      source.match(/path="project\/:projectId\/board\/:boardId"/g) ?? [],
    ).toHaveLength(1);

    expect(source).toContain('lazy(() => import("./pages/ProjectPage"))');
    expect(source).toContain('lazy(() => import("./pages/BoardsPage"))');
    expect(source).toContain('lazy(() => import("./pages/BoardPage"))');
  });

  it("preserves legacy routes", () => {
    expect(source).toContain('path="all/"');
    expect(source).toContain('path="folder/:folderId"');
    expect(source).toContain('path="flow/:id/"');
    expect(source).toContain('path="settings"');
    expect(source).toContain("<LegacyFlowsRedirect />");
    expect(source).toMatch(
      /lazy\(\s*\(\)\s*=>\s*import\("\.\/components\/core\/boards\/LegacyFlowsRedirect"\),?\s*\)/,
    );
    expect(source).not.toContain('<HomePage key="flows" type="flows" />');
    expect(source).not.toContain('path="projects');
  });
});
