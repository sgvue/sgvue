/**
 * The chat panel's pure pieces — `SGVue.dc.html:2015–2051` (the per-message view model, the
 * reply strip, the suggestion list) and `:1127–1136` (the resize clamp).
 *
 * The same split every other selector in this folder uses: the **decision** is a function of
 * data, so a bubble's corner radius, a quantity column, the CSV a table copies and the size a
 * drag settles on can all be tested without a DOM, a viewer or a model call.
 *
 * 2026-10-01: the assistant has a name of its own, **Vee** (`ASSISTANT`, `authorOf` — the
 * design's three `'SGVue'` literals in one place), its label carries the mascot (`hasSprite`),
 * and the resize clamp takes the bottom row's lane.
 *
 * The same day, the owner's "Ask Vee" handoff in full: **a user's row stands on the left**, as
 * the assistant's does, with the assistant's corner — the handoff's, and what makes the typed
 * line's lift from the composer a straight line (the design: on the right, `:2015`); a reply
 * that came from a turn carries what its thinking trace left (`ChatMessage.trace`: the status
 * beside the name, whether its bubble is the trace's full-width one, its rows); and the mascot
 * in front of the newest such reply is `done` (`veeStateOf`).
 */
import type { ChatTable } from '../../ai/executors/context'
import { volumeIn, volumeUnit, type DisplayUnit } from '../../../shared/units'
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

/** One message, as `:2015` derives it. Every value is what the markup interpolates. */
export interface ChatRow {
  key: number
  who: string
  /** 2026-10-01 — the mascot stands in front of the assistant's label, never the user's. */
  hasSprite: boolean
  fg: string
  bg: string
  align: string
  just: string
  radius: string
  maxW: string
  opacity: string
  hasQuote: boolean
  quoteWho: string
  quoteText: string
  hasChips: boolean
  hasTable: boolean
  tableTitle: string
  tableClash: boolean
  tableRows: { k: string; n: string; q: string; ids: readonly number[] }[]
  hasPending: boolean
  pendingLabel: string
  canRevert: boolean
  /**
   * 2026-10-01 — the reply came from a turn, so it carries its trace: its bubble is the trace's
   * (its words revealed one by one, its rows under them) rather than the plain one.
   */
  traced: boolean
  /** …the status beside the name: `checked 86 walls · 7s`, `3s`. `''` for none. */
  status: string
  /** …and the turn opened the trace bubble, so the reply keeps its full width. */
  wide: boolean
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
 */
export function tableCsv(table: ChatTable, unit: DisplayUnit = 'mm'): string {
  return [
    `${table.groupBy},count,quantity`,
    ...table.rows.map(
      (r) =>
        `"${r.k}",${r.n},${r.area ? r.area.toFixed(2) : r.vol != null ? volumeIn(r.vol, unit).toFixed(4) : ''}`
    )
  ].join('\n')
}

/** The corner every bubble has since 2026-10-01: both sides stand on the left. `:2015`'s assistant value. */
export const BUBBLE_RADIUS = '11px 11px 11px 3px'

/**
 * `:2015`. `mine` decides the colour and how wide the bubble may grow. Until 2026-10-01 it also
 * decided the side (`flex-end`) and the corner the notch is on (`11px 11px 3px 11px`); the
 * owner's handoff puts `You` on the left with the assistant's corner.
 */
export function chatRow(m: ChatMessage, i: number, unit: DisplayUnit = 'mm'): ChatRow {
  const mine = m.role === 'user'
  const table = m.table ?? null
  const trace = mine ? null : (m.trace ?? null)
  return {
    key: i,
    who: authorOf(m),
    hasSprite: !mine,
    fg: 'var(--ink)',
    bg: mine ? 'var(--sel-bg)' : 'var(--step-bg)',
    align: 'flex-start',
    just: 'flex-start',
    radius: BUBBLE_RADIUS,
    maxW: mine ? '86%' : '100%',
    opacity: m.reverted ? '0.5' : '1',
    hasQuote: !!m.quote,
    quoteWho: m.quote ? m.quote.who : '',
    quoteText: m.quote ? m.quote.text : '',
    hasChips: !!(m.chips ?? []).length,
    hasTable: !!table,
    tableTitle: table ? table.groupBy : '',
    tableClash: !!(table && table.clash),
    tableRows: table
      ? table.rows.map((r) => ({
          k: r.k,
          n: String(r.n),
          q: tableQuantity(table, r, unit),
          ids: r.ids
        }))
      : [],
    hasPending: !!m.pending,
    pendingLabel: m.pending ? m.pending.label : '',
    // 2026-10-02: a reply that placed a markup changed something a revert can put back — by
    // taking it away — even when it changed nothing else (`ChatMessage.placed`).
    canRevert: (!!m.undoSnap || !!m.placed?.length) && !m.reverted,
    traced: !!trace,
    status: trace ? trace.status : '',
    wide: !!trace && trace.wide
  }
}

/**
 * The mascot in front of a reply that is not being written: **`done` while the reply is a
 * turn's and the newest message in the transcript**, `idle` otherwise — every older reply, and
 * the boot audit, which no turn produced. (The reply being written takes its state from the
 * trace; the header's sprite and the pill's are always `idle`.)
 */
export const veeStateOf = (msgs: readonly ChatMessage[], i: number): VeeState =>
  i === msgs.length - 1 && msgs[i]?.role === 'assistant' && !!msgs[i].trace ? 'done' : 'idle'

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
  msgs: readonly ChatMessage[],
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
export const chipsStarted = (msgs: readonly ChatMessage[]): boolean =>
  msgs.some((m) => m.role === 'user')

/**
 * 2026-09-24 — the owner's *"one line + hide after start"*. Before the conversation has a user
 * turn the one-line suggestion row shows; after it, the row folds behind one `suggestions`
 * chip unless that chip has it open. A new or cleared conversation has no user turn, so it
 * starts unfolded again.
 */
export const chipsFolded = (msgs: readonly ChatMessage[], open: boolean): boolean =>
  !open && chipsStarted(msgs)

/** `:1133–1134`. The panel never goes under this, in either direction. */
export const CHAT_MIN = 240

/**
 * `:1127`. Dragging the top-left corner grows the panel leftward and upward, clamped to the
 * stage: never under 240 px, never wider than the stage minus its own right offset and 12 px,
 * never taller than the stage minus `cardTop` and 64 px. The `Math.max(240, …)` inside the
 * upper bound is the design's own — on a stage too small for 240 px it wins, and the panel
 * keeps its minimum rather than inverting.
 *
 * `brow` (2026-10-01) is the bottom row's lane, `--brow` on the stage (`selectors/lanes.ts`):
 * the panel's foot stands that much higher, so its height may be that much less. With `0`,
 * which is whenever the row is one line, the bound is the design's.
 */
export function clampChatSize(
  start: { w: number; h: number; x: number; y: number },
  at: { x: number; y: number },
  stage: { width: number; height: number },
  lane: number,
  cardTop: number,
  brow = 0
): { chatW: number; chatH: number } {
  return {
    chatW: Math.max(
      CHAT_MIN,
      Math.min(Math.max(CHAT_MIN, stage.width - lane - 12), start.w + (start.x - at.x))
    ),
    chatH: Math.max(
      CHAT_MIN,
      Math.min(Math.max(CHAT_MIN, stage.height - cardTop - 64 - brow), start.h + (start.y - at.y))
    )
  }
}
