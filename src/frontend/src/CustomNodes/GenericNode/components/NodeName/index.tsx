import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { Input } from "@/components/ui/input";
import { useCanvasReadOnly } from "@/contexts/canvas-read-only-context";
import useFlowStore from "@/stores/flowStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import { cn } from "@/utils/utils";

export default function NodeName({
  display_name,
  selected,
  nodeId,
  showNode,
  beta,
  legacy,
  editNameDescription,
  toggleEditNameDescription,
  setHasChangedNodeDescription,
}: {
  display_name?: string;
  selected?: boolean;
  nodeId: string;
  showNode: boolean;
  beta: boolean;
  legacy?: boolean;
  editNameDescription: boolean;
  toggleEditNameDescription: () => void;
  setHasChangedNodeDescription: (hasChanged: boolean) => void;
}) {
  const { t } = useTranslation();
  const isCanvasReadOnly = useCanvasReadOnly();
  const [nodeName, setNodeName] = useState<string>(display_name ?? "");
  const takeSnapshot = useFlowsManagerStore((state) => state.takeSnapshot);
  const setNode = useFlowStore((state) => state.setNode);

  useEffect(() => {
    if (!isCanvasReadOnly && selected && editNameDescription) {
      takeSnapshot();
    }
  }, [editNameDescription, isCanvasReadOnly, selected, takeSnapshot]);

  useEffect(() => {
    setNodeName(display_name ?? "");
  }, [display_name]);

  const handleBlur = () => {
    if (isCanvasReadOnly) return;
    if (nodeName?.trim() !== "") {
      setNodeName(nodeName);
      setNode(nodeId, (old) => ({
        ...old,
        data: {
          ...old.data,
          node: {
            ...old.data.node,
            display_name: nodeName,
          },
        },
      }));
    } else {
      setNodeName(display_name ?? "");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isCanvasReadOnly) return;
    if (e.key === "Enter") {
      handleBlur();
      toggleEditNameDescription();
    }
    if (e.key === "Escape") {
      setNodeName(display_name ?? "");
      toggleEditNameDescription();
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isCanvasReadOnly) return;
    setNodeName(e.target.value);
    setHasChangedNodeDescription(true);
  };

  return editNameDescription && !isCanvasReadOnly ? (
    <div className="w-full">
      <Input
        onBlur={handleBlur}
        value={nodeName}
        autoFocus
        onChange={onChange}
        data-testid={`input-title-${display_name}`}
        onKeyDown={handleKeyDown}
        className="px-2 py-0"
      />
    </div>
  ) : (
    <div className="group my-px flex flex-1 items-center gap-2 overflow-hidden">
      <div
        data-testid={"title-" + display_name}
        className={cn(
          "nodoubleclick truncate font-medium text-primary",
          showNode && !isCanvasReadOnly ? "cursor-text" : "cursor-default",
        )}
      >
        <div className="flex cursor-grab items-center gap-2">
          <span
            className={cn("cursor-grab truncate text-base")}
            data-testid="node-name"
          >
            {display_name}
          </span>
          {legacy && (
            <div className="shrink-0">
              <div className="flex items-center text-xxs justify-center rounded-sm border border-accent-amber text-accent-amber-foreground px-1">
                {t("sidebar.legacyLabel")}
              </div>
            </div>
          )}
        </div>
      </div>
      {beta && (
        <div className="shrink-0">
          <ShadTooltip content={t("node.betaComponent")}>
            <div className="flex h-4 w-4 items-center justify-center rounded-sm border border-accent-purple-foreground p-0.5">
              <ForwardedIconComponent
                name="FlaskConical"
                className="text-accent-purple-foreground"
              />
            </div>
          </ShadTooltip>
        </div>
      )}
    </div>
  );
}
