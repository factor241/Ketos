export const placementKeys = {
  all: ["placements"] as const,
  scene: (boardId: string) => [...placementKeys.all, "scene", boardId] as const,
  detail: (placementId: string) =>
    [...placementKeys.all, "detail", placementId] as const,
};
