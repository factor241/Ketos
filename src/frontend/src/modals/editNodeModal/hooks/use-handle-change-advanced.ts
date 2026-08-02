import { cloneDeep } from "lodash";
import type { AllNodeType, NodeDataType } from "../../../types/flow";

const useHandleChangeAdvanced = (
  data: NodeDataType,
  takeSnapshot: () => void,
  setNode: (
    id: string,
    callback: (oldNode: AllNodeType) => AllNodeType,
  ) => void,
  updateNodeInternals: (id: string) => void,
) => {
  const handleChangeAdvanced = (name) => {
    if (!data.node) return;
    takeSnapshot();

    setNode(data.id, (oldNode) => {
      const newNode = cloneDeep(oldNode);

      if (!("node" in newNode.data)) return newNode;

      newNode.data.node.template[name].advanced =
        !newNode.data.node.template[name].advanced;

      return newNode;
    });

    updateNodeInternals(data.id);
  };

  return { handleChangeAdvanced };
};

export default useHandleChangeAdvanced;
