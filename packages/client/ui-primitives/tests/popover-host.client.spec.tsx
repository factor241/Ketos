// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PopoverHostProvider, usePopoverHost } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PopoverHost } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

/** Renders nothing; hands the hook's host to the test. */
function Probe({ onHost }: { onHost: (host: PopoverHost) => void }) {
  onHost(usePopoverHost())
  return null
}

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  new DOMRect(left, top, width, height)

const browserWidth = (): number => window.innerWidth
const browserHeight = (): number => window.innerHeight

describe('PopoverHost', () => {
  it('reports the browser defaults without a provider', () => {
    const hosts: PopoverHost[] = []
    render(<Probe onHost={(host) => { hosts.push(host) }} />)
    const host = hosts[0]!
    expect(host.container).toBe(document.body)
    expect(host.scale).toBe(1)
    const boundary = host.boundary()
    expect([boundary.left, boundary.top, boundary.right, boundary.bottom])
      .toEqual([0, 0, browserWidth(), browserHeight()])
  })

  it('registers window resize and capture-phase scroll listeners by default', () => {
    const hosts: PopoverHost[] = []
    render(<Probe onHost={(host) => { hosts.push(host) }} />)
    const listener = vi.fn()
    const unsubscribe = hosts[0]!.subscribe(listener)
    try {
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('scroll'))
      expect(listener).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
    }
    window.dispatchEvent(new Event('resize'))
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('provides container, scale, boundary, and subscribe from a provider', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const boundary = () => rect(10, 20, 300, 200)
    const unsubscribe = vi.fn()
    const subscribe = vi.fn(() => unsubscribe)
    const hosts: PopoverHost[] = []
    try {
      render(
        <PopoverHostProvider container={container} scale={2} boundary={boundary} subscribe={subscribe}>
          <Probe onHost={(host) => { hosts.push(host) }} />
        </PopoverHostProvider>,
      )
      const host = hosts[0]!
      expect(host.container).toBe(container)
      expect(host.scale).toBe(2)
      const b = host.boundary()
      expect([b.left, b.top, b.width, b.height]).toEqual([10, 20, 300, 200])
      const listener = vi.fn()
      host.subscribe(listener)
      expect(subscribe).toHaveBeenCalledWith(listener)
    } finally {
      container.remove()
    }
  })

  it('inherits omitted fields from the nearest provider and overrides only what it sets', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const boundary = () => rect(0, 0, 100, 100)
    const subscribe = vi.fn(() => () => {})
    const hosts: PopoverHost[] = []
    try {
      render(
        <PopoverHostProvider container={container} scale={3} boundary={boundary} subscribe={subscribe}>
          <PopoverHostProvider scale={4}>
            <Probe onHost={(host) => { hosts.push(host) }} />
          </PopoverHostProvider>
        </PopoverHostProvider>,
      )
      const host = hosts[0]!
      expect(host.container).toBe(container)
      expect(host.scale).toBe(4)
      expect(host.boundary().width).toBe(100)
      const listener = vi.fn()
      host.subscribe(listener)
      expect(subscribe).toHaveBeenCalledWith(listener)
    } finally {
      container.remove()
    }
  })

  it('falls back to browser defaults for fields a parentless provider omits', () => {
    const hosts: PopoverHost[] = []
    render(
      <PopoverHostProvider scale={2}>
        <Probe onHost={(host) => { hosts.push(host) }} />
      </PopoverHostProvider>,
    )
    const host = hosts[0]!
    expect(host.container).toBe(document.body)
    expect(host.scale).toBe(2)
    expect(host.boundary().bottom).toBe(browserHeight())
    const listener = vi.fn()
    const unsubscribe = host.subscribe(listener)
    window.dispatchEvent(new Event('resize'))
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
