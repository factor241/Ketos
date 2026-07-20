import { NodeResizer } from "@xyflow/react";
import { Maximize2, Minimize2, PanelTopOpen, Trash2, X } from "lucide-react";
import { type KeyboardEvent, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import type { BoardCardFrameProps } from "./types";

const LIMITS = {
  minWidth: 240,
  maxWidth: 1600,
  minHeight: 160,
  maxHeight: 1200,
};
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export function BoardCardFrame(props: BoardCardFrameProps) {
  const titleId = useId();
  const maximizeRef = useRef<HTMLButtonElement>(null);
  const previousState = useRef(props.displayState);
  const normal = props.displayState === "normal";
  const collapsed = props.displayState === "collapsed";
  const maximized = props.displayState === "maximized";
  useLayoutEffect(() => {
    const restore = previousState.current === "maximized" && normal;
    previousState.current = props.displayState;
    if (!restore) return;
    const focusMaximize = () =>
      maximizeRef.current?.focus({ preventScroll: true });
    focusMaximize();
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(focusMaximize);
    });
    const fallback = window.setTimeout(focusMaximize, 100);
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(fallback);
    };
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
      !event.altKey ||
      !event.key.startsWith("Arrow")
    )
      return;
    const step = event.shiftKey ? 1 : 10;
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey && props.onKeyboardResize) {
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
      data-placement-revision={props.placementRevision}
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
            size="iconMd"
            variant="ghost"
            aria-label={collapsed ? props.labels.expand : props.labels.collapse}
            onClick={() =>
              props.onDisplayStateChange(collapsed ? "normal" : "collapsed")
            }
          >
            {collapsed ? (
              <PanelTopOpen aria-hidden="true" />
            ) : (
              <Minimize2 aria-hidden="true" />
            )}
          </Button>
          <Button
            ref={maximizeRef}
            type="button"
            size="iconMd"
            variant="ghost"
            aria-label={
              maximized ? props.labels.restore : props.labels.maximize
            }
            onClick={() =>
              props.onDisplayStateChange(maximized ? "normal" : "maximized")
            }
          >
            {maximized ? (
              <Minimize2 aria-hidden="true" />
            ) : (
              <Maximize2 aria-hidden="true" />
            )}
          </Button>
          <Button
            type="button"
            size="iconMd"
            variant="ghost"
            aria-label={props.labels.close}
            onClick={props.onClosePlacement}
          >
            <X aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="iconMd"
            variant="outline"
            aria-label={props.labels.deleteEntity}
            onClick={props.onRequestDeleteEntity}
          >
            <Trash2 aria-hidden="true" />
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
