// Run with `node --test docker/stand/tools/docker-entrypoint.test.mjs`.
// Checks how docker-entrypoint.sh starts Syncthing: through the redacting
// wrapper (the relay token must not reach /data/syncthing/syncthing.log), as a
// background job whose `$!` is Syncthing's own process ID (the shutdown trap
// signals that ID), with the wrapper copied into the image where the
// entrypoint calls it, and with the shared folder's `.stignore` seeded before
// Syncthing starts (Syncthing reads `.stignore` when it scans the folder).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const stand = join(dirname(fileURLToPath(import.meta.url)), '..')
const entrypoint = readFileSync(join(stand, 'docker-entrypoint.sh'), 'utf8')
const wrapper = '/usr/local/share/ketos-stand/run-with-redacted-log.sh'

/** The entrypoint with backslash line continuations joined, so one command is one line. */
const lines = entrypoint.replace(/\s*\\\n\s*/g, ' ').split('\n')

test('the entrypoint is valid POSIX shell syntax', () => {
  const result = spawnSync('sh', ['-n', join(stand, 'docker-entrypoint.sh')], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('Syncthing runs in the background through the redacting wrapper, and $! is its process ID', () => {
  const index = lines.findIndex((line) => line.includes('syncthing serve'))
  assert.notEqual(index, -1)
  assert.match(lines[index], new RegExp(`^sh ${wrapper.replaceAll('.', '\\.')} /data/syncthing/syncthing\\.log syncthing serve .* &$`))
  assert.equal(lines[index + 1], 'SYNCTHING_PID=$!')
  assert.equal(entrypoint.match(/syncthing\.log/g).length, 1, 'no other command writes to the log')
})

test('the Dockerfile copies the wrapper to the path the entrypoint calls', () => {
  const dockerfile = readFileSync(join(stand, 'Dockerfile'), 'utf8')
  assert.ok(dockerfile.includes(`COPY docker/stand/run-with-redacted-log.sh ${wrapper}\n`))
})

const ensureStignore = '/usr/local/share/ketos-stand/ensure-stignore.mjs'

/** Whether a script runs `ensure-stignore.mjs` on `/workspace/shared` in a line before its `syncthing serve` line. */
const seedsStignoreBeforeSyncthing = (script) => {
  const commands = script.replace(/\s*\\\n\s*/g, ' ').split('\n')
  const seed = commands.findIndex((line) => line === `node ${ensureStignore} /workspace/shared`)
  const serve = commands.findIndex((line) => line.includes('syncthing serve'))
  return seed !== -1 && serve !== -1 && seed < serve
}

test('the entrypoint seeds .stignore before Syncthing starts', () => {
  assert.ok(seedsStignoreBeforeSyncthing(entrypoint))
})

test('the check rejects an entrypoint that drops the seed call or moves it after Syncthing', () => {
  const call = `node ${ensureStignore} /workspace/shared\n`
  assert.ok(entrypoint.includes(call))
  assert.ok(!seedsStignoreBeforeSyncthing(entrypoint.replace(call, '')))
  assert.ok(!seedsStignoreBeforeSyncthing(`${entrypoint.replace(call, '')}${call}`))
})

test('the Dockerfile copies ensure-stignore.mjs to the path the entrypoint calls', () => {
  const dockerfile = readFileSync(join(stand, 'Dockerfile'), 'utf8')
  assert.ok(dockerfile.includes(`COPY docker/stand/ensure-stignore.mjs ${ensureStignore}\n`))
})
