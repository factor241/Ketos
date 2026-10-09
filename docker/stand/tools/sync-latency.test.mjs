// Run with `node --test docker/stand/tools/sync-latency.test.mjs`.
// Checks the probe's accounting: it must measure only the other Ketos's
// changes, count lost changes, and apply the clock offset.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Tracker, decodeFrame, parseArguments } from './sync-latency.mjs'

const note = (id, ownerId, text) => ({ id, kind: 'note', ownerId, data: { text } })

test('own notes are not measured, the other Ketos is', () => {
  const tracker = new Tracker('self', 0, () => 1_000)
  tracker.patch({ upserts: [note('a', 'self', '900'), note('b', 'peer', '900')] })
  assert.deepEqual(tracker.samples.create, [100])
})

test('create, patch, and remove are measured separately and lost changes are counted', () => {
  let clock = 0
  const tracker = new Tracker('self', 0, () => clock)
  clock = 110
  tracker.patch({ upserts: [note('a', 'peer', '100')] })
  clock = 230
  tracker.patch({ upserts: [note('a', 'peer', '200')] })
  clock = 300
  tracker.patch({ upserts: [note('a', 'peer', 'r290')] })
  clock = 320
  tracker.patch({ removes: ['a'] })
  const summary = tracker.summary(2)
  assert.deepEqual(summary.create.samples_ms, [10])
  assert.deepEqual(summary.patch.samples_ms, [30])
  assert.deepEqual(summary.remove.samples_ms, [30])
  assert.equal(summary.create.lost, 1)
})

test('a repeated delivery of the same text counts once and a remove of an unknown id is ignored', () => {
  const tracker = new Tracker('self', 0, () => 500)
  tracker.patch({ upserts: [note('a', 'peer', '400'), note('a', 'peer', '400')], removes: ['zzz'] })
  assert.equal(tracker.samples.create.length, 1)
  assert.equal(tracker.samples.remove.length, 0)
})

test('a sender clock running ahead is corrected: the stamp is later than the true send time', () => {
  // Sender 40 ms ahead: true send 860 on the receiver clock, stamp 900, arrival 1000 → 140 ms.
  const tracker = new Tracker('self', 40, () => 1_000)
  tracker.patch({ upserts: [note('a', 'peer', '900')] })
  assert.deepEqual(tracker.samples.create, [140])
})

test('a removal that arrives merged with its marker counts as received, not lost', () => {
  const tracker = new Tracker('self', 0, () => 500)
  tracker.patch({ upserts: [note('a', 'peer', '400')] })
  tracker.patch({ removes: ['a'] })
  const summary = tracker.summary(1)
  assert.equal(summary.remove.received, 1)
  assert.equal(summary.remove.lost, 0)
  assert.equal(summary.remove.unmeasured, 1)
})

test('frames decode and malformed data is ignored', () => {
  assert.deepEqual(decodeFrame('event: patch\ndata: {"a":1}'), { name: 'patch', payload: { a: 1 } })
  assert.equal(decodeFrame('event: patch\ndata: {broken'), undefined)
  assert.equal(decodeFrame(': keepalive'), undefined)
})

test('flags need base and token and numeric values', () => {
  assert.throws(() => parseArguments(['--base', 'http://x']), /required/u)
  assert.throws(() => parseArguments(['--base', 'http://x', '--token', 't', '--count', 'many']), /number/u)
  assert.equal(parseArguments(['--base', 'http://x/', '--token', 't', '--offset-ms', '12']).offsetMs, 12)
})
