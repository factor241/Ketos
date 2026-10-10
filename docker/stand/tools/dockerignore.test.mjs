// Run with `node --test docker/stand/tools/dockerignore.test.mjs`.
// Checks Dockerfile.dockerignore against the stand directory: tests and their
// fixtures stay out of the image, and every file the runtime stage copies
// from the build context (the entrypoint and the scripts it calls) stays in.
// Image archives (`docker save | gzip` output) stay out of the build context and
// out of git.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const stand = join(dirname(fileURLToPath(import.meta.url)), '..')
const repository = join(stand, '..', '..')

/** Translate one .dockerignore glob into an anchored regular expression. */
const toRegExp = (glob) => {
  const wildcards = { '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' }
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*\*\/|\*\*|\*|\?/g, (token) => wildcards[token])}$`)
}

const rules = readFileSync(join(stand, 'Dockerfile.dockerignore'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'))
  .map((line) => ({ negate: line.startsWith('!'), regexp: toRegExp(line.replace(/^!/, '')) }))

/** Apply the rules the way Docker does: the last matching rule wins, and a match covers everything beneath it. */
const isIgnored = (path) => {
  const parts = path.split('/')
  const candidates = parts.map((_part, index) => parts.slice(0, index + 1).join('/'))
  let ignored = false
  for (const rule of rules) if (candidates.some((candidate) => rule.regexp.test(candidate))) ignored = !rule.negate
  return ignored
}

test('tests and their fixtures stay out of the image', () => {
  const tools = readdirSync(join(stand, 'tools'))
  const tests = tools.filter((name) => name.endsWith('.test.mjs'))
  assert.ok(tests.length > 0)
  for (const name of tests) assert.ok(isIgnored(`docker/stand/tools/${name}`), name)
  assert.ok(isIgnored('docker/stand/tools/fixtures/syncthing-stock-config.xml'))
})

test('the probe tool and every file the runtime stage copies from the context stay in the image', () => {
  assert.ok(!isIgnored('docker/stand/tools/sync-latency.mjs'))
  const dockerfile = readFileSync(join(stand, 'Dockerfile'), 'utf8')
  const sources = [...dockerfile.matchAll(/^COPY (docker\/stand\/\S+) /gm)].map((match) => match[1])
  assert.ok(sources.includes('docker/stand/ensure-stignore.mjs'))
  assert.ok(sources.includes('docker/stand/run-with-redacted-log.sh'))
  for (const source of sources) {
    assert.ok(existsSync(join(stand, '..', '..', source)), `${source} exists`)
    assert.ok(!isIgnored(source), `${source} is not ignored`)
  }
})

test('secrets stay out of the image and the example stays in the context', () => {
  assert.ok(isIgnored('docker/stand/.env'))
  assert.ok(isIgnored('.env'))
  assert.ok(!isIgnored('docker/stand/.env.example'))
})

test('image archives stay out of the build context, wherever they land', () => {
  assert.ok(isIgnored('ketos-stand-amd64.tar.gz'))
  assert.ok(isIgnored('docker/stand/ketos-stand-arm64.tar.gz'))
  assert.ok(!isIgnored('docker/stand/Dockerfile'))
})

test('image archives stay out of git, wherever they land', (context) => {
  const probe = spawnSync('git', ['check-ignore', '--version'], { cwd: repository, encoding: 'utf8' })
  if (probe.error !== undefined) return context.skip('git is not available')
  for (const path of ['ketos-stand-amd64.tar.gz', 'docker/stand/ketos-stand-arm64.tar.gz']) {
    const result = spawnSync('git', ['check-ignore', '-q', path], { cwd: repository })
    assert.equal(result.status, 0, `${path} is git-ignored`)
  }
})
