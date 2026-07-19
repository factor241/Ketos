import fs from "fs";
import path from "path";

describe("Stage 01 CopilotKit proxy boundary", () => {
  it("uses the fixed loopback runtime without rewriting the browser Host", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "vite.config.mts"),
      "utf8",
    );
    const proxyBlock = source.match(
      /"\/api\/copilotkit":\s*\{(?<body>[\s\S]*?)\n\s*\},/,
    )?.groups?.body;

    expect(proxyBlock).toBeDefined();
    expect(source).toContain(
      'const COPILOT_RUNTIME_TARGET = "http://127.0.0.1:8788";',
    );
    expect(proxyBlock).toContain("target: COPILOT_RUNTIME_TARGET");
    expect(proxyBlock).toContain("changeOrigin: false");
    expect(proxyBlock).toContain("secure: false");
    expect(proxyBlock).toContain("ws: false");
  });
});
