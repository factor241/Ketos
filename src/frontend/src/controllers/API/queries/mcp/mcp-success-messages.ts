export type McpSuccessAction = "added" | "deleted" | "installed" | "updated";

export type McpSuccessTranslator = (key: string) => string;

export const getMcpSuccessMessage = (
  action: McpSuccessAction,
  t: McpSuccessTranslator,
): string => {
  switch (action) {
    case "added":
      return t("mcp.servers.addedSuccessfully");
    case "deleted":
      return t("mcp.servers.deletedSuccessfully");
    case "installed":
      return t("mcp.servers.installedSuccessfully");
    case "updated":
      return t("mcp.servers.updatedSuccessfully");
  }
};
