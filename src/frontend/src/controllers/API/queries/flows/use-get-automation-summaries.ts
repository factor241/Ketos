import type { useQueryFunctionType } from "@/types/api";
import type { AutomationSummary } from "@/types/flow/automation";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";

type AutomationSummaryWire = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  [key: string]: unknown;
};

export const automationSummaryKeys = {
  project: (projectId: string) =>
    [["automation", "summaries"].join("-"), projectId] as const,
};

export const mapAutomationSummary = (
  row: AutomationSummaryWire,
): AutomationSummary => ({
  id: String(row.id),
  name: String(row.name),
  description: typeof row.description === "string" ? row.description : null,
});

export const useGetAutomationSummaries: useQueryFunctionType<
  { projectId: string },
  AutomationSummary[]
> = ({ projectId }, options) => {
  const { query } = UseRequestProcessor();
  return query(
    automationSummaryKeys.project(projectId),
    async () => {
      const search = new URLSearchParams({
        get_all: "true",
        header_flows: "true",
        automation_summaries: "true",
        folder_id: projectId,
      });
      const response = await api.get<AutomationSummaryWire[]>(
        `${getURL("FLOWS")}/?${search.toString()}`,
      );
      return response.data.map(mapAutomationSummary);
    },
    {
      ...options,
      enabled: Boolean(projectId) && (options?.enabled ?? true),
    },
  );
};
