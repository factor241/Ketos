import { useTranslation } from "react-i18next";
import { normalizeLanguage } from "@/constants/languages";
import { ENABLE_KNOWLEDGE_BASES } from "@/customization/feature-flags";
import {
  recomputeComponentsToUpdateIfNeeded,
  syncNodeTranslations,
} from "@/stores/flowStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import { useTypesStore } from "@/stores/typesStore";
import type {
  APIObjectType,
  ComponentDisplayNamesType,
  useQueryFunctionType,
} from "../../../../types/api";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";

export const useGetTypes: useQueryFunctionType<
  undefined,
  APIObjectType,
  { checkCache?: boolean }
> = (options) => {
  const { query } = UseRequestProcessor();
  const { i18n } = useTranslation();
  const requestLanguage = normalizeLanguage(
    i18n.resolvedLanguage || i18n.language,
  );
  const setLoading = useFlowsManagerStore((state) => state.setIsLoading);
  const setTypes = useTypesStore((state) => state.setTypes);
  const setComponentDisplayNames = useTypesStore(
    (state) => state.setComponentDisplayNames,
  );

  const getTypesFn = async (checkCache = false) => {
    try {
      if (checkCache) {
        const data = useTypesStore.getState().types;
        if (data && Object.keys(data).length > 0) {
          return data;
        }
      }

      const response = await api.get<APIObjectType>(
        `${getURL("ALL")}?force_refresh=true`,
      );
      const raw = response?.data as Record<string, unknown>;

      const componentDisplayNames = raw?.component_display_names as
        | ComponentDisplayNamesType
        | undefined;
      delete raw.component_display_names;
      const data = raw as APIObjectType;

      if (!ENABLE_KNOWLEDGE_BASES) {
        delete data.knowledge_bases;
      }

      if (
        normalizeLanguage(i18n.resolvedLanguage || i18n.language) !==
        requestLanguage
      ) {
        return data;
      }

      if (componentDisplayNames) {
        setComponentDisplayNames(componentDisplayNames);
      }
      setTypes(data);
      syncNodeTranslations();
      recomputeComponentsToUpdateIfNeeded();
      return data;
    } catch (error) {
      console.error("[Types] Error fetching types:", error);
      setLoading(false);
      throw error;
    }
  };

  const queryResult = query(
    ["useGetTypes", requestLanguage],
    () => getTypesFn(options?.checkCache),
    {
      refetchOnWindowFocus: false,
      ...options,
    },
  );

  return queryResult;
};
