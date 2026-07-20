import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildAutomationEditorUrl,
  parseAutomationEditorReturnRef,
} from "../utils/automation-editor-route";

const FLOW_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const PLACEMENT_ID = "33333333-3333-4333-8333-333333333333";

describe("board automation route compatibility", () => {
  const routesSource = readFileSync(
    resolve(__dirname, "../routes.tsx"),
    "utf8",
  );
  const helperSource = readFileSync(
    resolve(__dirname, "../utils/automation-editor-route.ts"),
    "utf8",
  );

  it("preserves Board and Flow hierarchy without query-specific routes", () => {
    expect(
      routesSource.match(
        /path\s*=\s*["']project\/:projectId\/board\/:boardId["']/g,
      ),
    ).toHaveLength(1);
    expect(routesSource.match(/path\s*=\s*["']flow\/:id\/["']/g)).toHaveLength(
      1,
    );
    expect(
      routesSource.match(/path\s*=\s*["']folder\/:folderId\/["']/g),
    ).toHaveLength(1);
    expect(routesSource).toContain('path="view" element={<ViewPage />}');
    expect(routesSource).not.toContain("returnBoardId");
    expect(routesSource).not.toContain("returnPlacementId");
  });

  it("round-trips canonical context through the direct Flow URL", () => {
    const href = buildAutomationEditorUrl(FLOW_ID, {
      boardId: BOARD_ID,
      placementId: PLACEMENT_ID,
    });
    const url = new URL(href, "https://ketos.test");
    expect(url.pathname).toBe(`/flow/${FLOW_ID}`);
    expect(url.pathname).not.toContain("/folder/");
    expect(url.pathname).not.toContain("/view");
    expect(parseAutomationEditorReturnRef(url.search)).toEqual({
      boardId: BOARD_ID,
      placementId: PLACEMENT_ID,
    });
  });

  it.each([
    [""],
    [`?returnBoardId=${BOARD_ID}`],
    [`?returnPlacementId=${PLACEMENT_ID}`],
    [`?returnBoardId=bad&returnPlacementId=${PLACEMENT_ID}`],
    [
      `?returnBoardId=${BOARD_ID}&returnPlacementId=${PLACEMENT_ID}&returnTo=%2Funsafe`,
    ],
  ])("rejects invalid return pair %s", (search) => {
    expect(parseAutomationEditorReturnRef(search)).toBeNull();
  });

  it("keeps construction origin-independent and outside storage state", () => {
    expect(helperSource).toMatch(/\["", "flow", encodeURIComponent\(flowId\)\]/);
    expect(helperSource).toContain('path.concat("?", search.toString())');
    expect(helperSource).not.toMatch(/https?:\/\//);
    expect(helperSource).not.toMatch(/hostname|localStorage|sessionStorage/);
    expect(helperSource).not.toMatch(/location\.state|useLocation|useNavigate/);
  });
});
