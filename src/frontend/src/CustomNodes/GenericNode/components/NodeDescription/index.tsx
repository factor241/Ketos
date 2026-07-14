import { memo, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { Textarea } from "@/components/ui/textarea";
import { useCanvasReadOnly } from "@/contexts/canvas-read-only-context";
import useFlowStore from "@/stores/flowStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import { handleKeyDown } from "@/utils/reactflowUtils";
import { cn } from "@/utils/utils";

export default function NodeDescription({
  description,
  selected,
  nodeId,
  emptyPlaceholder = "",
  placeholderClassName,
  charLimit,
  inputClassName,
  mdClassName,
  style,
  editNameDescription,
  setEditNameDescription,
  stickyNote,
  setHasChangedNodeDescription,
}: {
  description?: string;
  selected?: boolean;
  nodeId: string;
  emptyPlaceholder?: string;
  placeholderClassName?: string;
  charLimit?: number;
  inputClassName?: string;
  mdClassName?: string;
  style?: React.CSSProperties;
  editNameDescription: boolean;
  setEditNameDescription?: (value: boolean) => void;
  stickyNote?: boolean;
  setHasChangedNodeDescription?: (value: boolean) => void;
}) {
  const isCanvasReadOnly = useCanvasReadOnly();
  const [nodeDescription, setNodeDescription] = useState<string>(
    description ?? "",
  );
  const takeSnapshot = useFlowsManagerStore((state) => state.takeSnapshot);
  const setNode = useFlowStore((state) => state.setNode);
  const overflowRef = useRef<HTMLButtonElement>(null);
  const [hasScroll, sethasScroll] = useState(false);

  useEffect(() => {
    if (!isCanvasReadOnly && selected && editNameDescription) {
      takeSnapshot();
    }
  }, [editNameDescription, isCanvasReadOnly, selected, takeSnapshot]);

  useEffect(() => {
    //timeout to wait for the dom to update
    setTimeout(() => {
      if (overflowRef.current) {
        if (
          overflowRef.current.clientHeight < overflowRef.current.scrollHeight
        ) {
          sethasScroll(true);
        } else {
          sethasScroll(false);
        }
      }
    }, 200);
  }, [editNameDescription]);

  useEffect(() => {
    setNodeDescription(description ?? "");
  }, [description]);

  const MemoizedMarkdown = memo(Markdown);

  const renderedDescription = useMemo(() => {
    if (description === "" || !description) {
      return emptyPlaceholder;
    }
    return (
      <MemoizedMarkdown
        className={cn(
          "markdown prose flex w-full flex-col leading-5 word-break-break-word [&_pre]:whitespace-break-spaces [&_pre]:!bg-code-description-background [&_pre_code]:!bg-code-description-background",
          stickyNote
            ? "!text-base !font-medium leading-relaxed [&_p]:!text-base [&_p]:!font-medium [&_li]:!text-base [&_li]:!font-medium"
            : "text-xs",
          mdClassName,
        )}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {props.children}
            </a>
          ),
        }}
      >
        {String(description)}
      </MemoizedMarkdown>
    );
  }, [description, emptyPlaceholder, mdClassName]);

  const handleBlurFn = () => {
    if (isCanvasReadOnly) return;
    setNodeDescription(nodeDescription);
    setNode(nodeId, (old) => ({
      ...old,
      data: {
        ...old.data,
        node: {
          ...old.data.node,
          description: nodeDescription,
        },
      },
    }));
    if (stickyNote) {
      setEditNameDescription?.(false);
    }
  };

  const handleKeyDownFn = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isCanvasReadOnly) return;
    handleKeyDown(e, nodeDescription, "");

    if (e.key === "Escape") {
      setEditNameDescription?.(false);
      setNodeDescription(description ?? "");

      if (stickyNote) {
        setNodeDescription(nodeDescription);
        setNode(nodeId, (old) => ({
          ...old,
          data: {
            ...old.data,
            node: {
              ...old.data.node,
              description: nodeDescription,
            },
          },
        }));
      }
    }
  };

  const handleDoubleClickFn = () => {
    if (!isCanvasReadOnly && stickyNote) {
      setEditNameDescription?.(true);
      takeSnapshot();
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isCanvasReadOnly) return;
    setHasChangedNodeDescription?.(true);
    setNodeDescription(e.target.value);
  };

  return (
    <div
      className={cn(
        !editNameDescription || isCanvasReadOnly
          ? "overflow-auto"
          : "overflow-hidden",
        hasScroll ? "nowheel" : "",
        charLimit ? "flex flex-col" : "",
        "w-full",
      )}
    >
      {editNameDescription && !isCanvasReadOnly ? (
        <>
          <Textarea
            maxLength={charLimit}
            className={cn(
              "nowheel w-full text-xs focus:border-primary focus:ring-0",
              stickyNote
                ? "overflow-auto p-0 px-2 pt-0.5 !text-base font-medium"
                : "px-2 py-0.5",
              inputClassName,
            )}
            autoFocus
            style={style}
            onBlur={handleBlurFn}
            value={nodeDescription}
            onChange={onChange}
            onKeyDown={handleKeyDownFn}
          />
          {charLimit && (nodeDescription?.length ?? 0) >= charLimit - 100 && (
            <div
              className={cn(
                "pt-1 text-left !text-mmd",
                (nodeDescription?.length ?? 0) >= charLimit
                  ? "text-error"
                  : "text-primary",
                placeholderClassName,
              )}
              data-testid="note_char_limit"
            >
              {nodeDescription?.length ?? 0}/{charLimit}
            </div>
          )}
        </>
      ) : (
        <button
          type="button"
          data-testid="generic-node-desc"
          ref={overflowRef}
          className={cn(
            "nodoubleclick generic-node-desc-text block h-full w-full cursor-grab border-0 bg-transparent p-0 text-left text-muted-foreground word-break-break-word",
            description === "" || !description ? "font-light italic" : "",
            stickyNote && "text-base font-medium overflow-auto max-h-full",
            isCanvasReadOnly && "cursor-default",
            placeholderClassName,
          )}
          onDoubleClick={handleDoubleClickFn}
          tabIndex={stickyNote && !isCanvasReadOnly ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleDoubleClickFn();
          }}
        >
          {renderedDescription}
        </button>
      )}
    </div>
  );
}
