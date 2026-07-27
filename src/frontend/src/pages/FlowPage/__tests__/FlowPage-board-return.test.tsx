import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../index.tsx"), "utf8");

describe("FlowPage Board return contract", () => {
  it("loads the route id from the API instead of rejecting a fresh Flow from a stale list", () => {
    expect(source).toMatch(
      /if \(id && currentFlowId === ""[\s\S]*?await getFlowToAddToCanvas\(id\)/,
    );
    expect(source).not.toMatch(/flows\.find\(\(flow\) => flow\.id === id\)/);
  });

  it("does not auto-close a standalone chat opened for a flow without chat components", () => {
    expect(source).toContain(
      "const hadChatComponentsRef = useRef(hasChatComponents);",
    );
    expect(source).toMatch(
      /if \(isSlidingContainerOpen && hadChatComponentsRef\.current\)/,
    );
    expect(source).not.toMatch(
      /isSlidingContainerOpen && !hasChatInput && !hasChatOutput/,
    );
  });

  it("uses the shared complete dirty predicate for blocker and before-unload", () => {
    expect(source).toContain(
      'import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";',
    );
    expect(source).toContain("const changesNotSaved = useUnsavedChanges();");
    expect(source).not.toMatch(/nodes\?\.length[^\n]+>\s*0/);
  });

  it("awaits save before proceeding and keeps a rejected save blocked", () => {
    const handler = source.match(
      /const handleSave = async \(\) => \{[\s\S]*?\n {2}\};/,
    )?.[0];
    expect(handler).toBeDefined();
    expect(handler).toMatch(
      /try\s*\{[\s\S]*?await saveFlow\(\);[\s\S]*?blocker\.proceed\?\.\(\)/,
    );
    expect(handler).toMatch(
      /catch\s*\{[\s\S]*?keep the pending Board location/,
    );
    expect(handler).not.toContain("setTimeout");
    const catchBody = handler?.match(/catch\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(catchBody).not.toMatch(/proceed|reset|navigate/);
  });

  it("proceeds to the blocker location for Exit Anyway without /all fallback", () => {
    const handler = source.match(
      /const handleExit = \(\) => \{[\s\S]*?\n {2}\};/,
    )?.[0];
    expect(handler).toContain("blocker.proceed?.()");
    expect(handler).not.toContain("navigate");
    expect(handler).not.toContain('"/all"');
  });

  it("resets on Cancel or Escape and restores focus to the Return trigger", () => {
    expect(source).toMatch(
      /handleCancelBlockedNavigation[\s\S]*?blocker\.reset\?\.\(\)[\s\S]*?return-to-board[\s\S]*?focus/,
    );
    expect(source).toContain("onCancel={handleCancelBlockedNavigation}");
  });

  it("stops an active build without replacing the pending Board location", () => {
    expect(source).toMatch(
      /blocker\.state === "blocked" && isBuilding\) stopBuilding\(\)/,
    );
    expect(source).not.toMatch(
      /!changesNotSaved\)[\s\S]{0,100}blocker\.proceed/,
    );
    expect(source).toContain('t("board.automation.saveAndReturn")');
  });
});
