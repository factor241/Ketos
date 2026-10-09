// The defaults a deployment gets without writing any board-doc config.
import { describe, expect, it } from 'vitest'
import * as BoardDoc from '@ketos/board-doc'

describe('board-doc config defaults', () => {
  it('lets one eraser gesture over fifty strokes post as a single batch', () => {
    // Each cut stroke is one remove plus up to two new parts, so fifty strokes
    // need about 150 operations in one atomic request.
    expect(BoardDoc.Config({ path: 'board.db' }).maxOpsPerRequest).toBeGreaterThanOrEqual(256)
  })
})
