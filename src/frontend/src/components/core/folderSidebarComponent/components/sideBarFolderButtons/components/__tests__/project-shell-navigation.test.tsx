import { getProjectShellRoute } from "../../../../helpers/project-shell-route";

describe("getProjectShellRoute", () => {
  it("returns the canonical boards route for a UUID", () => {
    expect(getProjectShellRoute("7ab6f5b4-7c0e-4eb6-a323-51e96901fc9f")).toBe(
      "/project/7ab6f5b4-7c0e-4eb6-a323-51e96901fc9f/boards",
    );
  });

  it("trims and safely encodes project identifiers", () => {
    expect(getProjectShellRoute("  project-123  ")).toBe(
      "/project/project-123/boards",
    );
    expect(getProjectShellRoute("../settings?admin=true#details")).toBe(
      "/project/..%2Fsettings%3Fadmin%3Dtrue%23details/boards",
    );
  });

  it.each([null, undefined, "", " \t\n "])(
    "returns null for %p",
    (projectId) => {
      expect(getProjectShellRoute(projectId)).toBeNull();
    },
  );

  it("maps sidebar click and create success to one canonical URL", () => {
    const projectId = "shared-project-id";
    expect(getProjectShellRoute(projectId)).toBe(
      "/project/shared-project-id/boards",
    );
    expect(getProjectShellRoute(projectId)).toBe(
      getProjectShellRoute(projectId),
    );
  });
});
