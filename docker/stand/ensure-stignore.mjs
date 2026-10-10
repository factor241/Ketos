#!/usr/bin/env node
// Seed the ignore file of the Syncthing-shared folder on container start.
//
// Syncthing never synchronizes `.stignore`, so each Ketos of the stand seeds
// its own copy. An existing file is the user's and stays as it is, so the
// script is safe to run on every start. Usage: ensure-stignore.mjs <folder>;
// the folder must already exist (the entrypoint creates it).
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const folder = process.argv[2]
if (folder === undefined || folder === '') throw new Error('usage: ensure-stignore.mjs <folder>')

const patterns = ['.DS_Store', '*.tmp', '~*']
const path = join(folder, '.stignore')

try {
  // `wx` fails when the file exists, so creation and the existence check are one operation.
  writeFileSync(path, `${patterns.join('\n')}\n`, { flag: 'wx' })
  console.log(`ensure-stignore: created ${path}`)
} catch (error) {
  if (error.code !== 'EEXIST') throw error
  console.log(`ensure-stignore: kept existing ${path}`)
}
