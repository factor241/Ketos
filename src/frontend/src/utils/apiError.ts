import i18n from "../i18n";
import {
  getLocalizedApiErrorMessage,
  type LocalizedApiErrorTranslate,
} from "./localized-api-error";

/**
 * Shape produced by FastAPI validation errors and generic axios responses.
 * Kept internal — callers receive plain strings.
 */
type ApiDetailEntry = { msg?: string } | string;

type ApiErrorShape = {
  response?: { data?: { detail?: ApiDetailEntry[] | string } };
  message?: string;
};

/**
 * Resolves a stable API code for UI presentation without exposing backend
 * payloads. Legacy responses use a generic compatibility fallback.
 */
export function extractApiErrorMessages(
  error: unknown,
  translate?: LocalizedApiErrorTranslate,
): string[] {
  const activeTranslate: LocalizedApiErrorTranslate =
    translate ?? ((key, params) => i18n.t(key, params));

  return [
    getLocalizedApiErrorMessage(error, activeTranslate, {
      fallbackKey: "errors.requestFailed",
    }),
  ];
}

/**
 * Extracts raw legacy response text for diagnostics and logging only.
 * Native UI call sites must use `extractApiErrorMessages` instead.
 */
export function extractApiErrorDiagnosticMessages(error: unknown): string[] {
  if (!error || typeof error !== "object") {
    return ["An unknown error occurred"];
  }

  const e = error as ApiErrorShape;
  const detail = e.response?.data?.detail;

  if (Array.isArray(detail)) {
    const msgs = detail
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const msg = (entry as { msg?: string }).msg;
          return typeof msg === "string" ? msg : JSON.stringify(entry);
        }
        return String(entry);
      })
      .filter(Boolean);
    if (msgs.length > 0) return msgs;
  }

  if (typeof detail === "string" && detail) return [detail];
  if (typeof e.message === "string" && e.message) return [e.message];
  return ["An unknown error occurred"];
}
