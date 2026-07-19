export const boardNoteKeys = {
  all: ["board-notes"] as const,
  project: (projectId: string) =>
    [...boardNoteKeys.all, "project", projectId] as const,
  detail: (noteId: string) => [...boardNoteKeys.all, "detail", noteId] as const,
};
