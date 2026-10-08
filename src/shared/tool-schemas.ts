/**
 * The assistant's tool catalogue — the one place a tool exists at all.
 *
 * The first fifteen are `SGVue.dc.html:1358–1568`'s `chatTools()`, **name, description and
 * input schema verbatim**, with exactly two deliberate corrections the plan asks for
 * (§3.5 defect 3):
 *
 *   · `combine` is one enum — `replace | append` — on both tools that take it. The design
 *     spells it `replace|append` on `set_filter_stack` and `replace|add` on
 *     `apply_visibility`, so the same word meant two things; the prompt's own sentence says
 *     `combine:"add"` and is corrected to `combine:"append"` in `prompt.ts`.
 *   · Every object schema carries `additionalProperties: false`, which `strict: true`
 *     requires. It is invisible — a tool schema is sent to the model, never rendered.
 *
 * `set_section` keeps the design's four inputs, and since 2026-10-01 (owner-requested: the
 * gridline cut and the level cut are two independent planes) its description says what a `kind`
 * now means: that plane only, `null` for both, a `kind` with no name to clear just that one.
 * The same day it gained one input, `cut`, and its defaults became the Section card's own —
 * the owner, asked whether an assistant-made section should actually cut: *"yes. assistant
 * should possess everything user can do on the app. that would be the best case scenario."*
 * So a new plane set by the tool cuts unless `cut:false` asks for the preview, at the chip's
 * default offset for the kind when `offset` is omitted — and on a plane already set at that
 * name only what the call passes changes: an omitted `offset`, `flip` or `cut` keeps what the
 * plane has.
 *
 * The ten after them are the plan's read-only additions (§4 Phase 9, §5): they make
 * "maximum read capability" true without adding a designed surface or a write path.
 *
 * The last four (2026-09-28) reach the Schedules window: `make_schedule` builds or changes the
 * schedule it shows, `get_schedule` reads it, `export_schedule` runs one entry of its Export
 * menu and `color_by_schedule_column` its heading menu's "Colour 3D by this column". A schedule
 * is a view of the model — the table is the Schedules window's, and none of them touches model
 * data, a file or a path.
 *
 * **2026-10-02 — parity with the user, phase 1 of 4.** The owner, 2026-10-01: *"assistant should
 * possess everything user can do on the app. that would be the best case scenario."* This phase
 * makes the reversible view state it could not reach reachable, each through the store action
 * the control itself calls:
 *
 *   · `toggle_display` gains `groundGrid` (the canvas grid — recorded on 2026-09-24 as not
 *     reachable by the assistant; that record is amended), `snap` and `originalMaterials`;
 *   · `select_elements` gains `mode` — replace, add, remove, clear;
 *   · `apply_visibility` gains the actions `undo` and `redo`;
 *   · `color_models` takes `null` for one key, the palette's own `reset`;
 *   · two new view tools, in a group of their own (`PARITY_TOOLS`): `set_models`, the eye beside
 *     each model, and `set_interface`, the app's own settings — theme, units, tree mode, sidebar,
 *     card, armed tool, tree search, and opening the Schedules window.
 *
 * And `get_view_state` says what it reads back. Nothing here reaches the camera, a viewpoint, a
 * markup, a file, the clipboard or anything inside the Schedules window: those are later phases.
 *
 * **2026-10-02 — phase 2 of 4: the camera, saved viewpoints, markups, one filter step.**
 *
 *   · `set_view` gains `fit` (frame the building or the selection without turning — a
 *     double-click on empty space, and F), `azimuth` and `elevation` (any direction, in degrees
 *     in the project frame — `shared/view-angles.ts` — which reaches every one of the view
 *     cube's 26 and anything between) and `zoom` (a factor on the fit);
 *   · `manage_filters` gains the op `update` — one step's action, rules or highlight colour
 *     changed in place, which until now meant rebuilding the stack and losing its step ids, the
 *     colours the user picked and which steps were off — and `set_filter_stack` an optional
 *     `color` per step;
 *   · two more view tools in `PARITY_TOOLS`: `manage_views`, the Viewpoints card (list, save,
 *     restore, rename), and `manage_markups`, the Markups card (list, zoom to one).
 *
 * **No deleting, and nothing with an effect outside the view**: a viewpoint or a markup is not
 * removed here, and a markup is not placed. Those wait for the consent rule of phase 3 and for
 * phase 4. 35 tools.
 *
 * **2026-10-02 — phase 3 of 4: the consent gate.** What reaches outside the view or cannot be
 * undone is never done by the assistant. The owner, asked how it should handle those: the
 * recommendation — *the assistant proposes, and you click Apply in the chat or pick in the
 * Windows dialog* — was confirmed, *"correct."* The reason is prompt injection: text authored in
 * an IFC file reaches the model through tool results, and must never be able to open, unload,
 * delete, copy or re-georeference anything by itself. So these only **ask**, through a surface
 * the app already has, and the user's own click is what does it (`ToolGate`, below):
 *
 *   · one new view tool, `request_user_action`: open model files (the native Open dialog), open
 *     a recent file, unload a model (the sidebar's own "Unload …?" confirmation), and copy the
 *     share link or GlobalIds — and, until 2026-10-08, when the owner made the Coordinate-system
 *     card read-only, change the base point;
 *   · `manage_views` gains `delete`, `manage_markups` `delete` and `clear`, and `manage_filters`'
 *     `delete_set` — immediate until now — is asked for like the rest; so is a `save_set` that
 *     would forget a saved set, by replacing one of the same name or pushing the oldest out;
 *   · an undo, a redo or a viewpoint restore the scope guard catches is held behind Apply,
 *     where phases 1 and 2 could only refuse it in words.
 *
 * 36 tools. Not reachable, and not to be: the API key and every Preferences setting, quit,
 * reload and DevTools, the consent clicks themselves, and anything that writes model data.
 *
 * **2026-10-02 — phase 4 of 4: the Schedules window, and placing markups.**
 *
 *   · `make_schedule` gains what that window's Filter, Sorting and Format tabs and its
 *     calculated-value editor set: `filterLogic`, `itemize`, per column `hidden`, `decimals`,
 *     `unit`, `align` and a position (`after`), and `calculated` columns in the engine's own
 *     formula grammar — refused, with the engine's reason, when one does not parse;
 *   · `schedule: true` beside `ids` and `selection` on `apply_visibility`, `select_elements`,
 *     `color_by_property` and `request_user_action`'s `copy_guids`: the elements the open
 *     schedule lists, resolved in the main renderer and acted on through the store's own guarded
 *     actions — never through the Schedules port's `act` message, which has no scope guard;
 *   · one more view tool in `PARITY_TOOLS`, `manage_schedules`: that window's own controls —
 *     open it, its undo and redo, the template gallery, My templates (list, load, save, rename,
 *     duplicate) — each run there by the control's own handler. Deleting a saved setup, printing
 *     and opening a schedule file only **ask** — that window's own confirmation before a
 *     deletion and before its print dialog is opened, its native Open dialog — and so does a
 *     save or a duplicate that would forget a saved setup;
 *   · `manage_markups` gains `place_spot`, `place_measure` and `show`: the click with the spot
 *     tool or the laser meter, at a point that is named — an element's box, or a project-frame
 *     point — and committed by the viewer's own function for that click.
 *
 * 37 tools. Deliberately left out (`docs/DECISIONS.md` has each reason): a schedule's column
 * widths, auto-fit and equal width, its appearance panel and print layout; dragging the
 * sidebar's and the panels' sizes; folding a property-card section; the chat panel's own
 * controls.
 *
 * **Three rules hold for every entry, and `tests/readonly-guard.test.ts` enforces them:**
 *   · `kind` is `'read'` (reports what is there) or `'view'` (changes what is shown). There
 *     is no third kind, because there is no third thing the assistant may do.
 *   · No tool names or accepts a file, a path, a file name to write or file content, and no
 *     tool writes. The assistant has no file system. (`request_user_action`'s `recent` is the
 *     **name** of a file already on the app's own recent list — matched against that list,
 *     never opened as given, and refused when it holds a path separator.)
 *   · **A tool that may open a native dialog, or ask the user to decide anything, says so in
 *     `gate`**, and the guard pins the whole list. Three tools open a dialog: `export_schedule`
 *     the Schedules window's Save dialog (owner-approved 2026-09-28 — it takes a format and
 *     nothing else, and only the user's click on Save writes, through `main/exports.ts`; the
 *     guard names it as the one tool whose name may say "export"), `request_user_action`
 *     with `open_files` the Open dialog, where the user's pick loads, and — phase 4 —
 *     `manage_schedules` with `open_file`, the Schedules window's Open dialog for a schedule
 *     file, raised by that window's own control. (`print` opened the print dialog straight from
 *     chat until the same day's follow-up: that dialog's default button prints, so it now asks
 *     in the Schedules window's own confirm, and only the user's click there opens it.)
 */
import { HL } from './colors'
import { LEVEL_DEFAULT_OFFSET_MM } from './sections'

/* ────────────────────────────── schema shapes ────────────────────────────── */

/** A JSON Schema node, as much of one as a tool definition ever needs. */
export interface JsonSchema {
  type?: string | readonly string[]
  description?: string
  enum?: readonly (string | number | boolean | null)[]
  items?: JsonSchema
  properties?: Readonly<Record<string, JsonSchema>>
  required?: string[]
  additionalProperties?: boolean
  minimum?: number
  maximum?: number
  /** The SDK's own `Tool.InputSchema` carries one, so ours has to be assignable to it. */
  [key: string]: unknown
}

export interface JsonObjectSchema extends JsonSchema {
  type: 'object'
  properties: Readonly<Record<string, JsonSchema>>
}

/**
 * What a tool does to the app. `read` answers a question about the model; `view` changes
 * what is on screen through the same store actions the buttons call, so an assistant action
 * is undoable exactly like a manual one.
 */
export type ToolKind = 'read' | 'view'

/**
 * Where a gated request is put in front of the user (2026-10-02, the consent gate):
 *
 *   · `apply`   — the chat's pending row under the reply: its Apply does it, its Cancel drops it;
 *   · `dialog`  — a native dialog the user answers: Open, Save — and, since phase 4, the
 *                 Schedules window's Open for a schedule file;
 *   · `confirm` — a confirmation the app itself draws beside the thing it is about: the designed
 *                 inline "Unload …?" in the sidebar, and (phase 4) the Schedules window's own
 *                 dialog, before a saved setup is deleted and before its print dialog is opened.
 *
 * In all three the tool has done nothing but ask, and is never told what the user decided.
 */
export type GateSurface = 'apply' | 'dialog' | 'confirm'

/**
 * Which calls of a tool only **ask** — never act — and through which surface.
 *
 * `by` is the input whose value decides (`op`, `action`), or `null` when every call of the tool
 * asks; `asks` maps each gated value of that input — or `'*'` — to its surface. A value that is
 * not listed is not gated: `manage_views`' `list` reads, its `delete` asks.
 *
 * It is not the scope guard. A change the guard holds back because it would leave under 5 % of
 * the model visible also waits behind Apply, but only when it would; what is marked here asks
 * **always**. `gateOf` reads the marker, `executeTool` uses it to keep a turn to one request,
 * and `tests/readonly-guard.test.ts` pins the whole list.
 */
export interface ToolGate {
  by: string | null
  asks: Readonly<Record<string, GateSurface>>
}

export interface ToolSpec {
  name: string
  kind: ToolKind
  description: string
  input_schema: JsonObjectSchema
  /**
   * `strict: true` guarantees the arguments validate against the schema. It is `false` on
   * exactly one tool: `color_models` takes a free-form `{modelKey: hex}` map, and a strict
   * object with no declared properties would reject every key it is meant to carry.
   */
  strict: boolean
  /** 2026-10-02 — the calls of this tool that only ask the user. Absent: none of them does. */
  gate?: ToolGate
}

/* ────────────────────────────── the rule list ────────────────────────────── */

/**
 * `SGVue.dc.html:1359`'s `RULES`, verbatim but for `additionalProperties`. Reused by every
 * tool that filters, which is what keeps the rule grammar identical across them.
 */
export const RULES: JsonSchema = {
  type: 'array',
  description: 'Rule list, ANDed unless a rule sets join:"or"',
  items: {
    type: 'object',
    properties: {
      prop: { type: 'string' },
      // `absent` is the one operator the design does not have (2026-09-20, user-approved):
      // it is true when the property is missing, null or an empty string, and it ignores
      // `val`. `val` stays required because `strict` copies `required` through as given and
      // the design declares it; pass "" with `absent`.
      op: {
        type: 'string',
        enum: ['=', '!=', '~', '>', '<', 'absent'],
        description:
          'absent means the property has no value at all — missing, null or empty — and ignores val; the Filter card shows it as "is empty"'
      },
      val: { type: 'string' },
      join: { type: 'string', enum: ['and', 'or'] }
    },
    required: ['prop', 'op', 'val'],
    additionalProperties: false
  }
}

/**
 * Element ids one call may carry (2026-09-20).
 *
 * An id list is a set, not a rule: it cannot be saved as a filter set, shared in a link or
 * re-evaluated when a model is added, and every id costs about five tokens on the wire. Two
 * thousand is above every found set a `query_sql` page can return (200 rows) and above every
 * entity group on the reference model except `IfcMember`; past it, the honest answer is a rule
 * — or SQL to find the set and a rule to express it.
 */
export const MAX_TOOL_IDS = 2000

/**
 * The `ids` / `selection` / `schedule` targets, identical on every tool that can act on a found
 * set. `schedule` is phase 4's (2026-10-02): the rows of the schedule open in the Schedules
 * window, as elements — what that window's row menu acts on, reached here through the main
 * window's own actions and guards. `MAX_TOOL_IDS` bounds `ids`, which the model sends; it does
 * not bound `selection` or `schedule`, which the app holds and the model only points at.
 */
const idTargets = (verb: string): Record<string, JsonSchema> => ({
  ids: {
    type: 'array',
    items: { type: 'number' },
    description: `Federation element ids to ${verb}, at most ${MAX_TOOL_IDS}. Use it for a set only query_sql or search can find; prefer rules whenever a rule can express the same set.`
  },
  selection: {
    type: 'boolean',
    // The third person's s goes on the verb, not on the end of the phrase: "acts on", where
    // this read "act ons" until 2026-10-02. "selects" and "colours" are as they were.
    description: `true ${verb.replace(/^\w+/, (word) => `${word}s`)} what the user currently has selected, whatever that is.`
  },
  schedule: {
    type: 'boolean',
    description: `true takes the elements the schedule open in the Schedules window lists — "what this schedule shows", however many — as the set to ${verb}. Prefer rules when the set can be said as a rule: only a rule can be saved and shared.`
  }
})

const obj = (
  properties: Record<string, JsonSchema>,
  required?: readonly string[]
): JsonObjectSchema => ({
  type: 'object',
  properties,
  ...(required ? { required: [...required] } : {}),
  additionalProperties: false
})

/* ────────────────────── phase 2's enums and bounds (2026-10-02) ────────────────────── */

/**
 * A filter step's highlight colour: the Filter card's six swatches (`shared/colors.ts`, `HL`),
 * and nothing else — the user cannot pick another, so neither can the assistant.
 */
export const STEP_COLORS: readonly string[] = HL

/** `set_view`'s `fit`: frame the whole building, or what is selected. */
export const VIEW_FITS = ['extents', 'selection'] as const

/** `set_view`'s `zoom` is a factor on the fit; past these it is refused before it is read. */
export const VIEW_ZOOM_MIN = 0.1
export const VIEW_ZOOM_MAX = 20

/**
 * The six named views as azimuth / elevation, as `set_view`'s description states them and as
 * `get_view_state` reads them back — to the tenth of a degree the read-back is rounded to, so a
 * model that sends the description's own numbers is told it stands on that view. (`iso` was
 * quoted as 315 / 30 until the review of 2026-10-02: the rig's is 29.8, 30 is 0.003 rad off it,
 * and the camera read back `view: null`.) `tests/unit/view-angles.test.ts` holds each to the
 * camera's own table (`shared/view-angles.ts`), both ways.
 */
export const VIEW_DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  south: [0, 0],
  west: [90, 0],
  north: [180, 0],
  east: [270, 0],
  top: [0, 90],
  iso: [315, 29.8]
}

/**
 * `manage_views`: what can be done with a saved viewpoint here. `delete` (2026-10-02, phase 3)
 * only asks — a deleted viewpoint cannot be brought back, so the user's Apply is what deletes.
 */
export const VIEW_OPS = ['list', 'save', 'restore', 'rename', 'delete'] as const
/** A viewpoint's name, when the assistant gives one. The card's own field has no limit. */
export const VIEW_NAME_MAX = 80

/**
 * A saved filter set's name, as `manage_filters` takes it (2026-10-02, the gate's review): the
 * bound `manage_views`' name lookup has. The name is the model's own text, it is stored in
 * `localStorage`, and it is shown in the Filter card and in a pending label.
 */
export const FILTER_SET_NAME_MAX = 200
/** Viewpoints one result lists, and the most the assistant will add to: past it, it says so. */
export const VIEWPOINTS_CAP = 20
export const VIEWPOINTS_SAVE_CAP = 50

/**
 * `manage_markups`: read them, zoom to one — and, since phase 3, ask the user to delete one or
 * to clear a list. Phase 4: place a spot coordinate or a laser measurement, and set a spot
 * tag's state.
 */
export const MARKUP_OPS = ['list', 'focus', 'place_spot', 'place_measure', 'show', 'delete', 'clear'] as const
/** `manage_markups`' `clear`: the Markups card's two lists, each with a `clear` of its own. */
export const MARKUP_KINDS = ['measures', 'spots'] as const
/** Markups of each kind one result lists. */
export const MARKUPS_CAP = 50

/* ────────────────────── phase 3's enums and bounds (2026-10-02) ────────────────────── */

/**
 * `request_user_action`: what the assistant may ask the user to do. Every one of them reaches
 * outside the view or cannot be undone, so none is ever done by the tool (`ToolGate`).
 */
export const REQUEST_ACTIONS = [
  'open_files',
  'open_recent',
  'unload_model',
  'copy_link',
  'copy_guids'
] as const

/** A recent file is **named**, never located: the longest name a file system gives a file. */
export const RECENT_NAME_MAX = 255
/** Recent files' names as one result lists them. The app keeps six (`RECENTS_MAX`). */
export const RECENT_NAME_CHARS = 120

/* ────────────────────── phase 4's enums and bounds (2026-10-02) ────────────────────── */

/**
 * `manage_schedules`: the Schedules window's own controls. `open` is this side's — the toolbar
 * button's call; every other one is run in that window by the control's own handler
 * (`schedule/messages.ts` `MANAGE_OPS`, which a unit test holds this list to). The last three
 * only ask — that window's own confirm before a deletion and before the print dialog, and its
 * Open dialog.
 */
export const SCHEDULE_MANAGE_OPS = [
  'open',
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
/** A saved setup's or a template's name, as a call may send it (`MANAGE_NAME_MAX`, held equal by a test). */
export const SCHEDULE_NAME_MAX = 200

/**
 * `manage_markups`' two placing operations: where on an element's bounding box the point is
 * taken — the middle of its top face, of the box itself, or of its underside.
 */
export const MARKUP_PLACES = ['top', 'centre', 'base'] as const
/** A spot tag's two states: its level alone (how every new one stands), or its full E / N / Z. */
export const SPOT_SHOWS = ['level', 'full'] as const
/** The most markups of one kind the assistant will add to: past it, it says so. */
export const MARKUPS_PLACE_CAP = 50
/** A point further out than this is not one: project-frame metres. */
export const MARKUP_POINT_MAX = 1e7

/* ────────────────────────────── the design's fifteen ────────────────────────────── */

const DESIGN_TOOLS: readonly ToolSpec[] = [
  {
    name: 'summarize_elements',
    kind: 'read',
    description:
      'Group the matching elements and total their quantities. Read-only. Renders as a table for the user, so keep your own reply to one sentence.',
    input_schema: obj(
      {
        rules: RULES,
        groupBy: {
          type: 'string',
          description:
            'Model, IfcEntity, PredefinedType, ObjectType, Level, or ANY property-set key from the schema (e.g. SpeciesCommonName, FireRating, Reference)'
        }
      },
      ['groupBy']
    ),
    strict: true
  },
  {
    name: 'audit_model',
    kind: 'read',
    description:
      'Run the data-completeness audit over the whole federation: elements missing PredefinedType, ObjectType, material, property sets or quantities, plus duplicate names and empty storeys. Read-only, local arithmetic, no arguments. Each finding comes back with a count and a clickable set, so it answers "is this model ready to submit" in one call. It does not check a value against a standard — use query_sql or list_values for that.',
    input_schema: obj({}),
    strict: true
  },
  {
    name: 'clash_check',
    kind: 'read',
    description:
      'Bounding-box interference candidates between two loaded models, swept over every currently visible element of each. Read-only. modelA and modelB must both be loaded and different. tolerance is metres of allowed overlap before a pair counts. This is an axis-aligned box test in the project frame, not solid geometry, so it over-reports for anything rotated or diagonal — always describe the results as candidates for review, never as clashes. At most 25 pairs come back, largest overlap first.',
    input_schema: obj(
      {
        modelA: { type: 'string' },
        modelB: { type: 'string' },
        tolerance: { type: 'number', description: 'metres of allowed overlap before it counts' }
      },
      ['modelA', 'modelB']
    ),
    strict: true
  },
  {
    name: 'set_filter_stack',
    kind: 'view',
    description:
      'Set the WHOLE ordered filter stack in one call. This is the main tool for any view with more than one condition — the array order IS the apply order. Use it instead of several apply_visibility calls.',
    input_schema: obj(
      {
        steps: {
          type: 'array',
          description:
            'Steps in apply order. Step 1 narrows the model, step 2 acts on what step 1 left.',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['isolate', 'hide', 'highlight'] },
              rules: RULES,
              // 2026-10-02 — the card's swatches. The design's own description is untouched.
              color: {
                type: 'string',
                enum: STEP_COLORS,
                description:
                  'A highlight step’s colour, one of the Filter card’s six. Omitted, the step takes the next one not in use.'
              }
            },
            required: ['action', 'rules'],
            additionalProperties: false
          }
        },
        combine: {
          type: 'string',
          enum: ['replace', 'append'],
          description: 'replace (default) starts a new stack; append adds to the existing one'
        }
      },
      ['steps']
    ),
    strict: true
  },
  {
    name: 'manage_filters',
    kind: 'view',
    // 2026-10-02: one sentence added — `enable` and `apply_set` are held to the scope guard.
    // The same day, phase 2: `update`, one step changed in place. Phase 3: `delete_set` only
    // asks — it forgot the set at once until then, and a forgotten set cannot be brought back —
    // and so does a `save_set` that would forget one (the same name, or a thirteenth set).
    description:
      'Inspect and rearrange the ordered filter stack — list steps, enable/disable one, reorder, remove, or clear — and save, recall or forget the current stack as a named filter set. Order matters: earlier steps constrain what later ones act on. update changes one step where it stands — its action, its rules (which replace the step’s list) or its highlight color, any of them — and leaves the rest of the stack exactly as the user has it: the other steps, their order, which are switched off and the colours they picked; use it rather than rebuilding the stack when one step is to change. save_set stores the live stack under name in the app’s own local storage beside the sets the user saves from the Filter card, apply_set rebuilds the stack from one, list_sets names them and delete_set asks the user to forget one: a forgotten set cannot be brought back, so it waits behind an Apply button under your reply, nothing is forgotten unless the user clicks it, and you are not told whether they did. A save_set that would forget a set — one of the same name, which it replaces, or the oldest once twelve are saved — waits behind that button in the same way, and saves nothing until the user clicks. A set holds rules, never element ids, and never any model data — the IFC file is not touched and cannot be. enable, update and apply_set are held to the same scope guard as apply_visibility: one that would leave nothing visible is refused, and one that would leave under 5 % waits for the user’s Apply.',
    gate: { by: 'op', asks: { delete_set: 'apply' } },
    input_schema: obj(
      {
        op: {
          type: 'string',
          enum: [
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
          ]
        },
        step: { type: 'number', description: '1-based step number' },
        to: { type: 'number', description: '1-based target position for move' },
        name: {
          type: 'string',
          description:
            `The filter set’s name, for save_set, apply_set and delete_set, at most ${FILTER_SET_NAME_MAX} characters. Matched exactly, then case-insensitively.`
        },
        // 2026-10-02 — `update`'s three, each optional: what is omitted is kept.
        action: {
          type: 'string',
          enum: ['isolate', 'hide', 'highlight'],
          description: 'For update: the step’s new action'
        },
        rules: RULES,
        color: {
          type: 'string',
          enum: STEP_COLORS,
          description: 'For update: a highlight step’s colour, one of the Filter card’s six'
        }
      },
      ['op']
    ),
    strict: true
  },
  {
    name: 'query_elements',
    kind: 'read',
    description:
      'Count and sample the elements matching a rule list, without changing anything. Read-only. Call it before any view tool when you are not certain a rule matches — it reports the count of each OR-group separately, so an empty category is visible, and on a miss it returns the valid entity names and property keys. It returns at most five example elements, never the whole set.',
    input_schema: obj({ rules: RULES }, ['rules']),
    strict: true
  },
  {
    name: 'apply_visibility',
    kind: 'view',
    // The design's own sentence, with `combine:"add"` corrected to `combine:"append"`
    // (plan §3.5 defect 3 — one enum across both tools), and the id targets appended.
    // 2026-10-02: plus `undo` and `redo`, the action bar's two buttons. Phase 3: a step the
    // guard catches waits behind Apply — it was refused in words until the pending row could
    // hold an action as well as a patch.
    description:
      'ONE filter step, or reset. For a view with several conditions use set_filter_stack instead. combine:"append" appends a step for "also"/"add"/"include" requests; omit action to keep the current one. Instead of rules you may pass ids (a set query_sql or search found), selection:true (what the user has selected now) or schedule:true (the elements the open schedule lists) — those hide, isolate or show exactly those elements through the same actions the right-click menu uses, so undo and the 5 % scope guard behave identically. Prefer rules whenever a rule can express the set: a rule step is visible in the Filter card, can be saved as a filter set and survives a model being reloaded, and an id list does none of that. action:"undo" steps what is visible back one change and action:"redo" forward again — the action bar’s Undo and Redo: hidden elements, storeys, models, the filter stack and the active model, whoever changed them last. They take nothing else, change nothing when there is nothing to step to and run the same scope guard: a step that would take elements out of view and leave nothing visible, or under 5 %, is not taken until the user clicks Apply under your reply. The result says whether more can be undone or redone.',
    input_schema: obj({
      rules: RULES,
      action: {
        type: 'string',
        enum: ['isolate', 'hide', 'highlight', 'show', 'reset', 'undo', 'redo']
      },
      combine: { type: 'string', enum: ['replace', 'append'] },
      ...idTargets('act on')
    }),
    strict: true
  },
  {
    name: 'select_elements',
    kind: 'view',
    description:
      'Select the matching elements, optionally zooming to them. Use it when the user wants to see or inspect a set without changing what is visible — selection drives the property card and the dimension read-out. It does not hide, isolate or colour anything; for that use apply_visibility or set_filter_stack. Pass rules, or ids for a set query_sql or search found, or selection:true to re-select and zoom to what is already selected, or schedule:true for the elements the open schedule lists; prefer rules whenever a rule can express the same set, because ids are per session. mode says what happens to the selection the user already has: replace (the default) selects exactly the set, add adds the set to it, remove takes the set out of it — a Ctrl+click, for a whole set — and clear deselects everything and needs no set. zoom defaults to true for replace — pass zoom:false to keep the camera where it is — and to false for add and remove; clear never moves the camera. Selecting nothing leaves the current selection alone.',
    input_schema: obj({
      rules: RULES,
      zoom: { type: 'boolean' },
      // 2026-10-02 — a tree click, a Ctrl+click and Esc, for a whole set.
      mode: { type: 'string', enum: ['replace', 'add', 'remove', 'clear'] },
      ...idTargets('select')
    }),
    strict: true
  },
  {
    name: 'set_storeys',
    kind: 'view',
    description:
      'Show only the named storeys, or all of them when the list is empty. Names must match the storey list exactly; a wrong name changes nothing and returns the valid names. This is independent of the filter stack — a storey hidden here stays hidden whatever the stack says — and it also prunes the current selection to what is still visible.',
    input_schema: obj({ visible: { type: 'array', items: { type: 'string' } } }, ['visible']),
    strict: true
  },
  {
    name: 'activate_model',
    kind: 'view',
    description:
      'Activate one model so the lists, the tree and picking scope to it and the other models become unpickable background context. Pass null to leave activate mode. Use it when the user names one discipline and wants to work inside it; it does not hide the others. Only one model can be active. The key must be a loaded model key; the key that is already active stays active, and the result says so.',
    input_schema: obj({ key: { type: ['string', 'null'] } }, ['key']),
    strict: true
  },
  {
    name: 'set_view',
    kind: 'view',
    // 2026-10-02, phase 2: the design's two inputs and its four sentences, then what the user's
    // own camera can do — any direction, a fit that does not turn, a zoom.
    description:
      'Move the camera to a named view and/or change projection. Use it after a section or an isolate so the user is looking at what you just set up: an elevation with ortho for a section, iso with persp to return to the default. It changes nothing about what is visible or selected. Either argument may be given alone. ' +
      'Instead of a named view, azimuth and elevation turn the camera to any direction, in degrees in the model’s project frame: azimuth is the compass bearing the camera looks towards, clockwise from project north — 0 looks north, 90 east, 180 south, 270 west; project north is the model’s own +Y, not true north — and elevation is how far it looks down from level: 0 level, 90 straight down, −90 straight up. ' +
      `In these terms ${Object.entries(VIEW_DIRECTIONS)
        .map(([name, [az, el]]) => `view:"${name}" is ${az} / ${el}`)
        .join(', ')}. ` +
      'Either angle may be given alone and the other stays. A direction turns the camera where it stands — about what it is looking at, at its present distance — and leaves the projection alone. fit frames without turning: "extents" the whole building, "selection" what the user has selected; given with a direction it frames from there, which is what a click on the view cube does. ' +
      `zoom is a factor on the fit, ${VIEW_ZOOM_MIN} to ${VIEW_ZOOM_MAX} — 2 is twice as close, 0.5 half — and fits the building when fit is omitted. A named view together with azimuth or elevation is refused: send one or the other.`,
    input_schema: obj({
      view: { type: 'string', enum: ['iso', 'top', 'north', 'south', 'east', 'west'] },
      projection: { type: 'string', enum: ['persp', 'ortho'] },
      fit: { type: 'string', enum: VIEW_FITS },
      azimuth: { type: 'number', description: 'degrees clockwise from project north, 0–360' },
      elevation: { type: 'number', description: 'degrees down from level, −90 to 90' },
      zoom: { type: 'number', description: `a factor on the fit, ${VIEW_ZOOM_MIN}–${VIEW_ZOOM_MAX}` }
    }),
    strict: true
  },
  {
    name: 'set_section',
    kind: 'view',
    description:
      'Cut a section at a gridline or level. The gridline cut and the level cut are two independent planes and both can be on at once: kind:"grid" sets the gridline cut and leaves the level cut alone, kind:"level" sets the level cut and leaves the gridline cut alone. Pass kind:null to clear both; pass a kind with name:"" or no name to clear just that cut. name must be one of the model’s own gridline or storey names; a wrong one changes nothing and returns the valid list. ' +
      `It does what a click in the Section card does. offset is millimetres along the plane normal; flip reverses which side is kept; cut:false shows the plane as a preview without cutting and cut:true cuts. A new plane cuts, and uses the card’s defaults for what is omitted: offset 0 for a gridline (on the gridline itself) and ${LEVEL_DEFAULT_OFFSET_MM} for a level (above the storey), not flipped. ` +
      'To move, flip, preview or cut a plane that is already set, send the same kind and name again with only what should change: an omitted offset, flip or cut keeps the plane’s current state, and the call never clears it. The result says whether the plane cuts or is previewed, and its section names every cut that is on, e.g. "grid C + level L2". A section hides nothing — it clips the drawing — so counts and the filter stack are unaffected. Pair it with set_view for an elevation.',
    input_schema: obj(
      {
        kind: { type: ['string', 'null'], enum: ['grid', 'level', null] },
        name: { type: 'string' },
        offset: { type: 'number', description: 'mm from the plane' },
        flip: { type: 'boolean' },
        cut: { type: 'boolean', description: 'false previews the plane without cutting; true cuts' }
      },
      ['kind']
    ),
    strict: true
  },
  {
    name: 'toggle_display',
    kind: 'view',
    description:
      'Turn gridlines, levels, shadows or selection dimensions on or off — and the canvas grid under the model (groundGrid; the IFC gridlines are grids), snapping to corners and edges for the laser meter and spot coordinates (snap), and the files’ own surface materials (originalMaterials; off draws each element in its IFC class colour, or in its model’s colour override). Any subset may be given; an omitted switch is left alone and a switch already in the asked-for state is reported without changing. Use grids and levels to make a plan or section readable, dims when the user asks for a measurement of the selection, and the other three only when the user asks for them. It changes nothing about what is visible, and the result reads back every switch.',
    input_schema: obj({
      grids: { type: 'boolean' },
      levels: { type: 'boolean' },
      shadows: { type: 'boolean' },
      dims: { type: 'boolean' },
      // 2026-10-02 — the three switches the toolbar and the sidebar had and the tool did not.
      groundGrid: { type: 'boolean' },
      snap: { type: 'boolean' },
      originalMaterials: { type: 'boolean' }
    }),
    strict: true
  },
  {
    name: 'color_by_property',
    kind: 'view',
    description:
      'Colour the model by a property so every distinct value gets its own colour, with a legend. This is the tool for "colour each X" / "colour by Y" — use it whenever the user wants values distinguished from each other, not a single highlight colour. Pass property:null to clear. Scope it with rules, or with ids for a set query_sql or search found, or selection:true, or schedule:true for the elements the open schedule lists; prefer rules whenever a rule can express the same set. Given none of them it colours every element.',
    input_schema: obj(
      {
        property: {
          type: ['string', 'null'],
          description:
            'Any attribute or property-set key, e.g. SpeciesCommonName, IfcEntity, Level, FireRating'
        },
        rules: RULES,
        ...idTargets('colour')
      },
      ['property']
    ),
    strict: true
  },
  {
    name: 'color_models',
    kind: 'view',
    // 2026-10-02: a `null` value is the palette's own `reset` for that one model.
    description:
      'Override the colour of one or more models. Hex values; a null value clears that one model’s override and leaves the others; pass an empty map to clear every override and return to the original materials.',
    // A free-form `{modelKey: hex}` map. `additionalProperties: false` would reject every
    // key it exists to carry, so this is the one tool that cannot be strict.
    input_schema: {
      type: 'object',
      properties: {
        map: { type: 'object', description: 'model key to hex colour, or to null to clear it' }
      },
      required: ['map']
    },
    strict: false
  }
]

/* ────────────────────────────── the read-only additions ────────────────────────────── */

const EXTRA_TOOLS: readonly ToolSpec[] = [
  {
    name: 'get_element',
    kind: 'read',
    description:
      'The full record of one element: attributes, every property set and quantity set as authored, materials, classifications, systems, decomposition, type object, bounding box and provenance. Pass either the numeric id or the IFC GlobalId. Read-only.',
    input_schema: obj({
      id: { type: 'number', description: 'Federation element id, as chips and tables report it' },
      guid: { type: 'string', description: 'IfcRoot.GlobalId, 22 characters' }
    }),
    strict: true
  },
  {
    name: 'get_entity_raw',
    kind: 'read',
    description:
      'The raw STEP line of one entity exactly as the file authored it, with references resolved one level deep. Use it to settle a question about what is actually in the file. Read-only — there is no way to write one back.',
    input_schema: obj(
      {
        model: { type: 'string', description: 'Model key. Required when more than one is loaded.' },
        expressId: { type: 'number', description: 'STEP line number inside that file' },
        guid: { type: 'string', description: 'IfcRoot.GlobalId — an alternative to expressId' }
      },
      []
    ),
    strict: true
  },
  {
    name: 'list_values',
    kind: 'read',
    description:
      'Every distinct value of one property across the model, with a count for each. Use it when the schema says "… N more" or when you need the exact spelling of a value before writing a rule. Read-only.',
    input_schema: obj(
      {
        attr: {
          type: 'string',
          description:
            'Model, IfcEntity, PredefinedType, ObjectType, Level, Name, Material, or ANY property-set key'
        },
        contains: { type: 'string', description: 'Case-insensitive substring filter' },
        limit: { type: 'number', description: 'Rows to return, 1–200. Default 50.' },
        offset: { type: 'number', description: 'Rows to skip, for paging. Default 0.' },
        rules: RULES
      },
      ['attr']
    ),
    strict: true
  },
  {
    /**
     * 2026-09-28. The owner: "it never check the shared parameters Includes As GFA". Names are
     * authored by people and exporters, and the assistant could only guess them; this searches
     * them. It ranks names, never values — `search` is for values.
     */
    name: 'find_properties',
    kind: 'read',
    description:
      'Find a property by what it is called when the user’s wording is not an exact key in the schema — "includes GFA" finds a Revit shared parameter authored as "Includes As GFA". Searches every property-set and quantity-set name the federation carries, and the seven attributes, ignoring case, spaces and punctuation and matching whole words, best match first. For each name it returns the property sets it sits in, how many elements carry a value for it, whether the values are numbers, text or yes/no, the IFC measure type when there is one, and the commonest values with counts. Scope it with rules to search only what those elements carry (for example IfcEntity = IfcSpace). Read-only.',
    input_schema: obj(
      {
        text: { type: 'string', description: 'The property name as the user said it, or part of it' },
        rules: RULES,
        limit: { type: 'number', description: 'Names to return, 1–50. Default 20.' }
      },
      ['text']
    ),
    strict: true
  },
  {
    name: 'search',
    kind: 'read',
    description:
      'Free-text search across element names, GlobalIds, entities, object types, tags and property values. Use it when the user names something the schema does not list. Read-only.',
    input_schema: obj(
      {
        text: { type: 'string', description: 'Case-insensitive substring' },
        limit: { type: 'number', description: 'Matches to return, 1–100. Default 25.' }
      },
      ['text']
    ),
    strict: true
  },
  {
    name: 'get_spatial_tree',
    kind: 'read',
    description:
      'The IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey → IfcSpace aggregation tree of one model or all of them, with each node’s GlobalId, name, composition type and storey elevation. Read-only.',
    input_schema: obj({
      model: { type: 'string', description: 'Model key; omit for every loaded model' },
      counts: { type: 'boolean', description: 'Include the element count under each storey' },
      // Bounded by default (2026-09-20). A real building's spatial tree is mostly IfcSpace
      // leaves — 913 of 928 nodes on the reference model — and returning them unasked cost
      // ~34 600 tokens, about five ordinary turns. Every node still reports `childCount`, so
      // the model can see what it did not receive and ask for it.
      spaces: {
        type: 'boolean',
        description:
          'Include IfcSpace leaves. Omitted (the default) the tree stops above them and each storey reports how many it has.'
      },
      depth: {
        type: 'number',
        description:
          'How many levels to return, counting the root as 1. Default 6, which is the whole IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey chain. Below 1 is treated as 1.'
      }
    }),
    strict: true
  },
  {
    name: 'get_relationships',
    kind: 'read',
    description:
      'Everything one element is related to: its type object, materials and layers, classifications, systems and zones, what it is part of, what it is made of, its openings and what fills them, and the storey that contains it. Read-only.',
    input_schema: obj({
      id: { type: 'number', description: 'Federation element id' },
      guid: { type: 'string', description: 'IfcRoot.GlobalId — an alternative to id' }
    }),
    strict: true
  },
  {
    name: 'get_model_info',
    kind: 'read',
    description:
      'Per loaded file: the ISO-10303-21 header including the MVD, the IFC schema, the unit assignment, georeferencing with the source it was read from — which declaration placed the model in the federation’s map space (placedBy), in which map unit, and whether it lines up with the others (notLinedUp) — and a CORENET X / IFC-SG readout for Singapore models, entity and element counts, and the SHA-256 of the bytes. Read-only.',
    input_schema: obj({
      model: { type: 'string', description: 'Model key; omit for every loaded model' }
    }),
    strict: true
  },
  {
    name: 'get_view_state',
    kind: 'read',
    description:
      'What is currently shown: the filter stack step by step with live counts, visible and total elements, hidden elements, storey and model visibility, the active model, camera view, projection, section, colour scheme and selection. It also reads back, in full, what the per-turn view state mentions only when it is not at its default: every display switch (display), both section planes with their offset in millimetres, side and whether they cut (sectionPlanes), whether anything can be undone or redone (history), each model’s visibility, colour override and active state (models), and the interface — theme, units, tree mode, sidebar, open card, armed tool, tree search and whether the Schedules window is open. And where the camera stands (camera): the named view it is on, or null once it has been turned or orbited off one, its projection, and its direction as azimuth and elevation in set_view’s own terms; each highlight step’s colour in the filter stack; and the user’s saved viewpoints by name (viewpoints, the first 20). And the project base point every E / N / Z read-out is computed with (basePoint): E, N and Z in metres, angle the true-north rotation in degrees, and source — file when the four are what the file states, none when there is no base point; it comes from the file the federation was opened with, and nothing in the app can change it. And which loaded models could not be lined up with the others (notLinedUp): each one’s model key, why — it has no map position, or it sits far from the others — and how far, in kilometres. Read-only.',
    input_schema: obj({}),
    strict: true
  },
  {
    name: 'measure_between',
    kind: 'read',
    description:
      'Distance between two elements, in metres: centre to centre, the gap between their bounding boxes per axis, and whether the boxes overlap. Bounding-box arithmetic, not solid geometry. Read-only.',
    input_schema: obj(
      {
        a: { type: 'number', description: 'First element id' },
        b: { type: 'number', description: 'Second element id' }
      },
      ['a', 'b']
    ),
    strict: true
  },
  {
    /**
     * 2026-09-20. `docs/AI_REVIEW.md` §9 gap 7 and workflow W5: "what is within 2 m of this"
     * was a four-line `bbox` self-join the model had to write correctly every time, and
     * `IfcSpace` — which overlaps everything — swamped the answer with no way to exclude it
     * short of another `WHERE`.
     */
    name: 'find_nearby',
    kind: 'read',
    description:
      'Every element whose bounding box comes within a distance of one element’s box, or of a short list of them, nearest first. Read-only. distance is metres and 0 means "touching or overlapping". This is axis-aligned box arithmetic in the project frame, not solid geometry — exactly what measure_between reports — so describe the results as neighbours to check, not as contacts. IfcSpace is left out unless spaces:true, because a space overlaps everything inside it. The elements asked about are never their own neighbours.',
    input_schema: obj(
      {
        id: { type: 'number', description: 'Federation element id to search around' },
        ids: {
          type: 'array',
          items: { type: 'number' },
          description: 'Several ids to search around at once, at most 25. An alternative to id.'
        },
        distance: {
          type: 'number',
          description: 'Metres of gap between the boxes. Default 1.'
        },
        spaces: { type: 'boolean', description: 'Include IfcSpace neighbours. Default false.' },
        limit: { type: 'number', description: 'Neighbours to return, 1–100. Default 25.' }
      },
      []
    ),
    strict: true
  },
  {
    name: 'query_sql',
    kind: 'read',
    description:
      'Run one read-only SELECT against the model database for joins the other tools cannot express — properties across psets, quantities by storey, classification coverage. The schema is in your instructions. SELECT and WITH only; anything else is refused. At most 200 rows come back.',
    input_schema: obj({ sql: { type: 'string', description: 'One SELECT or WITH statement' } }, [
      'sql'
    ]),
    strict: true
  }
]

/* ────────────────────────────── parity with the user (2026-10-02) ────────────────────────────── */

/**
 * What `set_interface` may be asked for, setting by setting — the store's own unions
 * (`renderer/state/shell.ts`: `Theme`, `Units`, `TreeMode`, `CardName`; the viewer's `Tool`),
 * spelled out here so the main process's catalogue does not load the renderer. `inputs.ts`
 * validates against the same lists, and a unit test holds them to the store's.
 */
export const INTERFACE_THEMES = ['dark', 'light'] as const
export const INTERFACE_UNITS = ['mm', 'm'] as const
export const INTERFACE_TREE_MODES = ['entity', 'type'] as const
export const INTERFACE_SIDEBAR = ['open', 'collapsed'] as const
/** The six cards, and `none` for the card's own ×. */
export const INTERFACE_CARDS = [
  'project',
  'section',
  'filter',
  'coords',
  'views',
  'measure',
  'none'
] as const
export const INTERFACE_TOOLS = ['select', 'measure', 'spot'] as const
/** The tree's search text is typed by a person; from the model it is bounded. */
export const INTERFACE_SEARCH_MAX = 200

/**
 * Model keys one `set_models` call may name, and how long one may be. A federation has a
 * handful of models and a key is a file's name; these stop a runaway list before an executor
 * sees it (`inputs.ts`).
 */
export const MAX_MODEL_KEYS = 200
export const MAX_MODEL_KEY_CHARS = 300

/**
 * The view tools the parity work adds — two in phase 1, two more in phase 2, one in phase 3 (the
 * header has the direction and the lists). A group of its own, because they are neither the
 * design's nor read-only nor the Schedules window's — the catalogue test names each group's
 * members exactly.
 */
const PARITY_TOOLS: readonly ToolSpec[] = [
  {
    /** The eye beside each model in the sidebar — `toggleModel`'s state, `modelVis`. */
    name: 'set_models',
    kind: 'view',
    description:
      'Show only the named models, or all of them when the list is empty — the eye beside each model in the sidebar. Keys must be loaded model keys, as the schema’s models list has them; a wrong one changes nothing and returns the valid keys. A hidden model stays loaded: its elements are not drawn, and nothing about storeys, the filter stack or the active model changes. It is undoable, and held to the same guard as apply_visibility: a change that would leave nothing visible is refused, and one that would leave under 5 % of the elements visible waits for the user’s Apply. To work inside one model with the others still drawn as context, use activate_model instead.',
    input_schema: obj(
      {
        visible: {
          type: 'array',
          items: { type: 'string' },
          description: `Keys of the models to leave showing, at most ${MAX_MODEL_KEYS}; [] shows every model.`
        }
      },
      ['visible']
    ),
    strict: true
  },
  {
    /**
     * The app's own settings: the toolbar's theme button and tool buttons, the Markups card's
     * mm / m, the sidebar's two tree modes, its collapse button and its search box, the six
     * cards, and the toolbar's Schedules button. None of it is the model, and none of it is
     * what is visible — which is why the description says "only when the user asks".
     */
    name: 'set_interface',
    kind: 'view',
    description:
      'Change how the app itself is set up — never what is in the model, and never which elements are visible. Use it only when the user asks for one of these settings. Any subset: theme (dark or light); units, what measurements and dimensions are written in (mm or m); treeMode, how the element tree groups (entity, or type for PredefinedType); sidebar (open or collapsed); card, the one card on the stage — project, section, filter, coords (the coordinate system), views (saved viewpoints) or measure (markups) — or none to close whichever is open; tool, what a click on the model does — select, measure (the laser meter) or spot (a spot coordinate), which the user then places by clicking; search, the text in the element tree’s search box, "" to clear it; and schedulesWindow:"open", which opens the Schedules window or brings it to the front. An omitted setting is left alone, one already as asked is reported without changing, and the result reads all of them back.',
    input_schema: obj({
      theme: { type: 'string', enum: INTERFACE_THEMES },
      units: { type: 'string', enum: INTERFACE_UNITS },
      treeMode: { type: 'string', enum: INTERFACE_TREE_MODES },
      sidebar: { type: 'string', enum: INTERFACE_SIDEBAR },
      card: { type: 'string', enum: INTERFACE_CARDS },
      tool: { type: 'string', enum: INTERFACE_TOOLS },
      search: {
        type: 'string',
        description: `The tree’s search text, at most ${INTERFACE_SEARCH_MAX} characters; "" clears it`
      },
      schedulesWindow: { type: 'string', enum: ['open'] }
    }),
    strict: true
  },
  {
    /**
     * 2026-10-02, phase 2 — the Viewpoints card: its list, its "Save current view" button, a
     * click on a row and a double-click on a name. Phase 3 — and its ×, which only asks: a
     * saved viewpoint cannot be brought back, so the user's Apply is what deletes it.
     */
    name: 'manage_views',
    kind: 'view',
    description:
      'The user’s saved viewpoints — the Viewpoints card. A viewpoint keeps the camera, the section, what is hidden, the storey and model switches, the filter stack, the active model, and whether gridlines and levels show. op:"list" names them, with what each holds and which was restored last; "save" saves the view as it stands now, under name when one is given and as "Viewpoint N" otherwise; "restore" puts one back, which the user can undo; "rename" gives one a new name (to); "delete" asks the user to delete one. Say which viewpoint by name — matched exactly, then case-insensitively — or by its number in the list, ' +
      `which is the only way to reach one when two share a name or when its name is longer than the ${VIEW_NAME_MAX} characters the list shows; ` +
      'one that matches nothing changes nothing and returns the list. Restoring runs the same scope guard as undo: a viewpoint that would take elements out of view and leave nothing, or under 5 % of the model, is not restored until the user clicks Apply under your reply. A deleted viewpoint cannot be brought back, so delete never deletes: it waits behind that same Apply button, nothing is deleted unless the user clicks it, and you are not told whether they did. Viewpoints are the user’s own: list them before acting on one, and save, rename or ask to delete one only when asked.',
    gate: { by: 'op', asks: { delete: 'apply' } },
    input_schema: obj(
      {
        op: { type: 'string', enum: VIEW_OPS },
        name: {
          type: 'string',
          description: `The viewpoint to restore, rename or delete, by name; for save, the name to give it (at most ${VIEW_NAME_MAX} characters).`
        },
        number: {
          type: 'number',
          description: 'The viewpoint to restore, rename or delete, by its 1-based number in the list — instead of name.'
        },
        to: {
          type: 'string',
          description: `For rename: the new name, at most ${VIEW_NAME_MAX} characters.`
        }
      },
      ['op']
    ),
    strict: true
  },
  {
    /**
     * 2026-10-02, phase 2 — the Markups card, read: its two lists, and the tag that zooms to
     * one. Phase 3 — its × and its two `clear`s, which only ask: a deleted markup cannot be
     * brought back. Phase 4 — placing: what the user's click with the spot tool or the laser
     * meter commits, at a point that is named (an element's box, or a point) because a tool has
     * no pointer; and a spot tag's two states. A markup a reply placed is session view state:
     * that reply's `revert` takes it away again (`state/shell.ts`, `revertTurn`).
     */
    name: 'manage_markups',
    kind: 'view',
    description:
      'The markups on the model — the Markups card. Laser measurements are M1, M2 …, each with the X, Y and Z distances its three rays read; spot coordinates are C1, C2 …, each with its E, N and Z map coordinates, or its level in the file’s own metres when the model has no base point. op:"list" returns both lists in the card’s current unit (mm or m); "focus" zooms the camera to one, named as the card names it. ' +
      '"place_spot" and "place_measure" place one exactly as the user’s click with the spot tool or the laser meter does, at a point you name: an element (id) and where on its bounding box (at: top, which is the default, centre or base — the middle of the box’s top face, of the box, or of its underside), or point, in the project-frame metres get_element reports a box in. That box is axis-aligned and conservative, not a picked surface: on a sloped or L-shaped element its middle can be off the real surface, so report it as taken on the bounding box. A measurement reads, along each of X, Y and Z, the distance between the nearest visible faces either side of the point; from top or base it does not read into the element, and from centre it usually reads the element’s own faces. A spot tag shows its level alone until show:"full" — on place_spot, or op:"show" with name, or with no name for every spot — gives it its full E, N and Z; "level" puts it back. ' +
      '"delete" asks the user to delete one, and "clear" every laser measurement (kind:"measures") or every spot coordinate (kind:"spots"). The names are positions in the card, so they shift when one is deleted: list before you focus, show or ask to delete. A deleted markup cannot be brought back, so delete and clear never delete: they wait behind an Apply button under your reply, nothing is deleted unless the user clicks it, and you are not told whether they did. Place a markup only when asked: it stays until the user deletes it or reverts your reply, which takes away the markups that reply placed.',
    gate: { by: 'op', asks: { delete: 'apply', clear: 'apply' } },
    input_schema: obj(
      {
        op: { type: 'string', enum: MARKUP_OPS },
        name: {
          type: 'string',
          description: 'For focus, show and delete: the markup as the card names it, e.g. M2 or C1.'
        },
        kind: {
          type: 'string',
          enum: MARKUP_KINDS,
          description: 'For clear: which of the card’s two lists — measures (laser) or spots (coordinates).'
        },
        id: {
          type: 'number',
          description: 'For place_spot and place_measure: the federation id of the element to place it on.'
        },
        at: {
          type: 'string',
          enum: MARKUP_PLACES,
          description: 'With id: where on that element’s bounding box. top when omitted.'
        },
        point: {
          type: 'object',
          description: 'For place_spot and place_measure, instead of id: a point in project-frame metres, Z up.',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          required: ['x', 'y', 'z'],
          additionalProperties: false
        },
        show: {
          type: 'string',
          enum: SPOT_SHOWS,
          description: 'A spot tag’s state: full (E, N and Z) or level. With place_spot, how the new tag stands.'
        }
      },
      ['op']
    ),
    strict: true
  },
  {
    /**
     * 2026-10-02, phase 3 — the consent gate. What reaches outside the view, or cannot be
     * undone, and has no tool of its own to hang on: the designed `upload` control, a Recent
     * pill, a model's ×, "copy link to this state" and the property card's Copy. **It only asks**
     * — every action is in `gate` — and the description's first job is to make that plain to the
     * model. (The Coordinate-system card's four fields were a sixth until 2026-10-08, when the
     * owner made the card read-only.)
     */
    name: 'request_user_action',
    kind: 'view',
    description:
      'Ask the user to do something only they may decide, because it reaches outside the view or cannot be undone. This tool never does it. It puts the request in front of the user, nothing happens unless they click, and you are never told whether they did — so say what you asked for, never that it was done. One request a turn. ' +
      'action:"open_files" opens the native Open dialog, where the user picks the IFC files to load; you are not told what they pick. ' +
      '"open_recent" asks to open one file of the app’s recent list, named by recent — the file’s name as that list has it, never a path; with no name, or one that is not on the list, it returns the names. ' +
      '"unload_model" raises the sidebar’s own "Unload …?" confirmation beside the loaded model with key model, where the user clicks delete or cancel; it is refused while only one model is loaded. ' +
      '"copy_link" asks to copy a share link to the view as it stands when the user clicks, and "copy_guids" the GlobalIds of ids, of what is selected (selection:true) or of what the open schedule lists (schedule:true), one per line; the result never contains what would be copied. ' +
      'open_recent, copy_link and copy_guids wait behind an Apply button under your reply.',
    gate: {
      by: 'action',
      asks: {
        open_files: 'dialog',
        open_recent: 'apply',
        unload_model: 'confirm',
        copy_link: 'apply',
        copy_guids: 'apply'
      }
    },
    input_schema: obj(
      {
        action: { type: 'string', enum: REQUEST_ACTIONS },
        recent: {
          type: 'string',
          description:
            'For open_recent: the file’s name as the recent list has it, e.g. "Tower A.ifc" — a name, never a path.'
        },
        model: { type: 'string', description: 'For unload_model: the key of the loaded model to ask about.' },
        ids: {
          type: 'array',
          items: { type: 'number' },
          description: `For copy_guids: the federation element ids whose GlobalIds are to be copied, at most ${MAX_TOOL_IDS}.`
        },
        selection: {
          type: 'boolean',
          description: 'For copy_guids: true takes what the user currently has selected instead of ids.'
        },
        // 2026-10-02, phase 4 — the Schedules window's "Copy GUIDs", asked for like the rest.
        schedule: {
          type: 'boolean',
          description: 'For copy_guids: true takes the elements the open schedule lists instead of ids, however many.'
        }
      },
      ['action']
    ),
    strict: true
  },
  {
    /**
     * 2026-10-02, phase 4 — the Schedules window's own controls: its undo and redo, the
     * template gallery, My templates, Print and "Open schedule file…". Each runs in that window,
     * by the control's own handler; what crosses the port is which one and a name. Deleting,
     * printing and opening a file only raise that window's own dialog — for printing, its own
     * confirm: the native print dialog opens on the user's click there, never from chat.
     */
    name: 'manage_schedules',
    kind: 'view',
    description:
      'The Schedules window’s own controls, for what make_schedule does not cover. op:"open" opens the window or brings it to the front; every other op needs it open. "undo" and "redo" step the schedule it shows through that window’s own history, which is where make_schedule’s changes land. "templates" lists the ready-made templates that fit the loaded models, and "apply_template" starts the schedule from one (name: its name or id). The user’s saved setups — My templates, kept on this computer — are listed by "saved_list"; "load" makes one the open schedule, "save" saves the open schedule under its own title (make_schedule’s title sets that), "rename" gives a saved one a new name (to), and "duplicate" copies one. apply_template and load replace the open schedule, which the user can undo there. ' +
      'Three things are only asked for, in the Schedules window, where the user’s own click decides and you are not told what they chose: "delete" raises that window’s confirmation for one saved setup, "print" asks there whether to open the print dialog — which opens only if the user says so there — and "open_file" raises its Open dialog for a .schedule.json. So is a save or a duplicate that would take a saved setup away — a save over the one the schedule was loaded from, or past the hundred that are kept. Saved setups are the user’s own: list them before acting on one, and save, rename, duplicate or ask to delete one only when asked.',
    gate: { by: 'op', asks: { delete: 'confirm', print: 'confirm', open_file: 'dialog' } },
    input_schema: obj(
      {
        op: { type: 'string', enum: SCHEDULE_MANAGE_OPS },
        name: {
          type: 'string',
          description: `For load, rename, duplicate and delete: the saved setup, as saved_list names it. For apply_template: the template’s name or id. At most ${SCHEDULE_NAME_MAX} characters.`
        },
        to: {
          type: 'string',
          description: `For rename: the new name, at most ${SCHEDULE_NAME_MAX} characters.`
        }
      },
      ['op']
    ),
    strict: true
  }
]

/* ────────────────────────────── the Schedules window (2026-09-28) ────────────────────────────── */

/**
 * The engine's own filter operators (`schedule/schedule/compare.ts` `OP_LABELS`), spelled out
 * here so the main process's catalogue does not pull in the schedule engine. A unit test keeps
 * the two lists identical.
 */
export const SCHEDULE_OP_ENUM = [
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'contains',
  'startsWith',
  'endsWith',
  'hasValue',
  'noValue',
  'in',
  'between'
] as const

/**
 * The Schedules window's Export menu, entry by entry, as `export_schedule` names them — spelled
 * out here so the main process does not load `schedule/messages.ts`; a unit test keeps the two
 * lists identical.
 */
export const SCHEDULE_EXPORT_FORMATS = ['xlsx', 'csv', 'all_saved', 'schedule_file'] as const

/**
 * 2026-10-02, phase 4 — `make_schedule`'s Format-tab and calculated-value inputs, spelled here
 * for the same reason: the Format tab's three alignments, what a calculated value's result may
 * be (the editor's own "Result is a" list), and how many one call may define. A unit test keeps
 * each identical to the engine side's (`schedule/assistant.ts`).
 */
export const SCHEDULE_ALIGN_ENUM = ['left', 'center', 'right'] as const
export const SCHEDULE_RESULT_ENUM = [
  'number',
  'yes_no',
  'text',
  'length',
  'area',
  'volume',
  'mass',
  'angle'
] as const
export const SCHEDULE_CALCULATED_MAX = 20

/** A column's field, wherever `make_schedule` takes one. The tool description lists them. */
const SCHEDULE_FIELD: JsonSchema = {
  type: 'string',
  description: 'A Schedules field or a property name from the schema'
}

const SCHEDULE_TOOLS: readonly ToolSpec[] = [
  {
    /**
     * The owner: "wire the schedules with the AI". A schedule is a table of elements; this
     * shows one in the Schedules window as its current, unsaved schedule, on that window's own
     * undo history. It never changes the model.
     */
    name: 'make_schedule',
    kind: 'view',
    // 2026-10-02, phase 4: what the window's Filter, Sorting and Format tabs and its
    // calculated-value editor set — filterLogic, itemize, a column's format and place, and
    // calculated columns — which until now it could only keep.
    description:
      'Build a schedule — a table of elements with the columns, filters, sorting, grouping and totals asked for — and show it in the Schedules window, opening that window when it is closed; the user can undo it there. It returns the schedule as the window shows it: headings, the first rows as displayed text, each group’s count and subtotals and the grand totals, so answer from them. Use it for a door schedule with fire rating and width, room or space areas by level, counts by type. base:"open" changes the schedule the user already has open instead: columns are added — or, for a field it already shows, given the heading, total and format you pass, and moved when after is given — removeColumns takes columns away by heading or field, and filters, sortBy and groupBy replace their lists when given; everything else the user set up (other columns and their formats, colour rules, widths) is kept. category is one or more IFC classes, unioned. A field is one of the Schedules window’s own — Level, Name, Type, Family, IFC Class (or IfcEntity), Object Type, Predefined Type, Material, Model, GUID, Description, Tag (Revit ID), Level Elevation, Room / Space, Building, Site, Discipline — or any property name from the schema, matched the way rules match it; Pset.Name names one property set. A name that is not one refuses the whole call with the nearest names, and nothing is shown. Cells and totals are written in each column’s display unit — the unit on each schedule.columns entry of the result, e.g. mm — but filter numbers on lengths, areas and volumes are SI, the column’s filterUnit: metres, square metres, cubic metres, so 900 mm is 0.9; a number the file gives no unit compares as shown. ' +
      'filterLogic:"or" lists what passes any filter rather than every one, and itemize:false collapses rows that read alike into one with a Count. calculated adds columns worked out per row from the other columns, named by their headings — Area * 1.15, [Clear Width] * 2, if(Area > 10, "Large", "Small"), contains(Type, "FD") — with + - * /, comparisons, && and ||, and round, floor, ceil, abs, sqrt, min, max, if, contains, starts, ends, number and len; a formula reads measures in SI as a filter does, so Width > 0.9 is wider than 900 mm; or percentageOf, each row’s share of a field’s total. A formula that does not parse, or names a heading the schedule has no column for, refuses the call with the reason. ' +
      `At most 40 columns, 8 filters, and 4 sort and group fields together, and ${SCHEDULE_CALCULATED_MAX} calculated columns. It changes only what the Schedules window shows — never the model.`,
    input_schema: obj({
      base: {
        type: 'string',
        enum: ['new', 'open'],
        description:
          'new (the default) makes a schedule; open changes the one the Schedules window has open'
      },
      title: { type: 'string', description: 'The schedule’s name. Default "<class> Schedule".' },
      category: {
        type: 'array',
        items: { type: 'string' },
        description:
          'IFC classes to list, unioned, at most 12 — e.g. ["IfcDoor"], or ["IfcWall","IfcWallStandardCase"] for walls across IFC2X3 and IFC4. Required for a new schedule.'
      },
      columns: {
        type: 'array',
        description:
          'Columns, left to right, at most 40. Required for a new schedule. With base:"open" they are added at the right, or re-headed and re-totalled when already shown.',
        items: obj(
          {
            field: SCHEDULE_FIELD,
            heading: { type: 'string', description: 'Column heading. Default: the field’s name.' },
            total: {
              type: 'string',
              enum: ['sum', 'count', 'min', 'max', 'avg', 'none'],
              description:
                'Total this column in each group footer and the grand total; none takes a total away'
            },
            // 2026-10-02 — the Format tab's switches for this column, and its place.
            hidden: {
              type: 'boolean',
              description: 'true keeps the column in the schedule without showing it'
            },
            decimals: { type: 'number', description: 'Decimal places, 0–6. A numeric column only.' },
            unit: {
              type: 'string',
              description:
                'Display unit — one the column’s measure has: mm cm m km in ft; mm² cm² m² ft² ha; mm³ cm³ L m³ ft³; ° rad; g kg t lb (m2 and m3 are read as m² and m³). It does not change the decimals: pass those too.'
            },
            align: { type: 'string', enum: SCHEDULE_ALIGN_ENUM },
            after: {
              type: 'string',
              description:
                'The heading or field of the column this one goes directly after; "" puts it first'
            }
          },
          ['field']
        )
      },
      removeColumns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Columns to take away from the open schedule, by heading or field.'
      },
      calculated: {
        type: 'array',
        description: `Calculated columns to add, at most ${SCHEDULE_CALCULATED_MAX}; one whose name the schedule already has is redefined. Each is shown at the right unless columns names it, which places and formats it.`,
        items: obj(
          {
            name: { type: 'string', description: 'Its name, which is also its heading' },
            formula: {
              type: 'string',
              description: 'An expression over the other columns’ headings; [Heading] for one with a space'
            },
            percentageOf: {
              type: 'string',
              description: 'Instead of a formula: each row’s share, in percent, of this field’s total'
            },
            result: {
              type: 'string',
              enum: SCHEDULE_RESULT_ENUM,
              description:
                'What a formula gives: a plain number, a yes or no, text, or a measure the column then converts and unit-labels. Default: what the formula’s own units work out to, else number.'
            }
          },
          ['name']
        )
      },
      filters: {
        type: 'array',
        description:
          'Rules every listed element passes, at most 8. With base:"open" this replaces the filter list, and [] clears it.',
        items: obj(
          {
            field: SCHEDULE_FIELD,
            op: {
              type: 'string',
              enum: SCHEDULE_OP_ENUM,
              description:
                'The Filter tab’s operators. hasValue and noValue take no value; in takes values (any of); between takes values with two numbers.'
            },
            value: { type: 'string' },
            values: { type: 'array', items: { type: 'string' } }
          },
          ['field', 'op']
        )
      },
      filterLogic: {
        type: 'string',
        enum: ['and', 'or'],
        description: 'and (the default) lists what passes every filter; or, what passes any'
      },
      sortBy: {
        type: 'array',
        description: 'Sort order within the groups.',
        items: obj({ field: SCHEDULE_FIELD, descending: { type: 'boolean' } }, ['field'])
      },
      groupBy: {
        type: 'array',
        items: SCHEDULE_FIELD,
        description:
          'Fields to group by, outermost first. Each group gets a heading row and a footer with its count and the columns’ totals.'
      },
      itemize: {
        type: 'boolean',
        description: 'false collapses rows that read alike into one, with a Count column; true lists every element'
      },
      grandTotals: { type: 'boolean', description: 'Add a grand-total row under the table.' }
    }),
    strict: true
  },
  {
    name: 'get_schedule',
    kind: 'read',
    description:
      'Read the schedule open in the Schedules window, as the user sees it: its definition in make_schedule’s shape, its headings, rows as displayed text, each group’s count and subtotals, the grand totals, each measured column’s display unit and the SI filterUnit its filters compare in, row and element counts, how many listed elements carry a value in each column (filled), and how many of the category each filter keeps on its own (filterKeeps). Use it when the user says "this schedule" or "the table", asks what a total is, or asks why a column or the table is empty. Read-only.',
    input_schema: obj({
      limit: { type: 'number', description: 'Rows to return, 1–50. Default 20.' },
      offset: { type: 'number', description: 'Rows to skip, for paging. Default 0.' }
    }),
    strict: true
  },
  {
    /**
     * 2026-09-28, owner-approved: "Export from chat — 'Export this schedule to Excel' opens the
     * normal Save dialog for you. You still pick where it goes." The one tool that may open a
     * Save dialog; it takes a format and nothing else, and writes nothing itself.
     */
    name: 'export_schedule',
    kind: 'view',
    description:
      'Export the schedule open in the Schedules window through that window’s own Export menu: xlsx (Excel), csv, all_saved (every schedule the user saved in My templates, one sheet each, run against the loaded models — only once they have saved one) or schedule_file (the schedule’s setup as a .schedule.json, to reuse or share). It only opens the native Save dialog in the Schedules window and brings that window to the front: the user picks the file name and the folder, and nothing is written unless they click Save. It returns as soon as the dialog is asked for and is never told whether a file was saved, so never say that one was, or where. Refused while the Schedules window is busy with an export or one of its own dialogs.',
    // 2026-10-02: every call of it asks, through the Save dialog — the marker says what the
    // description always did.
    gate: { by: null, asks: { '*': 'dialog' } },
    input_schema: obj(
      {
        format: {
          type: 'string',
          enum: SCHEDULE_EXPORT_FORMATS,
          description: 'Which entry of the Export menu: xlsx, csv, all_saved or schedule_file'
        }
      },
      ['format']
    ),
    strict: true
  },
  {
    /**
     * 2026-09-28, owner-approved: "Colour 3D from chat — 'Colour the model by this schedule's
     * Fire Rating column' — uses the same colour-by the table's right-click menu already has."
     */
    name: 'color_by_schedule_column',
    kind: 'view',
    description:
      'Colour the model by one column of the schedule open in the Schedules window — exactly what that column heading’s "Colour 3D by this column" does: every distinct value as the table displays it gets its own colour, the legend is titled with the column’s heading, and the table marks each value with its colour. column is a heading as the table shows it or a field name, and calculated columns count. Use it for "colour by this schedule’s Fire Rating" or "colour the model by that column"; use color_by_property when no schedule is involved. A column with more than 100 distinct values is refused. Pass column:null to clear the colours.',
    input_schema: obj(
      {
        column: {
          type: ['string', 'null'],
          description: 'A column heading of the open schedule, or its field; null clears'
        }
      },
      ['column']
    ),
    strict: true
  }
]

/* ────────────────────────────── the catalogue ────────────────────────────── */

/** Every tool, design first then the additions, in the order they are declared above. */
export const TOOLS: readonly ToolSpec[] = [
  ...DESIGN_TOOLS,
  ...EXTRA_TOOLS,
  ...PARITY_TOOLS,
  ...SCHEDULE_TOOLS
]

/** The Schedules window's tools, by name. */
export const SCHEDULE_TOOL_NAMES: readonly string[] = SCHEDULE_TOOLS.map((t) => t.name)

/** The parity work's own view tools (2026-10-02), by name: two of phase 1, two of phase 2, one each of phases 3 and 4. */
export const PARITY_TOOL_NAMES: readonly string[] = PARITY_TOOLS.map((t) => t.name)

/** The design's fifteen, by name — what the parity tests compare against. */
export const DESIGN_TOOL_NAMES: readonly string[] = DESIGN_TOOLS.map((t) => t.name)

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

export const toolByName = (name: string): ToolSpec | undefined => BY_NAME.get(name)

/** True when the tool changes what is shown rather than only reporting it. */
export const isViewTool = (name: string): boolean => BY_NAME.get(name)?.kind === 'view'

/* ────────────────────────────── the consent gate (2026-10-02) ────────────────────────────── */

/**
 * The surface one call asks the user through, or `null` when the call is not gated — read off
 * the tool's own `gate` marker and the call's input. `input` is whatever was sent; it is only
 * ever compared with the marker's own keys, so nothing it holds can make this throw.
 */
export function gateOf(
  name: string,
  input?: Readonly<Record<string, unknown>> | null
): GateSurface | null {
  const gate = BY_NAME.get(name)?.gate
  if (!gate) return null
  const value = gate.by === null ? '*' : input?.[gate.by]
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(gate.asks, value)
    ? gate.asks[value]
    : null
}

/** One gated call, as the guard pins it: `manage_views.op=delete → apply`. */
export interface GatedCall {
  tool: string
  /** The deciding input and its value, or `null` when every call of the tool asks. */
  by: string | null
  value: string
  surface: GateSurface
}

/** Every gated call in the catalogue, in declaration order — what `tests/readonly-guard.test.ts` pins. */
export const GATED_CALLS: readonly GatedCall[] = TOOLS.flatMap((t) =>
  Object.entries(t.gate?.asks ?? {}).map(([value, surface]) => ({
    tool: t.name,
    by: t.gate!.by,
    value,
    surface
  }))
)

/**
 * The tools as the API wants them, **sorted by name**.
 *
 * Sorting is what makes the cached prefix byte-stable: tools render before the system prompt
 * (`shared/prompt-caching`), so a catalogue that reordered itself would invalidate every
 * cache read. Declaration order is for people; this order is for the wire.
 */
export interface ApiTool {
  name: string
  description: string
  input_schema: JsonObjectSchema
  strict?: boolean
  eager_input_streaming?: boolean
}

export function apiTools(options?: { strict?: boolean }): ApiTool[] {
  const strictOn = options?.strict ?? true
  return [...TOOLS]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
      ...(strictOn && t.strict ? { strict: true } : {}),
      // Eager input streaming is the documented default for a user-defined tool on a
      // **streaming** request, and this request always streams. It is keyed on the
      // catalogue's own `strict`, not on `strictOn`: the strict-schema fallback exists
      // because the API refused a schema, which says nothing about how the input should be
      // streamed, and silently turning this off there would change two things at once.
      //
      // It hands input validation to this side, which is where it already lives:
      // `executors/inputs.ts` re-parses every argument with zod and a failure comes back as
      // an ordinary `is_error` tool result. `color_models` is left alone — it is the one
      // free-form map and the one tool that is not strict.
      ...(t.strict ? { eager_input_streaming: true } : {})
    }))
}

/** How long a tool may run before the gateway gives up on it (plan §4 Phase 9). */
export const TOOL_TIMEOUT_MS = 20_000
/** The two that legitimately take longer: a SQL query and a federation-wide clash sweep. */
export const SLOW_TOOL_TIMEOUT_MS = 60_000
export const SLOW_TOOLS: readonly string[] = ['query_sql', 'clash_check']

export const toolTimeoutMs = (name: string): number =>
  SLOW_TOOLS.includes(name) ? SLOW_TOOL_TIMEOUT_MS : TOOL_TIMEOUT_MS
