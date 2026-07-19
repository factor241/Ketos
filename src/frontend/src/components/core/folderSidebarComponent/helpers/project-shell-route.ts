/** Return the canonical Boards route for a non-empty Project identifier. */
export function getProjectShellRoute(
  projectId: string | null | undefined,
): string | null {
  const normalizedProjectId = projectId?.trim();

  return normalizedProjectId
    ? `/project/${encodeURIComponent(normalizedProjectId)}/boards`
    : null;
}
