// Run with `node --test docker/stand/tools/readme.test.mjs`.
// Checks statements of README.md and README.zh.md that an operator acts on:
// where the image archive goes, which tags the architecture-specific build
// takes, how a lost link is timed, how the Syncthing GUI key is minted on
// Windows, which ports service B publishes, what the board shows after manual
// Syncthing linking, which volumes are removed together, how the model key is
// enabled, where computer B finds the archive, and what the Contents list says
// about the tests and the reconnection cap, and which Syncthing intervals the
// bootstrap pins.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const stand = join(dirname(fileURLToPath(import.meta.url)), '..')
const readmes = [
  {
    language: 'en',
    text: readFileSync(join(stand, 'README.md'), 'utf8'),
    portsLine: /^Service `ketos-b` /m,
    headings: { manual: /^## Manual Syncthing linking$/m, windows: /^## Windows 11 \(computer B\)$/m, preparation: /^## Preparation$/m, contents: /^## Contents$/m },
    words: { uncomment: /uncomment/i, archives: /archive/i, seed: /\.stignore/, cap: /\b5-second cap\b/, staleCap: /\b10-second cap\b/, relayRedial: /1-minute relay redial interval/, dialTimeout: /5-second dial timeout \(`connectTimeoutMs`/, bound: /a dial that may time out at 5 s/, staleDial: /failed dial 10 s|after 10 seconds/ },
  },
  {
    language: 'zh',
    text: readFileSync(join(stand, 'README.zh.md'), 'utf8'),
    portsLine: /^服务 `ketos-b` /m,
    headings: { manual: /^## 手动连接 Syncthing$/m, windows: /^## Windows 11（计算机 B）$/m, preparation: /^## 准备$/m, contents: /^## 组成$/m },
    words: { uncomment: /取消注释/, archives: /归档/, seed: /\.stignore/, cap: /上限 5 秒/, staleCap: /上限 10 秒/, relayRedial: /中继重拨间隔 1 分钟/, dialTimeout: /拨号超时 5 秒（`connectTimeoutMs`/, bound: /可能在 5 秒时超时的一次拨号/, staleDial: /失败的拨号 10 秒|10 秒后超时/ },
  },
]

/** Every `docker buildx build` command of a README, in a code block or inline in prose, up to the closing backtick or line end. */
const buildCommands = (text) => [...text.replace(/\\\n\s*/g, ' ').matchAll(/docker buildx build[^`\n]*/g)].map((match) => match[0])

/** The text of the section whose heading `heading` matches, up to the next level-2 heading. */
const section = (text, heading) => {
  const start = text.search(heading)
  assert.notEqual(start, -1)
  const rest = text.slice(start + 1)
  const end = rest.search(/^## /m)
  return end === -1 ? rest : rest.slice(0, end)
}

for (const { language, text, portsLine, headings, words } of readmes) {
  test(`${language}: the image archive is written outside the repository`, () => {
    const targets = [...text.matchAll(/>\s*(\S+\.tar\.gz)/g)].map((match) => match[1])
    assert.ok(targets.length >= 2, 'the Two computers and Windows sections both save an archive')
    for (const target of targets) assert.match(target, /^(~|\$HOME)\//, `${target} must not be a path inside the build context`)
    for (const source of [...text.matchAll(/gzip -dc (\S+\.tar\.gz)/g)].map((match) => match[1])) {
      assert.match(source, /^(~|\$HOME)\//, source)
    }
  })

  test(`${language}: a lost link is timed by the channel heartbeat, not by QUIC idle time`, () => {
    assert.doesNotMatch(text, /QUIC/)
    assert.ok(text.split('\n').some((line) => line.includes('`lost`') && /\b9\s*(?:–|-|to|至)\s*12\b/.test(line)))
    assert.ok(text.includes('heartbeatTimeoutMs'))
  })

  test(`${language}: an architecture build takes its architecture tag, and the local tag is set only by a load on the other computer`, () => {
    const builds = buildCommands(text).filter((command) => command.includes('--platform'))
    assert.ok(builds.length >= 2, 'the Two computers and Windows sections both build for another architecture')
    for (const command of builds) {
      assert.match(command, /-t ketos-stand:(?:amd64|arm64)(?:\s|$)/)
      assert.doesNotMatch(command, /-t ketos-stand:local/)
    }
    assert.ok(text.includes('docker tag ketos-stand:amd64 ketos-stand:local'))
  })

  test(`${language}: the Syncthing GUI key has a PowerShell recipe next to the openssl one`, () => {
    assert.match(text, /openssl rand -hex 16[^\n]*\[guid\]::NewGuid\(\)\.ToString\('N'\)/)
  })

  test(`${language}: the ports sentence for service B scopes loopback to the Syncthing GUI`, () => {
    const index = text.search(portsLine)
    assert.notEqual(index, -1)
    const sentence = text.slice(index, text.indexOf('\n', index))
    assert.ok(sentence.includes('3081'))
    assert.ok(sentence.includes('127.0.0.1:8385'))
  })

  test(`${language}: after manual linking the board keeps the waiting row, so the row is no signal`, () => {
    const steps = section(text, headings.manual)
    assert.ok(steps.includes('Ожидает собеседника'))
    assert.ok(steps.includes('Общая папка'))
    assert.ok(steps.includes('ketos:<peer id>'))
  })

  test(`${language}: the workspace and Syncthing volumes of a computer are removed together, by their exact names`, () => {
    for (const computer of ['a', 'b']) {
      const command = `docker volume rm ketos-stand_ketos-${computer}-workspace ketos-stand_ketos-${computer}-syncthing`
      assert.ok(text.includes(command), command)
    }
    assert.ok(text.includes('.stfolder'))
  })

  test(`${language}: each computer's volume removal is a block of its own, after the containers are removed`, () => {
    const blocks = [...text.matchAll(/```sh\n([^`]*?)```/g)].map((match) => match[1]).filter((block) => /docker volume rm ketos-stand_ketos-[ab]-workspace/.test(block))
    assert.equal(blocks.length, 2)
    for (const [index, computer] of ['a', 'b'].entries()) {
      assert.match(blocks[index], new RegExp(`^docker compose -f docker/stand/compose\\.yaml down\\ndocker volume rm ketos-stand_ketos-${computer}-workspace ketos-stand_ketos-${computer}-syncthing\\n$`))
    }
  })

  test(`${language}: the model key step says to uncomment and fill OPENCODE_GO_API_KEY in docker/stand/.env`, () => {
    for (const heading of [headings.preparation, headings.windows]) {
      const step = section(text, heading).split('\n').filter((line) => line.includes('OPENCODE_GO_API_KEY='))
      assert.ok(step.length >= 1, `${heading} names OPENCODE_GO_API_KEY=`)
      assert.ok(step.some((line) => words.uncomment.test(line) && line.includes('docker/stand/.env') && line.includes('`.env`')), `${heading} says to uncomment it in docker/stand/.env or set it in the root .env`)
    }
  })

  test(`${language}: computer B gets the archive in its user folder and docker load reads the gzip file directly`, () => {
    const steps = section(text, headings.windows)
    assert.match(steps, /%UserProfile%/)
    assert.match(steps, /docker load -i \$HOME\\ketos-stand-amd64\.tar\.gz/)
    assert.doesNotMatch(steps, /gzip -dc|gunzip|tar -x/)
  })

  test(`${language}: the Contents list names every test and says what the changed ones check`, () => {
    const contents = section(text, headings.contents)
    const names = readdirSync(join(stand, 'tools')).filter((name) => name.endsWith('.test.mjs'))
    assert.ok(names.length >= 8)
    for (const name of names) assert.ok(contents.includes(`docker/stand/tools/${name}`), `${name} is listed`)
    const checks = (name) => contents.split('\n').find((line) => line.includes(`docker/stand/tools/${name}`)).split('node --test')[1]
    assert.match(checks('dockerignore.test.mjs'), words.archives)
    assert.match(checks('docker-entrypoint.test.mjs'), words.seed)
  })

  test(`${language}: the Contents list states the 5-second reconnection cap and dial timeout of stand.patch.yml`, () => {
    const line = section(text, headings.contents).split('\n').find((entry) => entry.includes('`stand.patch.yml`'))
    assert.match(line, words.cap)
    assert.doesNotMatch(line, words.staleCap)
    assert.ok(line.includes('reconnectMaxMs'))
    assert.match(line, words.dialTimeout)
    assert.match(line, words.bound)
    assert.doesNotMatch(line, words.staleDial)
  })

  test(`${language}: the Syncthing section and the Contents list name both pinned intervals`, () => {
    const pinned = text.split('\n').find((line) => line.includes('`reconnectionIntervalS`'))
    assert.ok(pinned.includes('`relayReconnectIntervalM`'), 'the list of pinned edits names the relay redial interval')
    const entry = section(text, headings.contents).split('\n').find((line) => line.includes('`syncthing-bootstrap.mjs`'))
    assert.match(entry, words.relayRedial)
  })
}
