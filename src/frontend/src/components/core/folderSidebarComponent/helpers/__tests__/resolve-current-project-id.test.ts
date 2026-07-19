import {
  isProjectScopedPath,
  resolveCurrentProjectId,
} from "../resolve-current-project-id";

describe("resolveCurrentProjectId", () => {
  it.each([
    ["/project/P/boards", "P"],
    ["/project/P/board/B", "P"],
    ["/workspace/project/P/boards", "P"],
  ])("uses only projectId for %s", (pathname, projectId) => {
    expect(
      resolveCurrentProjectId({
        pathname,
        projectId,
        folderId: "wrong-folder",
        myCollectionId: "wrong-collection",
      }),
    ).toBe("P");
  });

  it("does not fall back from a malformed Project path", () => {
    expect(
      resolveCurrentProjectId({
        pathname: "/project",
        projectId: "   ",
        folderId: "F",
        myCollectionId: "M",
      }),
    ).toBeNull();
  });

  it("preserves legacy folder and collection fallback", () => {
    expect(
      resolveCurrentProjectId({
        pathname: "/all/folder/F",
        folderId: "F",
        myCollectionId: "M",
      }),
    ).toBe("F");
    expect(
      resolveCurrentProjectId({ pathname: "/flows", myCollectionId: "M" }),
    ).toBe("M");
  });

  it("matches complete Project segments only", () => {
    expect(isProjectScopedPath("/project/P/boards")).toBe(true);
    expect(isProjectScopedPath("/workspace/project/P/boards")).toBe(true);
    expect(isProjectScopedPath("/workspace-preview/flows")).toBe(false);
  });
});
