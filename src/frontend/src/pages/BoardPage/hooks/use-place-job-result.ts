import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BoardExecution } from "@/controllers/API/queries/executions";
import {
  useGetBoardPlacements,
  usePostPlacement,
} from "@/controllers/API/queries/placements";
import type { Placement } from "@/types/board";

import { computeResultPlacementGeometry } from "../utils/compute-result-placement-position";

interface UsePlaceJobResultParams {
  boardId: string;
  automationPlacement: Placement;
  execution: BoardExecution | null;
  onOpen: (placementId: string) => void;
}

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "isAxiosError" in error &&
    error.isAxiosError === true &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    error.response.status === 409
  );
}

function findResult(
  placements: readonly Placement[] | undefined,
  boardId: string,
  jobId: string,
): Placement | undefined {
  return placements?.find(
    (placement) =>
      placement.boardId === boardId &&
      placement.targetKind === "job_result" &&
      placement.targetId === jobId,
  );
}

export function usePlaceJobResult({
  boardId,
  automationPlacement,
  execution,
  onOpen,
}: UsePlaceJobResultParams) {
  const placementsQuery = useGetBoardPlacements({ boardId });
  const createPlacement = usePostPlacement({ boardId });
  const key = `${boardId}:${automationPlacement.id}:${execution?.job_id ?? "none"}`;
  const attemptedKeysRef = useRef(new Set<string>());
  const inFlightByKeyRef = useRef(new Map<string, Promise<Placement | null>>());
  const [resolvedByKey, setResolvedByKey] = useState(
    new Map<string, Placement>(),
  );
  const eligible =
    automationPlacement.boardId === boardId &&
    automationPlacement.targetKind === "automation" &&
    execution !== null &&
    automationPlacement.targetId === execution.flow_id &&
    execution.board_id === boardId &&
    TERMINAL_STATUSES.has(execution.status);
  const existing = execution
    ? findResult(placementsQuery.data, boardId, execution.job_id)
    : undefined;
  const placement = existing ?? resolvedByKey.get(key);

  const ensurePlaced = useCallback(async (): Promise<Placement | null> => {
    if (!eligible) return null;
    if (!execution) return null;
    const found = findResult(placementsQuery.data, boardId, execution.job_id);
    if (found) return found;
    const existingPromise = inFlightByKeyRef.current.get(key);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
      const geometry = computeResultPlacementGeometry(
        automationPlacement,
        placementsQuery.data ?? [],
      );
      try {
        const created = await createPlacement.mutateAsync({
          targetKind: "job_result",
          targetId: execution.job_id,
          ...geometry,
        });
        setResolvedByKey((current) => new Map(current).set(key, created));
        return created;
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        const refreshed = await placementsQuery.refetch();
        const recovered = findResult(refreshed.data, boardId, execution.job_id);
        if (!recovered) throw error;
        setResolvedByKey((current) => new Map(current).set(key, recovered));
        return recovered;
      }
    })();
    inFlightByKeyRef.current.set(key, promise);
    try {
      return await promise;
    } finally {
      if (inFlightByKeyRef.current.get(key) === promise)
        inFlightByKeyRef.current.delete(key);
    }
  }, [
    automationPlacement,
    boardId,
    createPlacement,
    eligible,
    execution,
    key,
    placementsQuery,
  ]);

  useEffect(() => {
    if (
      !eligible ||
      placementsQuery.isLoading ||
      placement ||
      attemptedKeysRef.current.has(key)
    )
      return;
    attemptedKeysRef.current.add(key);
    void ensurePlaced().catch(() => undefined);
  }, [eligible, ensurePlaced, key, placement, placementsQuery.isLoading]);

  const openResult = useCallback(() => {
    if (placement) onOpen(placement.id);
  }, [onOpen, placement]);

  return useMemo(
    () => ({
      placement,
      ensurePlaced,
      openResult,
      isPending: createPlacement.isPending,
    }),
    [createPlacement.isPending, ensurePlaced, openResult, placement],
  );
}

export default usePlaceJobResult;
