import {
  getLocalizedApiErrorMessage,
  type LocalizedApiErrorTranslate,
} from "@/utils/localized-api-error";

/** Resolves stable API codes for UI presentation, then uses a safe fallback. */
export function extractApiErrorMessage(
  error: { response?: { data?: { detail?: unknown } }; message?: string },
  fallback: string,
  translate?: LocalizedApiErrorTranslate,
): string {
  if (translate) {
    return getLocalizedApiErrorMessage(error, translate, {
      fallbackKey: "errors.requestFailed",
    });
  }

  return fallback;
}

/**
 * Normalizes raw legacy error payloads for diagnostics and logging only.
 * Native UI call sites must use `extractApiErrorMessage` instead.
 */
export function extractApiErrorDiagnosticMessage(
  error: { response?: { data?: { detail?: unknown } }; message?: string },
  fallback: string,
): string {
  const detail = error.response?.data?.detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((d: Record<string, unknown>) =>
        typeof d.msg === "string" ? d.msg : String(d),
      )
      .join("; ");
  }

  if (detail && typeof detail === "object") {
    const obj = detail as Record<string, unknown>;
    if (typeof obj.msg === "string") return obj.msg;
    if (typeof obj.message === "string") return obj.message;
    return JSON.stringify(detail);
  }

  return error.message || fallback;
}
