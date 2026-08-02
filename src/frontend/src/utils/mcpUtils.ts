import type { MCPServerType } from "@/types/mcp";

export enum AuthMethodId {
  NONE = "none",
  API_KEY = "apikey",
  OAUTH = "oauth",
}

type McpImportTranslationKey =
  | "mcp.modal.errorInvalidJson"
  | "mcp.modal.errorNoServerFound";

export class McpImportError extends Error {
  constructor(public readonly translationKey: McpImportTranslationKey) {
    super(translationKey);
    this.name = "McpImportError";
  }
}

export const AUTH_METHODS = {
  [AuthMethodId.NONE]: {
    id: AuthMethodId.NONE,
    labelKey: "authModal.authMethod.none",
  },
  [AuthMethodId.API_KEY]: {
    id: AuthMethodId.API_KEY,
    labelKey: "authModal.authMethod.apikey",
  },
  [AuthMethodId.OAUTH]: {
    id: AuthMethodId.OAUTH,
    labelKey: "authModal.authMethod.oauth",
  },
} as const;

export const AUTH_METHODS_ARRAY = Object.values(AUTH_METHODS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const toStringRecord = (value: unknown): Record<string, string> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};

/**
 * Extracts all MCP servers from a JSON string or object.
 * Supports:
 * 1. { mcpServers: { ... } }
 * 2. { ... } (object with server keys)
 * 3. a single server object
 * Returns: Array<MCPServerType> or throws an error.
 */
export function extractMcpServersFromJson(
  json: string | object,
): MCPServerType[] {
  let parsed: unknown = json;
  if (typeof json === "string") {
    try {
      parsed = JSON.parse(json);
    } catch (_e) {
      try {
        parsed = JSON.parse(`{${json}}`);
      } catch (_e) {
        throw new McpImportError("mcp.modal.errorInvalidJson");
      }
    }
  }

  let serverEntries: [string, Record<string, unknown>][] = [];

  // Case 1: { mcpServers: { ... } }
  if (isRecord(parsed) && isRecord(parsed.mcpServers)) {
    serverEntries = Object.entries(parsed.mcpServers).filter(
      (entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]),
    );
  }
  // Case 2: { ... } (object with server keys)
  else if (
    isRecord(parsed) &&
    Object.values(parsed).some(
      (value) => isRecord(value) && ("command" in value || "url" in value),
    )
  ) {
    serverEntries = Object.entries(parsed).filter(
      (entry): entry is [string, Record<string, unknown>] =>
        isRecord(entry[1]) && ("command" in entry[1] || "url" in entry[1]),
    );
  }
  // Case 3: single server object
  else if (isRecord(parsed) && ("command" in parsed || "url" in parsed)) {
    serverEntries = [["server", parsed]];
  }

  if (serverEntries.length === 0) {
    throw new McpImportError("mcp.modal.errorNoServerFound");
  }
  // Validate and map all servers
  const validServers = serverEntries.filter(
    ([, server]) => server.command || server.url,
  );
  if (validServers.length === 0) {
    throw new McpImportError("mcp.modal.errorNoServerFound");
  }
  return validServers.map(([name, server]) => ({
    name: name.slice(0, 30),
    command: typeof server.command === "string" ? server.command : undefined,
    args: Array.isArray(server.args)
      ? server.args.filter((arg): arg is string => typeof arg === "string")
      : [],
    env: toStringRecord(server.env),
    url: typeof server.url === "string" ? server.url : undefined,
    headers: toStringRecord(server.headers),
  }));
}
