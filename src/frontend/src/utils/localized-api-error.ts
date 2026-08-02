import {
  type ApiErrorTranslationKey,
  localizeApiErrorCode,
} from "./localize-api-error";

export type SemanticErrorKey =
  | "errors.unauthorized"
  | "errors.forbidden"
  | "errors.conflict"
  | "errors.validation"
  | "errors.rateLimited"
  | "errors.serverUnavailable"
  | "errors.requestFailed"
  | "auth.invalidCredentials"
  | "auth.accountExists"
  | ApiErrorTranslationKey;

export type LocalizedApiErrorTranslate = (
  key: SemanticErrorKey,
  params?: Record<string, string | number | boolean | null>,
) => string;

type LocalizedApiErrorOptions = {
  fallbackKey: SemanticErrorKey;
  statusKeys?: Partial<Record<number, SemanticErrorKey>>;
};

const DEFAULT_STATUS_KEYS: Partial<Record<number, SemanticErrorKey>> = {
  401: "errors.unauthorized",
  403: "errors.forbidden",
  409: "errors.conflict",
  422: "errors.validation",
  429: "errors.rateLimited",
};

function getResponseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return undefined;
  }

  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== "object" || !("status" in response)) {
    return undefined;
  }

  const status = (response as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Converts an API failure into a stable user-facing translation without ever
 * exposing backend detail, exception messages, stack traces, or payloads.
 */
export function getLocalizedApiErrorMessage(
  error: unknown,
  translate: LocalizedApiErrorTranslate,
  { fallbackKey, statusKeys = {} }: LocalizedApiErrorOptions,
): string {
  const codedMessage = localizeApiErrorCode(error, translate);
  if (codedMessage !== undefined) return codedMessage;

  const status = getResponseStatus(error);
  const key =
    (status === undefined ? undefined : statusKeys[status]) ??
    (status === undefined ? undefined : DEFAULT_STATUS_KEYS[status]) ??
    (status !== undefined && status >= 500
      ? "errors.serverUnavailable"
      : fallbackKey);

  return translate(key);
}
