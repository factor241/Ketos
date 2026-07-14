/**
 * Shared formatting helpers for ExtensionError payloads emitted by the
 * reload pipeline.
 *
 * Both the click-initiated path (``bundleHeaderActions.tsx`` onSuccess) and
 * the polled-event path (``use-extension-events.ts`` bundle_reloaded handler)
 * need to render the same ``warnings`` / ``errors`` list into an alert-store
 * shape. Keeping the renderer in one module prevents the two paths from
 * drifting -- the original divergence (clicking tab surfaced warnings,
 * mirrored-event tabs did not) was the symptom of having the renderer
 * inlined in only one of them.
 */

import type { ExtensionErrorPayload } from "@/controllers/API/queries/extensions";
import i18n from "@/i18n";

export type TypedErrorAlertList = { title: string; list: string[] } | undefined;

type ExtensionDiagnosticTranslationKey =
  | "extensions.reloadDiagnostics"
  | "apiErrors.extensions.invalidManifest"
  | "apiErrors.extensions.reloadFailed"
  | "apiErrors.unknownCode";

type ExtensionDiagnosticTranslate = (
  key: ExtensionDiagnosticTranslationKey,
  params?: Record<string, string>,
) => string;

const INVALID_MANIFEST_CODES = new Set([
  "bundle-empty",
  "bundle-json-invalid",
  "bundle-path-not-found",
  "build-method-missing",
  "duplicate-bundle-name",
  "duplicate-component-name",
  "duplicate-inline-bundle",
  "field-deferred-in-this-milestone",
  "import-star-disallowed",
  "inline-bundle-name-invalid",
  "inline-path-missing",
  "inline-path-unreadable",
  "manifest-invalid",
  "manifest-not-found",
  "manifest-unreadable",
  "module-import-failed",
  "multi-bundle-unsupported",
  "no-component-subclass",
  "path-escape",
  "reload-bundle-name-mismatch",
  "reload-source-missing",
  "syntax-error",
  "top-level-io-disallowed",
  "version-constraint-unsatisfied",
]);

const RELOAD_FAILURE_CODES = new Set([
  "extension-reload-disabled",
  "reload-bundle-not-installed",
  "reload-class-retag-failed",
  "reload-failed",
  "reload_failed",
  "reload-in-progress",
  "reload-post-swap-hook-failed",
]);

function localizeExtensionDiagnostic(
  payload: ExtensionErrorPayload,
  translate: ExtensionDiagnosticTranslate,
): string {
  if (INVALID_MANIFEST_CODES.has(payload.code)) {
    return translate("apiErrors.extensions.invalidManifest");
  }
  if (RELOAD_FAILURE_CODES.has(payload.code)) {
    return translate("apiErrors.extensions.reloadFailed");
  }
  return translate("apiErrors.unknownCode", { code: payload.code });
}

/**
 * Render a list of typed errors / warnings into the alert-store list shape.
 *
 * The UI shows the first sentence (code + message) plus the hint indented;
 * keeping the hint in the same alert means the user does not need to dig
 * for the fix when a reload fails. Returns ``undefined`` when the input
 * list is empty so the alert store does not render an empty bullet list.
 */
export function renderTypedErrorList(
  payloads: readonly ExtensionErrorPayload[],
  translate: ExtensionDiagnosticTranslate = (key, params) =>
    i18n.t(key, params),
): TypedErrorAlertList {
  if (payloads.length === 0) {
    return undefined;
  }
  const list = payloads.map(
    (payload) =>
      `[${payload.code}] ${localizeExtensionDiagnostic(payload, translate)}`,
  );
  return { title: translate("extensions.reloadDiagnostics"), list };
}

/**
 * Coerce an unknown bus-payload field into a ``ExtensionErrorPayload[]``.
 *
 * Event payloads in ``use-extension-events`` are typed as
 * ``Record<string, unknown>`` because the backend ships them as opaque JSON
 * dicts. ``warnings`` and ``errors`` on a ``bundle_reloaded`` /
 * ``bundle_reload_failed`` event match ``ExtensionErrorPayload`` in shape;
 * this helper does the minimal narrowing (must be an array of objects with
 * a string ``code`` and ``message``) so a malformed payload from an older
 * server cannot crash the toast pipeline.
 */
export function extractTypedErrorList(
  value: unknown,
): readonly ExtensionErrorPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is ExtensionErrorPayload => {
    if (entry === null || typeof entry !== "object") {
      return false;
    }
    const candidate = entry as Record<string, unknown>;
    return (
      typeof candidate.code === "string" &&
      typeof candidate.message === "string"
    );
  });
}
