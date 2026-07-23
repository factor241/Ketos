import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(__dirname, relativePath), "utf8");

const compact = (source: string) => source.replace(/\s+/g, " ");

const collectImportSpecifiers = (source: string) => {
  const specifiers: string[] = [];
  const staticImport =
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(staticImport)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(dynamicImport)) {
    specifiers.push(match[1]);
  }

  return specifiers;
};

describe("Stage 10 board-to-flow editor source contract", () => {
  it("opens the canonical Flow route for the same flow id and preserves URL-backed return ids", () => {
    const openEditorSource = compact(
      readSource("../../BoardPage/hooks/use-open-automation-editor.ts"),
    );
    const routeSource = readSource("../../../utils/automation-editor-route.ts");
    const flowPageSource = compact(readSource("../index.tsx"));

    expect(openEditorSource).toMatch(
      /buildAutomationEditorUrl\(\s*flowId\s*,\s*\{\s*boardId\s*,\s*placementId\s*\}\s*\)/,
    );
    expect(routeSource).toMatch(/\/flow\/\$\{flowId\}/);
    expect(routeSource).toMatch(/\breturnBoardId\b/);
    expect(routeSource).toMatch(/\breturnPlacementId\b/);
    expect(routeSource).toMatch(/\bparseAutomationEditorReturnRef\b/);
    expect(flowPageSource).toMatch(/\buseBoardReturnContext\b/);
    expect(flowPageSource).toMatch(
      /useBoardReturnContext\(\s*\{[^}]*\bflowId\b[^}]*\}\s*\)/,
    );
    expect(openEditorSource).not.toMatch(/\/flow\/new\b/);
  });

  it.each([
    "../../../components/core/board/placements/AutomationPlacement.tsx",
    "../../../components/core/board/placements/AutomationPreview.tsx",
  ])(
    "%s remains a launcher or preview and does not embed or copy the Flow editor",
    (relativePath) => {
      const imports = collectImportSpecifiers(readSource(relativePath));
      const forbiddenImports = imports.filter((specifier) =>
        /(?:pages\/FlowPage|flowStore|reactflow|@xyflow\/react)/i.test(
          specifier,
        ),
      );

      expect(forbiddenImports).toEqual([]);
    },
  );
});
