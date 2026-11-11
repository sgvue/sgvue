/**
 * The chat panel's pure pieces — `SGVue.dc.html:2015–2051` (the per-message view model, the
 * reply strip, the suggestion list) and `:1127–1136` (the resize clamp).
 *
 * The same split every other selector in this folder uses: the **decision** is a function of
 * data, so a bubble's corner radius, a quantity column, the CSV a table copies and the size a
 * drag settles on can all be tested without a DOM, a viewer or a model call.
 *
 * 2026-10-01: the assistant has a name of its own, **Vee** (`ASSISTANT`, `authorOf` — the
 * design's three `'SGVue'` literals in one place), and the resize clamp takes the bottom row's
 * lane.
 *
 * The same day, the owner's "Ask Vee" handoff in full: **a user's row stands on the left**, as
 * the assistant's does, with the assistant's corner — the handoff's, and what makes the typed
 * line's lift from the composer a straight line (the design: on the right, `:2015`); a reply
 * that came from a turn carries what its thinking trace left (`ChatMessage.trace`: the status
 * beside the name, whether its bubble is the trace's full-width one, its rows); and the mascot
 * in front of the newest such reply is `done` (`veeStateOf`).
 */
import type { ChatPending, ChatTable, PendingAction } from '../../ai/executors/context'
import { group } from '../../../shared/fmt'
import { volumeIn, volumeUnit, type DisplayUnit } from '../../../shared/units'
import { csvCell, defuse } from '../../../schedule/export/csv'
import type { ChatMessage, ShellState } from '../shell'
import { chatSuggest, type SuggestInput } from '../../ai/analysis'
import { plainText } from '../../ai/blocks'
import type { VeeState } from '../../app/vee-grid'

/**
 * The assistant's name (2026-10-01 — the owner's "Ask Vee" handoff, `design-reference/ask-vee/`).
 * The design calls it by the app's own name, `SGVue` (`:1597`, `:2017`, `:2038`); the app is
 * still SGVue, and the assistant in it is Vee.
 */
export const ASSISTANT = 'Vee'

/**
 * Who a message is from — the one expression the design writes three times: on a message's
 * label (`:2017`), on the reply strip (`:2038`) and on the quote a reply carries (`:1597`).
 */
export const authorOf = (m: Pick<ChatMessage, 'role'>): string =>
  m.role === 'user' ? 'You' : ASSISTANT

/**
 * One message, as `:2015` derives it — what the Ask Vee window still reads of it. The old chat
 * panel's other fields (side, colour, corner, width, label, mascot, the has-chips / has-table /
 * has-pending flags, the trace's status and width) went with that panel on 2026-11-08; the
 * quote and the opacity stay because a test reads the stored quote and the reverted flag
 * through them.
 */
export interface ChatRow {
  opacity: string
  quoteWho: string
  quoteText: string
  tableTitle: string
  tableRows: { k: string; n: string; q: string; ids: readonly number[] }[]
  canRevert: boolean
}

/**
 * `:2029`. The table's middle column: a clash volume, else an area, else a volume, else blank.
 *
 * 2026-10-09. A clash's overlap is a volume the app computes, so it follows the display unit —
 * m³, or ft³ in `ft`. An area or a volume total is the file's own number, summed as authored,
 * so a table that states its units (`ChatTable.units`, which `summarize_elements` always does)
 * labels it in the file's own unit — `m²` on a metric Revit export as before, `ft²` on one in
 * feet — and with no unit where the files do not settle one, as the reply says. A table that
 * states none is labelled as the design labels it, `m²` / `m³`.
 */
export function tableQuantity(
  table: Pick<ChatTable, 'clash' | 'units'>,
  row: { area?: number; volume?: number; vol?: number },
  unit: DisplayUnit = 'mm'
): string {
  if (table.clash) {
    const v = volumeIn(row.vol ?? 0, unit)
    return v >= 0.001 ? v.toFixed(3) + ' ' + volumeUnit(unit) : '<0.001 ' + volumeUnit(unit)
  }
  const label = (u: string | undefined, design: string): string =>
    !table.units ? ' ' + design : u ? ' ' + u : ''
  if (row.area) return row.area.toFixed(1) + label(table.units?.area, 'm²')
  if (row.volume) return row.volume.toFixed(2) + label(table.units?.volume, 'm³')
  return ''
}

/**
 * `:2031`'s "copy csv", as a string. The header names the grouping the table was built on. A
 * clash volume is the number the table shows, in the display unit's cube (2026-10-09).
 *
 * 2026-11-08 — the key and the grouping are file text, so they are written as the Schedules
 * exporter writes a cell (`schedule/export/csv.ts`): a leading `=`, `+`, `@` or a `-` that is not
 * a number is defused with an apostrophe, and an inner `"` is doubled. The key stays quoted
 * always, as the design's line quotes it; the grouping is quoted only when it needs to be, so an
 * ordinary table copies byte for byte what it did.
 */
export function tableCsv(table: ChatTable, unit: DisplayUnit = 'mm'): string {
  return [
    `${csvCell(table.groupBy)},count,quantity`,
    ...table.rows.map(
      (r) =>
        `"${defuse(r.k).replace(/"/g, '""')}",${r.n},${r.area ? r.area.toFixed(2) : r.vol != null ? volumeIn(r.vol, unit).toFixed(4) : r.volume ? r.volume.toFixed(3) : ''}`
    )
  ].join('\n')
}

/**
 * 2026-11-07 — a message as the Ask Vee window has it: what the panel draws of it, and nothing
 * else. The chat panel is a window of its own since then (`main/vee-window.ts`), and the
 * conversation still runs in the main window, which sends it this (`model/vee-link.ts`,
 * `shared/vee-messages.ts`). What it leaves out is what only the main window may use: the
 * snapshot a `revert` puts back, the request behind `apply`, and the element ids behind a chip
 * or a row — an act on one of those names its place, and the main window looks it up.
 *
 * `id` is the identity of the main window's message object, and `pending.id` that of the request
 * it holds: an act carries them back, so one on a row the transcript has since replaced does
 * nothing. Ids may be absent here, as in a `ChatMessage`; the snapshot carries none.
 */
export interface ChatMessageView {
  id: number
  role: 'user' | 'assistant'
  text: string
  quote: { who: string; text: string } | null
  chips: { label: string; ids?: readonly number[] }[]
  table:
    | (Pick<ChatTable, 'groupBy' | 'clash' | 'units'> & {
        rows: { k: string; n: number; area?: number; volume?: number; vol?: number; ids?: readonly number[] }[]
      })
    | null
  pending: { id: number; label: string; verb?: ConsentVerb } | null
  canRevert: boolean
  reverted: boolean
  trace:
    | {
        status: string
        wide: boolean
        noun: string
        rows: { label: string; n: number }[]
        /** 2026-11-08 (stage 1b) — `ChatTrace.fold`, `steps` and `title`, when the turn left them. */
        fold?: string
        steps?: { label: string; mono: string; n: number | null; unit: string }[]
        title?: string
      }
    | null
  /** 2026-11-08 — `ChatMessage.at`, `seen`, `settled` and `revertedAt`, as they are. */
  at?: number
  seen?: boolean
  settled?: ChatMessage['settled']
  revertedAt?: number
}

/**
 * `ChatMessage` → `ChatMessageView`. `id` and `pending` are the identities the caller gave the
 * message and its request. Whether it offers `revert` is decided here, once: a reply that changed
 * something a revert can put back — since 2026-10-02 a markup it placed counts, as it is taken
 * away (`ChatMessage.placed`).
 */
export function messageView(m: ChatMessage, id = 0, pending = 0): ChatMessageView {
  const trace = m.role === 'user' ? null : (m.trace ?? null)
  return {
    id,
    role: m.role,
    text: m.text,
    quote: m.quote ?? null,
    chips: m.chips ?? [],
    table: m.table ?? null,
    pending: m.pending ? { id: pending, label: m.pending.label, verb: pendingVerb(m.pending) } : null,
    canRevert: (!!m.undoSnap || !!m.placed?.length) && !m.reverted,
    reverted: !!m.reverted,
    trace: trace && {
      status: trace.status,
      wide: trace.wide,
      noun: trace.noun,
      rows: trace.rows,
      ...(trace.fold !== undefined ? { fold: trace.fold } : {}),
      ...(trace.steps ? { steps: trace.steps } : {}),
      ...(trace.title !== undefined ? { title: trace.title } : {})
    },
    ...(m.at !== undefined ? { at: m.at } : {}),
    ...(m.role === 'user' ? { seen: !!m.seen } : {}),
    ...(m.settled ? { settled: m.settled } : {}),
    ...(m.revertedAt !== undefined ? { revertedAt: m.revertedAt } : {})
  }
}

/** `:2015`. A stored message's row: `viewRow` over `messageView`, which the tests reach it through. */
export const chatRow = (m: ChatMessage, i: number, unit: DisplayUnit = 'mm'): ChatRow =>
  viewRow(messageView(m), i, unit)

/** `chatRow` for a message as the Ask Vee window has it (2026-11-07). */
export function viewRow(m: ChatMessageView, _i: number, unit: DisplayUnit = 'mm'): ChatRow {
  const table = m.table
  return {
    opacity: m.reverted ? '0.5' : '1',
    quoteWho: m.quote ? m.quote.who : '',
    quoteText: m.quote ? m.quote.text : '',
    tableTitle: table ? table.groupBy : '',
    tableRows: table
      ? table.rows.map((r) => ({
          k: r.k,
          n: String(r.n),
          q: tableQuantity(table, r, unit),
          ids: r.ids ?? []
        }))
      : [],
    canRevert: m.canRevert
  }
}

/**
 * The mascot in front of a reply that is not being written: **`done` while the reply is a
 * turn's and the newest message in the transcript**, `idle` otherwise — every older reply, and
 * the boot audit, which no turn produced. (The reply being written takes its state from the
 * trace; the header's sprite and the pill's are always `idle`.)
 */
export const veeStateOf = (
  msgs: readonly { role: ChatMessage['role']; trace?: object | null }[],
  i: number
): VeeState =>
  i === msgs.length - 1 && msgs[i]?.role === 'assistant' && !!msgs[i].trace ? 'done' : 'idle'

/**
 * 2026-11-08 (stage 1b) — a consent card's two lines, from the request's one label: the question
 * — what Apply will do, its first letter a capital and a question mark after it — and the detail
 * after the label's first ` — `, in the card's mono line (`delete the viewpoint "Lobby" (3D) — it
 * cannot be brought back` → `Delete the viewpoint "Lobby" (3D)?` / `It cannot be brought back`).
 * Nothing is added to what the label says, and a label with no ` — ` has no detail. The labels
 * themselves are the requests' own, unchanged (`ai/executors`).
 */
export function consentText(label: string): { q: string; detail: string } {
  const at = label.indexOf(' — ')
  const head = (at < 0 ? label : label.slice(0, at)).trim()
  const rest = at < 0 ? '' : label.slice(at + 3).trim()
  const cap = (t: string): string => (/^[a-z]/.test(t) ? t[0].toUpperCase() + t.slice(1) : t)
  const q = head ? cap(head) + (/[?.!:]$/.test(head) ? '' : '?') : ''
  return { q, detail: cap(rest) }
}

/** How long the send button ignores clicks after it has stopped a turn. */
export const STOP_GUARD_MS = 300

/**
 * What a click on the send button does (2026-10-01 — the button is the stop while a turn
 * runs). `stop` while a turn runs, `send` otherwise — and `ignore` for `STOP_GUARD_MS` after a
 * stop: the second click of a double-click on Stop lands when main's `aborted` may already have
 * ended the turn, and it must neither stop twice nor send whatever was drafted in the composer
 * while the turn ran. `stoppedAt` is when the button last stopped a turn, on the clock `now` is
 * read from, or `null`.
 */
export const sendClick = (busy: boolean, now: number, stoppedAt: number | null): 'stop' | 'send' | 'ignore' =>
  stoppedAt !== null && now - stoppedAt < STOP_GUARD_MS ? 'ignore' : busy ? 'stop' : 'send'

/**
 * 2026-10-08 — a message as one line of plain text: a reply of Vee's with its blocks and marks
 * flattened (`ai/blocks.ts`, `plainText` — a reply of one plain sentence is itself), a user's as
 * it was typed. What a reply's quote carries to the model and above the question, and what the
 * reply strip shows.
 */
export const plainOf = (m: Pick<ChatMessage, 'role' | 'text'>): string =>
  m.role === 'user' ? m.text : plainText(m.text)

/** `:2037–2039`. Who the composer is replying to, and the line it shows. */
export function replyStrip(
  msgs: readonly Pick<ChatMessage, 'role' | 'text'>[],
  replyTo: number | null
): { replying: boolean; who: string; text: string } {
  const target = replyTo == null ? undefined : msgs[replyTo]
  return {
    replying: replyTo != null,
    who: target ? authorOf(target) : '',
    text: target ? plainOf(target) : ''
  }
}

/** `:2051` — `chatSuggest(s, sel, loaded, files)`, from the store's own shape. */
/** The store fields the suggestions read. */
export type SuggestState = Pick<
  ShellState,
  'sel' | 'byId' | 'chatMsgs' | 'stack' | 'hidden' | 'loaded' | 'library'
>

export function suggestInput(s: SuggestState): SuggestInput {
  const sel = s.sel == null ? null : s.byId.get(s.sel)
  return {
    lastMessage: s.chatMsgs.length ? s.chatMsgs[s.chatMsgs.length - 1] : null,
    messageTexts: s.chatMsgs.map((m) => m.text),
    sel: sel ? { type: sel.type, objectType: sel.objectType, storey: sel.storey } : null,
    stackLive: s.stack.some((x) => x.on),
    hiddenCount: Object.keys(s.hidden).length,
    loaded: s.loaded,
    files: s.library
  }
}

/** `:2051`. Four of them, in the design's own order. */
export const CHAT_EXAMPLE_CAP = 4

export const chatExamples = (s: SuggestState): string[] =>
  chatSuggest(suggestInput(s)).slice(0, CHAT_EXAMPLE_CAP)

/** 2026-09-24 — whether the conversation has a user turn yet; the fold chip exists only then. */
export const chipsStarted = (msgs: readonly Pick<ChatMessage, 'role'>[]): boolean =>
  msgs.some((m) => m.role === 'user')

/**
 * 2026-09-24 — the owner's *"one line + hide after start"*. Before the conversation has a user
 * turn the one-line suggestion row shows; after it, the row folds behind one `suggestions`
 * chip unless that chip has it open. A new or cleared conversation has no user turn, so it
 * starts unfolded again.
 */
export const chipsFolded = (msgs: readonly Pick<ChatMessage, 'role'>[], open: boolean): boolean =>
  !open && chipsStarted(msgs)

/* ────────────────────────────── 2026-11-08 — the messaging layout ────────────────────────────── */

/**
 * The word on a consent card's confirm button: it names what the click does (the owner's
 * decision of 2026-11-08). `Delete` for a deletion, `Clear all` for clearing a list, and `Apply`
 * for a visibility change and every other request — one entry per kind, so a new kind cannot be
 * forgotten here.
 */
export type ConsentVerb = 'Apply' | 'Delete' | 'Clear all'
const VERB_OF: Record<PendingAction['kind'], ConsentVerb> = {
  undo: 'Apply',
  redo: 'Apply',
  restore_view: 'Apply',
  delete_view: 'Delete',
  delete_measure: 'Delete',
  delete_spot: 'Delete',
  clear_measures: 'Clear all',
  clear_spots: 'Clear all',
  delete_filter_set: 'Delete',
  save_filter_set: 'Apply',
  open_recent: 'Apply',
  copy_link: 'Apply',
  copy_guids: 'Apply'
}
export const pendingVerb = (p: Pick<ChatPending, 'action'>): ConsentVerb => (p.action ? VERB_OF[p.action.kind] : 'Apply')

/** What the stamp on a consent card says the user's confirm click did. */
export const SETTLED_BY_VERB: Record<ConsentVerb, 'applied' | 'deleted' | 'cleared'> = {
  Apply: 'applied',
  Delete: 'deleted',
  'Clear all': 'cleared'
}

/** A time of day as the thread prints it: `14:02`, the 24-hour clock in local time. */
export function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The day separator over the messages of one day: `Today`, `Yesterday`, else the date. */
export function dayLabel(ms: number, now: number): string {
  const day = (t: number): number => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const diff = Math.round((day(now) - day(ms)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The not-ready lines (HANDOFF §10.1, §9.8): the key line wins — without a key nothing can answer. */
export const NO_KEY_LINE = 'Add your API key in Preferences to start.'
export const NO_MODEL_LINE = 'Open a model and I’ll take a look.'

/** Which not-ready line the window shows, or `null` when Vee can answer. `hasKey` unknown counts as a key. */
export const notReadyLine = (hasKey: boolean | null | undefined, hasModel: boolean | undefined): string | null =>
  hasKey === false ? NO_KEY_LINE : hasModel === false ? NO_MODEL_LINE : null

/** An ended turn, as the Vee window is told it (`VeeSnapshot.end`). */
export interface TurnEnd {
  kind: 'stopped' | 'failed'
  error: string
  message?: string
  acted: boolean
  retry: boolean
}

/** The errors that mean the turn never reached Vee: the window says `no signal` until one does. */
const NO_SIGNAL = new Set(['connection', 'timeout'])
/** The errors a second try cannot fix: no key, or a key the service refused. */
const NO_RETRY = new Set(['no_key', 'auth'])

/**
 * The header's presence line — derived, never stored (HANDOFF §3): `no key` while there is none;
 * while a turn runs `on it` once a tool has run and `typing` before; `no signal` after a turn
 * that never reached the service, until the next begins; `on site` otherwise.
 */
export function presenceOf(p: {
  hasKey: boolean | null | undefined
  busy: boolean
  toolRan: boolean
  end: TurnEnd | null | undefined
}): { word: string; mode: 'idle' | 'busy' | 'off' } {
  if (p.hasKey === false) return { word: 'no key', mode: 'off' }
  if (p.busy) return { word: p.toolRan ? 'on it' : 'typing', mode: 'busy' }
  if (p.end?.kind === 'failed' && NO_SIGNAL.has(p.end.error)) return { word: 'no signal', mode: 'off' }
  return { word: 'on site', mode: 'idle' }
}

/**
 * The system line under a turn that did not answer — the app talking, not Vee, in neutral ink
 * (amber is kept for the heads-up). It says what happened and **never claims that nothing
 * changed when a tool had already changed something**. `retry`: "Try again" is offered.
 */
export function endLine(end: TurnEnd): { text: string; retry: boolean } {
  const tail = end.acted ? 'what it already did stays' : 'nothing changed'
  if (end.kind === 'stopped') return { text: `Stopped · ${tail}`, retry: false }
  const what = NO_SIGNAL.has(end.error)
    ? 'Couldn’t reach Vee'
    : end.error === 'rate_limit' || end.error === 'overloaded'
      ? 'Vee is busy right now'
      : NO_RETRY.has(end.error)
        ? 'Vee couldn’t sign in'
        : 'Vee couldn’t answer'
  return { text: `${what} · ${tail}`, retry: end.retry && !NO_RETRY.has(end.error) }
}

/** The pinned board's numbers (`VeeBoard`). */
export interface BoardView {
  total: number
  shown: number
  selected: number
  storey: string | null
  colourBy: string | null
  view: string | null
}

/**
 * The pinned board's one line, in pieces: what the 3D view shows (`All 412 shown`, or `12 of 412
 * shown` — **isolated**, drawn in the selection's colours with the eye struck through, exactly
 * when not everything is shown), what is selected and on which storey, what it is coloured by.
 */
export function boardLine(b: BoardView): {
  iso: boolean
  lead: { strong: string; text: string; before: boolean }
  sel: string | null
  rest: string[]
} {
  const iso = b.shown < b.total
  return {
    iso,
    lead: iso
      ? { strong: group(b.shown), text: ` of ${group(b.total)} shown`, before: true }
      : { strong: group(b.total), text: ' shown', before: false },
    sel: b.selected ? `${group(b.selected)} selected` : null,
    rest: [...(b.selected && b.storey ? [b.storey] : []), ...(b.colourBy ? [`coloured by ${b.colourBy}`] : [])]
  }
}

/** The board's line as plain text: `All 412 shown`, `12 of 412 shown · 5 selected · L2`. */
export function boardText(b: BoardView): string {
  const l = boardLine(b)
  const lead = l.lead.before ? `${l.lead.strong}${l.lead.text}` : `All ${l.lead.strong}${l.lead.text}`
  return [lead, ...(l.sel ? [l.sel] : []), ...l.rest].join(' · ')
}
