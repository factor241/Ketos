/**
 * Window header glyphs the shared icon set does not ship. The expand glyph
 * comes from `ui-primitives`; the restore glyph lives here until the shared set
 * gains a fullscreen pair.
 */
import type { ReactNode } from 'react'

/**
 * Restore-from-fullscreen glyph: two frame corners drawn inward.
 * @returns the icon, sized like the shared 16px set and riding `currentColor`.
 */
export function ExitFullscreenGlyph(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 5.5V2h3.5" />
      <path d="M2 2l4.5 4.5" />
      <path d="M14 10.5V14H10.5" />
      <path d="M14 14L9.5 9.5" />
    </svg>
  )
}
