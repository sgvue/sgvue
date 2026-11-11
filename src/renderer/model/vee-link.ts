/**
 * The main window's end of the Ask Vee window's private port — 2026-11-07.
 *
 * The owner: *"Also bring vee out as a separate window and always on top of our app window.
 * because when the vee panel and properties panel show up together, they blocked my model
 * view."* The chat panel is a child window of its own (`main/vee-window.ts`). **The conversation
 * still runs here**: the store's chat slice, the turn (`ai/bridge.ts`), every tool, the trace's
 * facts, the pending row's request, `revertTurn`, `applyPending`. The Vee window only draws it.
 *
 * This module is the seam, built on the Schedules window's pattern (`schedule-link.ts`): main
 * hands this page one end of a `MessageChannelMain` pair when the Vee window has loaded (the
 * preload re-posts it as `CH_VEE_PORT`), and an empty post means the window closed. While a
 * port is held:
 *
 *   · to the window, `update` — the snapshot of what the panel draws (`shared/vee-messages.ts`,
 *     bounded, no element ids) and the trace's changes (`ai/trace-store.ts`, `onTraceChange`),
 *     batched to one post per task and in the order they happened, so that a reply and its
 *     trace arrive together, as they changed together here. Trace times cross on this page's
 *     clock, with where it starts (`origin`).
 *   · from the window, an **intent** — what the user did, validated (`VeeIntent`) and then done
 *     here through the action the panel's control always called.
 *
 * **Consent stays the user's click.** `apply` names the message *and* the request it showed
 * (`messageId`, `pendingId` — the identities of the main window's own objects, given out as the
 * snapshot is built). It is applied only while that very request is still waiting on that very
 * message; otherwise nothing happens. It is the one call of `applyPending` here, and nothing
 * else in this module reaches a gated action.
 *
 * **A copy is made where the click was.** `execCommand('copy')` copies only under the user's
 * activation, and the click on Apply or `copy csv` was in the Vee window. So the two intents that
 * can copy run inside `copyingIn` (`../clipboard.ts`): the text is sent back to the Vee window,
 * which copies it and says whether it could (`copied`); a refusal is the store's own
 * `CLIPBOARD_REFUSED`, as before.
 *
 * **`chatOpen` is still the panel's state**, and the window follows it: set, the window is
 * opened (or brought forward); cleared, it is closed. A window that closes by itself — its own
 * close button, or the main window's reload — clears it.
 */
import { CH_VEE_PORT } from '../../shared/ipc-channels'
import {
  VeeIntent,
  VEE_COPY_MS,
  VEE_MAX_INPUT,
  VEE_MAX_LABEL,
  VEE_MAX_STEPS,
  VEE_MAX_ASK_LEAD,
  VEE_MAX_OBS_TEXT,
  VEE_MAX_TABLE_ROWS,
  VEE_MAX_TERMS,
  VEE_MAX_TEXT,
  type ToVee,
  type VeeBoard,
  type VeeSnapshot
} from '../../shared/vee-messages'
import { labelText } from '../../shared/fmt'
import { abortChat, sendChat } from '../ai/bridge'
import { quoteOfPart } from '../ai/parts'
import { IFCSG_QUESTION, IFCSG_REPLIES } from '../ai/executors/ask'
import { termsOf, traceTermsOf, vocabularyFor } from '../ai/terms'
import { onTraceChange, traceEpoch, traceFail, traceSnapshot, type TraceChange } from '../ai/trace-store'
import { api } from '../api'
import { copyingIn } from '../clipboard'
import { chatExamples, messageView } from '../state/selectors/chat'
import { useShell, type ChatMessage, type ShellState } from '../state/shell'

let port: MessagePort | null = null
let unsubscribe: (() => void) | null = null

/* ────────────────────────────── identities ────────────────────────────── */

let nextId = 1
const ids = new WeakMap<object, number>()
/** A number for this very object, the same every time it is asked: a message, or its request. */
const idOf = (o: object): number => {
  let id = ids.get(o)
  if (id === undefined) ids.set(o, (id = nextId++))
  return id
}
export const messageId = (m: ChatMessage): number => idOf(m)
export const pendingId = (p: NonNullable<ChatMessage['pending']>): number => idOf(p)

/* ────────────────────────────── the composer ────────────────────────────── */

/** The composer text the Vee window last said it holds. */
let echo = ''
/** Moves whenever the store's `chatInput` changes and the Vee window did not change it. */
let composerRev = 0

/* ────────────────────────────── the snapshot ────────────────────────────── */

/** A label cut to the snapshot's bound, so that no one long string can make a whole snapshot invalid. */
const cut = (text: string): string => text.slice(0, VEE_MAX_LABEL)

/**
 * 2026-11-08, stage 2 — the IFC terms of one message, as the ordinals of its code spans that are
 * names the loaded models carry (`ai/terms.ts`). Worked out once per message object **and
 * federation**, so a model unloaded or replaced since recolours an old reply: a name no longer in
 * the vocabulary falls back to plain mono.
 */
const termCache = new WeakMap<ChatMessage, { fed: object; terms: number[]; trace: string[] }>()
function messageTerms(m: ChatMessage): { terms: number[]; trace: string[] } {
  const fed = useShell.getState().federation
  const hit = termCache.get(m)
  if (hit && hit.fed === fed) return hit
  const live = m.role === 'assistant' && fed.elements.length > 0
  const v = live ? vocabularyFor(fed) : null
  const terms = v ? termsOf(v, m.text, m.role).slice(0, VEE_MAX_TERMS) : []
  // …and the names its trace shows that are terms: its diary's steps and its storey-rows title.
  const trace = v ? traceTermsOf(v, m.trace) : []
  const entry = { fed, terms, trace }
  termCache.set(m, entry)
  return entry
}
const termsFor = (m: ChatMessage): number[] => messageTerms(m).terms

/** File text in a heads-up, cut to the port's bound (it was cut where it was observed). */
const obsCut = (text: string): string => text.slice(0, VEE_MAX_OBS_TEXT)

/** A heads-up as the port carries it (`VeeHeadsUp`). */
function headsUpSent(h: NonNullable<ChatMessage['headsUp']>): NonNullable<VeeSnapshot['msgs'][number]['headsUp']> {
  const noun = h.noun.slice(0, 80)
  switch (h.kind) {
    case 'placeholder':
      return { kind: h.kind, prop: obsCut(h.prop), value: obsCut(h.value), n: h.n, noun, counted: h.counted, op: h.op }
    case 'noStorey':
      return { kind: h.kind, n: h.n, noun }
    case 'dupGlobalId':
      return { kind: h.kind, n: h.n, groups: h.groups, noun }
    case 'objectTypeOnly':
      return { kind: h.kind, n: h.n, noun, example: obsCut(h.example) }
  }
}

/** A message as the snapshot carries it: no ids behind a chip or a row, and no request. */
function sent(m: ChatMessage, open = false): VeeSnapshot['msgs'][number] {
  const v = messageView(m, messageId(m), m.pending ? pendingId(m.pending) : 0)
  const terms = termsFor(m)
  return {
    id: v.id,
    role: v.role,
    text: v.text.slice(0, VEE_MAX_TEXT),
    quote: v.quote && { who: cut(v.quote.who), text: cut(v.quote.text) },
    chips: v.chips.slice(0, 6).map((c) => ({ label: cut(c.label) })),
    table: v.table && {
      groupBy: cut(v.table.groupBy),
      ...(v.table.clash !== undefined ? { clash: v.table.clash } : {}),
      ...(v.table.units ? { units: { ...v.table.units } } : {}),
      rows: v.table.rows.slice(0, VEE_MAX_TABLE_ROWS).map((r) => ({
        k: cut(r.k),
        n: r.n,
        ...(r.area !== undefined ? { area: r.area } : {}),
        ...(r.volume !== undefined ? { volume: r.volume } : {}),
        ...(r.vol !== undefined ? { vol: r.vol } : {})
      }))
    },
    pending: v.pending && { id: v.pending.id, label: cut(v.pending.label), verb: v.pending.verb },
    canRevert: v.canRevert,
    reverted: v.reverted,
    ...(v.at !== undefined ? { at: Math.max(0, Math.round(v.at)) } : {}),
    ...(v.seen !== undefined ? { seen: v.seen } : {}),
    ...(v.settled
      ? { settled: { how: v.settled.how, at: Math.max(0, Math.round(v.settled.at)), label: cut(v.settled.label) } }
      : {}),
    ...(v.revertedAt !== undefined ? { revertedAt: Math.max(0, Math.round(v.revertedAt)) } : {}),
    trace: v.trace && {
      status: cut(v.trace.status),
      wide: v.trace.wide,
      noun: cut(v.trace.noun),
      rows: v.trace.rows.slice(0, 8).map((r) => ({ label: cut(r.label), n: r.n })),
      ...(v.trace.fold !== undefined ? { fold: cut(v.trace.fold) } : {}),
      ...(v.trace.steps
        ? {
            steps: v.trace.steps
              .slice(-VEE_MAX_STEPS)
              .map((st) => ({ label: cut(st.label), mono: cut(st.mono), n: st.n, unit: cut(st.unit) }))
          }
        : {}),
      ...(v.trace.title !== undefined ? { title: cut(v.trace.title) } : {}),
      // 2026-11-08 — the names above that are IFC terms of the loaded models, recomputed per federation.
      ...(messageTerms(m).trace.length ? { terms: messageTerms(m).trace.map(cut) } : {})
    },
    // Stage 2: the coloured terms, the heads-up and the IFC+SG question.
    ...(terms.length ? { terms } : {}),
    ...(m.role === 'assistant' && m.headsUp ? { headsUp: headsUpSent(m.headsUp) } : {}),
    ...(m.role === 'assistant' && m.ask
      ? {
          ask: {
            lead: m.ask.lead.slice(0, VEE_MAX_ASK_LEAD),
            question: IFCSG_QUESTION,
            replies: IFCSG_REPLIES.map((r) => ({ ...r })),
            chosen: m.ask.chosen ?? null,
            open
          }
        }
      : {})
  }
}

/**
 * Whether reply `index` still asks its IFC+SG question: it is the transcript's newest message,
 * nobody has answered, no turn runs and the conversation has no answer yet. The snapshot's
 * `ask.open` and the `choose` intent read this one rule.
 */
export const askOpen = (s: ShellState, index: number): boolean => {
  const m = s.chatMsgs[index]
  return !!m?.ask && !m.ask.chosen && index === s.chatMsgs.length - 1 && !s.chatBusy && s.chatIfcsg === 'unknown'
}

/**
 * Whether "Try again" may run: the last turn failed (not stopped), its question is the
 * transcript's last message, and a model is open. The snapshot's `end.retry` and the `retry`
 * intent read this one rule, so a window can offer the button only where main will act on it.
 */
export const canRetry = (s: ShellState): boolean =>
  s.chatEnd?.kind === 'failed' && s.chatMsgs[s.chatMsgs.length - 1]?.role === 'user' && s.federation.elements.length > 0

/** What the panel draws, as it stands. Exported for the unit tests. */
export function snapshotOf(s: ShellState): VeeSnapshot {
  return {
    theme: s.theme,
    units: s.units,
    busy: s.chatBusy,
    err: cut(s.chatErr),
    replyTo: s.chatReplyTo,
    replyPart: s.chatReplyTo == null ? null : s.chatReplyPart,
    ...(s.hasKey !== null ? { hasKey: s.hasKey } : {}),
    hasModel: s.federation.elements.length > 0,
    end: s.chatEnd && {
      kind: s.chatEnd.kind,
      error: cut(s.chatEnd.error),
      message: cut(s.chatEnd.message),
      acted: s.chatEnd.acted,
      // `Try again` only where a retry can run: a failed turn whose question is the last
      // message, with a model open (`receive`'s `retry` holds the same rule).
      retry: canRetry(s)
    },
    suggestOpen: s.chatSuggestOpen,
    suggestions: chatExamples(s).slice(0, 4).map((t) => t.slice(0, 500)),
    composer: { text: s.chatInput.slice(0, VEE_MAX_INPUT), rev: composerRev },
    msgs: s.chatMsgs.map((m, i) => sent(m, askOpen(s, i)))
  }
}

/** The store fields the snapshot is built from: a change to any of them sends a new one. */
const SNAP_KEYS: readonly (keyof ShellState)[] = [
  'theme', 'units', 'chatBusy', 'chatErr', 'chatReplyTo', 'chatSuggestOpen', 'chatInput', 'chatMsgs',
  // 2026-11-08 — the messaging layout: the bubble replied to, whether Vee can answer, how a turn ended.
  'chatReplyPart', 'hasKey', 'chatEnd', 'federation',
  // 2026-11-08, stage 2 — what decides whether a question still asks.
  'chatIfcsg',
  // …and what the suggestions read (`chatExamples`).
  'sel', 'byId', 'stack', 'hidden', 'loaded', 'library'
]

/* ────────────────────────────── the outbox ────────────────────────────── */

let snapDirty = false
let traceOut: TraceChange[] = []
let queued = false

/** A trace change, made ready to cross: with no element ids. */
function crossing(c: TraceChange): TraceChange {
  const strip = <T extends { rules: { rows: { ids: number[] }[] } | null }>(facts: T): T =>
    facts.rules ? { ...facts, rules: { ...facts.rules, rows: facts.rules.rows.map((r) => ({ ...r, ids: [] })) } } : facts
  if (c.kind === 'event' && c.ev.type === 'tool_exec') return { ...c, ev: { ...c.ev, facts: strip(c.ev.facts) } }
  if (c.kind === 'sync' && c.timeline) {
    return { ...c, timeline: { ...c.timeline, calls: c.timeline.calls.map((k) => ({ ...k, facts: strip(k.facts) })) } }
  }
  return c
}

function flush(): void {
  queued = false
  if (!port || (!snapDirty && !traceOut.length)) return
  // `ToVee`'s `update`; the Vee window validates it, as it validates everything it is sent.
  const message = {
    type: 'update' as const,
    // Where this page's trace clock starts on the wall clock: the Vee window's starts elsewhere.
    origin: traceEpoch(),
    ...(snapDirty ? { snap: snapshotOf(useShell.getState()) } : {}),
    trace: traceOut
  }
  snapDirty = false
  traceOut = []
  port.postMessage(message)
}

/** Post at the end of this task — whatever else changes in it goes in the same post. */
function queue(): void {
  if (queued) return
  queued = true
  queueMicrotask(flush)
}

/* ────────────────────────────── the board ────────────────────────────── */

/** The lit view button's label, as the toolbar prints it (`app/Toolbar.tsx`). */
const VIEW_LABEL: Readonly<Record<string, string>> = { iso: '3D', top: 'Plan', north: 'N', south: 'S', east: 'E', west: 'W' }

/**
 * 2026-11-08 — the pinned board: what the 3D view shows, as counts and names — never an id.
 * `null` with no model open. The storey is named only when every selected element is on it.
 * Names are file text, so they go through `labelText`. Exported for the unit tests.
 */
export function boardOf(s: ShellState): VeeBoard | null {
  const total = s.federation.elements.length
  if (!total) return null
  let storey: string | null = null
  for (let k = 0; k < s.selIds.length; k++) {
    const at = s.byId.get(s.selIds[k])?.storey ?? ''
    if (!at || (k > 0 && at !== storey)) {
      storey = null
      break
    }
    storey = at
  }
  return {
    total,
    shown: Math.min(total, s.visibleCount),
    selected: s.selIds.length,
    storey: storey && labelText(storey, 80),
    colourBy: s.colorBy ? labelText(s.colorBy.prop, 80) : null,
    view: (s.view && VIEW_LABEL[s.view]) ?? null
  }
}

/** What the board reads: a change to any of them — the user's or Vee's — sends it again. */
const BOARD_KEYS: readonly (keyof ShellState)[] = ['federation', 'visibleCount', 'selIds', 'byId', 'colorBy', 'view']

let boardFrame = 0
let boardTimer: ReturnType<typeof setTimeout> | null = null
/** The board as last sent, so an unchanged one is not sent again. */
let boardSent = ''

/**
 * Send the board, at most once a frame: on the next animation frame, or after 100 ms for a
 * window the OS has hidden, whichever comes first — the Schedules window's rule
 * (`schedule-link.ts`).
 */
function flushBoard(): void {
  if (boardFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(boardFrame)
  if (boardTimer) clearTimeout(boardTimer)
  boardFrame = 0
  boardTimer = null
  if (!port) return
  const board = boardOf(useShell.getState())
  const key = JSON.stringify(board)
  if (key === boardSent) return
  boardSent = key
  port.postMessage({ type: 'update', origin: traceEpoch(), board, trace: [] } satisfies ToVee)
}

function queueBoard(): void {
  if (boardFrame || boardTimer) return
  if (typeof requestAnimationFrame === 'function') boardFrame = requestAnimationFrame(flushBoard)
  boardTimer = setTimeout(flushBoard, 100)
}

/* ────────────────────────────── copying in the Vee window ────────────────────────────── */

let copyN = 0
const copies = new Map<number, (ok: boolean) => void>()

/** Copy `text` in the Vee window, where the click was; resolves whether it reached the clipboard. */
function copyInVee(text: string): Promise<boolean> {
  if (!port) return Promise.resolve(false)
  const n = ++copyN
  const sentTo = port
  return new Promise((resolve) => {
    const done = (ok: boolean): void => {
      clearTimeout(giveUp)
      copies.delete(n)
      resolve(ok)
    }
    const giveUp = setTimeout(() => done(false), VEE_COPY_MS)
    copies.set(n, done)
    sentTo.postMessage({ type: 'copy', n, text } satisfies ToVee)
  })
}

/* ────────────────────────────── the user's intents ────────────────────────────── */

/** The message the intent names — only while it is still that very message. */
function named(s: ShellState, index: number, msg: number): ChatMessage | null {
  const m = s.chatMsgs[index]
  return m && messageId(m) === msg ? m : null
}

/**
 * One intent from the Vee window. Anything that fails its schema is ignored, and so is an act on
 * a message — or a request — the transcript no longer holds. Exported for the unit tests.
 */
export function receive(data: unknown): void {
  const parsed = VeeIntent.safeParse(data)
  if (!parsed.success) return
  const i = parsed.data
  const s = useShell.getState()
  switch (i.type) {
    case 'send':
      echo = i.text
      s.setChatInput(i.text)
      void sendChat(i.text)
      return
    case 'stop':
      abortChat()
      return
    case 'input':
      echo = i.text
      s.setChatInput(i.text)
      return
    case 'apply': {
      // The user's click on Apply, for the request they saw — and nothing else.
      const m = named(s, i.index, i.msg)
      if (!m?.pending || pendingId(m.pending) !== i.pending) return
      copyingIn(copyInVee, () => s.applyPending(i.index))
      return
    }
    case 'cancel': {
      const m = named(s, i.index, i.msg)
      if (!m?.pending || pendingId(m.pending) !== i.pending) return
      s.dismissPending(i.index)
      return
    }
    case 'revert':
      if (named(s, i.index, i.msg)) s.revertTurn(i.index)
      return
    case 'reply': {
      // A reply on one bubble names it; one that cannot be quoted — a chip row, a request — is
      // ignored. The quote itself is worked out when the turn is sent (`ai/bridge.ts`).
      const m = named(s, i.index, i.msg)
      if (!m || (i.part !== undefined && quoteOfPart(m, i.part) === null)) return
      s.setChatReplyTo(i.index, i.part ?? null)
      return
    }
    case 'retry':
      // Only for a turn that failed — the rule that shows the button (review of stage 1).
      if (canRetry(s)) void sendChat(undefined, { retry: true })
      return
    case 'unreply':
      s.setChatReplyTo(null)
      return
    case 'suggest':
      echo = i.text
      s.setChatInput(i.text)
      s.setChatSuggestOpen(false)
      return
    case 'suggestOpen':
      s.setChatSuggestOpen(i.open)
      return
    case 'pick': {
      const m = named(s, i.index, i.msg)
      if (!m) return
      const ids =
        i.what === 'chip' ? m.chips?.[i.j]?.ids : i.what === 'table' ? m.table?.rows[i.j]?.ids : m.trace?.rows[i.j]?.ids
      // What is still loaded, on the slot its model has now; what is not is said (stage 1b).
      if (ids) s.pickChat(i.index, ids, i.zoom)
      return
    }
    case 'copyCsv': {
      const table = named(s, i.index, i.msg)?.table
      if (table) copyingIn(copyInVee, () => void s.copyTable(table))
      return
    }
    case 'choose': {
      // The user's own answer, for the question that message showed — and only while it still
      // asks. The answer is set first, so the turn it sends already carries it.
      if (!named(s, i.index, i.msg) || !askOpen(s, i.index)) return
      if (!s.chooseReply(i.value)) return
      const reply = IFCSG_REPLIES.find((r) => r.value === i.value)
      if (reply) void sendChat(reply.label)
      return
    }
    case 'copied':
      copies.get(i.n)?.(i.ok)
      return
    case 'close':
      s.setChatOpen(false)
      return
    case 'newChat':
      // A turn runs to its end, or the user stops it: a new conversation never cuts one off.
      if (s.chatBusy) return
      // The finished turn's trace goes with its reply, as the dev harness's reset does.
      traceFail()
      s.seedChat()
      return
  }
}

/* ────────────────────────────── the port ────────────────────────────── */

/** Take a port (or `null`: the window closed). Exported for the unit tests. */
export function connect(next: MessagePort | null): void {
  unsubscribe?.()
  unsubscribe = null
  for (const done of [...copies.values()]) done(false)
  port?.close()
  port = next
  snapDirty = false
  traceOut = []
  // A window opens with no board: an empty one is not sent.
  boardSent = 'null'
  if (!port) {
    // The window has gone — by its own close button, or with a reload — so the panel is closed.
    if (useShell.getState().chatOpen) useShell.getState().setChatOpen(false)
    return
  }

  port.onmessage = (event: MessageEvent): void => receive(event.data)
  echo = useShell.getState().chatInput
  const offTrace = onTraceChange((change) => {
    traceOut.push(crossing(change))
    queue()
  })
  const offStore = useShell.subscribe((s, prev) => {
    // The Vee window's own keystroke, coming back: it already shows this text.
    const echoed = s.chatInput !== prev.chatInput && s.chatInput === echo
    if (s.chatInput !== prev.chatInput && !echoed) {
      composerRev++
      echo = s.chatInput
      // "Ask about this" while the window is open: bring it forward, the composer focused.
      if (s.chatInput && s.chatOpen) {
        void api()?.openVee(s.theme)
        port?.postMessage({ type: 'focus' } satisfies ToVee)
      }
    }
    if (BOARD_KEYS.some((k) => s[k] !== prev[k])) queueBoard()
    const changed = SNAP_KEYS.filter((k) => s[k] !== prev[k])
    // Nothing to send when the one change is that echo: no snapshot per keystroke.
    if (changed.length && !(echoed && changed.length === 1)) {
      snapDirty = true
      queue()
    }
  })
  unsubscribe = () => {
    offTrace()
    offStore()
  }
  // A window that is there is an open panel.
  if (!useShell.getState().chatOpen) useShell.getState().setChatOpen(true)
  snapDirty = true
  traceOut = [crossing(traceSnapshot())]
  flush()
  flushBoard()
  // Whether a key is stored: the not-ready line and the composer read it (Preferences tells the
  // store again whenever it changes).
  const bridge = api()
  if (bridge?.getSettings) {
    void bridge
      .getSettings()
      .then((v) => useShell.getState().setHasKey(v.hasKey || v.envKey))
      .catch(() => undefined)
  }
}

/** Listen for the port, and open and close the window as the panel opens and closes. Called once. */
export function installVeeLink(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    // Only the preload's own re-post: same window, the channel's name as the data.
    if (event.source !== window || event.data !== CH_VEE_PORT) return
    connect(event.ports[0] ?? null)
  })
  useShell.subscribe((s, prev) => {
    if (s.chatOpen === prev.chatOpen) return
    if (s.chatOpen) void api()?.openVee(s.theme)
    else void api()?.closeVee()
  })
}
