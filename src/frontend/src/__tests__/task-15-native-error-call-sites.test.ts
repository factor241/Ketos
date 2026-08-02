import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const frontendRoot = resolve(__dirname, "../..");

function source(relativePath: string): string {
  return readFileSync(resolve(frontendRoot, relativePath), "utf8");
}

const nativeErrorCallSites = [
  "src/hooks/flows/use-save-flow.ts",
  "src/hooks/flows/use-restore-version.ts",
  "src/CustomNodes/helpers/mutate-template.ts",
  "src/components/core/parameterRenderComponent/components/inputFileComponent/index.tsx",
  "src/modals/IOModal/components/IOFieldView/components/file-input.tsx",
  "src/hooks/files/use-upload-file.ts",
];

describe("Task 15 native frontend error contract", () => {
  it.each(nativeErrorCallSites)(
    "uses the shared code-first localized resolver in %s",
    (relativePath) => {
      const contents = source(relativePath);
      expect(contents).toContain("getLocalizedApiErrorMessage");
      expect(contents).not.toMatch(/response\??\.data\??\.detail/);
    },
  );
});
