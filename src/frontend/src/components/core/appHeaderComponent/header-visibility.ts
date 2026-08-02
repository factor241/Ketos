const SIDEBAR_ROUTE_ROOTS = new Set([
  "flows",
  "all",
  "project",
  "components",
  "mcp",
  "assets",
]);

export function shouldShowLegacyHeaderAccountMenu(
  pathname: string,
  customParam: string | undefined,
  onFlowPage: boolean,
): boolean {
  if (onFlowPage) return true;

  const pathSegments = pathname.split("/").filter(Boolean);
  if (customParam && pathSegments[0] === customParam) {
    pathSegments.shift();
  }

  const routeRoot = pathSegments[0];
  return routeRoot !== undefined && !SIDEBAR_ROUTE_ROOTS.has(routeRoot);
}
