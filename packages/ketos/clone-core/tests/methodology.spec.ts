/** The canonical methodology vocabulary: the headings, the template, the parser, and the gap list. */
import { describe, expect, it } from 'vitest'
import {
  METHODOLOGY_SECTION_IDS, METHODOLOGY_SECTIONS, METHODOLOGY_TEMPLATE, methodologyGaps, methodologySections,
} from '../src/methodology.ts'

describe('the canonical methodology vocabulary', () => {
  it('pins the canonical headings and the template literal, so a rename fails', () => {
    expect(METHODOLOGY_SECTIONS).toEqual(['Принципы', 'Порядок работы', 'Критерии качества', 'Чего не делать'])
    expect(METHODOLOGY_TEMPLATE).toBe([
      '## Принципы',
      '',
      '## Порядок работы',
      '',
      '## Критерии качества',
      '',
      '## Чего не делать',
      '',
    ].join('\n'))
  })

  it('maps every canonical heading to one unique stable interface id', () => {
    expect(METHODOLOGY_SECTION_IDS).toEqual({
      'Принципы': 'principles',
      'Порядок работы': 'workflow',
      'Критерии качества': 'quality',
      'Чего не делать': 'avoid',
    })
    expect(Object.keys(METHODOLOGY_SECTION_IDS)).toEqual([...METHODOLOGY_SECTIONS])
    expect(new Set(Object.values(METHODOLOGY_SECTION_IDS)).size).toBe(METHODOLOGY_SECTIONS.length)
  })
})

describe('the canonical methodology template', () => {
  it('carries every canonical heading, in canonical order, with unfilled bodies', () => {
    const states = methodologySections(METHODOLOGY_TEMPLATE)
    expect(METHODOLOGY_TEMPLATE).not.toBe('')
    expect(states.map(state => state.heading)).toEqual([...METHODOLOGY_SECTIONS])
    expect(states.map(state => state.present)).toEqual([true, true, true, true])
    // The template is the starting text the person fills, so every body is
    // still empty and every heading is a gap until they do.
    expect(states.map(state => state.empty)).toEqual([true, true, true, true])
    expect(methodologyGaps(METHODOLOGY_TEMPLATE)).toEqual([...METHODOLOGY_SECTIONS])
  })
})

describe('methodologySections', () => {
  it('reports every section missing in empty text', () => {
    const states = methodologySections('')
    expect(states).toEqual(METHODOLOGY_SECTIONS.map(heading => ({ heading, present: false, empty: true })))
    expect(methodologyGaps('')).toEqual([...METHODOLOGY_SECTIONS])
  })

  it('reports a heading with a blank body as present and empty', () => {
    expect(methodologySections('## Принципы\n\n   \n')).toEqual([
      { heading: 'Принципы', present: true, empty: true },
      { heading: 'Порядок работы', present: false, empty: true },
      { heading: 'Критерии качества', present: false, empty: true },
      { heading: 'Чего не делать', present: false, empty: true },
    ])
  })

  it('reports exactly the unfilled sections as gaps', () => {
    const text = [
      '## Принципы',
      'Сначала факты.',
      '',
      '## Порядок работы',
      'Собрать требования.',
      '',
      '## Критерии качества',
      '',
      '## Чего не делать',
      'Не выдумывать данные.',
    ].join('\n')
    expect(methodologySections(text)).toEqual([
      { heading: 'Принципы', present: true, empty: false },
      { heading: 'Порядок работы', present: true, empty: false },
      { heading: 'Критерии качества', present: true, empty: true },
      { heading: 'Чего не делать', present: true, empty: false },
    ])
    expect(methodologyGaps(text)).toEqual(['Критерии качества'])
  })

  it('reports the unfilled sections in canonical order, not text order', () => {
    const gaps = methodologyGaps('## Чего не делать\nНе обещать сроков.')
    expect(gaps).toEqual(['Принципы', 'Порядок работы', 'Критерии качества'])
  })

  it('does not count a deeper or lookalike heading as the canonical section', () => {
    const text = [
      '### Принципы',
      'Уровень три не считается.',
      '',
      '## Принципы и подходы',
      'Похожий заголовок тоже не считается.',
    ].join('\n')
    expect(methodologySections(text)).toEqual([
      { heading: 'Принципы', present: false, empty: true },
      { heading: 'Порядок работы', present: false, empty: true },
      { heading: 'Критерии качества', present: false, empty: true },
      { heading: 'Чего не делать', present: false, empty: true },
    ])
  })

  it('keeps reading a section body until the next level-two heading', () => {
    const text = [
      '## Порядок работы',
      'Шаг первый.',
      '### Подробности',
      'Шаг второй.',
      '',
      '## Критерии качества',
      'Точность.',
    ].join('\n')
    const states = methodologySections(text)
    expect(states.find(state => state.heading === 'Порядок работы')).toEqual({
      heading: 'Порядок работы',
      present: true,
      empty: false,
    })
    expect(states.find(state => state.heading === 'Критерии качества')).toEqual({
      heading: 'Критерии качества',
      present: true,
      empty: false,
    })
  })
})
