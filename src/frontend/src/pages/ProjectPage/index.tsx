import { useTranslation } from "react-i18next";
import { Outlet, useParams } from "react-router-dom";
import { getProjectShellRoute } from "@/components/core/folderSidebarComponent/helpers/project-shell-route";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetFolderQuery } from "@/controllers/API/queries/folders/use-get-folder";
import { CustomLink } from "@/customization/components/custom-link";

export default function ProjectPage() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const normalizedProjectId = projectId?.trim() ?? "";
  const projectRoute = getProjectShellRoute(normalizedProjectId);
  const { data, isLoading, isError } = useGetFolderQuery(
    { id: normalizedProjectId, page: 1, size: 1 },
    { enabled: Boolean(projectRoute) },
  );

  if (isLoading) {
    return (
      <main
        className="flex min-h-full flex-col gap-6 bg-background p-6 text-foreground"
        data-testid="project-page"
      >
        <div
          className="flex flex-col gap-3"
          role="status"
          aria-label={t("projectShell.loading")}
        >
          <span>{t("projectShell.loading")}</span>
          <Skeleton className="h-8 w-64" />
        </div>
      </main>
    );
  }

  if (isError || !projectRoute || !data?.folder) {
    return (
      <main
        className="min-h-full bg-background p-6 text-foreground"
        data-testid="project-page"
      >
        <p role="alert">{t("projectShell.error")}</p>
      </main>
    );
  }

  const projectName = data.folder.display_name ?? data.folder.name;

  return (
    <main
      className="flex min-h-full flex-col gap-6 bg-background p-6 text-foreground"
      data-testid="project-page"
    >
      <h1 className="text-2xl font-semibold" data-testid="project-title">
        {t("projectShell.heading", { name: projectName })}
      </h1>

      <nav
        className="flex gap-4 border-b border-border pb-3"
        aria-label={t("projectShell.navigation")}
      >
        <CustomLink data-testid="project-boards-link" to={projectRoute}>
          {t("projectShell.boards")}
        </CustomLink>
      </nav>

      <section className="flex flex-col gap-4">
        <Outlet />
      </section>
    </main>
  );
}
