import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Stage 01 PostCSS boundary", () => {
  it("should bypass Tailwind v3 only for the pinned CopilotKit v2 compiled stylesheet", () => {
    const source = readFileSync(
      resolve(__dirname, "../../postcss.config.js"),
      "utf8",
    );

    expect(source).toContain(
      'sourcePath.endsWith(\n        "/node_modules/@copilotkit/react-core/dist/v2/index.css",',
    );
    expect(source).toContain("await tailwindTransform(root, result)");
    expect(source).not.toMatch(/includes\([^)]*copilotkit/i);
  });
});
