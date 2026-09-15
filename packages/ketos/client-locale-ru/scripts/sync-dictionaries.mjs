/**
 * Regenerate the Ketos Russian dictionaries from the community pack corpus.
 *
 * The dictionaries are generated artifacts: `dictionary-overrides.json` carries
 * the rebranding overrides and the translations authored for the keys the
 * community pack does not cover. Re-run this script after refreshing the fork
 * corpus with the community pack's `scripts/extract.mjs` (see the package
 * README "Development" section).
 *
 * Usage:
 *   node scripts/sync-dictionaries.mjs \
 *     --corpus <corpus.json> --community <dict/ru directory>
 *
 * Outputs (relative to the package root):
 *   src/locales/common-ru.ts, src/locales/pack-ru.ts, tests/fixtures/ru-keys.json
 *
 * Only `common` and the 42 remaining namespaces are emitted; `board` stays a
 * hand-written typed dictionary, and the manifest records its keys for the
 * coverage spec.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function arg(flag) {
  const index = process.argv.indexOf(flag)
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`sync-dictionaries: missing required ${flag}`)
  }
  return resolve(process.argv[index + 1])
}

const corpus = JSON.parse(readFileSync(arg('--corpus'), 'utf8'))
const communityDir = arg('--community')
const data = JSON.parse(readFileSync(join(packageRoot, 'scripts/dictionary-overrides.json'), 'utf8'))

const community = {}
for (const file of readdirSync(communityDir)) {
  if (!file.endsWith('.json')) continue
  community[file.slice(0, -'.json'.length)] = JSON.parse(readFileSync(join(communityDir, file), 'utf8'))
}

const dictionaries = {}
const unresolved = []
for (const [namespace, keys] of Object.entries(corpus)) {
  if (namespace === 'board') continue
  const dictionary = {}
  for (const key of Object.keys(keys).sort()) {
    const override = data.overrides?.[namespace]?.[key]
    const communityValue = community[namespace]?.[key]
    const gapValue = data.translations?.[namespace]?.[key]
    if (override !== undefined) dictionary[key] = override
    else if (communityValue !== undefined) dictionary[key] = communityValue
    else if (gapValue !== undefined) dictionary[key] = gapValue
    else unresolved.push(`${namespace}/${key}`)
  }
  if (Object.keys(dictionary).length > 0) dictionaries[namespace] = dictionary
}
if (unresolved.length > 0) {
  throw new Error(`sync-dictionaries: no translation for ${unresolved.join(', ')}`)
}

function tsString(value) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`
}

function entries(dictionary, indent) {
  return Object.keys(dictionary).sort().map(key => `${indent}${tsString(key)}: ${tsString(dictionary[key])},`)
}

const common = dictionaries.common
delete dictionaries.common

writeFileSync(join(packageRoot, 'src/locales/common-ru.ts'), [
  '/**',
  ' * Russian base dictionary for the `common` namespace: the full ru corpus of',
  ' * the Ketos shell, rebranded from the community `deepseek-harness-locale-ru`',
  ' * pack (MIT; see the package README). The `satisfies` check pins the key set',
  " * to the owning package's en dictionary; the import is type-only, so the",
  ' * client bundle stays pure.',
  ' */',
  "import type { CommonKey } from '@deepseek-ai/dsh-client-locale/client'",
  '',
  '/** Dictionary registered into `locale` for the common namespace. */',
  'export const ru = {',
  ...entries(common, '  '),
  '} satisfies Record<CommonKey, string>',
  '',
].join('\n'))

const packLines = [
  '/**',
  ' * Russian dictionaries for every Ketos UI namespace outside `common` and',
  ' * `board`: the community `deepseek-harness-locale-ru` pack (33 namespaces,',
  ' * MIT; see the package README for attribution and the sync procedure),',
  ' * rebranded to Ketos and extended with the keys the Ketos corpus adds, so',
  ' * each namespace covers its complete en key set.',
  ' */',
  '',
  '/** One translated dictionary per namespace, keyed by the locale namespace id. */',
  'export const ru: Record<string, Record<string, string>> = {',
]
for (const namespace of Object.keys(dictionaries).sort()) {
  packLines.push(`  ${tsString(namespace)}: {`)
  packLines.push(...entries(dictionaries[namespace], '    '))
  packLines.push('  },')
}
packLines.push('}', '')
writeFileSync(join(packageRoot, 'src/locales/pack-ru.ts'), packLines.join('\n'))

const manifest = {}
for (const [namespace, keys] of Object.entries(corpus)) {
  manifest[namespace] = Object.keys(keys).sort()
}
mkdirSync(join(packageRoot, 'tests/fixtures'), { recursive: true })
writeFileSync(join(packageRoot, 'tests/fixtures/ru-keys.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const keyCount = Object.values(dictionaries).reduce((sum, dictionary) => sum + Object.keys(dictionary).length, 0)
console.log(`common: ${Object.keys(common).length} keys`)
console.log(`pack: ${Object.keys(dictionaries).length} namespaces, ${keyCount} keys`)
console.log(`manifest: ${Object.keys(manifest).length} namespaces`)
