import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("flow command browser authority", () => {
  it("contains only standard interrupt resolution and no direct Flow writer", () => {
    const root = join(__dirname, "..");
    const source = [
      "FlowCommandConfirmation.tsx",
      "FlowCommandPreview.tsx",
      "use-flow-command-interrupt.tsx",
    ]
      .map((name) => readFileSync(join(root, name), "utf8"))
      .join("\n");

    expect(source).toContain("useInterrupt<ApprovalDecision, true>");
    expect(source).toContain("resolve({ approved }, interruptId)");
    expect(source).not.toMatch(/api\.(post|put|patch|delete)/);
    expect(source).not.toContain("forwarded_props");
    expect(source).not.toContain("command.resume");
    expect(source).not.toContain("useFlowStore");
    expect(source).not.toContain("setNodes");
    expect(source).not.toContain("setEdges");
  });
});
