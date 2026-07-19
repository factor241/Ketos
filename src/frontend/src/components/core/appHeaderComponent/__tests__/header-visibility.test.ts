import { shouldShowLegacyHeaderAccountMenu } from "../header-visibility";

describe("shouldShowLegacyHeaderAccountMenu", () => {
  it.each([
    "/",
    "/flows",
    "/flows/",
    "/all",
    "/all/folder/folder-id",
    "/project/project-id/boards",
    "/components",
    "/components/folder/folder-id",
    "/mcp",
    "/mcp/folder/folder-id",
    "/assets",
    "/assets/files",
    "/assets/knowledge-bases",
    "/assets/knowledge-bases/source-id/chunks",
  ])("hides the legacy account menu on sidebar route %s", (pathname) => {
    expect(shouldShowLegacyHeaderAccountMenu(pathname, undefined, false)).toBe(
      false,
    );
  });

  it.each([
    "/workspace",
    "/workspace/flows",
    "/workspace/all/folder/folder-id",
    "/workspace/project/project-id/boards",
    "/workspace/components",
    "/workspace/mcp",
    "/workspace/assets/files",
  ])(
    "hides the legacy account menu on custom-param sidebar route %s",
    (pathname) => {
      expect(
        shouldShowLegacyHeaderAccountMenu(pathname, "workspace", false),
      ).toBe(false);
    },
  );

  it.each([
    "/flow/flow-id",
    "/settings/general",
    "/settings/language",
    "/admin",
    "/account/delete",
    "/other-protected-route",
  ])("shows the legacy account menu on non-sidebar route %s", (pathname) => {
    expect(shouldShowLegacyHeaderAccountMenu(pathname, undefined, false)).toBe(
      true,
    );
  });

  it("shows the legacy account menu whenever the flow page store is active", () => {
    expect(shouldShowLegacyHeaderAccountMenu("/flows", undefined, true)).toBe(
      true,
    );
  });

  it("does not strip a partial custom-param segment match", () => {
    expect(
      shouldShowLegacyHeaderAccountMenu(
        "/workspace-preview/flows",
        "workspace",
        false,
      ),
    ).toBe(true);
  });

  it("treats an empty pathname as the dashboard collection root", () => {
    expect(shouldShowLegacyHeaderAccountMenu("", undefined, false)).toBe(false);
  });
});
