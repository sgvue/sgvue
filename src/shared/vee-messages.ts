/**
 * What crosses the Ask Vee window's private `MessagePort` — 2026-11-07.
 *
 * The owner: *"Also bring vee out as a separate window and always on top of our app window.
 * because when the vee panel and properties panel show up together, they blocked my model
 * view."* The chat panel moved into a window of its own (`main/vee-window.ts`), a child of the
 * main window. **Everything that runs the conversation stays in the main window** — the chat
 * slice of the store, the turn (`ai/bridge.ts`), every tool, the trace's facts, the pending row's
 * request, `revertTurn`, `applyPending` / `performGated`. The Vee window is a view: it draws what
 * it is sent and sends back what the user did.
 *
 * As for the Schedules window (`schedule/messages.ts`), main creates the port pair, hands one
 * end to each page and never reads a message; each receiving page validates what arrives with
 * these schemas and ignores anything that fails. zod runs in both renderers, never in a preload.
 *
 *   main window → Vee   `update`  one batch, at most one per task: the snapshot of what the panel
 *                                 draws (when it changed) and the trace's changes, in order —
 *                                 so the panel and its trace move together, as they did in one
 *                                 window. Trace times are on the main window's clock, with where
 *                                 that clock starts (`origin`), because each page's
 *                                 `performance.now()` starts at its own load.
 *                       `copy`    copy this text, here — the click that asked for it was here,
 *                                 and the clipboard writes only under that click's activation
 *                                 (`renderer/clipboard.ts`); answered by `copied`
 *                       `focus`   bring the composer the keyboard (the context menu's "Ask
 *                                 about this" while the window is already open)
 *   Vee → main window   an intent: exactly one thing the user did, each a closed `.strict()`
 *                       shape. A row the user acted on is named by its place **and** the
 *                       identity the snapshot gave it, so an act on a row the transcript has
 *                       since replaced does nothing (`model/vee-link.ts`).
 *
 * **Bounded.** Every list and string has a cap — generous, so a real conversation never meets
 * one, and tight enough that a page cannot hand the other one an unbounded payload. Element
 * ids never cross in the snapshot: a chip, a table row or an answer row is named by its place,
 * and the main window looks its ids up in its own message.
 */
import { z } from 'zod'
import { DISPLAY_UNITS } from './units'

/* ────────────────────────────── bounds ────────────────────────────── */

/** Messages in one transcript. */
export const VEE_MAX_MSGS = 2000
/** A message's text: a whole reply at the turn's 64 000-token cap fits several times over. */
export const VEE_MAX_TEXT = 1_000_000
/** What the composer holds, and what one send carries. */
export const VEE_MAX_INPUT = 20_000
/** A label: a pending row's, a chip's, a status line's. */
export const VEE_MAX_LABEL = 4000
/** Rows of one chat table. */
export const VEE_MAX_TABLE_ROWS = 2000
/** Positions (an index into the federation's elements) in one list of the trace's facts. */
export const VEE_MAX_POSITIONS = 5_000_000
/** Tool calls in one turn's trace. */
export const VEE_MAX_CALLS = 500
/** Characters a `copy` may carry: a share link, a list of GlobalIds, a table's CSV. */
export const VEE_MAX_COPY = 8_000_000
/** How long the main window waits for a `copied` before it counts the copy as refused. */
export const VEE_COPY_MS = 3000

const label = z.string().max(VEE_MAX_LABEL)
const int = z.number().int()
const count = z.number().int().nonnegative()
const finite = z.number().finite()

/* ────────────────────────────── the snapshot ────────────────────────────── */

/** One row of a reply's table, without its ids. */
const TableRow = z
  .object({
    k: label,
    n: count,
    area: finite.optional(),
    volume: finite.optional(),
    vol: finite.optional()
  })
  .strict()

/** One message, as the panel draws it — `selectors/chat.ts`, `ChatMessageView`. */
export const VeeMessage = z
  .object({
    /** The identity of the main window's message object: an act names it. */
    id: count,
    role: z.enum(['user', 'assistant']),
    text: z.string().max(VEE_MAX_TEXT),
    quote: z.object({ who: label, text: label }).strict().nullable(),
    chips: z.array(z.object({ label }).strict()).max(6),
    table: z
      .object({
        groupBy: label,
        clash: z.boolean().optional(),
        units: z.object({ area: label.optional(), volume: label.optional() }).strict().optional(),
        rows: z.array(TableRow).max(VEE_MAX_TABLE_ROWS)
      })
      .strict()
      .nullable(),
    /** The pending row, and the identity of the request it holds: Apply names it. */
    pending: z.object({ id: count, label }).strict().nullable(),
    canRevert: z.boolean(),
    reverted: z.boolean(),
    trace: z
      .object({
        status: label,
        wide: z.boolean(),
        noun: label,
        rows: z.array(z.object({ label, n: count }).strict()).max(8)
      })
      .strict()
      .nullable()
  })
  .strict()
export type VeeMessage = z.infer<typeof VeeMessage>

export const VeeSnapshot = z
  .object({
    theme: z.enum(['dark', 'light']),
    units: z.enum(DISPLAY_UNITS),
    busy: z.boolean(),
    err: label,
    replyTo: count.nullable(),
    suggestOpen: z.boolean(),
    /** `chatExamples` — worked out where the federation is. */
    suggestions: z.array(z.string().max(500)).max(4),
    /**
     * The composer as the main window last set it, and a counter that moves only when the main
     * window changed it itself (a sent turn clears it; "Ask about this" fills it). The Vee
     * window takes the text when the counter moves, and otherwise keeps what is being typed.
     */
    composer: z.object({ text: z.string().max(VEE_MAX_INPUT), rev: count }).strict(),
    msgs: z.array(VeeMessage).max(VEE_MAX_MSGS)
  })
  .strict()
export type VeeSnapshot = z.infer<typeof VeeSnapshot>

/* ────────────────────────────── the trace ────────────────────────────── */

const positions = z.array(count).max(VEE_MAX_POSITIONS)

const ReadFacts = z.object({ models: z.array(count).max(10_000), total: count }).strict()

const RuleFacts = ReadFacts.extend({
  filter: z.object({ what: label, count, noun: label }).strict().nullable(),
  check: z.object({ props: label, count, unit: z.enum(['missing', 'found']) }).strict().nullable(),
  scope: positions.nullable(),
  matched: positions,
  scopeCount: count,
  noun: label,
  // Ids are not sent: a row under an answer is clicked on the committed message, by its place.
  rows: z.array(z.object({ label, n: count, ids: z.array(int).max(0), at: positions }).strict()).max(100_000)
}).strict()

const ToolFacts = z.object({ name: label, note: label, rules: RuleFacts.nullable() }).strict()

/** `ai/trace.ts`'s `TraceEvent`, its times on the main window's trace clock. */
export const VeeTraceEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('begin'), at: finite, read: ReadFacts }).strict(),
  z.object({ type: z.literal('tool_start'), at: finite }).strict(),
  z.object({ type: z.literal('tool_exec'), at: finite, facts: ToolFacts }).strict(),
  z.object({ type: z.literal('done'), at: finite, words: count, table: z.boolean() }).strict(),
  z.object({ type: z.literal('fail') }).strict()
])

/** `ai/trace.ts`'s `Timeline`, its times on the main window's trace clock. */
export const VeeTimeline = z
  .object({
    send: finite,
    read: ReadFacts,
    tool: finite.nullable(),
    calls: z.array(z.object({ at: finite, facts: ToolFacts }).strict()).max(VEE_MAX_CALLS),
    answer: finite.nullable(),
    words: count,
    table: z.boolean()
  })
  .strict()

/** One change of the main window's trace store (`ai/trace-store.ts`, `TraceChange`). */
export const VeeTraceChange = z.discriminatedUnion('kind', [
  /** The whole state — sent once, when the window joins. */
  z
    .object({
      kind: z.literal('sync'),
      timeline: VeeTimeline.nullable(),
      index: int.min(-1),
      pinned: finite.nullable()
    })
    .strict(),
  z.object({ kind: z.literal('event'), ev: VeeTraceEvent, index: int.min(-1).optional() }).strict(),
  z.object({ kind: z.literal('pin'), T: finite.nullable() }).strict()
])
export type VeeTraceChange = z.infer<typeof VeeTraceChange>

/* ────────────────────────────── main window → Vee ────────────────────────────── */

export const ToVee = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('update'),
      /**
       * The main window's trace clock's start on the wall clock, in seconds (`traceEpoch`): the
       * trace's times are on that clock, and the Vee window moves them onto its own by the
       * difference — a few seconds, so no time loses its precision on the way.
       */
      origin: finite,
      snap: VeeSnapshot.optional(),
      trace: z.array(VeeTraceChange).max(64)
    })
    .strict(),
  z.object({ type: z.literal('copy'), n: count, text: z.string().max(VEE_MAX_COPY) }).strict(),
  z.object({ type: z.literal('focus') }).strict()
])
export type ToVee = z.infer<typeof ToVee>

/* ────────────────────────────── Vee → main window: the user's intents ────────────────────────────── */

/** A message the user acted on: its place in the transcript and the identity the snapshot gave it. */
const at = { index: count, msg: count }

export const VeeIntent = z.discriminatedUnion('type', [
  /** Enter, or the send button: ask this. */
  z.object({ type: z.literal('send'), text: z.string().max(VEE_MAX_INPUT) }).strict(),
  /** The send button while a turn runs. */
  z.object({ type: z.literal('stop') }).strict(),
  /** What the composer holds now — the main window keeps its `chatInput` in step. */
  z.object({ type: z.literal('input'), text: z.string().max(VEE_MAX_INPUT) }).strict(),
  /** The pending row's `apply` — for the request the user saw (`pending`, its identity). */
  z.object({ type: z.literal('apply'), ...at, pending: count }).strict(),
  /** The pending row's `cancel`. */
  z.object({ type: z.literal('cancel'), ...at, pending: count }).strict(),
  /** A reply's `revert`. */
  z.object({ type: z.literal('revert'), ...at }).strict(),
  /** A message's `reply`. */
  z.object({ type: z.literal('reply'), ...at }).strict(),
  /** The reply strip's ×. */
  z.object({ type: z.literal('unreply') }).strict(),
  /** A suggestion picked: it fills the composer and folds the row. */
  z.object({ type: z.literal('suggest'), text: z.string().max(500) }).strict(),
  /** The `suggestions` chip: open or fold the row. */
  z.object({ type: z.literal('suggestOpen'), open: z.boolean() }).strict(),
  /** A chip, a table row or a row under an answer, by its place in that message: select its elements. */
  z
    .object({
      type: z.literal('pick'),
      ...at,
      what: z.enum(['chip', 'table', 'row']),
      j: count,
      zoom: z.boolean()
    })
    .strict(),
  /** A table's `copy csv`. */
  z.object({ type: z.literal('copyCsv'), ...at }).strict(),
  /** The answer to a `copy`: whether the text reached the clipboard. */
  z.object({ type: z.literal('copied'), n: count, ok: z.boolean() }).strict(),
  /** The panel's ×, or Esc. */
  z.object({ type: z.literal('close') }).strict()
])
export type VeeIntent = z.infer<typeof VeeIntent>
