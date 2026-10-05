/**
 * What crosses the Schedules window's private `MessagePort` — 2026-09-25.
 *
 * The port joins the two renderers directly; main creates the pair and hands one end to each
 * page, and never sees a message (`main/schedules-window.ts`). Each receiving page validates
 * what arrives with these schemas and ignores anything that fails — zod runs in both
 * renderers, never in a preload.
 *
 *   main window → Schedules   `store`      the snapshot (`adapter.ts`), on connect and whenever
 *                                          the federation (or a model's display name) changes
 *                             `theme`      the main window's theme, on connect and on change
 *                             `selection`  the main window's `selIds`, on connect and whenever
 *                                          they change, at most one per frame (phase 3);
 *                                          `quiet` when the table must not scroll to it
 *                             `vis`        the manual hidden set and whether Isolate / Show all
 *                                          would change anything — the row menu's enabled items
 *                             `colours`    the live colour-by scheme's value → colour map,
 *                                          when this window asked for it
 *                             `define`     a schedule the assistant made or changed
 *                                          (2026-09-28): shown as the current, unsaved one,
 *                                          on this window's own undo history
 *                             `export`     the assistant's `export_schedule` (2026-09-28): run
 *                                          the Export menu's own action for one entry, which
 *                                          opens the native Save dialog; answered by `exportAck`
 *                             `manage`     the assistant's `manage_schedules` (2026-10-02): one
 *                                          of the window's own actions — undo, redo, a template,
 *                                          a saved setup, Print, Open schedule file — by name;
 *                                          answered by `manageAck`
 *   Schedules → main window   `current`    the schedule on screen and its row count
 *                                          (2026-09-28), so the assistant can see it — on
 *                                          connect and after every change, at most one per
 *                                          250 ms
 *                             `select`     federation ids to select, through the same
 *                                          `select(ids, zoom)` the element tree uses
 *                             `act`        the row menu: the main ContextMenu's own store
 *                                          actions (select, zoom, isolate, hide, show, showAll)
 *                             `colourBy`   a column's values and their ids, for the legend
 *                             `clearColours`  the legend's own clear
 *                             `exportAck`  whether an `export` was started, or the menu's
 *                                          reason it was not (2026-09-28) — at once, never
 *                                          after the dialog
 *                             `manageAck`  what became of a `manage` (2026-10-02) — done, asked,
 *                                          or why not — at once, never after a dialog; and, for
 *                                          the two lists, the names: bounded, and only on demand
 *
 * Main-side ids are admitted by `admitIds` / `admitGroups`: a list longer than the federation
 * cannot be a real selection and is ignored whole; duplicates and ids the federation does not
 * carry are dropped.
 *
 * A schedule definition crosses in both directions since 2026-09-28, and each end treats the
 * other's as untrusted: `DefShape` bounds every array and string and types every field
 * reference, and the receiver then runs ifcTable's own `parseScheduleDef` over it before
 * anything reads it.
 */
import { z } from 'zod'
import { OP_LABELS } from './schedule/compare'
import { CORE_KEYS, MAX_FILTERS, MAX_SORT_LEVELS, type CoreKey, type Op } from './schedule/def'

const Cell = z.object({
  v: z.union([z.string(), z.number(), z.boolean()]),
  k: z.enum(['length', 'area', 'volume', 'angle', 'mass', 'count', 'none']).optional()
})

const Core = z.object({
  entity: z.string(),
  name: z.string(),
  description: z.string(),
  mark: z.string(),
  typeName: z.string(),
  family: z.string(),
  objectType: z.string(),
  predefinedType: z.string(),
  guid: z.string(),
  storey: z.string(),
  storeyElevation: z.number().nullable(),
  building: z.string(),
  site: z.string(),
  space: z.string(),
  material: z.string(),
  discipline: z.enum(['ARC', 'STR', 'MEP', 'OTHER']),
  model: z.string().optional()
})

const Meta = z.object({
  fileName: z.string(),
  schema: z.string(),
  projectName: z.string(),
  authoringTool: z.string(),
  lengthUnit: z.string(),
  unitSystem: z.enum(['metric', 'imperial']),
  elementCount: z.number(),
  parseMs: z.number()
})

const Snapshot = z
  .object({
    meta: Meta,
    cores: z.array(Core),
    cells: z.array(z.record(z.string(), Cell)),
    rowIds: z.array(z.number().int())
  })
  .refine((s) => s.cells.length === s.cores.length && s.rowIds.length === s.cores.length)

/** The longest displayed value a colour group or a swatch is keyed by. */
export const MAX_COLOUR_VALUE = 1000

/**
 * The most distinct values "Colour 3D by this column" will colour. `SCHEME` has eleven colours,
 * so at 100 values each colour already stands for nine, and the legend — 230 px wide, as tall as
 * the stage allows — is a long scroll; the assistant's own colour-by reports at most fifty
 * groups. 100 is twice that, and every column that reads as colours fits well inside it (the
 * reference model's largest category, IfcMember, has 8 types; the demo's walls 5 levels and 2
 * models). A column over it — a GUID, a Mark, a length to the millimetre — cannot be read as
 * colours, so the table refuses it and says why, and neither message may carry more.
 */
export const MAX_COLOUR_GROUPS = 100

const Id = z.number().int()
/** A colour this window writes into a `style` attribute: the fixed `SCHEME` hexes only. */
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/* ────────────────────────────── a schedule definition (2026-09-28) ────────────────────────────── */

/** The longest definition either window accepts over the port, as JSON. */
export const MAX_DEF_CHARS = 200_000
/** The most columns a definition may carry over the port. */
export const MAX_DEF_COLUMNS = 200
/** The most calculated values a definition may carry over the port. */
export const MAX_DEF_CALCULATED = 100

const FieldRefShape = z.union([
  z.object({ kind: z.literal('core'), key: z.enum(CORE_KEYS as [CoreKey, ...CoreKey[]]) }),
  z.object({ kind: z.literal('prop'), pset: z.string().max(200), prop: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('formula'), id: z.string().min(1).max(100) })
])
const OPS = Object.keys(OP_LABELS) as [Op, ...Op[]]
const Scalar = z.union([z.string().max(1000), z.number(), z.boolean()])

/**
 * What a definition must look like before `parseScheduleDef` is even asked: bounded, and with
 * every field reference one of the three kinds the engine resolves. Everything else a column,
 * a calculated value or the appearance carries is `parseScheduleDef`'s to clean.
 */
export const DefShape = z
  .object({
    version: z.number(),
    name: z.string().max(1000),
    entity: z.array(z.string().max(200)).max(64),
    columns: z.array(z.object({ field: FieldRefShape }).passthrough()).max(MAX_DEF_COLUMNS),
    calculated: z
      .array(
        z
          .object({
            id: z.string().max(100),
            name: z.string().max(200),
            formula: z.string().max(4000).optional()
          })
          .passthrough()
      )
      .max(MAX_DEF_CALCULATED)
      .optional(),
    filters: z
      .array(
        z
          .object({
            field: FieldRefShape,
            op: z.enum(OPS),
            value: Scalar.optional(),
            values: z.array(z.union([z.string().max(1000), z.number()])).max(200).optional()
          })
          .passthrough()
      )
      .max(MAX_FILTERS),
    sort: z
      .array(z.object({ field: FieldRefShape, dir: z.enum(['asc', 'desc']) }).passthrough())
      .max(MAX_SORT_LEVELS)
  })
  .passthrough()
  .refine((d) => JSON.stringify(d).length <= MAX_DEF_CHARS, {
    message: `over ${MAX_DEF_CHARS} characters`
  })

/** What the Schedules window's toast says it was: made from chat, or changed from chat. */
export const DEFINE_KINDS = ['made', 'edited'] as const

export const DefineMessage = z.object({
  type: z.literal('define'),
  kind: z.enum(DEFINE_KINDS),
  def: DefShape
})

export const StoreMessage = z.object({ type: z.literal('store'), snapshot: Snapshot })
export const ThemeMessage = z.object({ type: z.literal('theme'), theme: z.enum(['dark', 'light']) })
export const SelectionMessage = z.object({
  type: z.literal('selection'),
  ids: z.array(Id),
  /** The selection came from this window (or is a re-send): mark the rows, never scroll. */
  quiet: z.boolean()
})
export const VisMessage = z.object({
  type: z.literal('vis'),
  /** Ids in the main window's manual `hidden` set — what Hide adds and Show removes. */
  hidden: z.array(Id),
  /** Elements in the federation: Isolate hides every other one. */
  total: z.number().int().nonnegative(),
  /** No storey is switched off — Isolate also resets the storeys. */
  storeysClean: z.boolean(),
  /** Show all would change nothing: nothing hidden, no storey or model off, no step on. */
  allShown: z.boolean()
})
export const ColoursMessage = z.object({
  type: z.literal('colours'),
  /** A colour-by scheme is on in the main window, whoever set it. */
  live: z.boolean(),
  /** The column key this window sent with `colourBy`, while that scheme is the live one. */
  key: z.string().max(400).nullable(),
  entries: z.array(z.object({ value: z.string().max(MAX_COLOUR_VALUE), color: Hex })).max(MAX_COLOUR_GROUPS)
})

/* ────────────────────────────── export from chat (2026-09-28) ────────────────────────────── */

/**
 * The Export menu's four entries, by the names `export_schedule` gives them. The catalogue
 * spells the same list (`shared/tool-schemas.ts` `SCHEDULE_EXPORT_FORMATS`), so the main
 * process does not load this module; a unit test keeps the two identical.
 */
export const EXPORT_FORMATS = ['xlsx', 'csv', 'all_saved', 'schedule_file'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** Why the Schedules window did not run an export the assistant asked for — the menu's own rules. */
export const EXPORT_REFUSALS = ['busy', 'no_schedule', 'nothing_saved'] as const
export type ExportRefusal = (typeof EXPORT_REFUSALS)[number]

/**
 * Run the Export menu's own action for `format`, which opens the native Save dialog attached to
 * the Schedules window. A format and a request number — no name, no path, no content, and no
 * other key: `.strict()` refuses one.
 */
export const ExportMessage = z
  .object({ type: z.literal('export'), n: z.number().int().nonnegative(), format: z.enum(EXPORT_FORMATS) })
  .strict()

/* ────────────────────────────── the window's own actions (2026-10-02) ────────────────────────────── */

/**
 * `manage_schedules` — parity with the user, phase 4: what the Schedules window's own controls
 * do, asked for from chat. Each is the control's own handler, run in that window
 * (`schedule-ui/actions.ts`); what crosses the port is **which one**, and a name.
 *
 *   undo · redo            the header's two buttons (that window's history)
 *   templates              the template gallery's cards, listed
 *   apply_template         a click on one
 *   saved_list             My templates, listed
 *   load · save · rename · duplicate   the panel's own buttons
 *   delete                 its Delete — which only raises that window's own confirm dialog
 *   print                  the header's Print — after that window's own confirm, raised first:
 *                          the native print dialog's default button prints
 *   open_file              "Open schedule file…" — the native Open dialog
 *
 * Opening the window is not one of them: that is main's, through the toolbar button's own call.
 */
export const MANAGE_OPS = [
  'undo',
  'redo',
  'templates',
  'apply_template',
  'saved_list',
  'load',
  'save',
  'rename',
  'duplicate',
  'delete',
  'print',
  'open_file'
] as const
export type ManageOp = (typeof MANAGE_OPS)[number]

/**
 * How long the asker waits for `manageAck`, and how old a request the window will still act on.
 * The window's limit is the shorter one: whatever it does, it answers within the asker's wait.
 * A Schedules renderer held up by a modal dialog — the print dialog blocks its scripts — works
 * through what queued up when the dialog closes, and must not then save, load or print for a
 * request the assistant gave up on minutes ago. Both pages read the same clock.
 */
export const MANAGE_ACK_MS = 3000
export const MANAGE_FRESH_MS = 2000

/** The longest name — a saved setup's, a template's — that crosses the port in either direction. */
export const MANAGE_NAME_MAX = 200
/** Saved setups one list carries: the window keeps a hundred (`schedule-ui/schedules.ts`). */
export const MANAGE_SAVED_MAX = 100
/** Templates one list carries. The app ships fifteen. */
export const MANAGE_TEMPLATES_MAX = 60
/** IFC classes named beside one saved setup or template. */
export const MANAGE_CLASSES_MAX = 12

/**
 * A name that may cross the port: at most `MANAGE_NAME_MAX` characters, and none of them a
 * control character or one of Unicode's invisible direction and width marks. A saved setup's
 * name is whatever the user typed (or a `.schedule.json` carried), it is read by the model and
 * shown in a result, and a name that cannot be shown as it is cannot be named back — so one
 * that fails this is **counted, never sent**, and a request that carries one is refused whole.
 */
export const SafeName = z
  .string()
  .min(1)
  .max(MANAGE_NAME_MAX)
  .regex(/^[^\p{Cc}\u200B-\u200F\u202A-\u202E\u2066-\u2069]*$/u)

/** True when `name` may be sent as it is. */
export const isSafeName = (name: unknown): name is string => SafeName.safeParse(name).success

/**
 * One request to the Schedules window. An op, a request number, at most two names and one flag
 * — nothing else, and `.strict()` refuses anything else: no definition, no path, no content.
 *
 * `ask` is whether the window may put a question of its own in front of the user for this
 * request — the assistant's turn asks for one thing, and main knows whether it already has
 * (`ai/executors/index.ts`, `waitingOn`). With `ask: false` a request that would need one is
 * answered `held`, and nothing is raised.
 */
export const ManageMessage = z
  .object({
    type: z.literal('manage'),
    n: z.number().int().nonnegative(),
    /** When it was asked, in epoch milliseconds: a request older than `MANAGE_FRESH_MS` is dropped. */
    at: z.number().int().nonnegative(),
    op: z.enum(MANAGE_OPS),
    /** The saved setup, or the template, the op is about. */
    name: SafeName.optional(),
    /** `rename`: the new name. */
    to: SafeName.optional(),
    ask: z.boolean()
  })
  .strict()

/** Everything the Schedules window accepts. */
export const ToSchedules = z.discriminatedUnion('type', [
  StoreMessage,
  ThemeMessage,
  SelectionMessage,
  VisMessage,
  ColoursMessage,
  DefineMessage,
  ExportMessage,
  ManageMessage
])

export const SelectMessage = z.object({
  type: z.literal('select'),
  ids: z.array(Id),
  zoom: z.boolean()
})

/** The row menu's actions — each one a store action the main window's own ContextMenu calls. */
export const ACT_KINDS = ['select', 'zoom', 'isolate', 'hide', 'show', 'showAll'] as const
export const ActMessage = z.object({
  type: z.literal('act'),
  kind: z.enum(ACT_KINDS),
  ids: z.array(Id)
})
export const ColourByMessage = z.object({
  type: z.literal('colourBy'),
  /** The column's heading: the legend's title. */
  label: z.string().min(1).max(200),
  /** Which column, so the swatches can find it again. */
  key: z.string().max(400),
  groups: z
    .array(z.object({ value: z.string().min(1).max(MAX_COLOUR_VALUE), ids: z.array(Id) }))
    .max(MAX_COLOUR_GROUPS)
})
export const ClearColoursMessage = z.object({ type: z.literal('clearColours') })
/**
 * The schedule on screen; `null` while the window shows none (no model, or no category). With
 * it, the rows the table shows — so the assistant's view state never has to run the engine.
 */
export const CurrentMessage = z.object({
  type: z.literal('current'),
  def: DefShape.nullable(),
  rowCount: z.number().int().min(0).max(100_000_000)
})

/**
 * The answer to `export`, sent at once — never after the dialog: `refused` null means the
 * menu's action was started and its Save dialog asked for; otherwise the menu's own reason.
 */
export const ExportAckMessage = z
  .object({ type: z.literal('exportAck'), n: z.number().int().nonnegative(), refused: z.enum(EXPORT_REFUSALS).nullable() })
  .strict()

/**
 * What became of a `manage` request — sent at once, never after a dialog:
 *
 *   done         it was done
 *   asked        the window has put its own question in front of the user — its confirm
 *                dialog (a deletion, the print dialog, a save that would forget), the Open
 *                dialog — and nothing has happened yet
 *   held         it would need such a question, and the request said none may be asked
 *   nothing      there was nothing to do: nothing to undo or redo, nothing to save
 *   missing      no saved setup, or no template, of that name
 *   taken        a rename onto a name another saved setup has
 *   failed       the window's storage refused the write
 *   busy         a dialog of the window's is already up
 *   no_schedule  the window shows no schedule — no model, or no category
 */
export const MANAGE_RESULTS = [
  'done',
  'asked',
  'held',
  'nothing',
  'missing',
  'taken',
  'failed',
  'busy',
  'no_schedule'
] as const
export type ManageResult = (typeof MANAGE_RESULTS)[number]

/** How a save or a duplicate would take a saved setup away: over its own copy, or off the end of the list. */
export const MANAGE_FORGETS = ['replace', 'evict'] as const

const Count = z.number().int().min(0).max(100_000_000)

/** One card of the template gallery. Its text is the app's own, never the file's. */
const TemplateRow = z
  .object({
    id: SafeName,
    name: SafeName,
    classes: z.array(SafeName).max(MANAGE_CLASSES_MAX),
    columns: z.number().int().min(0).max(MAX_DEF_COLUMNS),
    /** How many of those columns the loaded models carry a value for — the card's own fit. */
    fit: z.number().int().min(0).max(MAX_DEF_COLUMNS),
    /** Elements it would list. */
    elements: Count,
    inUse: z.boolean()
  })
  .strict()

/** One saved setup, as My templates lists it. */
const SavedRow = z
  .object({
    name: SafeName,
    classes: z.array(SafeName).max(MANAGE_CLASSES_MAX),
    columns: z.number().int().min(0).max(MAX_DEF_COLUMNS),
    /** The day it was saved, `YYYY-MM-DD`, or `''`. */
    saved: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
    inUse: z.boolean(),
    /** Saved against another model: this one has none of some class it names. */
    lacks: z.boolean()
  })
  .strict()

/**
 * The answer to `manage`. Bounded field by field, and `.strict()`: a result, and — only for the
 * op that has it — a name, a count, or one of the two lists, which are the one place a saved
 * setup's name ever crosses the port. Nothing about a file, a path or a definition.
 */
export const ManageAckMessage = z
  .object({
    type: z.literal('manageAck'),
    n: z.number().int().nonnegative(),
    result: z.enum(MANAGE_RESULTS),
    /** The name it was saved, copied, loaded, applied or renamed as. */
    name: SafeName.optional(),
    /** `undo` / `redo`: the steps left each way afterwards. */
    undo: z.number().int().min(0).max(1000).optional(),
    redo: z.number().int().min(0).max(1000).optional(),
    /** `load`: how many of the setup's classes the loaded models have none of. */
    lacks: z.number().int().min(0).max(MANAGE_CLASSES_MAX * 8).optional(),
    /** `save` / `duplicate`, when `asked` or `held`: how a saved setup would be lost… */
    forgets: z.enum(MANAGE_FORGETS).optional(),
    /** …and which one, when its name can be sent. */
    gone: SafeName.optional(),
    templates: z.array(TemplateRow).max(MANAGE_TEMPLATES_MAX).optional(),
    saved: z.array(SavedRow).max(MANAGE_SAVED_MAX).optional(),
    /** `saved_list`: setups not listed because their names cannot cross (`SafeName`). */
    unlisted: z.number().int().min(0).max(MANAGE_SAVED_MAX).optional()
  })
  .strict()

/** Everything the main window accepts from the Schedules window. */
export const FromSchedules = z.discriminatedUnion('type', [
  SelectMessage,
  ActMessage,
  ColourByMessage,
  ClearColoursMessage,
  CurrentMessage,
  ExportAckMessage,
  ManageAckMessage
])

export type SelectMessage = z.infer<typeof SelectMessage>
export type ManageRequest = z.infer<typeof ManageMessage>
export type ManageAck = z.infer<typeof ManageAckMessage>
export type ActKind = (typeof ACT_KINDS)[number]
export type ColourGroup = z.infer<typeof ColourByMessage>['groups'][number]

/** What the main window's `byId` offers the guards below. */
export interface KnownIds {
  readonly size: number
  has(id: number): boolean
}

/**
 * The ids a message may act on. More ids than the federation holds cannot be a real set of
 * rows — `null`, ignored whole rather than trimmed. Otherwise duplicates go, and so does any
 * id the federation no longer carries (ids are per session).
 */
export function admitIds(ids: readonly number[], known: KnownIds): number[] | null {
  if (ids.length > known.size) return null
  return [...new Set(ids)].filter((id) => known.has(id))
}

/**
 * `admitIds` for a colour-by: the same bound over every group's ids together, and an element
 * lands in the first group that names it, so no element is claimed by two colours.
 */
export function admitGroups(groups: readonly ColourGroup[], known: KnownIds): ColourGroup[] | null {
  let n = 0
  for (const g of groups) n += g.ids.length
  if (n > known.size) return null
  const seen = new Set<number>()
  const out: ColourGroup[] = []
  for (const g of groups) {
    const ids: number[] = []
    for (const id of g.ids) {
      if (!known.has(id) || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
    if (ids.length) out.push({ value: g.value, ids })
  }
  return out
}
