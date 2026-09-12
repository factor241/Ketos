/**
 * React entry views for the Spatial Board slot registrations.
 */
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createBoardStore } from './store.ts'
import { DashboardCanvas } from './canvas/DashboardCanvas.tsx'

export function BoardRoot(props: PropsStore<ReturnType<typeof createBoardStore>>) {
  const state = props.useStore(s => s)
  return <DashboardCanvas state={state} actions={props.actions} />
}

export function BoardIcon({ size, active }: { size: number; active?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? '#B8532F' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  )
}
