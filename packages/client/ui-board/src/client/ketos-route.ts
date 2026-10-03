/**
 * Mount-aware URL of one Ketos host route registered below `/api`: the
 * application may be served under a proxy prefix, so a leading-slash path
 * would leave the mount.
 */

/**
 * Resolve one route path against the document's own base URL.
 * @param path - host route path, absolute (`/api/...`) or relative.
 * @returns the request URL under the application's mount.
 */
export function ketosRoute(path: string): URL {
  return new URL(path.replace(/^\//, ''), document.baseURI)
}
