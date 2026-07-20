import { isUUID } from "@/utils/utils";

export type AutomationEditorReturnRef = Readonly<{
  boardId: string;
  placementId: string;
}>;

const RETURN_BOARD_ID = "returnBoardId";
const RETURN_PLACEMENT_ID = "returnPlacementId";

function requireUuid(value: string, field: string): void {
  if (!isUUID(value)) throw new TypeError(`${field} must be a valid UUID`);
}

export function buildAutomationEditorUrl(
  flowId: string,
  ref: AutomationEditorReturnRef,
): string {
  if (typeof flowId !== "string" || flowId.length === 0) {
    throw new TypeError("flowId must be a nonempty string");
  }
  requireUuid(ref.boardId, "boardId");
  requireUuid(ref.placementId, "placementId");
  const path = ["", "flow", encodeURIComponent(flowId)].join("/");
  const search = new URLSearchParams({
    [RETURN_BOARD_ID]: ref.boardId,
    [RETURN_PLACEMENT_ID]: ref.placementId,
  });
  return path.concat("?", search.toString());
}

export function parseAutomationEditorReturnRef(
  search: string | URLSearchParams,
): AutomationEditorReturnRef | null {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  if (params.has("returnTo")) return null;

  const boardIds = params.getAll(RETURN_BOARD_ID);
  const placementIds = params.getAll(RETURN_PLACEMENT_ID);
  if (boardIds.length !== 1 || placementIds.length !== 1) return null;

  const [boardId] = boardIds;
  const [placementId] = placementIds;
  if (!isUUID(boardId) || !isUUID(placementId)) return null;
  return { boardId, placementId };
}
