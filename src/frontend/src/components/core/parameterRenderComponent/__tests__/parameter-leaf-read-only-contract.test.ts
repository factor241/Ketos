import fs from "node:fs";
import path from "node:path";

const COMPONENTS_ROOT = path.resolve(__dirname, "../components");

function readComponent(component: string): string {
  return fs.readFileSync(
    path.join(COMPONENTS_ROOT, component, "index.tsx"),
    "utf8",
  );
}

describe("parameter leaf read-only contract", () => {
  it("prevents connection selection, navigation, and validation polling when disabled", () => {
    const source = readComponent("connectionComponent");

    expect(source).toContain("if (disabled) return;");
    expect(source).toContain("disabled={disabled}");
    expect(source).toContain("disabled={\n              disabled ||");
    expect(source).toContain("open={disabled ? false : open}");
    expect(source).toContain(
      "if (!disabled) return;\n    setOpen(false);\n    setIsPolling(false);",
    );
  });

  it("prevents MCP add, save, refresh, selection, and stale-value mutation when disabled", () => {
    const source = readComponent("mcpComponent");

    expect(source).toContain("if (!disabled) {\n        handleOnNewValue(");
    expect(source).toContain("if (disabledRef.current) return;");
    expect(source).toContain("disabled={disabled}");
    expect(source).toContain("{!disabled && showSaveButton && (");
    expect(source).toContain("open={disabled ? false : open}");
    expect(source).toContain("{!disabled && (\n            <AddMcpServerModal");
  });

  it("hides model-provider mutation affordances when disabled", () => {
    const source = readComponent("modelInputComponent");

    expect(source).toContain(
      "const showConfigureAffordance =\n    !disabled && selectedModel?.metadata?.not_enabled_locally === true;",
    );
    expect(source).toContain("{!disabled && openManageProvidersDialog && (");
  });

  it("passes disabled through to the webhook secret-key control", () => {
    const source = readComponent("webhookFieldComponent");

    expect(source).toContain(
      "<SecretKeyModalButton\n            userId={userId}\n            modalProps={modalProps}\n            disabled={disabled}",
    );
  });

  it("prevents sortable-list add, remove, selection, and reorder UX when disabled", () => {
    const source = readComponent("sortableListComponent");

    expect(source.match(/if \(disabled\) return;/g)).toHaveLength(3);
    expect(source).toContain("disabled={disabled}");
    expect(source).toContain("open={disabled ? false : open}");
    expect(source).toContain(
      "disabled={disabled}\n            list={sortableListData}",
    );
  });
});
