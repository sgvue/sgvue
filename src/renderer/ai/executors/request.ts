/**
 * `request_user_action` — what the assistant may only **ask** for (2026-10-02; parity with the
 * user, phase 3 of 4 — the consent gate).
 *
 * The owner's direction is that the assistant should be able to do whatever the user can do in
 * the app. Five of those things reach outside the view or cannot be undone, and the rule for
 * them is the owner's too — asked how the assistant should handle them, the recommendation,
 * *the assistant proposes, and you click Apply in the chat or pick in the Windows dialog*, was
 * confirmed: *"correct."* The reason is prompt injection: text authored inside an IFC file
 * reaches the model through every tool result, and must never be able to open, unload or copy
 * anything by itself. So this tool **never does any of them**:
 *
 *   open_files      the designed `upload` control's own call — the native Open dialog. The
 *                   user's pick loads, through main's `admit()`; the tool is not told what it was.
 *   open_recent     a Recent pill, asked for by the file's **name** → the pending row
 *   unload_model    a model's × — the sidebar's own "Unload …?" confirmation, where the user's
 *                   click on `delete` unloads
 *   copy_link       "copy link to this state"                 → the pending row
 *   copy_guids      the property card's Copy                  → the pending row
 *
 * (A sixth, `set_base_point` — the Coordinate-system card's four fields — was asked for here from
 * 2026-10-02 until 2026-10-08, when the owner made the card read-only: *"dont let user change
 * anything."* What nobody can change, the assistant cannot ask to change.)
 *
 * "The pending row" is the design's own (`SGVue.dc.html:1632`): the label says exactly what
 * Apply will do, Apply does it — in the store's `applyPending`, the one place any of these is
 * performed — and Cancel drops it. **Nothing here imports or calls the action it asks for**
 * (`tests/readonly-guard.test.ts` reads this directory to hold that): what leaves this file is
 * a description of the request (`context.ts`, `PendingAction`), two calls that only raise a
 * surface the user answers (`openDialog`, `askRemove`), and one that opens the sidebar so that
 * surface can be seen.
 *
 * **No path, anywhere.** A recent file is named, and the name is matched against the app's own
 * list — it is never opened as given, and `inputs.ts` has already refused one with a separator
 * in it. No result and no label carries a file's path or the share link's text: a result is
 * read by the model, and both are things a hostile file could ask it to repeat.
 *
 * One request a turn, of any kind (`executors/index.ts`).
 */
import { RECENT_NAME_CHARS, RECENT_NAME_MAX } from '../../../shared/tool-schemas'
import { api } from '../../api'
import { openDialog, openDialogUp } from '../../model/upload-pipeline'
import { modelLabel } from '../../state/selectors/models'
import type { LibraryFile, ShellState } from '../../state/shell'
import { askApply, labelText, notLoaded, type Executor, type ToolContext, type ToolOutcome } from './context'
import { emptyTargetMessage, resolveTargets, unknownFields, unknownText } from './targets'

/* ────────────────────────────── open files ────────────────────────────── */

/**
 * The native Open dialog — the designed `upload` control's own call, **never awaited**: what
 * the user picks, and whether they pick anything, is theirs, and the tool returns as soon as
 * the dialog has been asked for (as `export_schedule` does with its Save dialog). One at a time:
 * while a dialog is up — this one, or the user's own — a second request is refused.
 */
function askOpenFiles(): ToolOutcome {
  if (!api()) {
    return { forModel: { message: 'The Open dialog cannot be opened here — nothing was asked.', dialog: false } }
  }
  if (openDialogUp()) {
    return {
      forModel: {
        message:
          'An Open dialog is already up — the user answers that one first. Nothing more was asked for.',
        dialog: false
      }
    }
  }
  void openDialog().catch((error: unknown) => console.error('[sgvue] the Open dialog failed —', error))
  return {
    forModel: {
      message:
        'The Open dialog is up. The user picks the IFC files to load there, or cancels; what they pick loads as any upload does. This tool is not told what was picked, or whether anything was — so do not say a file was opened.',
      dialog: true
    },
    ui: { asked: 'the Open dialog' }
  }
}

/* ────────────────────────────── open a recent file ────────────────────────────── */

/** A file's name with nothing in front of it: a result names files, and never says where they are. */
const baseName = (file: string): string => file.split(/[\\/]/).pop() ?? file

/**
 * The app's recent files as a result may show them: real files only (the dev `#mock` library
 * has entries with no file behind them), by name. The list is main's own, six at most.
 *
 * A file's name is whatever the disk has, so it goes through `labelText` like every name a
 * label or a result carries — and it is that name a request is matched against, so a file is
 * asked for by the name this tool showed for it.
 */
function recentFiles(s: ShellState): { entry: LibraryFile; name: string }[] {
  return s.library
    .filter((f) => !!f.path)
    .map((entry) => ({ entry, name: labelText(baseName(entry.file), RECENT_NAME_MAX) }))
}

function askOpenRecent(input: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  const s = ctx.state()
  const recents = recentFiles(s)
  const names = recents.map((r) => labelText(r.name, RECENT_NAME_CHARS))
  const listText = names.length
    ? `The recent files are: ${names.map((n) => `"${n}"`).join(', ')}.`
    : 'There are no recent files.'
  const asked = typeof input.recent === 'string' ? input.recent.trim() : ''
  if (!asked) {
    return {
      forModel: {
        message: `Say which file: pass its name in recent. Nothing was asked. ${listText}`,
        recentFiles: names
      }
    }
  }
  // The name as the list has it — exactly, then without regard to case, with or without its
  // extension. It is only ever compared: nothing the model sent is opened.
  const stem = (name: string): string => name.replace(/\.[^.]+$/, '')
  const low = asked.toLowerCase()
  let hits = recents.filter((r) => r.name === asked)
  if (!hits.length) hits = recents.filter((r) => r.name.toLowerCase() === low || stem(r.name).toLowerCase() === low)
  const said = labelText(asked, RECENT_NAME_CHARS)
  if (!hits.length) {
    return {
      forModel: {
        message: `No recent file is called "${said}". Nothing was asked. ${listText}`,
        recentFiles: names
      }
    }
  }
  if (hits.length > 1) {
    // Two folders, one file name. A label cannot say which without saying where, so neither is
    // proposed: the user opens the one they mean from the library themselves.
    return {
      forModel: {
        message: `${hits.length} recent files are called "${said}", in different folders, and a request cannot tell them apart. Nothing was asked — the user can open the one they mean from the sidebar’s library.`,
        recentFiles: names
      }
    }
  }
  const { entry, name } = hits[0]
  const shown = labelText(name, RECENT_NAME_CHARS)
  // A model is keyed by its file's stem, and a pick whose model is already open is asked about
  // in the app's own "Replace model?" box — said here, so the label is the whole of the click.
  const replaces = s.loaded.includes(stem(name))
  return askApply(
    `open the recent file "${shown}"` +
      (replaces ? ' — a model of that name is open, so the app will ask whether to replace it' : ''),
    { kind: 'open_recent', path: entry.path! },
    { recent: shown }
  )
}

/* ────────────────────────────── unload a model ────────────────────────────── */

/**
 * The designed inline confirmation beside a model's row — `askRemove`, the ×'s own action. The
 * user's click on `delete` there is what unloads; `cancel` puts it away. Refused while one
 * model is loaded: the sidebar draws no × for the last model, and neither does this.
 *
 * `askRemove` toggles, so it is called only when the confirmation is not already up for that
 * model. The confirmation lives in the sidebar, so a collapsed sidebar is opened first — its
 * own expand button's action — or the user would be asked something they cannot see.
 */
function askUnload(input: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  const s = ctx.state()
  const asked = typeof input.model === 'string' ? input.model : ''
  // A key is its file's name without the extension — a name like any other in a result.
  const shownKeys = s.loaded.map((k) => labelText(k, RECENT_NAME_CHARS))
  if (!asked) {
    return {
      forModel: {
        message: `Say which model: pass its key in model. Nothing was asked. Loaded: ${shownKeys.join(', ')}`,
        valid_values: shownKeys
      }
    }
  }
  // The key as it is loaded — or as this tool shows it, where the two differ.
  const key = s.loaded.includes(asked) ? asked : (s.loaded[shownKeys.indexOf(asked)] ?? '')
  if (!key) return notLoaded(labelText(asked, RECENT_NAME_CHARS), shownKeys)
  const shownKey = labelText(key, RECENT_NAME_CHARS)
  if (s.loaded.length < 2) {
    return {
      forModel: {
        message: `${shownKey} is the only model loaded, and the last model cannot be unloaded — the sidebar offers no × for it either. Nothing was asked.`,
        asked: false
      }
    }
  }
  const model = s.federation.models.find((m) => m.meta.modelKey === key)
  const name = labelText(modelLabel(key, model?.meta.fileName ?? key, s.library, s.uploadNames[key]), RECENT_NAME_CHARS)
  const opened = !s.panelOpen
  if (opened) s.togglePanel()
  const already = ctx.state().confirmRemove === key
  if (!already) ctx.state().askRemove(key)
  return {
    forModel: {
      message:
        `The sidebar ${already ? 'is already asking' : 'now asks'} "Unload ${name}?" beside that model${opened ? ' (the sidebar was collapsed, so it was opened)' : ''}. ` +
        'Nothing is unloaded unless the user clicks delete there, and this turn is not told whether they do — so say what is being asked, never that the model was unloaded.',
      asked: true,
      model: shownKey
    },
    // The sidebar, when it had to be opened, is a change the reply's revert can put back.
    ui: { asked: `the sidebar’s "Unload ${name}?" confirmation`, acted: opened }
  }
}

/* ────────────────────────────── copy GlobalIds ────────────────────────────── */

/**
 * The property card's Copy, for one element or a set: the GlobalIds, one per line, as the
 * Schedules window's "Copy GUIDs" writes them. Only a **valid** GlobalId is copied — 22
 * characters of IFC's own alphabet (`guidValid`, the parser's check): a file can author
 * anything in that attribute, and what lands on the user's clipboard is pasted somewhere.
 * The text is fixed here, and the result does not repeat it.
 */
function askCopyGuids(input: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  const s = ctx.state()
  const t = resolveTargets({ ids: input.ids, selection: input.selection, schedule: input.schedule }, s)
  if (t.source === 'none') {
    return {
      forModel: {
        message:
          'Say whose GlobalIds: pass ids, selection:true, or schedule:true for what the open schedule lists. Nothing was asked.'
      }
    }
  }
  if (!t.hit.length) {
    return { forModel: { message: emptyTargetMessage(t, 'asked for'), ...unknownFields(t) } }
  }
  const valid = t.hit.filter((e) => e.guidValid)
  const skipped = t.hit.length - valid.length
  if (!valid.length) {
    return {
      forModel: {
        message: `None of those ${t.hit.length} element${t.hit.length === 1 ? '' : 's'} carries a valid IFC GlobalId, so there is nothing to copy. Nothing was asked.`,
        ...unknownFields(t)
      }
    }
  }
  const label =
    valid.length === 1
      ? `copy the GlobalId ${valid[0].guid} to the clipboard`
      : `copy the GlobalIds of ${valid.length} elements to the clipboard, one per line`
  const out = askApply(label, { kind: 'copy_guids', text: valid.map((e) => e.guid).join('\n') }, {
    target: t.source,
    count: valid.length,
    ...(skipped ? { withoutValidGlobalId: skipped } : {}),
    ...unknownFields(t)
  })
  const tail =
    (skipped ? ` ${skipped} of them carry no valid GlobalId and are left out.` : '') +
    (unknownText(t) ? `${unknownText(t)}.` : '')
  if (tail) (out.forModel as { message: string }).message += tail
  return out
}

/* ────────────────────────────── the tool ────────────────────────────── */

export const request_user_action: Executor = (input, ctx) => {
  switch (String(input.action ?? '')) {
    case 'open_files':
      return askOpenFiles()
    case 'open_recent':
      return askOpenRecent(input, ctx)
    case 'unload_model':
      return askUnload(input, ctx)
    case 'copy_link':
      // The link is cut when the user clicks, from the view as it stands then — which is what
      // the card's own control does. It is never in a result: it carries the files' paths.
      return askApply('copy a link to this view to the clipboard — the view as it stands when you click', {
        kind: 'copy_link'
      })
    case 'copy_guids':
      return askCopyGuids(input, ctx)
    default:
      // `inputs.ts` has already refused an action that is not one of these five.
      return { forModel: { message: `There is no action "${labelText(String(input.action ?? ''), 40)}". Nothing was asked.` } }
  }
}

export const REQUEST_EXECUTORS: Record<string, Executor> = { request_user_action }
