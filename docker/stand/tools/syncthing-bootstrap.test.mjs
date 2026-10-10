// Run with `node --test docker/stand/tools/syncthing-bootstrap.test.mjs`.
// Checks that syncthing-bootstrap.mjs can run on every container start:
// the second run must leave the same config.xml, and a partial failure must
// exit non-zero so the entrypoint never starts Syncthing on a stock config.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'syncthing-bootstrap.mjs')
const stock = join(here, 'fixtures', 'syncthing-stock-config.xml')
const relay = 'relay://203.0.113.7:22067/?id=AAAA-BBBB&token=t0k'

/** Run the bootstrap against a home directory holding one copy of the stock config. */
const run = (home, env = {}) =>
  spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'], SYNCTHING_HOME: home, KETOS_SYNCTHING_RELAY: relay, STGUIAPIKEY: 'k'.repeat(32), ...env },
  })

const freshHome = () => {
  const home = mkdtempSync(join(tmpdir(), 'st-bootstrap-'))
  copyFileSync(stock, join(home, 'config.xml'))
  return home
}

test('first run pins the relay and disables public discovery', () => {
  const home = freshHome()
  const result = run(home)
  assert.equal(result.status, 0, result.stderr)
  const xml = readFileSync(join(home, 'config.xml'), 'utf8')
  assert.match(xml, /<globalAnnounceEnabled>false</)
  assert.match(xml, /<natEnabled>false</)
  assert.equal(xml.match(/<listenAddress>/g).length, 2)
  assert.ok(!xml.includes('<listenAddress>default</listenAddress>'))
})

test('first run pins the reconnection interval to 10 seconds', () => {
  const home = freshHome()
  assert.match(readFileSync(join(home, 'config.xml'), 'utf8'), /<reconnectionIntervalS>20</, 'the stock value is not 10')
  const result = run(home)
  assert.equal(result.status, 0, result.stderr)
  const xml = readFileSync(join(home, 'config.xml'), 'utf8')
  assert.equal(xml.match(/<reconnectionIntervalS>/g).length, 1)
  assert.match(xml, /<reconnectionIntervalS>10<\/reconnectionIntervalS>/)
})

test('first run pins the relay redial interval to 1 minute', () => {
  const home = freshHome()
  assert.match(readFileSync(join(home, 'config.xml'), 'utf8'), /<relayReconnectIntervalM>10</, 'the stock value is not 1')
  const result = run(home)
  assert.equal(result.status, 0, result.stderr)
  const xml = readFileSync(join(home, 'config.xml'), 'utf8')
  assert.equal(xml.match(/<relayReconnectIntervalM>/g).length, 1)
  assert.match(xml, /<relayReconnectIntervalM>1<\/relayReconnectIntervalM>/)
})

test('a template without <relayReconnectIntervalM> fails loud and names the element', () => {
  const home = freshHome()
  const path = join(home, 'config.xml')
  writeFileSync(path, readFileSync(path, 'utf8').replace(/[ \t]*<relayReconnectIntervalM>[^<]*<\/relayReconnectIntervalM>\n?/, ''))
  const result = run(home)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /relayReconnectIntervalM/)
})

test('a template without <reconnectionIntervalS> fails loud and names the element', () => {
  const home = freshHome()
  const path = join(home, 'config.xml')
  writeFileSync(path, readFileSync(path, 'utf8').replace(/[ \t]*<reconnectionIntervalS>[^<]*<\/reconnectionIntervalS>\n/, ''))
  const result = run(home)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /reconnectionIntervalS/)
})

test('second run on an already bootstrapped config succeeds and changes nothing', () => {
  const home = freshHome()
  assert.equal(run(home).status, 0)
  const once = readFileSync(join(home, 'config.xml'), 'utf8')
  const again = run(home)
  assert.equal(again.status, 0, again.stderr)
  assert.equal(readFileSync(join(home, 'config.xml'), 'utf8'), once)
})

test('a changed relay on a bootstrapped config replaces the old listen addresses', () => {
  const home = freshHome()
  assert.equal(run(home).status, 0)
  const next = 'relay://203.0.113.9:22067/?id=CCCC&token=n3w'
  assert.equal(run(home, { KETOS_SYNCTHING_RELAY: next }).status, 0)
  const xml = readFileSync(join(home, 'config.xml'), 'utf8')
  assert.ok(xml.includes('203.0.113.9') && !xml.includes('203.0.113.7'))
  assert.equal(xml.match(/<listenAddress>/g).length, 2)
})

test('a template without the expected elements fails loud', () => {
  const home = freshHome()
  writeFileSync(join(home, 'config.xml'), '<configuration></configuration>')
  assert.notEqual(run(home).status, 0)
})

test('a missing relay value fails loud', () => {
  const home = freshHome()
  assert.notEqual(run(home, { KETOS_SYNCTHING_RELAY: '' }).status, 0)
})
