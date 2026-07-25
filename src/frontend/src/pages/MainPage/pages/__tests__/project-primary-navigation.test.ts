import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../main-page.tsx"), "utf8");

describe("project primary navigation", () => {
  it("always sends project selection to the canonical Boards route", () => {
    expect(source).toContain("getProjectShellRoute(id)");
    expect(source).not.toContain("featureFlags.mvp_workspace");
    expect(source).not.toContain("`all/folder/${id}`");
    expect(source).not.toContain("CustomEmptyPageCommunity");
    expect(source).toContain("<Outlet />");
  });
});
