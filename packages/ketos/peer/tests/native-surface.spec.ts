// Mechanical ban on the iroh 1.1.0 APIs that break the process: every
// `watch*` call aborts Node, `SendStream.stopped()` blocks writes, and a
// static import of the native module would load it wherever the package is
// imported. The transport isolates the dynamic import; this spec keeps both
// rules true for every source file.
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const sourceRoot = resolve(here, '../src')

/** Native calls that must never appear in this package's sources. */
const FORBIDDEN_CALLS = /\.(?:watchAddr|watchHomeRelay|watchNetworkChange|watchPaths|watchPathEvents|stopped)\s*\(/u

/**
 * Read every TypeScript source of the package.
 * @returns file name and contents pairs, sorted by name.
 */
async function readSources(): Promise<readonly { name: string; text: string }[]> {
  const files: { name: string; text: string }[] = []
  for (const entry of await readdir(sourceRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    const path = join(entry.parentPath, entry.name)
    files.push({ name: path.slice(sourceRoot.length + 1), text: await readFile(path, 'utf8') })
  }
  return files.sort((left, right) => left.name.localeCompare(right.name))
}

describe('peer native surface', () => {
  it('never calls the aborting iroh watchers or the blocking stopped()', async () => {
    const violations: string[] = []
    for (const source of await readSources()) {
      for (const [index, line] of source.text.split('\n').entries()) {
        if (FORBIDDEN_CALLS.test(line)) violations.push(`${source.name}:${String(index + 1)}: ${line.trim()}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('imports the native module only as a type or a dynamic import', async () => {
    const violations: string[] = []
    for (const source of await readSources()) {
      for (const [index, line] of source.text.split('\n').entries()) {
        if (!line.includes("from '@number0/iroh'") && !line.includes('import(\'@number0/iroh\')')) continue
        const isTypeImport = /^\s*import\s+type\b/u.test(line)
        const isDynamic = line.includes("import('@number0/iroh')")
        if (!isTypeImport && !isDynamic) violations.push(`${source.name}:${String(index + 1)}: ${line.trim()}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps the dynamic import in the transport module alone', async () => {
    const importers: string[] = []
    for (const source of await readSources()) {
      if (source.text.includes("import('@number0/iroh')")) importers.push(source.name)
    }
    expect(importers).toEqual(['iroh-transport.ts'])
  })
})
