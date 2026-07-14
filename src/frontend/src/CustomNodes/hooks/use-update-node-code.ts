import { cloneDeep } from "lodash"; // or any other deep cloning library you prefer
import { useCallback } from "react";
import useFlowStore from "@/stores/flowStore";
import type { APIClassType } from "../../types/api";
import type { FlowStoreType } from "../../types/zustand/flow";
import { updateHiddenOutputs } from "../helpers/update-hidden-outputs";

const useUpdateNodeCode = (
  dataId: string,
  dataNode: APIClassType, // Define YourNodeType according to your data structure
  setNode: FlowStoreType["setNode"],
  updateNodeInternals: (id: string) => void,
) => {
  const setComponentsToUpdate = useFlowStore(
    (state) => state.setComponentsToUpdate,
  );

  const updateNodeCode = useCallback(
    (newNodeClass: APIClassType, code: string, name: string, type: string) => {
      setNode(dataId, (oldNode) => {
        if (oldNode.type !== "genericNode") return oldNode;
        const newNode = cloneDeep(oldNode);

        newNode.data = Object.assign({}, newNode.data, {
          node: { ...newNodeClass, edited: false },
          description: newNodeClass.description ?? dataNode.description,
          display_name: newNodeClass.display_name ?? dataNode.display_name,
        });
        if (type) {
          newNode.data.type = type;
        }

        newNode.data.node.template[name].value = code;

        const outputs = dataNode.outputs;
        const updatedOutputs = newNodeClass.outputs;

        newNode.data.node!.outputs = updateHiddenOutputs(
          outputs!,
          updatedOutputs!,
        );

        return newNode;
      });

      setComponentsToUpdate((old) =>
        old.filter((component) => component.id !== dataId),
      );
      updateNodeInternals(dataId);
    },
    [dataId, dataNode, setNode, updateNodeInternals, setComponentsToUpdate],
  );

  return updateNodeCode;
};

export default useUpdateNodeCode;
