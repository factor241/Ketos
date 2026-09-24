import { describe, expect, it } from 'vitest'
import {
  partitionViolations,
  resolveClientImport,
  type UpstreamLayoutException,
} from './verify-client-domain-graph.ts'

const EXCEPTIONS: ReadonlyMap<string, UpstreamLayoutException> = new Map([
  ['ui-conversation', { expected: 2, reason: 'test exception' }],
])

function violation(file: string): { file: string; imported: string; reason: string } {
  return { file, imported: './sibling.ts', reason: 'sibling domain' }
}

describe('client domain import resolution', () => {
  it('preserves imports that leave src/client from a top-level file', () => {
    expect(resolveClientImport('styles.ts', '../styles/base.css?inline'))
      .toBe('../styles/base.css?inline')
  })

  it('normalizes imports between domains inside src/client', () => {
    expect(resolveClientImport('input/hub.ts', '../queue/store.ts'))
      .toBe('queue/store.ts')
  })
})

describe('upstream layout exception partition', () => {
  it('fails every violation of a package without an exception', () => {
    const verdict = partitionViolations([violation('ui-chat/src/client/a.ts')], new Map())
    expect(verdict.failing).toHaveLength(1)
    expect(verdict.drifted).toHaveLength(0)
    expect(verdict.exempted).toHaveLength(0)
  })

  it('exempts a package whose violation count matches its entry exactly', () => {
    const verdict = partitionViolations([
      violation('ui-conversation/src/client/a.ts'),
      violation('ui-conversation/src/client/b.ts'),
    ], EXCEPTIONS)
    expect(verdict.failing).toHaveLength(0)
    expect(verdict.drifted).toHaveLength(0)
    expect(verdict.exempted).toEqual([{ pkg: 'ui-conversation', count: 2 }])
  })

  it('reports drift when an exempt package gains violations', () => {
    const verdict = partitionViolations([
      violation('ui-conversation/src/client/a.ts'),
      violation('ui-conversation/src/client/b.ts'),
      violation('ui-conversation/src/client/c.ts'),
    ], EXCEPTIONS)
    expect(verdict.failing).toHaveLength(0)
    expect(verdict.exempted).toHaveLength(0)
    expect(verdict.drifted).toEqual([
      { pkg: 'ui-conversation', expected: 2, found: 3, reason: 'test exception' },
    ])
  })

  it('reports drift when an exempt package clears its violations', () => {
    const verdict = partitionViolations([], EXCEPTIONS)
    expect(verdict.failing).toHaveLength(0)
    expect(verdict.exempted).toHaveLength(0)
    expect(verdict.drifted).toEqual([
      { pkg: 'ui-conversation', expected: 2, found: 0, reason: 'test exception' },
    ])
  })
})
