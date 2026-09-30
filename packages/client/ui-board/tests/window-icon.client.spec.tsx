// @vitest-environment jsdom
/**
 * Dock window icons (Т1.7): the letters a chip shows, the folder-tinted
 * palette, the clone initials, and the utility-kind glyphs.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { WindowIcon } from '../src/client/dock/WindowIcon.tsx'
import { FOLDER_PALETTE_SIZE, folderPaletteIndex, titleInitials } from '../src/client/dock/window-icon.ts'

afterEach(cleanup)

describe('titleInitials', () => {
  it('takes the first letters of the first two words', () => {
    expect(titleInitials('Отчёт по складу')).toBe('Оп')
    expect(titleInitials('  spaced   name ')).toBe('sn')
    expect(titleInitials('Agent')).toBe('Ag')
    expect(titleInitials('A')).toBe('A')
  })

  it('counts whole code points and yields nothing for a blank title', () => {
    expect(titleInitials('🚀 launch')).toBe('🚀l')
    expect(titleInitials('東京')).toBe('東京')
    expect(titleInitials('')).toBe('')
    expect(titleInitials('   ')).toBe('')
  })
})

describe('folderPaletteIndex', () => {
  it('is deterministic per folder key and stays inside the palette', () => {
    for (const key of ['ws-1', 'ws-2', '/projects/one', '']) {
      const index = folderPaletteIndex(key)
      expect(index).toBe(folderPaletteIndex(key))
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(FOLDER_PALETTE_SIZE)
    }
  })
})

describe('WindowIcon', () => {
  it('paints a chat chip with the title letters and the folder palette', () => {
    const { container } = render(
      <WindowIcon kind="agent" title="Отчёт по складу" folderKey="ws-1" />,
    )
    const chip = container.querySelector('[data-board-icon="letters"]')
    expect(chip?.textContent).toBe('Оп')
    expect(chip?.getAttribute('data-board-palette')).toBe(String(folderPaletteIndex('ws-1')))
  })

  it('keeps the chip neutral while the session has no folder', () => {
    const { container } = render(<WindowIcon kind="agent" title="Notes" />)
    expect(container.querySelector('[data-board-palette="none"]')?.textContent).toBe('No')
  })

  it('names a clone window with the record initials', () => {
    const { container } = render(<WindowIcon kind="clone" title="Анна" cloneName="Анна Иванова" />)
    expect(container.querySelector('[data-board-icon="clone"]')?.textContent).toBe('АИ')
  })

  it('carries the kind glyph for every utility window', () => {
    for (const kind of ['settings', 'connectors', 'dashboard', 'tasks'] as const) {
      const { container } = render(<WindowIcon kind={kind} title="Utility" />)
      expect(container.querySelector(`[data-board-icon="${kind}"]`)).not.toBeNull()
      cleanup()
    }
  })

  it('falls back to the agent glyph when the title has no letters', () => {
    const { container } = render(<WindowIcon kind="agent" title="  " />)
    expect(container.querySelector('[data-board-icon="agent"]')).not.toBeNull()
  })
})
