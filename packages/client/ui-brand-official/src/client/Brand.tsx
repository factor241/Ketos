import { KETOS_MARK_DATA_URI } from './mark.ts'

/**
 * Render the Ketos sign: the product owner's 512×512 PNG, embedded verbatim
 * from {@link KETOS_MARK_DATA_URI}. The artwork is the supplied file, not a
 * redrawn approximation.
 * @param props.size - square edge in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the Ketos mark image (aria-hidden decorative brand art).
 */
export function KetosMark({ size = 24, className }: { size?: number | undefined; className?: string | undefined }) {
  return (
    <img
      src={KETOS_MARK_DATA_URI}
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}

/**
 * Ketos letterforms for the sidebar brand name. The K, E, T, and S are
 * blocky monoline fills; the O uses an even-odd counter. Height spans
 * y4..20 inside the lettering band y0..24.
 * @param props.size - height in px (default 24; width follows the artwork).
 * @param props.className - extra class for layout placement.
 * @returns the KETOS wordmark svg (aria-hidden decorative brand art).
 */
export function KetosWordmark({ size = 24, className }: { size?: number | undefined; className?: string | undefined }) {
  return (
    <svg
      width={(size * 66) / 24}
      height={size}
      className={className}
      viewBox="0 0 66 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M0 4h3v16H0ZM3 10.5 10 4v3.4L5.4 12 10 16.6V20l-.8 0L3 13.5Z" fill="currentColor" />
      <path d="M14 4h10v3h-7v4h6v3h-6v3h7v3H14Z" fill="currentColor" />
      <path d="M28 4h10v3h-3.5v13h-3V7H28Z" fill="currentColor" />
      <path d="M42 4h10v16H42Zm3 3v10h4V7Z" fillRule="evenodd" fill="currentColor" />
      <path d="M56 4h10v3h-7v6h7v7h-10v-3h7v-1h-7Z" fill="currentColor" />
    </svg>
  )
}

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation (square edge and layout class).
 * @returns the official Ketos mark.
 */
export function OfficialBrandMark({ size, className }: { size: number; className?: string | undefined }) {
  return <KetosMark size={size} className={className} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return <KetosWordmark />
}
