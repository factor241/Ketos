// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { KetosMark, OfficialBrandMark, OfficialBrandName } from '../src/client/Brand.tsx'
import { KETOS_MARK_DATA_URI } from '../src/client/mark.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const MARK_HOLES = [
  'sidebar.brand.mark',
] as const

const NAME_HOLE = 'sidebar.brand.name'

const ALL_HOLES = [...MARK_HOLES, NAME_HOLE] as const

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(ALL_HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('official browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('fills the mark slots in every build profile and the name slot only in the official build', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    const local = await bench()
    await local.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of MARK_HOLES) expect(local.slots.entries(hole)).toHaveLength(1)
    expect(local.slots.entries(NAME_HOLE)).toHaveLength(0)

    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const official = await bench()
    await official.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of ALL_HOLES) expect(official.slots.entries(hole)).toHaveLength(1)
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of ALL_HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of ALL_HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of ALL_HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of ALL_HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of ALL_HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of ALL_HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('renders the mark at its default size and forwards the layout class', () => {
    const mark = render(<KetosMark />)
    expect(mark.container.querySelector('img')?.getAttribute('width')).toBe('24')
    mark.rerender(<KetosMark className="brand-layout" />)
    expect(mark.container.querySelector('img')?.getAttribute('class')).toBe('brand-layout')
  })

  it('renders the supplied PNG mark at both requested sizes and the lettering name independently', () => {
    const name = render(<OfficialBrandName />)
    expect(name.container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 66 24')
    name.unmount()

    const mark = render(<OfficialBrandMark size={34} />)
    expect(mark.container.querySelector('img')?.getAttribute('width')).toBe('34')
    expect(mark.container.querySelector('img')?.getAttribute('src')).toBe(KETOS_MARK_DATA_URI)
    mark.rerender(<OfficialBrandMark size={24} />)
    expect(mark.container.querySelector('img')?.getAttribute('width')).toBe('24')
  })
})
