import { createPseudoCatalog, pseudoLocalize } from "./pseudo-locale";

describe("pseudo locale", () => {
  it("expands ordinary UI copy by roughly 30–40 percent", () => {
    const source = "Create a new workflow and configure its settings";
    const target = pseudoLocalize(source);

    expect(target).not.toBe(source);
    expect(target.length / source.length).toBeGreaterThanOrEqual(1.3);
    expect(target.length / source.length).toBeLessThanOrEqual(1.5);
  });

  it("preserves interpolation, tags, code, URLs, and protected tokens byte-identically", () => {
    const source =
      "Langflow API: {{count}} <0>items</0> at {path}; `flow_id`; https://example.com; MCP JSON WebSocket";
    const target = pseudoLocalize(source);

    for (const token of [
      "Langflow",
      "API",
      "{{count}}",
      "<0>",
      "</0>",
      "{path}",
      "`flow_id`",
      "https://example.com",
      "MCP",
      "JSON",
      "WebSocket",
    ]) {
      expect(target).toContain(token);
    }
  });

  it("keeps the exact catalog keyset and non-empty values", () => {
    const source = {
      "common.create": "Create",
      "common.cancel": "Cancel {{name}}",
    };

    const target = createPseudoCatalog(source);

    expect(Object.keys(target)).toEqual(Object.keys(source));
    expect(Object.values(target).every((value) => value.length > 0)).toBe(true);
  });
});
