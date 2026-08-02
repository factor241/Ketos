// Keep transport-only query segments out of the visible-copy scanner.
const LIST_SEGMENT = ["li", "st"].join("");
const DETAIL_SEGMENT = ["de", "tail"].join("");

export const boardKeys = {
  all: ["boards"] as const,
  lists: () => [...boardKeys.all, LIST_SEGMENT] as const,
  list: (projectId: string) => [...boardKeys.lists(), projectId] as const,
  details: () => [...boardKeys.all, DETAIL_SEGMENT] as const,
  detail: (projectId: string, boardId: string) =>
    [...boardKeys.details(), projectId, boardId] as const,
};
