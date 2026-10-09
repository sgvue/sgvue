/**
 * The tool catalogue against the design, and against its own executors.
 *
 * The design's fifteen tools are the specification: `SGVue.dc.html:1358–1568` gives each
 * one's name, description and input schema, and this file holds the same strings so a
 * reviewer can diff them without reading TypeScript. Two corrections are asserted as
 * corrections, not as the design: one `combine` enum, and `additionalProperties: false`
 * everywhere strict mode requires it.
 *
 * 2026-10-01: `set_section` keeps the design's opening sentence and its four inputs and gains
 * one, `cut`; the rest of its description says that they act on one of two independent cuts,
 * and what an omitted input means — the Section card's defaults on a new plane, the plane's
 * current state on one already set.
 *
 * 2026-10-02 — parity with the user, phase 1: the last block. Two new view tools in a group of
 * their own (`set_models`, `set_interface`), three more switches on `toggle_display`, a `mode`
 * on `select_elements`, `undo` / `redo` on `apply_visibility`, `null` for one key on
 * `color_models`. The "read-only additions" assertion was adjusted for the new group, on
 * purpose, and says so where it is.
 *
 * The same day — phase 2: its own block, last. Two more view tools in that group
 * (`manage_views`, `manage_markups`), `fit` / `azimuth` / `elevation` / `zoom` on `set_view`,
 * `update` on `manage_filters`, a `color` per step on `set_filter_stack`. 35 tools; phase 1's
 * count and the group's position were updated on purpose where they are asserted.
 *
 * Phase 3, the consent gate — its own block, last: one more view tool in that group,
 * `request_user_action`; `delete` on `manage_views`, `delete` and `clear` on `manage_markups`;
 * the `gate` marker and `gateOf`. 36 tools. Phase 1's and phase 2's counts, positions and the
 * sentences that said "nothing here deletes" were updated on purpose, where they are asserted.
 *
 * Phase 4 — its own block, last: one more view tool in that group, `manage_schedules`;
 * `make_schedule`'s formats, order and calculated columns; `schedule` beside `ids` and
 * `selection`; `place_spot`, `place_measure` and `show` on `manage_markups`. 37 tools. The
 * earlier phases' counts and positions, the gate's list, and the sentence that said nothing
 * here places a markup were updated on purpose, where they are asserted.
 */
import type { Anthropic } from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import {
  DESIGN_TOOL_NAMES,
  FILTER_SET_NAME_MAX,
  GATED_CALLS,
  INTERFACE_CARDS,
  INTERFACE_SEARCH_MAX,
  INTERFACE_SIDEBAR,
  INTERFACE_THEMES,
  INTERFACE_TOOLS,
  INTERFACE_TREE_MODES,
  INTERFACE_UNITS,
  MARKUPS_CAP,
  MARKUPS_PLACE_CAP,
  MARKUP_KINDS,
  MARKUP_OPS,
  MARKUP_PLACES,
  MARKUP_POINT_MAX,
  MAX_MODEL_KEYS,
  MAX_MODEL_KEY_CHARS,
  MAX_TOOL_IDS,
  PARITY_TOOL_NAMES,
  RECENT_NAME_MAX,
  REQUEST_ACTIONS,
  RULES,
  SCHEDULE_ALIGN_ENUM,
  SCHEDULE_CALCULATED_MAX,
  SCHEDULE_EXPORT_FORMATS,
  SCHEDULE_MANAGE_OPS,
  SCHEDULE_NAME_MAX,
  SCHEDULE_OP_ENUM,
  SCHEDULE_RESULT_ENUM,
  SCHEDULE_TOOL_NAMES,
  SPOT_SHOWS,
  STEP_COLORS,
  TOOLS,
  VIEWPOINTS_CAP,
  VIEW_DIRECTIONS,
  VIEW_FITS,
  VIEW_NAME_MAX,
  VIEW_OPS,
  VIEW_ZOOM_MAX,
  VIEW_ZOOM_MIN,
  apiTools,
  gateOf,
  isViewTool,
  toolByName,
  toolTimeoutMs,
  SLOW_TOOL_TIMEOUT_MS,
  TOOL_TIMEOUT_MS
} from '../../src/shared/tool-schemas'
import { HL } from '../../src/shared/colors'
import type { CardName, Theme, TreeMode, Units } from '../../src/renderer/state/shell'
import type { Tool } from '../../src/renderer/viewer/viewer-core'
import { TOOL_INPUTS, parseToolInput } from '../../src/renderer/ai/executors/inputs'
import { LEVEL_DEFAULT_OFFSET_MM } from '../../src/shared/sections'
import { OP_LABELS } from '../../src/schedule/schedule/compare'
import { EXPORT_FORMATS, MANAGE_NAME_MAX, MANAGE_OPS } from '../../src/schedule/messages'
import { MAX_FILTERS, MAX_SORT_LEVELS } from '../../src/schedule/schedule/def'
import { DECIMALS_MAX, DECIMALS_MIN } from '../../src/schedule/schedule/format'
import {
  SCHEDULE_ALIGNS,
  SCHEDULE_CALC_CAP,
  SCHEDULE_CATEGORY_CAP,
  SCHEDULE_COLUMN_CAP,
  SCHEDULE_FORMULA_CHARS,
  SCHEDULE_RESULTS,
  SCHEDULE_ROWS_CAP,
  SCHEDULE_ROWS_DEFAULT
} from '../../src/schedule/assistant'
import { BOX_PLACES } from '../../src/shared/annotate'

describe('the design’s fifteen tools', () => {
  it('are present, in the design’s own order', () => {
    expect(DESIGN_TOOL_NAMES).toEqual([
      'summarize_elements',
      'audit_model',
      'clash_check',
      'set_filter_stack',
      'manage_filters',
      'query_elements',
      'apply_visibility',
      'select_elements',
      'set_storeys',
      'activate_model',
      'set_view',
      'set_section',
      'toggle_display',
      'color_by_property',
      'color_models'
    ])
  })

  it('carry the design’s descriptions verbatim', () => {
    // Spot-checked against `SGVue.dc.html` line by line; these are the ones whose wording the
    // model actually steers on and which 2026-09-20 did **not** rewrite.
    expect(toolByName('set_filter_stack')!.description).toBe(
      'Set the WHOLE ordered filter stack in one call. This is the main tool for any view with more than one condition — the array order IS the apply order. Use it instead of several apply_visibility calls.'
    )
    expect(toolByName('summarize_elements')!.description).toBe(
      'Group the matching elements and total their quantities. Read-only. Renders as a table for the user, so keep your own reply to one sentence.'
    )
    expect(toolByName('color_by_property')!.description).toContain(
      'This is the tool for "colour each X" / "colour by Y"'
    )
  })

  /**
   * 2026-09-20, user-approved (`docs/AI_REVIEW.md` §5 / P5). Eight descriptions were rewritten
   * because the audit's own rubric for a tool description is precision, not brevity, and
   * `select_elements` was eight words. The design's *behaviour* is unchanged — a description
   * is sent to the model and never rendered — so what is asserted here is that each one still
   * says the thing the design's own sentence said, at man-page length.
   */
  it('give the eight under-described tools a fuller description, keeping what the design said', () => {
    const longer: Record<string, string> = {
      select_elements: 'Select the matching elements',
      set_storeys: 'Show only the named storeys',
      set_view: 'Move the camera to a named view',
      set_section: 'Cut a section at a gridline or level',
      toggle_display: 'Turn gridlines, levels, shadows or selection dimensions on or off',
      activate_model: 'Activate one model',
      audit_model: 'data-completeness audit',
      clash_check: 'Bounding-box interference candidates between two loaded models',
      query_elements: 'Count and sample the elements matching a rule list'
    }
    for (const [name, kept] of Object.entries(longer)) {
      const d = toolByName(name)!.description
      expect([name, d.includes(kept)]).toEqual([name, true])
      expect([name, d.split(/\s+/).length >= 40]).toEqual([name, true])
    }
    // The one fact `clash_check` must never lose.
    expect(toolByName('clash_check')!.description).toContain('candidates for review')
  })

  it('share one rule grammar, with the design’s five operators plus `absent`', () => {
    // 2026-09-20, user-approved: one operator the design does not have, because a missing
    // property matched only `!=` — which also matches every different value.
    expect(RULES.items!.properties!.op.enum).toEqual(['=', '!=', '~', '>', '<', 'absent'])
    // The model is told the phrase the user reads in the card, so the two agree in a reply.
    expect(RULES.items!.properties!.op.description).toContain('"is empty"')
    expect(RULES.items!.properties!.op.description).toContain('ignores val')
    expect(RULES.items!.properties!.join.enum).toEqual(['and', 'or'])
    expect(RULES.items!.required).toEqual(['prop', 'op', 'val'])
    expect(RULES.description).toBe('Rule list, ANDed unless a rule sets join:"or"')
  })

  it('offer the same id / selection target on every tool that can act on a found set', () => {
    for (const name of ['select_elements', 'apply_visibility', 'color_by_property']) {
      const props = toolByName(name)!.input_schema.properties
      expect([name, props.ids?.type]).toEqual([name, 'array'])
      expect([name, props.ids?.items?.type]).toEqual([name, 'number'])
      expect([name, props.selection?.type]).toEqual([name, 'boolean'])
      // Rules stay the preferred route, and the description has to say so.
      expect([name, /[Pp]refer rules/.test(toolByName(name)!.description)]).toEqual([name, true])
    }
    // `set_filter_stack` deliberately takes none: a step is rules, so that it can be saved,
    // shared and re-evaluated.
    expect(toolByName('set_filter_stack')!.input_schema.properties.ids).toBeUndefined()
  })

  it('use ONE combine enum on both tools that take one (plan §3.5 defect 3)', () => {
    const stack = toolByName('set_filter_stack')!.input_schema.properties.combine
    const one = toolByName('apply_visibility')!.input_schema.properties.combine
    expect(stack.enum).toEqual(['replace', 'append'])
    expect(one.enum).toEqual(['replace', 'append'])
    // The design spells the same value `add` on `apply_visibility`; its own description said
    // so, and the corrected description has to say `append` too or the prompt contradicts the
    // schema.
    expect(toolByName('apply_visibility')!.description).toContain('combine:"append"')
    expect(toolByName('apply_visibility')!.description).not.toContain('combine:"add"')
  })

  it('keep the design’s nullable types where it has them', () => {
    expect(toolByName('activate_model')!.input_schema.properties.key.type).toEqual([
      'string',
      'null'
    ])
    expect(toolByName('color_by_property')!.input_schema.properties.property.type).toEqual([
      'string',
      'null'
    ])
    expect(toolByName('set_section')!.input_schema.properties.kind.enum).toEqual([
      'grid',
      'level',
      null
    ])
  })

  /**
   * 2026-10-01, owner-requested: the gridline cut and the level cut are two independent planes.
   * The tool keeps the design's four inputs; what changed is what a `kind` means, and the
   * description is the only place the model can learn it. The same day, the owner again —
   * *"assistant should possess everything user can do on the app"* — it gained `cut`, and its
   * defaults became the Section card's own.
   */
  it('set_section keeps its four inputs, gains `cut`, and says what each one means', () => {
    const tool = toolByName('set_section')!
    expect(Object.keys(tool.input_schema.properties)).toEqual(['kind', 'name', 'offset', 'flip', 'cut'])
    expect(tool.input_schema.properties.cut).toMatchObject({ type: 'boolean' })
    expect(tool.input_schema.required).toEqual(['kind'])
    expect(tool.input_schema.additionalProperties).toBe(false)
    expect(tool.strict).toBe(true)
    expect(tool.kind).toBe('view')
    const d = tool.description
    // A new plane cuts, and what it leaves out is the card's default — the number is the chip's
    // own constant.
    expect(d).toContain(
      `A new plane cuts, and uses the card’s defaults for what is omitted: offset 0 for a gridline (on the gridline itself) and ${LEVEL_DEFAULT_OFFSET_MM} for a level (above the storey), not flipped.`
    )
    expect(d).toContain('1200 for a level')
    expect(d).toContain('cut:false shows the plane as a preview without cutting and cut:true cuts')
    // One rule for a plane already set: only what is passed changes — `cut` included.
    expect(d).toContain('send the same kind and name again with only what should change')
    expect(d).toContain(
      'an omitted offset, flip or cut keeps the plane’s current state, and the call never clears it'
    )
    // The exception the first version of this description had is gone with the rule it described.
    expect(d).not.toContain('omitted or true cuts')
    expect(d).not.toContain('pass cut:false again')
    expect(d).toContain('The result says whether the plane cuts or is previewed')
    // The zod side takes the same input, and nothing else.
    expect(parseToolInput('set_section', { kind: 'grid', name: 'C', cut: false })).toEqual({
      kind: 'grid',
      name: 'C',
      cut: false
    })
    expect(() => parseToolInput('set_section', { kind: 'grid', name: 'C', cut: 1 })).toThrow(/set_section: cut/)
    // One plane at a time, the other left alone …
    expect(d).toContain('two independent planes and both can be on at once')
    expect(d).toContain('kind:"grid" sets the gridline cut and leaves the level cut alone')
    expect(d).toContain('kind:"level" sets the level cut and leaves the gridline cut alone')
    // … null for both, a kind with no name for just that one …
    expect(d).toContain('Pass kind:null to clear both')
    expect(d).toContain('pass a kind with name:"" or no name to clear just that cut')
    // … and the design's own sentence about a wrong name, kept.
    expect(d).toContain('a wrong one changes nothing and returns the valid list')
    expect(d).toContain('"grid C + level L2"')
  })
})

describe('strict mode', () => {
  it('is on for every tool but the one free-form map', () => {
    const notStrict = TOOLS.filter((t) => !t.strict).map((t) => t.name)
    expect(notStrict).toEqual(['color_models'])
  })

  it('gives every strict tool additionalProperties:false at the top level', () => {
    for (const tool of TOOLS) {
      if (!tool.strict) continue
      expect([tool.name, tool.input_schema.additionalProperties]).toEqual([tool.name, false])
    }
  })

  it('leaves color_models open, because a strict empty object rejects every key it carries', () => {
    const schema = toolByName('color_models')!.input_schema
    expect(schema.additionalProperties).toBeUndefined()
    expect(schema.properties.map.type).toBe('object')
  })

  it('keeps optional fields optional — Anthropic strict preserves `required` as given', () => {
    // `summarize_elements` requires only `groupBy`; `rules` stays optional, which is the
    // design's own schema. (Checked against the SDK's own strict transform, which copies
    // `required` through untouched rather than expanding it to every property.)
    expect(toolByName('summarize_elements')!.input_schema.required).toEqual(['groupBy'])
    expect(
      Object.keys(toolByName('summarize_elements')!.input_schema.properties).sort()
    ).toEqual(['groupBy', 'rules'])
  })
})

describe('the read-only additions', () => {
  it('are the plan’s ten plus find_nearby and find_properties, and every one is a read tool', () => {
    // 2026-10-02, adjusted on purpose: the catalogue has a fourth group now — the two view
    // tools of the parity work (`PARITY_TOOL_NAMES`, asserted in their own block below) — so
    // "everything that is neither the design's nor the Schedules window's" is no longer the
    // read-only additions alone. What this asserts is unchanged: these twelve, all `read`.
    const extra = TOOLS.filter(
      (t) =>
        !DESIGN_TOOL_NAMES.includes(t.name) &&
        !SCHEDULE_TOOL_NAMES.includes(t.name) &&
        !PARITY_TOOL_NAMES.includes(t.name)
    )
    expect(extra.map((t) => t.name)).toEqual([
      'get_element',
      'get_entity_raw',
      'list_values',
      // 2026-09-28 — the owner: "it never check the shared parameters Includes As GFA".
      'find_properties',
      'search',
      'get_spatial_tree',
      'get_relationships',
      'get_model_info',
      'get_view_state',
      'measure_between',
      // 2026-09-20 — `docs/AI_REVIEW.md` §9 gap 7. Box arithmetic, and it says so.
      'find_nearby',
      'query_sql'
    ])
    expect(extra.every((t) => t.kind === 'read')).toBe(true)
  })

  it('make find_nearby state its method as plainly as measure_between does', () => {
    const d = toolByName('find_nearby')!.description
    expect(d).toContain('not solid geometry')
    expect(d).toContain('IfcSpace')
    expect(d).toContain('metres')
  })

  it('make find_properties search names, scoped by the one rule grammar, capped at 50', () => {
    const t = toolByName('find_properties')!
    expect(t.kind).toBe('read')
    expect(t.strict).toBe(true)
    expect(t.input_schema.required).toEqual(['text'])
    expect(Object.keys(t.input_schema.properties).sort()).toEqual(['limit', 'rules', 'text'])
    // The same rule grammar every filtering tool shares, not a copy of it.
    expect(t.input_schema.properties.rules).toBe(RULES)
    expect(t.input_schema.properties.limit.description).toContain('1–50')
    expect(t.description).toContain('Includes As GFA')
    expect(t.description).toContain('Read-only.')
  })

  it('classifies the design’s tools as read or view the way the design uses them', () => {
    expect(isViewTool('apply_visibility')).toBe(true)
    expect(isViewTool('set_filter_stack')).toBe(true)
    expect(isViewTool('color_by_property')).toBe(true)
    expect(isViewTool('query_elements')).toBe(false)
    expect(isViewTool('clash_check')).toBe(false)
  })
})

describe('the wire form', () => {
  it('is sorted by name, so the cached prefix is byte-stable', () => {
    const names = apiTools().map((t) => t.name)
    expect(names).toEqual([...names].sort())
    expect(JSON.stringify(apiTools())).toBe(JSON.stringify(apiTools()))
  })

  it('drops `strict` from every tool when the gateway falls back', () => {
    expect(apiTools().some((t) => t.strict)).toBe(true)
    expect(apiTools({ strict: false }).some((t) => t.strict)).toBe(false)
    // …and the names and schemas are otherwise unchanged.
    expect(apiTools({ strict: false }).map((t) => t.name)).toEqual(apiTools().map((t) => t.name))
  })

  it('gives the two slow tools a longer budget than the rest', () => {
    expect(toolTimeoutMs('query_sql')).toBe(SLOW_TOOL_TIMEOUT_MS)
    expect(toolTimeoutMs('clash_check')).toBe(SLOW_TOOL_TIMEOUT_MS)
    expect(toolTimeoutMs('query_elements')).toBe(TOOL_TIMEOUT_MS)
  })
})

describe('argument validation', () => {
  it('declares exactly the properties the JSON schema declares, for every tool', () => {
    for (const tool of TOOLS) {
      const zodKeys = Object.keys(TOOL_INPUTS[tool.name as keyof typeof TOOL_INPUTS].shape).sort()
      expect([tool.name, zodKeys]).toEqual([
        tool.name,
        Object.keys(tool.input_schema.properties).sort()
      ])
    }
  })

  it('refuses arguments the schema does not allow, with a sentence naming the field', () => {
    expect(() => parseToolInput('measure_between', { a: 1 })).toThrow(/measure_between: b/)
    expect(() => parseToolInput('set_storeys', { visible: 'L2' })).toThrow(/set_storeys: visible/)
    expect(() => parseToolInput('nope', {})).toThrow(/No tool named "nope"/)
  })

  it('accepts a rule whose value arrives as a number, which `matchFn` stringifies anyway', () => {
    const parsed = parseToolInput('query_elements', {
      rules: [{ prop: 'FireRating', op: '>', val: 60 }]
    })
    expect(parsed.rules).toEqual([{ prop: 'FireRating', op: '>', val: 60 }])
  })
})

/* ══════════════════════════ 2026-09-20 — eager input streaming ══════════════════════════ */

describe('eager input streaming', () => {
  it('is set on every strict tool, and on no other', () => {
    const tools = apiTools()
    const eager = tools.filter((t) => t.eager_input_streaming).map((t) => t.name)
    const strict = TOOLS.filter((t) => t.strict).map((t) => t.name).sort()
    expect(eager.sort()).toEqual(strict)
    expect(eager).toHaveLength(TOOLS.length - 1)
    // `color_models` carries a free-form map: it is neither strict nor eager.
    expect(eager).not.toContain('color_models')
    expect(tools.find((t) => t.name === 'color_models')).not.toHaveProperty(
      'eager_input_streaming'
    )
  })

  it('survives the strict-schema fallback, which is about schemas and not about streaming', () => {
    const relaxed = apiTools({ strict: false })
    expect(relaxed.every((t) => !t.strict)).toBe(true)
    expect(relaxed.filter((t) => t.eager_input_streaming)).toHaveLength(TOOLS.length - 1)
  })

  it('is a field the installed SDK accepts on a tool definition', () => {
    // A compile-time check, not a runtime one: if `BetaTool` ever stops declaring the field
    // this assignment stops type-checking, which is the point. No cast.
    const tool: Anthropic.Beta.BetaTool = {
      name: 'query_elements',
      input_schema: { type: 'object', properties: {} },
      eager_input_streaming: true
    }
    expect(tool.eager_input_streaming).toBe(true)
  })

  it('leaves the client-side zod validation authoritative', () => {
    // Eager streaming hands input validation to this side. A truncated or wrong-typed input
    // must still be refused here, with a sentence the model can act on.
    expect(() => parseToolInput('measure_between', { a: 1, b: 'two' })).toThrow(
      /measure_between: b/
    )
    expect(() => parseToolInput('get_spatial_tree', { depth: 'deep' })).toThrow(
      /get_spatial_tree: depth/
    )
  })
})

/* ────────────────────────────── the Schedules window (2026-09-28) ────────────────────────────── */

describe('the Schedules window’s tools', () => {
  const make = toolByName('make_schedule')!
  const get = toolByName('get_schedule')!
  const exp = toolByName('export_schedule')!
  const colour = toolByName('color_by_schedule_column')!

  it('are last in the catalogue: make_schedule, get_schedule, then export_schedule and color_by_schedule_column, all strict', () => {
    const names = ['make_schedule', 'get_schedule', 'export_schedule', 'color_by_schedule_column']
    expect(SCHEDULE_TOOL_NAMES).toEqual(names)
    expect(TOOLS.slice(-4).map((t) => t.name)).toEqual(names)
    expect([make.kind, get.kind, exp.kind, colour.kind]).toEqual(['view', 'read', 'view', 'view'])
    expect([make.strict, get.strict, exp.strict, colour.strict]).toEqual([true, true, true, true])
  })

  it('export_schedule takes one of the Export menu’s four entries and nothing else (2026-09-28)', () => {
    expect([...SCHEDULE_EXPORT_FORMATS]).toEqual([...EXPORT_FORMATS])
    expect(exp.input_schema.properties.format.enum).toEqual(SCHEDULE_EXPORT_FORMATS)
    expect(exp.input_schema.required).toEqual(['format'])
    for (const format of SCHEDULE_EXPORT_FORMATS) expect(parseToolInput('export_schedule', { format })).toEqual({ format })
    expect(() => parseToolInput('export_schedule', { format: 'pdf' })).toThrow(/export_schedule: format/)
    expect(() => parseToolInput('export_schedule', {})).toThrow(/export_schedule: format/)
    // An extra key is dropped, never passed on: the executor sees the format alone.
    expect(parseToolInput('export_schedule', { format: 'csv', path: 'C:/x.csv' })).toEqual({ format: 'csv' })
    expect(exp.description).toContain('only opens the native Save dialog')
    expect(exp.description).toContain('never say that one was')
  })

  it('color_by_schedule_column takes a column or null (2026-09-28)', () => {
    expect(colour.input_schema.properties.column.type).toEqual(['string', 'null'])
    expect(colour.input_schema.required).toEqual(['column'])
    expect(parseToolInput('color_by_schedule_column', { column: null })).toEqual({ column: null })
    expect(parseToolInput('color_by_schedule_column', { column: 'Fire Rating' })).toEqual({ column: 'Fire Rating' })
    expect(() => parseToolInput('color_by_schedule_column', { column: '' })).toThrow(/color_by_schedule_column: column/)
    expect(() => parseToolInput('color_by_schedule_column', { column: 'x'.repeat(201) })).toThrow(/color_by_schedule_column: column/)
    expect(colour.description).toContain('"Colour 3D by this column"')
    expect(colour.description).toContain('use color_by_property when no schedule is involved')
    expect(colour.description).toContain('more than 100 distinct values')
  })

  it('take the shape the task names, every nested object closed', () => {
    // `calculated`, `filterLogic` and `itemize` are phase 4's (2026-10-02; their own block is last).
    expect(Object.keys(make.input_schema.properties).sort()).toEqual([
      'base',
      'calculated',
      'category',
      'columns',
      'filterLogic',
      'filters',
      'grandTotals',
      'groupBy',
      'itemize',
      'removeColumns',
      'sortBy',
      'title'
    ])
    expect(make.input_schema.required).toBeUndefined()
    const items = (k: string) => make.input_schema.properties[k].items!
    for (const k of ['columns', 'filters', 'sortBy']) {
      expect([k, items(k).additionalProperties]).toEqual([k, false])
      expect([k, items(k).required?.[0]]).toEqual([k, 'field'])
    }
    expect(Object.keys(get.input_schema.properties).sort()).toEqual(['limit', 'offset'])
  })

  it('offer exactly the engine’s thirteen filter operators', () => {
    expect([...SCHEDULE_OP_ENUM]).toEqual(Object.keys(OP_LABELS))
    expect(make.input_schema.properties.filters.items!.properties!.op.enum).toEqual(SCHEDULE_OP_ENUM)
  })

  it('state their bounds in words, since strict schemas carry no maxItems — and zod enforces them', () => {
    // Anthropic strict tool use does not support array or string length keywords, so a schema
    // that carried one would be refused and cost every tool its strictness (`gateway.ts`).
    expect(JSON.stringify(make.input_schema)).not.toMatch(/"(maxItems|minItems|maxLength|minLength)"/)
    expect(make.description).toContain(`At most ${SCHEDULE_COLUMN_CAP} columns, ${MAX_FILTERS} filters, and ${MAX_SORT_LEVELS} sort and group fields`)
    expect(make.input_schema.properties.category.description).toContain(`at most ${SCHEDULE_CATEGORY_CAP}`)
    expect(get.input_schema.properties.limit.description).toContain(`1–${SCHEDULE_ROWS_CAP}. Default ${SCHEDULE_ROWS_DEFAULT}`)

    const col = { field: 'Name' }
    expect(() => parseToolInput('make_schedule', { columns: Array(SCHEDULE_COLUMN_CAP).fill(col) })).not.toThrow()
    expect(() => parseToolInput('make_schedule', { columns: Array(SCHEDULE_COLUMN_CAP + 1).fill(col) })).toThrow(
      /make_schedule: columns/
    )
    const f = { field: 'Level', op: 'hasValue' }
    expect(() => parseToolInput('make_schedule', { filters: Array(MAX_FILTERS + 1).fill(f) })).toThrow(
      /make_schedule: filters/
    )
    expect(() => parseToolInput('make_schedule', { groupBy: Array(MAX_SORT_LEVELS + 1).fill('Level') })).toThrow(
      /make_schedule: groupBy/
    )
    expect(() => parseToolInput('make_schedule', { category: Array(SCHEDULE_CATEGORY_CAP + 1).fill('IfcDoor') })).toThrow(
      /make_schedule: category/
    )
    expect(() => parseToolInput('make_schedule', { title: 'x'.repeat(201) })).toThrow(/make_schedule: title/)
    expect(() => parseToolInput('make_schedule', { filters: [{ field: 'Level', op: 'like' }] })).toThrow(
      /make_schedule: filters/
    )
    expect(() => parseToolInput('make_schedule', { columns: [{ field: '' }] })).toThrow(/make_schedule: columns/)
  })

  it('say what they are for, and that the model is never changed', () => {
    expect(make.description).toContain('never the model')
    expect(make.description).toContain('base:"open"')
    expect(make.description).toContain('900 mm is 0.9')
    expect(get.description).toContain('"this schedule"')
    expect(get.description).toContain('Read-only.')
  })
})

/* ──────────────────── parity with the user, phase 1 (2026-10-02) ──────────────────── */

/**
 * The owner, 2026-10-01: *"assistant should possess everything user can do on the app."* Phase 1
 * is the reversible view state: three more switches, the selection's other modes, undo and
 * redo, the model eye, one model's colour reset and the app's own settings — plus the two new
 * tools that carry what no existing tool could.
 */
describe('parity with the user — phase 1', () => {
  const models = toolByName('set_models')!
  const ui = toolByName('set_interface')!

  /** `true` only when the two unions are the same set of strings. Checked by `tsc`. */
  type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

  it('adds two view tools, in a group of their own before the Schedules window’s', () => {
    // Phase 2 put two more in the same group, after these two, and phases 3 and 4 one more
    // each (their own blocks are below).
    expect(PARITY_TOOL_NAMES.slice(0, 2)).toEqual(['set_models', 'set_interface'])
    expect(TOOLS.slice(-10, -8).map((t) => t.name)).toEqual(['set_models', 'set_interface'])
    expect([models.kind, ui.kind]).toEqual(['view', 'view'])
    expect([models.strict, ui.strict]).toEqual([true, true])
    expect(TOOLS).toHaveLength(37)
    // Neither name says anything a guard forbids, and neither takes a path.
    expect(isViewTool('set_models')).toBe(true)
    expect(isViewTool('set_interface')).toBe(true)
  })

  it('set_models takes the keys to leave showing, bounded in words and in zod', () => {
    expect(Object.keys(models.input_schema.properties)).toEqual(['visible'])
    expect(models.input_schema.required).toEqual(['visible'])
    expect(models.input_schema.properties.visible).toMatchObject({ type: 'array', items: { type: 'string' } })
    expect(models.input_schema.properties.visible.description).toContain(`at most ${MAX_MODEL_KEYS}`)
    expect(parseToolInput('set_models', { visible: [] })).toEqual({ visible: [] })
    expect(parseToolInput('set_models', { visible: ['ARC', 'STR'] })).toEqual({ visible: ['ARC', 'STR'] })
    expect(() => parseToolInput('set_models', {})).toThrow(/set_models: visible/)
    expect(() => parseToolInput('set_models', { visible: 'ARC' })).toThrow(/set_models: visible/)
    expect(() => parseToolInput('set_models', { visible: Array(MAX_MODEL_KEYS + 1).fill('ARC') })).toThrow(
      new RegExp(`set_models: visible — at most ${MAX_MODEL_KEYS} model keys`)
    )
    expect(() => parseToolInput('set_models', { visible: ['x'.repeat(MAX_MODEL_KEY_CHARS + 1)] })).toThrow(
      /set_models: visible/
    )
    const d = models.description
    for (const said of [
      'Show only the named models, or all of them when the list is empty',
      'a wrong one changes nothing and returns the valid keys',
      'a change that would leave nothing visible is refused',
      'under 5 %',
      'use activate_model instead'
    ]) {
      expect([said, d.includes(said)]).toEqual([said, true])
    }
  })

  it('set_interface takes any subset of eight settings, each one of the store’s own values', () => {
    expect(Object.keys(ui.input_schema.properties)).toEqual([
      'theme',
      'units',
      'treeMode',
      'sidebar',
      'card',
      'tool',
      'search',
      'schedulesWindow'
    ])
    expect(ui.input_schema.required).toBeUndefined()
    const p = ui.input_schema.properties
    expect(p.theme.enum).toEqual(['dark', 'light'])
    // 2026-10-09: feet and inches, the Markups card's third unit.
    expect(p.units.enum).toEqual(['mm', 'm', 'ft'])
    expect(p.treeMode.enum).toEqual(['entity', 'type'])
    expect(p.sidebar.enum).toEqual(['open', 'collapsed'])
    expect(p.card.enum).toEqual(['project', 'section', 'filter', 'coords', 'views', 'measure', 'none'])
    expect(p.tool.enum).toEqual(['select', 'measure', 'spot'])
    expect(p.schedulesWindow.enum).toEqual(['open'])
    expect(p.search.type).toBe('string')
    expect(p.search.description).toContain(`at most ${INTERFACE_SEARCH_MAX} characters`)

    // The lists are the store's own unions — a card or a tool the app gains fails `tsc` here.
    const same: [
      Same<(typeof INTERFACE_THEMES)[number], Theme>,
      Same<(typeof INTERFACE_UNITS)[number], Units>,
      Same<(typeof INTERFACE_TREE_MODES)[number], TreeMode>,
      Same<Exclude<(typeof INTERFACE_CARDS)[number], 'none'>, CardName>,
      Same<(typeof INTERFACE_TOOLS)[number], Tool>
    ] = [true, true, true, true, true]
    expect(same).toEqual([true, true, true, true, true])
    expect([...INTERFACE_SIDEBAR]).toEqual(['open', 'collapsed'])
  })

  it('set_interface refuses a value that is not one of them, and a search that is too long', () => {
    expect(parseToolInput('set_interface', {})).toEqual({})
    expect(parseToolInput('set_interface', { theme: 'light', tool: 'measure', search: '' })).toEqual({
      theme: 'light',
      tool: 'measure',
      search: ''
    })
    expect(() => parseToolInput('set_interface', { theme: 'sepia' })).toThrow(/set_interface: theme/)
    expect(() => parseToolInput('set_interface', { card: 'chat' })).toThrow(/set_interface: card/)
    expect(() => parseToolInput('set_interface', { tool: 'erase' })).toThrow(/set_interface: tool/)
    expect(() => parseToolInput('set_interface', { sidebar: true })).toThrow(/set_interface: sidebar/)
    expect(() => parseToolInput('set_interface', { schedulesWindow: 'closed' })).toThrow(
      /set_interface: schedulesWindow/
    )
    expect(() => parseToolInput('set_interface', { search: 'x'.repeat(INTERFACE_SEARCH_MAX + 1) })).toThrow(
      new RegExp(`set_interface: search — at most ${INTERFACE_SEARCH_MAX} characters`)
    )
    expect(parseToolInput('set_interface', { search: 'x'.repeat(INTERFACE_SEARCH_MAX) }).search).toHaveLength(
      INTERFACE_SEARCH_MAX
    )
  })

  it('set_interface says it is for when the user asks, and never the model', () => {
    const d = ui.description
    for (const said of [
      'never what is in the model, and never which elements are visible',
      'Use it only when the user asks for one of these settings',
      'which the user then places by clicking',
      'An omitted setting is left alone, one already as asked is reported without changing',
      'the result reads all of them back'
    ]) {
      expect([said, d.includes(said)]).toEqual([said, true])
    }
  })

  it('toggle_display gains the canvas grid, snap and original materials', () => {
    const tool = toolByName('toggle_display')!
    const props = tool.input_schema.properties
    expect(Object.keys(props)).toEqual([
      'grids',
      'levels',
      'shadows',
      'dims',
      'groundGrid',
      'snap',
      'originalMaterials'
    ])
    for (const [k, v] of Object.entries(props)) expect([k, v.type]).toEqual([k, 'boolean'])
    const d = tool.description
    // The design's sentence opens it, and the canvas grid is told apart from the IFC gridlines.
    expect(d.startsWith('Turn gridlines, levels, shadows or selection dimensions on or off')).toBe(true)
    expect(d).toContain('the canvas grid under the model (groundGrid; the IFC gridlines are grids)')
    expect(d).toContain('(snap)')
    expect(d).toContain('(originalMaterials;')
    expect(d).toContain('a switch already in the asked-for state is reported without changing')
    expect(d).toContain('the other three only when the user asks for them')
    expect(parseToolInput('toggle_display', { groundGrid: false, snap: true, originalMaterials: false })).toEqual({
      groundGrid: false,
      snap: true,
      originalMaterials: false
    })
    expect(() => parseToolInput('toggle_display', { snap: 'off' })).toThrow(/toggle_display: snap/)
  })

  it('select_elements gains a mode, and apply_visibility gains undo and redo', () => {
    const select = toolByName('select_elements')!
    expect(select.input_schema.properties.mode.enum).toEqual(['replace', 'add', 'remove', 'clear'])
    expect(select.input_schema.required).toBeUndefined()
    expect(select.description).toContain('clear deselects everything and needs no set')
    expect(parseToolInput('select_elements', { mode: 'clear' })).toEqual({ mode: 'clear' })
    expect(() => parseToolInput('select_elements', { mode: 'toggle' })).toThrow(/select_elements: mode/)

    const vis = toolByName('apply_visibility')!
    expect(vis.input_schema.properties.action.enum).toEqual([
      'isolate',
      'hide',
      'highlight',
      'show',
      'reset',
      'undo',
      'redo'
    ])
    expect(vis.description).toContain('action:"undo" steps what is visible back one change')
    expect(vis.description).toContain('change nothing when there is nothing to step to')
    // Phase 3's wording: a step the guard catches waits for the user's Apply — the pending row
    // holds an action now. (Phase 2 said "are not taken when it would refuse", which was true
    // while that row could only hold a patch.)
    expect(vis.description).toContain(
      'run the same scope guard: a step that would take elements out of view and leave nothing visible, or under 5 %, is not taken until the user clicks Apply under your reply'
    )
    expect(vis.description).not.toContain('are not taken when it would refuse')
    // …and the filter operations that can hide say that they are held, which they are.
    expect(toolByName('manage_filters')!.description).toContain(
      'enable, update and apply_set are held to the same scope guard as apply_visibility'
    )
    expect(parseToolInput('apply_visibility', { action: 'redo' })).toEqual({ action: 'redo' })
    // The design's own opening sentence, and the corrected enum word, are still there.
    expect(vis.description.startsWith('ONE filter step, or reset.')).toBe(true)
    expect(vis.description).toContain('combine:"append"')
  })

  it('color_models takes null for one key, and activate_model says the active key stays', () => {
    expect(parseToolInput('color_models', { map: { ARC: '#E05A6B', STR: null } })).toEqual({
      map: { ARC: '#E05A6B', STR: null }
    })
    expect(() => parseToolInput('color_models', { map: { ARC: 5 } })).toThrow(/color_models: map/)
    expect(toolByName('color_models')!.description).toContain('a null value clears that one model’s override')
    expect(toolByName('color_models')!.description).toContain('pass an empty map to clear every override')
    expect(toolByName('activate_model')!.description).toContain('the key that is already active stays active')
  })

  it('get_view_state says what it reads back', () => {
    const d = toolByName('get_view_state')!.description
    for (const said of ['(display)', '(sectionPlanes)', '(history)', '(models)', 'the interface', 'Read-only.']) {
      expect([said, d.includes(said)]).toEqual([said, true])
    }
    expect(Object.keys(toolByName('get_view_state')!.input_schema.properties)).toEqual([])
  })

  it('carries no length keyword in any schema — strict tool use refuses them', () => {
    for (const tool of TOOLS) {
      expect([tool.name, /"(maxItems|minItems|maxLength|minLength)"/.test(JSON.stringify(tool.input_schema))]).toEqual([
        tool.name,
        false
      ])
    }
  })
})

/* ──────────────────── parity with the user, phase 2 (2026-10-02) ──────────────────── */

/**
 * The camera, saved viewpoints, markups, and one filter step changed in place. Two more view
 * tools in the parity group; `set_view`, `manage_filters` and `set_filter_stack` extended. No
 * tool here deletes anything, places a markup, or reaches outside the view.
 */
describe('parity with the user — phase 2', () => {
  const view = toolByName('set_view')!
  const filters = toolByName('manage_filters')!
  const views = toolByName('manage_views')!
  const markups = toolByName('manage_markups')!

  it('adds manage_views and manage_markups to the parity group, strict, as view tools', () => {
    expect(PARITY_TOOL_NAMES.slice(0, 4)).toEqual(['set_models', 'set_interface', 'manage_views', 'manage_markups'])
    expect(TOOLS.slice(-10, -4).map((t) => t.name)).toEqual([...PARITY_TOOL_NAMES])
    expect([views.kind, markups.kind]).toEqual(['view', 'view'])
    expect([views.strict, markups.strict]).toEqual([true, true])
    expect(TOOLS).toHaveLength(37)
    // Phase 3 added `delete` and `clear` — which only ask (their own block is below) — and
    // phase 4 the two that place a markup and the one that sets a spot tag (theirs is last).
    // No other word that removes anything is offered, in either.
    expect([...VIEW_OPS]).toEqual(['list', 'save', 'restore', 'rename', 'delete'])
    expect([...MARKUP_OPS]).toEqual(['list', 'focus', 'place_spot', 'place_measure', 'show', 'delete', 'clear'])
    expect(views.input_schema.properties.op.enum).toEqual(VIEW_OPS)
    expect(markups.input_schema.properties.op.enum).toEqual(MARKUP_OPS)
    for (const op of ['remove', 'drop', 'place', 'add']) {
      expect([op, ([...VIEW_OPS, ...MARKUP_OPS] as string[]).includes(op)]).toEqual([op, false])
    }
  })

  it('set_view keeps the design’s two inputs and gains fit, azimuth, elevation and zoom', () => {
    expect(Object.keys(view.input_schema.properties)).toEqual([
      'view',
      'projection',
      'fit',
      'azimuth',
      'elevation',
      'zoom'
    ])
    expect(view.input_schema.required).toBeUndefined()
    const p = view.input_schema.properties
    expect(p.view.enum).toEqual(['iso', 'top', 'north', 'south', 'east', 'west'])
    expect(p.projection.enum).toEqual(['persp', 'ortho'])
    expect(p.fit.enum).toEqual(VIEW_FITS)
    expect([...VIEW_FITS]).toEqual(['extents', 'selection'])
    for (const k of ['azimuth', 'elevation', 'zoom']) expect([k, p[k].type]).toEqual([k, 'number'])
    // A strict schema carries no numeric keyword either: the bounds are in words, and in zod.
    expect(JSON.stringify(view.input_schema)).not.toMatch(/"(minimum|maximum|exclusiveMinimum|exclusiveMaximum|multipleOf)"/)
    expect(p.zoom.description).toContain(`${VIEW_ZOOM_MIN}–${VIEW_ZOOM_MAX}`)
    expect([VIEW_ZOOM_MIN, VIEW_ZOOM_MAX]).toEqual([0.1, 20])
  })

  it('set_view says what an angle is, against which frame, and what each named view is in those terms', () => {
    const d = view.description
    // The design's own four sentences still open it.
    expect(d.startsWith('Move the camera to a named view and/or change projection.')).toBe(true)
    expect(d).toContain('Either argument may be given alone.')
    for (const said of [
      'in degrees in the model’s project frame',
      'azimuth is the compass bearing the camera looks towards, clockwise from project north',
      '0 looks north, 90 east, 180 south, 270 west',
      'project north is the model’s own +Y, not true north',
      'elevation is how far it looks down from level: 0 level, 90 straight down, −90 straight up',
      'Either angle may be given alone and the other stays',
      'about what it is looking at, at its present distance',
      'fit frames without turning',
      'which is what a click on the view cube does',
      '2 is twice as close, 0.5 half',
      'fits the building when fit is omitted',
      'A named view together with azimuth or elevation is refused'
    ]) {
      expect([said, d.includes(said)]).toEqual([said, true])
    }
    // The table the description quotes is the constant, entry for entry.
    expect(d).toContain(
      'In these terms view:"south" is 0 / 0, view:"west" is 90 / 0, view:"north" is 180 / 0, view:"east" is 270 / 0, view:"top" is 0 / 90, view:"iso" is 315 / 29.8.'
    )
    // …and covers exactly the six views the tool can be asked for by name.
    expect(Object.keys(VIEW_DIRECTIONS).sort()).toEqual(
      [...(view.input_schema.properties.view.enum as string[])].sort()
    )
  })

  it('set_view refuses a number out of range, in a sentence naming the field', () => {
    expect(parseToolInput('set_view', { azimuth: 45, elevation: 30, zoom: 2, fit: 'selection' })).toEqual({
      azimuth: 45,
      elevation: 30,
      zoom: 2,
      fit: 'selection'
    })
    expect(parseToolInput('set_view', { azimuth: -360 })).toEqual({ azimuth: -360 })
    expect(parseToolInput('set_view', { elevation: -90 })).toEqual({ elevation: -90 })
    expect(() => parseToolInput('set_view', { azimuth: 361 })).toThrow(/set_view: azimuth — between -360 and 360 degrees/)
    expect(() => parseToolInput('set_view', { elevation: 91 })).toThrow(/set_view: elevation — between -90 and 90 degrees/)
    expect(() => parseToolInput('set_view', { zoom: 0 })).toThrow(/set_view: zoom — between 0.1 and 20/)
    expect(() => parseToolInput('set_view', { zoom: 21 })).toThrow(/set_view: zoom/)
    expect(() => parseToolInput('set_view', { zoom: Number.POSITIVE_INFINITY })).toThrow(/set_view: zoom/)
    expect(() => parseToolInput('set_view', { azimuth: Number.NaN })).toThrow(/set_view: azimuth/)
    expect(() => parseToolInput('set_view', { azimuth: '45' })).toThrow(/set_view: azimuth/)
    expect(() => parseToolInput('set_view', { fit: 'all' })).toThrow(/set_view: fit/)
  })

  it('manage_filters gains update, with a step’s action, rules and one of the card’s six colours', () => {
    expect(filters.input_schema.properties.op.enum).toEqual([
      'list',
      'enable',
      'disable',
      'move',
      'remove',
      'clear',
      'update',
      'save_set',
      'apply_set',
      'delete_set',
      'list_sets'
    ])
    expect(Object.keys(filters.input_schema.properties)).toEqual(['op', 'step', 'to', 'name', 'action', 'rules', 'color'])
    expect(filters.input_schema.required).toEqual(['op'])
    const p = filters.input_schema.properties
    expect(p.action.enum).toEqual(['isolate', 'hide', 'highlight'])
    // The one rule grammar, not a copy of it.
    expect(p.rules).toBe(RULES)
    // The Filter card's swatches, and nothing else: the user cannot pick another colour.
    expect([...STEP_COLORS]).toEqual([...HL])
    expect(p.color.enum).toEqual(STEP_COLORS)
    expect(STEP_COLORS).toHaveLength(6)
    const d = filters.description
    for (const said of [
      'update changes one step where it stands',
      'its action, its rules (which replace the step’s list) or its highlight color',
      'which are switched off',
      'use it rather than rebuilding the stack when one step is to change'
    ]) {
      expect([said, d.includes(said)]).toEqual([said, true])
    }
    expect(parseToolInput('manage_filters', { op: 'update', step: 2, color: '#E05A6B', action: 'highlight' })).toEqual({
      op: 'update',
      step: 2,
      color: '#E05A6B',
      action: 'highlight'
    })
    expect(() => parseToolInput('manage_filters', { op: 'update', step: 1, color: '#123456' })).toThrow(/manage_filters: color/)
    expect(() => parseToolInput('manage_filters', { op: 'update', step: 1, action: 'show' })).toThrow(/manage_filters: action/)
    expect(() => parseToolInput('manage_filters', { op: 'update', step: 1, rules: 'walls' })).toThrow(/manage_filters: rules/)
  })

  it('set_filter_stack takes a colour per step, and its description is still the design’s', () => {
    const tool = toolByName('set_filter_stack')!
    const item = tool.input_schema.properties.steps.items!
    expect(Object.keys(item.properties!)).toEqual(['action', 'rules', 'color'])
    expect(item.properties!.color.enum).toEqual(STEP_COLORS)
    // Optional: the design's two stay the required ones.
    expect(item.required).toEqual(['action', 'rules'])
    expect(item.additionalProperties).toBe(false)
    const rules = [{ prop: 'IfcEntity', op: '=', val: 'IfcDoor' }]
    expect(parseToolInput('set_filter_stack', { steps: [{ action: 'highlight', rules, color: '#E8A33D' }] })).toEqual({
      steps: [{ action: 'highlight', rules, color: '#E8A33D' }]
    })
    expect(() => parseToolInput('set_filter_stack', { steps: [{ action: 'highlight', rules, color: 'orange' }] })).toThrow(
      /set_filter_stack: steps/
    )
  })

  it('manage_views names a viewpoint by name or number, and bounds every text it takes', () => {
    expect(Object.keys(views.input_schema.properties)).toEqual(['op', 'name', 'number', 'to'])
    expect(views.input_schema.required).toEqual(['op'])
    expect(views.input_schema.properties.number.type).toBe('number')
    expect(views.input_schema.properties.to.description).toContain(`at most ${VIEW_NAME_MAX} characters`)
    expect(VIEW_NAME_MAX).toBe(80)
    expect(parseToolInput('manage_views', { op: 'list' })).toEqual({ op: 'list' })
    expect(parseToolInput('manage_views', { op: 'rename', number: 2, to: 'North façade' })).toEqual({
      op: 'rename',
      number: 2,
      to: 'North façade'
    })
    expect(() => parseToolInput('manage_views', {})).toThrow(/manage_views: op/)
    expect(() => parseToolInput('manage_views', { op: 'remove' })).toThrow(/manage_views: op/)
    expect(() => parseToolInput('manage_views', { op: 'restore', number: 0 })).toThrow(/manage_views: number — 1 or more/)
    expect(() => parseToolInput('manage_views', { op: 'restore', number: 1.5 })).toThrow(/manage_views: number — a whole number/)
    expect(() => parseToolInput('manage_views', { op: 'rename', number: 1, to: 'x'.repeat(VIEW_NAME_MAX + 1) })).toThrow(
      new RegExp(`manage_views: to — at most ${VIEW_NAME_MAX} characters`)
    )
    expect(() => parseToolInput('manage_views', { op: 'restore', name: 'x'.repeat(201) })).toThrow(/manage_views: name/)
    const d = views.description
    for (const said of [
      'The user’s saved viewpoints — the Viewpoints card',
      'matched exactly, then case-insensitively',
      // The number is the only way when two share a name — or when a name is longer than the
      // list shows it (after review: the list clips at 80 characters and a name is matched whole).
      'or by its number in the list, which is the only way to reach one when two share a name or when its name is longer than the 80 characters the list shows',
      'one that matches nothing changes nothing and returns the list',
      'Restoring runs the same scope guard as undo',
      // Phase 3: a restore the guard catches waits for Apply, and deleting is asked for.
      'is not restored until the user clicks Apply under your reply',
      'list them before acting on one, and save, rename or ask to delete one only when asked'
    ]) {
      expect([said, d.includes(said)]).toEqual([said, true])
    }
    expect(VIEWPOINTS_CAP).toBe(20)
  })

  it('manage_markups lists and zooms, and says it removes nothing', () => {
    // `kind` is phase 3's, for `clear`; `id`, `at`, `point` and `show` are phase 4's, for placing.
    expect(Object.keys(markups.input_schema.properties)).toEqual(['op', 'name', 'kind', 'id', 'at', 'point', 'show'])
    expect(markups.input_schema.required).toEqual(['op'])
    expect(parseToolInput('manage_markups', { op: 'focus', name: 'M2' })).toEqual({ op: 'focus', name: 'M2' })
    expect(() => parseToolInput('manage_markups', { op: 'place' })).toThrow(/manage_markups: op/)
    expect(() => parseToolInput('manage_markups', { op: 'focus', name: 'M'.repeat(21) })).toThrow(/manage_markups: name/)
    const d = markups.description
    for (const said of [
      'Laser measurements are M1, M2 …',
      'spot coordinates are C1, C2 …',
      'or its level in the file’s own metres when the model has no base point',
      // 2026-10-09: the laser lengths in the card's unit, ft included; the spots in metres.
      'returns the laser lengths in the card’s current unit — whole millimetres, metres, or decimal feet while it shows ft',
      'and the spot coordinates in metres',
      'list before you focus'
    ]) {
      expect([said, d.includes(said)]).toEqual([said, true])
    }
    // Phase 4: it places one now, so the sentence that said it could not is gone.
    expect(d).not.toContain('Nothing here places or changes a markup')
    expect(MARKUPS_CAP).toBe(50)
  })

  it('get_view_state says it reads the camera, the step colours and the viewpoints back', () => {
    const d = toolByName('get_view_state')!.description
    for (const said of [
      'where the camera stands (camera)',
      'azimuth and elevation in set_view’s own terms',
      'each highlight step’s colour in the filter stack',
      '(viewpoints, the first 20)',
      'Read-only.'
    ]) {
      expect([said, d.includes(said)]).toEqual([said, true])
    }
  })
})

/* ──────────────────── parity with the user, phase 3 (2026-10-02) ──────────────────── */

/**
 * The consent gate. What reaches outside the view or cannot be undone is asked for, never done:
 * one new view tool, three operations on tools that were there, and a marker on every tool
 * that says which of its calls only ask and through what. `tests/readonly-guard.test.ts` pins
 * the marker's whole list; this block is the catalogue's side of it.
 */
describe('parity with the user — phase 3: the consent gate', () => {
  const ask = toolByName('request_user_action')!
  const views = toolByName('manage_views')!
  const markups = toolByName('manage_markups')!
  const filters = toolByName('manage_filters')!

  it('adds request_user_action to the parity group, strict, as a view tool — still two kinds', () => {
    // (Phase 4 put one more after it: `manage_schedules`.)
    expect(PARITY_TOOL_NAMES.slice(0, 5)).toEqual(['set_models', 'set_interface', 'manage_views', 'manage_markups', 'request_user_action'])
    expect(TOOLS.slice(-6, -5).map((t) => t.name)).toEqual(['request_user_action'])
    expect([ask.kind, ask.strict, ask.input_schema.additionalProperties]).toEqual(['view', true, false])
    expect(TOOLS).toHaveLength(37)
    expect([...new Set(TOOLS.map((t) => t.kind))].sort()).toEqual(['read', 'view'])
  })

  it('takes an action and what that action names — and nothing that is a path', () => {
    expect(Object.keys(ask.input_schema.properties)).toEqual([
      'action',
      'recent',
      'model',
      'ids',
      'selection',
      // Phase 4: the open schedule's rows, for copy_guids. (E, N, Z and angle went with
      // `set_base_point` on 2026-10-08, when the Coordinate-system card became read-only.)
      'schedule'
    ])
    expect(ask.input_schema.required).toEqual(['action'])
    expect(ask.input_schema.properties.action.enum).toEqual(REQUEST_ACTIONS)
    expect([...REQUEST_ACTIONS]).toEqual([
      'open_files',
      'open_recent',
      'unload_model',
      'copy_link',
      'copy_guids'
    ])
    expect(ask.input_schema.properties.recent.description).toContain('a name, never a path')
    expect(ask.input_schema.properties.ids.description).toContain(`at most ${MAX_TOOL_IDS}`)
  })

  it('says, before anything else, that it only asks and that the user decides', () => {
    const d = ask.description
    expect(d.startsWith('Ask the user to do something only they may decide')).toBe(true)
    for (const said of [
      'This tool never does it.',
      'nothing happens unless they click',
      'you are never told whether they did',
      'say what you asked for, never that it was done',
      'One request a turn.',
      'opens the native Open dialog',
      'you are not told what they pick',
      'the file’s name as that list has it, never a path',
      'it returns the names',
      'raises the sidebar’s own "Unload …?" confirmation',
      'it is refused while only one model is loaded',
      'the result never contains what would be copied',
      'wait behind an Apply button under your reply'
    ]) {
      expect([said, d.includes(said)]).toEqual([said, true])
    }
    // 2026-10-08: the base point is read-only, and nothing here offers to change it.
    expect(d).not.toMatch(/base point|set_base_point/)
  })

  it('refuses a recent file that is a path, a number out of range, and an action it does not have', () => {
    expect(parseToolInput('request_user_action', { action: 'copy_link' })).toEqual({ action: 'copy_link' })
    expect(parseToolInput('request_user_action', { action: 'open_recent', recent: 'Tower A.ifc' })).toEqual({
      action: 'open_recent',
      recent: 'Tower A.ifc'
    })
    for (const path of ['C:\\Models\\Tower A.ifc', '/Users/me/Tower A.ifc', '..\\Tower A.ifc', 'folder/Tower A.ifc', '\\\\server\\share\\a.ifc']) {
      expect(() => parseToolInput('request_user_action', { action: 'open_recent', recent: path })).toThrow(
        /request_user_action: recent — a file name as the recent list has it, never a path/
      )
    }
    expect(() =>
      parseToolInput('request_user_action', { action: 'open_recent', recent: 'x'.repeat(RECENT_NAME_MAX + 1) })
    ).toThrow(/request_user_action: recent/)
    expect(() => parseToolInput('request_user_action', {})).toThrow(/request_user_action: action/)
    for (const action of ['unload_all', 'delete_file', 'save_model', 'quit', 'set_api_key', 'open_path', 'set_base_point']) {
      expect(() => parseToolInput('request_user_action', { action })).toThrow(/request_user_action: action/)
    }
    // An extra key is dropped, never passed on: no path, name to write or content reaches an executor.
    expect(parseToolInput('request_user_action', { action: 'open_files', path: 'C:/x.ifc', file: 'x' })).toEqual({
      action: 'open_files'
    })
    // 2026-10-08: the base point's four numbers are no input any more — dropped, like any extra key.
    expect(parseToolInput('request_user_action', { action: 'copy_link', E: 28500, angle: -12.5 })).toEqual({
      action: 'copy_link'
    })
    // After review: a filter set's name is bounded as a viewpoint's lookup name is — it is the
    // model's own text, it is stored, and it is shown in the Filter card and in a pending label.
    expect(FILTER_SET_NAME_MAX).toBe(200)
    expect(parseToolInput('manage_filters', { op: 'save_set', name: 'x'.repeat(200) })).toMatchObject({ op: 'save_set' })
    for (const op of ['save_set', 'apply_set', 'delete_set'] as const) {
      expect(() => parseToolInput('manage_filters', { op, name: 'x'.repeat(201) })).toThrow(/manage_filters: name.*at most 200 characters/)
    }
    expect(toolByName('manage_filters')!.input_schema.properties.name.description).toContain('at most 200 characters')
    expect(() =>
      parseToolInput('request_user_action', { action: 'copy_guids', ids: Array(MAX_TOOL_IDS + 1).fill(1) })
    ).toThrow(/request_user_action: ids/)
  })

  it('gives manage_views a delete and manage_markups a delete and a clear, each saying it only asks', () => {
    expect(parseToolInput('manage_views', { op: 'delete', number: 2 })).toEqual({ op: 'delete', number: 2 })
    expect(parseToolInput('manage_markups', { op: 'clear', kind: 'spots' })).toEqual({ op: 'clear', kind: 'spots' })
    expect(() => parseToolInput('manage_markups', { op: 'clear', kind: 'all' })).toThrow(/manage_markups: kind/)
    expect([...MARKUP_KINDS]).toEqual(['measures', 'spots'])
    expect(markups.input_schema.properties.kind.enum).toEqual(MARKUP_KINDS)
    for (const said of [
      '"delete" asks the user to delete one',
      'A deleted viewpoint cannot be brought back, so delete never deletes',
      'nothing is deleted unless the user clicks it, and you are not told whether they did'
    ]) {
      expect([said, views.description.includes(said)]).toEqual([said, true])
    }
    for (const said of [
      '"delete" asks the user to delete one, and "clear" every laser measurement (kind:"measures") or every spot coordinate (kind:"spots")',
      'A deleted markup cannot be brought back, so delete and clear never delete',
      // (Phase 4 added `show` to what a name is listed for.)
      'they shift when one is deleted: list before you focus, show or ask to delete'
    ]) {
      expect([said, markups.description.includes(said)]).toEqual([said, true])
    }
    // The saved-set delete, which was immediate until this phase.
    expect(filters.description).toContain(
      'delete_set asks the user to forget one: a forgotten set cannot be brought back, so it waits behind an Apply button under your reply'
    )
    expect(filters.description).not.toContain('delete_set forgets one')
    // …and the other way a saved set is lost: a save under its name, or a thirteenth set.
    expect(filters.description).toContain(
      'A save_set that would forget a set — one of the same name, which it replaces, or the oldest once twelve are saved — waits behind that button in the same way, and saves nothing until the user clicks.'
    )
  })

  it('marks every call that only asks, and gateOf reads the marker off a call', () => {
    expect(TOOLS.filter((t) => t.gate).map((t) => t.name)).toEqual([
      'manage_filters',
      'manage_views',
      'manage_markups',
      'request_user_action',
      // Phase 4: deleting a saved setup, printing, opening a schedule file.
      'manage_schedules',
      'export_schedule'
    ])
    // The marker is the catalogue's own: it is not sent to the API.
    for (const tool of apiTools()) expect([tool.name, 'gate' in tool]).toEqual([tool.name, false])

    expect(gateOf('manage_views', { op: 'delete' })).toBe('apply')
    expect(gateOf('manage_views', { op: 'restore' })).toBeNull()
    expect(gateOf('manage_views', { op: 'list' })).toBeNull()
    expect(gateOf('manage_markups', { op: 'clear' })).toBe('apply')
    expect(gateOf('manage_markups', { op: 'focus' })).toBeNull()
    expect(gateOf('manage_filters', { op: 'delete_set' })).toBe('apply')
    // A save is held only when it would forget a set, which the executor finds out — as the
    // scope guard holds an undo — so the marker, which is per operation, does not carry it.
    expect(gateOf('manage_filters', { op: 'save_set' })).toBeNull()
    expect(gateOf('request_user_action', { action: 'open_files' })).toBe('dialog')
    expect(gateOf('request_user_action', { action: 'unload_model' })).toBe('confirm')
    expect(gateOf('request_user_action', { action: 'copy_link' })).toBe('apply')
    // Every call of the Save-dialog tool asks, whatever it is given.
    expect(gateOf('export_schedule', { format: 'csv' })).toBe('dialog')
    expect(gateOf('export_schedule')).toBe('dialog')
    // Not gated, not a tool, not an own key of the marker: null, and it cannot be made to throw.
    expect(gateOf('apply_visibility', { action: 'undo' })).toBeNull()
    expect(gateOf('nope', {})).toBeNull()
    for (const input of [null, undefined, {}, { op: null }, { op: 7 }, { op: 'constructor' }, { op: 'toString' }, { op: '__proto__' }]) {
      expect([JSON.stringify(input), gateOf('manage_views', input as never)]).toEqual([JSON.stringify(input), null])
    }
    // Every action of request_user_action is gated: there is no call of it that acts.
    for (const action of REQUEST_ACTIONS) expect([action, gateOf('request_user_action', { action }) !== null]).toEqual([action, true])
    // Eleven of phase 3, three of phase 4 (the Schedules window's delete, print and open_file) —
    // less `set_base_point`, which went with the read-only Coordinate-system card (2026-10-08).
    expect(GATED_CALLS).toHaveLength(13)
  })

  it('get_view_state says it reads the base point back, and whose it is', () => {
    const d = toolByName('get_view_state')!.description
    for (const said of [
      '(basePoint)',
      'E, N and Z in metres',
      'file when the four are what the file states',
      // 2026-10-08: read-only, and the models the Coordinate-system card's note names.
      'nothing in the app can change it',
      '(notLinedUp)',
      'Read-only.'
    ]) {
      expect([said, d.includes(said)]).toEqual([said, true])
    }
    expect(d).not.toContain('user when someone has changed them')
  })
})

/* ──────────────────── parity with the user, phase 4 (2026-10-02) ──────────────────── */

/**
 * The Schedules window, and placing markups: one new view tool (`manage_schedules`), what
 * `make_schedule` can now set, the open schedule's rows as a set, and `manage_markups`' two
 * placing operations and its spot-tag switch. Each list the catalogue spells for the main
 * process is held to the one the engine, the port or the viewer's arithmetic owns.
 */
describe('parity with the user — phase 4: the Schedules window, and placing markups', () => {
  const make = toolByName('make_schedule')!
  const manage = toolByName('manage_schedules')!
  const markups = toolByName('manage_markups')!

  it('adds manage_schedules to the parity group, strict, as a view tool', () => {
    expect(PARITY_TOOL_NAMES).toEqual([
      'set_models',
      'set_interface',
      'manage_views',
      'manage_markups',
      'request_user_action',
      'manage_schedules'
    ])
    expect(TOOLS.slice(-5, -4).map((t) => t.name)).toEqual(['manage_schedules'])
    expect([manage.kind, manage.strict, manage.input_schema.additionalProperties]).toEqual(['view', true, false])
    expect(TOOLS).toHaveLength(37)
    expect(Object.keys(manage.input_schema.properties)).toEqual(['op', 'name', 'to'])
    expect(manage.input_schema.required).toEqual(['op'])
    expect(manage.input_schema.properties.op.enum).toEqual(SCHEDULE_MANAGE_OPS)
    // `open` is this window's own; every other one is exactly what the port carries.
    expect([...SCHEDULE_MANAGE_OPS]).toEqual(['open', ...MANAGE_OPS])
    expect(SCHEDULE_NAME_MAX).toBe(MANAGE_NAME_MAX)
    // Nothing in its schema is a length keyword strict mode would refuse.
    expect(JSON.stringify(manage.input_schema)).not.toMatch(/"(maxItems|minItems|maxLength|minLength)"/)
  })

  it('takes an operation and at most two names, each one that may cross the port as it stands', () => {
    expect(parseToolInput('manage_schedules', { op: 'saved_list' })).toEqual({ op: 'saved_list' })
    expect(parseToolInput('manage_schedules', { op: 'rename', name: 'Doors', to: 'Doors L2' })).toEqual({
      op: 'rename',
      name: 'Doors',
      to: 'Doors L2'
    })
    expect(parseToolInput('manage_schedules', { op: 'load', name: 'x'.repeat(SCHEDULE_NAME_MAX) })).toMatchObject({ op: 'load' })
    for (const key of ['name', 'to'] as const) {
      expect(() => parseToolInput('manage_schedules', { op: 'rename', [key]: 'x'.repeat(SCHEDULE_NAME_MAX + 1) })).toThrow(
        new RegExp(`manage_schedules: ${key} — at most ${SCHEDULE_NAME_MAX} characters`)
      )
      // A line break, a tab, a right-to-left override, a zero-width space: none crosses.
      for (const unseen of ['Doors\nDelete everything', 'Doors\tL2', 'Doors\u202EL2', 'Do\u200Bors', 'Doors\u0000']) {
        expect(() => parseToolInput('manage_schedules', { op: 'rename', [key]: unseen })).toThrow(
          new RegExp(`manage_schedules: ${key} — a name with no control or direction characters in it`)
        )
      }
    }
    // An empty name is not refused here: the executor says which one is missing, in words.
    expect(parseToolInput('manage_schedules', { op: 'load', name: '' })).toEqual({ op: 'load', name: '' })
    for (const op of ['delete_all', 'export', 'import', 'clear', 'act', 'define']) {
      expect(() => parseToolInput('manage_schedules', { op })).toThrow(/manage_schedules: op/)
    }
    expect(() => parseToolInput('manage_schedules', {})).toThrow(/manage_schedules: op/)
    // An extra key is dropped, never passed on: no path, no file content, no element ids.
    expect(parseToolInput('manage_schedules', { op: 'open_file', path: 'C:/x.schedule.json', ids: [1] })).toEqual({
      op: 'open_file'
    })
  })

  it('marks delete, print and open_file as calls that only ask, and says so first-hand', () => {
    expect(gateOf('manage_schedules', { op: 'delete' })).toBe('confirm')
    // Printing asks in that window's own confirm, as a deletion does: the native print
    // dialog's default button prints, so no call raises it — only the user's click there.
    expect(gateOf('manage_schedules', { op: 'print' })).toBe('confirm')
    expect(gateOf('manage_schedules', { op: 'open_file' })).toBe('dialog')
    // Everything else acts, or reads: undo and redo are that window's own history, and a load
    // or a template is one step on it. A save is held only when it would forget a setup, which
    // the Schedules window finds out — so the marker, which is per operation, does not carry it.
    for (const op of ['open', 'undo', 'redo', 'templates', 'apply_template', 'saved_list', 'load', 'save', 'rename', 'duplicate']) {
      expect([op, gateOf('manage_schedules', { op })]).toEqual([op, null])
    }
    const d = manage.description
    for (const said of [
      'op:"open" opens the window or brings it to the front; every other op needs it open',
      'step the schedule it shows through that window’s own history, which is where make_schedule’s changes land',
      'My templates, kept on this computer',
      'apply_template and load replace the open schedule, which the user can undo there',
      'Three things are only asked for, in the Schedules window, where the user’s own click decides and you are not told what they chose',
      '"delete" raises that window’s confirmation for one saved setup, "print" asks there whether to open the print dialog — which opens only if the user says so there — and "open_file" raises its Open dialog for a .schedule.json',
      'So is a save or a duplicate that would take a saved setup away',
      'Saved setups are the user’s own: list them before acting on one'
    ]) {
      expect([said, d.includes(said)]).toEqual([said, true])
    }
  })

  it('make_schedule gains a column’s format and place, calculated columns, the filter logic and itemise', () => {
    const col = make.input_schema.properties.columns.items!
    expect(Object.keys(col.properties!)).toEqual(['field', 'heading', 'total', 'hidden', 'decimals', 'unit', 'align', 'after'])
    expect(col.required).toEqual(['field'])
    const calc = make.input_schema.properties.calculated.items!
    expect(Object.keys(calc.properties!)).toEqual(['name', 'formula', 'percentageOf', 'result'])
    expect([calc.required, calc.additionalProperties]).toEqual([['name'], false])
    expect(make.input_schema.properties.filterLogic.enum).toEqual(['and', 'or'])
    expect(make.input_schema.properties.itemize.type).toBe('boolean')
    // The lists the catalogue spells for the main process are the engine side's own.
    expect([...SCHEDULE_ALIGN_ENUM]).toEqual([...SCHEDULE_ALIGNS])
    expect([...SCHEDULE_RESULT_ENUM]).toEqual([...SCHEDULE_RESULTS])
    expect(SCHEDULE_CALCULATED_MAX).toBe(SCHEDULE_CALC_CAP)
    expect(col.properties!.align.enum).toEqual(SCHEDULE_ALIGN_ENUM)
    expect(calc.properties!.result.enum).toEqual(SCHEDULE_RESULT_ENUM)
    expect(col.properties!.decimals.description).toContain(`${DECIMALS_MIN}–${DECIMALS_MAX}`)
    expect(make.description).toContain(`and ${SCHEDULE_CALCULATED_MAX} calculated columns`)
    for (const said of [
      'filterLogic:"or" lists what passes any filter rather than every one',
      'itemize:false collapses rows that read alike into one with a Count',
      'calculated adds columns worked out per row from the other columns, named by their headings',
      'a formula reads measures in SI as a filter does, so Width > 0.9 is wider than 900 mm',
      'A formula that does not parse, or names a heading the schedule has no column for, refuses the call with the reason',
      'and moved when after is given'
    ]) {
      expect([said, make.description.includes(said)]).toEqual([said, true])
    }

    // Bounded in zod, since a strict schema carries neither a length nor a numeric keyword.
    const one = (extra: Record<string, unknown>) => ({ columns: [{ field: 'Name', ...extra }] })
    expect(parseToolInput('make_schedule', one({ decimals: 0, align: 'center', hidden: true, unit: 'mm', after: '' }))).toEqual(
      one({ decimals: 0, align: 'center', hidden: true, unit: 'mm', after: '' })
    )
    for (const decimals of [DECIMALS_MIN - 1, DECIMALS_MAX + 1, 2.5, Number.NaN]) {
      expect(() => parseToolInput('make_schedule', one({ decimals }))).toThrow(/make_schedule: columns\.0\.decimals/)
    }
    expect(() => parseToolInput('make_schedule', one({ align: 'middle' }))).toThrow(/make_schedule: columns\.0\.align/)
    expect(() => parseToolInput('make_schedule', one({ unit: 'x'.repeat(9) }))).toThrow(/make_schedule: columns\.0\.unit/)
    expect(() => parseToolInput('make_schedule', one({ after: 'x'.repeat(201) }))).toThrow(/make_schedule: columns\.0\.after/)
    const c = { name: 'Gross', formula: 'Area * 1.15' }
    expect(() => parseToolInput('make_schedule', { calculated: Array(SCHEDULE_CALC_CAP).fill(c) })).not.toThrow()
    expect(() => parseToolInput('make_schedule', { calculated: Array(SCHEDULE_CALC_CAP + 1).fill(c) })).toThrow(
      /make_schedule: calculated — at most 20 calculated columns in one call/
    )
    expect(() => parseToolInput('make_schedule', { calculated: [{ name: 'Gross', formula: 'x'.repeat(SCHEDULE_FORMULA_CHARS + 1) }] })).toThrow(
      /make_schedule: calculated\.0\.formula/
    )
    expect(() => parseToolInput('make_schedule', { calculated: [{ formula: '1 + 1' }] })).toThrow(/make_schedule: calculated\.0\.name/)
    expect(() => parseToolInput('make_schedule', { calculated: [{ name: 'Gross', result: 'currency' }] })).toThrow(
      /make_schedule: calculated\.0\.result/
    )
    expect(() => parseToolInput('make_schedule', { filterLogic: 'xor' })).toThrow(/make_schedule: filterLogic/)
    // A title becomes a saved setup's name when the schedule is saved (`manage_schedules`), so
    // it is held to what a name may be: no line break, no direction mark.
    expect(parseToolInput('make_schedule', { title: 'Doors — level 3 (2)' })).toEqual({ title: 'Doors — level 3 (2)' })
    for (const unseen of [String.fromCharCode(10), String.fromCharCode(0x202e), String.fromCharCode(0x200b)]) {
      expect(() => parseToolInput('make_schedule', { title: `Doors${unseen}L2` })).toThrow(
        /make_schedule: title — a title with no control or direction characters in it/
      )
    }
    expect(() => parseToolInput('make_schedule', { itemize: 'no' })).toThrow(/make_schedule: itemize/)
  })

  it('takes the open schedule’s rows as a set — schedule:true beside ids and selection, on the four tools that take a set', () => {
    for (const name of ['apply_visibility', 'select_elements', 'color_by_property', 'request_user_action']) {
      const tool = toolByName(name)!
      expect([name, tool.input_schema.properties.schedule?.type]).toEqual([name, 'boolean'])
      // Not bounded: `MAX_TOOL_IDS` is for ids the model sends, and this set never travels
      // through the model — the app holds it, as it holds the selection, which has no cap either.
      const said = tool.input_schema.properties.schedule!.description!
      expect([name, said.includes('however many')]).toEqual([name, true])
      expect([name, said.includes(String(MAX_TOOL_IDS)), /at most|Refused|more than/.test(said)]).toEqual([name, false, false])
      expect([name, tool.input_schema.properties.ids!.description]).toEqual([name, expect.stringContaining(`at most ${MAX_TOOL_IDS}`)])
      expect([name, tool.description.includes('schedule:true')]).toEqual([name, true])
    }
    // Rules are still the ones to prefer where the set can be said as one — and why.
    for (const name of ['apply_visibility', 'select_elements', 'color_by_property']) {
      expect([name, toolByName(name)!.input_schema.properties.schedule!.description]).toEqual([
        name,
        expect.stringContaining('Prefer rules when the set can be said as a rule: only a rule can be saved and shared.')
      ])
    }
    expect(parseToolInput('apply_visibility', { action: 'isolate', schedule: true })).toEqual({ action: 'isolate', schedule: true })
    expect(parseToolInput('select_elements', { schedule: true })).toEqual({ schedule: true })
    expect(parseToolInput('color_by_property', { property: 'FireRating', schedule: true })).toEqual({
      property: 'FireRating',
      schedule: true
    })
    expect(parseToolInput('request_user_action', { action: 'copy_guids', schedule: true })).toEqual({
      action: 'copy_guids',
      schedule: true
    })
    expect(() => parseToolInput('apply_visibility', { action: 'hide', schedule: 'yes' })).toThrow(/apply_visibility: schedule/)
    // No other tool takes one: a schedule's rows are a set to act on, not a filter to read by.
    expect(TOOLS.filter((t) => t.input_schema.properties.schedule).map((t) => t.name)).toEqual([
      'apply_visibility',
      'select_elements',
      'color_by_property',
      'request_user_action'
    ])
  })

  it('says what selection:true does in a sentence that reads, on each of the three tools that share the template', () => {
    // 2026-10-02: the template put the third person's s on the end of the phrase, so the one
    // verb of two words read "true act ons what the user currently has selected".
    const said = (name: string, input: string): string => toolByName(name)!.input_schema.properties[input]!.description!
    expect(said('apply_visibility', 'selection')).toBe('true acts on what the user currently has selected, whatever that is.')
    expect(said('select_elements', 'selection')).toBe('true selects what the user currently has selected, whatever that is.')
    expect(said('color_by_property', 'selection')).toBe('true colours what the user currently has selected, whatever that is.')
    // The template's other two inputs take the verb as it is given, and read as they did.
    expect(said('apply_visibility', 'ids')).toMatch(/^Federation element ids to act on, at most 2000\. /)
    expect(said('apply_visibility', 'schedule')).toContain('as the set to act on. ')
    // And the slip itself is gone from the sentence that had it.
    expect(said('apply_visibility', 'selection')).not.toContain('act ons')
  })

  it('manage_markups places a spot or a measurement on an element’s box or at a point, and sets a spot tag', () => {
    // The three places are the arithmetic's own (`shared/annotate.ts`, `boxPlace`).
    expect([...MARKUP_PLACES]).toEqual([...BOX_PLACES])
    expect([...SPOT_SHOWS]).toEqual(['level', 'full'])
    const props = markups.input_schema.properties
    expect(props.at.enum).toEqual(MARKUP_PLACES)
    expect(props.show.enum).toEqual(SPOT_SHOWS)
    expect(props.id.type).toBe('number')
    expect(props.point).toMatchObject({
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
      required: ['x', 'y', 'z'],
      additionalProperties: false
    })
    // What can be listed can be named: the assistant never adds past what one result lists.
    expect(MARKUPS_PLACE_CAP).toBeLessThanOrEqual(MARKUPS_CAP)

    expect(parseToolInput('manage_markups', { op: 'place_spot', id: 12, at: 'top', show: 'full' })).toEqual({
      op: 'place_spot',
      id: 12,
      at: 'top',
      show: 'full'
    })
    expect(parseToolInput('manage_markups', { op: 'place_measure', point: { x: 1, y: 2, z: 3.5 } })).toEqual({
      op: 'place_measure',
      point: { x: 1, y: 2, z: 3.5 }
    })
    expect(() => parseToolInput('manage_markups', { op: 'place_spot', id: 12, at: 'side' })).toThrow(/manage_markups: at/)
    expect(() => parseToolInput('manage_markups', { op: 'place_spot', point: { x: 1, y: 2 } })).toThrow(/manage_markups: point\.z/)
    expect(() => parseToolInput('manage_markups', { op: 'place_spot', point: { x: 1, y: 2, z: MARKUP_POINT_MAX * 10 } })).toThrow(
      /manage_markups: point\.z — between -10000000 and 10000000 metres/
    )
    expect(() => parseToolInput('manage_markups', { op: 'place_spot', point: { x: Number.NaN, y: 2, z: 3 } })).toThrow(
      /manage_markups: point\.x/
    )
    expect(() => parseToolInput('manage_markups', { op: 'place_spot', id: '12' })).toThrow(/manage_markups: id/)
    expect(() => parseToolInput('manage_markups', { op: 'show', show: 'all' })).toThrow(/manage_markups: show/)

    // Placing acts — it is the user's click — and deleting still only asks.
    for (const op of ['place_spot', 'place_measure', 'show', 'list', 'focus']) {
      expect([op, gateOf('manage_markups', { op })]).toEqual([op, null])
    }
    expect(gateOf('manage_markups', { op: 'delete' })).toBe('apply')
    expect(gateOf('manage_markups', { op: 'clear' })).toBe('apply')

    const d = markups.description
    for (const said of [
      '"place_spot" and "place_measure" place one exactly as the user’s click with the spot tool or the laser meter does',
      'at: top, which is the default, centre or base',
      'in the project-frame metres get_element reports a box in',
      // The brief's own requirement: it is the box, and the reply has to say so.
      'That box is axis-aligned and conservative, not a picked surface',
      'so report it as taken on the bounding box',
      'from top or base it does not read into the element, and from centre it usually reads the element’s own faces',
      'A spot tag shows its level alone until show:"full"',
      // A markup is session view state: the reply's own revert takes it away again.
      'Place a markup only when asked: it stays until the user deletes it or reverts your reply, which takes away the markups that reply placed'
    ]) {
      expect([said, d.includes(said)]).toEqual([said, true])
    }
    expect(d).not.toContain('revert does not remove')
  })

  it('names nothing after an operation on a file, and takes no file-system input', () => {
    // The guard's own two checks (`tests/readonly-guard.test.ts`), restated for the new tool:
    // `open_file` and `print` are values of `op`, never a key that could carry a path.
    expect(manage.name).toBe('manage_schedules')
    expect(Object.keys(manage.input_schema.properties).filter((k) => /file|path|dir|folder|url|content|bytes|data/i.test(k))).toEqual([])
  })
})
