import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { getProjectShellRoute } from "@/components/core/folderSidebarComponent/helpers/project-shell-route";
import { Button } from "@/components/ui/button";
import { useFolderStore } from "@/stores/foldersStore";

const inventoryRoute = (projectId: string): string | null => {
  const route = getProjectShellRoute(projectId);
  return route ? `${route}?panel=automations` : null;
};

export function LegacyFlowsRedirect() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { folderId } = useParams<{ folderId?: string }>();
  const folders = useFolderStore((state) => state.folders);
  const myCollectionId = useFolderStore((state) => state.myCollectionId);
  const explicitProjectId = folderId?.trim() || "";
  const requestedId = myCollectionId?.trim() || "";
  const resolvedProject = folders.find(
    (folder) => folder.id?.trim() === requestedId,
  );
  const resolvedRoute = explicitProjectId
    ? inventoryRoute(explicitProjectId)
    : resolvedProject?.id
      ? inventoryRoute(resolvedProject.id)
      : null;

  if (resolvedRoute) {
    return <Navigate replace to={resolvedRoute} />;
  }

  return (
    <main className="flex h-full flex-col gap-4 overflow-auto p-6">
      <h1 className="text-2xl font-semibold">
        {t("board.automation.legacy.chooseProject")}
      </h1>
      <p>{t("board.automation.legacy.chooseProjectDescription")}</p>
      {folders.length === 0 ? (
        <p role="status">{t("board.automation.legacy.noProjects")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => {
            if (!folder.id) return null;
            const projectRoute = inventoryRoute(folder.id);
            const name = folder.display_name ?? folder.name;
            return (
              <li key={folder.id}>
                <Button
                  type="button"
                  className="w-full justify-start"
                  variant="outline"
                  ignoreTitleCase
                  aria-label={t("board.automation.legacy.choose", { name })}
                  onClick={() => {
                    if (projectRoute) navigate(projectRoute, { replace: true });
                  }}
                >
                  {name}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export default LegacyFlowsRedirect;
