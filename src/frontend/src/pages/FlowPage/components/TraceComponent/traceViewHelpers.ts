import i18n from "@/i18n";
import {
  formatCurrency,
  formatDate as formatLocaleDate,
  formatNumber,
} from "@/utils/locale-format";
import type { Span, SpanType, StatusIconProps } from "./types";

export const getSpanIcon = (type: SpanType): string => {
  const iconMap: Record<SpanType, string> = {
    agent: "Bot",
    chain: "Link",
    llm: "MessageSquare",
    tool: "Wrench",
    retriever: "Search",
    embedding: "Hash",
    parser: "FileText",
    none: "Workflow",
  };
  const icon = iconMap[type];
  return icon === undefined ? "Circle" : icon;
};

export const getStatusVariant = (
  status: Span["status"],
): "successStatic" | "errorStatic" | "secondaryStatic" => {
  switch (status) {
    case "ok":
      return "successStatic";
    case "error":
      return "errorStatic";
    case "unset":
      return "secondaryStatic";
    default:
      return "secondaryStatic";
  }
};

export const getSpanStatusLabel = (status: Span["status"]): string => {
  switch (status) {
    case "ok":
      return i18n.t("trace.success");
    case "error":
      return i18n.t("trace.error");
    case "unset":
      return i18n.t("chat.runningStatus");
    default:
      return status;
  }
};

export const formatTokens = (tokens: number | undefined): string | null => {
  if (tokens == null) return null;
  return formatNumber(tokens, {
    notation: tokens < 1000 ? "standard" : "compact",
    maximumFractionDigits: tokens < 1000 ? 0 : 1,
  });
};

export const getSpanTypeLabel = (type: SpanType): string => {
  const labelMap: Record<SpanType, string> = {
    agent: i18n.t("trace.spanType.agent"),
    chain: i18n.t("trace.spanType.chain"),
    llm: "LLM",
    tool: i18n.t("trace.spanType.tool"),
    retriever: i18n.t("trace.spanType.retriever"),
    embedding: i18n.t("trace.spanType.embedding"),
    parser: i18n.t("trace.spanType.parser"),
    none: "",
  };
  const label = labelMap[type];
  return label === undefined ? type : label;
};

export const formatCost = (cost: number | undefined): string => {
  const value = cost ?? 0;
  const fractionDigits = value > 0 && value < 0.01 ? 6 : value === 0 ? 2 : 4;
  return formatCurrency(value, "USD", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
};

export const formatJsonData = (data: Record<string, unknown>): string => {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
};

export const formatTotalLatency = (latencyMs: number | null): string => {
  if (latencyMs === null) return "";
  if (!Number.isFinite(latencyMs)) return "";
  if (latencyMs < 1000)
    return formatNumber(Math.round(latencyMs), {
      style: "unit",
      unit: "millisecond",
      unitDisplay: "short",
    });
  return formatNumber(latencyMs / 1000, {
    style: "unit",
    unit: "second",
    unitDisplay: "short",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const formatIOPreview = (
  data: Record<string, unknown> | string | null,
): string => {
  if (!data) return i18n.t("trace.notAvailable");

  if (typeof data === "string") {
    const strData = data as string;
    return strData.length > 150 ? strData.substring(0, 150) + "..." : strData;
  }

  const textFields = [
    "input_value",
    "message",
    "text",
    "content",
    "query",
    "question",
    "prompt",
    "input",
    "output",
    "result",
    "response",
  ];

  for (const field of textFields) {
    const value = data[field];
    if (value && typeof value === "string") {
      return value.length > 150 ? value.substring(0, 150) + "..." : value;
    }
  }

  for (const key of Object.keys(data)) {
    const value = data[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nestedData = value as Record<string, unknown>;
      for (const field of textFields) {
        if (nestedData[field] && typeof nestedData[field] === "string") {
          const text = nestedData[field] as string;
          return text.length > 150 ? text.substring(0, 150) + "..." : text;
        }
      }
    }
  }

  try {
    const str = JSON.stringify(data);
    if (str === "{}") return i18n.t("common.empty");
    return str.length > 150 ? str.substring(0, 150) + "..." : str;
  } catch {
    return i18n.t("trace.complexObject");
  }
};

export const getStatusIconProps = (
  status: string | null | undefined,
): StatusIconProps => {
  const normalized = status ?? "";
  const isOk = normalized === "ok";
  const isError = normalized === "error";
  const isUnset = normalized === "unset";

  return {
    colorClass: isError
      ? "text-status-red"
      : isOk
        ? "text-status-green"
        : "text-muted-foreground",
    iconName: isUnset ? "Loader2" : isOk ? "CircleCheck" : "CircleX",
    shouldSpin: isUnset,
  };
};

export const downloadJson = (fileName: string, value: unknown) => {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
};

export const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const endOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

export const formatDateLabel = (value: string): string => {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatLocaleDate(parsed, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export const toUtcIsoForDate = (
  value: string,
  isEnd: boolean,
): string | undefined => {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(
    Date.UTC(
      year,
      month,
      day,
      isEnd ? 23 : 0,
      isEnd ? 59 : 0,
      isEnd ? 59 : 0,
      isEnd ? 999 : 0,
    ),
  );
  return date.toISOString();
};
