import { createLatestRequestGate } from "../latest-request-wins";

describe("createLatestRequestGate", () => {
  it("should reject an older response after a newer request is issued", () => {
    const gate = createLatestRequestGate();
    const olderRequest = gate.issue();
    const newerRequest = gate.issue();

    expect(gate.isLatest(olderRequest)).toBe(false);
    expect(gate.isLatest(newerRequest)).toBe(true);
  });

  it("should accept the first response when no newer request exists", () => {
    const gate = createLatestRequestGate();
    const request = gate.issue();

    expect(gate.isLatest(request)).toBe(true);
  });
});
