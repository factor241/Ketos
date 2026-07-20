import { useCallback, useMemo, useRef, useState } from "react";
import type { RunAutomationPresentation } from "@/components/core/board/executions/ExecutionStatus";
import type { BoardExecution } from "@/controllers/API/queries/executions";
import {
  useGetAutomationRun,
  useGetAutomationRuns,
  usePostAutomationRun,
  usePostCancelAutomationRun,
} from "@/controllers/API/queries/executions";

interface UseRunAutomationParams {
  boardId: string;
  flowId: string;
}

function isTransportFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "isAxiosError" in error &&
    error.isAxiosError === true &&
    (!("response" in error) || error.response === undefined)
  );
}

export function useRunAutomation({ boardId, flowId }: UseRunAutomationParams) {
  const activeIntentRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const cancelInFlightRef = useRef(false);
  const intentGenerationRef = useRef(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [acceptedExecution, setAcceptedExecution] =
    useState<BoardExecution | null>(null);
  const [cancelledExecution, setCancelledExecution] =
    useState<BoardExecution | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [requestUnknown, setRequestUnknown] = useState(false);
  const [requestRejected, setRequestRejected] = useState(false);

  const runMutation = usePostAutomationRun({ boardId, flowId });
  const history = useGetAutomationRuns({ boardId, flowId, limit: 20 });
  const latestHistoryExecution = history.data?.[0];
  const effectiveJobId = jobId ?? latestHistoryExecution?.job_id ?? null;
  const detail = useGetAutomationRun(
    { boardId, flowId, jobId: effectiveJobId ?? "" },
    { enabled: Boolean(effectiveJobId) },
  );
  const cancelMutation = usePostCancelAutomationRun({
    boardId,
    flowId,
    jobId: effectiveJobId ?? "",
  });

  const submitIntent = useCallback(
    async (intentKey: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setIsSubmitting(true);
      setRequestUnknown(false);
      setRequestRejected(false);
      try {
        const execution = await runMutation.mutateAsync({
          idempotencyKey: intentKey,
        });
        if (activeIntentRef.current !== intentKey) return;
        setAcceptedExecution(execution);
        setJobId(execution.job_id);
      } catch (error) {
        if (activeIntentRef.current !== intentKey) return;
        if (isTransportFailure(error)) setRequestUnknown(true);
        else {
          activeIntentRef.current = null;
          setRequestRejected(true);
        }
      } finally {
        inFlightRef.current = false;
        setIsSubmitting(false);
      }
    },
    [runMutation],
  );

  const run = useCallback(async () => {
    if (activeIntentRef.current || effectiveJobId || inFlightRef.current)
      return;
    const intentKey = crypto.randomUUID();
    intentGenerationRef.current += 1;
    activeIntentRef.current = intentKey;
    await submitIntent(intentKey);
  }, [effectiveJobId, submitIntent]);

  const presentation = useMemo<RunAutomationPresentation | undefined>(() => {
    if (requestUnknown)
      return { status: "unknown", lastKnown: acceptedExecution };
    if (
      effectiveJobId &&
      detail.presentation === undefined &&
      detail.failureCount > 0
    ) {
      const lastKnown =
        acceptedExecution?.job_id === effectiveJobId
          ? acceptedExecution
          : latestHistoryExecution?.job_id === effectiveJobId
            ? latestHistoryExecution
            : null;
      if (lastKnown) return { status: "unknown", lastKnown };
    }
    return (
      cancelledExecution ??
      detail.presentation ??
      acceptedExecution ??
      history.data?.[0] ??
      undefined
    );
  }, [
    acceptedExecution,
    cancelledExecution,
    detail.presentation,
    detail.failureCount,
    effectiveJobId,
    history.data,
    latestHistoryExecution,
    requestUnknown,
  ]);

  const authoritativeExecution = useMemo<BoardExecution | null>(() => {
    const candidates = [
      cancelledExecution,
      detail.data,
      acceptedExecution,
      ...(history.data ?? []),
    ];
    return (
      candidates.find((execution) => execution?.job_id === effectiveJobId) ??
      null
    );
  }, [
    acceptedExecution,
    cancelledExecution,
    detail.data,
    effectiveJobId,
    history.data,
  ]);

  const executions = useMemo(() => {
    const byId = new Map<string, BoardExecution>();
    for (const execution of [
      authoritativeExecution,
      acceptedExecution,
      cancelledExecution,
      detail.data,
      ...(history.data ?? []),
    ]) {
      if (execution && !byId.has(execution.job_id))
        byId.set(execution.job_id, execution);
    }
    return [...byId.values()];
  }, [
    acceptedExecution,
    authoritativeExecution,
    cancelledExecution,
    detail.data,
    history.data,
  ]);

  const checkStatus = useCallback(async () => {
    if (inFlightRef.current) return;
    const intentKey = activeIntentRef.current;
    if (requestUnknown && intentKey) {
      await submitIntent(intentKey);
      return;
    }
    if (effectiveJobId) {
      await detail.refetch();
      return;
    }
  }, [detail, effectiveJobId, requestUnknown, submitIntent]);

  const cancel = useCallback(async () => {
    if (
      !effectiveJobId ||
      !presentation ||
      presentation.status === "unknown" ||
      !["queued", "running"].includes(presentation.status) ||
      cancelInFlightRef.current
    )
      return;
    cancelInFlightRef.current = true;
    const cancelGeneration = intentGenerationRef.current;
    const cancelJobId = effectiveJobId;
    setIsCancelling(true);
    try {
      const execution = await cancelMutation.mutateAsync();
      if (
        intentGenerationRef.current === cancelGeneration &&
        execution.job_id === cancelJobId
      )
        setCancelledExecution(execution);
    } catch {
      // The last authoritative execution remains visible; no optimistic cancel.
    } finally {
      cancelInFlightRef.current = false;
      setIsCancelling(false);
    }
  }, [cancelMutation, effectiveJobId, presentation]);

  const runAgain = useCallback(async () => {
    if (
      inFlightRef.current ||
      cancelInFlightRef.current ||
      !presentation ||
      presentation.status === "unknown" ||
      !["failed", "cancelled"].includes(presentation.status)
    )
      return;
    const intentKey = crypto.randomUUID();
    intentGenerationRef.current += 1;
    activeIntentRef.current = intentKey;
    setJobId(null);
    setAcceptedExecution(null);
    setCancelledExecution(null);
    setRequestUnknown(false);
    await submitIntent(intentKey);
  }, [presentation, submitIntent]);

  return {
    jobId: effectiveJobId,
    authoritativeExecution,
    executions,
    presentation,
    isSubmitting,
    actionPending: isSubmitting || isCancelling || cancelMutation.isPending,
    requestRejected,
    run,
    cancel,
    checkStatus,
    runAgain,
  };
}

export default useRunAutomation;
