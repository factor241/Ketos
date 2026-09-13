import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the Ketos sign: a stylized sea-monster tail fluke. Reused with the
 * same geometry as apps/web/public/favicon.svg so the browser shell and the
 * sidebar show one mark.
 * @param props.size - width in px (default 24; the viewBox is square, so the
 * height matches).
 * @param props.className - extra class for layout placement.
 * @returns the Ketos mark svg (aria-hidden decorative brand art).
 */
export function KetosMark({ size = 24, className }: { size?: number | undefined; className?: string | undefined }) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 50 50"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 46C12 44 22 40 28 30 30 22 34 12 44 6 40 16 38 22 36 26 40 28 44 32 46 40 40 38 34 36 30 34 22 34 10 38 4 46Z"
        fill="currentColor"
      />
    </svg>
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
 * @param props - Host-supplied mark presentation.
 * @returns the official Ketos mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <KetosMark size={size} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return <KetosWordmark />
}
