import { describe, expect, it } from 'vitest'
import {
  collectDefinedTokens,
  findUndefinedTokenUses,
  isTokenDefinitionSource,
} from './verify-client-css-tokens.ts'

const BOARD_CSS = 'packages/client/ui-board/src/client/Example.module.css'

function undefinedNames(css: string, defined: Iterable<string>): string[] {
  return findUndefinedTokenUses(BOARD_CSS, css, new Set(defined)).map(violation => violation.name)
}

describe('Client CSS token check', () => {
  it('rejects a var() without fallback whose custom property is defined nowhere', () => {
    const violations = findUndefinedTokenUses(
      BOARD_CSS,
      '.root {\n  color: red;\n  border: 1px solid var(--dsw-alias-line-input);\n}\n',
      new Set(['--dsw-alias-border-l2']),
    )

    expect(violations).toEqual([
      { column: 21, file: BOARD_CSS, line: 3, name: '--dsw-alias-line-input' },
    ])
  })

  it('accepts a var() whose custom property is defined elsewhere', () => {
    expect(undefinedNames('.a { color: var(--dsw-alias-label-secondary); }', ['--dsw-alias-label-secondary']))
      .toEqual([])
  })

  it('accepts a var() with a fallback value even when the property is undefined', () => {
    expect(undefinedNames('.a { color: var(--unknown, #fff); width: var( --other ,0 ); }', [])).toEqual([])
  })

  it('still checks a var() nested inside a fallback', () => {
    expect(undefinedNames('.a { color: var(--known, var(--nested-unknown)); }', ['--known']))
      .toEqual(['--nested-unknown'])
  })

  it('ignores var() text inside CSS comments', () => {
    expect(undefinedNames('/* var(--commented-out) */\n.a { color: red; }', [])).toEqual([])
  })

  it('collects declarations and @property registrations from CSS', () => {
    const defined = collectDefinedTokens(
      'packages/client/ui-theme/src/styles/theme.css',
      ':root { --dsw-alias-a: 1px; --dsw-alias-b:2px }\n@property --registered { syntax: "<length>"; inherits: false; initial-value: 0px; }\n',
    )

    expect([...defined].sort()).toEqual(['--dsw-alias-a', '--dsw-alias-b', '--registered'])
  })

  it('collects quoted names and setProperty keys from TypeScript', () => {
    const defined = collectDefinedTokens(
      'packages/client/ui-board/src/client/canvas/Canvas.tsx',
      `
        element.style.setProperty('--board-zoom', String(zoom))
        const style = { '--board-owner-edge': color, "--board-owner-fill": fill }
      `,
    )

    expect([...defined].sort()).toEqual(['--board-owner-edge', '--board-owner-fill', '--board-zoom'])
  })

  it('does not treat var() reads in CSS as definitions', () => {
    const defined = collectDefinedTokens(BOARD_CSS, '.a { color: var(--only-read); }')

    expect([...defined]).toEqual([])
  })

  it('limits definition scanning to CSS and TypeScript sources', () => {
    expect(isTokenDefinitionSource('packages/client/ui-theme/src/styles/theme.css')).toBe(true)
    expect(isTokenDefinitionSource('packages/client/ui-board/src/client/Canvas.tsx')).toBe(true)
    expect(isTokenDefinitionSource('packages/client/ui-board/src/client/types.d.ts')).toBe(false)
    expect(isTokenDefinitionSource('packages/client/ui-board/README.md')).toBe(false)
  })
})
