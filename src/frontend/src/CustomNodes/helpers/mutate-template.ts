import { cloneDeep, debounce } from "lodash";
import { SAVE_DEBOUNCE_TIME } from "@/constants/constants";
import type { APIClassType } from "@/types/api";
import { getLocalizedApiErrorMessage } from "@/utils/localized-api-error";
import i18n from "../../i18n";
import { updateHiddenOutputs } from "./update-hidden-outputs";

type PostTemplateValueMutation = {
  mutateAsync: (variables: {
    value: unknown;
    field_name?: string;
    tool_mode?: boolean;
    is_refresh?: boolean;
  }) => Promise<APIClassType | undefined>;
};

// Map to store debounced functions for each node ID + parameter combination
const debouncedFunctions = new Map<string, ReturnType<typeof debounce>>();

export const mutateTemplate = async (
  newValue,
  nodeId: string,
  node: APIClassType,
  setNodeClass,
  postTemplateValue: PostTemplateValueMutation,
  setErrorData,
  parameterName?: string,
  callback?: () => void,
  toolMode?: boolean,
  isRefresh?: boolean,
) => {
  // Different parameters must debounce independently to avoid one field's
  // refresh cancelling another's during concurrent mount calls.
  const debounceKey = parameterName ? `${nodeId}-${parameterName}` : nodeId;
  if (!debouncedFunctions.has(debounceKey)) {
    debouncedFunctions.set(
      debounceKey,
      debounce(
        async (
          newValue,
          node: APIClassType,
          setNodeClass,
          postTemplateValue: PostTemplateValueMutation,
          setErrorData,
          parameterName?: string,
          callback?: () => void,
          toolMode?: boolean,
          isRefresh?: boolean,
        ) => {
          try {
            const newNode = cloneDeep(node);
            const newTemplate = await postTemplateValue.mutateAsync({
              value: newValue,
              field_name: parameterName,
              tool_mode: toolMode ?? node.tool_mode,
              is_refresh: isRefresh ?? false,
            });
            if (newTemplate) {
              newNode.template = newTemplate.template;
              newNode.outputs = updateHiddenOutputs(
                newNode.outputs ?? [],
                newTemplate.outputs ?? [],
              );
              newNode.tool_mode = toolMode ?? node.tool_mode;
              newNode.last_updated = newTemplate.last_updated;
              try {
                setNodeClass(newNode);
              } catch (e) {
                if (e instanceof Error && e.message === "Node not found") {
                  console.error("Node not found");
                } else {
                  throw e;
                }
              }
            }
            callback?.();
          } catch (error: unknown) {
            setErrorData({
              title: i18n.t("input.titleErrorUpdatingComponent"),
              list: [
                getLocalizedApiErrorMessage(
                  error,
                  (key, params) => i18n.t(key, params),
                  { fallbackKey: "errors.requestFailed" },
                ),
              ],
            });
          }
        },
        SAVE_DEBOUNCE_TIME,
      ),
    );
  }

  debouncedFunctions.get(debounceKey)?.(
    newValue,
    node,
    setNodeClass,
    postTemplateValue,
    setErrorData,
    parameterName,
    callback,
    toolMode,
    isRefresh,
  );
};
