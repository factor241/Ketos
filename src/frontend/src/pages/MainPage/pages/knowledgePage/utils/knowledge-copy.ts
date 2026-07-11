import type { IngestionRunInfo } from "@/controllers/API/queries/knowledge-bases/use-get-ingestion-runs";
import { formatNumber } from "@/utils/locale-format";

type TranslateParams = Record<string, unknown>;
export type KnowledgeTranslator = (
  key: string,
  params?: TranslateParams,
) => string;

export interface IngestionFinishedToast {
  kind: "success" | "notice";
  title: string;
}

export const getKnowledgeBaseDeleteDescription = (
  name: string,
  t: KnowledgeTranslator,
): string => t("knowledge.namedBaseDescription", { name });

export const getSelectedKnowledgeBasesDeleteDescription = (
  count: number,
  t: KnowledgeTranslator,
): string =>
  count === 1
    ? t("knowledge.selectedBaseDescription")
    : t("knowledge.selectedBasesDescription", {
        count: formatNumber(count),
      });

export const getKnowledgeBasesSkippedNote = (
  count: number,
  note: string,
  t: KnowledgeTranslator,
): string =>
  t("knowledge.ingestingBasesSkipped", {
    count: formatNumber(count),
    note,
  });

const getLocalizedIngestionStatus = (
  status: string,
  t: KnowledgeTranslator,
): string => {
  switch (status) {
    case "cancelled":
      return t("knowledge.ingestionStatus.cancelled");
    case "failed":
      return t("knowledge.ingestionStatus.failed");
    case "partial":
      return t("knowledge.ingestionStatus.partial");
    case "pending":
      return t("knowledge.ingestionStatus.pending");
    case "running":
      return t("knowledge.ingestionStatus.running");
    case "skipped":
      return t("knowledge.ingestionStatus.skipped");
    case "succeeded":
      return t("knowledge.ingestionStatus.succeeded");
    default:
      return t("knowledge.unknown");
  }
};

const getIngestionBreakdown = (
  run: IngestionRunInfo,
  t: KnowledgeTranslator,
): string => {
  const parts: string[] = [];

  if (run.succeeded > 0) {
    parts.push(
      `${t("knowledge.metricSucceeded")}: ${formatNumber(run.succeeded)}`,
    );
  }
  if (run.skipped > 0) {
    parts.push(`${t("knowledge.metricSkipped")}: ${formatNumber(run.skipped)}`);
  }
  if (run.failed > 0) {
    parts.push(`${t("knowledge.metricFailed")}: ${formatNumber(run.failed)}`);
  }

  return parts.length > 0 ? parts.join(", ") : t("knowledge.noItemsProcessed");
};

export const formatIngestionFinishedTitle = (
  kbName: string,
  fallbackChunks: number,
  run: IngestionRunInfo | null,
  t: KnowledgeTranslator,
): IngestionFinishedToast => {
  if (!run) {
    return {
      kind: "success",
      title: t("knowledge.ingestionComplete", {
        name: kbName,
        chunks: formatNumber(fallbackChunks),
      }),
    };
  }

  if (run.status === "succeeded") {
    return {
      kind: "success",
      title: t("knowledge.ingestionSucceeded", {
        name: kbName,
        chunks: formatNumber(run.chunks_created),
      }),
    };
  }

  const breakdown = getIngestionBreakdown(run, t);

  if (run.status === "partial") {
    const chunks =
      run.chunks_created > 0
        ? ` · ${t("knowledge.chunksIngested", {
            count: formatNumber(run.chunks_created),
          })}`
        : "";
    return {
      kind: "notice",
      title: t("knowledge.ingestionFinishedWithIssues", {
        name: kbName,
        details: `${breakdown}${chunks}`,
      }),
    };
  }

  return {
    kind: "notice",
    title: t("knowledge.ingestionFinishedStatus", {
      name: kbName,
      status: getLocalizedIngestionStatus(run.status, t),
      details: breakdown,
    }),
  };
};
