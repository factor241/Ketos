// @vitest-environment jsdom
/**
 * Window lane tool cards: the name-to-block table, the tolerant derivation from
 * a running or settled node, the status line of every node state, and the JSON
 * fallback that keeps an unknown or unreadable node safe.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ToolCard } from '../src/client/window/ToolCard.tsx'
import {
  diffCardData, imageCardData, questionCardData, readCardData, searchCardData,
  terminalCardData, todoCardData, toolCardKind, toolJsonPayload, toolNodeArgs, toolNodeArgsRaw,
  toolNodeName, toolNodeText, webCardData,
} from '../src/client/window/tool-card-model.ts'
import { t } from './fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** One settled tool result with the fixture defaults a test does not override. */
function settled(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 0,
    callId: 'call-1',
    call: { name: 'bash', argsRaw: '{"command":"ls"}' },
    callTime: 0,
    content: [],
    isError: false,
    subCalls: [],
    ...overrides,
  }
}

/** One running tool call with the fixture defaults a test does not override. */
function running(overrides: Partial<RunningToolCall> = {}): RunningToolCall {
  return {
    callId: 'call-1',
    name: 'bash',
    argsRaw: '{"command":"sleep 5"}',
    turn: 1,
    step: 1,
    time: 0,
    subCalls: [],
    ...overrides,
  }
}

describe('toolCardKind', () => {
  it('maps every shipped tool view and falls back for the rest', () => {
    expect(toolCardKind('bash')).toBe('terminal')
    expect(toolCardKind('pwsh')).toBe('terminal')
    expect(toolCardKind('terminal_send')).toBe('terminal')
    expect(toolCardKind('read')).toBe('read')
    expect(toolCardKind('write')).toBe('diff')
    expect(toolCardKind('edit')).toBe('diff')
    expect(toolCardKind('str_replace_editor')).toBe('diff')
    expect(toolCardKind('grep')).toBe('search')
    expect(toolCardKind('glob')).toBe('search')
    expect(toolCardKind('web_search')).toBe('web')
    expect(toolCardKind('web_fetch')).toBe('web')
    expect(toolCardKind('read_image')).toBe('image')
    expect(toolCardKind('todo_write')).toBe('todos')
    expect(toolCardKind('ask_user_question')).toBe('question')
    expect(toolCardKind('cordis_run')).toBe('json')
  })
})

describe('tool node readers', () => {
  it('reads the name and raw arguments of both node forms', () => {
    expect(toolNodeName(settled())).toBe('bash')
    expect(toolNodeName(running())).toBe('bash')
    expect(toolNodeArgsRaw(settled())).toBe('{"command":"ls"}')
    expect(toolNodeArgsRaw(running())).toBe('{"command":"sleep 5"}')
  })

  it('declines a lost call head, a half-streamed payload, and non-object JSON', () => {
    const orphan = settled({ call: null })
    expect(toolNodeName(orphan)).toBe('')
    expect(toolNodeArgsRaw(orphan)).toBe('')
    expect(toolNodeArgs(orphan)).toBeNull()
    expect(toolNodeArgs(running({ argsRaw: '{"command":' }))).toBeNull()
    expect(toolNodeArgs(running({ argsRaw: '[1,2]' }))).toBeNull()
  })

  it('joins text blocks and skips non-text ones', () => {
    expect(toolNodeText(running())).toBe('')
    expect(toolNodeText(settled({
      content: [
        { type: 'text', text: 'first' },
        { type: 'reasoning', text: 'hidden' },
        { type: 'text', text: 'second' },
      ],
    }))).toBe('first\nsecond')
  })

  it('builds the JSON payload from parsed arguments or the raw text', () => {
    expect(toolJsonPayload(settled())).toEqual({
      arguments: { command: 'ls' },
      result: '',
    })
    expect(toolJsonPayload(running({ argsRaw: '{' }))).toEqual({ arguments: '{', result: '' })
    expect(toolJsonPayload(settled({ call: null }))).toEqual({ arguments: null, result: '' })
  })
})

describe('terminalCardData', () => {
  it('declines other tools, missing arguments, and a commandless call', () => {
    expect(terminalCardData(settled({ call: { name: 'read', argsRaw: '{}' } }))).toBeNull()
    expect(terminalCardData(settled({ call: null }))).toBeNull()
    expect(terminalCardData(running({ argsRaw: '{}' }))).toBeNull()
  })

  it('reads a running command without output', () => {
    expect(terminalCardData(running())).toEqual({ command: 'sleep 5', output: '' })
  })

  it('reads a terminal_send call from its text argument', () => {
    expect(terminalCardData(running({ name: 'terminal_send', argsRaw: '{"sessionId":"s1","text":"echo hi"}' })))
      .toEqual({ command: 'echo hi', output: '' })
  })

  it('splits the exit marker off the output', () => {
    const node = settled({ content: [{ type: 'text', text: 'a\nb\n[exit code: 3]' }] })
    expect(terminalCardData(node)).toEqual({ command: 'ls', output: 'a\nb', exitCode: 3 })
  })

  it('reads the signal marker over the exit code', () => {
    const node = settled({ content: [{ type: 'text', text: 'partial\n[killed by signal: SIGKILL]' }] })
    expect(terminalCardData(node)).toEqual({ command: 'ls', output: 'partial', signal: 'SIGKILL' })
  })

  it('treats absent status markers as a clean exit', () => {
    const node = settled({ content: [{ type: 'text', text: 'all good' }] })
    expect(terminalCardData(node)).toEqual({ command: 'ls', output: 'all good', exitCode: 0 })
  })
})

describe('readCardData', () => {
  const meta = {
    path: 'src/a.ts',
    lines: [{ number: 1, text: 'let a = 1' }, { number: 2, text: 'let b = 2' }],
    totalLines: 10,
    lang: 'ts',
  }

  it('reads the returned window and its totals', () => {
    const node = settled({ call: { name: 'read', argsRaw: '{"file_path":"src/a.ts"}' }, meta })
    expect(readCardData(node)).toEqual({
      label: 'src/a.ts',
      lines: meta.lines,
      totalLines: 10,
      lang: 'ts',
    })
  })

  it('falls back to the argument path and the window length', () => {
    const node = settled({
      call: { name: 'read', argsRaw: '{"file_path":"src/a.ts"}' },
      meta: { lines: [{ number: 1, text: 'only' }] },
    })
    expect(readCardData(node)).toEqual({ label: 'src/a.ts', lines: [{ number: 1, text: 'only' }], totalLines: 1 })
  })

  it('declines a running call, another tool, and unusable metadata', () => {
    expect(readCardData(running({ name: 'read' }))).toBeNull()
    expect(readCardData(settled())).toBeNull()
    expect(readCardData(settled({ call: { name: 'read', argsRaw: '{}' }, meta: undefined }))).toBeNull()
    expect(readCardData(settled({ call: { name: 'read', argsRaw: '{}' }, meta: { lines: 'nope' } }))).toBeNull()
    expect(readCardData(settled({
      call: { name: 'read', argsRaw: '{}' },
      meta: { lines: [{ number: 0, text: 'bad' }] },
    }))).toBeNull()
    expect(readCardData(settled({
      call: { name: 'read', argsRaw: '{}' },
      meta: { lines: [{ number: 1, text: 7 }] },
    }))).toBeNull()
    expect(readCardData(settled({
      call: { name: 'read', argsRaw: '{}' },
      meta: { lines: [null] },
    }))).toBeNull()
  })
})

describe('diffCardData', () => {
  it('prefers the applied hunks the result reports', () => {
    const node = settled({
      call: { name: 'edit', argsRaw: '{}' },
      meta: { diffs: [{ path: 'a.ts', oldText: 'old', newText: 'new' }] },
    })
    expect(diffCardData(node)).toEqual([{ path: 'a.ts', oldText: 'old', newText: 'new' }])
  })

  it('intends a write and an edit hunk from the arguments', () => {
    expect(diffCardData(settled({ call: { name: 'write', argsRaw: '{"file_path":"a.ts","content":"hi"}' } })))
      .toEqual([{ path: 'a.ts', oldText: null, newText: 'hi' }])
    expect(diffCardData(settled({
      call: { name: 'edit', argsRaw: '{"file_path":"a.ts","old_string":"x","new_string":"y"}' },
    }))).toEqual([{ path: 'a.ts', oldText: 'x', newText: 'y' }])
    expect(diffCardData(settled({
      call: { name: 'edit', argsRaw: '{"file_path":"a.ts","old_string":"","new_string":"y"}' },
    }))).toEqual([{ path: 'a.ts', oldText: null, newText: 'y' }])
  })

  it('intends a str_replace_editor create or replace, and declines a view', () => {
    expect(diffCardData(running({
      name: 'str_replace_editor',
      argsRaw: '{"command":"create","path":"a.ts","file_text":"hi"}',
    }))).toEqual([{ path: 'a.ts', oldText: null, newText: 'hi' }])
    expect(diffCardData(running({
      name: 'str_replace_editor',
      argsRaw: '{"command":"create","path":"a.ts"}',
    }))).toEqual([{ path: 'a.ts', oldText: null, newText: '' }])
    expect(diffCardData(running({
      name: 'str_replace_editor',
      argsRaw: '{"command":"str_replace","path":"a.ts","old_str":"x","new_str":"y"}',
    }))).toEqual([{ path: 'a.ts', oldText: 'x', newText: 'y' }])
    expect(diffCardData(running({
      name: 'str_replace_editor',
      argsRaw: '{"command":"view","path":"a.ts"}',
    }))).toBeNull()
  })

  it('declines another tool and unusable arguments', () => {
    expect(diffCardData(settled())).toBeNull()
    expect(diffCardData(settled({ call: { name: 'write', argsRaw: '{}' } }))).toBeNull()
    expect(diffCardData(settled({ call: { name: 'edit', argsRaw: '{"file_path":"a.ts"}' } }))).toBeNull()
    expect(diffCardData(running({ name: 'str_replace_editor', argsRaw: '{"command":"create"}' }))).toBeNull()
    expect(diffCardData(running({
      name: 'str_replace_editor',
      argsRaw: '{"command":"str_replace","path":"a.ts","old_str":"x"}',
    }))).toBeNull()
  })

  it('declines an applied hunk list that is not a hunk array', () => {
    const node = settled({
      call: { name: 'edit', argsRaw: '{"file_path":"a.ts","old_string":"x","new_string":"y"}' },
      meta: { diffs: [{ path: 7, newText: 'y' }] },
    })
    expect(diffCardData(node)).toEqual([{ path: 'a.ts', oldText: 'x', newText: 'y' }])
    expect(diffCardData(settled({
      call: { name: 'edit', argsRaw: '{}' },
      meta: { diffs: [{ path: 'a.ts', oldText: 7, newText: 'y' }] },
    }))).toBeNull()
    expect(diffCardData(settled({
      call: { name: 'edit', argsRaw: '{}' },
      meta: { diffs: ['nope'] },
    }))).toBeNull()
  })

  it('keeps a create overwrite hunk when the result carries no diffs', () => {
    const node = settled({
      call: { name: 'write', argsRaw: '{"file_path":"a.ts","content":"hi"}' },
      meta: {},
    })
    expect(diffCardData(node)).toEqual([{ path: 'a.ts', oldText: null, newText: 'hi' }])
  })
})

describe('searchCardData', () => {
  it('reads the grouped-match and path shapes', () => {
    const files = [{ path: 'a.ts', matches: [{ lineNumber: 2, line: 'hit' }] }]
    expect(searchCardData(settled({
      call: { name: 'grep', argsRaw: '{"pattern":"hit"}' },
      meta: { shape: 'matches', files, truncated: false, total: 1 },
    }))).toEqual({ kind: 'matches', files, truncated: false, total: 1 })
    expect(searchCardData(settled({
      call: { name: 'glob', argsRaw: '{"pattern":"*.ts"}' },
      meta: { shape: 'paths', paths: ['a.ts'], truncated: true, total: 4 },
    }))).toEqual({ kind: 'paths', paths: ['a.ts'], truncated: true, total: 4 })
  })

  it('counts retained results when the metadata omits the total', () => {
    expect(searchCardData(settled({
      call: { name: 'grep', argsRaw: '{}' },
      meta: { shape: 'matches', files: [], truncated: false },
    }))).toEqual({ kind: 'matches', files: [], truncated: false, total: 0 })
    expect(searchCardData(settled({
      call: { name: 'glob', argsRaw: '{}' },
      meta: { shape: 'paths', paths: ['a.ts'] },
    }))).toEqual({ kind: 'paths', paths: ['a.ts'], truncated: false, total: 1 })
  })

  it('declines a running call, another tool, a missing metadata, and malformed shapes', () => {
    expect(searchCardData(running({ name: 'grep' }))).toBeNull()
    expect(searchCardData(settled())).toBeNull()
    expect(searchCardData(settled({ call: { name: 'grep', argsRaw: '{}' } }))).toBeNull()
    expect(searchCardData(settled({ call: { name: 'grep', argsRaw: '{}' }, meta: { shape: 'other' } }))).toBeNull()
    expect(searchCardData(settled({
      call: { name: 'grep', argsRaw: '{}' },
      meta: { shape: 'matches', files: [{ path: 'a.ts', matches: [{ lineNumber: 0, line: 'x' }] }] },
    }))).toBeNull()
    expect(searchCardData(settled({
      call: { name: 'grep', argsRaw: '{}' },
      meta: { shape: 'matches', files: [{ path: 'a.ts', matches: 'nope' }] },
    }))).toBeNull()
    expect(searchCardData(settled({
      call: { name: 'grep', argsRaw: '{}' },
      meta: { shape: 'paths', paths: [1] },
    }))).toBeNull()
  })
})

describe('webCardData', () => {
  it('reads a search answer with its sources and a fetch summary', () => {
    expect(webCardData(settled({
      call: { name: 'web_search', argsRaw: '{}' },
      meta: { sources: [{ url: 'https://a.example', title: 'A', snippet: 's', publishedAt: '2026-01-01' }], truncated: true, answer: 'yes' },
    }))).toEqual({
      kind: 'search',
      sources: [{ url: 'https://a.example', title: 'A', snippet: 's', publishedAt: '2026-01-01' }],
      truncated: true,
      answer: 'yes',
    })
    expect(webCardData(settled({
      call: { name: 'web_fetch', argsRaw: '{}' },
      meta: { url: 'https://a.example', statusCode: 200, truncated: false },
    }))).toEqual({ kind: 'fetch', url: 'https://a.example', statusCode: 200, truncated: false })
  })

  it('declines a running call, another tool, and malformed metadata', () => {
    expect(webCardData(running({ name: 'web_search' }))).toBeNull()
    expect(webCardData(settled())).toBeNull()
    expect(webCardData(settled({ call: { name: 'web_search', argsRaw: '{}' } }))).toBeNull()
    expect(webCardData(settled({
      call: { name: 'web_search', argsRaw: '{}' },
      meta: { sources: [{ title: 'no url' }] },
    }))).toBeNull()
    expect(webCardData(settled({
      call: { name: 'web_search', argsRaw: '{}' },
      meta: { sources: 'nope' },
    }))).toBeNull()
    expect(webCardData(settled({
      call: { name: 'web_fetch', argsRaw: '{}' },
      meta: { url: 'https://a.example' },
    }))).toBeNull()
    expect(webCardData(settled({
      call: { name: 'web_fetch', argsRaw: '{}' },
      meta: { url: 7, statusCode: 200 },
    }))).toBeNull()
  })
})

describe('imageCardData', () => {
  const attachment: ImageAttachmentRef = {
    attachmentId: 'att-1' as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 3,
    width: 2,
    height: 2,
  }

  it('collects the durable image references and labels them', () => {
    const node = settled({
      call: { name: 'read_image', argsRaw: '{"file_path":"shot.png"}' },
      meta: { path: 'shot.png' },
      content: [{ type: 'image', attachment }],
    })
    expect(imageCardData(node)).toEqual({ label: 'shot.png', attachments: [attachment] })
  })

  it('falls back to the argument path and declines images without references', () => {
    const node = settled({
      call: { name: 'read_image', argsRaw: '{"file_path":"shot.png"}' },
      content: [{ type: 'image', attachment }],
    })
    expect(imageCardData(node)).toEqual({ label: 'shot.png', attachments: [attachment] })
    expect(imageCardData(settled({
      call: { name: 'read_image', argsRaw: '{}' },
      content: [{ type: 'image', attachment: { attachmentId: 'att-1' } as unknown as ImageAttachmentRef }],
    }))).toBeNull()
    expect(imageCardData(settled({ call: { name: 'read_image', argsRaw: '{}' } }))).toBeNull()
  })

  it('declines a running call, an error, and another tool', () => {
    expect(imageCardData(running({ name: 'read_image' }))).toBeNull()
    expect(imageCardData(settled({
      call: { name: 'read_image', argsRaw: '{}' },
      isError: true,
      content: [{ type: 'image', attachment }],
    }))).toBeNull()
    expect(imageCardData(settled())).toBeNull()
  })
})

describe('todoCardData', () => {
  it('reads the written items', () => {
    const node = running({ name: 'todo_write', argsRaw: '{"todos":[{"content":"a","status":"pending"},{"content":"b","status":"completed"}]}' })
    expect(todoCardData(node)).toEqual([
      { content: 'a', status: 'pending' },
      { content: 'b', status: 'completed' },
    ])
  })

  it('declines another tool and malformed items', () => {
    expect(todoCardData(settled())).toBeNull()
    expect(todoCardData(running({ name: 'todo_write', argsRaw: '{}' }))).toBeNull()
    expect(todoCardData(running({ name: 'todo_write', argsRaw: '{"todos":["a"]}' }))).toBeNull()
    expect(todoCardData(running({ name: 'todo_write', argsRaw: '{"todos":[{"content":"a"}]}' }))).toBeNull()
  })
})

describe('questionCardData', () => {
  const args = '{"questions":[{"id":"q1","question":"Which?"},{"id":"q2","question":"When?"}]}'

  it('pairs the answered questions and keeps the custom answer', () => {
    const node = settled({
      call: { name: 'ask_user_question', argsRaw: args },
      content: [{ type: 'text', text: '{"answers":[{"id":"q1","selected":["a"],"custom":"other"},{"id":"q2","selected":["now"]}]}' }],
    })
    expect(questionCardData(node)).toEqual([
      { question: 'Which?', answers: ['a', 'other'] },
      { question: 'When?', answers: ['now'] },
    ])
  })

  it('declines a running call, an error, another tool, and unusable data', () => {
    expect(questionCardData(running({ name: 'ask_user_question' }))).toBeNull()
    expect(questionCardData(settled({
      call: { name: 'ask_user_question', argsRaw: args },
      isError: true,
    }))).toBeNull()
    expect(questionCardData(settled())).toBeNull()
    expect(questionCardData(settled({ call: { name: 'ask_user_question', argsRaw: '{}' } }))).toBeNull()
    expect(questionCardData(settled({
      call: { name: 'ask_user_question', argsRaw: args },
      content: [{ type: 'text', text: 'not json' }],
    }))).toBeNull()
    expect(questionCardData(settled({
      call: { name: 'ask_user_question', argsRaw: args },
      content: [{ type: 'text', text: '{"answers":{}}' }],
    }))).toBeNull()
    expect(questionCardData(settled({
      call: { name: 'ask_user_question', argsRaw: args },
      content: [{ type: 'text', text: '{"answers":[{"id":7,"selected":[]}]}' }],
    }))).toBeNull()
    expect(questionCardData(settled({
      call: { name: 'ask_user_question', argsRaw: args },
      content: [{ type: 'text', text: '{"answers":[{"id":"q1","selected":7}]}' }],
    }))).toBeNull()
    expect(questionCardData(settled({
      call: { name: 'ask_user_question', argsRaw: '[1]' },
      content: [{ type: 'text', text: '{"answers":[]}' }],
    }))).toBeNull()
    expect(questionCardData(settled({
      call: { name: 'ask_user_question', argsRaw: '{"questions":[7]}' },
      content: [{ type: 'text', text: '{"answers":[]}' }],
    }))).toBeNull()
    expect(questionCardData(settled({
      call: { name: 'ask_user_question', argsRaw: '{"questions":[{"id":"q9","question":"Unasked?"}]}' },
      content: [{ type: 'text', text: '{"answers":[{"id":"q1","selected":["a"]}]}' }],
    }))).toBeNull()
  })
})

describe('ToolCard', () => {
  it('draws a settled bash result as a terminal', () => {
    const node = settled({ content: [{ type: 'text', text: 'file.txt\n[exit code: 0]' }] })
    const { getByText, container } = render(<ToolCard node={node} t={t} />)
    expect(getByText('ls')).not.toBeNull()
    expect(getByText('file.txt')).not.toBeNull()
    expect(container.querySelector('[data-board-tool="done"]')).not.toBeNull()
  })

  it('draws a running call with its command and elapsed seconds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:05Z'))
    const node = running({ time: Date.parse('2026-01-01T00:00:02Z') })
    const { getByText, container } = render(<ToolCard node={node} t={t} />)
    expect(getByText('sleep 5')).not.toBeNull()
    expect(container.querySelector('[data-board-tool="running"]')).not.toBeNull()
    expect(getByText('running · 3s')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(getByText('running · 5s')).not.toBeNull()
  })

  it('draws a read result as a read block', () => {
    const node = settled({
      call: { name: 'read', argsRaw: '{"file_path":"a.ts"}' },
      meta: { path: 'a.ts', lines: [{ number: 1, text: 'line one' }, { number: 2, text: 'line two' }], totalLines: 2 },
    })
    const { getByText } = render(<ToolCard node={node} t={t} />)
    expect(getByText('a.ts')).not.toBeNull()
    expect(getByText('line one')).not.toBeNull()
    expect(getByText('line two')).not.toBeNull()
  })

  it('draws an applied edit as a diff with its totals', () => {
    const node = settled({
      call: { name: 'edit', argsRaw: '{}' },
      meta: { diffs: [{ path: 'a.ts', oldText: 'old', newText: 'new' }] },
    })
    const { getByText } = render(<ToolCard node={node} t={t} />)
    expect(getByText('a.ts')).not.toBeNull()
    expect(getByText('old')).not.toBeNull()
    expect(getByText('new')).not.toBeNull()
  })

  it('draws a running write as its intended diff', () => {
    const node = running({ name: 'write', argsRaw: '{"file_path":"a.ts","content":"fresh"}' })
    const { getByText, container } = render(<ToolCard node={node} t={t} />)
    expect(getByText('fresh')).not.toBeNull()
    expect(container.querySelector('[data-board-tool-status="running"]')).not.toBeNull()
  })

  it('draws a grep result as a search block and a web result as a web block', () => {
    const search = settled({
      call: { name: 'grep', argsRaw: '{}' },
      meta: { shape: 'matches', files: [{ path: 'a.ts', matches: [{ lineNumber: 4, line: 'hit' }] }], truncated: false, total: 1 },
    })
    const searchRender = render(<ToolCard node={search} t={t} />)
    expect(searchRender.getByText('a.ts')).not.toBeNull()
    searchRender.unmount()

    const web = settled({
      call: { name: 'web_search', argsRaw: '{}' },
      meta: { sources: [{ url: 'https://a.example', title: 'Example' }], truncated: false },
    })
    const webRender = render(<ToolCard node={web} t={t} />)
    expect(webRender.getByText('Example')).not.toBeNull()
  })

  it('renders a web fetch with its HTTP status', () => {
    const node = settled({
      call: { name: 'web_fetch', argsRaw: '{}' },
      meta: { url: 'https://a.example', statusCode: 200, truncated: true },
    })
    const { getByText } = render(<ToolCard node={node} t={t} />)
    expect(getByText('https://a.example')).not.toBeNull()
    expect(getByText('HTTP 200')).not.toBeNull()
    expect(getByText('Content truncated')).not.toBeNull()
  })

  it('renders the to-do list and the answered questions', () => {
    const todos = settled({
      call: {
        name: 'todo_write',
        argsRaw: '{"todos":[{"content":"ship it","status":"completed"},{"content":"test it","status":"in_progress"}]}',
      },
    })
    const todoRender = render(<ToolCard node={todos} t={t} />)
    expect(todoRender.getByText('Tasks')).not.toBeNull()
    expect(todoRender.getByText('ship it')).not.toBeNull()
    expect(todoRender.container.querySelector('[data-board-todo="in_progress"]')).not.toBeNull()
    todoRender.unmount()

    const question = settled({
      call: { name: 'ask_user_question', argsRaw: '{"questions":[{"id":"q1","question":"Which?"}]}' },
      content: [{ type: 'text', text: '{"answers":[{"id":"q1","selected":["a"]}]}' }],
    })
    const questionRender = render(<ToolCard node={question} t={t} />)
    expect(questionRender.getByText('Questions')).not.toBeNull()
    expect(questionRender.getByText('Which?')).not.toBeNull()
    expect(questionRender.getByText('a')).not.toBeNull()
  })

  it('previews a durable result image through the injected loader', async () => {
    const attachment = {
      attachmentId: 'att-1',
      mediaType: 'image/png',
      bytes: 3,
      width: 2,
      height: 2,
    } as unknown as ImageAttachmentRef
    const loadImage = vi.fn(async () => 'blob:image')
    const node = settled({
      call: { name: 'read_image', argsRaw: '{"file_path":"shot.png"}' },
      meta: { path: 'shot.png' },
      content: [{ type: 'image', attachment }],
    })
    const { container } = render(<ToolCard node={node} t={t} loadImage={loadImage} />)
    expect(container.querySelector('[data-board-image-pending]')).not.toBeNull()
    await waitFor(() => { expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:image') })
    expect(loadImage).toHaveBeenCalledWith(attachment)
  })

  it('keeps the placeholder when the image read is refused or the card unmounts first', async () => {
    const attachment = {
      attachmentId: 'att-1',
      mediaType: 'image/png',
      bytes: 3,
      width: 2,
      height: 2,
    } as unknown as ImageAttachmentRef
    const refused = vi.fn(async () => { throw new Error('denied') })
    const node = settled({
      call: { name: 'read_image', argsRaw: '{}' },
      content: [{ type: 'image', attachment }],
    })
    const refusedRender = render(<ToolCard node={node} t={t} loadImage={refused} />)
    await waitFor(() => { expect(refused).toHaveBeenCalled() })
    expect(refusedRender.container.querySelector('img')).toBeNull()
    refusedRender.unmount()

    let resolve: (url: string) => void = () => {}
    const pending = vi.fn(() => new Promise<string>((done) => { resolve = done }))
    const unmounted = render(<ToolCard node={node} t={t} loadImage={pending} />)
    unmounted.unmount()
    await act(async () => { resolve('blob:late') })
    expect(pending).toHaveBeenCalled()
  })

  it('falls back to JSON for an image result when the lane offers no loader', () => {
    const node = settled({
      call: { name: 'read_image', argsRaw: '{"file_path":"shot.png"}' },
      content: [{ type: 'image', attachment: { attachmentId: 'att-1' } as unknown as ImageAttachmentRef }],
    })
    const { getByText } = render(<ToolCard node={node} t={t} />)
    expect(getByText('▸ read_image')).not.toBeNull()
  })

  it('renders an unknown tool as the JSON fallback with its arguments', () => {
    const node = settled({
      call: { name: 'mystery', argsRaw: '{"key":"value"}' },
      content: [{ type: 'text', text: 'done' }],
    })
    const { getByText, container } = render(<ToolCard node={node} t={t} />)
    fireEvent.click(getByText('▸ mystery'))
    expect(getByText(/"key": "value"/)).not.toBeNull()
    expect(container.querySelector('[data-board-tool="done"]')).not.toBeNull()
  })

  it('keeps the unavailable line and the repeat control for a lost call head', () => {
    const onRepeat = vi.fn()
    const node = settled({ call: null, isError: false })
    const { getByText, queryByText } = render(
      <ToolCard node={node} t={t} canRepeat onRepeat={onRepeat} />,
    )
    expect(getByText('result unavailable')).not.toBeNull()
    fireEvent.click(getByText('Request again'))
    expect(onRepeat).toHaveBeenCalledTimes(1)
    expect(queryByText('Request again')).not.toBeNull()
  })

  it('offers no repeat control without the flag or the callback', () => {
    const noFlag = render(<ToolCard node={settled({ call: null })} t={t} onRepeat={vi.fn()} />)
    expect(noFlag.queryByText('Request again')).toBeNull()
    noFlag.unmount()
    const noCallback = render(<ToolCard node={settled({ call: null })} t={t} canRepeat />)
    expect(noCallback.queryByText('Request again')).toBeNull()
  })

  it('renders a failed call with the localized failure, the detail, and the provider text', () => {
    const node = settled({
      isError: true,
      error: { name: 'ToolError', code: 'ENOENT' },
      content: [{ type: 'text', text: 'no such file' }],
    })
    const { getByText, container } = render(<ToolCard node={node} t={t} />)
    expect(getByText('failed')).not.toBeNull()
    expect(getByText('ToolError')).not.toBeNull()
    expect(getByText('no such file')).not.toBeNull()
    expect(container.querySelector('[data-board-tool="failed"]')).not.toBeNull()
    expect(container.querySelector('[data-board-tool-error="ENOENT"]')).not.toBeNull()
  })

  it('renders a failed call without an error detail and without text', () => {
    const node = settled({ isError: true })
    const { getByText, container } = render(<ToolCard node={node} t={t} />)
    expect(getByText('failed')).not.toBeNull()
    expect(container.querySelector('[data-board-tool-status="failed"]')).not.toBeNull()
    expect(container.querySelector('pre')).toBeNull()
  })

  it('renders a cancelled call as stopped', () => {
    // The host logs ABORTED for a user cancel; the chat assembler synthesizes
    // `interrupted` for a call left open at a turn boundary.
    for (const error of [{ name: 'AbortError', code: 'ABORTED' }, { name: 'Interrupted', code: 'interrupted' }]) {
      const rendered = render(<ToolCard node={settled({ isError: true, error })} t={t} />)
      expect(rendered.getByText('stopped')).not.toBeNull()
      expect(rendered.container.querySelector('[data-board-tool-status="stopped"]')).not.toBeNull()
      rendered.unmount()
    }
  })

  it('falls back to JSON for a settled call whose arguments are unusable', () => {
    const node = settled({ call: { name: 'mystery', argsRaw: '{' } })
    const { getByText } = render(<ToolCard node={node} t={t} />)
    fireEvent.click(getByText('▸ mystery'))
    expect(getByText(/\{/)).not.toBeNull()
  })
})
