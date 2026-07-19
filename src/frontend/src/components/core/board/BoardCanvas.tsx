import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
  type Viewport,
} from "@xyflow/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.2;
const PAN_STEP = 40;
const LARGE_PAN_STEP = 160;
const RESET_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

type MoveHandler = (
  event: MouseEvent | TouchEvent | null,
  viewport: Viewport,
) => void;

export interface BoardCanvasProps {
  initialViewport: Viewport;
  onMoveStart?: MoveHandler;
  onMoveEnd: MoveHandler;
  onInstanceReady?: (instance: ReactFlowInstance) => void;
}

export function BoardCanvas({
  initialViewport,
  onMoveStart,
  onMoveEnd,
  onInstanceReady,
}: BoardCanvasProps) {
  const { t } = useTranslation();
  const entryButtonRef = useRef<HTMLButtonElement>(null);
  const canvasRegionRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReactFlowInstance | null>(null);

  const focusCanvas = useCallback(() => canvasRegionRef.current?.focus(), []);
  const handleInstanceReady = useCallback(
    (instance: ReactFlowInstance) => {
      instanceRef.current = instance;
      onInstanceReady?.(instance);
    },
    [onInstanceReady],
  );
  const commitViewport = useCallback(
    (viewport: Viewport) => {
      if (!instanceRef.current) return;
      void instanceRef.current.setViewport(viewport, { duration: 0 });
      onMoveEnd(null, viewport);
    },
    [onMoveEnd],
  );

  const handleEntryKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      focusCanvas();
    }
  };

  const handleCanvasKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Escape") {
      event.preventDefault();
      entryButtonRef.current?.focus();
      return;
    }
    const instance = instanceRef.current;
    if (!instance) return;
    const current = instance.getViewport();
    const panStep = event.shiftKey ? LARGE_PAN_STEP : PAN_STEP;
    let next: Viewport | null = null;
    switch (event.key) {
      case "ArrowLeft":
        next = { ...current, x: current.x + panStep };
        break;
      case "ArrowRight":
        next = { ...current, x: current.x - panStep };
        break;
      case "ArrowUp":
        next = { ...current, y: current.y + panStep };
        break;
      case "ArrowDown":
        next = { ...current, y: current.y - panStep };
        break;
      case "+":
      case "=":
        next = {
          ...current,
          zoom: Math.min(MAX_ZOOM, current.zoom + ZOOM_STEP),
        };
        break;
      case "-":
      case "_":
        next = {
          ...current,
          zoom: Math.max(MIN_ZOOM, current.zoom - ZOOM_STEP),
        };
        break;
      case "0":
        next = { ...RESET_VIEWPORT };
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    commitViewport(next);
  };

  return (
    <ReactFlowProvider>
      <div className="flex h-full min-h-0 flex-col">
        <Button
          ref={entryButtonRef}
          className="m-2 shrink-0 self-start"
          type="button"
          size="sm"
          variant="outline"
          ignoreTitleCase
          onClick={focusCanvas}
          onKeyDown={handleEntryKeyDown}
        >
          {t("board.canvas.open")}
        </Button>
        <div
          ref={canvasRegionRef}
          className="min-h-0 w-full flex-1"
          role="region"
          tabIndex={0}
          aria-label={t("board.canvas.label")}
          onKeyDown={handleCanvasKeyDown}
        >
          <ReactFlow
            nodes={[]}
            edges={[]}
            fitView={false}
            defaultViewport={initialViewport}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            onInit={handleInstanceReady}
            onMoveStart={onMoveStart}
            onMoveEnd={onMoveEnd}
          >
            <Background variant={BackgroundVariant.Dots} />
            <MiniMap />
            <Controls showFitView={false}>
              <ControlButton
                aria-label={t("board.viewport.reset")}
                onClick={() => commitViewport({ ...RESET_VIEWPORT })}
              >
                0
              </ControlButton>
            </Controls>
          </ReactFlow>
        </div>
      </div>
    </ReactFlowProvider>
  );
}

export default BoardCanvas;
