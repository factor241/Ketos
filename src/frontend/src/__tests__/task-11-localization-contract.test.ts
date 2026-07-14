import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const frontendRoot = resolve(__dirname, "../..");

function source(relativePath: string): string {
  return readFileSync(resolve(frontendRoot, relativePath), "utf8");
}

const confirmedTask11Debt: Record<string, string[]> = {
  "src/CustomNodes/GenericNode/components/HandleTooltipComponent/index.tsx": [
    ">Connect<",
    ">Drag<",
    ">Click<",
    "Can't connect to the same node",
    "to connect compatible",
    "to filter compatible",
  ],
  "src/CustomNodes/GenericNode/components/NodeLegacyComponent/index.tsx": [
    ">Legacy<",
    ">Dismiss<",
    'Use{" "}',
    "No direct replacement.",
  ],
  "src/components/core/parameterRenderComponent/components/inputComponent/index.tsx":
    ['placeholder = "Type something..."'],
  "src/components/core/parameterRenderComponent/components/modelInputComponent/components/ModelTrigger.tsx":
    ['placeholder = "Setup Provider"'],
  "src/components/core/parameterRenderComponent/components/searchBarComponent/index.tsx":
    ['placeholder = "Search tools..."'],
  "src/components/core/parameterRenderComponent/components/sliderComponent/index.tsx":
    [
      'label: "Precise"',
      'label: "Balanced"',
      'label: "Creative"',
      'label: "Wild"',
    ],
  "src/pages/FlowPage/components/flowSidebarComponent/components/FlowVersionSidebar/utils.ts":
    ['return "Unknown date"'],
};

describe("Task 11 frontend localization contract", () => {
  it.each(Object.entries(confirmedTask11Debt))(
    "removes confirmed semantic-key debt from %s",
    (relativePath, forbiddenFragments) => {
      const contents = source(relativePath);
      for (const fragment of forbiddenFragments) {
        expect(contents).not.toContain(fragment);
      }
    },
  );

  it("localizes additional canvas and editor presentation chrome found by the Wave C audit", () => {
    const selectionMenu = source(
      "src/pages/FlowPage/components/SelectionMenuComponent/index.tsx",
    );
    expect(selectionMenu).not.toMatch(/>\s*Group\s*</);

    const restoreVersion = source(
      "src/pages/FlowPage/components/PageComponent/components/RestoreVersionButton.tsx",
    );
    for (const fragment of [
      "Replace the current draft with",
      "Save current draft before restoring",
      "This will replace your current canvas.",
    ]) {
      expect(restoreVersion).not.toContain(fragment);
    }

    expect(
      source("src/CustomNodes/GenericNode/components/NodeName/index.tsx"),
    ).not.toMatch(/>\s*Legacy\s*</);
    expect(
      source(
        "src/CustomNodes/GenericNode/components/NodeOutputfield/index.tsx",
      ),
    ).not.toMatch(/>\s*Looping\s*</);
    expect(
      source(
        "src/components/core/parameterRenderComponent/components/modelInputComponent/components/ModelList.tsx",
      ),
    ).not.toMatch(/>\s*Deprecated\s*</);
    expect(source("src/modals/textModal/index.tsx")).not.toMatch(
      />\s*Save\s*</,
    );

    const listSelection = source(
      "src/CustomNodes/GenericNode/components/ListSelectionComponent/index.tsx",
    );
    expect(listSelection).not.toContain("No items match your search");
    expect(
      source(
        "src/CustomNodes/GenericNode/components/ListSelectionComponent/ListItem.tsx",
      ),
    ).not.toMatch(/>\s*Select\s*</);
    expect(
      source(
        "src/CustomNodes/GenericNode/components/NodeDialogComponent/index.tsx",
      ),
    ).not.toMatch(/>\s*Cancel\s*</);
    expect(
      source("src/CustomNodes/GenericNode/components/NodeStatus/index.tsx"),
    ).not.toContain('nodeAuth.auth_tooltip || "Connect"');

    const outputView = source(
      "src/CustomNodes/GenericNode/components/outputModal/components/switchOutputView/index.tsx",
    );
    expect(outputView).not.toContain("`Tool ${index + 1}`");
    expect(outputView).not.toContain(
      "Use the playground to interact with components that stream data",
    );
    expect(
      source(
        "src/CustomNodes/GenericNode/components/outputModal/components/switchOutputView/components/index.tsx",
      ),
    ).not.toContain('placeholder={"Empty"}');

    expect(
      source(
        "src/components/core/parameterRenderComponent/components/multiselectComponent/index.tsx",
      ),
    ).not.toContain("No parameters are available for display.");
    expect(
      source(
        "src/components/core/parameterRenderComponent/components/inputGlobalComponent/index.tsx",
      ),
    ).not.toContain("Credential variables can only be used in secret fields");

    const sidebarItem = source(
      "src/pages/FlowPage/components/flowSidebarComponent/components/sidebarDraggableComponent.tsx",
    );
    expect(sidebarItem).not.toMatch(/>\s*Beta\s*</);
    expect(sidebarItem).not.toMatch(/>\s*Legacy\s*</);

    const dictModal = source("src/modals/dictAreaModal/index.tsx");
    expect(dictModal).not.toContain("Customize your dictionary");
    expect(dictModal).not.toContain("objects &#123; &#125;");

    const pageComponent = source(
      "src/pages/FlowPage/components/PageComponent/index.tsx",
    );
    for (const fragment of [
      "Error applying agent changes to canvas",
      "Network error reloading flow after agent changes",
      "`Agent ${parts.join",
    ]) {
      expect(pageComponent).not.toContain(fragment);
    }

    const bundleActions = source(
      "src/pages/FlowPage/components/flowSidebarComponent/components/bundleHeaderActions.tsx",
    );
    expect(bundleActions).not.toContain("defaultValue:");
    expect(bundleActions).not.toContain('message || "Unknown error"');

    expect(
      source(
        "src/pages/FlowPage/components/flowSidebarComponent/components/McpSidebarGroup.tsx",
      ),
    ).not.toContain('description={"MCP Server"}');
    expect(
      source(
        "src/pages/FlowPage/components/flowSidebarComponent/components/sidebarFilterComponent.tsx",
      ),
    ).not.toContain('const plural = tooltips.length > 1 ? "s" : ""');
  });

  it("preserves stable canvas protocol identifiers while translating labels", () => {
    const handleTooltip = source(
      "src/CustomNodes/GenericNode/components/HandleTooltipComponent/index.tsx",
    );
    expect(handleTooltip).toContain(
      'data-testid={`${isInput ? "input" : "output"}-tooltip-${convertTestName(word)}`}',
    );

    const slider = source(
      "src/components/core/parameterRenderComponent/components/sliderComponent/index.tsx",
    );
    for (const id of [0, 1, 2, 3]) {
      expect(slider).toContain(`id: ${id}`);
    }

    const outputComponent = source(
      "src/CustomNodes/GenericNode/components/OutputComponent/index.tsx",
    );
    expect(outputComponent).toContain("value={output.name}");
    expect(outputComponent).toContain("key={output.name}");
  });
});
