import { useEffect, useMemo, useRef } from "react";

import { useGetBoard } from "@/controllers/API/queries/boards";
import useBoardStore from "@/stores/boardStore";
import type { BoardRead } from "@/types/board";

export type BoardRestorePhase =
  | "hydrating"
  | "reconnecting"
  | "restored"
  | "failed_recoverable"
  | "unknown";

export type BoardRestoreResult = {
  phase: BoardRestorePhase;
  board: BoardRead | null;
  serverMismatch: boolean;
  announcementKey: BoardRestoreAnnouncementKey;
  refetch: ReturnType<typeof useGetBoard>["refetch"];
};

type FocusDescriptor =
  | { kind: "placement"; dataId: string }
  | { kind: "element"; id: string };

const ANNOUNCEMENT_KEYS = {
  hydrating: "board.restore.hydrating",
  reconnecting: "board.restore.reconnecting",
  restored: "board.restore.restored",
  failed_recoverable: "board.restore.failedRecoverable",
  unknown: "board.restore.unknown",
} as const satisfies Record<BoardRestorePhase, string>;
export type BoardRestoreAnnouncementKey =
  (typeof ANNOUNCEMENT_KEYS)[BoardRestorePhase];
const SAFE_SELECTOR_VALUE = /^[A-Za-z0-9-]+$/;

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("response" in error))
    return undefined;
  return (error as { response?: { status?: number } }).response?.status;
}

function isComposerElement(element: Element): boolean {
  const selector = [
    "input",
    "textarea",
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[data-testid*="composer" i]',
    '[id*="composer" i]',
  ].join(",");
  return element.matches(selector) || element.closest(selector) !== null;
}

function isFocusableTarget(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.isConnected &&
    element !== document.body &&
    element !== document.documentElement &&
    !isComposerElement(element)
  );
}

function captureFocusDescriptor(): FocusDescriptor | null {
  if (typeof document === "undefined") return null;
  const activeElement = document.activeElement;
  if (!isFocusableTarget(activeElement)) return null;
  const placement = activeElement.closest<HTMLElement>("[data-id]");
  const placementId = placement?.dataset.id;
  if (placementId && SAFE_SELECTOR_VALUE.test(placementId)) {
    return { kind: "placement", dataId: placementId };
  }
  if (
    activeElement.id &&
    SAFE_SELECTOR_VALUE.test(activeElement.id) &&
    !activeElement.id.toLowerCase().includes("composer")
  ) {
    return { kind: "element", id: activeElement.id };
  }
  return null;
}

function resolveFocusTarget(
  descriptor: FocusDescriptor | null,
): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let describedTarget: Element | null = null;
  if (descriptor?.kind === "placement") {
    describedTarget = document.querySelector(
      `[data-id="${descriptor.dataId}"] section`,
    );
  } else if (descriptor?.kind === "element") {
    describedTarget = document.getElementById(descriptor.id);
  }
  if (isFocusableTarget(describedTarget)) return describedTarget;
  const heading = document.querySelector("#board-heading");
  if (isFocusableTarget(heading)) return heading;
  const canvas = document.querySelector('[data-testid="board-canvas"]');
  return isFocusableTarget(canvas) ? canvas : null;
}

function isValidServerBoard(
  board: BoardRead | undefined,
  projectId: string,
  boardId: string,
): board is BoardRead {
  return board?.id === boardId && board.project_id === projectId;
}

export function useBoardRestore({
  projectId,
  boardId,
  enabled = true,
}: {
  projectId: string;
  boardId: string;
  enabled?: boolean;
}): BoardRestoreResult {
  const routeKey = `${projectId}\u0000${boardId}`;
  const query = useGetBoard({ projectId, boardId }, { enabled });
  const focusDescriptorRef = useRef<FocusDescriptor | null>(null);
  const renderedRouteRef = useRef(routeKey);
  const lastServerBoardRef = useRef<{
    routeKey: string;
    board: BoardRead | null;
  }>({ routeKey, board: null });
  const retriedConflictRef = useRef<{
    routeKey: string;
    error: unknown;
  } | null>(null);
  const previousPhaseRef = useRef<{
    routeKey: string;
    phase: BoardRestorePhase | null;
  }>({ routeKey, phase: null });

  if (renderedRouteRef.current !== routeKey) {
    focusDescriptorRef.current = captureFocusDescriptor();
    renderedRouteRef.current = routeKey;
    lastServerBoardRef.current = { routeKey, board: null };
    retriedConflictRef.current = null;
    previousPhaseRef.current = { routeKey, phase: null };
  }

  const validServerBoard = useMemo(
    () =>
      isValidServerBoard(query.data, projectId, boardId) ? query.data : null,
    [boardId, projectId, query.data],
  );
  const invalidServerResponse =
    query.data !== undefined && validServerBoard === null;
  if (validServerBoard !== null) {
    lastServerBoardRef.current = { routeKey, board: validServerBoard };
  }
  const previousServerBoard =
    lastServerBoardRef.current.routeKey === routeKey
      ? lastServerBoardRef.current.board
      : null;
  const status = errorStatus(query.error);
  const conflictAlreadyRetried =
    status === 409 &&
    retriedConflictRef.current?.routeKey === routeKey &&
    retriedConflictRef.current.error === query.error;

  let phase: BoardRestorePhase;
  if (invalidServerResponse) phase = "unknown";
  else if (query.isLoading) phase = "hydrating";
  else if (query.isFetching && previousServerBoard !== null)
    phase = "reconnecting";
  else if (validServerBoard !== null) phase = "restored";
  else if (query.isError) {
    if (status === 409 && !conflictAlreadyRetried)
      phase = previousServerBoard === null ? "hydrating" : "reconnecting";
    else
      phase = previousServerBoard === null ? "unknown" : "failed_recoverable";
  } else if (query.isFetching) phase = "hydrating";
  else phase = "unknown";

  const board = invalidServerResponse
    ? null
    : (validServerBoard ??
      (query.isFetching || query.isError ? previousServerBoard : null));

  useEffect(() => {
    useBoardStore.getState().unmountBoard();
  }, [projectId, boardId]);

  useEffect(() => {
    if (
      !query.isError ||
      errorStatus(query.error) !== 409 ||
      (retriedConflictRef.current?.routeKey === routeKey &&
        retriedConflictRef.current.error === query.error)
    )
      return;
    retriedConflictRef.current = { routeKey, error: query.error };
    void query.refetch();
  }, [query.error, query.isError, query.refetch, routeKey]);

  useEffect(() => {
    const previous = previousPhaseRef.current;
    if (previous.routeKey === routeKey && previous.phase === phase) return;
    if (
      phase === "reconnecting" ||
      (phase === "hydrating" && previous.phase === "restored")
    ) {
      focusDescriptorRef.current =
        captureFocusDescriptor() ?? focusDescriptorRef.current;
    }
    previousPhaseRef.current = { routeKey, phase };
    if (phase !== "restored") return;
    let innerFrame: number | null = null;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        resolveFocusTarget(focusDescriptorRef.current)?.focus({
          preventScroll: true,
        });
      });
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) cancelAnimationFrame(innerFrame);
    };
  }, [phase, routeKey]);

  return {
    phase,
    board,
    serverMismatch: invalidServerResponse,
    announcementKey: ANNOUNCEMENT_KEYS[phase],
    refetch: query.refetch,
  };
}
