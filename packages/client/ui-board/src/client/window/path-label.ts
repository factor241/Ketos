/**
 * Working-directory label of the window composer: the path keeps its tail and
 * elides in the middle, because the last segments are the ones that name the
 * project. The label box is sized by the chip row, so the elision budget comes
 * from measurement rather than from a fixed character count.
 */
import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

/** One path split into its root marker and its segments. */
interface PathParts {
  readonly root: string
  readonly segments: readonly string[]
  readonly separator: string
}

/** Split a path into the root marker, the segments, and the separator in use. */
function splitPath(path: string): PathParts {
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const raw = path.split(separator)
  const root = raw[0] ?? ''
  return { root, segments: raw.slice(1).filter(segment => segment !== ''), separator }
}

/**
 * Middle-elide a path so the tail survives, dropping the middle segments first.
 * @param path - the path to render.
 * @param fits - predicate over candidate texts; true when the text fits its box.
 * @returns the longest candidate that fits, the full path when everything fits,
 * and the shortest candidate when nothing fits.
 */
export function elideMiddlePath(path: string, fits: (candidate: string) => boolean): string {
  const { root, segments, separator } = splitPath(path)
  if (segments.length <= 2) return path
  const first = segments[0] ?? ''
  const head = root === '' ? `${separator}${first}` : `${root}${separator}${first}`
  const tailOf = (count: number): string => segments.slice(-count).join(separator)
  // Candidates run from the longest to the shortest: the head marker goes
  // before a tail segment does, so the project name is the last thing to go.
  const candidates: string[] = [
    path,
    `${head}${separator}…${separator}${tailOf(2)}`,
    `…${separator}${tailOf(2)}`,
    `${head}${separator}…${separator}${tailOf(1)}`,
    `…${separator}${tailOf(1)}`,
    tailOf(1),
  ]
  for (const candidate of candidates) {
    if (fits(candidate)) return candidate
  }
  return candidates[candidates.length - 1] ?? path
}

/** Longest candidate that fits; a box that cannot be measured keeps the full path. */
function fittedText(text: string, width: number, font: string): string {
  if (width <= 0) return text
  const context = document.createElement('canvas').getContext('2d')
  if (context === null) return text
  context.font = font
  const measured = new Map<string, number>()
  const fits = (candidate: string): boolean => {
    let size = measured.get(candidate)
    if (size === undefined) {
      size = context.measureText(candidate).width
      measured.set(candidate, size)
    }
    return size <= width
  }
  return elideMiddlePath(text, fits)
}

/**
 * Elide one path against the live width of its label element.
 * @param ref - the label element the chip sizes.
 * @param text - the full path.
 * @returns the text to render; the full path until a width is known.
 */
export function useElidedPath(ref: RefObject<HTMLElement>, text: string): string {
  const [elided, setElided] = useState(text)

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const update = () => {
      setElided(fittedText(text, element.clientWidth, getComputedStyle(element).font))
    }
    update()
    // Environments without ResizeObserver (jsdom, older engines) keep the full
    // path: the initial read still elides when the box reports a width.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    observer?.observe(element)
    return () => { observer?.disconnect() }
  }, [ref, text])

  return elided
}
