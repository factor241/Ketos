/**
 * Child-process probe of the database open sequence: opens the clone database
 * named by the first argument and reports how long the open waited. A
 * synchronous write signals the parent before the open blocks this thread.
 */
import { writeSync } from 'node:fs'
import { openDatabase } from '../../src/db.ts'

const path = process.argv[2]
if (path === undefined) throw new Error('open-database-child: database path argument is required')
writeSync(1, 'opening\n')
const started = Date.now()
const db = await openDatabase(path)
writeSync(1, `opened ${String(Date.now() - started)}\n`)
db.close()
