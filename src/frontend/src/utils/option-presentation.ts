export type OptionPresentationMetadata = Record<string, unknown> & {
  value?: unknown;
  label?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function identity(value: unknown): unknown {
  const record = asRecord(value);
  return record?.id ?? record?.value ?? record?.name ?? value;
}

export function findOptionIndex(
  option: unknown,
  options: readonly unknown[],
): number {
  const directIndex = options.indexOf(option);
  if (directIndex >= 0) return directIndex;

  const optionIdentity = identity(option);
  return options.findIndex(
    (candidate) =>
      optionIdentity !== undefined &&
      Object.is(identity(candidate), optionIdentity),
  );
}

export function getOptionMetadata(
  option: unknown,
  options: readonly unknown[] = [],
  metadata: readonly OptionPresentationMetadata[] = [],
): OptionPresentationMetadata | undefined {
  const optionIdentity = identity(option);
  const explicit = metadata.find((entry) => {
    if (!("value" in entry)) return false;
    return Object.is(identity(entry.value), optionIdentity);
  });
  if (explicit) return explicit;

  const index = findOptionIndex(option, options);
  return index >= 0 ? metadata[index] : undefined;
}

function rawOptionLabel(option: unknown): string {
  if (typeof option === "string") return option;
  if (typeof option === "number" || typeof option === "boolean") {
    return String(option);
  }

  const record = asRecord(option);
  for (const key of ["name", "label", "display_name", "value"] as const) {
    const candidate = record?.[key];
    if (
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      typeof candidate === "boolean"
    ) {
      return String(candidate);
    }
  }
  return "";
}

export function getOptionLabel(
  option: unknown,
  options: readonly unknown[] = [],
  metadata: readonly OptionPresentationMetadata[] = [],
): string {
  const label = getOptionMetadata(option, options, metadata)?.label;
  return typeof label === "string" && label.length > 0
    ? label
    : rawOptionLabel(option);
}
