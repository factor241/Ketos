import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import {
  useDeleteBoard,
  useGetBoards,
  usePatchBoard,
  usePostBoard,
} from "@/controllers/API/queries/boards";
import type { BoardRead } from "@/types/board";

type BoardsPageProps = { projectId?: string };

export default function BoardsPage({ projectId: projectIdProp }: BoardsPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ projectId: string }>();
  const projectId = projectIdProp ?? params.projectId ?? "";
  const boardsQuery = useGetBoards({ projectId });
  const createBoard = usePostBoard({ projectId });
  const patchBoard = usePatchBoard({ projectId });
  const deleteBoard = useDeleteBoard({ projectId });

  const [newTitle, setNewTitle] = useState("");
  const [renamingBoard, setRenamingBoard] = useState<BoardRead | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deletingBoard, setDeletingBoard] = useState<BoardRead | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const boards = boardsQuery.data ?? [];

  const openBoard = (board: BoardRead) =>
    navigate(`/project/${projectId}/board/${board.id}`);

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
            (error as { response?: { status?: number } }).response?.status === 409
          ) {
            setMutationError(t("boards.conflict"));
            void boardsQuery.refetch();
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
        <button type="button" onClick={() => void boardsQuery.refetch()}>
          {t("boards.retry")}
        </button>
      </section>
    );
  }

  return (
    <main className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("boards.title")}</h1>
      </header>

      <form className="flex max-w-xl gap-2" onSubmit={submitCreate}>
        <label className="sr-only" htmlFor="new-board-title">
          {t("boards.create.title")}
        </label>
        <input
          className="min-w-0 flex-1 rounded-md border px-3 py-2"
          id="new-board-title"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
        />
        <button
          className="rounded-md border px-4 py-2"
          type="submit"
          disabled={createBoard.isPending || !newTitle.trim()}
        >
          {t("boards.create.submit")}
        </button>
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
                <button
                  type="button"
                  aria-label={`${t("boards.rename")} ${board.title}`}
                  onClick={() => beginRename(board)}
                >
                  {t("boards.rename")}
                </button>
                <button
                  type="button"
                  aria-label={`${t("boards.delete")} ${board.title}`}
                  onClick={() => {
                    setMutationError(null);
                    setDeletingBoard(board);
                  }}
                >
                  {t("boards.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {renamingBoard ? (
        <div role="dialog" aria-modal="true" aria-label={t("boards.rename")}>
          <form onSubmit={submitRename}>
            <label htmlFor="rename-board-title">{t("boards.rename.title")}</label>
            <input
              id="rename-board-title"
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
            />
            <button type="submit" disabled={patchBoard.isPending || !renameTitle.trim()}>
              {t("boards.rename.submit")}
            </button>
            <button
              type="button"
              disabled={patchBoard.isPending}
              onClick={() => setRenamingBoard(null)}
            >
              {t("boards.rename.cancel")}
            </button>
          </form>
        </div>
      ) : null}

      {deletingBoard ? (
        <div role="dialog" aria-modal="true" aria-label={t("boards.delete.confirm")}>
          <p>{t("boards.delete.confirm")}</p>
          <button type="button" disabled={deleteBoard.isPending} onClick={submitDelete}>
            {t("boards.delete.confirmAction")}
          </button>
          <button
            type="button"
            disabled={deleteBoard.isPending}
            onClick={() => setDeletingBoard(null)}
          >
            {t("boards.delete.cancel")}
          </button>
        </div>
      ) : null}
    </main>
  );
}
