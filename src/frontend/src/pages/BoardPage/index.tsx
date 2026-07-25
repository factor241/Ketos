import type {
  NodeProps,
  NodeTypes,
  OnNodeDrag,
  ReactFlowInstance,
} from "@xyflow/react";
import { MessageSquarePlus } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import BoardCanvas from "@/components/core/board";
import { BoardNoteDeleteDialog } from "@/components/core/board/BoardNoteDeleteDialog";
import { createBoardNodeTypes } from "@/components/core/board/board-node-types";
import { AutomationPlacement } from "@/components/core/board/placements/AutomationPlacement";
import { BoardNotePlacement } from "@/components/core/board/placements/BoardNotePlacement";
import { ChatPlacement } from "@/components/core/board/placements/ChatPlacement";
import { ResultPlacement } from "@/components/core/board/placements/ResultPlacement";
import { AutomationInventoryPanel } from "@/components/core/boards/AutomationInventoryPanel";
import { ChatList } from "@/components/core/chats/ChatList";
import { CopilotKitBoardProvider } from "@/components/core/chats/CopilotKitBoardProvider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useGetBoard } from "@/controllers/API/queries/boards";
import type { BoardExecution } from "@/controllers/API/queries/executions";
import { useGetModelProviders } from "@/controllers/API/queries/models/use-get-model-providers";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import ModelProviderModal from "@/modals/modelProviderModal";
import useAlertStore from "@/stores/alertStore";
import { useUtilityStore } from "@/stores/utilityStore";
import type {
  BoardNote,
  BoardRead,
  PlacementDisplayState,
} from "@/types/board";
import type { ChatThread } from "@/types/chat";
import { buildAutomationEditorUrl } from "@/utils/automation-editor-route";
import { useAutomationPlacementActions } from "./hooks/use-automation-placement-actions";
import { useBoardRestore } from "./hooks/use-board-restore";
import { useBoardReturnFocus } from "./hooks/use-board-return-focus";
import { useBoardScene } from "./hooks/use-board-scene";
import { useBoardViewport } from "./hooks/use-board-viewport";
import {
  CHAT_PLACEMENT_HEIGHT,
  CHAT_PLACEMENT_WIDTH,
  findChatPlacementPosition,
  useChatPlacementActions,
} from "./hooks/use-chat-placement-actions";
import { useCreateBoardChat } from "./hooks/use-create-board-chat";
import { useNotePlacementActions } from "./hooks/use-note-placement-actions";
import { useOpenAutomationEditor } from "./hooks/use-open-automation-editor";
import { usePlaceJobResult } from "./hooks/use-place-job-result";
import { usePlacementPersistence } from "./hooks/use-placement-persistence";
import { useRunAutomation } from "./hooks/use-run-automation";
import type {
  AutomationSceneNode,
  BoardNoteSceneNode,
  BoardSceneNode,
  ChatSceneNode,
  ResultSceneNode,
} from "./utils/placement-to-node";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BoardRefetch = ReturnType<typeof useGetBoard>["refetch"];

type BoardNoteRuntime = {
  drafts: Record<string, string>;
  setDraft: (noteId: string, draft: string) => void;
  save: (note: BoardNote, draft: string) => void;
  close: (node: BoardNoteSceneNode) => void;
  requestDelete: (note: BoardNote) => void;
  setDisplayState: (
    node: BoardNoteSceneNode,
    state: PlacementDisplayState,
  ) => void;
  resize: (
    node: BoardNoteSceneNode,
    size: { width: number; height: number },
  ) => void;
  moveBy: (node: BoardNoteSceneNode, delta: { x: number; y: number }) => void;
  resizeBy: (
    node: BoardNoteSceneNode,
    delta: { width: number; height: number },
  ) => void;
};

const BoardNoteRuntimeContext = createContext<BoardNoteRuntime | null>(null);

type BoardChatRuntime = {
  close: (node: ChatSceneNode) => void;
  archive: (chat: ChatThread, node: ChatSceneNode) => void;
  setDisplayState: (node: ChatSceneNode, state: PlacementDisplayState) => void;
  resize: (
    node: ChatSceneNode,
    size: { width: number; height: number },
  ) => void;
  moveBy: (node: ChatSceneNode, delta: { x: number; y: number }) => void;
  resizeBy: (
    node: ChatSceneNode,
    delta: { width: number; height: number },
  ) => void;
};

const BoardChatRuntimeContext = createContext<BoardChatRuntime | null>(null);

type BoardAutomationRuntime = {
  state: "loading" | "ready" | "error";
  actionsEnabled: boolean;
  focusPlacement: (placementId: string) => void;
  reportExecutions: (
    flowId: string,
    executions: readonly BoardExecution[],
  ) => void;
  retry: () => void;
  close: (node: AutomationSceneNode) => void;
  setDisplayState: (
    node: AutomationSceneNode,
    state: PlacementDisplayState,
  ) => void;
  resize: (
    node: AutomationSceneNode,
    size: { width: number; height: number },
  ) => void;
  moveBy: (node: AutomationSceneNode, delta: { x: number; y: number }) => void;
  resizeBy: (
    node: AutomationSceneNode,
    delta: { width: number; height: number },
  ) => void;
};

const BoardAutomationRuntimeContext =
  createContext<BoardAutomationRuntime | null>(null);

type BoardResultRuntime = {
  close: (node: ResultSceneNode) => void;
  setDisplayState: (
    node: ResultSceneNode,
    state: PlacementDisplayState,
  ) => void;
  resize: (
    node: ResultSceneNode,
    size: { width: number; height: number },
  ) => void;
  moveBy: (node: ResultSceneNode, delta: { x: number; y: number }) => void;
  resizeBy: (
    node: ResultSceneNode,
    delta: { width: number; height: number },
  ) => void;
};

const BoardResultRuntimeContext = createContext<BoardResultRuntime | null>(
  null,
);

function BoardNoteNode({ data, selected }: NodeProps<BoardNoteSceneNode>) {
  const runtime = useContext(BoardNoteRuntimeContext);
  if (!runtime) return null;
  const node = {
    id: data.placementId,
    type: "boardNote" as const,
    position: { x: data.placement.x, y: data.placement.y },
    data,
  } as BoardNoteSceneNode;
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

function BoardChatNode({ data, selected }: NodeProps<ChatSceneNode>) {
  const runtime = useContext(BoardChatRuntimeContext);
  if (!runtime) return null;
  const node = {
    id: data.placementId,
    type: "chat" as const,
    position: { x: data.placement.x, y: data.placement.y },
    data,
  } as ChatSceneNode;
  return (
    <ChatPlacement
      chat={data.chat}
      placement={data.placement}
      selected={selected}
      onDisplayStateChange={(state) => runtime.setDisplayState(node, state)}
      onClose={() => runtime.close(node)}
      onArchive={() => runtime.archive(data.chat, node)}
      onResizeEnd={(size) => runtime.resize(node, size)}
      onKeyboardMove={(delta) => runtime.moveBy(node, delta)}
      onKeyboardResize={(delta) => runtime.resizeBy(node, delta)}
    />
  );
}

function BoardAutomationNode({
  data,
  selected,
}: NodeProps<AutomationSceneNode>) {
  const runtime = useContext(BoardAutomationRuntimeContext);
  const execution = useRunAutomation({
    boardId: data.placement.boardId,
    flowId: data.targetId,
  });
  const resultPlacement = usePlaceJobResult({
    boardId: data.placement.boardId,
    automationPlacement: data.placement,
    execution: execution.authoritativeExecution,
    onOpen: runtime?.focusPlacement ?? (() => undefined),
  });
  useEffect(() => {
    runtime?.reportExecutions(data.targetId, execution.executions);
  }, [data.targetId, execution.executions, runtime]);
  const { href } = useOpenAutomationEditor({
    flowId: data.targetId,
    boardId: data.placement.boardId,
    placementId: data.placementId,
  });
  if (!runtime) return null;
  const node = {
    id: data.placementId,
    type: "automation" as const,
    position: { x: data.placement.x, y: data.placement.y },
    data,
  } as AutomationSceneNode;
  const state =
    runtime.state === "loading"
      ? ({ status: "loading" } as const)
      : runtime.state === "error"
        ? ({ status: "error" } as const)
        : data.summary
          ? ({ status: "ready", summary: data.summary } as const)
          : ({ status: "missing" } as const);
  return (
    <AutomationPlacement
      placement={data.placement}
      selected={selected}
      state={state}
      editHref={href}
      onRetry={runtime.retry}
      onDisplayStateChange={(displayState) =>
        runtime.setDisplayState(node, displayState)
      }
      onClosePlacement={() => runtime.close(node)}
      onResizeEnd={(size) => runtime.resize(node, size)}
      onKeyboardMove={(delta) => runtime.moveBy(node, delta)}
      onKeyboardResize={(delta) => runtime.resizeBy(node, delta)}
      execution={{
        actionsEnabled: runtime.actionsEnabled,
        presentation: execution.presentation,
        isSubmitting: execution.isSubmitting,
        actionPending: execution.actionPending || resultPlacement.isPending,
        requestRejected: execution.requestRejected,
        run: execution.run,
        cancel: execution.cancel,
        checkStatus: execution.checkStatus,
        runAgain: execution.runAgain,
        openResult: resultPlacement.openResult,
      }}
    />
  );
}

function BoardResultNode({ data, selected }: NodeProps<ResultSceneNode>) {
  const runtime = useContext(BoardResultRuntimeContext);
  if (!runtime) return null;
  const node = {
    id: data.placementId,
    type: "jobResult" as const,
    position: { x: data.placement.x, y: data.placement.y },
    data,
  } as ResultSceneNode;
  return (
    <ResultPlacement
      placement={data.placement}
      execution={data.execution}
      selected={selected}
      onDisplayStateChange={(state) => runtime.setDisplayState(node, state)}
      onClose={() => runtime.close(node)}
      onResizeEnd={(size) => runtime.resize(node, size)}
      onKeyboardMove={(delta) => runtime.moveBy(node, delta)}
      onKeyboardResize={(delta) => runtime.resizeBy(node, delta)}
    />
  );
}

const BOARD_NODE_TYPES: NodeTypes = createBoardNodeTypes({
  boardNote: BoardNoteNode,
  chat: BoardChatNode,
  automation: BoardAutomationNode,
  jobResult: BoardResultNode,
});

function NotFoundAlert() {
  const { t } = useTranslation();
  return <div role="alert">{t("board.notFound")}</div>;
}

function LoadedBoard({
  board,
  projectId,
  refresh,
  chatEnabled,
  executionEnabled,
  workspaceEnabled,
}: {
  board: BoardRead;
  projectId: string;
  refresh: BoardRefetch;
  chatEnabled: boolean;
  executionEnabled: boolean;
  workspaceEnabled: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useCustomNavigate();
  const viewport = useBoardViewport({ projectId, board, refresh });
  const [executionsByFlow, setExecutionsByFlow] = useState<
    Record<string, readonly BoardExecution[]>
  >({});
  const executions = useMemo(
    () => Object.values(executionsByFlow).flat(),
    [executionsByFlow],
  );
  const scene = useBoardScene({
    projectId,
    boardId: board.id,
    chatEnabled,
    executions,
  });
  const modelProviders = useGetModelProviders(
    {},
    {
      enabled: chatEnabled,
    },
  );
  const [placementConflict, setPlacementConflict] = useState(false);
  const persistence = usePlacementPersistence({
    boardId: board.id,
    onConflict: () => setPlacementConflict(true),
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [deletingNote, setDeletingNote] = useState<BoardNote | null>(null);
  const [noteConflict, setNoteConflict] = useState(false);
  const addNoteRef = useRef<HTMLButtonElement>(null);
  const chatActionRef = useRef<HTMLButtonElement>(null);
  const automationActionRef = useRef<HTMLButtonElement>(null);
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
  const chatActions = useChatPlacementActions({ boardId: board.id });
  const boardChat = useCreateBoardChat({ boardId: board.id, projectId });
  const automationActions = useAutomationPlacementActions({
    projectId,
    boardId: board.id,
  });
  const [automationSelectorOpen, setAutomationSelectorOpen] = useState(false);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const automationIntentConsumedRef = useRef<string | null>(null);
  const automationIntentValues = searchParams.getAll("open-add-automation");
  const automationIntent =
    automationIntentValues.length === 1 && automationIntentValues[0] === "1";
  useEffect(() => {
    if (!automationIntent) {
      automationIntentConsumedRef.current = null;
      return;
    }
    const signature = `${board.id}:${searchParams.toString()}`;
    if (automationIntentConsumedRef.current === signature) return;
    automationIntentConsumedRef.current = signature;
    setAutomationSelectorOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("open-add-automation");
    setSearchParams(next, { replace: true });
  }, [automationIntent, board.id, searchParams, setSearchParams]);
  useBoardReturnFocus({
    placements: scene.placements,
    isLoading: scene.isLoading,
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
          (current?.data as BoardNoteSceneNode["data"] | undefined)
            ?.placement ?? node.data.placement;
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
  const focusPlacement = useCallback((placementId: string) => {
    const focus = () =>
      document
        .querySelector<HTMLElement>(`[data-id="${placementId}"] section`)
        ?.focus({ preventScroll: true });
    requestAnimationFrame(() => requestAnimationFrame(focus));
  }, []);
  const reportExecutions = useCallback(
    (flowId: string, next: readonly BoardExecution[]) => {
      setExecutionsByFlow((current) => {
        const previous = current[flowId] ?? [];
        if (
          previous.length === next.length &&
          previous.every((execution, index) => {
            const candidate = next[index];
            return (
              candidate !== undefined &&
              execution.job_id === candidate.job_id &&
              execution.status === candidate.status &&
              execution.reason === candidate.reason &&
              execution.finished_timestamp === candidate.finished_timestamp &&
              execution.result === candidate.result
            );
          })
        )
          return current;
        return { ...current, [flowId]: next };
      });
    },
    [],
  );
  const chatRuntime = useMemo<BoardChatRuntime>(
    () => ({
      close: (node) => {
        persistence.close(node.data.placement);
        requestAnimationFrame(() => chatActionRef.current?.focus());
      },
      archive: (chat, node) => {
        chatActions.archive(chat);
        persistence.close(node.data.placement);
        requestAnimationFrame(() => chatActionRef.current?.focus());
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
          (current?.data as ChatSceneNode["data"] | undefined)?.placement ??
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
    [chatActions, persistence],
  );
  const automationRuntime = useMemo<BoardAutomationRuntime>(
    () => ({
      state: scene.automationState,
      actionsEnabled: executionEnabled,
      focusPlacement,
      reportExecutions,
      retry: () => void scene.refetch(),
      close: (node) => {
        persistence.close(node.data.placement);
        requestAnimationFrame(() => automationActionRef.current?.focus());
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
          (current?.data as AutomationSceneNode["data"] | undefined)
            ?.placement ?? node.data.placement;
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
    [
      executionEnabled,
      focusPlacement,
      persistence,
      reportExecutions,
      scene.automationState,
      scene.refetch,
    ],
  );
  const resultRuntime = useMemo<BoardResultRuntime>(
    () => ({
      close: async (node) => {
        const origin = scene.placements.find(
          (placement) =>
            placement.targetKind === "automation" &&
            placement.targetId === node.data.execution.flow_id,
        );
        try {
          await persistence.closeAndWait(node.data.placement);
        } catch {
          return;
        }
        if (origin) requestAnimationFrame(() => focusPlacement(origin.id));
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
          (current?.data as ResultSceneNode["data"] | undefined)?.placement ??
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
    [focusPlacement, persistence, scene.placements],
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
  const defaultProvider = modelProviders.data?.find(
    (provider) => provider.is_enabled && provider.models.length > 0,
  );
  const createDefaults = defaultProvider
    ? {
        provider: defaultProvider.provider,
        modelName: defaultProvider.models[0].model_name,
        contextPolicy: "board" as const,
      }
    : null;
  const createBoardChat = useCallback(async () => {
    if (!createDefaults) {
      setProviderModalOpen(true);
      return;
    }
    const position = findChatPlacementPosition(scene.placements, center());
    const zIndex =
      scene.placements.reduce(
        (highest, placement) => Math.max(highest, placement.zIndex),
        -1,
      ) + 1;
    try {
      const result = await boardChat.create({
        title: t("chat.defaultTitle"),
        provider: createDefaults.provider,
        modelName: createDefaults.modelName,
        placement: {
          ...position,
          width: CHAT_PLACEMENT_WIDTH,
          height: CHAT_PLACEMENT_HEIGHT,
          zIndex,
        },
      });
      await scene.refetch();
      focusPlacement(result.placement.id);
    } catch {
      useAlertStore.getState().setErrorData({
        title: t("chat.create.errorTitle"),
        list: [t("errors.generic")],
      });
    }
  }, [boardChat, center, createDefaults, focusPlacement, scene, t]);
  const placeExistingAutomation = useCallback(
    async (summary: (typeof scene.automations)[number]) => {
      try {
        const placement = await automationActions.placeExisting(
          summary,
          scene.placements,
          center(),
        );
        setAutomationSelectorOpen(false);
        focusPlacement(placement.id);
      } catch (error) {
        // The bounded alert is owned by useAutomationPlacementActions.
        throw error;
      }
    },
    [
      automationActions,
      center,
      focusPlacement,
      scene.automations,
      scene.placements,
    ],
  );
  const createAutomation = useCallback(
    async (mode: "create" | "createAndEdit") => {
      try {
        const result = await automationActions.createAndPlace(center());
        await scene.refetch();
        setAutomationSelectorOpen(false);
        focusPlacement(result.placement.id);
        if (mode === "createAndEdit") {
          navigate(
            buildAutomationEditorUrl(result.automation.id, {
              boardId: board.id,
              placementId: result.placement.id,
            }),
          );
        }
      } catch {
        // The atomic command hook publishes the bounded user-facing error.
      }
    },
    [automationActions, board.id, center, focusPlacement, navigate, scene],
  );
  const openAutomation = useCallback(
    async (
      summary: (typeof scene.automations)[number],
      existingPlacement: (typeof scene.placements)[number] | undefined,
    ) => {
      try {
        const placement =
          existingPlacement ??
          (await automationActions.placeExisting(
            summary,
            scene.placements,
            center(),
          ));
        setAutomationSelectorOpen(false);
        navigate(
          buildAutomationEditorUrl(summary.id, {
            boardId: board.id,
            placementId: placement.id,
          }),
        );
      } catch (error) {
        // The placement hook owns the bounded user-facing error.
        throw error;
      }
    },
    [automationActions, board.id, center, navigate, scene.placements],
  );
  return (
    <CopilotKitBoardProvider enabled={chatEnabled}>
      <BoardNoteRuntimeContext.Provider value={runtime}>
        <BoardChatRuntimeContext.Provider value={chatRuntime}>
          <BoardAutomationRuntimeContext.Provider value={automationRuntime}>
            <BoardResultRuntimeContext.Provider value={resultRuntime}>
              <main className="flex h-full flex-col bg-background text-foreground">
                <header className="flex items-center gap-4 border-b border-border p-4">
                  <Link to={`/project/${projectId}/boards`}>
                    {t("board.backToBoards")}
                  </Link>
                  <h1
                    id="board-heading"
                    tabIndex={-1}
                    className="text-xl font-semibold"
                  >
                    {board.title}
                  </h1>
                  {workspaceEnabled ? (
                    <>
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
                      {chatEnabled ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-10 w-10"
                          aria-label={t("chat.actions.createInBoard")}
                          title={t("chat.actions.createInBoard")}
                          aria-busy={boardChat.isPending}
                          disabled={
                            boardChat.isPending || modelProviders.isLoading
                          }
                          onClick={() => void createBoardChat()}
                        >
                          <MessageSquarePlus aria-hidden="true" />
                        </Button>
                      ) : null}
                      <Popover
                        open={automationSelectorOpen}
                        onOpenChange={setAutomationSelectorOpen}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            ref={automationActionRef}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={automationActions.isPending}
                            ignoreTitleCase
                          >
                            {t("board.automation.add")}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-96">
                          <AutomationInventoryPanel
                            projectId={projectId}
                            placements={scene.placements}
                            disabled={automationActions.isPending}
                            onPlace={(summary) =>
                              placeExistingAutomation(summary)
                            }
                            onOpen={(summary, placement) =>
                              openAutomation(summary, placement)
                            }
                            onCreate={() => void createAutomation("create")}
                            onCreateAndEdit={() =>
                              void createAutomation("createAndEdit")
                            }
                          />
                        </PopoverContent>
                      </Popover>
                    </>
                  ) : (
                    <span className="ml-auto text-sm text-muted-foreground">
                      {t("board.workspace.readOnly")}
                    </span>
                  )}
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
                {actions.unsafeContentError ? (
                  <p role="alert" className="p-3 text-sm text-destructive">
                    {t("board.note.unsafeContent")}
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
                <div className="flex min-h-0 flex-1">
                  {chatEnabled ? (
                    <aside className="w-80 shrink-0 overflow-auto border-r border-border bg-background">
                      <ChatList
                        projectId={projectId}
                        isCreatePending={
                          boardChat.isPending || modelProviders.isLoading
                        }
                        onCreate={createBoardChat}
                        actionRef={chatActionRef}
                        onOpen={async (chat) => {
                          const placement = await chatActions.open(
                            chat,
                            scene.placements,
                            center(),
                          );
                          focusPlacement(placement.id);
                        }}
                      />
                    </aside>
                  ) : null}
                  <div className="min-w-0 flex-1">
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
                </div>
                <BoardNoteDeleteDialog
                  open={deletingNote !== null}
                  title={t("board.note.deleteConfirmTitle")}
                  description={t("board.note.deleteConfirmDescription")}
                  cancelLabel={t("board.note.deleteCancel")}
                  confirmLabel={t("board.note.deleteConfirm")}
                  onCancel={() => {
                    setDeletingNote(null);
                    requestAnimationFrame(() =>
                      deleteTriggerRef.current?.focus(),
                    );
                  }}
                  onConfirm={() => {
                    if (deletingNote) actions.deleteEntity(deletingNote);
                    setDeletingNote(null);
                    requestAnimationFrame(() => addNoteRef.current?.focus());
                  }}
                />
                {providerModalOpen ? (
                  <ModelProviderModal
                    open={providerModalOpen}
                    modelType="llm"
                    onClose={({ hasChanges } = {}) => {
                      setProviderModalOpen(false);
                      if (hasChanges) void modelProviders.refetch();
                    }}
                  />
                ) : null}
              </main>
            </BoardResultRuntimeContext.Provider>
          </BoardAutomationRuntimeContext.Provider>
        </BoardChatRuntimeContext.Provider>
      </BoardNoteRuntimeContext.Provider>
    </CopilotKitBoardProvider>
  );
}

function RestorableBoardPage({
  projectId,
  boardId,
  workspaceEnabled,
  validParams,
  chatEnabled,
  executionEnabled,
}: {
  projectId: string;
  boardId: string;
  workspaceEnabled: boolean;
  validParams: boolean;
  chatEnabled: boolean;
  executionEnabled: boolean;
}) {
  const { t } = useTranslation();
  const restore = useBoardRestore({
    projectId,
    boardId,
    enabled: validParams,
  });
  const announcement = t(restore.announcementKey);

  if (!validParams || restore.serverMismatch) return <NotFoundAlert />;

  if (restore.board === null) {
    if (restore.phase === "hydrating" || restore.phase === "reconnecting")
      return (
        <div role="status" aria-label={announcement}>
          {t("board.loading")}
        </div>
      );
    return (
      <main>
        <div role="alert" aria-label={announcement}>
          {t("board.error")}
        </div>
        <button type="button" onClick={() => void restore.refetch()}>
          {t("board.retry")}
        </button>
      </main>
    );
  }

  return (
    <>
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
      <LoadedBoard
        board={restore.board}
        projectId={projectId}
        refresh={restore.refetch}
        chatEnabled={chatEnabled}
        executionEnabled={executionEnabled}
        workspaceEnabled={workspaceEnabled}
      />
    </>
  );
}

export default function BoardPage() {
  const { projectId = "", boardId = "" } = useParams<{
    projectId: string;
    boardId: string;
  }>();
  const workspaceEnabled = useUtilityStore(
    (state) => state.featureFlags.mvp_workspace === true,
  );
  const chatEnabled = useUtilityStore(
    (state) =>
      state.featureFlags.mvp_workspace === true &&
      state.featureFlags.mvp_chat === true,
  );
  const executionEnabled = useUtilityStore(
    (state) => state.featureFlags.agentic_experience === true,
  );
  const validParams =
    UUID_PATTERN.test(projectId) && UUID_PATTERN.test(boardId);
  return (
    <RestorableBoardPage
      projectId={projectId}
      boardId={boardId}
      workspaceEnabled={workspaceEnabled}
      validParams={validParams}
      chatEnabled={chatEnabled}
      executionEnabled={executionEnabled}
    />
  );
}
