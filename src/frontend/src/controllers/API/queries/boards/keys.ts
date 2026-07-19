export const boardKeys = {
  all: ["boards"] as const,
  lists: () => [...boardKeys.all, "list"] as const,
  list: (projectId: string) => [...boardKeys.lists(), projectId] as const,
  details: () => [...boardKeys.all, "detail"] as const,
  detail: (projectId: string, boardId: string) =>
    [...boardKeys.details(), projectId, boardId] as const,
};
