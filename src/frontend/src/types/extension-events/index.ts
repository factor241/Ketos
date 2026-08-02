export type ExtensionEventType =
  | "bundle_reloaded"
  | "components_added"
  | "components_removed"
  | "extension_error"
  | "bundle_reload_failed";

export type ExtensionEvent = {
  type: ExtensionEventType;
  timestamp: number;
  payload: Record<string, unknown>;
};

export type ExtensionEventsResponse = {
  events: ExtensionEvent[];
  settled: boolean;
};
