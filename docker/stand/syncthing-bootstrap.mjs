#!/usr/bin/env node
// Syncthing configuration for the Ketos stand, applied on every container start.
//
// `syncthing generate` writes a stock config.xml that discovers peers through
// public global/local announce servers, NAT traversal, and public relays; the
// demonstration must use only the team's private relay. This script edits the
// file before Syncthing ever runs and is idempotent, so a restart after a failed
// first start never serves the stock config and contacts no public node. Every
// expected element must exist: a template drift fails loud instead of silently
// shipping a partly configured stand.
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

// Replace every <listenAddress> so a rerun (or a changed relay value) ends with
// exactly the relay and the direct TCP address, never the stock `default`.
const listenPattern = /[ \t]*<listenAddress>[^<]*<\/listenAddress>\n?/g
const listenMatches = xml.match(listenPattern)
if (listenMatches === null) throw new Error('Syncthing config.xml has no <listenAddress> element; template drift?')
const escapedRelay = escapeXml(relay)
let first = true
xml = xml.replace(listenPattern, () => {
  if (!first) return ''
  first = false
  return `        <listenAddress>${escapedRelay}</listenAddress>\n        <listenAddress>tcp://0.0.0.0:22000</listenAddress>\n`
})

writeFileSync(path, xml)
console.log(`syncthing-bootstrap: pinned ${path} to the private relay without public discovery`)
