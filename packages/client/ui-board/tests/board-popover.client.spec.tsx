// @vitest-environment jsdom
/**
 * Board popover host: window menus follow board pan and zoom through the host
 * subscription, and dismiss on every window lifecycle change.
 */
import { useState, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Menu, type MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { createBoardStore, type BoardState, type BoardStoreHandle } from '../src/client/store.ts'
import {
  BoardPopoverProvider, BoardPopoverSurfaceContext,
  useBoardMenuDismiss, type BoardPopoverSurface,
} from '../src/client/board-popover.tsx'
import type { WindowId } from '../src/client/contract/slots.ts'

afterEach(cleanup)

const WINDOW_ID = 'agent-popover-test' as WindowId
const ITEMS: readonly MenuItem[] = [{ id: 'rename', label: 'Rename' }]

/** The open menu's left offset, or null when it is closed. */
function menuLeft(): string | null {
  return screen.queryByRole('menu')?.style.left ?? null
}

/** One menu owner: opens on its trigger and closes through the dismissal token. */
function MenuOwner({ anchorRect }: { readonly anchorRect: { current: DOMRect } }) {
  const [open, setOpen] = useState(false)
  useBoardMenuDismiss(() => { setOpen(false) })
  return (
    <Menu
      portal
      open={open}
      anchor={<button type="button" onClick={() => { setOpen(true) }}>trigger</button>}
      getAnchorRect={() => anchorRect.current}
      items={ITEMS}
      onSelect={() => { setOpen(false) }}
      onClose={() => { setOpen(false) }}
    />
  )
}

/** One window in a real board store, hosted by the board popover provider. */
function bench(anchor = new DOMRect(20, 20, 80, 32)) {
  const instance = createBoardStore().create()
  instance.actions.openWindow({
    id: WINDOW_ID, kind: 'agent', bodyKind: 'conversation', ordinal: 1, width: 552, height: 648,
  })
  const useStore: PropsStore<BoardStoreHandle>['useStore'] = <S,>(selector: (state: BoardState) => S): S =>
    selector(useSyncExternalStore(
      listener => instance.subscribe(listener),
      () => instance.getSnapshot(),
      () => instance.getSnapshot(),
    ))
  const layer = document.createElement('div')
  const root = document.createElement('div')
  root.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 800)
  document.body.append(root, layer)
  const surface: BoardPopoverSurface = { layer, root }
  const anchorRect = { current: anchor }
  render(
    <BoardPopoverSurfaceContext.Provider value={surface}>
      <BoardPopoverProvider useStore={useStore} windowId={WINDOW_ID}>
        <MenuOwner anchorRect={anchorRect} />
      </BoardPopoverProvider>
    </BoardPopoverSurfaceContext.Provider>,
  )
  return { instance, anchorRect, open: () => { fireEvent.click(screen.getByText('trigger')) } }
}

describe('board popover host', () => {
  it('keeps a window menu open through a pan and repositions it', () => {
    const { instance, anchorRect, open } = bench()
    open()
    expect(menuLeft()).toBe('20px')
    // The host subscription re-runs placement with the anchor's new rect; the
    // pan alone must not dismiss the list.
    anchorRect.current = new DOMRect(220, 20, 80, 32)
    act(() => { instance.actions.panBy(10, 10) })
    expect(screen.queryByRole('menu')).not.toBeNull()
    expect(menuLeft()).toBe('220px')
  })

  it('rescales an open menu with the board zoom', () => {
    const { instance, open } = bench()
    open()
    expect(screen.getByRole('menu').style.transform).toBe('scale(1)')
    act(() => { instance.actions.zoomBy(0.5, 0, 0) })
    expect(screen.queryByRole('menu')).not.toBeNull()
    expect(screen.getByRole('menu').style.transform).toBe('scale(0.5)')
  })

  it('closes the menu when the owning window moves', () => {
    const { instance, open } = bench()
    open()
    act(() => { instance.actions.moveWindow(WINDOW_ID, 48, 24, false) })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu when the owning window resizes', () => {
    const { instance, open } = bench()
    open()
    act(() => { instance.actions.resizeWindow(WINDOW_ID, 600, 700, false) })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu when the window enters fullscreen', () => {
    const { instance, open } = bench()
    open()
    act(() => { instance.actions.setWindowFullscreen(WINDOW_ID) })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu when the window leaves fullscreen', () => {
    const { instance, open } = bench()
    act(() => { instance.actions.setWindowFullscreen(WINDOW_ID) })
    open()
    expect(screen.queryByRole('menu')).not.toBeNull()
    act(() => { instance.actions.exitFullscreen() })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu when the window closes', () => {
    const { instance, open } = bench()
    open()
    act(() => { instance.actions.closeWindow(WINDOW_ID) })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu when a pan culls the window out of the canvas', () => {
    const { instance, open } = bench()
    open()
    act(() => { instance.actions.panBy(3_000, 0) })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu when the anchor leaves the host boundary', () => {
    const { instance, anchorRect, open } = bench()
    open()
    anchorRect.current = new DOMRect(2_000, 20, 80, 32)
    act(() => { instance.actions.panBy(1, 0) })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
