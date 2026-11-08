/**
 * A stand-in for the Schedules window — **the eval suite's, and nothing else** (2026-11-08, with
 * the Ask Vee eval cases).
 *
 * The assistant's five schedule tools talk to the Schedules window over a private port
 * (`model/schedule-link.ts`), and an eval case's window is not the app's main window, so the
 * toolbar's own call opens no Schedules window there — which is why, until now, no eval case
 * could grade `make_schedule`, `get_schedule`, `manage_schedules`, `export_schedule` or
 * `color_by_schedule_column`. This joins the link from the other end, through the same
 * `connect` the preload's port goes through, and answers each message as that window does:
 *
 *   · `define`  — shown as the current, unsaved schedule, on an undo history of its own;
 *   · `manage`  — the window's own answer, at once: `undo` / `redo` step that history,
 *                 `save` / `load` / `rename` / `duplicate` / `saved_list` act on a list of saved
 *                 setups kept here, `templates` / `apply_template` read the ported engine's own
 *                 template list, and `delete`, `print` and `open_file` are **asked, never done** —
 *                 recorded as a question put to the user and answered `asked`, as the real
 *                 window answers before its own confirm or Open dialog (or `held` when the
 *                 request says no question may be raised);
 *   · `export`  — recorded as a Save dialog asked for, and acknowledged `opened` by the Export
 *                 menu's own refusal rules; nothing is ever written.
 *
 * What it does not do is anything of the window's own UI: no table, no toasts, no dialogs. Its
 * `state()` is what a grader reads — the open schedule as `scheduleBrief` puts it, the history's
 * depth, the saved setups, and the Save dialogs and questions it was asked for.
 *
 * Dev-only: imported by `App.tsx`'s dev-tools block (`window.__sgvueDev.schedules`) and by the
 * offline eval test, so none of it is in a production bundle.
 */
import { readSchedule, scheduleBrief } from '../../schedule/assistant'
import type { ScheduleBrief } from '../../shared/ai-schema'
import type { ExportFormat, ManageOp } from '../../schedule/messages'
import type { ScheduleDef } from '../../schedule/schedule/def'
import { presetCount, presetsFor, scheduleFromPreset } from '../../schedule/schedule/presets'
import { connect, openSchedule, receive, scheduleStore } from '../model/schedule-link'
import { useShell } from '../state/shell'

/** What a grader reads off the stand-in. */
export interface StandInState {
  /** The schedule it shows, as the per-turn view state's `schedule` line puts it, or null. */
  open: ScheduleBrief | null
  /** Steps on its undo history each way. */
  undo: number
  redo: number
  /** Saved setups, newest first, by name. */
  saved: string[]
  /** Each Save dialog the Export menu was asked to open, in order. Nothing was ever written. */
  exports: ExportFormat[]
  /** Each question it put to the user for the assistant, in order: nothing of it was done. */
  asked: { op: ManageOp; name?: string }[]
}

type Msg = { type: string; [k: string]: unknown }

let live: { port: MessagePort; state: () => StandInState } | null = null

const rowsOf = (def: ScheduleDef): number => {
  const { store, rowIds } = scheduleStore(useShell.getState())
  return readSchedule(store, def, rowIds).forModel.rowCount as number
}

/** Join the link as a Schedules window would. Replaces any stand-in already joined. */
export function attachScheduleStandIn(): () => StandInState {
  detachScheduleStandIn()
  let current: ScheduleDef | null = null
  const undo: (ScheduleDef | null)[] = []
  const redo: (ScheduleDef | null)[] = []
  let saved: { name: string; def: ScheduleDef }[] = []
  const exports: ExportFormat[] = []
  const asked: { op: ManageOp; name?: string }[] = []

  const show = (def: ScheduleDef | null): void => {
    current = def
    receive({ type: 'current', def, rowCount: def ? rowsOf(def) : 0 })
  }
  const find = (name: unknown): { name: string; def: ScheduleDef } | undefined =>
    typeof name === 'string' ? saved.find((s) => s.name === name.trim()) : undefined
  const freeName = (base: string): string => {
    if (!saved.some((s) => s.name === base)) return base
    for (let i = 2; ; i++) if (!saved.some((s) => s.name === `${base} (${i})`)) return `${base} (${i})`
  }
  const step = (from: (ScheduleDef | null)[], to: (ScheduleDef | null)[]): boolean => {
    if (!from.length) return false
    to.push(current)
    show(from.pop() ?? null)
    return true
  }
  const presets = (): ReturnType<typeof presetsFor> => presetsFor(scheduleStore(useShell.getState()).store.byEntity)

  const manage = (m: Msg): Record<string, unknown> => {
    const op = m.op as ManageOp
    const shows = !!current
    switch (op) {
      case 'saved_list':
        return {
          result: 'done',
          saved: saved.map((s) => ({
            name: s.name,
            classes: s.def.entity.slice(0, 12),
            columns: s.def.columns.length,
            saved: '',
            inUse: false,
            lacks: false
          })),
          unlisted: 0
        }
      case 'templates': {
        if (!shows) return { result: 'no_schedule' }
        const byEntity = scheduleStore(useShell.getState()).store.byEntity
        return {
          result: 'done',
          templates: presets().slice(0, 60).map((p) => ({
            id: p.id,
            name: p.name,
            classes: p.entities.slice(0, 12),
            columns: p.columns.length,
            fit: p.columns.length,
            elements: presetCount(byEntity, p),
            inUse: false
          }))
        }
      }
      case 'undo':
      case 'redo': {
        if (!shows && !undo.length && !redo.length) return { result: 'no_schedule' }
        const stepped = op === 'undo' ? step(undo, redo) : step(redo, undo)
        return { result: stepped ? 'done' : 'nothing', undo: undo.length, redo: redo.length }
      }
      case 'apply_template': {
        if (!shows) return { result: 'no_schedule' }
        const want = String(m.name ?? '').trim().toLowerCase()
        const p = presets().find((x) => x.id === want) ?? presets().find((x) => x.name.toLowerCase() === want)
        if (!p) return { result: 'missing' }
        undo.push(current)
        redo.length = 0
        show(scheduleFromPreset(p))
        return { result: 'done', name: p.name }
      }
      case 'load': {
        if (!shows) return { result: 'no_schedule' }
        const entry = find(m.name)
        if (!entry) return { result: 'missing' }
        undo.push(current)
        redo.length = 0
        show(entry.def)
        return { result: 'done', name: entry.name, lacks: 0 }
      }
      case 'save': {
        if (!current) return { result: 'no_schedule' }
        if (!current.columns.length) return { result: 'nothing' }
        if (saved.length >= 100) return { result: 'full' }
        const name = freeName(current.name)
        saved = [{ name, def: current }, ...saved]
        return { result: 'done', name }
      }
      case 'rename': {
        const entry = find(m.name)
        if (!entry) return { result: 'missing' }
        const to = String(m.to ?? '').trim()
        if (!to || to === entry.name) return { result: 'nothing', name: entry.name }
        if (saved.some((s) => s.name === to)) return { result: 'taken' }
        entry.name = to
        return { result: 'done', name: to }
      }
      case 'duplicate': {
        const entry = find(m.name)
        if (!entry) return { result: 'missing' }
        if (saved.length >= 100) return { result: 'full' }
        const name = freeName(`${entry.name} copy`)
        saved = [{ name, def: entry.def }, ...saved]
        return { result: 'done', name }
      }
      case 'delete': {
        const entry = find(m.name)
        if (!entry) return { result: 'missing' }
        if (!m.ask) return { result: 'held' }
        asked.push({ op, name: entry.name })
        return { result: 'asked', name: entry.name }
      }
      case 'print':
      case 'open_file':
        if (!shows) return { result: 'no_schedule' }
        if (!m.ask) return { result: 'held' }
        asked.push({ op })
        return { result: 'asked' }
      default:
        return { result: 'busy' }
    }
  }

  const port = {
    onmessage: null,
    close: (): void => undefined,
    postMessage: (raw: unknown): void => {
      const m = raw as Msg
      if (m.type === 'define') {
        // Shown as the current, unsaved schedule — one step on this window's own undo history.
        // `defineSchedule` keeps it on the main side with its own engine run's row count.
        undo.push(current)
        redo.length = 0
        current = m.def as ScheduleDef
        return
      }
      if (m.type === 'manage') {
        const n = m.n as number
        queueMicrotask(() => receive({ type: 'manageAck', n, ...manage(m) }))
        return
      }
      if (m.type === 'export') {
        const n = m.n as number
        const format = m.format as ExportFormat
        const refused = !current ? 'no_schedule' : format === 'all_saved' && !saved.length ? 'nothing_saved' : null
        if (!refused) exports.push(format)
        queueMicrotask(() => receive({ type: 'exportAck', n, refused }))
      }
      // store, theme, sel, vis, colours, projectSchedules: a table's business, not this stand-in's.
    }
  } as unknown as MessagePort

  const state = (): StandInState => {
    const open = openSchedule()
    return {
      open: open ? scheduleBrief(open.def, open.rowCount) : null,
      undo: undo.length,
      redo: redo.length,
      saved: saved.map((s) => s.name),
      exports: [...exports],
      asked: asked.map((a) => ({ ...a }))
    }
  }
  live = { port, state }
  connect(port)
  return state
}

/** Leave the link, as a Schedules window that closes does. */
export function detachScheduleStandIn(): void {
  if (!live) return
  live = null
  connect(null)
}

/** The joined stand-in's state, or null when none is joined. */
export const scheduleStandInState = (): StandInState | null => (live ? live.state() : null)
