import { useTranslation } from "react-i18next";

import type { AutomationSummary } from "@/types/flow/automation";

export type AutomationPreviewProps = Readonly<{
  summary: AutomationSummary;
}>;

export function AutomationPreview({ summary }: AutomationPreviewProps) {
  const { t } = useTranslation();
  const description = summary.description?.trim();
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="truncate font-medium text-foreground">{summary.name}</h3>
      <p
        className="line-clamp-3 overflow-hidden break-words text-sm text-muted-foreground"
        data-testid="automation-preview-description"
      >
        {description || t("board.automation.descriptionEmpty")}
      </p>
    </section>
  );
}

export default AutomationPreview;
