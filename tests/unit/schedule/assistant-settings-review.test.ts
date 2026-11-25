/**
 * Review round 1 of Vee's Schedules settings (2026-11-25), checks written before the fixes.
 *
 *   1. Text size: make_schedule takes exactly the range the Style slider offers — read from the
 *      slider's rendered markup, not restated — in the input check, in buildSchedule and in the
 *      words its catalogue entry says.
 *   2. Every refusal of a colour says #rrggbb, whether the input check or buildSchedule refuses
 *      it; an over-long grand-total label or colour-rule value is refused with its limit named,
 *      never with zod's own "Too big" wording.
 */
import { describe, expect, it } from 'vitest'
import { federate } from '../../../src/shared/federate'
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter'
import { snapshotOf } from '../../../src/schedule/adapter'
import { StoreBuilder } from '../../../src/schedule/ifc/store'
import { emptySchedule } from '../../../src/schedule/schedule/def'
import { buildSchedule, type AskSchedule, type Built, type FieldWorld, type Refused } from '../../../src/schedule/assistant'
import { toolByName, type JsonSchema } from '../../../src/shared/tool-schemas'
import { parseToolInput } from '../../../src/renderer/ai/executors/inputs'
import { appearanceBody } from '../../../src/renderer/schedule-ui/panels/appearanceSection'
import { state as blankState, type AppState } from '../../../src/renderer/schedule-ui/state'

const fed = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
const snap = snapshotOf(fed)
const sb = new StoreBuilder()
sb.add(snap.cores, snap.cells)
const world: FieldWorld = { store: sb.finish(snap.meta), propKeys: fed.propKeys }

const DOORS = { category: ['IfcDoor'], columns: [{ field: 'Type' }, { field: 'FireRating' }] }
const run = (a: Record<string, unknown>): Built | Refused => buildSchedule(a as unknown as AskSchedule, world, null)
const errorOf = (a: Record<string, unknown>): string => {
  const r = run(a)
  return 'error' in r ? r.error : ''
}
const zodError = (a: Record<string, unknown>): string => {
  try {
    parseToolInput('make_schedule', a)
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/* ────────────────────────────── 1. the Style slider's range ────────────────────────────── */

describe('text size: make_schedule takes exactly the Style slider’s range', () => {
  const html = appearanceBody({ ...blankState, def: emptySchedule('Doors', ['IfcDoor']) } as AppState)
  const slider = /<input[^>]*data-act="app-fontsize"[^>]*>/.exec(html)?.[0] ?? ''
  const min = Number(/\bmin="(\d+)"/.exec(slider)?.[1])
  const max = Number(/\bmax="(\d+)"/.exec(slider)?.[1])

  it('the slider is found, with a whole-number range', () => {
    expect(slider).toContain('type="range"')
    expect(Number.isInteger(min) && Number.isInteger(max) && min < max).toBe(true)
  })

  it('the input check accepts the slider’s ends and refuses one past each', () => {
    for (const ok of [min, max]) expect(zodError({ style: { textSize: ok } }), String(ok)).toBe('')
    for (const bad of [min - 1, max + 1]) expect(zodError({ style: { textSize: bad } }), String(bad)).toMatch(/make_schedule: style\.textSize/)
  })

  it('buildSchedule accepts the ends, and refuses one past each naming the slider’s range', () => {
    for (const ok of [min, max]) {
      const r = run({ ...DOORS, style: { textSize: ok } })
      expect('error' in r ? r.error : (r as Built).def.appearance?.fontSize, String(ok)).toBe(ok)
    }
    for (const bad of [min - 1, max + 1]) {
      expect(errorOf({ ...DOORS, style: { textSize: bad } }), String(bad)).toContain(`outside ${min}–${max} px, the Style slider’s range`)
    }
  })

  it('the catalogue names the same range', () => {
    const style = toolByName('make_schedule')!.input_schema.properties.style as JsonSchema
    expect((style.properties?.textSize as JsonSchema).description).toContain(`${min}–${max}`)
  })
})

/* ────────────────────────────── 2. plain words on long or wrong values ────────────────────────────── */

describe('a colour that is not #rrggbb is refused in words that say #rrggbb — by the input check and by buildSchedule', () => {
  const rule = (key: 'background' | 'text', colour: string) => ({
    ...DOORS,
    columns: [{ field: 'Type' }, { field: 'FireRating', colourRules: [{ op: '=', value: '1 HR', [key]: colour }] }]
  })
  for (const colour of ['rgb(255,0,0)', '#ff0000ff', 'red', '#fff']) {
    for (const key of ['background', 'text'] as const) {
      it(`${key} ${colour}`, () => {
        const z = zodError(rule(key, colour))
        expect(z).toMatch(/make_schedule: columns\.1\.colourRules\.0/)
        expect(z).toMatch(/#rrggbb/)
        expect(errorOf(rule(key, colour))).toMatch(/#rrggbb/)
      })
    }
  }
})

describe('an over-long grand-total label or colour-rule value is refused with its limit named', () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['grandTotalTitle of 201 characters', { ...DOORS, grandTotalTitle: 'x'.repeat(201) }, /grandTotalTitle.*200/],
    [
      'a colour-rule value of 121 characters',
      { ...DOORS, columns: [{ field: 'FireRating', colourRules: [{ op: '=', value: 'x'.repeat(121), background: '#f8d7da' }] }] },
      /120/
    ]
  ]
  for (const [what, call, limit] of cases) {
    it(what, () => {
      const z = zodError(call)
      expect(z).toMatch(limit)
      expect(z).not.toMatch(/too big/i)
      expect(errorOf(call)).toMatch(limit)
    })
  }

  it('at the limits both pass', () => {
    const call = {
      ...DOORS,
      grandTotalTitle: 'x'.repeat(200),
      columns: [{ field: 'FireRating', colourRules: [{ op: '=', value: 'x'.repeat(120), background: '#f8d7da' }] }]
    }
    expect(zodError(call)).toBe('')
    expect(errorOf(call)).toBe('')
  })
})
