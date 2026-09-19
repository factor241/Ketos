/**
 * Enforce intra-package domain layering inside `packages/client/*\/src/client/`.
 * verify-module-graph covers package-level edges; this gate covers the
 * directory level: domain directories may import `contract/` and never each
 * other, and only the assembly point (`apply.ts` / `index.ts`) may import
 * across domains.
 *
 * Layer model (lower may not import higher):
 *   0  contract/            shared contract API (types + slot declarations)
 *   1  <domain>/ + service  domain implementations (skeleton/, chat/, ...)
 *   2  apply.ts, index.ts   assembly point and re-export shell
 *
 * Upstream packages that predate the gate keep a frozen, exact violation count
 * in `UPSTREAM_LAYOUT_EXCEPTIONS`; every other package is checked strictly. A
 * count that moves fails the gate, so a new violation cannot hide behind an
 * exception and a fixed one must shrink the entry.
 *
 * Run directly:
 *   pnpm exec tsx scripts/verify-client-domain-graph.ts
 */

import { globSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const CLIENT_DIR = join(root, 'packages/client')

/** Directory names treated as the shared contract layer (importable by all). */
const CONTRACT_DIRS = new Set(['contract'])
/** Top-level client files allowed to import across domains (assembly layer). */
const ASSEMBLY_FILES = new Set(['apply.ts', 'index.ts', 'index.tsx'])

/** One import that breaks the client domain layering. */
export interface Violation {
  /** Importing file, relative to the repository root. */
  readonly file: string
  /** Relative module specifier the file imports. */
  readonly imported: string
  /** Why the import breaks the layering rule. */
  readonly reason: string
}

/** One frozen exception for a package whose client layout predates this gate. */
export interface UpstreamLayoutException {
  /** Exact violation count the package carries on the current base. */
  readonly expected: number
  /** Why the package is exempt and which issue tracks its removal. */
  readonly reason: string
}

/** One exception entry whose pinned count no longer matches the package. */
export interface DomainExceptionDrift {
  /** Package whose violation count moved. */
  readonly pkg: string
  /** Count pinned in the exception entry. */
  readonly expected: number
  /** Count the gate found in the package. */
  readonly found: number
  /** Why the package is exempt. */
  readonly reason: string
}

/** One exempt package and the violation count its entry covers. */
export interface ExemptedPackage {
  /** Package name. */
  readonly pkg: string
  /** Matching violation count. */
  readonly count: number
}

/** The gate's verdict for one run: failures, drifted exceptions, and exemptions. */
export interface DomainGateVerdict {
  /** Violations of packages without an exception; each one fails the gate. */
  readonly failing: readonly Violation[]
  /** Exception entries whose pinned count no longer matches the package. */
  readonly drifted: readonly DomainExceptionDrift[]
  /** Exception entries that still match, with the counts they cover. */
  readonly exempted: readonly ExemptedPackage[]
}

/**
 * Upstream packages whose client layout predates the gate: their sibling-domain
 * imports are known and frozen, tracked by ketos-bmz. Fork-owned packages
 * (ui-board) stay under the strict rule.
 */
const UPSTREAM_LAYOUT_EXCEPTIONS: ReadonlyMap<string, UpstreamLayoutException> = new Map([
  ['ui-conversation', {
    expected: 4,
    reason: 'upstream skeleton/ imports the sibling input/ domain; predates the gate (ketos-bmz)',
  }],
  ['ui-sidebar-documentpreview', {
    expected: 21,
    reason: 'upstream document/, text/, and body domains import each other; predates the gate (ketos-bmz)',
  }],
])

/** Recursively list .ts/.tsx files under dir (relative paths). */
function listSources(dir: string): string[] {
  return globSync('**/*.{ts,tsx}', { cwd: dir })
    .map(rel => rel.split(sep).join('/'))
    .filter(rel => !/\.legacy\./.test(rel.slice(rel.lastIndexOf('/') + 1)))
    .sort()
}

/** First path segment of a client-relative file, or '' for top-level files. */
function domainOf(rel: string): string {
  const ix = rel.indexOf('/')
  return ix === -1 ? '' : rel.slice(0, ix)
}

/**
 * Resolve one relative import to a client-directory-relative path.
 * @param file - Importing file relative to `src/client`.
 * @param specifier - Relative module specifier from that file.
 * @returns Normalized path, preserving leading `..` segments outside `src/client`.
 */
export function resolveClientImport(file: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(file), specifier))
}

function checkPackage(pkgName: string, clientDir: string): Violation[] {
  const violations: Violation[] = []
  const files = listSources(clientDir)
  for (const rel of files) {
    const fromDomain = domainOf(rel)
    const isAssembly = fromDomain === '' && ASSEMBLY_FILES.has(rel)
    if (isAssembly) continue
    const source = readFileSync(join(clientDir, rel), 'utf8')
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const spec = match[1]
      if (spec === undefined) continue
      const target = resolveClientImport(rel, spec)
      if (target === '..' || target.startsWith('../')) continue // package-level rules govern
      const toDomain = domainOf(target)
      if (toDomain === '' || CONTRACT_DIRS.has(toDomain)) continue // top-level shared file or contract layer
      if (fromDomain === toDomain) continue // inside one domain
      violations.push({
        file: `${pkgName}/src/client/${rel}`,
        imported: spec,
        reason: fromDomain === ''
          ? `top-level non-assembly file imports domain "${toDomain}" (only apply/index may assemble)`
          : `domain "${fromDomain}" imports sibling domain "${toDomain}" (route shared API through contract/)`,
      })
    }
  }
  return violations
}

/**
 * Split violations into gate failures and frozen upstream exceptions. An
 * exception matches only its exact pinned count; a package that gains, loses,
 * or clears a violation drifts and fails the gate until its entry is updated.
 * @param violations - violations found across client packages.
 * @param exceptions - frozen per-package exception entries.
 * @returns failing violations, drifted exceptions, and still-matching exemptions.
 */
export function partitionViolations(
  violations: readonly Violation[],
  exceptions: ReadonlyMap<string, UpstreamLayoutException>,
): DomainGateVerdict {
  const byPackage = new Map<string, Violation[]>()
  for (const violation of violations) {
    const pkg = violation.file.slice(0, violation.file.indexOf('/'))
    byPackage.set(pkg, [...byPackage.get(pkg) ?? [], violation])
  }
  const failing: Violation[] = []
  for (const [pkg, pkgViolations] of byPackage) {
    if (!exceptions.has(pkg)) failing.push(...pkgViolations)
  }
  const drifted: DomainExceptionDrift[] = []
  const exempted: ExemptedPackage[] = []
  for (const [pkg, exception] of exceptions) {
    const found = byPackage.get(pkg)?.length ?? 0
    if (found === exception.expected) exempted.push({ pkg, count: found })
    else drifted.push({ pkg, expected: exception.expected, found, reason: exception.reason })
  }
  return { failing, drifted, exempted }
}

function main(): void {
  const violations: Violation[] = []
  for (const pkg of readdirSync(CLIENT_DIR)) {
    const clientDir = join(CLIENT_DIR, pkg, 'src/client')
    try {
      if (!statSync(clientDir).isDirectory()) continue
    } catch {
      // No client half in this package — nothing to layer-check.
      continue
    }
    violations.push(...checkPackage(pkg, clientDir))
  }

  const { failing, drifted, exempted } = partitionViolations(violations, UPSTREAM_LAYOUT_EXCEPTIONS)
  if (failing.length === 0 && drifted.length === 0) {
    const exemptedCount = exempted.reduce((sum, entry) => sum + entry.count, 0)
    const summary = exempted.map(entry => `${entry.pkg} ${entry.count}`).join(', ')
    console.log(exempted.length === 0
      ? 'verify-client-domain-graph: client domain layering clean.'
      : `verify-client-domain-graph: client domain layering clean (${exemptedCount} known upstream violation(s) exempted: ${summary}; ketos-bmz).`)
    return
  }
  if (failing.length > 0) {
    console.error(`verify-client-domain-graph: ${failing.length} violation(s):`)
    for (const v of failing) console.error(`  ${v.file} -> ${v.imported}\n    ${v.reason}`)
  }
  for (const d of drifted) {
    console.error(`verify-client-domain-graph: ${d.pkg} expected ${d.expected} known upstream violation(s), found ${d.found} — ${d.reason}; update UPSTREAM_LAYOUT_EXCEPTIONS`)
  }
  process.exitCode = 1
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main()
