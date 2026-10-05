/**
 * The Schedules window's four tools — 2026-09-28. The owner: *"wire the schedules with the AI.
 * Improve AI abilities."* The first two:
 *
 *   · `get_schedule` (read) — the schedule open in the Schedules window, as that window shows
 *     it: its definition in `make_schedule`'s shape, a page of rows, every subtotal and the
 *     grand totals.
 *   · `make_schedule` (view) — build one, or change the open one (`base:"open"`), and show it
 *     in the Schedules window (opened when it is closed) as the current, unsaved schedule. It
 *     changes what the second window shows and nothing else: no model data, no file, no path.
 *
 * Both run the ported engine **here, in the main renderer**, over `schedule-link.ts`'s store —
 * the same adapter snapshot the window indexes — so what the model reads is what the table
 * shows. That store is built the first time one of them runs; the per-turn view state
 * (`scheduleBriefOf`) never touches it — it is the window's own report, def and row count. The definition from the model is untrusted: `make_schedule`'s input is bounded by its
 * zod schema (`inputs.ts`), every name is resolved or the call is refused (`schedule/assistant.ts`),
 * the result goes through `parseScheduleDef`, and the Schedules window checks it again on
 * receipt (`schedule/messages.ts`).
 *
 * Chat UI: the chips every tool already has — one per top-level group, or one for every
 * element listed — and nothing else.
 *
 * And the two the owner chose after them (below): `export_schedule` — "Export this schedule to
 * Excel" opens the Export menu's own Save dialog, and the user still picks where it goes — and
 * `color_by_schedule_column` — "Colour the model by this schedule's Fire Rating column", the
 * heading menu's own colour-by.
 *
 * 2026-10-02, parity with the user, phase 4 — `manage_schedules`: the Schedules window's own
 * controls (its undo and redo, the template gallery, My templates, Print, Open schedule file),
 * each run **in that window by the control's own handler** (`schedule-ui/manage.ts`). What this
 * file sends is an operation and at most two names; what it gets back, at once, is what became
 * of it. Deleting a saved setup, printing and opening a file are only ever *asked for* there —
 * that window's own confirmation before a deletion and before its print dialog is opened, its
 * Open dialog — and this file is never told what the user chose.
 */
import type { ScheduleBrief } from '../../../shared/ai-schema'
import {
  buildSchedule,
  columnsNamed,
  readSchedule,
  scheduleBrief,
  type AskSchedule,
  type ScheduleRead
} from '../../../schedule/assistant'
import { colourColumn } from '../../../schedule/colour'
import { MANAGE_ACK_MS, MANAGE_NAME_MAX, type ExportFormat, type ManageOp } from '../../../schedule/messages'
import { headingOf } from '../../../schedule/schedule/def'
import { visibleColumns } from '../../../schedule/schedule/engine'
import { api } from '../../api'
import {
  colourByColumn,
  defineSchedule,
  openSchedule,
  releaseScheduleStore,
  requestExport,
  requestManage,
  scheduleConnected,
  scheduleStore,
  whenScheduleConnected,
  type ExportAnswer,
  type ManageAnswer
} from '../../model/schedule-link'
import {
  CHIP_CAP,
  alreadyWaiting,
  labelText,
  waitingOn,
  type ChatChip,
  type Executor,
  type ToolOutcome
} from './context'
import { schemeOutcome } from './view'

/** How long `make_schedule` waits for a Schedules window it opened to join. */
export const CONNECT_WAIT_MS = 8000

const NO_WINDOW = 'No Schedules window is open, so there is no schedule to read. make_schedule opens one.'
const NO_SCHEDULE = 'The Schedules window shows no schedule yet.'

/** One chip per top-level group, or one for everything listed. */
function chipsOf(read: ScheduleRead): ChatChip[] {
  if (read.groups.length) {
    return read.groups
      .filter((g) => g.ids.length)
      .slice(0, CHIP_CAP)
      .map((g) => ({ label: `${g.label} (${g.ids.length})`, ids: g.ids }))
  }
  return read.ids.length ? [{ label: `${read.ids.length} in schedule`, ids: read.ids }] : []
}

/**
 * The view state's `schedule` line, or null — built on **every** turn, so from the Schedules
 * window's own report (the def and the row count its table shows) and nothing else: no store is
 * built and the engine does not run.
 */
export function scheduleBriefOf(): ScheduleBrief | null {
  const open = openSchedule()
  return open ? scheduleBrief(open.def, open.rowCount) : null
}

export const get_schedule: Executor = (input, ctx) => {
  const open = openSchedule()
  if (!open) return { forModel: { message: scheduleConnected() ? NO_SCHEDULE : NO_WINDOW } }
  const { store, rowIds } = scheduleStore(ctx.state())
  const read = readSchedule(store, open.def, rowIds, { limit: input.limit, offset: input.offset })
  return { forModel: read.forModel, ui: { chips: chipsOf(read) } }
}

export const make_schedule: Executor = async (input, ctx) => {
  const s = ctx.state()
  if (!s.federation.elements.length) {
    return { forModel: { message: 'No model is loaded, so there is nothing to schedule.' } }
  }
  const ask = input as AskSchedule
  const edit = ask.base === 'open'
  const base = edit ? (openSchedule()?.def ?? null) : null
  if (edit && !base) {
    return {
      forModel: {
        message: `${scheduleConnected() ? NO_SCHEDULE : 'No Schedules window is open.'} There is no open schedule to change — leave base out to make a new one.`
      }
    }
  }
  const { store, rowIds } = scheduleStore(s)
  const built = buildSchedule(ask, { store, propKeys: s.propKeys }, base)
  if ('error' in built) {
    return {
      forModel: {
        message: `Nothing was changed. ${built.error}`,
        ...(built.valid_values ? { valid_values: built.valid_values } : {})
      }
    }
  }

  // Opened (and brought forward) only when it is closed: an open window is left where the user
  // put it, so a change asked for in chat does not take the keyboard away from the chat.
  if (!scheduleConnected()) {
    const bridge = api()
    if (!bridge) {
      releaseScheduleStore()
      return { forModel: { message: 'The Schedules window cannot be opened here.' } }
    }
    try {
      await bridge.openSchedules()
    } catch {
      // Reported below, as a window that never joined.
    }
  }
  if (!(await whenScheduleConnected(CONNECT_WAIT_MS))) {
    // No window to show it in, so nothing to hold the store for.
    releaseScheduleStore()
    return {
      forModel: {
        message: `The Schedules window did not open within ${CONNECT_WAIT_MS / 1000} s, so nothing was shown. The user can open it from the toolbar's schedules button and ask again.`
      }
    }
  }
  const read = readSchedule(store, built.def, rowIds)
  if (!defineSchedule(built.def, edit ? 'edited' : 'made', read.forModel.rowCount as number)) {
    return { forModel: { message: 'The Schedules window closed before the schedule reached it.' } }
  }

  const said = edit ? 'Changed the open schedule' : 'Showed a new schedule'
  const renamed = Object.entries(built.resolvedKeys)
  return {
    forModel: {
      ...read.forModel,
      message:
        `${said} in the Schedules window, where the user can undo it. ${read.forModel.message as string}` +
        (renamed.length
          ? ` Property names were read as the file spells them: ${renamed.map(([a, k]) => `${a} → ${k}`).join(', ')}.`
          : ''),
      ...(renamed.length ? { resolvedKeys: built.resolvedKeys } : {})
    },
    ui: { chips: chipsOf(read) }
  }
}

/* ────────────────────────────── export and colour from chat (2026-09-28) ────────────────────────────── */

/**
 * How long `export_schedule` waits for the Schedules window to say it **started** the export —
 * a round trip over the port, milliseconds in practice. Never for the dialog: a person can take
 * longer over a Save dialog than the tool's 20 s budget.
 */
export const EXPORT_ACK_MS = 3000

/** The Export menu's own words for each entry. */
const FORMAT_LABEL: Record<ExportFormat, string> = {
  xlsx: 'Excel (.xlsx)',
  csv: 'CSV',
  all_saved: 'All saved schedules (.xlsx)',
  schedule_file: 'Schedule file (.schedule.json)'
}

/** Every answer but `opened`, in words the model can pass on. None of them says a file exists. */
const NOT_EXPORTED: Record<Exclude<ExportAnswer, 'opened'>, string> = {
  // One word, more than one cause, and the model passes the sentence on — so it is true of each.
  // In that window (`schedule-ui/exporting.ts`, `exportRefusal`): an export being built or its
  // Save dialog up, or — since 2026-10-02 — its own confirm or prompt, or its native Open dialog,
  // still waiting. And here (`requestExport`): an earlier request not answered yet.
  busy: 'The Schedules window is busy — an export is already under way (its Save dialog may be open), or one of that window’s own dialogs is still waiting for an answer. Nothing more was asked for; the user finishes or cancels that first.',
  no_schedule: `${NO_SCHEDULE} Nothing was exported.`,
  nothing_saved:
    'There are no saved schedules to export: the Export menu’s "All saved schedules" entry stays off until the user saves a schedule in My templates. Nothing was exported.',
  closed: 'The Schedules window closed, so nothing was exported.',
  timeout: `The Schedules window did not answer within ${EXPORT_ACK_MS / 1000} s. If a Save dialog appears there, the user chooses where the file goes; nothing is saved unless they click Save.`
}

/**
 * `export_schedule` (view) — the Schedules window's Export menu, one entry, asked for from chat.
 * The window runs the menu's own action (`schedule-ui/exporting.ts` `EXPORT_ACTIONS`), which
 * opens the native Save dialog attached to it; only the user's Save there writes, through
 * `main/exports.ts`. This returns as soon as the window says it started, and never learns
 * whether a file was written.
 */
export const export_schedule: Executor = async (input) => {
  const format = input.format as ExportFormat
  if (!openSchedule()) {
    return {
      forModel: {
        message: `${scheduleConnected() ? NO_SCHEDULE : 'No Schedules window is open, so there is no schedule to export.'} Nothing was exported — make_schedule shows one.`,
        dialog: false
      }
    }
  }
  const answer = await requestExport(format, EXPORT_ACK_MS)
  if (answer !== 'opened') return { forModel: { message: NOT_EXPORTED[answer], dialog: false } }
  // Brought forward, so the user sees the dialog: the toolbar button's own route.
  try {
    await api()?.openSchedules()
  } catch {
    // The dialog still opens; the window is only not raised.
  }
  return {
    forModel: {
      message: `The Save dialog for ${FORMAT_LABEL[format]} is opening in the Schedules window, which was brought to the front. The user chooses the name and the folder there; nothing is saved unless they click Save, and this tool is not told whether they did — so do not say a file was saved.`,
      format,
      dialog: true
    },
    // 2026-10-02: a dialog is a request the user answers, and a turn makes one (`waitingOn`).
    ui: { asked: `the Save dialog for ${FORMAT_LABEL[format]} in the Schedules window` }
  }
}

/**
 * `color_by_schedule_column` (view) — the column heading menu's "Colour 3D by this column",
 * asked for from chat: `colourColumn` (the menu's own grouping) over the assistant's store, then
 * `colourByColumn` (the menu's own path into the legend). `null` is the legend's own clear.
 */
export const color_by_schedule_column: Executor = (input, ctx) => {
  const s = ctx.state()
  if (input.column === null) {
    s.clearColorBy()
    return { forModel: { message: 'Colour scheme cleared.', groups: [] }, ui: { acted: true } }
  }
  const open = openSchedule()
  if (!open) {
    return {
      forModel: {
        message: `${scheduleConnected() ? NO_SCHEDULE : 'No Schedules window is open, so there is no schedule column to colour by.'} Nothing was coloured — make_schedule shows one, or color_by_property colours by a property directly.`
      }
    }
  }
  const asked = String(input.column)
  const { store, rowIds } = scheduleStore(s)
  const shown = visibleColumns(open.def)
  const [col] = columnsNamed(asked, open.def, { store, propKeys: s.propKeys }, shown)
  if (!col) {
    const columns = shown.map((c) => headingOf(c, open.def))
    return {
      forModel: {
        message: `Nothing was coloured. No column of the open schedule is "${asked}" — its columns are ${columns.join(', ')}.`,
        valid_values: { columns }
      }
    }
  }
  const made = colourColumn(store, open.def, open.def.columns.indexOf(col), rowIds)
  if (!made || 'error' in made) {
    return { forModel: { message: `Nothing was coloured. ${made?.error ?? 'That column is not shown.'}` } }
  }
  const scheme = colourByColumn(made.label, made.key, made.groups)
  if (!scheme) {
    return { forModel: { message: 'Nothing was coloured — none of that column’s elements is in the loaded models.' } }
  }
  return schemeOutcome(scheme, `the schedule column "${made.label}"`, { column: made.label })
}

/* ────────────────────── the window's own controls (2026-10-02, phase 4) ────────────────────── */

/** Which operations name a saved setup or a template, and what to call it when it is missing. */
const NAMED: Partial<Record<ManageOp, string>> = {
  apply_template: 'template',
  load: 'saved setup',
  rename: 'saved setup',
  duplicate: 'saved setup',
  delete: 'saved setup'
}

/** A name from the Schedules window, as a result or a label carries it. */
const shown = (name: string | undefined): string => labelText(name ?? '', MANAGE_NAME_MAX)

/**
 * The same name in quotes, for a sentence — or the words for one the window did not send: a
 * name that is too long, or holds a control or direction character, never crosses the port
 * (`SafeName`), and a sentence must not then quote nothing.
 */
const quoted = (name: string | undefined): string =>
  name ? `"${shown(name)}"` : 'one whose name cannot be shown here'

/** The open schedule after a change made there: the window reports it before it answers. */
const nowShows = (): Record<string, unknown> => {
  const schedule = scheduleBriefOf()
  return schedule ? { schedule } : {}
}

/** Brought forward, so the user sees what is being asked: the toolbar button's own call. */
async function raiseSchedules(): Promise<void> {
  try {
    await api()?.openSchedules()
  } catch {
    // The question is still up there; the window is only not raised.
  }
}

/**
 * A request the Schedules window has put in front of the user. Nothing has happened, and the
 * turn's one request is taken (`ui.asked`).
 */
function askedThere(what: string, clicks: string, more: Record<string, unknown> = {}): ToolOutcome {
  return {
    forModel: {
      message: `Asked, not done: the Schedules window, brought to the front, ${what}. ${clicks}, and this turn is not told what they choose — so say what is being asked, never that it was done.`,
      done: false,
      asked: true,
      ...more
    },
    ui: { asked: `the Schedules window — it ${what}` }
  }
}

const nothing = (message: string, more: Record<string, unknown> = {}): ToolOutcome => ({
  forModel: { message, done: false, ...more }
})

/**
 * The answers that say nothing was done, in words. `null` for the four that have words of their
 * own below — done, asked, held, nothing. Every result is named here: one this file had no case
 * for would otherwise fall through and read as a success, so the compiler is made to check
 * (`never`), and a result that is somehow none of them still says that nothing was done.
 */
function refusedThere(answer: ManageAnswer, op: ManageOp, asked: string, to: string): ToolOutcome | null {
  const what = NAMED[op] ?? 'saved setup'
  const result = answer.result
  switch (result) {
    case 'closed':
      return nothing('The Schedules window closed, so nothing was done.')
    case 'timeout':
      return nothing(
        `The Schedules window did not answer within ${MANAGE_ACK_MS / 1000} s. It drops a request it gets to that late, so most likely nothing was done — read get_schedule, or saved_list, before saying either way.`
      )
    case 'busy':
      return nothing(
        'The Schedules window has a dialog of its own up, or is still answering another request. Nothing was done — the user finishes that first.'
      )
    case 'no_schedule':
      return nothing(`${NO_SCHEDULE} Nothing was done.`)
    case 'missing':
      return nothing(
        op === 'apply_template'
          ? `No template for the loaded models is called "${asked}". Nothing was done — op:"templates" lists them.`
          : `No ${what} is called "${asked}". Nothing was done — op:"saved_list" lists them.`
      )
    case 'taken':
      return nothing(`A saved setup is already called "${to}", so "${asked}" was not renamed.`)
    case 'failed':
      return nothing('This computer’s storage for saved setups is unavailable or full, so nothing was saved.')
    case 'done':
    case 'asked':
    case 'held':
    case 'nothing':
      return null
    default: {
      const unknown: never = result
      return nothing(`The Schedules window answered "${String(unknown)}", which this app has no meaning for — nothing is known to have been done.`)
    }
  }
}

/**
 * `manage_schedules` (view) — one of the Schedules window's own controls, asked for from chat.
 * `open` is this window's: the toolbar button's call. Everything else is run by the Schedules
 * window (`requestManage`), which answers at once; this never waits on a dialog there.
 */
export const manage_schedules: Executor = async (input, ctx) => {
  const op = String(input.op ?? '')
  if (op === 'open') {
    const bridge = api()
    if (!bridge) return nothing('The Schedules window cannot be opened here.', { open: false })
    const was = scheduleConnected()
    try {
      // The button's own call. On a window that is already open it brings it to the front.
      await bridge.openSchedules()
    } catch {
      // Reported below, as a window that never joined.
    }
    if (!(await whenScheduleConnected(CONNECT_WAIT_MS))) {
      return nothing(
        `The Schedules window did not open within ${CONNECT_WAIT_MS / 1000} s; the user can open it from the toolbar's schedules button.`,
        { open: false }
      )
    }
    return {
      forModel: {
        message: was
          ? 'The Schedules window was already open — it was brought to the front.'
          : 'Opened the Schedules window.',
        done: true,
        open: true,
        ...nowShows()
      }
    }
  }
  if (!scheduleConnected()) {
    return nothing(
      'No Schedules window is open, so nothing was done. op:"open" opens it, and make_schedule opens it with a schedule.',
      { open: false }
    )
  }

  const act = op as ManageOp
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const to = typeof input.to === 'string' ? input.to.trim() : ''
  const what = NAMED[act]
  if (what && !name) {
    return nothing(
      `Say which ${what}: pass its name. Nothing was done — op:"${act === 'apply_template' ? 'templates' : 'saved_list'}" lists them.`
    )
  }
  if (act === 'rename' && !to) return nothing(`Pass the new name in to — "${shown(name)}" was not renamed.`)

  const answer = await requestManage(
    act,
    {
      ...(what ? { name } : {}),
      ...(act === 'rename' ? { to } : {}),
      // The window may raise a question of its own only while this turn has asked for nothing.
      ask: !waitingOn(ctx.turn)
    },
    MANAGE_ACK_MS
  )
  const refused = refusedThere(answer, act, shown(name), shown(to))
  if (refused) return refused
  if (answer.result === 'held') {
    // A save or a duplicate that would take a saved setup away, in a turn that already has a
    // request waiting: nothing was asked there, and nothing was saved.
    return { forModel: alreadyWaiting(waitingOn(ctx.turn) ?? 'an earlier request') }
  }
  const named = shown(answer.name)

  if (answer.result === 'asked') {
    await raiseSchedules()
    if (act === 'delete') {
      return askedThere(
        `is asking whether to delete the saved setup ${quoted(answer.name)}, which cannot be undone`,
        'Nothing is deleted unless the user clicks Delete there',
        { name: named }
      )
    }
    if (act === 'print') {
      // That window's own confirm, not the print dialog: the native dialog's default button
      // prints, so it opens only on the user's click on Print… there.
      return askedThere(
        'is asking whether to open the print dialog for the schedule it shows',
        'The print dialog does not open, and nothing is printed, unless the user clicks Print… there'
      )
    }
    if (act === 'open_file') {
      return askedThere(
        'is opening its Open dialog for a schedule file (.schedule.json)',
        'The file the user picks there becomes the open schedule, and nothing changes if they cancel',
        { dialog: true }
      )
    }
    // A save or a duplicate that would forget a saved setup.
    const how =
      answer.forgets === 'replace'
        ? `is asking whether to save over the saved setup ${quoted(answer.gone)}, whose present contents cannot be brought back`
        : `is asking whether to ${act === 'duplicate' ? 'duplicate' : 'save'} ${quoted(answer.name)}, because only a hundred are kept and the oldest, ${quoted(answer.gone)}, would be forgotten`
    return askedThere(how, `Nothing is saved unless the user clicks ${act === 'duplicate' ? 'Duplicate' : 'Save'} there`, {
      name: named,
      wouldForget: shown(answer.gone)
    })
  }

  if (answer.result === 'nothing') {
    if (act === 'undo' || act === 'redo') {
      return nothing(`There is nothing to ${act} in the Schedules window.`, {
        undoSteps: answer.undo ?? 0,
        redoSteps: answer.redo ?? 0
      })
    }
    if (act === 'rename') return nothing(`${quoted(answer.name)} is already called that — nothing changed.`)
    return nothing('The open schedule has no columns, so there was nothing to save.')
  }

  // done
  switch (act) {
    case 'saved_list': {
      const saved = (answer.saved ?? []).map((row) => ({
        ...row,
        name: shown(row.name),
        classes: row.classes.map((c) => labelText(c, 60))
      }))
      const unlisted = answer.unlisted ?? 0
      return {
        forModel: {
          message:
            (saved.length
              ? `${saved.length} saved setup${saved.length === 1 ? '' : 's'} in My templates, newest first.`
              : 'There are no saved setups in My templates.') +
            (unlisted
              ? ` ${unlisted} more cannot be listed here: their names are too long, or hold characters that cannot be shown — the user reaches them in the Schedules window.`
              : ''),
          done: true,
          saved,
          total: saved.length + unlisted,
          truncated: unlisted > 0
        }
      }
    }
    case 'templates': {
      const templates = answer.templates ?? []
      return {
        forModel: {
          message: templates.length
            ? `${templates.length} template${templates.length === 1 ? '' : 's'} fit the loaded models. fit is how many of a template’s columns this model has data for, and elements how many it would list.`
            : 'No ready-made template fits the loaded models.',
          done: true,
          templates
        }
      }
    }
    case 'undo':
    case 'redo':
      return {
        forModel: {
          message: `${act === 'undo' ? 'Undid' : 'Redid'} one step in the Schedules window — ${answer.undo ?? 0} to undo and ${answer.redo ?? 0} to redo are left there.`,
          done: true,
          undoSteps: answer.undo ?? 0,
          redoSteps: answer.redo ?? 0,
          ...nowShows()
        }
      }
    case 'apply_template':
      return {
        forModel: {
          message: `Started the schedule from the template ${quoted(answer.name)} in the Schedules window. It replaced the schedule that was open, which the user can undo there.`,
          done: true,
          name: named,
          ...nowShows()
        }
      }
    case 'load': {
      const lacks = answer.lacks ?? 0
      return {
        forModel: {
          message:
            `Loaded the saved setup ${quoted(answer.name)} in the Schedules window. It replaced the schedule that was open, which the user can undo there.` +
            (lacks
              ? ` It was saved against another model: this one has none of ${lacks} of the classes it names.`
              : ''),
          done: true,
          name: named,
          ...(lacks ? { classesNotInModel: lacks } : {}),
          ...nowShows()
        }
      }
    }
    case 'save':
      return {
        forModel: {
          message: `Saved the open schedule to My templates as ${quoted(answer.name)}. A setup of another name is never replaced: when the title was taken, the copy was numbered.`,
          done: true,
          name: named,
          ...nowShows()
        }
      }
    case 'rename':
      return {
        forModel: { message: `Renamed the saved setup "${shown(name)}" to ${quoted(answer.name)}.`, done: true, name: named }
      }
    case 'duplicate':
      return {
        forModel: { message: `Copied the saved setup "${shown(name)}" to ${quoted(answer.name)}.`, done: true, name: named }
      }
    default:
      // `delete`, `print` and `open_file` are never answered `done`: they only ask. Should one
      // ever be, it is said as what it is rather than as some other operation's sentence.
      return { forModel: { message: 'The Schedules window says that was done.', done: true } }
  }
}

export const SCHEDULE_EXECUTORS: Record<string, Executor> = {
  get_schedule,
  make_schedule,
  export_schedule,
  color_by_schedule_column,
  manage_schedules
}
