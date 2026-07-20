export const chatThreadKeys = {
  all: ["chat-threads"] as const,
  lists: () => [...chatThreadKeys.all, "list"] as const,
  list: (projectId: string, query = "", includeArchived = false) =>
    [
      ...chatThreadKeys.lists(),
      projectId,
      query.trim(),
      includeArchived,
    ] as const,
  project: (projectId: string) =>
    [...chatThreadKeys.lists(), projectId] as const,
  details: () => [...chatThreadKeys.all, "detail"] as const,
  detail: (chatId: string) => [...chatThreadKeys.details(), chatId] as const,
};
