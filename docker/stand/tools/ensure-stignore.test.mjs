// Run with `node --test docker/stand/tools/ensure-stignore.test.mjs`.
// Checks that ensure-stignore.mjs, which the entrypoint runs on every
// container start, seeds the shared folder's ignore file once and never
// overwrites an ignore file that is already there.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'ensure-stignore.mjs')

/** Run the script against one folder, exactly as the entrypoint passes it. */
const run = (folder) => spawnSync(process.execPath, [script, folder], { encoding: 'utf8' })

const freshFolder = () => mkdtempSync(join(tmpdir(), 'st-ignore-'))

test('creates .stignore with exactly the three stand patterns when it is absent', () => {
  const folder = freshFolder()
  const result = run(folder)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(join(folder, '.stignore'), 'utf8'), '.DS_Store\n*.tmp\n~*\n')
})

test('leaves an existing .stignore untouched, including an empty one', () => {
  const folder = freshFolder()
  const path = join(folder, '.stignore')
  writeFileSync(path, '*.log\n')
  assert.equal(run(folder).status, 0)
  assert.equal(readFileSync(path, 'utf8'), '*.log\n')
  writeFileSync(path, '')
  assert.equal(run(folder).status, 0)
  assert.equal(readFileSync(path, 'utf8'), '')
})

test('a second run changes neither the content nor the modification time', () => {
  const folder = freshFolder()
  assert.equal(run(folder).status, 0)
  const path = join(folder, '.stignore')
  const first = { content: readFileSync(path, 'utf8'), mtimeMs: statSync(path).mtimeMs }
  const again = run(folder)
  assert.equal(again.status, 0, again.stderr)
  assert.equal(readFileSync(path, 'utf8'), first.content)
  assert.equal(statSync(path).mtimeMs, first.mtimeMs)
})

test('touches nothing else in the folder', () => {
  const folder = freshFolder()
  writeFileSync(join(folder, 'notes.md'), 'kept\n')
  assert.equal(run(folder).status, 0)
  assert.equal(readFileSync(join(folder, 'notes.md'), 'utf8'), 'kept\n')
})

test('a folder that does not exist fails loud and creates nothing', () => {
  const missing = join(freshFolder(), 'absent')
  const result = run(missing)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /ENOENT/)
  assert.ok(!existsSync(missing))
})

test('a missing folder argument fails loud', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /folder/)
})
