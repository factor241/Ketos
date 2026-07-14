import { getLanguageDefinition } from "@/constants/languages";
import i18n from "@/i18n";

export type LocaleDateInput = Date | string | number;

const toDate = (value: LocaleDateInput): Date =>
  value instanceof Date ? value : new Date(value);

export function getIntlLocale(language?: string | null): string {
  const activeLanguage =
    language ?? i18n.language ?? i18n.resolvedLanguage ?? undefined;
  return getLanguageDefinition(activeLanguage).locale;
}

export function formatDate(
  value: LocaleDateInput,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  },
): string {
  return new Intl.DateTimeFormat(getIntlLocale(), options).format(
    toDate(value),
  );
}

export function formatDateTime(
  value: LocaleDateInput,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  return new Intl.DateTimeFormat(getIntlLocale(), options).format(
    toDate(value),
  );
}

export function formatNumber(
  value: number | bigint,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(getIntlLocale(), options).format(value);
}

export function formatCompactNumber(value: number | undefined): string {
  return formatNumber(value ?? 0, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 0,
  });
}

export function formatCurrency(
  value: number | bigint,
  currency: string,
  options?: Omit<Intl.NumberFormatOptions, "currency" | "style">,
): string {
  return new Intl.NumberFormat(getIntlLocale(), {
    ...options,
    style: "currency",
    currency,
  }).format(value);
}

const durationUnits = [
  { unit: "hour", milliseconds: 60 * 60 * 1000 },
  { unit: "minute", milliseconds: 60 * 1000 },
  { unit: "second", milliseconds: 1000 },
  { unit: "millisecond", milliseconds: 1 },
] as const;

export function formatDuration(milliseconds: number): string {
  let remainder = Math.max(0, Math.round(milliseconds));
  const locale = getIntlLocale();
  const parts: string[] = [];

  for (const { unit, milliseconds: unitMilliseconds } of durationUnits) {
    const amount = Math.floor(remainder / unitMilliseconds);
    remainder %= unitMilliseconds;
    if (amount === 0) continue;

    parts.push(
      new Intl.NumberFormat(locale, {
        style: "unit",
        unit,
        unitDisplay: "short",
      }).format(amount),
    );
  }

  if (parts.length === 0) {
    parts.push(
      new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "millisecond",
        unitDisplay: "short",
      }).format(0),
    );
  }

  return new Intl.ListFormat(locale, {
    style: "short",
    type: "conjunction",
  }).format(parts);
}

const relativeUnits = [
  { unit: "year", milliseconds: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", milliseconds: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", milliseconds: 24 * 60 * 60 * 1000 },
  { unit: "hour", milliseconds: 60 * 60 * 1000 },
  { unit: "minute", milliseconds: 60 * 1000 },
  { unit: "second", milliseconds: 1000 },
] as const;

export function formatRelativeTime(
  value: LocaleDateInput,
  relativeTo: LocaleDateInput = Date.now(),
  language?: string | null,
): string {
  const difference = toDate(value).getTime() - toDate(relativeTo).getTime();
  const absoluteDifference = Math.abs(difference);
  const selectedUnit =
    relativeUnits.find(
      ({ milliseconds }) => absoluteDifference >= milliseconds,
    ) ?? relativeUnits.at(-1)!;
  const amount = Math.round(difference / selectedUnit.milliseconds);

  return new Intl.RelativeTimeFormat(getIntlLocale(language), {
    numeric: "always",
  }).format(amount, selectedUnit.unit);
}

export function compareForPresentation(left: string, right: string): number {
  return new Intl.Collator(getIntlLocale(), {
    sensitivity: "accent",
    numeric: true,
  }).compare(left, right);
}
