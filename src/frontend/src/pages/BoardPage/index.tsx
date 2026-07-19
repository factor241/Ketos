import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";

import BoardCanvas from "@/components/core/board";
import { useGetBoard } from "@/controllers/API/queries/boards";
import { useUtilityStore } from "@/stores/utilityStore";
import type { BoardRead } from "@/types/board";
import { useBoardViewport } from "./hooks/use-board-viewport";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BoardRefetch = ReturnType<typeof useGetBoard>["refetch"];

function NotFoundAlert() {
  const { t } = useTranslation();
  return <div role="alert">{t("board.notFound")}</div>;
}

function LoadedBoard({
  board,
  projectId,
  refetch,
}: {
  board: BoardRead;
  projectId: string;
  refetch: BoardRefetch;
}) {
  const { t } = useTranslation();
  const viewport = useBoardViewport({ projectId, board, refetch });
  return (
    <main className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b border-border p-4">
        <Link to={`/project/${projectId}/boards`}>{t("board.backToBoards")}</Link>
        <h1 className="text-xl font-semibold">{board.title}</h1>
      </header>
      {viewport.conflict ? (
        <p role="alert" className="p-3 text-sm text-muted-foreground">
          {t("board.conflict.serverWins")}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <BoardCanvas
          initialViewport={viewport.initialViewport}
          onMoveStart={viewport.onMoveStart}
          onMoveEnd={viewport.onMoveEnd}
          onInstanceReady={viewport.onInstanceReady}
        />
      </div>
    </main>
  );
}

export default function BoardPage() {
  const { t } = useTranslation();
  const { projectId = "", boardId = "" } = useParams<{
    projectId: string;
    boardId: string;
  }>();
  const workspaceEnabled = useUtilityStore(
    (state) => state.featureFlags.mvp_workspace === true,
  );
  const validParams = UUID_PATTERN.test(projectId) && UUID_PATTERN.test(boardId);
  const query = useGetBoard(
    { projectId, boardId },
    { enabled: workspaceEnabled && validParams },
  );

  if (!workspaceEnabled) return <Navigate to="/flows" replace />;
  if (!validParams) return <NotFoundAlert />;
  if (query.isLoading) return <div role="status">{t("board.loading")}</div>;
  if (query.isError) {
    return (
      <main>
        <div role="alert">{t("board.error")}</div>
        <button type="button" onClick={() => void query.refetch()}>
          {t("board.retry")}
        </button>
      </main>
    );
  }
  if (!query.data || query.data.project_id !== projectId) return <NotFoundAlert />;
  return <LoadedBoard board={query.data} projectId={projectId} refetch={query.refetch} />;
}
