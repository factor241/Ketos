import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import type { FlowCommandPreviewData } from "@/types/flow";

export type FlowCommandPreviewProps = Readonly<{
  preview: FlowCommandPreviewData;
}>;

const MAX_VISIBLE_OPERATIONS = 12;
const MAX_VISIBLE_WARNINGS = 5;

export function FlowCommandPreview({ preview }: FlowCommandPreviewProps) {
  const { t } = useTranslation();
  const operations = preview.operationSummaries.slice(
    0,
    MAX_VISIBLE_OPERATIONS,
  );
  const warnings = preview.warnings.slice(0, MAX_VISIBLE_WARNINGS);
  const riskLabel =
    preview.risk === "low"
      ? t("flowCommand.risk.low")
      : preview.risk === "medium"
        ? t("flowCommand.risk.medium")
        : t("flowCommand.risk.high");
  return (
    <div className="space-y-3 text-sm" data-testid="flow-command-preview">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={preview.risk === "high" ? "errorStatic" : "secondaryStatic"}
          size="tag"
        >
          {riskLabel}
        </Badge>
        <span className="text-muted-foreground">
          {t("flowCommand.revision", {
            before: preview.before.revision ?? "—",
            after: preview.after.revision ?? "—",
          })}
        </span>
      </div>
      <ul className="space-y-1" aria-label={t("flowCommand.operationsLabel")}>
        {operations.map((operation) => (
          <li
            key={`${operation.index}-${operation.op}`}
            className="break-words rounded-md bg-background px-2 py-1.5"
          >
            {operation.summary}
          </li>
        ))}
      </ul>
      {warnings.length > 0 ? (
        <div className="rounded-md border border-accent-amber-foreground/40 bg-accent-amber/30 p-2">
          <p className="font-medium">{t("flowCommand.warnings")}</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {warnings.map((warning) => (
              <li key={warning} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default FlowCommandPreview;
