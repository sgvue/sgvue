/**
 * Tool arguments, re-validated in the renderer before an executor sees them.
 *
 * `strict: true` on the tool definition already guarantees the model's arguments match the
 * schema — but that is a guarantee made by the other end of a network connection, and this
 * side is the one holding the model. So every input is parsed again here, and a failure
 * becomes an ordinary `is_error` tool result the model can read and correct.
 *
 * `tests/unit/ai-tools.test.ts` asserts that these keys and the JSON schemas in
 * `shared/tool-schemas.ts` name exactly the same properties, so the two cannot drift.
 *
 * 2026-10-02 — parity with the user, phase 1: `toggle_display`'s three more switches,
 * `select_elements`' `mode`, `apply_visibility`'s `undo` / `redo`, `color_models`' `null` for
 * one key, and the two new tools — `set_models` (a bounded list of keys) and `set_interface`
 * (every setting one of the store's own values; the tree's search text bounded).
 *
 * The same day, phase 2: `set_view`'s `fit`, `azimuth`, `elevation` and `zoom` (each number
 * bounded here, since a strict schema carries no numeric keyword); `manage_filters`' `update`
 * with its `action`, `rules` and `color`; `set_filter_stack`'s `color` per step; and the two
 * new tools, `manage_views` (a name bounded, a number a positive whole one) and
 * `manage_markups`.
 *
 * Phase 3, the consent gate: `manage_views`' `delete`, `manage_markups`' `delete` and `clear`
 * with its `kind`, and `request_user_action` — an action, and for each action what it names.
 * **A recent file is a name**: one that holds a path separator is refused here, before any
 * executor sees it, so no tool input can carry a path. (The base point's four numbers were taken
 * here too until 2026-10-08, when the owner made the Coordinate-system card read-only.)
 *
 * Phase 4: `make_schedule`'s formats, order and calculated columns; `schedule` beside `ids` and
 * `selection`; `manage_schedules` — an operation and at most two names, each one that may cross
 * the Schedules port as it stands (`SafeName`: bounded, nothing unseen in it); and
 * `manage_markups`' placing — an element, a place on its box or a bounded point, a spot tag's
 * state.
 */
import { z } from 'zod'
import { HL } from '../../../shared/colors'
import {
  FILTER_SET_NAME_MAX,
  INTERFACE_CARDS,
  INTERFACE_SEARCH_MAX,
  INTERFACE_SIDEBAR,
  INTERFACE_THEMES,
  INTERFACE_TOOLS,
  INTERFACE_TREE_MODES,
  INTERFACE_UNITS,
  MARKUP_KINDS,
  MARKUP_OPS,
  MARKUP_PLACES,
  MARKUP_POINT_MAX,
  MAX_MODEL_KEYS,
  MAX_MODEL_KEY_CHARS,
  MAX_TOOL_IDS,
  RECENT_NAME_MAX,
  REQUEST_ACTIONS,
  SCHEDULE_EXPORT_FORMATS,
  SCHEDULE_MANAGE_OPS,
  SCHEDULE_NAME_MAX,
  SPOT_SHOWS,
  VIEW_FITS,
  VIEW_NAME_MAX,
  VIEW_OPS,
  VIEW_ZOOM_MAX,
  VIEW_ZOOM_MIN
} from '../../../shared/tool-schemas'
import {
  SCHEDULE_ALIGNS,
  SCHEDULE_CALC_CAP,
  SCHEDULE_CATEGORY_CAP,
  SCHEDULE_COLUMN_CAP,
  SCHEDULE_FORMULA_CHARS,
  SCHEDULE_OPS,
  SCHEDULE_RESULTS,
  SCHEDULE_TOTALS,
  SCHEDULE_VALUES_CAP
} from '../../../schedule/assistant'
import { isSafeName } from '../../../schedule/messages'
import { MAX_FILTERS, MAX_SORT_LEVELS, type Op } from '../../../schedule/schedule/def'
import { DECIMALS_MAX, DECIMALS_MIN } from '../../../schedule/schedule/format'

const Rule = z.object({
  prop: z.string(),
  // `absent` ignores `val` and is the one operator the design does not have (2026-09-20).
  op: z.enum(['=', '!=', '~', '>', '<', 'absent']),
  // The schema says `string`; a model that sends the number it means is not wrong, and
  // `matchFn` stringifies anyway (`shared/rules.ts`).
  val: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  join: z.enum(['and', 'or']).optional()
})

const Rules = z.array(Rule)

const nullableString = z.union([z.string(), z.null()])

const StepAction = z.enum(['isolate', 'hide', 'highlight'])
/** A step's highlight colour: one of the Filter card's six swatches (2026-10-02). */
const StepColor = z.enum(HL)

/**
 * The id-list target (2026-09-20). The cap is refused **here**, before any executor runs, so
 * the model gets one sentence naming the field and the limit rather than a half-applied view.
 */
const Ids = z
  .array(z.number())
  .max(
    MAX_TOOL_IDS,
    `at most ${MAX_TOOL_IDS} ids — narrow the set with rules, or run the query again with a LIMIT and act on a rule instead`
  )

/**
 * A saved schedule setup's or a template's name (2026-10-02, phase 4): what may cross the
 * Schedules port as it stands — bounded, with no control or direction character in it. An empty
 * one is the executor's to answer, in words.
 */
const ScheduleName = z
  .string()
  .max(SCHEDULE_NAME_MAX, `at most ${SCHEDULE_NAME_MAX} characters`)
  .refine((name) => !name.trim() || isSafeName(name), 'a name with no control or direction characters in it')

/** One coordinate of a point a markup is placed at, in project-frame metres: finite and bounded. */
const MarkupMetres = z
  .number()
  .min(-MARKUP_POINT_MAX, `between -${MARKUP_POINT_MAX} and ${MARKUP_POINT_MAX} metres`)
  .max(MARKUP_POINT_MAX, `between -${MARKUP_POINT_MAX} and ${MARKUP_POINT_MAX} metres`)

/**
 * `make_schedule`'s pieces (2026-09-28). The definition comes from model output, so every
 * array and string is bounded here, before anything resolves a name: 40 columns, the engine's
 * own 8 filters and 4 sort-and-group levels, 12 classes, 50 values to a filter.
 */
const SchedField = z.string().min(1).max(200)
const SchedValue = z.union([z.string().max(500), z.number(), z.boolean()])
const ScheduleInput = z.object({
  base: z.enum(['new', 'open']).optional(),
  // (Phase 4: a title becomes a saved setup's name when the schedule is saved, so it is held
  // to what a name may be: nothing unseen in it.)
  title: z
    .string()
    .max(200)
    .refine((title) => !title.trim() || isSafeName(title), 'a title with no control or direction characters in it')
    .optional(),
  category: z.array(z.string().max(100)).min(1).max(SCHEDULE_CATEGORY_CAP).optional(),
  columns: z
    .array(
      z.object({
        field: SchedField,
        heading: z.string().max(120).optional(),
        total: z.enum(SCHEDULE_TOTALS).optional(),
        // 2026-10-02, phase 4 — the Format tab, and a column's place.
        hidden: z.boolean().optional(),
        decimals: z
          .number()
          .int('a whole number')
          .min(DECIMALS_MIN, `between ${DECIMALS_MIN} and ${DECIMALS_MAX}`)
          .max(DECIMALS_MAX, `between ${DECIMALS_MIN} and ${DECIMALS_MAX}`)
          .optional(),
        unit: z.string().min(1).max(8).optional(),
        align: z.enum(SCHEDULE_ALIGNS).optional(),
        after: z.string().max(200).optional()
      })
    )
    .max(SCHEDULE_COLUMN_CAP, `at most ${SCHEDULE_COLUMN_CAP} columns in one call`)
    .optional(),
  removeColumns: z.array(SchedField).max(SCHEDULE_COLUMN_CAP).optional(),
  // Phase 4 — the calculated-value editor. A formula is text the engine parses, never runs.
  calculated: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        formula: z.string().max(SCHEDULE_FORMULA_CHARS, `at most ${SCHEDULE_FORMULA_CHARS} characters`).optional(),
        percentageOf: SchedField.optional(),
        result: z.enum(SCHEDULE_RESULTS).optional()
      })
    )
    .max(SCHEDULE_CALC_CAP, `at most ${SCHEDULE_CALC_CAP} calculated columns in one call`)
    .optional(),
  filterLogic: z.enum(['and', 'or']).optional(),
  itemize: z.boolean().optional(),
  filters: z
    .array(
      z.object({
        field: SchedField,
        op: z.enum(SCHEDULE_OPS as [Op, ...Op[]]),
        value: SchedValue.optional(),
        values: z
          .array(z.union([z.string().max(500), z.number()]))
          .max(SCHEDULE_VALUES_CAP)
          .optional()
      })
    )
    .max(MAX_FILTERS, `at most ${MAX_FILTERS} filters — the Filter tab's own limit`)
    .optional(),
  sortBy: z
    .array(z.object({ field: SchedField, descending: z.boolean().optional() }))
    .max(MAX_SORT_LEVELS)
    .optional(),
  groupBy: z.array(SchedField).max(MAX_SORT_LEVELS).optional(),
  grandTotals: z.boolean().optional()
})

export const TOOL_INPUTS = {
  /* the design's fifteen */
  summarize_elements: z.object({ rules: Rules.optional(), groupBy: z.string() }),
  audit_model: z.object({}),
  clash_check: z.object({
    modelA: z.string(),
    modelB: z.string(),
    tolerance: z.number().optional()
  }),
  set_filter_stack: z.object({
    steps: z.array(z.object({ action: StepAction, rules: Rules, color: StepColor.optional() })),
    combine: z.enum(['replace', 'append']).optional()
  }),
  manage_filters: z.object({
    op: z.enum([
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
    ]),
    step: z.number().optional(),
    to: z.number().optional(),
    // Bounded since the gate's review, as `manage_views`' is: it is stored, and shown in a label.
    name: z.string().max(FILTER_SET_NAME_MAX, `at most ${FILTER_SET_NAME_MAX} characters`).optional(),
    // `update` (2026-10-02): what is omitted is kept.
    action: StepAction.optional(),
    rules: Rules.optional(),
    color: StepColor.optional()
  }),
  query_elements: z.object({ rules: Rules }),
  apply_visibility: z.object({
    rules: Rules.optional(),
    // `undo` / `redo` (2026-10-02) are the action bar's two buttons.
    action: z.enum(['isolate', 'hide', 'highlight', 'show', 'reset', 'undo', 'redo']).optional(),
    combine: z.enum(['replace', 'append']).optional(),
    ids: Ids.optional(),
    selection: z.boolean().optional(),
    // 2026-10-02, phase 4 — the open schedule's rows, as a set (`targets.ts`).
    schedule: z.boolean().optional()
  }),
  select_elements: z.object({
    // `rules` stops being required the moment there are two other ways to name a set.
    rules: Rules.optional(),
    zoom: z.boolean().optional(),
    // 2026-10-02 — what happens to the selection there already is. Omitted: `replace`.
    mode: z.enum(['replace', 'add', 'remove', 'clear']).optional(),
    ids: Ids.optional(),
    selection: z.boolean().optional(),
    schedule: z.boolean().optional()
  }),
  set_storeys: z.object({ visible: z.array(z.string()) }),
  activate_model: z.object({ key: nullableString }),
  set_view: z.object({
    view: z.enum(['iso', 'top', 'north', 'south', 'east', 'west']).optional(),
    projection: z.enum(['persp', 'ortho']).optional(),
    // 2026-10-02 — the camera, freely. Degrees; a whole turn either way is as far as it goes.
    fit: z.enum(VIEW_FITS).optional(),
    azimuth: z.number().min(-360, 'between -360 and 360 degrees').max(360, 'between -360 and 360 degrees').optional(),
    elevation: z.number().min(-90, 'between -90 and 90 degrees').max(90, 'between -90 and 90 degrees').optional(),
    zoom: z
      .number()
      .min(VIEW_ZOOM_MIN, `between ${VIEW_ZOOM_MIN} and ${VIEW_ZOOM_MAX}`)
      .max(VIEW_ZOOM_MAX, `between ${VIEW_ZOOM_MIN} and ${VIEW_ZOOM_MAX}`)
      .optional()
  }),
  set_section: z.object({
    kind: z.union([z.enum(['grid', 'level']), z.null()]),
    name: z.string().optional(),
    offset: z.number().optional(),
    flip: z.boolean().optional(),
    cut: z.boolean().optional()
  }),
  toggle_display: z.object({
    grids: z.boolean().optional(),
    levels: z.boolean().optional(),
    shadows: z.boolean().optional(),
    dims: z.boolean().optional(),
    groundGrid: z.boolean().optional(),
    snap: z.boolean().optional(),
    originalMaterials: z.boolean().optional()
  }),
  color_by_property: z.object({
    property: nullableString,
    rules: Rules.optional(),
    ids: Ids.optional(),
    selection: z.boolean().optional(),
    schedule: z.boolean().optional()
  }),
  // A hex colour, or `null` to clear that one model's override (2026-10-02).
  color_models: z.object({ map: z.record(z.string(), nullableString) }),

  /* the read-only additions */
  get_element: z.object({ id: z.number().optional(), guid: z.string().optional() }),
  get_entity_raw: z.object({
    model: z.string().optional(),
    expressId: z.number().optional(),
    guid: z.string().optional()
  }),
  list_values: z.object({
    attr: z.string(),
    contains: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    rules: Rules.optional()
  }),
  find_properties: z.object({
    text: z.string(),
    rules: Rules.optional(),
    limit: z.number().optional()
  }),
  search: z.object({ text: z.string(), limit: z.number().optional() }),
  get_spatial_tree: z.object({
    model: z.string().optional(),
    counts: z.boolean().optional(),
    spaces: z.boolean().optional(),
    depth: z.number().optional()
  }),
  get_relationships: z.object({ id: z.number().optional(), guid: z.string().optional() }),
  get_model_info: z.object({ model: z.string().optional() }),
  get_view_state: z.object({}),
  measure_between: z.object({ a: z.number(), b: z.number() }),
  find_nearby: z.object({
    id: z.number().optional(),
    ids: z.array(z.number()).max(25, 'at most 25 ids to search around').optional(),
    distance: z.number().optional(),
    spaces: z.boolean().optional(),
    limit: z.number().optional()
  }),
  query_sql: z.object({ sql: z.string() }),

  /* parity with the user (2026-10-02) */
  // Model keys are a handful; a list longer than any federation is refused before it is read.
  set_models: z.object({
    visible: z
      .array(z.string().max(MAX_MODEL_KEY_CHARS))
      .max(MAX_MODEL_KEYS, `at most ${MAX_MODEL_KEYS} model keys`)
  }),
  set_interface: z.object({
    theme: z.enum(INTERFACE_THEMES).optional(),
    units: z.enum(INTERFACE_UNITS).optional(),
    treeMode: z.enum(INTERFACE_TREE_MODES).optional(),
    sidebar: z.enum(INTERFACE_SIDEBAR).optional(),
    card: z.enum(INTERFACE_CARDS).optional(),
    tool: z.enum(INTERFACE_TOOLS).optional(),
    search: z
      .string()
      .max(INTERFACE_SEARCH_MAX, `at most ${INTERFACE_SEARCH_MAX} characters`)
      .optional(),
    schedulesWindow: z.enum(['open']).optional()
  }),
  // The lookup name is what the user called a viewpoint, so it may be longer than one the
  // assistant may give; both are bounded, and a number is a position in the list.
  manage_views: z.object({
    op: z.enum(VIEW_OPS),
    name: z.string().max(200, 'at most 200 characters').optional(),
    number: z.number().int('a whole number').min(1, '1 or more').optional(),
    to: z.string().max(VIEW_NAME_MAX, `at most ${VIEW_NAME_MAX} characters`).optional()
  }),
  manage_markups: z.object({
    op: z.enum(MARKUP_OPS),
    name: z.string().max(20, 'a markup is named M1, C2 …').optional(),
    // `clear` (2026-10-02, phase 3): which of the card's two lists.
    kind: z.enum(MARKUP_KINDS).optional(),
    // Placing (phase 4): an element and a place on its box, or a point; a spot tag's state.
    id: z.number().optional(),
    at: z.enum(MARKUP_PLACES).optional(),
    point: z.object({ x: MarkupMetres, y: MarkupMetres, z: MarkupMetres }).optional(),
    show: z.enum(SPOT_SHOWS).optional()
  }),
  // 2026-10-02, phase 3 — the consent gate. Nothing here is a path: `recent` is a file's name,
  // looked up on the app's own recent list, and a name has no separator in it.
  request_user_action: z.object({
    action: z.enum(REQUEST_ACTIONS),
    recent: z
      .string()
      .max(RECENT_NAME_MAX, `at most ${RECENT_NAME_MAX} characters`)
      .regex(/^[^\\\/]*$/, 'a file name as the recent list has it, never a path')
      .optional(),
    model: z.string().max(MAX_MODEL_KEY_CHARS).optional(),
    ids: Ids.optional(),
    selection: z.boolean().optional(),
    schedule: z.boolean().optional()
  }),
  // 2026-10-02, phase 4 — the Schedules window's own controls. What is sent on is the
  // operation and these two names, and nothing else.
  manage_schedules: z.object({
    op: z.enum(SCHEDULE_MANAGE_OPS),
    name: ScheduleName.optional(),
    to: ScheduleName.optional()
  }),

  /* the Schedules window (2026-09-28) */
  make_schedule: ScheduleInput,
  get_schedule: z.object({ limit: z.number().optional(), offset: z.number().optional() }),
  // A format and nothing else: no name, no path, no content (the read-only guard pins it).
  export_schedule: z.object({ format: z.enum(SCHEDULE_EXPORT_FORMATS) }),
  color_by_schedule_column: z.object({ column: z.union([z.string().min(1).max(200), z.null()]) })
} as const

export type ToolInputName = keyof typeof TOOL_INPUTS

/**
 * Parse, or throw with a sentence the model can act on. Unknown keys are ignored rather than
 * refused: an extra argument is the model being generous, not the model being wrong.
 */
export function parseToolInput(name: string, raw: unknown): Record<string, unknown> {
  const schema = TOOL_INPUTS[name as ToolInputName]
  if (!schema) throw new Error(`No tool named "${name}".`)
  const parsed = schema.safeParse(raw ?? {})
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path.length ? first.path.join('.') : 'input'
    throw new Error(`${name}: ${where} — ${first?.message ?? 'invalid'}`)
  }
  return parsed.data as Record<string, unknown>
}
