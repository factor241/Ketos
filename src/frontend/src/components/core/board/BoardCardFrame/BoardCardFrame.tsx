import { NodeResizer } from "@xyflow/react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import type { PlacementDisplayState } from "@/types/board";

const LIMITS = {
  minWidth: 240,
  maxWidth: 1600,
  minHeight: 160,
  maxHeight: 1200,
};
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export interface BoardCardFrameProps {
  title: string;
  children: ReactNode;
  selected: boolean;
  displayState: PlacementDisplayState;
  width: number;
  height: number;
  labels: {
    collapse: string;
    expand: string;
    maximize: string;
    restore: string;
    close: string;
    deleteEntity: string;
  };
  onDisplayStateChange: (state: PlacementDisplayState) => void;
  onClose: () => void;
  onDeleteEntity: () => void;
  onResizeEnd: (size: { width: number; height: number }) => void;
  onKeyboardMove?: (delta: { x: number; y: number }) => void;
  onKeyboardResize?: (delta: { width: number; height: number }) => void;
}

export function BoardCardFrame(props: BoardCardFrameProps) {
  const titleId = useId();
  const maximizeRef = useRef<HTMLButtonElement>(null);
  const previousState = useRef(props.displayState);
  const normal = props.displayState === "normal";
  const collapsed = props.displayState === "collapsed";
  const maximized = props.displayState === "maximized";
  useEffect(() => {
    const restore = previousState.current === "maximized" && normal;
    previousState.current = props.displayState;
    if (!restore) return;
    const frame = requestAnimationFrame(() => maximizeRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [normal, props.displayState]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && maximized) {
      event.preventDefault();
      props.onDisplayStateChange("normal");
      return;
    }
    if (
      event.target !== event.currentTarget ||
      !normal ||
      !event.key.startsWith("Arrow")
    )
      return;
    const step = event.shiftKey ? 40 : 10;
    event.preventDefault();
    event.stopPropagation();
    if (event.altKey && props.onKeyboardResize) {
      const width =
        event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0;
      const height =
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      const delta = {
        width:
          clamp(props.width + width, LIMITS.minWidth, LIMITS.maxWidth) -
          props.width,
        height:
          clamp(props.height + height, LIMITS.minHeight, LIMITS.maxHeight) -
          props.height,
      };
      if (delta.width || delta.height) props.onKeyboardResize(delta);
    } else
      props.onKeyboardMove?.({
        x:
          event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0,
        y:
          event.key === "ArrowUp"
            ? -step
            : event.key === "ArrowDown"
              ? step
              : 0,
      });
  };
  const frame = (
    <section
      aria-labelledby={titleId}
      aria-expanded={!collapsed}
      data-display-state={props.displayState}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={
        maximized
          ? "fixed inset-4 z-50 flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
          : "relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
      }
      style={
        maximized
          ? undefined
          : { width: props.width, height: collapsed ? undefined : props.height }
      }
    >
      {props.selected && normal ? (
        <NodeResizer
          isVisible
          {...LIMITS}
          lineClassName="border-accent"
          handleClassName="border-accent bg-background"
          onResizeEnd={(_event, size) =>
            props.onResizeEnd({
              width: clamp(size.width, LIMITS.minWidth, LIMITS.maxWidth),
              height: clamp(size.height, LIMITS.minHeight, LIMITS.maxHeight),
            })
          }
        />
      ) : null}
      <header className="flex min-w-0 items-center gap-2 border-b border-border bg-background px-3 py-2">
        <div
          className={
            normal
              ? "board-card-drag-handle min-w-0 flex-1 cursor-move"
              : "min-w-0 flex-1"
          }
        >
          <h2 id={titleId} className="truncate text-sm font-medium">
            {props.title}
          </h2>
        </div>
        <div className="nodrag flex shrink-0 flex-wrap items-center justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={collapsed ? props.labels.expand : props.labels.collapse}
            onClick={() =>
              props.onDisplayStateChange(collapsed ? "normal" : "collapsed")
            }
          >
            {collapsed ? props.labels.expand : props.labels.collapse}
          </Button>
          <Button
            ref={maximizeRef}
            type="button"
            size="sm"
            variant="ghost"
            aria-label={
              maximized ? props.labels.restore : props.labels.maximize
            }
            onClick={() =>
              props.onDisplayStateChange(maximized ? "normal" : "maximized")
            }
          >
            {maximized ? props.labels.restore : props.labels.maximize}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={props.labels.close}
            onClick={props.onClose}
          >
            {props.labels.close}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={props.labels.deleteEntity}
            onClick={props.onDeleteEntity}
          >
            {props.labels.deleteEntity}
          </Button>
        </div>
      </header>
      {!collapsed ? (
        <div className="nodrag min-h-0 flex-1 overflow-auto p-4">
          {props.children}
        </div>
      ) : null}
    </section>
  );
  return maximized && typeof document !== "undefined"
    ? createPortal(frame, document.body)
    : frame;
}
export default BoardCardFrame;
