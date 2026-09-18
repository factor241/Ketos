// @vitest-environment jsdom
/**
 * Selection overlay: the inactive branch, the active copy, the pick
 * interception, both cancel paths, and the board composition that turns a
 * picked element into a composer chip.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SlotTestRuntime, SlotView } from '@deepseek-ai/dsh-client-test-runtime'
import { ElementSelectionOverlay } from '../src/client/ElementSelectionOverlay.tsx'
import { en, type BoardKey, type BoardTranslate } from '../src/client/locale.ts'
import { createBoardStore, type ComposerIntent } from '../src/client/store.ts'
import type { WindowId } from '../src/client/contract/slots.ts'
import { createBoardBench } from './fixtures.client.ts'

/** English-bound locale seat: the overlay renders the English dictionary verbatim. */
const t: BoardTranslate = key => en[key as BoardKey]

/** The live board store instance the renderer resolves for the board's registrations. */
type BoardInstance = ReturnType<ReturnType<typeof createBoardStore>['create']>

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

describe('ElementSelectionOverlay', () => {
  it('renders nothing while selection is inactive', () => {
    const { container } = render(
      <ElementSelectionOverlay t={t} active={false} onCancel={vi.fn()} onPick={vi.fn()} />,
    )
    expect(container.querySelector('div')).toBeNull()
  })

  it('captures an outside click without letting the control activate', () => {
    const onPick = vi.fn()
    const onCancel = vi.fn()
    const onSiblingClick = vi.fn()
    render(
      <>
        <ElementSelectionOverlay t={t} active onCancel={onCancel} onPick={onPick} />
        <button type="button" onClick={onSiblingClick}>Underlying</button>
      </>,
    )
    const sibling = screen.getByRole('button', { name: 'Underlying' })
    // The suppressed default action is what keeps the control inert.
    expect(fireEvent.click(sibling)).toBe(false)

    expect(onSiblingClick).not.toHaveBeenCalled()
    expect(onPick).toHaveBeenCalledWith(sibling)
    expect(onCancel).not.toHaveBeenCalled()

    // A click whose target is not an element cannot address an element.
    onPick.mockClear()
    globalThis.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('lets an open menu keep the click while selection stands by', () => {
    const onPick = vi.fn()
    render(
      <>
        <ElementSelectionOverlay t={t} active onCancel={vi.fn()} onPick={onPick} />
        <div role="menu"><button type="button">Row</button></div>
      </>,
    )
    fireEvent.click(screen.getByText('Row'))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('cancels through the button and Escape without picking anything', () => {
    const onCancel = vi.fn()
    const onPick = vi.fn()
    const { getByText, container } = render(
      <ElementSelectionOverlay t={t} active onCancel={onCancel} onPick={onPick} />,
    )

    expect(getByText('Select an element or window on the canvas')).not.toBeNull()
    fireEvent.click(container.querySelector('button[aria-label="Cancel selection"]') as Element)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onPick).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('ignores keys other than Escape', () => {
    const onCancel = vi.fn()
    render(<ElementSelectionOverlay t={t} active onCancel={onCancel} onPick={vi.fn()} />)

    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onCancel).not.toHaveBeenCalled()
  })
})

/** Board composition bench: the plugin mounted over the fixture runtime's services. */
async function bench() {
  const prepared = await createBoardBench({
    session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
  })
  runtimes.add(prepared.runtime)
  await prepared.mountBoard()
  return {
    runtime: prepared.runtime,
    panel: prepared.runtime.renderSlot('main', {}, { entryKey: 'board' }),
    board: prepared.runtime.storeOf('board.dock') as BoardInstance,
  }
}

/** One agent window spec for the pick legs. */
function agentWindow(id: string) {
  return {
    id: id as WindowId,
    kind: 'agent' as const,
    bodyKind: 'conversation' as const,
    ordinal: 1,
    width: 552,
    height: 648,
  }
}

/**
 * The chip one pick produced: the draft text once a mounted composer consumed
 * the intent, otherwise the queued intent addressing that window.
 */
function pickedChip(
  panel: SlotView<'main'>,
  intents: readonly ComposerIntent[],
  windowId: WindowId,
): string {
  const draft = panel.container.querySelector<HTMLTextAreaElement>('[data-board-action="composer-input"]')?.value ?? ''
  if (draft.includes('Board element:')) return draft
  return intents.find(intent => intent.windowId === windowId)?.text ?? ''
}

describe('element pick through the board composition', () => {
  it("puts the captured chip in the active chat window's composer and stands the mode down", async () => {
    const { runtime, panel, board } = await bench()
    act(() => { board.actions.openWindow(agentWindow('a1')) })
    await runtime.flush()
    act(() => { board.actions.setSelectingElement(true) })
    await runtime.flush()
    expect(panel.container.querySelector('[class*="overlay"]')).not.toBeNull()

    const textarea = panel.container.querySelector('[data-board-action="composer-input"]') as HTMLElement
    fireEvent.click(textarea)
    await runtime.flush()

    const state = board.store.getSnapshot()
    expect(state.isSelectingElement).toBe(false)
    expect(state.activeWindowId).toBe('a1')
    expect(panel.container.querySelector('[class*="overlay"]')).toBeNull()
    const chip = pickedChip(panel, state.composerIntents, 'a1' as WindowId)
    expect(chip).toContain('Board element: ')
    expect(chip).toContain('selector: [data-surface="board"]')

    // Re-entering the mode starts clean: Escape cancels and queues nothing.
    const queued = state.composerIntents.length
    act(() => { board.actions.setSelectingElement(true) })
    await runtime.flush()
    fireEvent.keyDown(document, { key: 'Escape' })
    await runtime.flush()
    expect(board.store.getSnapshot().isSelectingElement).toBe(false)
    expect(panel.container.querySelector('[class*="overlay"]')).toBeNull()
    expect(board.store.getSnapshot().composerIntents).toHaveLength(queued)
  })

  it('opens an agent window first when no chat window is active and addresses it', async () => {
    const { runtime, panel, board } = await bench()
    act(() => { board.actions.setSelectingElement(true) })
    await runtime.flush()

    const canvas = panel.container.querySelector('[data-surface="canvas"]') as HTMLElement
    fireEvent.click(canvas)
    await runtime.flush()

    const state = board.store.getSnapshot()
    const active = state.activeWindowId
    expect(active).not.toBeNull()
    expect(state.windows[String(active)]?.kind).toBe('agent')
    expect(state.isSelectingElement).toBe(false)
    const chip = pickedChip(panel, state.composerIntents, active as WindowId)
    expect(chip).toContain('Board element: ')
    expect(chip).toContain('selector: ')
  })
})
