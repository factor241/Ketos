import type { ReactFlowJsonObject } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { useGetFlow } from "@/controllers/API/queries/flows/use-get-flow";
import { usePatchUpdateFlow } from "@/controllers/API/queries/flows/use-patch-update-flow";
import useAlertStore from "@/stores/alertStore";
import useFlowStore from "@/stores/flowStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import type { AllNodeType, EdgeType, FlowType } from "@/types/flow";
import { getLocalizedApiErrorMessage } from "@/utils/localized-api-error";
import { customStringify } from "@/utils/reactflowUtils";

const useSaveFlow = () => {
  const { t } = useTranslation();
  const setFlows = useFlowsManagerStore((state) => state.setFlows);
  const setErrorData = useAlertStore((state) => state.setErrorData);
  const setSaveLoading = useFlowsManagerStore((state) => state.setSaveLoading);
  const setCanvasCurrentFlow = useFlowStore((state) => state.setCurrentFlow);

  const { mutate: getFlow } = useGetFlow();
  const { mutate } = usePatchUpdateFlow();

  const saveFlow = async (flow?: FlowType): Promise<void> => {
    const currentFlow = useFlowStore.getState().currentFlow;
    const currentSavedFlow = useFlowsManagerStore.getState().currentFlow;
    if (
      customStringify(flow || currentFlow) !== customStringify(currentSavedFlow)
    ) {
      setSaveLoading(true);

      const flowData = currentFlow?.data;
      const nodes = useFlowStore.getState().nodes;
      const edges = useFlowStore.getState().edges;
      const reactFlowInstance = useFlowStore.getState().reactFlowInstance;

      return new Promise<void>((resolve, reject) => {
        if (currentFlow) {
          flow = flow || {
            ...currentFlow,
            data: {
              ...flowData,
              nodes,
              edges,
              viewport: reactFlowInstance?.getViewport() ?? {
                zoom: 1,
                x: 0,
                y: 0,
              },
            },
          };
        }

        if (flow) {
          if (!flow?.data) {
            getFlow(
              { id: flow!.id },
              {
                onSuccess: (flowResponse) => {
                  flow!.data = flowResponse.data as ReactFlowJsonObject<
                    AllNodeType,
                    EdgeType
                  >;
                },
              },
            );
          }

          const {
            id,
            name,
            data,
            description,
            folder_id,
            endpoint_name,
            locked,
          } = flow;
          mutate(
            {
              id,
              name,
              data: data!,
              description,
              folder_id,
              endpoint_name,
              locked,
            },
            {
              onSuccess: (updatedFlow) => {
                const flows = useFlowsManagerStore.getState().flows;
                const onFlowPage = useFlowStore.getState().onFlowPage;
                setSaveLoading(false);
                if (flows) {
                  // updates flow in state
                  setFlows(
                    flows.some((flow) => flow.id === updatedFlow.id)
                      ? flows.map((flow) =>
                          flow.id === updatedFlow.id ? updatedFlow : flow,
                        )
                      : [...flows, updatedFlow],
                  );
                } else if (onFlowPage) {
                  // A canonical /flow/:id deep link intentionally loads only the
                  // current Flow. Keep its saved baseline in sync without
                  // requiring the dashboard's global Flow list.
                  setFlows([updatedFlow]);
                } else {
                  setErrorData({
                    title: t("errors.failedToSaveFlow"),
                    list: [t("errors.flowsVariableUndefined")],
                  });
                  reject(new Error("Flows variable undefined"));
                  return;
                }
                // Only update useFlowStore.currentFlow when on the flow page.
                // When saving from the list page (e.g., renaming via settings modal),
                // setting this would leave stale unprocessed flow data in the store,
                // causing a crash when the user later navigates to the flow page.
                if (onFlowPage && flows) {
                  setCanvasCurrentFlow(updatedFlow);
                }
                resolve();
              },
              onError: (error: unknown) => {
                setErrorData({
                  title: t("errors.failedToSaveFlow"),
                  list: [
                    getLocalizedApiErrorMessage(
                      error,
                      (key, params) => t(key, params),
                      { fallbackKey: "errors.requestFailed" },
                    ),
                  ],
                });
                setSaveLoading(false);
                reject(error);
              },
            },
          );
        } else {
          setErrorData({
            title: t("errors.failedToSaveFlow"),
            list: [t("errors.flowNotFound")],
          });
          reject(new Error("Flow not found"));
        }
      });
    }
  };

  return saveFlow;
};

export default useSaveFlow;
