// Run with `node --test docker/stand/tools/run-with-redacted-log.test.mjs`.
// Checks run-with-redacted-log.sh, which the entrypoint starts Syncthing
// through: the relay token never reaches the log file, everything else in the
// output is kept, lines reach the file while the command still runs, and the
// command keeps the process ID the entrypoint waits on and kills.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'run-with-redacted-log.sh')

const relayId = 'ABCDEFG-ABCDEFG-ABCDEFG-ABCDEFG-ABCDEFG-ABCDEFG-ABCDEFG-ABCDEFG'
/** A fake token; the real one never appears in any test. */
const token = 'FAKETOKEN0123456789abcdef'
const relayUrl = `relay://203.0.113.7:22067/?id=${relayId}&token=${token}`
const redactedUrl = `relay://203.0.113.7:22067/?id=${relayId}&token=REDACTED`

const scratch = () => mkdtempSync(join(tmpdir(), 'st-redact-'))

/** Wait until `done()` holds, polling every 25 ms; fails the test after `timeoutMs`. */
const until = async (done, what, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs
  while (!done()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`)
    await sleep(25)
  }
}

/** Run the script with a shell one-liner as the command and wait until the log holds its complete output. */
const logOf = async (command, { env = {}, log = join(scratch(), 'out.log') } = {}) => {
  const child = spawn('sh', [script, log, 'sh', '-c', command], { env: { PATH: process.env['PATH'], ...env }, stdio: 'ignore' })
  const status = await new Promise((resolve) => child.on('exit', (code) => resolve(code)))
  return { status, log, pid: child.pid }
}

/** Wait until the log file holds `expected` exactly (the filter drains after the command exits). */
const expectLog = async (log, expected) => {
  await until(() => existsSync(log) && readFileSync(log, 'latin1') === expected, `${log} to hold the expected output`)
  assert.equal(readFileSync(log, 'latin1'), expected)
}

test('replaces the token value in Syncthing log lines and keeps the rest of every line', async () => {
  const lines = [
    `2026-10-09 17:13:48 INF Relay listener starting (id=${relayUrl} log.pkg=connections)`,
    `2026-10-09 17:13:48 WRN Service failed (error="dial tcp 127.0.0.1:22067: connect: connection refused" supervisor=listenerSupervisor@${relayUrl} service=${relayUrl} log.pkg=svcutil)`,
    '2026-10-09 17:13:48 INF TCP listener starting (address="[::]:22000" log.pkg=connections)',
  ]
  const { status, log } = await logOf(`cat <<'EOF'\n${lines.join('\n')}\nEOF`)
  assert.equal(status, 0)
  await expectLog(log, `${lines.map((line) => line.replaceAll(relayUrl, redactedUrl)).join('\n')}\n`)
  assert.ok(!readFileSync(log, 'utf8').includes(token))
})

test('redacts every occurrence on one line and a token that ends at a quote or at the end of the line', async () => {
  const output = [`a token=${token} b token=${token}&x=1`, `msg="relay token=${token}" tail`, `last token=${token}`, 'token=&x=1'].join('\n')
  const { status, log } = await logOf(`cat <<'EOF'\n${output}\nEOF`)
  assert.equal(status, 0)
  await expectLog(log, 'a token=REDACTED b token=REDACTED&x=1\nmsg="relay token=REDACTED" tail\nlast token=REDACTED\ntoken=REDACTED&x=1\n')
})

test('leaves text without a token untouched, including similar words and the relay id', async () => {
  const output = [`id=${relayId}`, 'tokens=7 mytoken is not a parameter', 'a&b=c "quoted" 100% \\ backslash'].join('\n')
  const { status, log } = await logOf(`cat <<'EOF'\n${output}\nEOF`)
  assert.equal(status, 0)
  await expectLog(log, `${output}\n`)
})

test('redacts tokens from standard error as well as standard output', async () => {
  const { status, log } = await logOf(`echo "out token=${token} done"; echo "err token=${token} done" >&2`)
  assert.equal(status, 0)
  await until(() => existsSync(log) && readFileSync(log, 'utf8').split('\n').length === 3, 'both streams in the log')
  assert.deepEqual(readFileSync(log, 'utf8').split('\n').sort(), ['', 'err token=REDACTED done', 'out token=REDACTED done'])
})

test('redacts a token containing bytes that are invalid in UTF-8, whatever the inherited locale is', async () => {
  const { status, log } = await logOf("printf 'before token=ab\\377cd after\\n'", { env: { LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' } })
  assert.equal(status, 0)
  await expectLog(log, 'before token=REDACTED after\n')
})

test('writes a line to the log while the command is still running', async () => {
  const dir = scratch()
  const stop = join(dir, 'stop')
  const log = join(dir, 'out.log')
  const child = spawn('sh', [script, log, 'sh', '-c', `echo "live token=${token} line"; while [ ! -e '${stop}' ]; do sleep 0.05; done`], { stdio: 'ignore' })
  const exited = new Promise((resolve) => child.on('exit', resolve))
  try {
    await until(() => existsSync(log) && readFileSync(log, 'utf8') === 'live token=REDACTED line\n', 'the first line without waiting for the command to end')
    assert.equal(child.exitCode, null, 'the command was still running when the line appeared')
  } finally {
    writeFileSync(stop, '')
    await exited
  }
})

test('the command keeps the process ID of the script and its exit status', async () => {
  const dir = scratch()
  const pidFile = join(dir, 'pid')
  const { status, pid } = await logOf(`echo $$ > '${pidFile}'; exit 7`, { log: join(dir, 'out.log') })
  assert.equal(status, 7)
  assert.equal(Number(readFileSync(pidFile, 'utf8')), pid)
})

test('a signal sent to the process ID of the script ends the command process itself', async () => {
  const dir = scratch()
  const log = join(dir, 'out.log')
  const commandPidFile = join(dir, 'command-pid')
  const child = spawn('sh', [script, log, 'sh', '-c', `echo $$ > '${commandPidFile}'; echo started; exec sleep 60`], { stdio: 'ignore' })
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve(signal)))
  await until(() => existsSync(log) && readFileSync(log, 'utf8') === 'started\n', 'the command to start')
  const commandPid = Number(readFileSync(commandPidFile, 'utf8'))
  const commandAlive = () => {
    try {
      process.kill(commandPid, 0)
      return true
    } catch (error) {
      // ESRCH: no process has this ID any more.
      if (error.code === 'ESRCH') return false
      throw error
    }
  }
  try {
    child.kill('SIGTERM')
    assert.equal(await exited, 'SIGTERM')
    await until(() => !commandAlive(), 'the command process to end')
  } finally {
    if (commandAlive()) process.kill(commandPid, 'SIGKILL')
  }
})

test('truncates a log left by an earlier start, so an old unredacted token does not survive', async () => {
  const dir = scratch()
  const log = join(dir, 'out.log')
  writeFileSync(log, `old line token=${token}\n`)
  const { status } = await logOf('echo new', { log })
  assert.equal(status, 0)
  await expectLog(log, 'new\n')
})

test('removes the temporary pipe once the command is running', async () => {
  const tmp = scratch()
  const { status, log } = await logOf('echo done', { env: { TMPDIR: tmp } })
  assert.equal(status, 0)
  await expectLog(log, 'done\n')
  await until(() => readdirSync(tmp).length === 0, 'the temporary pipe directory to disappear')
})

test('a command that cannot be executed fails with status 127 and names the command on standard error', () => {
  const dir = scratch()
  const result = spawnSync('sh', [script, join(dir, 'out.log'), 'ketos-stand-no-such-command'], { encoding: 'utf8', timeout: 10_000, env: { PATH: process.env['PATH'] } })
  assert.equal(result.status, 127)
  assert.match(result.stderr, /ketos-stand-no-such-command/)
})

test('an unwritable log path fails loud before the command runs', () => {
  const dir = scratch()
  const marker = join(dir, 'ran')
  const result = spawnSync('sh', [script, join(dir, 'absent', 'out.log'), 'sh', '-c', `touch '${marker}'`], { encoding: 'utf8', timeout: 10_000 })
  assert.notEqual(result.status, 0)
  assert.ok(!existsSync(marker))
})

test('a missing log path or command fails loud', () => {
  const none = spawnSync('sh', [script], { encoding: 'utf8', timeout: 10_000 })
  assert.notEqual(none.status, 0)
  assert.match(none.stderr, /usage/)
  const dir = scratch()
  const noCommand = spawnSync('sh', [script, join(dir, 'out.log')], { encoding: 'utf8', timeout: 10_000 })
  assert.notEqual(noCommand.status, 0)
  assert.match(noCommand.stderr, /usage/)
  assert.ok(!existsSync(join(dir, 'out.log')))
})
