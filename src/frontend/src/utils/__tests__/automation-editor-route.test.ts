import {
  buildAutomationEditorUrl,
  parseAutomationEditorReturnRef,
} from "@/utils/automation-editor-route";

const flowId = "11111111-1111-4111-8111-111111111111";
const boardId = "22222222-2222-4222-8222-222222222222";
const placementId = "33333333-3333-4333-8333-333333333333";

describe("automation editor route codec", () => {
  it("builds one deterministic canonical URL", () => {
    const expected = `/flow/${flowId}?returnBoardId=${boardId}&returnPlacementId=${placementId}`;
    expect(buildAutomationEditorUrl(flowId, { boardId, placementId })).toBe(
      expected,
    );
    expect(buildAutomationEditorUrl(flowId, { boardId, placementId })).toBe(
      expected,
    );
    expect(
      parseAutomationEditorReturnRef(expected.slice(expected.indexOf("?"))),
    ).toEqual({ boardId, placementId });
  });

  it("encodes the route parameter", () => {
    expect(
      buildAutomationEditorUrl("flow/id with spaces", {
        boardId,
        placementId,
      }),
    ).toBe(
      `/flow/flow%2Fid%20with%20spaces?returnBoardId=${boardId}&returnPlacementId=${placementId}`,
    );
  });

  it.each([
    ["", boardId, placementId],
    [flowId, "bad", placementId],
    [flowId, boardId, "bad"],
  ])("fails closed for invalid builder input", (flow, board, placement) => {
    expect(() =>
      buildAutomationEditorUrl(flow, {
        boardId: board,
        placementId: placement,
      }),
    ).toThrow(TypeError);
  });

  it.each([
    [""],
    [`?returnBoardId=${boardId}`],
    [`?returnPlacementId=${placementId}`],
    [`?returnBoardId=&returnPlacementId=${placementId}`],
    [`?returnBoardId=${boardId}&returnPlacementId=`],
    [`?returnBoardId=bad&returnPlacementId=${placementId}`],
    [`?returnBoardId=${boardId}&returnPlacementId=bad`],
    [
      `?returnBoardId=${boardId}&returnBoardId=${boardId}&returnPlacementId=${placementId}`,
    ],
    [
      `?returnBoardId=${boardId}&returnPlacementId=${placementId}&returnPlacementId=${placementId}`,
    ],
    [
      `?returnBoardId=${boardId}&returnPlacementId=${placementId}&returnTo=https%3A%2F%2Fevil.example`,
    ],
  ])("rejects partial, malformed, duplicate, or unsafe input", (search) => {
    expect(parseAutomationEditorReturnRef(search)).toBeNull();
  });

  it("accepts URLSearchParams and unrelated non-redirect parameters", () => {
    const params = new URLSearchParams({
      state: "editor",
      returnBoardId: boardId,
      returnPlacementId: placementId,
    });
    expect(parseAutomationEditorReturnRef(params)).toEqual({
      boardId,
      placementId,
    });
  });
});
