// Port of the React Bits FoldText component (https://reactbits.dev,
// MIT-licensed), reimplemented without its GSAP timeline: each character panel
// animates through CSS keyframes and per-panel `--fold-index` staggering, and
// the character list remounts on every text change so the fold replays. The
// fold geometry, timing defaults, and props otherwise match the upstream
// component, trimmed to the `char` split, top hinge, and mount trigger the
// Ketos hero uses.

import type { CSSProperties } from 'react'
import css from './FoldText.module.css'

/** Fold text props. */
export interface FoldTextProps {
  /** The text content to split and fold into place. */
  text: string
  /** Duration in seconds for each panel to unfold. */
  duration?: number
  /** Delay in seconds between panels; 0.03–0.08 keeps the cascade crisp. */
  stagger?: number
  /** CSS timing function for the unfold (GSAP names are not accepted). */
  ease?: string
  /** Perspective distance applied to each panel parent. */
  perspective?: number
  /** Strength of the gradient shade while panels are folded. */
  creaseShading?: number
  /** Font size applied to the root text. */
  fontSize?: string | number
  /** Font weight applied to the root text. */
  fontWeight?: string | number
  /** Text color of the folded panels. */
  color?: string
  /** Adds custom classes to the root element. */
  className?: string
  /** Inline style overrides for the root element. */
  style?: CSSProperties
}

/**
 * Clamp a numeric option into its supported range.
 * @param value - input value.
 * @param min - lower bound.
 * @param max - upper bound.
 * @returns the clamped value.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Fold a line of text into place panel by panel with a 3D fold.
 * @param props - see {@link FoldTextProps}.
 * @returns the fold-text element tree.
 */
export function FoldText({
  text,
  duration = 0.65,
  stagger = 0.045,
  ease = 'cubic-bezier(0.165, 0.84, 0.44, 1)',
  perspective = 700,
  creaseShading = 0.55,
  fontSize = 80,
  fontWeight = 800,
  color = '#f7f2e8',
  className = '',
  style = {},
}: FoldTextProps) {
  const safeCrease = clamp(creaseShading, 0, 1)
  const safePerspective = Math.max(120, perspective)

  const rootStyle = {
    '--fold-text-font-size': typeof fontSize === 'number' ? `${fontSize}px` : fontSize,
    '--fold-text-font-weight': fontWeight,
    '--fold-text-color': color,
    '--fold-duration': `${duration}s`,
    '--fold-stagger': `${stagger}s`,
    '--fold-ease': ease,
    '--fold-crease-strength': safeCrease,
    '--fold-perspective': `${safePerspective}px`,
    ...style,
  } as CSSProperties

  return (
    <span className={`${css.root} ${className}`.trim()} style={rootStyle}>
      <span className={css.srOnly}>{text}</span>
      {/* Keyed by text: a phrase change remounts the panels, restarting the fold. */}
      <span className={css.visual} aria-hidden="true" key={text}>
        {Array.from(text).map((char, index) => (
          <span className={css.segment} key={`segment-char-${index}`} style={{ '--fold-index': index } as CSSProperties}>
            <span className={css.piece}>
              <span className={css.crease} />
              {char === ' ' ? '\u00A0' : char}
            </span>
          </span>
        ))}
      </span>
    </span>
  )
}
