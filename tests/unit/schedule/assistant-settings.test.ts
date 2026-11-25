/**
 * Vee sets what the Schedules window sets (2026-11-25, checks written before the build).
 *
 * Five things the window can set and `make_schedule` could not:
 *
 *   1. `style` — the Appearance controls: showTitle, gridLines, stripes (zebra), textSize
 *      (fontSize), font (bodyFont, a `fonts.ts` key), outline, boldHeader (headerBold),
 *      blankRowBeforeData. Only the keys given change.
 *   2. `groupFormat` — per sort / group level, by its field: header, footer ('title_count_totals'
 *      is `titleCountTotals`), blankLine. A field with no level refuses the call.
 *   3. `grandTotalTitle` — "" clears it.
 *   4. a column's `colourRules` — op, value, background, text, bold → `Column.conditional`;
 *      given replaces, [] clears, absent keeps; colours `#rrggbb` only; at most 10 (the window's
 *      "+ Add rule" has no cap of its own, so the brief's default).
 *   5. a column's `width`, `verticalHeading`, `thousands`, `prefix`, `suffix`, `hideZero`
 *      (suppressZero), `showUnit` (showSymbol), `yesNoStyle` (one of `BOOL_STYLES`), and
 *      `total: 'count_distinct'` (countDistinct).
 *
 * Out-of-range or unknown values refuse the whole call through `buildSchedule`'s Refused
 * shape. The probes sit outside BOTH ranges the source gives — the window's controls
 * (text size 8–24 in `schedule-ui/events.ts`, width 30–600 in `schedule-ui/colResize.ts`) and
 * the file reader `parseScheduleDef` (6–48, 20–2000) — so these checks hold whichever of the two
 * the build adopts. The values set in the happy paths sit inside both.
 *
 * The new keys are not on `AskSchedule` yet, so every call is typed loosely, and the checks fail
 * at their assertions rather than on an import.
 */
import { describe, expect, it } from 'vitest'
import { federate } from '../../../src/shared/federate'
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter'
import { snapshotOf } from '../../../src/schedule/adapter'
import { StoreBuilder } from '../../../src/schedule/ifc/store'
import {
  BOOL_STYLES,
  CORE_LABELS,
  parseScheduleDef,
  type Column,
  type ScheduleDef
} from '../../../src/schedule/schedule/def'
import { buildSchedule, simplify, type AskSchedule, type Built, type FieldWorld, type Refused } from '../../../src/schedule/assistant'
import { GATED_CALLS, TOOLS, toolByName, type JsonSchema } from '../../../src/shared/tool-schemas'
import { parseToolInput } from '../../../src/renderer/ai/executors/inputs'

/* ────────────────────────────── the fixture ────────────────────────────── */

const fed = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
const snap = snapshotOf(fed)
const sb = new StoreBuilder()
sb.add(snap.cores, snap.cells)
const world: FieldWorld = { store: sb.finish(snap.meta), propKeys: fed.propKeys }

const ask = (a: Record<string, unknown>): AskSchedule => a as unknown as AskSchedule
const run = (a: Record<string, unknown>, base: ScheduleDef | null = null): Built | Refused => buildSchedule(ask(a), world, base)
const built = (a: Record<string, unknown>, base: ScheduleDef | null = null): Built => {
  const r = run(a, base)
  if ('error' in r) throw new Error(r.error)
  return r
}
const refused = (a: Record<string, unknown>, base: ScheduleDef | null = null): Refused => {
  const r = run(a, base)
  if (!('error' in r)) throw new Error('expected a refusal, got a schedule')
  return r
}

/** The doors' own fields: two core, three properties (Width a length, IsExternal a yes/no). */
const DOOR_COLUMNS = [{ field: 'Type' }, { field: 'Level' }, { field: 'Width' }, { field: 'FireRating' }, { field: 'IsExternal' }]
const DOORS = { category: ['IfcDoor'], columns: DOOR_COLUMNS }

/** A plain door schedule, as the window would hold it: what base:"open" changes. */
const plain = (): ScheduleDef => built(DOORS).def

/** A column by the name of its field: a core field's label, a property's name. */
function col(def: ScheduleDef, name: string): Column {
  const c = def.columns.find((x) =>
    x.field.kind === 'core' ? CORE_LABELS[x.field.key] === name : x.field.kind === 'prop' ? x.field.prop === name : false
  )
  if (!c) throw new Error(`no column ${name}`)
  return c
}

/** A simplified column by its field name. */
type SimpleColumn = Record<string, unknown> & { field: string }
const simpleCol = (s: Record<string, unknown>, name: string): SimpleColumn => {
  const c = (s.columns as SimpleColumn[]).find((x) => x.field === name)
  if (!c) throw new Error(`no simplified column ${name}`)
  return c
}

/** Through the window's own reader, so a def built by hand is what a loaded file would be. */
const asLoaded = (d: ScheduleDef): ScheduleDef => parseScheduleDef(JSON.parse(JSON.stringify(d)))

/* ────────────────────────────── 1. style ────────────────────────────── */

const STYLE_ALL = {
  showTitle: false,
  gridLines: false,
  stripes: false,
  textSize: 15,
  font: 'georgia',
  outline: false,
  boldHeader: false,
  blankRowBeforeData: true
}
const APPEARANCE_ALL = {
  showTitle: false,
  gridLines: false,
  zebra: false,
  fontSize: 15,
  bodyFont: 'georgia',
  outline: false,
  headerBold: false,
  blankRowBeforeData: true
}

describe('1 · style lands on the appearance', () => {
  it('base new: every style key lands under its appearance name', () => {
    const { def } = built({ ...DOORS, style: STYLE_ALL })
    expect(def.appearance).toMatchObject(APPEARANCE_ALL)
  })

  it('base open: every style key lands, the columns are kept', () => {
    const open = plain()
    const { def } = built({ base: 'open', style: STYLE_ALL }, open)
    expect(def.appearance).toMatchObject(APPEARANCE_ALL)
    expect(def.columns).toEqual(open.columns)
  })

  it('base open: only the keys given change; the rest of the appearance is kept', () => {
    const open = asLoaded({
      ...plain(),
      appearance: { ...plain().appearance, title: 'Doors', outline: false, blankRowBeforeData: true, bodyFont: 'verdana' }
    })
    const { def } = built({ base: 'open', style: { textSize: 11, stripes: false } }, open)
    expect(def.appearance).toEqual({ ...open.appearance, fontSize: 11, zebra: false })
  })
})

/* ────────────────────────────── 2. groupFormat ────────────────────────────── */

const LEVEL = { kind: 'core', key: 'storey' }
const TYPE = { kind: 'core', key: 'typeName' }

describe('2 · groupFormat lands on the level its field names', () => {
  it('base new: header, footer and blankLine land on each named level', () => {
    const { def } = built({
      ...DOORS,
      groupBy: ['Level', 'Type'],
      groupFormat: [
        { field: 'Level', header: false, footer: 'totals', blankLine: true },
        { field: 'Type', footer: 'title' }
      ]
    })
    expect(def.sort).toHaveLength(2)
    expect(def.sort[0]).toMatchObject({ field: LEVEL, header: false, footer: 'totals', blankLine: true })
    // Only the keys given change: Type keeps the heading row groupBy gives it.
    expect(def.sort[1]).toMatchObject({ field: TYPE, header: true, footer: 'title' })
  })

  it('every footer value maps; title_count_totals is titleCountTotals', () => {
    const map = { none: 'none', title: 'title', count: 'count', totals: 'totals', title_count_totals: 'titleCountTotals' }
    for (const [asked, stored] of Object.entries(map)) {
      // Start from a footer the asked one is not, so a kept default cannot pass for it.
      const start = asked === 'count' ? 'title' : 'count'
      const { def } = built({ ...DOORS, groupBy: ['Level'], groupFormat: [{ field: 'Level', footer: start }] })
      const { def: after } = built({ base: 'open', groupFormat: [{ field: 'Level', footer: asked }] }, def)
      expect(after.sort[0].footer, asked).toBe(stored)
    }
  })

  it('a sortBy level can be formatted too', () => {
    const { def } = built({ ...DOORS, sortBy: [{ field: 'Name' }], groupFormat: [{ field: 'Name', blankLine: true }] })
    expect(def.sort[0]).toMatchObject({ field: { kind: 'core', key: 'name' }, blankLine: true })
  })

  it('base open: a level the open schedule already has is formatted in place, nothing else moves', () => {
    const open = built({ ...DOORS, groupBy: ['Level'] }).def
    expect(open.sort[0].header).toBe(true)
    const { def } = built({ base: 'open', groupFormat: [{ field: 'Level', header: false, footer: 'totals', blankLine: true }] }, open)
    expect(def.sort).toHaveLength(1)
    expect(def.sort[0]).toMatchObject({ field: LEVEL, dir: 'asc', header: false, footer: 'totals', blankLine: true })
    expect(def.columns).toEqual(open.columns)
  })
})

/* ────────────────────────────── 3. grandTotalTitle ────────────────────────────── */

describe('3 · grandTotalTitle', () => {
  it('base new: lands on the definition', () => {
    expect(built({ ...DOORS, grandTotalTitle: 'All doors' }).def.grandTotalTitle).toBe('All doors')
  })

  it('base open: replaces the title the user set, and "" clears it', () => {
    const open = asLoaded({ ...plain(), grandTotalTitle: 'Total doors' })
    expect(built({ base: 'open', grandTotalTitle: 'Every door' }, open).def.grandTotalTitle).toBe('Every door')
    expect(built({ base: 'open', grandTotalTitle: '' }, open).def.grandTotalTitle ?? '').toBe('')
  })
})

/* ────────────────────────────── 4. colourRules ────────────────────────────── */

const RULES_IN = [
  { op: '=', value: '1 HR', background: '#f8d7da', text: '#58151c', bold: true },
  { op: 'noValue', background: '#e2e3e5' }
]
const RULES_OUT = [
  { op: '=', value: '1 HR', bg: '#f8d7da', fg: '#58151c', bold: true },
  { op: 'noValue', bg: '#e2e3e5' }
]

describe('4 · a column’s colourRules land on its conditional rules', () => {
  it('base new: each rule lands as op, value, bg, fg, bold', () => {
    const { def } = built({ category: ['IfcDoor'], columns: [{ field: 'Type' }, { field: 'FireRating', colourRules: RULES_IN }] })
    expect(col(def, 'FireRating').conditional).toMatchObject(RULES_OUT)
    expect(col(def, 'FireRating').conditional).toHaveLength(2)
  })

  /** The open schedule with a rule of the user's own on FireRating. */
  const withRule = (): ScheduleDef => {
    const d = plain()
    col(d, 'FireRating').conditional = [{ op: 'contains', value: '2', bg: '#cfe2ff', fg: '#052c65', bold: false }]
    return asLoaded(d)
  }

  it('base open: given replaces the column’s rules', () => {
    const { def } = built({ base: 'open', columns: [{ field: 'FireRating', colourRules: RULES_IN }] }, withRule())
    expect(col(def, 'FireRating').conditional).toHaveLength(2)
    expect(col(def, 'FireRating').conditional).toMatchObject(RULES_OUT)
  })

  it('base open: [] clears them', () => {
    const { def } = built({ base: 'open', columns: [{ field: 'FireRating', colourRules: [] }] }, withRule())
    expect(col(def, 'FireRating').conditional ?? []).toEqual([])
  })

  it('base open: absent keeps them (guard: passes today)', () => {
    const open = withRule()
    const { def } = built({ base: 'open', columns: [{ field: 'FireRating', heading: 'Fire' }] }, open)
    expect(col(def, 'FireRating').conditional).toEqual(col(open, 'FireRating').conditional)
  })

  it('ten rules — the most a column takes — are all kept', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ op: '=', value: `R${i}`, background: '#fff3cd' }))
    const { def } = built({ category: ['IfcDoor'], columns: [{ field: 'FireRating', colourRules: ten }] })
    expect(col(def, 'FireRating').conditional).toHaveLength(10)
  })
})

/* ────────────────────────────── 5. column extras ────────────────────────────── */

const WIDTH_IN = {
  field: 'Width',
  width: 140,
  verticalHeading: true,
  thousands: true,
  prefix: 'W ',
  suffix: ' clear',
  hideZero: true,
  showUnit: true
}

describe('5 · a column’s width, heading, number format, yes/no style and distinct count', () => {
  it('base new: each extra lands on the column under its definition name', () => {
    const { def } = built({
      category: ['IfcDoor'],
      columns: [{ field: 'Type', total: 'count_distinct' }, WIDTH_IN, { field: 'IsExternal', yesNoStyle: 'Y/N' }]
    })
    const w = col(def, 'Width')
    expect(w.width).toBe(140)
    expect(w.headingOrientation).toBe('vertical')
    expect(w.format).toMatchObject({ thousands: true, prefix: 'W ', suffix: ' clear', suppressZero: true, showSymbol: true })
    expect(col(def, 'IsExternal').format?.boolStyle).toBe('Y/N')
    expect(col(def, 'Type').total).toBe('countDistinct')
  })

  it('every yes/no style of the window is accepted', () => {
    for (const style of BOOL_STYLES) {
      const { def } = built({ category: ['IfcDoor'], columns: [{ field: 'IsExternal', yesNoStyle: style }] })
      expect(col(def, 'IsExternal').format?.boolStyle, style).toBe(style)
    }
  })

  it('base open: the extras land on a column already shown, and can be turned back off', () => {
    const open = plain()
    const on = built({ base: 'open', columns: [WIDTH_IN, { field: 'IsExternal', yesNoStyle: 'TRUE/FALSE' }, { field: 'Type', total: 'count_distinct' }] }, open).def
    expect(col(on, 'Width')).toMatchObject({ width: 140, headingOrientation: 'vertical' })
    expect(col(on, 'Width').format).toMatchObject({ thousands: true, prefix: 'W ', suffix: ' clear', suppressZero: true, showSymbol: true })
    expect(col(on, 'IsExternal').format?.boolStyle).toBe('TRUE/FALSE')
    expect(col(on, 'Type').total).toBe('countDistinct')
    expect(on.columns).toHaveLength(open.columns.length)

    const off = built(
      { base: 'open', columns: [{ field: 'Width', verticalHeading: false, thousands: false, hideZero: false, showUnit: false }] },
      on
    ).def
    const w = col(off, 'Width')
    expect(w.headingOrientation).not.toBe('vertical')
    expect(w.format?.thousands).toBe(false)
    expect(w.format?.suppressZero ?? false).toBe(false)
    expect(w.format?.showSymbol ?? false).toBe(false)
    // Only the keys given change: the width, prefix and suffix are kept.
    expect(w.width).toBe(140)
    expect(w.format).toMatchObject({ prefix: 'W ', suffix: ' clear' })
  })
})

/* ────────────────────────────── Done 2: refusals ────────────────────────────── */

describe('out-of-range and unknown values refuse the whole call, and nothing is applied', () => {
  const open = (): ScheduleDef => asLoaded(built({ ...DOORS, groupBy: ['Level'] }).def)
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['textSize 5', { style: { textSize: 5 } }, /size/i],
    ['textSize 49', { style: { textSize: 49 } }, /size/i],
    ['an unknown font', { style: { font: 'comic-sans' } }, /font/i],
    ['width 10', { columns: [{ field: 'Width', width: 10 }] }, /width/i],
    ['width 5000', { columns: [{ field: 'Width', width: 5000 }] }, /width/i],
    ['an unknown yesNoStyle', { columns: [{ field: 'IsExternal', yesNoStyle: 'Oui/Non' }] }, /yes|style/i],
    ['a non-hex background', { columns: [{ field: 'FireRating', colourRules: [{ op: '=', value: '1 HR', background: 'red; background:url(x)' }] }] }, /colou?r|hex|#/i],
    ['a non-hex text colour', { columns: [{ field: 'FireRating', colourRules: [{ op: '=', value: '1 HR', text: 'red' }] }] }, /colou?r|hex|#/i],
    [
      'eleven colour rules',
      { columns: [{ field: 'FireRating', colourRules: Array.from({ length: 11 }, (_, i) => ({ op: '=', value: `R${i}`, background: '#fff3cd' })) }] },
      /10|rule/i
    ],
    ['a groupFormat field with no level', { groupFormat: [{ field: 'Type', footer: 'title' }] }, /Type/]
  ]

  for (const [what, extra, reason] of cases) {
    it(`base open: ${what} refuses with a reason, the open schedule untouched`, () => {
      const base = open()
      const before = JSON.stringify(base)
      // A valid change in the same call, so a half-applied call would show.
      const style = { stripes: false, ...((extra.style as object | undefined) ?? {}) }
      const r = refused({ base: 'open', grandTotals: false, ...extra, style }, base)
      expect(r.error.length).toBeGreaterThan(0)
      expect(r.error).toMatch(reason)
      expect(JSON.stringify(base)).toBe(before)
    })

    it(`base new: ${what} refuses`, () => {
      const r = run({ ...DOORS, groupBy: ['Level'], ...extra })
      expect('error' in r).toBe(true)
    })
  }

  it('a groupFormat field refuses when the schedule has no level at all', () => {
    const r = run({ base: 'open', groupFormat: [{ field: 'Level', header: true }] }, plain())
    expect('error' in r).toBe(true)
  })
})

/* ────────────────────────────── Done 3: the round trip ────────────────────────────── */

describe('round trip: simplify reports all five under the input names, and buildSchedule takes them back', () => {
  const FULL = {
    category: ['IfcDoor'],
    columns: [
      { field: 'Type', total: 'count_distinct' },
      { field: 'Level' },
      WIDTH_IN,
      { field: 'FireRating', colourRules: RULES_IN },
      { field: 'IsExternal', yesNoStyle: 'Y/N' }
    ],
    groupBy: ['Level'],
    groupFormat: [{ field: 'Level', header: false, footer: 'totals', blankLine: true }],
    grandTotalTitle: 'All doors',
    style: STYLE_ALL
  }

  it('simplify names style, groupFormat, grandTotalTitle and the column extras as make_schedule takes them', () => {
    const s = simplify(built(FULL).def)
    expect(s.style).toMatchObject(STYLE_ALL)
    expect(s.groupFormat).toEqual([expect.objectContaining({ field: 'Level', header: false, footer: 'totals', blankLine: true })])
    expect(s.grandTotalTitle).toBe('All doors')
    expect(simpleCol(s, 'Width')).toMatchObject({
      width: 140,
      verticalHeading: true,
      thousands: true,
      prefix: 'W ',
      suffix: ' clear',
      hideZero: true,
      showUnit: true
    })
    expect(simpleCol(s, 'IsExternal')).toMatchObject({ yesNoStyle: 'Y/N' })
    expect(simpleCol(s, 'Type')).toMatchObject({ total: 'count_distinct' })
    expect(simpleCol(s, 'FireRating').colourRules).toMatchObject(RULES_IN)
  })

  it('simplify → buildSchedule(base:"open") on a plain schedule gives back the same values', () => {
    const a = built(FULL).def
    const s = simplify(a)
    const b = built({ ...s, base: 'open' }, plain()).def
    expect(b.appearance).toEqual(a.appearance)
    expect(b.sort).toEqual(a.sort)
    expect(b.grandTotalTitle).toBe('All doors')
    const extras = (c: Column) => ({
      width: c.width,
      headingOrientation: c.headingOrientation,
      format: c.format,
      total: c.total,
      conditional: c.conditional
    })
    expect(b.columns.map(extras)).toEqual(a.columns.map(extras))
    // And the values really are there, not two defaults agreeing.
    expect(col(b, 'Width').width).toBe(140)
    expect(col(b, 'FireRating').conditional).toHaveLength(2)
  })
})

/* ────────────────────────────── Done 4: nothing new said, nothing changed ────────────────────────────── */

describe('base:"open" without the new keys keeps what the user set (guard: passes today)', () => {
  /** A door schedule the user dressed by hand in the window. */
  const dressed = (): ScheduleDef => {
    const d = built({ ...DOORS, groupBy: ['Level'] }).def
    d.appearance = { ...d.appearance, zebra: false, fontSize: 17, bodyFont: 'cambria', outline: false, blankRowBeforeData: true, headerBold: false }
    d.grandTotalTitle = 'Total doors'
    d.sort[0] = { ...d.sort[0], header: false, footer: 'totals', blankLine: true }
    const w = col(d, 'Width')
    w.width = 160
    w.headingOrientation = 'vertical'
    w.format = { ...w.format, thousands: true, prefix: '~', suffix: ' w', suppressZero: true, showSymbol: true }
    col(d, 'IsExternal').format = { boolStyle: '✓/✗' }
    col(d, 'Type').total = 'countDistinct'
    col(d, 'FireRating').conditional = [{ op: '=', value: '1 HR', bg: '#f8d7da', fg: '#58151c', bold: true }]
    return asLoaded(d)
  }

  const calls: [string, Record<string, unknown>][] = [
    ['grandTotals', { base: 'open', grandTotals: false }],
    ['a re-headed column', { base: 'open', columns: [{ field: 'Width', heading: 'Clear width' }, { field: 'FireRating', heading: 'Fire' }] }],
    ['filters', { base: 'open', filters: [{ field: 'FireRating', op: 'hasValue' }] }],
    ['a title', { base: 'open', title: 'Doors again' }]
  ]
  for (const [what, call] of calls) {
    it(`${what}: appearance, colour rules, widths, format extras, group format and grand-total title unchanged`, () => {
      const open = dressed()
      const { def } = built(call, open)
      expect(def.appearance).toEqual(open.appearance)
      expect(def.grandTotalTitle).toBe(open.grandTotalTitle)
      expect(def.sort).toEqual(open.sort)
      for (const name of ['Type', 'Width', 'FireRating', 'IsExternal']) {
        const [was, now] = [col(open, name), col(def, name)]
        expect({ width: now.width, o: now.headingOrientation, f: now.format, t: now.total, c: now.conditional }, name).toEqual({
          width: was.width,
          o: was.headingOrientation,
          f: was.format,
          t: was.total,
          c: was.conditional
        })
      }
    })
  }
})

/* ────────────────────────────── Done 5: the input check and the catalogue ────────────────────────────── */

describe('the input check takes the new keys', () => {
  const CALL = {
    base: 'open',
    style: STYLE_ALL,
    groupFormat: [
      { field: 'Level', header: false, footer: 'title_count_totals', blankLine: true },
      { field: 'Type', footer: 'none' }
    ],
    grandTotalTitle: 'All doors',
    columns: [
      { ...WIDTH_IN, total: 'count_distinct' },
      { field: 'IsExternal', yesNoStyle: 'Y/N' },
      { field: 'FireRating', colourRules: RULES_IN }
    ]
  }

  it('a valid call with every new key passes through whole', () => {
    expect(parseToolInput('make_schedule', CALL)).toEqual(CALL)
  })

  it('an unknown key inside style is refused, naming make_schedule: style', () => {
    expect(() => parseToolInput('make_schedule', { style: { textSize: 12, sparkle: true } })).toThrow(/make_schedule: style/)
  })
})

describe('the catalogue lists the new keys; make_schedule stays a view tool, ungated; no new tool', () => {
  const make = toolByName('make_schedule')!
  const props = make.input_schema.properties as Record<string, JsonSchema>
  const colProps = (props.columns?.items?.properties ?? {}) as Record<string, JsonSchema>

  it('style, groupFormat and grandTotalTitle are listed', () => {
    for (const k of ['style', 'groupFormat', 'grandTotalTitle']) expect(props[k], k).toBeDefined()
    expect(Object.keys(props.style?.properties ?? {}).sort()).toEqual(
      ['blankRowBeforeData', 'boldHeader', 'font', 'gridLines', 'outline', 'showTitle', 'stripes', 'textSize'].sort()
    )
    const gf = (props.groupFormat?.items?.properties ?? {}) as Record<string, JsonSchema>
    expect(Object.keys(gf).sort()).toEqual(['blankLine', 'field', 'footer', 'header'])
    expect(gf.footer?.enum).toEqual(['none', 'title', 'count', 'totals', 'title_count_totals'])
  })

  it('the column extras are listed, total offers count_distinct, yesNoStyle the window’s styles', () => {
    for (const k of ['width', 'verticalHeading', 'thousands', 'prefix', 'suffix', 'hideZero', 'showUnit', 'yesNoStyle', 'colourRules']) {
      expect(colProps[k], k).toBeDefined()
    }
    expect(colProps.total?.enum).toContain('count_distinct')
    expect(colProps.yesNoStyle?.enum).toEqual([...BOOL_STYLES])
    const rule = (colProps.colourRules?.items?.properties ?? {}) as Record<string, JsonSchema>
    expect(Object.keys(rule).sort()).toEqual(['background', 'bold', 'op', 'text', 'value'])
  })

  it('make_schedule is kind view and not gated (guard: passes today)', () => {
    expect(make.kind).toBe('view')
    expect(GATED_CALLS.some((g) => g.tool === 'make_schedule')).toBe(false)
  })

  it('the tool names are the same 39 (guard: passes today)', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(
      [
        'summarize_elements', 'audit_model', 'clash_check', 'set_filter_stack', 'manage_filters', 'query_elements',
        'apply_visibility', 'select_elements', 'set_storeys', 'activate_model', 'set_view', 'set_section',
        'toggle_display', 'color_by_property', 'color_models', 'get_element', 'get_entity_raw', 'list_values',
        'find_properties', 'search', 'get_spatial_tree', 'get_relationships', 'get_model_info', 'get_view_state',
        'measure_between', 'find_nearby', 'query_sql', 'ask_choice', 'ifcsg_columns', 'set_models', 'set_interface',
        'manage_views', 'manage_markups', 'request_user_action', 'manage_schedules', 'make_schedule', 'get_schedule',
        'export_schedule', 'color_by_schedule_column'
      ].sort()
    )
  })
})
