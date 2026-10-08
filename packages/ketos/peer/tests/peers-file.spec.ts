// The known-peer file: a missing file is an empty list, a written list round
// trips owner-only and atomically, and every malformed record refuses to load.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OwnerId } from '@ketos/board-doc/types'
import { loadKnownPeers, saveKnownPeers, type KnownPeer } from '../src/peers-file.ts'
import type { KetosPeerId } from '../src/types.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** One valid stored record. */
const record: KnownPeer = {
  peerId: brandString<KetosPeerId>('peer-a'),
  selfId: brandString<OwnerId>('owner-a'),
  name: 'Кирилл',
  color: 3,
  ticket: 'endpointabc',
  lastSeen: '2026-10-07T00:00:00.000Z',
}

/**
 * Create one temporary peers-file path.
 * @returns the file path.
 */
async function temporaryPath(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-peer-file-'))
  const nested = join(root, 'nested')
  await mkdir(nested, { recursive: true })
  return join(nested, 'peers.json')
}

describe('known-peer file', () => {
  it('treats a missing file as an empty list', async () => {
    expect(await loadKnownPeers(await temporaryPath())).toEqual([])
  })

  it('propagates a read failure that is not a missing file', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-peer-file-'))
    await expect(loadKnownPeers(root)).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('round-trips records through an owner-only atomic write', async () => {
    const path = await temporaryPath()
    const withoutTicket: KnownPeer = {
      peerId: brandString<KetosPeerId>('peer-b'),
      selfId: record.selfId,
      name: record.name,
      color: record.color,
      lastSeen: record.lastSeen,
    }
    await saveKnownPeers(path, [record, withoutTicket])
    const loaded = await loadKnownPeers(path)
    expect(loaded).toHaveLength(2)
    expect(loaded[0]).toEqual(record)
    expect(loaded[1]?.ticket).toBeUndefined()
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readFile(path, 'utf8')).toContain('"peer-a"')
  })

  it('lets the last duplicate win', async () => {
    const path = await temporaryPath()
    await saveKnownPeers(path, [record, { ...record, name: 'Позже' }])
    const loaded = await loadKnownPeers(path)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.name).toBe('Позже')
  })

  it('refuses malformed files and records', async () => {
    const cases: unknown[] = [
      'not json',
      { peers: [] },
      [null],
      [{ ...record, extra: 1 }],
      [{ ...record, peerId: '' }],
      [{ ...record, selfId: 1 }],
      [{ ...record, name: '' }],
      [{ ...record, color: 0 }],
      [{ ...record, color: 11 }],
      [{ ...record, ticket: 7 }],
      [{ ...record, lastSeen: '' }],
    ]
    for (const value of cases) {
      const path = await temporaryPath()
      await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value))
      await expect(loadKnownPeers(path)).rejects.toThrow(/peer file/u)
    }
  })
})
