import fs from "node:fs";
import path from "node:path";

const COMPONENTS_ROOT = path.resolve(__dirname, "..");

function readComponent(component: string): string {
  return fs.readFileSync(
    path.join(COMPONENTS_ROOT, component, "index.tsx"),
    "utf8",
  );
}

describe("generic-node read-only mutation contract", () => {
  it("gates NodeStatus OAuth, run, shortcut, polling, and version writes", () => {
    const source = readComponent("NodeStatus");

    expect(source).toContain("const isCanvasReadOnly = useCanvasReadOnly();");
    expect(source.match(/if \(isCanvasReadOnly\) return;/g)).toHaveLength(6);
    expect(source).toContain("enabled: !isCanvasReadOnly");
    expect(source).toContain("{!isCanvasReadOnly && nodeAuth && showNode && (");
    expect(source).toContain("{!isCanvasReadOnly && showNode && (");
    expect(source).toContain(
      "if (!isCanvasReadOnly) return;\n    stopPolling();",
    );
  });

  it("does not unhide a connected output by mutating the node in read-only mode", () => {
    const source = readComponent("NodeOutputfield");

    expect(source).toContain("const isCanvasReadOnly = useCanvasReadOnly();");
    expect(source).toContain(
      "(value?: boolean) => {\n      if (isCanvasReadOnly) return;",
    );
    expect(source).toContain(
      "[data.id, index, isCanvasReadOnly, setNode, updateNodeInternals]",
    );
  });
});
