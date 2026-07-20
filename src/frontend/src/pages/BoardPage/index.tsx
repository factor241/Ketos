import type {
  NodeProps,
  NodeTypes,
  OnNodeDrag,
  ReactFlowInstance,
} from "@xyflow/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";

import BoardCanvas from "@/components/core/board";
import { BoardNoteDeleteDialog } from "@/components/core/board/BoardNoteDeleteDialog";
import { BoardNotePlacement } from "@/components/core/board/placements/BoardNotePlacement";
import { Button } from "@/components/ui/button";
import { useGetBoard } from "@/controllers/API/queries/boards";
import { useUtilityStore } from "@/stores/utilityStore";
import type {
  BoardNote,
  BoardRead,
  PlacementDisplayState,
} from "@/types/board";
import { useBoardScene } from "./hooks/use-board-scene";
import { useBoardViewport } from "./hooks/use-board-viewport";
import { useNotePlacementActions } from "./hooks/use-note-placement-actions";
import { usePlacementPersistence } from "./hooks/use-placement-persistence";
import type { BoardSceneNode } from "./utils/placement-to-node";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BoardRefetch = ReturnType<typeof useGetBoard>["refetch"];

type BoardNoteRuntime = {
  drafts: Record<string, string>;
  setDraft: (noteId: string, draft: string) => void;
  save: (note: BoardNote, draft: string) => void;
  close: (node: BoardSceneNode) => void;
  requestDelete: (note: BoardNote) => void;
  setDisplayState: (node: BoardSceneNode, state: PlacementDisplayState) => void;
  resize: (
    node: BoardSceneNode,
    size: { width: number; height: number },
  ) => void;
  moveBy: (node: BoardSceneNode, delta: { x: number; y: number }) => void;
  resizeBy: (
    node: BoardSceneNode,
    delta: { width: number; height: number },
  ) => void;
};

const BoardNoteRuntimeContext = createContext<BoardNoteRuntime | null>(null);

function BoardNoteNode({ data, selected }: NodeProps<BoardSceneNode>) {
  const runtime = useContext(BoardNoteRuntimeContext);
  if (!runtime) return null;
  const node = {
    id: data.placementId,
    type: "boardNote" as const,
    position: { x: data.placement.x, y: data.placement.y },
    data,
  } as BoardSceneNode;
  const draft = runtime.drafts[data.note.id] ?? data.note.content;
  return (
    <BoardNotePlacement
      note={data.note}
      placement={data.placement}
      selected={selected}
      draft={draft}
      onDraftChange={(value) => runtime.setDraft(data.note.id, value)}
      onSave={() => runtime.save(data.note, draft)}
      onDisplayStateChange={(state) => runtime.setDisplayState(node, state)}
      onClose={() => runtime.close(node)}
      onDeleteEntity={() => runtime.requestDelete(data.note)}
      onResizeEnd={(size) => runtime.resize(node, size)}
      onKeyboardMove={(delta) => runtime.moveBy(node, delta)}
      onKeyboardResize={(delta) => runtime.resizeBy(node, delta)}
    />
  );
}

const BOARD_NODE_TYPES: NodeTypes = { boardNote: BoardNoteNode };

function NotFoundAlert() {
  const { t } = useTranslation();
  return <div role="alert">{t("board.notFound")}</div>;
}

function LoadedBoard({
  board,
  projectId,
  refresh,
}: {
  board: BoardRead;
  projectId: string;
  refresh: BoardRefetch;
}) {
  const { t } = useTranslation();
  const viewport = useBoardViewport({ projectId, board, refresh });
  const scene = useBoardScene({ projectId, boardId: board.id });
  const [placementConflict, setPlacementConflict] = useState(false);
  const persistence = usePlacementPersistence({
    boardId: board.id,
    onConflict: () => setPlacementConflict(true),
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [deletingNote, setDeletingNote] = useState<BoardNote | null>(null);
  const [noteConflict, setNoteConflict] = useState(false);
  const addNoteRef = useRef<HTMLButtonElement>(null);
  const canvasElementRef = useRef<HTMLDivElement>(null);
  const deleteTriggerRef = useRef<HTMLElement>(null);
  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const actions = useNotePlacementActions({
    projectId,
    boardId: board.id,
    onConflict: (conflict) => {
      setDrafts((current) => ({
        ...current,
        [conflict.noteId]: conflict.unsavedDraft,
      }));
      setNoteConflict(true);
    },
  });
  const center = useCallback(() => {
    const bounds = canvasElementRef.current?.getBoundingClientRect();
    const point = bounds
      ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return instanceRef.current?.screenToFlowPosition(point) ?? { x: 0, y: 0 };
  }, []);
  const onInstanceReady = useCallback(
    (instance: ReactFlowInstance, canvasElement: HTMLDivElement) => {
      instanceRef.current = instance;
      canvasElementRef.current = canvasElement;
      viewport.onInstanceReady(instance);
    },
    [viewport],
  );
  const runtime = useMemo<BoardNoteRuntime>(
    () => ({
      drafts,
      setDraft: (noteId, draft) =>
        setDrafts((current) => ({ ...current, [noteId]: draft })),
      save: (note, draft) => {
        setNoteConflict(false);
        actions.save(note, draft);
      },
      close: (node) => {
        persistence.close(node.data.placement);
        requestAnimationFrame(() => addNoteRef.current?.focus());
      },
      requestDelete: (note) => {
        deleteTriggerRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setDeletingNote(note);
      },
      setDisplayState: (node, state) =>
        persistence.setDisplayState(node.data.placement, state),
      resize: (node, size) => persistence.resize(node.data.placement, size),
      moveBy: (node, delta) => {
        const current = instanceRef.current?.getNode(node.id);
        const position = {
          x: (current?.position.x ?? node.data.placement.x) + delta.x,
          y: (current?.position.y ?? node.data.placement.y) + delta.y,
        };
        instanceRef.current?.updateNode(node.id, { position });
        persistence.queueMove(node.data.placement, position);
      },
      resizeBy: (node, delta) => {
        const current = instanceRef.current?.getNode(node.id);
        const currentPlacement =
          (current?.data as BoardSceneNode["data"] | undefined)?.placement ??
          node.data.placement;
        const size = {
          width: Math.min(
            Math.max(currentPlacement.width + delta.width, 240),
            1600,
          ),
          height: Math.min(
            Math.max(currentPlacement.height + delta.height, 160),
            1200,
          ),
        };
        instanceRef.current?.updateNode(node.id, {
          style: { ...current?.style, ...size },
          data: {
            ...node.data,
            placement: { ...currentPlacement, ...size },
          },
        });
        persistence.queueResize(node.data.placement, size);
      },
    }),
    [actions, drafts, persistence],
  );
  const onNodeDragStop: OnNodeDrag<BoardSceneNode> = useCallback(
    (_event, node) => persistence.move(node.data.placement, node.position),
    [persistence],
  );
  const placedNoteIds = new Set(
    scene.placements
      .filter((placement) => placement.targetKind === "note")
      .map((placement) => placement.targetId),
  );
  const unplacedNotes = scene.notes.filter(
    (note) => !placedNoteIds.has(note.id),
  );
  return (
    <BoardNoteRuntimeContext.Provider value={runtime}>
      <main className="flex h-full flex-col bg-background text-foreground">
        <header className="flex items-center gap-4 border-b border-border p-4">
          <Link to={`/project/${projectId}/boards`}>
            {t("board.backToBoards")}
          </Link>
          <h1 className="text-xl font-semibold">{board.title}</h1>
          <Button
            ref={addNoteRef}
            type="button"
            size="sm"
            className="ml-auto"
            disabled={actions.isPending}
            onClick={() => actions.createAt(center())}
          >
            {t("board.note.add")}
          </Button>
        </header>
        {viewport.conflict || placementConflict ? (
          <p role="alert" className="p-3 text-sm text-muted-foreground">
            {t("board.conflict.serverWins")}
          </p>
        ) : null}
        {noteConflict ? (
          <p role="alert" className="p-3 text-sm text-destructive">
            {t("board.note.conflictDraftPreserved")}
          </p>
        ) : null}
        {scene.isError ? (
          <p role="alert" className="p-3 text-sm text-destructive">
            {t("board.scene.error")}
          </p>
        ) : null}
        {unplacedNotes.length ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <span className="text-sm text-muted-foreground">
              {t("board.note.unplaced")}
            </span>
            {unplacedNotes.map((note) => (
              <Button
                key={note.id}
                type="button"
                size="xs"
                variant="outline"
                onClick={() => actions.replace(note, center())}
              >
                {t("board.note.replace")}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <BoardCanvas
            initialViewport={viewport.initialViewport}
            nodes={scene.nodes}
            nodeTypes={BOARD_NODE_TYPES}
            onNodeDragStop={onNodeDragStop}
            onMoveStart={viewport.onMoveStart}
            onMoveEnd={viewport.onMoveEnd}
            onInstanceReady={onInstanceReady}
          />
        </div>
        <BoardNoteDeleteDialog
          open={deletingNote !== null}
          title={t("board.note.deleteConfirmTitle")}
          description={t("board.note.deleteConfirmDescription")}
          cancelLabel={t("board.note.deleteCancel")}
          confirmLabel={t("board.note.deleteConfirm")}
          onCancel={() => {
            setDeletingNote(null);
            requestAnimationFrame(() => deleteTriggerRef.current?.focus());
          }}
          onConfirm={() => {
            if (deletingNote) actions.deleteEntity(deletingNote);
            setDeletingNote(null);
            requestAnimationFrame(() => addNoteRef.current?.focus());
          }}
        />
      </main>
    </BoardNoteRuntimeContext.Provider>
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
  const validParams =
    UUID_PATTERN.test(projectId) && UUID_PATTERN.test(boardId);
  const query = useGetBoard(
    { projectId, boardId },
    { enabled: workspaceEnabled && validParams },
  );
  const reloadBoard = query.refetch;

  if (!workspaceEnabled) return <Navigate to="/flows" replace />;
  if (!validParams) return <NotFoundAlert />;
  if (query.isLoading) return <div role="status">{t("board.loading")}</div>;
  if (query.isError) {
    return (
      <main>
        <div role="alert">{t("board.error")}</div>
        <button type="button" onClick={() => void reloadBoard()}>
          {t("board.retry")}
        </button>
      </main>
    );
  }
  if (!query.data || query.data.project_id !== projectId)
    return <NotFoundAlert />;
  return (
    <LoadedBoard
      board={query.data}
      projectId={projectId}
      refresh={reloadBoard}
    />
  );
}
