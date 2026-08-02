type DuplicateRequestModule = typeof import("./check-duplicate-requests");

function loadIsolatedModule(): DuplicateRequestModule {
  let loaded: DuplicateRequestModule | undefined;
  jest.isolateModules(() => {
    loaded = require("./check-duplicate-requests") as DuplicateRequestModule;
  });
  if (!loaded) throw new Error("duplicate request module did not load");
  return loaded;
}

describe("checkDuplicateRequestAndStoreRequest", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/flow/flow-id");
    window.localStorage.clear();
    jest.resetModules();
  });

  it("keeps duplicate tracking isolated to one browser document", () => {
    const firstDocument = loadIsolatedModule();
    const secondDocument = loadIsolatedModule();
    const request = { method: "get", url: "/api/v1/projects/" };

    firstDocument.checkDuplicateRequestAndStoreRequest(request);

    expect(() =>
      secondDocument.checkDuplicateRequestAndStoreRequest(request),
    ).not.toThrow();
  });

  it("still rejects an immediate duplicate in one browser document", () => {
    const currentDocument = loadIsolatedModule();
    const request = { method: "get", url: "/api/v1/non-shared-resource" };

    currentDocument.checkDuplicateRequestAndStoreRequest(request);

    expect(() =>
      currentDocument.checkDuplicateRequestAndStoreRequest(request),
    ).toThrow("Duplicate request: /api/v1/non-shared-resource");
  });

  it("allows concurrent project bootstrap reads in one browser document", () => {
    const currentDocument = loadIsolatedModule();
    const request = { method: "get", url: "/api/v1/projects/" };

    currentDocument.checkDuplicateRequestAndStoreRequest(request);

    expect(() =>
      currentDocument.checkDuplicateRequestAndStoreRequest(request),
    ).not.toThrow();
  });
});
