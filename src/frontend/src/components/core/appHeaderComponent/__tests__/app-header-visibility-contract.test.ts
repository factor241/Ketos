import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const componentRoot = resolve(__dirname, "..");

describe("AppHeader account visibility contract", () => {
  it("keeps route visibility policy in a focused helper", () => {
    expect(existsSync(resolve(componentRoot, "header-visibility.ts"))).toBe(
      true,
    );
  });

  it("renders the legacy account separator and menu through one condition", () => {
    const appHeader = readFileSync(resolve(componentRoot, "index.tsx"), "utf8");

    expect(appHeader).toContain(
      'import { shouldShowLegacyHeaderAccountMenu } from "./header-visibility";',
    );
    expect(appHeader).toMatch(
      /const showLegacyAccountMenu = shouldShowLegacyHeaderAccountMenu\(\s*pathname,\s*customParam,\s*onFlowPage,\s*\);/,
    );
    expect(appHeader).toMatch(
      /\{showLegacyAccountMenu\s*&&\s*\([\s\S]*?<Separator[\s\S]*?<CustomAccountMenu\s*\/>[\s\S]*?\)\}/,
    );
  });

  it("leaves persistent theme ownership to DashboardWrapperPage", () => {
    const appHeader = readFileSync(resolve(componentRoot, "index.tsx"), "utf8");

    expect(appHeader).not.toContain("use-custom-theme");
    expect(appHeader).not.toMatch(/\buseTheme\(\)/);
  });

  it("preserves the logo, flow menu, alerts, and notification selector", () => {
    const appHeader = readFileSync(resolve(componentRoot, "index.tsx"), "utf8");

    expect(appHeader).toContain("<KetosBrandMark");
    expect(appHeader).toContain("<FlowMenu />");
    expect(appHeader).toContain("<AlertDropdown");
    expect(appHeader).toContain('data-testid="notification_button"');
  });
});
