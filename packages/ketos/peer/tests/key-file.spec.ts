// The stored node key: first use mints one owner-only file, later runs reuse
// it, a wrong-length file refuses to load, and concurrent first runs settle on
// the key that won the exclusive create.
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadOrCreateSecretKey, PEER_KEY_BYTES } from '../src/key-file.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Create one temporary directory for a key file.
 * @returns the directory path.
 */
async function temporaryRoot(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-peer-key-'))
  return root
}

describe('peer key file', () => {
  it('mints a 32-byte key on first use in an owner-only file and reuses it', async () => {
    const dir = await temporaryRoot()
    const path = join(dir, 'nested', 'peer.key')
    const key = await loadOrCreateSecretKey(path, () => new Uint8Array(PEER_KEY_BYTES).fill(7))
    expect(key.byteLength).toBe(PEER_KEY_BYTES)
    expect([...(await readFile(path))]).toEqual([...key])
    const stats = await stat(path)
    expect(stats.mode & 0o777).toBe(0o600)
    const parent = await stat(join(dir, 'nested'))
    expect(parent.mode & 0o777).toBe(0o700)

    const second = await loadOrCreateSecretKey(path, () => new Uint8Array(PEER_KEY_BYTES).fill(9))
    expect([...second]).toEqual([...key])
  })

  it('refuses a stored key of the wrong length', async () => {
    const dir = await temporaryRoot()
    const path = join(dir, 'peer.key')
    await writeFile(path, new Uint8Array(31))
    await expect(loadOrCreateSecretKey(path, () => new Uint8Array(PEER_KEY_BYTES))).rejects.toThrow(/must hold 32 bytes/u)
  })

  it('refuses a generator that does not produce 32 bytes', async () => {
    const dir = await temporaryRoot()
    const path = join(dir, 'peer.key')
    await expect(loadOrCreateSecretKey(path, () => new Uint8Array(16))).rejects.toThrow(/generator produced 16 bytes/u)
  })

  it('settles concurrent first runs on one stored key', async () => {
    const dir = await temporaryRoot()
    const path = join(dir, 'peer.key')
    const [first, second] = await Promise.all([
      loadOrCreateSecretKey(path, () => new Uint8Array(PEER_KEY_BYTES).fill(1)),
      loadOrCreateSecretKey(path, () => new Uint8Array(PEER_KEY_BYTES).fill(2)),
    ])
    expect([...first]).toEqual([...second])
    expect([...(await readFile(path))]).toEqual([...first])
  })

  it('propagates a read failure that is not a missing file', async () => {
    const dir = await temporaryRoot()
    const path = join(dir, 'peer.key')
    await mkdir(path)
    await expect(loadOrCreateSecretKey(path, () => new Uint8Array(PEER_KEY_BYTES)))
      .rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('rethrows the exclusive-create collision when the path vanished again', async () => {
    const dir = await temporaryRoot()
    const path = join(dir, 'peer.key')
    await symlink('missing-target', path)
    await expect(loadOrCreateSecretKey(path, () => new Uint8Array(PEER_KEY_BYTES)))
      .rejects.toMatchObject({ code: 'EEXIST' })
  })

  it('propagates a write failure that is not an exclusive-create collision', async () => {
    const dir = await temporaryRoot()
    const path = join(dir, 'peer.key')
    await expect(loadOrCreateSecretKey(path, async () => {
      await rm(dir, { recursive: true, force: true })
      await writeFile(dir, 'not a directory')
      return new Uint8Array(PEER_KEY_BYTES)
    })).rejects.toMatchObject({ code: 'ENOTDIR' })
  })
})
