/**
 * Path validation for workspace registration: isolates ~/.ketos / $DSH_HOME
 * from being used as a workspace folder and warns when registering dangerous
 * system roots or the user home directory.
 */
import type { BoardTranslate } from '../locale.ts'

/**
 * Outcome of validating a candidate workspace folder path: valid, rejected with an error,
 * or accepted with a warning that requires user confirmation.
 */
export type PathValidationResult =
  | { readonly kind: 'valid' }
  | { readonly kind: 'rejected'; readonly error: string }
  | { readonly kind: 'warning'; readonly warning: string }

/** Options for validating a candidate workspace directory path against home and runtime roots. */
export interface ValidateWorkspacePathOptions {
  readonly hostHome?: string | undefined
  readonly dshHome?: string | undefined
  readonly t: BoardTranslate
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/')
}

function stripTrailingSlash(p: string): string {
  const norm = normalizeSlashes(p).trim()
  if (norm === '/' || /^[a-zA-Z]:\/$/.test(norm)) return norm
  return norm.replace(/\/+$/, '')
}

function isSameOrInside(parentNorm: string, childNorm: string): boolean {
  const p = stripTrailingSlash(parentNorm)
  const c = stripTrailingSlash(childNorm)
  if (p === c) return true
  if (/^[a-zA-Z]:\//.test(p) && /^[a-zA-Z]:\//.test(c)) {
    const pLow = p.toLowerCase()
    const cLow = c.toLowerCase()
    if (pLow === cLow) return true
    return cLow.startsWith(`${pLow}/`)
  }
  return c.startsWith(`${p}/`)
}

/**
 * Validate a candidate workspace path before registration.
 * Rejects paths inside ~/.ketos or ~/.dsh; warns on system roots and user home.
 * @param rawPath - input path entered or selected by the user.
 * @param options - translation and optional home directory hints.
 * @returns validation result with localized error or warning when applicable.
 */
export function validateWorkspacePath(
  rawPath: string,
  options: ValidateWorkspacePathOptions,
): PathValidationResult {
  const trimmed = rawPath.trim()
  if (trimmed === '') {
    return { kind: 'rejected', error: options.t('panel.error.ketosHome', { path: rawPath }) }
  }

  const normalized = normalizeSlashes(trimmed)
  const homeNorm = options.hostHome ? normalizeSlashes(options.hostHome) : undefined
  const dshHomeNorm = options.dshHome ? normalizeSlashes(options.dshHome) : undefined

  // 1. Check rejection for Ketos / DSH home
  if (
    normalized === '~/.ketos' || normalized.startsWith('~/.ketos/')
    || normalized === '~/.dsh' || normalized.startsWith('~/.dsh/')
  ) {
    return { kind: 'rejected', error: options.t('panel.error.ketosHome', { path: rawPath }) }
  }

  if (homeNorm) {
    const ketosHome = `${stripTrailingSlash(homeNorm)}/.ketos`
    const dshHome = `${stripTrailingSlash(homeNorm)}/.dsh`
    if (isSameOrInside(ketosHome, normalized) || isSameOrInside(dshHome, normalized)) {
      return { kind: 'rejected', error: options.t('panel.error.ketosHome', { path: rawPath }) }
    }
  }

  if (dshHomeNorm && isSameOrInside(dshHomeNorm, normalized)) {
    return { kind: 'rejected', error: options.t('panel.error.ketosHome', { path: rawPath }) }
  }

  // 2. Check warning for filesystem root or user home directory
  const isRoot = normalized === '/' || /^[a-zA-Z]:\/?$/.test(normalized) || /^\/+$/.test(normalized)
  const isHome = normalized === '~' || normalized === '~/'
    || (homeNorm !== undefined && (
      stripTrailingSlash(normalized) === stripTrailingSlash(homeNorm)
      || (/^[a-zA-Z]:\//.test(normalized) && stripTrailingSlash(normalized).toLowerCase() === stripTrailingSlash(homeNorm).toLowerCase())
    ))

  if (isRoot || isHome) {
    return { kind: 'warning', warning: options.t('panel.warn.dangerousPath', { path: rawPath }) }
  }

  return { kind: 'valid' }
}
