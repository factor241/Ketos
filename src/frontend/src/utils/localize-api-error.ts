export const API_ERROR_KEY_BY_CODE = {
  "request.bad_request": "apiErrors.request.badRequest",
  "request.validation_failed": "apiErrors.request.validationFailed",
  "request.rate_limited": "apiErrors.request.rateLimited",
  "server.internal_error": "apiErrors.server.internal",
  "auth.invalid_credentials": "apiErrors.auth.invalidCredentials",
  "auth.missing_credentials": "apiErrors.auth.missingCredentials",
  "auth.inactive_user": "apiErrors.auth.inactiveUser",
  "auth.insufficient_permissions": "apiErrors.auth.insufficientPermissions",
  "auth.token_expired": "apiErrors.auth.tokenExpired",
  "auth.invalid_token": "apiErrors.auth.invalidToken",
  "flows.not_found": "apiErrors.flows.notFound",
  "flows.already_exists": "apiErrors.flows.alreadyExists",
  "flows.invalid": "apiErrors.flows.invalid",
  "files.not_found": "apiErrors.files.notFound",
  "files.invalid": "apiErrors.files.invalid",
  "files.too_large": "apiErrors.files.tooLarge",
  "files.storage_error": "apiErrors.files.storageError",
  "knowledge.not_found": "apiErrors.knowledge.notFound",
  "knowledge.already_exists": "apiErrors.knowledge.alreadyExists",
  "knowledge.invalid_name": "apiErrors.knowledge.invalidName",
  "knowledge.no_files": "apiErrors.knowledge.noFiles",
  "deployments.not_found": "apiErrors.deployments.notFound",
  "deployments.conflict": "apiErrors.deployments.conflict",
  "deployments.update_failed": "apiErrors.deployments.updateFailed",
  "mcp.invalid_json": "apiErrors.mcp.invalidJson",
  "mcp.server_exists": "apiErrors.mcp.serverExists",
  "mcp.server_not_found": "apiErrors.mcp.serverNotFound",
  "components.not_found": "apiErrors.components.notFound",
  "components.update_failed": "apiErrors.components.updateFailed",
  "extensions.invalid_manifest": "apiErrors.extensions.invalidManifest",
  "extensions.reload_failed": "apiErrors.extensions.reloadFailed",
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_KEY_BY_CODE;
export type ApiErrorTranslationKey =
  | (typeof API_ERROR_KEY_BY_CODE)[ApiErrorCode]
  | "apiErrors.unknownCode";

type JsonScalar = string | number | boolean | null;
export type ApiErrorTranslate = (
  key: ApiErrorTranslationKey,
  params?: Record<string, JsonScalar>,
) => string;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getErrorPayload(error: unknown): Record<string, unknown> | undefined {
  const root = asRecord(error);
  const response = asRecord(root?.response);
  return asRecord(response?.data) ?? root;
}

function sanitizeParams(value: unknown): Record<string, JsonScalar> {
  const params = asRecord(value);
  if (!params) return {};

  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, JsonScalar] => {
      const candidate = entry[1];
      return (
        candidate === null ||
        typeof candidate === "string" ||
        typeof candidate === "boolean" ||
        (typeof candidate === "number" && Number.isFinite(candidate))
      );
    }),
  );
}

/**
 * Resolves first-party stable API error codes without exposing raw backend
 * details. Legacy responses deliberately return undefined for status fallback.
 */
export function localizeApiErrorCode(
  error: unknown,
  translate: ApiErrorTranslate,
): string | undefined {
  const payload = getErrorPayload(error);
  const code = payload?.code;
  if (typeof code !== "string" || code.length === 0) return undefined;

  const key = API_ERROR_KEY_BY_CODE[code as ApiErrorCode];
  if (!key) return translate("apiErrors.unknownCode", { code });

  return translate(key, sanitizeParams(payload?.params));
}
