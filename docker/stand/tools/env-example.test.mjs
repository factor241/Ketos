// Run with `node --test docker/stand/tools/env-example.test.mjs`.
// Checks .env.example: compose lists the root `.env` first and `docker/stand/.env`
// second, so an empty `KEY=` line copied from the example would replace a value
// the root `.env` supplies (the model key) with an empty string.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const stand = join(dirname(fileURLToPath(import.meta.url)), '..')
const lines = readFileSync(join(stand, '.env.example'), 'utf8').split('\n')

const assignments = lines.filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))

test('no active assignment in the example is empty', () => {
  assert.ok(assignments.length > 0)
  for (const line of assignments) {
    const value = line.slice(line.indexOf('=') + 1).trim()
    assert.ok(value !== '' && value !== '""' && value !== "''", `${line} would override the root .env with an empty value`)
  }
})

test('the model key is commented out and says where it may live', () => {
  assert.ok(!assignments.some((line) => line.startsWith('OPENCODE_GO_API_KEY=')))
  const index = lines.findIndex((line) => line.startsWith('# OPENCODE_GO_API_KEY='))
  assert.notEqual(index, -1)
  const note = lines.slice(Math.max(0, index - 4), index).join('\n')
  assert.match(note, /root `\.env`/)
  assert.match(note, /never empty/i)
})

test('the Syncthing GUI key comment gives a recipe for Windows next to the openssl one', () => {
  const comment = lines.filter((line) => line.startsWith('#')).join('\n')
  assert.ok(comment.includes('openssl rand -hex 16'))
  assert.ok(comment.includes("[guid]::NewGuid().ToString('N')"))
})
