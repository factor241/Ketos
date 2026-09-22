/**
 * The canonical methodology vocabulary: the four section headings every clone
 * methodology is structured by, the template an empty profile starts from, and
 * the pure parser both the interview instruction and the editor's gap marks
 * read. The module is browser-safe by construction — no imports, no state — so
 * the editor can inline it while the host owns the vocabulary.
 * @module @ketos/clone-core/methodology
 */

/** Canonical methodology section headings, in the order a profile lists them. */
export const METHODOLOGY_SECTIONS = [
  'Принципы',
  'Порядок работы',
  'Критерии качества',
  'Чего не делать',
] as const

/** One canonical methodology section heading. */
export type MethodologySection = (typeof METHODOLOGY_SECTIONS)[number]

/**
 * The canonical template: every section heading with an empty body, separated
 * by a blank line. The interview fills the same headings in the text it saves.
 */
export const METHODOLOGY_TEMPLATE: string =
  METHODOLOGY_SECTIONS.map(heading => `## ${heading}\n`).join('\n')

/** One canonical section as the parser observed it in a methodology text. */
export interface MethodologySectionState {
  /** The canonical heading this state describes. */
  readonly heading: MethodologySection
  /** Whether the text carries the heading at all. */
  readonly present: boolean
  /** Whether the section body holds no non-whitespace character. */
  readonly empty: boolean
}

/** A level-two Markdown heading line with its trailing text. */
const HEADING = /^##(?!#)\s*(.*?)\s*$/

/**
 * Read a methodology text against the canonical structure. A section opens at a
 * level-two heading whose text equals a canonical heading and closes at the next
 * level-two heading; a heading that never appears reports as missing.
 * @param text - the methodology markdown as stored.
 * @returns one state per canonical section, in canonical order.
 */
export function methodologySections(text: string): MethodologySectionState[] {
  const bodies = new Map<string, string[]>()
  let current: string | undefined
  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line)
    if (heading !== null) {
      current = heading[1] ?? ''
      if (!bodies.has(current)) bodies.set(current, [])
      continue
    }
    if (current !== undefined && line.trim() !== '') bodies.get(current)?.push(line)
  }
  return METHODOLOGY_SECTIONS.map(heading => ({
    heading,
    present: bodies.has(heading),
    empty: (bodies.get(heading) ?? []).length === 0,
  }))
}

/**
 * The canonical headings a methodology text still lacks content for: ones the
 * text never carries and ones whose body is empty.
 * @param text - the methodology markdown as stored.
 * @returns the missing-or-empty headings, in canonical order.
 */
export function methodologyGaps(text: string): MethodologySection[] {
  return methodologySections(text)
    .filter(section => section.empty)
    .map(section => section.heading)
}
