export type ResolveCurrentProjectIdArgs = {
  pathname: string;
  projectId?: string | null;
  folderId?: string | null;
  myCollectionId?: string | null;
};

const normalize = (value?: string | null): string | null => {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : null;
};

export const isProjectScopedPath = (pathname: string): boolean =>
  pathname
    .split("/")
    .filter(Boolean)
    .some((segment) => segment === "project");

export const resolveCurrentProjectId = ({
  pathname,
  projectId,
  folderId,
  myCollectionId,
}: ResolveCurrentProjectIdArgs): string | null =>
  isProjectScopedPath(pathname)
    ? normalize(projectId)
    : (normalize(folderId) ?? normalize(myCollectionId));
