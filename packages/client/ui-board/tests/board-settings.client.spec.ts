/** Durable layout schema: a complete document passes, broken ones are rejected. */
import { describe, expect, it } from 'vitest'
import {
  BOARD_ACCESS_MAX_PEOPLE, BOARD_LAYOUT_MAX_WINDOWS, BOARD_SETTINGS_NAMESPACE, BOARD_SETTINGS_VERSION,
  BOARD_ZOOM_MAX, BOARD_ZOOM_MIN,
  BoardSettingsSchema, type BoardLayoutDocument, type BoardSettings,
} from '../src/board-settings.ts'

/** Parse one raw document through the schema, as the settings boundary does. */
function parse(raw: unknown): BoardSettings {
  return BoardSettingsSchema(raw as BoardSettings)
}

/** One valid stored window. */
function window(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'agent-1',
    kind: 'agent',
    bodyKind: 'conversation',
    ordinal: 1,
    x: 24,
    y: 48,
    width: 552,
    height: 648,
    zIndex: 10,
    ...overrides,
  }
}

/** One valid stored document. */
function document(overrides: Record<string, unknown> = {}): BoardLayoutDocument {
  return {
    version: BOARD_SETTINGS_VERSION,
    panX: 0,
    panY: 0,
    zoom: 1,
    windows: [window()],
    windowOrder: ['agent-1'],
    activeWindowId: 'agent-1',
    panelWindowId: '',
    panelCollapsed: true,
    panelWidth: 300,
    panelGroupBy: 'workspace',
    panelOrderBy: 'updated',
    ...overrides,
  } as unknown as BoardLayoutDocument
}

describe('board settings schema', () => {
  it('names the ui-board namespace and starts the document at version 1', () => {
    expect(BOARD_SETTINGS_NAMESPACE).toBe('ui-board')
    expect(BOARD_SETTINGS_VERSION).toBe(1)
  })

  it('resolves an empty section through the defaults', () => {
    expect(parse({})).toEqual({
      version: 1,
      panX: 0,
      panY: 0,
      zoom: 1,
      windows: [],
      bindings: {},
      windowOrder: [],
      dockOrder: [],
      cloneOrder: [],
      activeWindowId: '',
      panelWindowId: '',
      panelCollapsed: true,
      panelWidth: 300,
      panelGroupBy: 'workspace',
      panelOrderBy: 'updated',
      defaultPreset: '',
    })
  })

  it('accepts and defaults the session bindings map', () => {
    expect(parse({}).bindings).toEqual({})
    expect(parse(document({ bindings: { 'agent-1': 'session-1' } })).bindings)
      .toEqual({ 'agent-1': 'session-1' })
    expect(() => parse(document({ bindings: { 'agent-1': 7 } }))).toThrow()
    expect(() => parse(document({ bindings: 'not a map' }))).toThrow()
  })

  it('accepts a complete layout document', () => {
    const parsed = parse(document())
    expect(parsed.windows).toHaveLength(1)
    expect(parsed.windows[0]).toMatchObject({ id: 'agent-1', kind: 'agent', ordinal: 1 })
    expect(parsed.activeWindowId).toBe('agent-1')
  })

  it('defaults a stored window without owner and access to the current participant and owner-only', () => {
    const parsed = parse(document({ windows: [window()] }))
    expect(parsed.windows[0]).toMatchObject({
      ownerId: '',
      access: { mode: 'owner', people: [] },
    })
  })

  it('validates and bounds stored window access', () => {
    const people = Array.from({ length: BOARD_ACCESS_MAX_PEOPLE }, (_value, index) => `owner-${index}`)
    const parsed = parse(document({
      windows: [window({ ownerId: 'owner-self', access: { mode: 'selected', people } })],
    }))
    expect(parsed.windows[0]?.access).toEqual({ mode: 'selected', people })
    expect(() => parse(document({
      windows: [window({ access: { mode: 'nobody', people: [] } })],
    }))).toThrow()
    expect(() => parse(document({
      windows: [window({ access: { mode: 'selected', people: [...people, 'owner-extra'] } })],
    }))).toThrow()
  })

  it('rejects an unknown version, an unknown kind, and a structurally broken window', () => {
    expect(() => parse(document({ version: 2 }))).toThrow()
    expect(() => parse(document({ windows: [window({ kind: 'not-a-kind' })] }))).toThrow()
    expect(() => parse(document({ windows: [window({ bodyKind: 'not-a-kind' })] }))).toThrow()
    expect(() => parse(document({ windows: [window({ id: undefined })] }))).toThrow()
    expect(() => parse(document({ windows: [window({ width: -10 })] }))).toThrow()
  })

  it('rejects out-of-range zoom, placement, and legacy panel values', () => {
    expect(() => parse(document({ zoom: BOARD_ZOOM_MAX + 0.1 }))).toThrow()
    expect(() => parse(document({ zoom: BOARD_ZOOM_MIN - 0.1 }))).toThrow()
    expect(() => parse(document({ panX: 100_001 }))).toThrow()
    expect(() => parse(document({ windows: [window({ y: -100_001 })] }))).toThrow()
    expect(() => parse(document({ panelWidth: 500 }))).toThrow()
    expect(() => parse(document({ panelGroupBy: 'created' }))).toThrow()
    expect(() => parse(document({ activeWindowId: 7 }))).toThrow()
  })

  it('rejects more windows than the restore cap allows', () => {
    const windows = Array.from({ length: BOARD_LAYOUT_MAX_WINDOWS + 1 }, (_value, index) =>
      window({ id: `agent-${index}` }))
    expect(() => parse(document({ windows }))).toThrow()
  })
})
