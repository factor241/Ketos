// Run with `node --test docker/stand/tools/stand-patch.test.mjs`.
// Checks two rows of stand.patch.yml. In the `ketos-peer` row the Syncthing
// section keeps its fixed keys, and the `relayAddress` expression drops only
// the relay's `token` parameter, so the secret never reaches the plugin config
// or the address that is shared with the other Ketos. The `ketos-board-todo`
// row restates the web profile's row with only a longer `bd` call timeout.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

const here = dirname(fileURLToPath(import.meta.url))

// The same `!!js` dialect the Loader's include plugin parses.
const jsTag = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (value) => value instanceof Object && '__jsExpr' in value,
})
const schema = yaml.JSON_SCHEMA.extend(jsTag)

const rows = yaml.load(readFileSync(join(here, '..', 'stand.patch.yml'), 'utf8'), { schema })
const peer = rows.find((row) => row.id === 'ketos-peer')
const todo = rows.find((row) => row.id === 'ketos-board-todo')

// The web profile's own row sits inside the bundle patch's `insert` block.
const bundleRows = yaml.load(readFileSync(join(here, '..', '..', '..', 'packages', 'bundle', 'web-app', 'cordis.patch.yml'), 'utf8'), { schema })
const shippedTodo = bundleRows.flatMap((row) => row.insert ?? [row]).find((row) => row.id === 'ketos-board-todo')

/** Evaluate one `!!js` node the way the Loader does: a direct eval inside `with (ctx)`. */
const evaluate = (node, env) => new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')({ process: { env } }, node.__jsExpr)

const relayAddress = (relay) => evaluate(peer.config.syncthing.relayAddress, relay === undefined ? {} : { KETOS_SYNCTHING_RELAY: relay })

test('the ketos-peer row restates every key of the peer config and enables the row', () => {
  assert.equal(peer.disabled, false)
  assert.deepEqual(Object.keys(peer.config), ['name', 'relayUrls', 'keyPath', 'peersPath', 'connectTimeoutMs', 'reconnectMaxMs', 'syncthing'])
})

test('the ketos-peer row caps the reconnection pause at 5 seconds, below the 20-second package default', () => {
  assert.equal(peer.config.reconnectMaxMs, 5000)
})

test('the ketos-peer row times a dial out after 5 seconds, below the 10-second package default', () => {
  assert.equal(peer.config.connectTimeoutMs, 5000)
})

test('a dial that times out between two capped pauses still fits the 30-second recovery bound', () => {
  const { connectTimeoutMs, reconnectMaxMs } = peer.config
  const measuredDialMs = 1000
  assert.ok(reconnectMaxMs + connectTimeoutMs + reconnectMaxMs + measuredDialMs <= 30_000)
})

test('the Syncthing section carries the fixed keys and reads the API key by environment name', () => {
  const { relayAddress: _expression, ...fixed } = peer.config.syncthing
  assert.deepEqual(fixed, {
    url: 'http://127.0.0.1:8384',
    apiKeyEnv: 'STGUIAPIKEY',
    folderId: 'ketos-shared',
    folderPath: '/workspace/shared',
    fsWatcherDelayS: 1,
  })
})

test('relayAddress drops the token and keeps scheme, host, port, and id', () => {
  const address = relayAddress('relay://203.0.113.7:22067/?id=ABC&token=SECRET')
  assert.equal(address, 'relay://203.0.113.7:22067/?id=ABC')
  assert.ok(!address.includes('SECRET'))
})

test('relayAddress drops the token wherever it stands in the query', () => {
  assert.equal(relayAddress('relay://203.0.113.7:22067/?token=SECRET&id=ABC'), 'relay://203.0.113.7:22067/?id=ABC')
  assert.equal(relayAddress('relay://203.0.113.7:22067/?id=ABC&token=SECRET&pingInterval=1m0s'), 'relay://203.0.113.7:22067/?id=ABC&pingInterval=1m0s')
})

test('relayAddress keeps the other parameters with the same decoded values', () => {
  const address = new URL(relayAddress('relay://relay.example:22067/?id=AAAA-BBBB&statusAddr=:22070&token=SECRET'))
  assert.deepEqual([...address.searchParams], [['id', 'AAAA-BBBB'], ['statusAddr', ':22070']])
  assert.equal(address.host, 'relay.example:22067')
})

test('relayAddress leaves a value without a token unchanged', () => {
  assert.equal(relayAddress('relay://203.0.113.7:22067/?id=ABC'), 'relay://203.0.113.7:22067/?id=ABC')
})

test('relayAddress is empty without the environment value, which the plugin rejects at load', () => {
  assert.equal(relayAddress(undefined), '')
  assert.equal(relayAddress(''), '')
})

test('relayAddress is empty for an unparsable value and no exception carries the token', () => {
  for (const relay of ['relay://203.0.113.7:220677/?id=ABC&token=SECRET', 'SECRET not a url']) {
    assert.doesNotThrow(() => relayAddress(relay), relay)
    assert.equal(relayAddress(relay), '')
  }
})

test('the ketos-board-todo row restates the web profile row and raises only bdTimeoutMs to 60 seconds', () => {
  assert.equal(todo.name, '@ketos/board-todo')
  assert.equal(shippedTodo.config.bdTimeoutMs, 15000)
  assert.deepEqual(todo.config, { ...shippedTodo.config, bdTimeoutMs: 60000 })
})
