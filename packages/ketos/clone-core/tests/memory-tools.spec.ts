/** The memory snapshot text: rendering, truncation, and the character budget. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { memorySnapshotText } from '../src/memory-tools.ts'
import type { CloneId, MemoryId, MemoryRecord } from '../src/types.ts'

/** One active memory record with the fields the snapshot reads. */
function memory(id: string, content: string, tags: readonly string[] = []): MemoryRecord {
  return {
    id: brandString<MemoryId>(id),
    cloneId: brandString<CloneId>('clone-1'),
    content,
    tags,
    sourceSessionId: brandString<SessionId>('session-1'),
    status: 'active',
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
  }
}

describe('memory snapshot text', () => {
  it('renders nothing for an empty snapshot', () => {
    expect(memorySnapshotText([], 1000)).toBe('')
  })

  it('renders every memory with its id and tags inside the budget', () => {
    const text = memorySnapshotText([memory('m1', 'Любит короткие письма', ['стиль'])], 1000)
    expect(text).toContain('clone_memory_search')
    expect(text).toContain('- [m1] Любит короткие письма (tags: стиль)')
  })

  it('shortens one over-long memory so it cannot crowd out the rest', () => {
    const text = memorySnapshotText([memory('m1', 'x'.repeat(1000))], 2000)
    expect(text).toContain('…')
    expect(text).not.toContain('x'.repeat(401))
  })

  it('never splits a surrogate pair when shortening', () => {
    for (let offset = 380; offset <= 400; offset++) {
      const content = `${'x'.repeat(offset)}😀${'y'.repeat(50)}`
      const text = memorySnapshotText([memory('m1', content)], 1000)
      expect(text, `offset ${String(offset)}`).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u)
      expect(text, `offset ${String(offset)}`).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)
    }
  })

  it('never splits a surrogate pair at the whole-snapshot budget', () => {
    const content = `${'x'.repeat(140)}😀${'y'.repeat(20)}`
    const text = memorySnapshotText([memory('m1', content)], 150)
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u)
    expect(text).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)
  })

  it('drops memories beyond the budget and counts them', () => {
    const memories = Array.from({ length: 20 }, (_, index) => memory(`m${String(index)}`, `Факт ${String(index)}`))
    const budget = 300
    const text = memorySnapshotText(memories, budget)
    expect(text).toContain('- [m0] Факт 0')
    expect(text).not.toContain('- [m19] Факт 19')
    expect(text).toMatch(/\d+ more memories are not shown/u)
    expect(text.length).toBeLessThanOrEqual(budget)
  })

  it('renders nothing when the budget cannot hold one entry', () => {
    expect(memorySnapshotText([memory('m1', 'Первый')], 10)).toBe('')
  })

  it('never exceeds the character budget', () => {
    const memories = [memory('m1', 'Первый факт'), memory('m2', 'Второй факт')]
    for (const budget of [50, 120, 200, 1000]) {
      expect(memorySnapshotText(memories, budget).length).toBeLessThanOrEqual(budget)
    }
  })
})
