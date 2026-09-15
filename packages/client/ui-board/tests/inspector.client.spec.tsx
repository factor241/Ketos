// @vitest-environment jsdom
/** Selection overlay: the inactive branch, the active copy, and both cancel paths. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { ElementSelectionOverlay } from '../src/client/ElementSelectionOverlay.tsx'
import { en, type BoardKey, type BoardTranslate } from '../src/client/locale.ts'

/** English-bound locale seat: the overlay renders the English dictionary verbatim. */
const t: BoardTranslate = key => en[key as BoardKey]

describe('ElementSelectionOverlay', () => {
  it('renders nothing while selection is inactive', () => {
    const { container } = render(<ElementSelectionOverlay t={t} active={false} onCancel={vi.fn()} />)
    expect(container.querySelector('div')).toBeNull()
  })

  it('shows the selection prompt and cancels through the button and Escape', () => {
    const onCancel = vi.fn()
    const { getByText, container } = render(<ElementSelectionOverlay t={t} active onCancel={onCancel} />)

    expect(getByText('Select an element or window on the canvas')).not.toBeNull()
    fireEvent.click(container.querySelector('button[aria-label="Cancel selection"]') as Element)
    expect(onCancel).toHaveBeenCalledOnce()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('ignores keys other than Escape', () => {
    const onCancel = vi.fn()
    render(<ElementSelectionOverlay t={t} active onCancel={onCancel} />)

    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onCancel).not.toHaveBeenCalled()
  })
})
