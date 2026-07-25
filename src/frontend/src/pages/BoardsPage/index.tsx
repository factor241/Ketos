import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { AutomationInventoryPanel } from "@/components/core/boards/AutomationInventoryPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useDeleteBoard,
  useGetBoards,
  usePatchBoard,
  usePostBoard,
} from "@/controllers/API/queries/boards";
import {
  useGetBoardPlacements,
  usePostPlacement,
} from "@/controllers/API/queries/placements";
import type { BoardRead, Placement } from "@/types/board";
import type { AutomationSummary } from "@/types/flow/automation";
import { buildAutomationEditorUrl } from "@/utils/automation-editor-route";

type BoardsPageProps = { projectId?: string };

export default function BoardsPage({
  projectId: projectIdProp,
}: BoardsPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ projectId: string }>();
  const projectId = projectIdProp ?? params.projectId ?? "";
  const boardsQuery = useGetBoards({ projectId });
  const reloadBoards = boardsQuery.refetch;
  const createBoard = usePostBoard({ projectId });
  const patchBoard = usePatchBoard({ projectId });
  const deleteBoard = useDeleteBoard({ projectId });

  const [newTitle, setNewTitle] = useState("");
  const [renamingBoard, setRenamingBoard] = useState<BoardRead | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deletingBoard, setDeletingBoard] = useState<BoardRead | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const boards = boardsQuery.data ?? [];
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const placementsQuery = useGetBoardPlacements(
    { boardId: selectedBoardId },
    { enabled: Boolean(selectedBoardId) },
  );
  const createPlacement = usePostPlacement({ boardId: selectedBoardId });

  useEffect(() => {
    if (boards.length === 0) {
      if (selectedBoardId) setSelectedBoardId("");
      return;
    }
    if (!boards.some((board) => board.id === selectedBoardId)) {
      setSelectedBoardId(boards[0].id);
    }
  }, [boards, selectedBoardId]);

  const openBoard = (board: BoardRead) =>
    navigate(`/project/${projectId}/board/${board.id}`);

  const placeExistingAutomation = async (summary: AutomationSummary) => {
    if (!selectedBoardId) throw new Error("A Board must be selected");
    setMutationError(null);
    try {
      const placement = await createPlacement.mutateAsync({
        targetKind: "automation",
        targetId: summary.id,
        x: 0,
        y: 0,
      });
      await placementsQuery.refetch();
      return placement;
    } catch (error) {
      setMutationError(t("board.automation.placementError"));
      throw error;
    }
  };

  const openAutomation = async (
    summary: AutomationSummary,
    existingPlacement: Placement | undefined,
  ) => {
    if (!selectedBoardId) return;
    const placement =
      existingPlacement ?? (await placeExistingAutomation(summary));
    navigate(
      buildAutomationEditorUrl(summary.id, {
        boardId: selectedBoardId,
        placementId: placement.id,
      }),
    );
  };

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title || createBoard.isPending) return;

    setMutationError(null);
    createBoard.mutate(
      { title },
      {
        onSuccess: (board) => {
          setNewTitle("");
          openBoard(board);
        },
        onError: () => setMutationError(t("boards.mutationError")),
      },
    );
  };

  const beginRename = (board: BoardRead) => {
    setMutationError(null);
    setRenamingBoard(board);
    setRenameTitle(board.title);
  };

  const submitRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = renameTitle.trim();
    if (!renamingBoard || !title || patchBoard.isPending) return;

    patchBoard.mutate(
      {
        boardId: renamingBoard.id,
        title,
        expected_revision: renamingBoard.revision,
      },
      {
        onSuccess: () => setRenamingBoard(null),
        onError: () => setMutationError(t("boards.mutationError")),
      },
    );
  };

  const submitDelete = () => {
    if (!deletingBoard || deleteBoard.isPending) return;
    const board = deletingBoard;
    setMutationError(null);
    deleteBoard.mutate(
      { boardId: board.id, expected_revision: board.revision },
      {
        onSuccess: () => setDeletingBoard(null),
        onError: (error) => {
          setDeletingBoard(null);
          if (
            typeof error === "object" &&
            error !== null &&
            "response" in error &&
            (error as { response?: { status?: number } }).response?.status ===
              409
          ) {
            setMutationError(t("boards.conflict"));
            void reloadBoards();
            return;
          }
          setMutationError(t("boards.mutationError"));
        },
      },
    );
  };

  if (boardsQuery.isLoading) {
    return <p role="status">{t("boards.loading")}</p>;
  }

  if (boardsQuery.isError) {
    return (
      <section aria-labelledby="boards-title">
        <h1 id="boards-title">{t("boards.title")}</h1>
        <p role="alert">{t("boards.loadError")}</p>
        <Button
          type="button"
          ignoreTitleCase
          onClick={() => void reloadBoards()}
        >
          {t("boards.retry")}
        </Button>
      </section>
    );
  }

  return (
    <main className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("boards.title")}</h1>
      </header>

      <form className="flex max-w-xl gap-2" onSubmit={submitCreate}>
        <Label className="sr-only" htmlFor="new-board-title">
          {t("boards.create.title")}
        </Label>
        <Input
          className="min-w-0 flex-1"
          id="new-board-title"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
        />
        <Button
          variant="outline"
          type="submit"
          ignoreTitleCase
          disabled={createBoard.isPending || !newTitle.trim()}
          loading={createBoard.isPending}
        >
          {t("boards.create.submit")}
        </Button>
      </form>

      {mutationError ? <p role="alert">{mutationError}</p> : null}

      {boards.length === 0 ? (
        <section className="rounded-lg border border-dashed p-8 text-center">
          <h2>{t("boards.empty.title")}</h2>
          <p>{t("boards.empty.description")}</p>
        </section>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <li className="rounded-lg border p-4" key={board.id}>
              <a
                className="font-medium"
                href={`/project/${projectId}/board/${board.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  openBoard(board);
                }}
              >
                {board.title}
              </a>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  ignoreTitleCase
                  aria-label={t("boards.renameLabel", { title: board.title })}
                  onClick={() => beginRename(board)}
                >
                  {t("boards.rename")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  ignoreTitleCase
                  aria-label={t("boards.deleteLabel", { title: board.title })}
                  onClick={() => {
                    setMutationError(null);
                    setDeletingBoard(board);
                  }}
                >
                  {t("boards.delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-lg border border-border p-4">
        {boards.length > 0 ? (
          <div className="mb-4 flex max-w-md flex-col gap-2">
            <Label htmlFor="automation-inventory-board">
              {t("board.automation.inventory.board")}
            </Label>
            <select
              id="automation-inventory-board"
              className="rounded-md border border-input bg-background px-3 py-2 text-foreground"
              value={selectedBoardId}
              onChange={(event) => setSelectedBoardId(event.target.value)}
            >
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.title}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {placementsQuery.isError ? (
          <p role="alert">{t("board.automation.inventory.placementsError")}</p>
        ) : null}
        <AutomationInventoryPanel
          projectId={projectId}
          placements={placementsQuery.data ?? []}
          disabled={
            !selectedBoardId ||
            placementsQuery.isLoading ||
            createPlacement.isPending
          }
          onPlace={placeExistingAutomation}
          onOpen={openAutomation}
        />
      </section>

      <Dialog
        open={renamingBoard !== null}
        onOpenChange={(open) => {
          if (!open && !patchBoard.isPending) setRenamingBoard(null);
        }}
      >
        <DialogContent hideCloseButton>
          <DialogTitle>{t("boards.rename")}</DialogTitle>
          <DialogDescription>{t("boards.rename.title")}</DialogDescription>
          <form onSubmit={submitRename}>
            <Label htmlFor="rename-board-title">
              {t("boards.rename.title")}
            </Label>
            <Input
              id="rename-board-title"
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
            />
            <DialogFooter className="mt-4">
              <Button
                type="submit"
                ignoreTitleCase
                disabled={patchBoard.isPending || !renameTitle.trim()}
                loading={patchBoard.isPending}
              >
                {t("boards.rename.submit")}
              </Button>
              <Button
                type="button"
                variant="outline"
                ignoreTitleCase
                disabled={patchBoard.isPending}
                onClick={() => setRenamingBoard(null)}
              >
                {t("boards.rename.cancel")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deletingBoard !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBoard.isPending) setDeletingBoard(null);
        }}
      >
        <DialogContent hideCloseButton>
          <DialogTitle>{t("boards.delete.confirm")}</DialogTitle>
          <DialogDescription>{deletingBoard?.title ?? ""}</DialogDescription>
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              ignoreTitleCase
              disabled={deleteBoard.isPending}
              loading={deleteBoard.isPending}
              onClick={submitDelete}
            >
              {t("boards.delete.confirmAction")}
            </Button>
            <Button
              type="button"
              variant="outline"
              ignoreTitleCase
              disabled={deleteBoard.isPending}
              onClick={() => setDeletingBoard(null)}
            >
              {t("boards.delete.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
