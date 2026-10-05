/**
 * Screen-space host for portaled popovers.
 *
 * A host supplies what a floating overlay cannot know by itself: where to mount
 * (`container`), at which scale to render (`scale`), which rectangle to stay
 * inside (`boundary`), and the signal that any of those changed (`subscribe`).
 * Without a provider the hook reports the browser defaults, so a consumer's
 * behavior is unchanged from before hosts existed.
 * @module @deepseek-ai/dsh-client-ui-primitives/PopoverHost
 */

import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'

/**
 * Screen-space host for portaled popovers. Coordinates exchanged with a host
 * come from `getBoundingClientRect()`, so `container` must be anchored to the
 * viewport: a transformed ancestor between it and the viewport shifts them.
 */
export interface PopoverHost {
  /** Portal target element. */
  container: HTMLElement
  /** Scale factor hosted popovers render at; must be positive. */
  scale: number
  /** Screen-pixel rectangle hosted popovers stay inside. */
  boundary(): DOMRect
  /**
   * Register a geometry-changed listener and return its unsubscribe. Callers
   * re-read `container`, `scale`, and `boundary` on every notification.
   * @param listener - invoked after the host geometry changed.
   * @returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void
}

/** Default signal: window resize plus capture-phase scroll from any scroller. */
const subscribeWindowGeometry = (listener: () => void): (() => void) => {
  window.addEventListener('resize', listener)
  window.addEventListener('scroll', listener, true)
  return () => {
    window.removeEventListener('resize', listener)
    window.removeEventListener('scroll', listener, true)
  }
}

/** Browser defaults; `container` is read lazily because module evaluation can precede the document. */
const DEFAULT_HOST: PopoverHost = {
  get container() { return document.body },
  scale: 1,
  boundary: () => new DOMRect(0, 0, window.innerWidth, window.innerHeight),
  subscribe: subscribeWindowGeometry,
}

const PopoverHostContext = createContext<PopoverHost | null>(null)

/** Props for {@link PopoverHostProvider}; an omitted field inherits the nearest host, then the browser default. */
export interface PopoverHostProviderProps {
  /** Portal target element (default: `document.body`). */
  container?: HTMLElement
  /** Popover scale (default: 1). */
  scale?: number
  /** Screen-pixel rectangle popovers stay inside (default: the browser window). */
  boundary?: () => DOMRect
  /** Geometry-changed signal (default: window resize and capture-phase scroll). */
  subscribe?: (listener: () => void) => () => void
  /** Subtree whose popovers render through this host. */
  children: ReactNode
}

/**
 * Provide popover host geometry to a subtree; nested providers override only
 * the fields they set.
 * @param props - the host fields and the subtree to host.
 * @returns the subtree under this host.
 */
export function PopoverHostProvider({ container, scale, boundary, subscribe, children }: PopoverHostProviderProps) {
  const parent = usePopoverHost()
  const value = useMemo<PopoverHost>(() => ({
    container: container ?? parent.container,
    scale: scale ?? parent.scale,
    boundary: boundary ?? (() => parent.boundary()),
    subscribe: subscribe ?? (listener => parent.subscribe(listener)),
  }), [container, scale, boundary, subscribe, parent])
  return <PopoverHostContext.Provider value={value}>{children}</PopoverHostContext.Provider>
}

/**
 * Read the nearest popover host.
 * @returns the nearest provider's host, or the browser defaults when no provider is mounted.
 */
export function usePopoverHost(): PopoverHost {
  return useContext(PopoverHostContext) ?? DEFAULT_HOST
}

/**
 * Read the nearest popover host only when a provider is mounted.
 * @returns the nearest provider's host, or null under the browser defaults.
 */
export function useOptionalPopoverHost(): PopoverHost | null {
  return useContext(PopoverHostContext)
}
