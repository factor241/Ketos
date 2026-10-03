/**
 * Mount-aware URL of one Ketos host route registered below `/api`: the
 * application may be served under a proxy prefix, so a leading-slash path
 * would leave the mount.
 */

/**
 * Resolve one mount-relative route key against the document's own base URL.
 * @param key - route path without its leading slash (`api/...`).
 * @returns the request URL under the application's mount.
 */
export function ketosRoute(key: string): URL {
  return new URL(key, document.baseURI)
}
