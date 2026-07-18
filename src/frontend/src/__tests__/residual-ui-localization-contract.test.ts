import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import en from "../locales/en.json";
import ru from "../locales/ru.json";

const frontendRoot = resolve(__dirname, "../..");

function source(relativePath: string): string {
  return readFileSync(resolve(frontendRoot, relativePath), "utf8");
}

describe("residual modal, page, and shared UI localization", () => {
  it.each([
    [
      "src/modals/baseModal/index.tsx",
      ">\n            Close\n          </Button>",
    ],
    ["src/modals/stepperModal/components/ProgressIndicator.tsx", " completed"],
    [
      "src/pages/FlowPage/components/InspectionPanel/components/InspectionPanelHeader.tsx",
      "docs is not available at the moment.",
    ],
    [
      "src/pages/MainPage/pages/deploymentsPage/components/providers-content.tsx",
      'environment "${providerDelete.target?.name}"',
    ],
    [
      "src/pages/MainPage/components/header/index.tsx",
      'description={"flow" + (selectedFlows.length > 1 ? "s" : "")}',
    ],
    ["src/shared/components/delete-confirmation-modal.tsx", 'variable "'],
    [
      "src/shared/components/textOutputView/index.tsx",
      "This output has been truncated due to its size.",
    ],
  ])("removes hardcoded system English from %s", (path, excerpt) => {
    expect(source(path)).not.toContain(excerpt);
  });

  it("keeps new semantic keys synchronized across every locale catalog", () => {
    const catalogs = [en, ru] as Array<Record<string, string>>;
    const keys = [
      "stepper.progressCompleted",
      "deleteModal.environmentNamed",
      "deleteModal.variableNamed",
      "deleteModal.noteMessageHistoryMany",
      "common.outputTruncated",
    ];

    for (const catalog of catalogs) {
      for (const key of keys) {
        expect(catalog[key]).toEqual(expect.any(String));
        expect(catalog[key].trim()).not.toBe("");
      }
    }
  });
});
