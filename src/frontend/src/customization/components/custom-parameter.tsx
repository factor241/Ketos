import type { handleOnNewValueType } from "@/CustomNodes/hooks/use-handle-new-value";
import { ParameterRenderComponent } from "@/components/core/parameterRenderComponent";
import type { NodeInfoType } from "@/components/core/parameterRenderComponent/types";
import { useCanvasReadOnly } from "@/contexts/canvas-read-only-context";
import useFlowStore from "@/stores/flowStore";
import type { APIClassType, InputFieldType } from "@/types/api";
import type { targetHandleType } from "@/types/flow";
import { scapedJSONStringfy } from "@/utils/reactflowUtils";
import { cn } from "@/utils/utils";

const ignoreParameterMutation: handleOnNewValueType = () => undefined;
const ignoreNodeClassMutation = () => undefined;

export function CustomParameterComponent({
  handleOnNewValue,
  name,
  nodeId,
  inputId,
  templateData,
  templateValue,
  showParameter,
  inspectionPanel = false,
  editNode,
  handleNodeClass,
  nodeClass,
  placeholder,
  isToolMode = false,
  nodeInformationMetadata,
  proxy,
}: {
  handleOnNewValue: handleOnNewValueType;
  name: string;
  nodeId: string;
  inputId: targetHandleType;
  templateData: Partial<InputFieldType>;
  templateValue: unknown;
  showParameter: boolean;
  inspectionPanel: boolean;
  editNode: boolean;
  handleNodeClass: (value: unknown, code?: string, type?: string) => void;
  nodeClass: APIClassType;
  placeholder?: string;
  isToolMode?: boolean;
  nodeInformationMetadata?: NodeInfoType;
  proxy: { field: string; id: string } | undefined;
}) {
  const edges = useFlowStore((state) => state.edges);
  const isCanvasReadOnly = useCanvasReadOnly();

  const disabled =
    isCanvasReadOnly ||
    edges.some(
      (edge) =>
        edge.targetHandle ===
        scapedJSONStringfy(proxy ? { ...inputId, proxy } : inputId),
    ) ||
    isToolMode;

  return (
    <ParameterRenderComponent
      handleOnNewValue={
        isCanvasReadOnly ? ignoreParameterMutation : handleOnNewValue
      }
      name={name}
      nodeId={nodeId}
      templateData={
        isCanvasReadOnly ? { ...templateData, readonly: true } : templateData
      }
      templateValue={templateValue}
      editNode={editNode}
      showParameter={showParameter}
      inspectionPanel={inspectionPanel}
      handleNodeClass={
        isCanvasReadOnly ? ignoreNodeClassMutation : handleNodeClass
      }
      nodeClass={nodeClass}
      disabled={disabled}
      placeholder={placeholder}
      isToolMode={isToolMode}
      nodeInformationMetadata={nodeInformationMetadata}
    />
  );
}

export function getCustomParameterTitle({
  title,
  nodeId,
  isFlexView,
  required,
  inspectionPanel,
}: {
  title: string;
  nodeId: string;
  isFlexView: boolean;
  required?: boolean;
  inspectionPanel?: boolean;
}) {
  return (
    <div className={cn(isFlexView && "max-w-56 truncate")}>
      <span
        data-testid={`title-${title.toLocaleLowerCase()}`}
        className={cn(
          inspectionPanel
            ? "text-xs font-medium"
            : "text-sm text-secondary-foreground",
        )}
      >
        {title}
      </span>
      {required && <span className="text-destructive">*</span>}
    </div>
  );
}

export function CustomParameterLabel({
  name,
  nodeId,
  templateValue,
  nodeClass,
}: {
  name: string;
  nodeId: string;
  templateValue: unknown;
  nodeClass: APIClassType;
}) {
  return <></>;
}
