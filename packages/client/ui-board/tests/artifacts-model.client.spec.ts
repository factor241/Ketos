// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ChatSnapshot, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { sessionArtifacts } from '../src/client/window/artifacts-model.ts'

function toolNode(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 1000,
    callId: 'call-1',
    call: { name: 'read', argsRaw: '{"file_path":"/workspace/test.txt"}' },
    callTime: 900,
    content: [{ type: 'text', text: 'contents' }],
    isError: false,
    subCalls: [],
    ...overrides,
  }
}

function chatWith(nodes: readonly ToolResultNode[]): ChatSnapshot {
  return {
    phase: 'ready',
    legacy: {
      nodes,
      runningCalls: [],
      partial: undefined,
    },
    hasMore: false,
    loadingOlder: false,
    running: false,
  } as unknown as ChatSnapshot
}

describe('sessionArtifacts', () => {
  it('returns empty array when chat is undefined or has no nodes', () => {
    expect(sessionArtifacts(undefined)).toEqual([])
    expect(sessionArtifacts(chatWith([]))).toEqual([])
  })

  it('extracts created file from write node with oldText null', () => {
    const node = toolNode({
      call: { name: 'write', argsRaw: '{"file_path":"/workspace/new.txt","content":"hello"}' },
      meta: { diffs: [{ path: '/workspace/new.txt', oldText: null, newText: 'hello' }] },
      time: 100,
    })
    const artifacts = sessionArtifacts(chatWith([node]))
    expect(artifacts).toEqual([
      { path: '/workspace/new.txt', kind: 'created', time: 100 },
    ])
  })

  it('extracts modified file from write node when oldText is present', () => {
    const node = toolNode({
      call: { name: 'write', argsRaw: '{"file_path":"/workspace/mod.txt","content":"hello"}' },
      meta: { diffs: [{ path: '/workspace/mod.txt', oldText: 'prev', newText: 'hello' }] },
      time: 150,
    })
    const artifacts = sessionArtifacts(chatWith([node]))
    expect(artifacts).toEqual([
      { path: '/workspace/mod.txt', kind: 'modified', time: 150 },
    ])
  })

  it('extracts modified file from edit tool node', () => {
    const node = toolNode({
      call: { name: 'edit', argsRaw: '{"file_path":"/workspace/edit.ts","old_string":"a","new_string":"b"}' },
      meta: { diffs: [{ path: '/workspace/edit.ts', oldText: 'a', newText: 'b' }] },
      time: 200,
    })
    const artifacts = sessionArtifacts(chatWith([node]))
    expect(artifacts).toEqual([
      { path: '/workspace/edit.ts', kind: 'modified', time: 200 },
    ])
  })

  it('extracts created file from str_replace_editor with command create', () => {
    const node = toolNode({
      call: { name: 'str_replace_editor', argsRaw: '{"command":"create","path":"/workspace/init.py","file_text":"print(1)"}' },
      time: 250,
    })
    const artifacts = sessionArtifacts(chatWith([node]))
    expect(artifacts).toEqual([
      { path: '/workspace/init.py', kind: 'created', time: 250 },
    ])
  })

  it('extracts modified file from str_replace_editor with command str_replace or insert', () => {
    const node = toolNode({
      call: { name: 'str_replace_editor', argsRaw: '{"command":"str_replace","path":"/workspace/init.py","old_str":"a","new_str":"b"}' },
      time: 300,
    })
    const artifacts = sessionArtifacts(chatWith([node]))
    expect(artifacts).toEqual([
      { path: '/workspace/init.py', kind: 'modified', time: 300 },
    ])
  })

  it('records a str_replace_editor view as a read, not a modification', () => {
    const node = toolNode({
      call: { name: 'str_replace_editor', argsRaw: '{"command":"view","path":"/workspace/a.ts"}' },
      time: 350,
    })
    expect(sessionArtifacts(chatWith([node]))).toEqual([
      { path: '/workspace/a.ts', kind: 'read', time: 350 },
    ])
  })

  it('extracts read file from read tool node', () => {
    const node = toolNode({
      call: { name: 'read', argsRaw: '{"file_path":"/workspace/readme.md"}' },
      meta: { path: '/workspace/readme.md' },
      time: 400,
    })
    const artifacts = sessionArtifacts(chatWith([node]))
    expect(artifacts).toEqual([
      { path: '/workspace/readme.md', kind: 'read', time: 400 },
    ])
  })

  it('ignores tool results with isError: true', () => {
    const failedNode = toolNode({
      call: { name: 'write', argsRaw: '{"file_path":"/workspace/fail.txt"}' },
      isError: true,
      time: 100,
    })
    expect(sessionArtifacts(chatWith([failedNode]))).toEqual([])
  })

  it('ignores unrelated tools like bash and web_search', () => {
    const bashNode = toolNode({
      call: { name: 'bash', argsRaw: '{"command":"ls"}' },
      time: 100,
    })
    const webNode = toolNode({
      call: { name: 'web_search', argsRaw: '{"query":"harness"}' },
      time: 110,
    })
    expect(sessionArtifacts(chatWith([bashNode, webNode]))).toEqual([])
  })

  it('collapses duplicates and preserves mutation status over reads', () => {
    const read1 = toolNode({
      call: { name: 'read', argsRaw: '{"file_path":"/workspace/shared.ts"}' },
      time: 100,
    })
    const created1 = toolNode({
      call: { name: 'write', argsRaw: '{"file_path":"/workspace/shared.ts"}' },
      meta: { diffs: [{ path: '/workspace/shared.ts', oldText: null, newText: 'code' }] },
      time: 200,
    })
    const edit1 = toolNode({
      call: { name: 'edit', argsRaw: '{"file_path":"/workspace/shared.ts"}' },
      time: 300,
    })
    const read2 = toolNode({
      call: { name: 'read', argsRaw: '{"file_path":"/workspace/shared.ts"}' },
      time: 400,
    })

    const artifacts = sessionArtifacts(chatWith([read1, created1, edit1, read2]))
    expect(artifacts).toEqual([
      { path: '/workspace/shared.ts', kind: 'modified', time: 400 },
    ])
  })

  it('extracts entries recursively from subCalls', () => {
    const child = toolNode({
      call: { name: 'write', argsRaw: '{"file_path":"/workspace/sub.txt"}' },
      time: 500,
    })
    const parent = toolNode({
      call: { name: 'bash', argsRaw: '{"command":"run"}' },
      subCalls: [child],
      time: 600,
    })
    const artifacts = sessionArtifacts(chatWith([parent]))
    expect(artifacts).toEqual([
      { path: '/workspace/sub.txt', kind: 'created', time: 500 },
    ])
  })

  it('extracts multiple files from meta.diffs array', () => {
    const multiDiffNode = toolNode({
      call: { name: 'write', argsRaw: '{"file_path":"/workspace/primary.ts"}' },
      meta: {
        diffs: [
          { path: '/workspace/fileA.ts', oldText: null, newText: 'A' },
          { path: '/workspace/fileB.ts', oldText: 'prev', newText: 'B' },
        ],
      },
      time: 700,
    })
    const artifacts = sessionArtifacts(chatWith([multiDiffNode]))
    expect(artifacts).toEqual([
      { path: '/workspace/fileA.ts', kind: 'created', time: 700 },
      { path: '/workspace/fileB.ts', kind: 'modified', time: 700 },
    ])
  })

  it('extracts read artifact from read_image tool', () => {
    const imgNode = toolNode({
      call: { name: 'read_image', argsRaw: '{"file_path":"/workspace/screenshot.png"}' },
      time: 800,
    })
    const artifacts = sessionArtifacts(chatWith([imgNode]))
    expect(artifacts).toEqual([
      { path: '/workspace/screenshot.png', kind: 'read', time: 800 },
    ])
  })
})
