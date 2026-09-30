/**
 * Dock icon derivations: the letters a window chip shows and the palette slot
 * a folder key maps to. Both are pure so the dock, its tests, and any later
 * chip consumer share one deterministic rule.
 */

/** Grapheme splitter for chip letters: a title never breaks inside one glyph. */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The first graphemes of one word, counted whole. */
function headGraphemes(word: string, count: number): string[] {
  return [...GRAPHEMES.segment(word)].slice(0, count).map(part => part.segment)
}

/**
 * One or two letters naming a title on a dock chip: the first letters of the
 * first two words, or the first two graphemes of a single word. Graphemes are
 * counted whole, so an emoji or a CJK title never splits.
 * @param title - the window's resolved title.
 * @returns the chip letters, or an empty string for a blank title.
 */
export function titleInitials(title: string): string {
  const words = title.trim().split(/\s+/u).filter(word => word !== '')
  const first = words[0]
  if (first === undefined) return ''
  const second = words[1]
  if (second === undefined) return headGraphemes(first, 2).join('')
  return `${headGraphemes(first, 1)[0] ?? ''}${headGraphemes(second, 1)[0] ?? ''}`
}

/** Folder-chip palette size: the theme aliases one folder key can land on. */
export const FOLDER_PALETTE_SIZE = 3

/**
 * Deterministic palette slot for one folder key (a workspace id, or the
 * working directory when no workspace registers it): the same folder always
 * paints the same chip, across reloads and windows.
 * @param key - the folder's stable identity.
 * @returns the palette slot in `[0, FOLDER_PALETTE_SIZE)`.
 */
export function folderPaletteIndex(key: string): number {
  let hash = 0
  for (const codePoint of key) hash = (hash * 31 + (codePoint.codePointAt(0) ?? 0)) >>> 0
  return hash % FOLDER_PALETTE_SIZE
}
