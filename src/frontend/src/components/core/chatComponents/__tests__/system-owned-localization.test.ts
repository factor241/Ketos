import { readFileSync } from "node:fs";
import path from "node:path";

const FRONTEND_SRC = path.resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(FRONTEND_SRC, relativePath), "utf8");
}

describe("system-owned component localization", () => {
  it.each([
    ["components/core/cardsWrapComponent/index.tsx", "Drop your file here"],
    ["components/core/chatComponents/ContentBlockDisplay.tsx", '"Finished"'],
    ["components/core/chatComponents/ContentBlockDisplay.tsx", "Called tool"],
    ["components/core/chatComponents/ContentDisplay.tsx", "Reason:"],
    ["components/core/chatComponents/ContentDisplay.tsx", "Solution:"],
    ["components/core/chatComponents/ContentDisplay.tsx", "**Input:**"],
    ["components/core/chatComponents/ContentDisplay.tsx", "**Output:**"],
    ["components/core/chatComponents/ContentDisplay.tsx", "**Error:**"],
    [
      "components/core/sanitizedMarkdown/index.tsx",
      "The response was filtered by security sanitization and cannot be displayed.",
    ],
    [
      "components/core/flowToolbarComponent/components/deploy-choice-dialog/deployment-phase.tsx",
      "{deployment.type} deployment",
    ],
    [
      "components/examples/folder-selection-example.tsx",
      "Folder Selection Example",
    ],
  ])("removes %s literal %s", (relativePath, literal) => {
    expect(readSource(relativePath)).not.toContain(literal);
  });

  it("uses semantic translation keys in the shared chat surfaces", () => {
    const contentBlock = readSource(
      "components/core/chatComponents/ContentBlockDisplay.tsx",
    );
    const content = readSource(
      "components/core/chatComponents/ContentDisplay.tsx",
    );

    expect(contentBlock).toContain('t("chat.toolFinished")');
    expect(contentBlock).toContain('t("chat.calledTool")');
    expect(content).toContain('t("chat.reasonLabel")');
    expect(content).toContain('t("chat.mediaAlt"');
  });
});
