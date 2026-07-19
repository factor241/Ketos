import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactFlowInstance, Viewport } from "@xyflow/react";

import { usePutBoardViewport } from "@/controllers/API/queries/boards";
import useBoardStore from "@/stores/boardStore";
import type { BoardRead } from "@/types/board";

const SAVE_DELAY_MS = 300;

type RefetchResult = { data?: BoardRead };
type UseBoardViewportArgs = {
  projectId: string;
  board: BoardRead;
  refetch: () => Promise<RefetchResult>;
};

type ViewportSession = {
  boardId: string;
  revision: number;
  pending: Viewport | null;
  timer: ReturnType<typeof setTimeout> | null;
  instance: ReactFlowInstance | null;
  mounted: boolean;
  hydrated: boolean;
  disposed: boolean;
  mutate: ReturnType<typeof usePutBoardViewport>["mutate"];
  refetch: () => Promise<RefetchResult>;
};

const boardViewport = (board: BoardRead): Viewport => ({
  x: board.viewport_x,
  y: board.viewport_y,
  zoom: board.viewport_zoom,
});

const isConflict = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "response" in error &&
  (error as { response?: { status?: number } }).response?.status === 409;

const sameViewport = (left: Viewport | null, right: Viewport) =>
  left?.x === right.x && left.y === right.y && left.zoom === right.zoom;

export function useBoardViewport({ projectId, board, refetch }: UseBoardViewportArgs) {
  const initialViewport = useMemo(
    () => boardViewport(board),
    [board.viewport_x, board.viewport_y, board.viewport_zoom],
  );
  const mutation = usePutBoardViewport({ projectId, boardId: board.id });
  const mountBoard = useBoardStore((state) => state.mountBoard);
  const setHydrationPhase = useBoardStore((state) => state.setHydrationPhase);
  const setViewportGestureActive = useBoardStore(
    (state) => state.setViewportGestureActive,
  );
  const setPendingViewport = useBoardStore((state) => state.setPendingViewport);
  const clearPendingViewport = useBoardStore((state) => state.clearPendingViewport);
  const unmountBoard = useBoardStore((state) => state.unmountBoard);
  const [conflict, setConflict] = useState(false);

  const session = useMemo<ViewportSession>(
    () => ({
      boardId: board.id,
      revision: board.revision,
      pending: null,
      timer: null,
      instance: null,
      mounted: false,
      hydrated: false,
      disposed: false,
      mutate: mutation.mutate,
      refetch,
    }),
    [board.id, projectId],
  );
  const activeSessionRef = useRef(session);
  activeSessionRef.current = session;
  session.mutate = mutation.mutate;
  session.refetch = refetch;

  const applyServerViewport = useCallback(
    (target: ViewportSession, serverBoard: BoardRead) => {
      if (
        target.disposed ||
        activeSessionRef.current !== target ||
        target.instance === null
      ) {
        return;
      }
      target.revision = serverBoard.revision;
      void target.instance.setViewport(boardViewport(serverBoard), { duration: 0 });
    },
    [],
  );

  const dispatchSave = useCallback(
    (target: ViewportSession, viewport: Viewport) => {
      if (target.timer) clearTimeout(target.timer);
      target.timer = null;
      target.mutate(
        {
          x: viewport.x,
          y: viewport.y,
          zoom: viewport.zoom,
          expected_revision: target.revision,
        },
        {
          onSuccess: (savedBoard) => {
            target.revision = savedBoard.revision;
            if (sameViewport(target.pending, viewport)) {
              target.pending = null;
              if (!target.disposed && activeSessionRef.current === target) {
                clearPendingViewport();
              }
            }
            if (!target.disposed && activeSessionRef.current === target) {
              setConflict(false);
            }
          },
          onError: (error) => {
            if (!isConflict(error)) return;
            if (target.timer) clearTimeout(target.timer);
            target.timer = null;
            target.pending = null;
            if (!target.disposed && activeSessionRef.current === target) {
              clearPendingViewport();
              setConflict(true);
            }
            void target.refetch().then(({ data }) => {
              if (data) applyServerViewport(target, data);
            });
          },
        },
      );
    },
    [applyServerViewport, clearPendingViewport],
  );

  const hydrate = useCallback(
    (target: ViewportSession) => {
      if (
        target.disposed ||
        target.hydrated ||
        !target.mounted ||
        !target.instance
      ) {
        return;
      }
      void target.instance.setViewport(initialViewport, { duration: 0 });
      target.hydrated = true;
      setHydrationPhase("ready");
    },
    [initialViewport, setHydrationPhase],
  );

  useEffect(() => {
    session.disposed = false;
    session.mounted = true;
    mountBoard(session.boardId);
    setHydrationPhase("hydrating");
    setConflict(false);
    hydrate(session);

    return () => {
      if (session.timer) clearTimeout(session.timer);
      session.timer = null;
      if (session.pending) dispatchSave(session, session.pending);
      session.disposed = true;
      session.mounted = false;
      session.instance = null;
      unmountBoard();
    };
  }, [dispatchSave, hydrate, mountBoard, session, setHydrationPhase, unmountBoard]);

  const onMoveStart = useCallback(() => {
    setViewportGestureActive(true);
  }, [setViewportGestureActive]);

  const onMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      session.pending = viewport;
      setPendingViewport(viewport);
      setViewportGestureActive(false);
      if (session.timer) clearTimeout(session.timer);
      session.timer = setTimeout(() => {
        session.timer = null;
        if (!session.disposed && session.pending) {
          dispatchSave(session, session.pending);
        }
      }, SAVE_DELAY_MS);
    },
    [dispatchSave, session, setPendingViewport, setViewportGestureActive],
  );

  const onInstanceReady = useCallback(
    (instance: ReactFlowInstance) => {
      session.instance = instance;
      hydrate(session);
    },
    [hydrate, session],
  );

  return { initialViewport, onMoveStart, onMoveEnd, onInstanceReady, conflict };
}
