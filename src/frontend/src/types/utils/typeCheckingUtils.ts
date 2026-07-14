import type { ErrorLogType } from "../api";

export function isErrorLogType(value: unknown): value is ErrorLogType {
  return (
    typeof value === "object" &&
    value !== null &&
    "errorMessage" in value &&
    typeof value.errorMessage === "string" &&
    "stackTrace" in value &&
    typeof value.stackTrace === "string"
  );
}

export function isErrorLog(
  log: unknown,
): log is { type: "error" | "ValueError"; message: ErrorLogType } {
  return (
    typeof log === "object" &&
    log !== null &&
    "type" in log &&
    (log.type === "error" || log.type === "ValueError") &&
    "message" in log &&
    isErrorLogType(log.message)
  );
}
