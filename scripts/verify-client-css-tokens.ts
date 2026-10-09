/**
 * Reject `var(--name)` reads of undefined custom properties in Board CSS.
 *
 * A `var()` without a fallback resolves to the guaranteed-invalid value when
 * no ancestor declares the property, so the declaration silently disappears
 * (a missing border, shadow, or text color). The check collects every custom
 * property that Client sources define and requires each fallback-less
 * `var(--name)` in `ui-board` CSS to name one of them. A read with a fallback
 * (`var(--name, value)`) is accepted because the author chose the value that
 * applies when the property is absent.
 *
 * Definitions come from CSS declarations (`--name: value`), `@property`
 * registrations, and quoted `'--name'` literals in TypeScript (inline style
 * objects and `style.setProperty('--name', ...)`).
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const MINIMUM_CHECKED_CSS_SOURCES = 30
const MINIMUM_DEFINITION_SOURCES = 600

/** One fallback-less `var()` read of a custom property that no Client source defines. */
export interface CssTokenViolation {
  /** One-based column of the `var(` call. */
  column: number
  /** Repository-relative CSS path. */
  file: string
  /** One-based line of the `var(` call. */
  line: number
  /** Custom property name, including the leading `--`. */
  name: string
}

const CSS_DECLARATION = /(--[\w-]+)\s*:/g
const CSS_PROPERTY_AT_RULE = /@property\s+(--[\w-]+)/g
const QUOTED_NAME = /["'`](--[\w-]+)["'`]/g
const VAR_READ = /var\(\s*(--[\w-]+)\s*([,)])/g

function isCss(file: string): boolean {
  return file.endsWith('.css')
}

/** Replace CSS comment text with spaces, keeping offsets and line breaks. */
function blankComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
}

/**
 * Decide whether a Client source can define custom properties.
 * @param file - repository-relative path.
 * @returns true for CSS and non-declaration TypeScript sources.
 */
export function isTokenDefinitionSource(file: string): boolean {
  return (isCss(file) || /\.tsx?$/.test(file)) && !file.endsWith('.d.ts')
}

/**
 * Add one captured custom-property name to a set.
 * @param names - set receiving the name.
 * @param captured - the first regular-expression capture group; absent captures are skipped.
 */
function addName(names: Set<string>, captured: string | undefined): void {
  if (captured !== undefined) names.add(captured)
}

/**
 * Collect the custom property names that one source defines.
 * @param file - repository-relative path; selects CSS or TypeScript rules.
 * @param sourceText - file contents.
 * @returns names including the leading `--`.
 */
export function collectDefinedTokens(file: string, sourceText: string): Set<string> {
  const names = new Set<string>()
  if (isCss(file)) {
    const css = blankComments(sourceText)
    for (const match of css.matchAll(CSS_DECLARATION)) addName(names, match[1])
    for (const match of css.matchAll(CSS_PROPERTY_AT_RULE)) addName(names, match[1])
    return names
  }
  for (const match of sourceText.matchAll(QUOTED_NAME)) addName(names, match[1])
  for (const match of sourceText.matchAll(CSS_DECLARATION)) addName(names, match[1])
  return names
}

/**
 * Find fallback-less `var(--name)` reads whose property is not defined.
 * @param file - repository-relative CSS path used in diagnostics.
 * @param cssText - CSS source.
 * @param defined - custom property names defined by Client sources.
 * @returns violations in source order.
 */
export function findUndefinedTokenUses(
  file: string,
  cssText: string,
  defined: ReadonlySet<string>,
): CssTokenViolation[] {
  const css = blankComments(cssText)
  const violations: CssTokenViolation[] = []
  for (const match of css.matchAll(VAR_READ)) {
    const name = match[1] ?? ''
    if (match[2] === ',' || defined.has(name)) continue
    const before = css.slice(0, match.index)
    const line = before.split('\n').length
    violations.push({ column: match.index - before.lastIndexOf('\n'), file, line, name })
  }
  return violations
}

function definitionSources(): string[] {
  return [...new Set([
    ...globSync('packages/client/*/src/**/*.{css,ts,tsx}', { cwd: root }),
    ...globSync('apps/web/src/**/*.{css,ts,tsx}', { cwd: root }),
  ])]
    .map(file => file.replaceAll('\\', '/'))
    .filter(isTokenDefinitionSource)
    .sort()
}

function boardCssSources(): string[] {
  return globSync('packages/client/ui-board/src/**/*.css', { cwd: root })
    .map(file => file.replaceAll('\\', '/'))
    .sort()
}

function main(): void {
  const definitions = definitionSources()
  const boardCss = boardCssSources()
  if (definitions.length < MINIMUM_DEFINITION_SOURCES) {
    throw new Error(
      `verify-client-css-tokens: discovery narrowed to ${definitions.length} definition source(s); expected at least ${MINIMUM_DEFINITION_SOURCES}.`,
    )
  }
  if (boardCss.length < MINIMUM_CHECKED_CSS_SOURCES) {
    throw new Error(
      `verify-client-css-tokens: discovery narrowed to ${boardCss.length} ui-board CSS file(s); expected at least ${MINIMUM_CHECKED_CSS_SOURCES}.`,
    )
  }
  const defined = new Set<string>()
  for (const file of definitions) {
    for (const name of collectDefinedTokens(file, readFileSync(resolve(root, file), 'utf8'))) defined.add(name)
  }
  const violations = boardCss.flatMap(file =>
    findUndefinedTokenUses(file, readFileSync(resolve(root, file), 'utf8'), defined))
  if (violations.length > 0) {
    console.error(`verify-client-css-tokens: ${violations.length} undefined CSS variable read(s):`)
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}:${violation.column} var(${violation.name}) has no definition and no fallback`)
    }
    process.exitCode = 1
    return
  }
  console.log(`verify-client-css-tokens: ${boardCss.length} ui-board CSS file(s) read only defined custom properties (${defined.size} defined).`)
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main()
