#!/usr/bin/env node
// First-start Syncthing configuration for the Ketos stand.
//
// `syncthing generate` writes a stock config.xml that discovers peers through
// public global/local announce servers, NAT traversal, and public relays; the
// demonstration must use only the team's private relay. This script edits the
// generated file before Syncthing ever runs, so no public node is contacted on
// first start. Every expected element must exist: a template drift fails loud
// instead of silently shipping a partly configured stand.
import { readFileSync, writeFileSync } from 'node:fs'

const home = process.env['SYNCTHING_HOME'] ?? '/data/syncthing'
const relay = process.env['KETOS_SYNCTHING_RELAY'] ?? ''
const apiKey = process.env['STGUIAPIKEY'] ?? ''

if (relay === '' || !relay.startsWith('relay://') || !relay.includes('?id=')) {
  throw new Error('KETOS_SYNCTHING_RELAY must be a relay:// URL carrying ?id= (see docker/stand/.env.example)')
}
if (apiKey === '') throw new Error('STGUIAPIKEY must be set (openssl rand -hex 16)')

/** Escape one value for XML text content. */
const escapeXml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const path = `${home}/config.xml`
let xml = readFileSync(path, 'utf8')

/** Replace the text of one element, or fail when the template has no such element. */
const setElement = (tag, value) => {
  const pattern = new RegExp(`(<${tag}>)[^<]*(</${tag}>)`)
  if (!pattern.test(xml)) throw new Error(`Syncthing config.xml has no <${tag}> element; template drift?`)
  const escaped = escapeXml(value)
  xml = xml.replace(pattern, (_match, open, close) => `${open}${escaped}${close}`)
}

setElement('globalAnnounceEnabled', 'false')
setElement('localAnnounceEnabled', 'false')
setElement('natEnabled', 'false')
setElement('relaysEnabled', 'true')
setElement('crashReportingEnabled', 'false')
setElement('urAccepted', '-1')
setElement('autoUpgradeIntervalH', '0')
setElement('stunKeepaliveStartS', '0')
setElement('announceLANAddresses', 'false')
setElement('apikey', apiKey)

const listen = '<listenAddress>default</listenAddress>'
if (!xml.includes(listen)) throw new Error('Syncthing config.xml has no default <listenAddress>; template drift?')
const escapedRelay = escapeXml(relay)
xml = xml.replace(
  listen,
  () => `<listenAddress>${escapedRelay}</listenAddress>\n        <listenAddress>tcp://0.0.0.0:22000</listenAddress>`,
)

writeFileSync(path, xml)
console.log(`syncthing-bootstrap: pinned ${path} to the private relay without public discovery`)
