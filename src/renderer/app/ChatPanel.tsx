/**
 * The assistant panel and its pill — `SGVue.dc.html:430–540`, translated element by element,
 * and since 2026-10-01 the owner's "Ask Vee" handoff (`design-reference/ask-vee/`) on top of it.
 *
 * Everything the panel *decides* is already written: the turn itself is `ai/bridge.ts`
 * (`sendChat`, `abortChat`, and the events of a turn), the transcript and its ↺ / apply /
 * cancel are store actions (`state/shell.ts`: `chatBegin` … `revertTurn`, ported from
 * `:1591–1649`), the suggestions and the boot audit are local arithmetic (`ai/analysis.ts`),
 * the per-message view model, the CSV and the resize clamp are pure selectors
 * (`state/selectors/chat.ts`), and what the assistant's live reply shows at any instant is a
 * pure function of time (`ai/trace.ts`). What is here is the markup, the two pointer handlers
 * the design writes inline, the scroll-to-bottom its `componentDidUpdate` does (`:879`), and
 * the one painter that puts the trace's frame on the page.
 *
 * **What the handoff changed, and the design did not have.**
 *
 * · **The name and the mascot.** The title reads `Ask Vee` and the pill `Ask Vee`; a reply is
 *   labelled `Vee` (`selectors/chat.ts`, `authorOf`). The mascot — a 16 × 16 pixel sprite,
 *   `app/Vee.tsx` — stands where the design's sparkle did, in the header and on the pill, and in
 *   front of each reply's label. The header's and the pill's are at rest (`idle`); a reply's
 *   takes its state from its turn — `thinking`, `reading`, `found` at each finding, `done` — and
 *   stays `done` while that reply is the newest message.
 * · **The live reply, where the design's busy row was.** While a turn runs the transcript's
 *   next row *is* the assistant's reply being written: its label with a shimmering `Thinking`,
 *   and — once a tool has started — a bubble holding a one-line ticker and the element matrix
 *   (`app/Trace.tsx`). The row has the index the committed message will get and is the same
 *   element when it commits, so nothing jumps and the cells go on from where they were. The
 *   design's row (`:499–531` — a brand mark, a stage line, three dots) is not in the port.
 * · **A stop control.** The design has none (`chatSend` has no companion, `:1592`), and for as
 *   long as the port followed it neither did the panel. The handoff has one: while a turn runs
 *   the send button's arrow cross-fades to a stop square, and a click stops the turn
 *   (`abortChat`). Enter during a turn still does nothing — the re-entry guard is `sendChat`'s —
 *   nothing is `disabled`, and closing the panel still does not stop the turn (`:2011`).
 * · **`You` on the left**, with the assistant's corner, which is what lets the typed line rise
 *   out of the composer in a straight line: the composer's text and a bubble's text stand at
 *   the same x.
 * · **Reduced motion.** Under `prefers-reduced-motion: reduce` every state still shows — the
 *   status, the latest step, the matrix settled, the rows — and nothing moves between them.
 *
 * **Sizes.** The handoff's panel is this panel traced from a screenshot at 150 % scaling, so
 * every existing style string is unchanged and only what is new is sized from it (its px ÷ 1.5,
 * `J` — declared in `ai/trace-plan.ts`, re-exported by `ai/trace`). The 16 × 16 sprite's slot
 * overhangs its row and is pulled in by negative margins, so the header, the label row and the
 * pill keep the height and the text positions they had.
 *
 * **The log does not scroll sideways.** The design's tooltip (`[data-tip]::after`,
 * `styles/design.css`) is laid out even while it is invisible, and a control near the log's
 * right edge — the design's own right-aligned `reply`, a chip at the end of a line — put 20 px
 * of it outside the log, which then showed a horizontal scrollbar. Inside the log a tooltip
 * that is not showing is not generated (`styles/vee.css`), and the log's own overflow is
 * vertical only.
 *
 * **And one lane the design does not declare**: `--brow` on the stage (`selectors/lanes.ts`) is
 * what the bottom row's centre zone stands above its one-line row. The panel's `bottom`, its
 * `max-height` and its resize clamp take it, so the panel stops above a reset pill that stands
 * over a hint instead of covering it; with the lane at `0px` all three are the design's.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { abortChat, sendChat } from '../ai/bridge'
import {
  answerHeight,
  LABEL_RISE,
  PAD_X,
  ROW_SLIDE,
  traceFrame,
  traceNextCue,
  traceSend,
  WORD_RISE,
  type SendFrame,
  type TraceFrame
} from '../ai/trace'
import { onTrace, traceNow, traceState } from '../ai/trace-store'
import { pick, useShell, type ChatMessage } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { chatRight } from '../state/selectors/lanes'
import {
  ASSISTANT,
  BUBBLE_RADIUS,
  chatExamples,
  chatRow,
  chipsFolded,
  chipsStarted,
  clampChatSize,
  replyStrip,
  sendClick,
  veeStateOf,
  type ChatRow
} from '../state/selectors/chat'
import { el } from '../dom'
import { s } from './css'
import { Cross, ReplyArrow, Revert, SendArrow } from './icons'
import {
  bubbleStyle,
  kickTrace,
  matrixHeight,
  onTraceFrame,
  paintMatrix,
  reducedMotion,
  ReplyBubble,
  textHeight,
  TraceStatus
} from './Trace'
import { Vee } from './Vee'
import { VEE_OFFSET, VEE_SLOT, veeLabelOffset, type VeeState } from './vee-grid'

/** `:495` — the empty state, one string so it diffs against the design's own line. */
const EMPTY_COPY =
  'Ask what you want to see or what you want to know — filter, isolate, section, quantities, audits, interference checks. Review only: SGVue never writes to your model.'

const focusComposer = (): void => {
  const input = el('chatinput')
  if (input instanceof HTMLInputElement) input.focus()
}

/**
 * The margins that fit each of the sprite's slots (`VEE_SLOT`) into the row the design already
 * has. The 16 × 16 grid is larger than the 12 × 12 body in it — three empty rows above for the
 * hop and the `!`, one below, two columns either side — so a slot overhangs its row and is
 * pulled in by negative margins, as the reference's are (`ask-thinking-hex.jsx:315`, `:367`).
 * The top margin is the larger one: it lifts the grid by about a cell, which is what puts the
 * **body** on the row's centre line.
 *
 *   header  21 px, 15 px of flow — the sparkle's 15, so the title starts where it did. The slot
 *           spans 11–32 px from the panel's edge; the reference's, 11.5–32.8.
 *   label   19 px, 10 px of flow each way — the row keeps its 10 px of height, and the slot's
 *           left edge is on the header slot's.
 *   pill    16 px, 14 px of flow — the sparkle's 14, so the label starts where it did.
 */
const VEE_MARGIN = {
  header: '-4px -4px -1px -2px',
  label: '-6px -4px -3px -5px',
  pill: '-3px -1px -1px -1px'
} as const

/** `:2051`'s suggestion pill, verbatim — shared by the suggestions and the fold chip. */
const CHIP_STYLE =
  'font:400 10.5px/1 var(--mono);color:var(--muted);padding:5px 8px;border:1px solid var(--border);border-radius:999px'

/** The store fields this component reads — it re-renders when one of them changes. */
const SUGGEST_KEYS = pick('chatMsgs', 'chatSuggestOpen', 'setChatSuggestOpen')

/**
 * 2026-09-24 — the owner: *"The ASK SGVUE AI suggestion are great but take up too many
 * space."*, then *"one line + hide after start"*. The design's `flex-wrap:wrap` row is one
 * line that scrolls sideways — scrollbar hidden, a soft fade on the right edge while more is
 * off it, and a vertical wheel turned into a horizontal scroll. Once the conversation has a
 * user turn the row folds behind one `suggestions` chip in the same pill; picking a
 * suggestion fills the composer and folds it again. What is suggested is unchanged.
 */
function SuggestRow({ items, onPick }: { items: string[]; onPick: (t: string) => void }): React.JSX.Element {
  const st = useShell(useShallow(SUGGEST_KEYS))
  const row = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState(false)
  const started = chipsStarted(st.chatMsgs)
  const folded = chipsFolded(st.chatMsgs, st.chatSuggestOpen)

  useLayoutEffect(() => {
    const node = row.current
    if (!node) return
    const measure = (): void =>
      setFade(node.scrollLeft + node.clientWidth < node.scrollWidth - 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    node.addEventListener('scroll', measure, { passive: true })
    return () => {
      ro.disconnect()
      node.removeEventListener('scroll', measure)
    }
  }, [folded, items.join('\n')])

  return (
    <div style={s('display:flex;align-items:center;gap:5px;min-width:0')}>
      {started && (
        <button
          onClick={() => st.setChatSuggestOpen(folded)}
          aria-expanded={!folded}
          className="hv-accent-both"
          style={s(CHIP_STYLE + ';flex:none')}
        >
          {folded ? '▸' : '▾'} suggestions
        </button>
      )}
      {!folded && (
        <div
          ref={row}
          data-role="chatsuggest"
          onWheel={(e) => {
            const node = e.currentTarget
            if (e.deltaY && node.scrollWidth > node.clientWidth) node.scrollLeft += e.deltaY
          }}
          style={s(
            'flex:1;min-width:0;display:flex;flex-wrap:nowrap;gap:5px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none' +
              (fade
                ? ';-webkit-mask-image:linear-gradient(to right, #000 calc(100% - 28px), transparent);mask-image:linear-gradient(to right, #000 calc(100% - 28px), transparent)'
                : '')
          )}
        >
          {items.map((t) => (
            <button
              key={t}
              onClick={() => onPick(t)}
              className="hv-accent-both"
              style={s(CHIP_STYLE + ';flex:none')}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ────────────────────────────── the trace, put on the page ────────────────────────────── */

/** The parts of the panel the trace moves, found again after every render. */
interface Parts {
  log: HTMLElement | null
  /** The reply being drawn: its row, and what is in it. */
  row: HTMLElement | null
  label: HTMLElement | null
  sprite: HTMLElement | null
  thinking: HTMLElement | null
  final: HTMLElement | null
  bubble: HTMLElement | null
  canvas: HTMLCanvasElement | null
  ticker: HTMLElement | null
  ticks: {
    line: HTMLElement
    label: HTMLElement
    mono: HTMLElement
    count: HTMLElement
    n: HTMLElement
    unit: HTMLElement
  }[]
  text: HTMLElement | null
  words: HTMLElement[]
  rule: HTMLElement | null
  rows: HTMLElement[]
  /** The user's row above it. */
  youLabel: HTMLElement | null
  youBubble: HTMLElement | null
  youText: HTMLElement | null
  /** The composer, and the line lifting out of it. */
  input: HTMLElement | null
  send: HTMLElement | null
  arrow: HTMLElement | null
  stop: HTMLElement | null
  lift: HTMLElement | null
}

const part = (root: Element | null, name: string): HTMLElement | null =>
  root?.querySelector<HTMLElement>(`[data-part="${name}"]`) ?? null

function partsOf(panel: HTMLElement | null, index: number): Parts {
  const log = el('chatlog', panel ?? undefined)
  const row = log?.querySelector<HTMLElement>(`:scope > [data-row="${index}"]`) ?? null
  const you = log?.querySelector<HTMLElement>(`:scope > [data-row="${index - 1}"][data-mine]`) ?? null
  const bubble = part(row, 'bubble')
  const parts: Parts = {
    log,
    row,
    label: part(row, 'label'),
    sprite: part(row, 'sprite'),
    thinking: part(row, 'status-thinking'),
    final: part(row, 'status-final'),
    bubble,
    canvas: bubble?.querySelector('canvas') ?? null,
    ticker: part(bubble, 'ticker'),
    ticks: [...(bubble?.querySelectorAll<HTMLElement>('[data-part="tick"]') ?? [])].map((line) => ({
      line,
      label: part(line, 'tick-label')!,
      mono: part(line, 'tick-mono')!,
      count: part(line, 'tick-count')!,
      n: part(line, 'tick-n')!,
      unit: part(line, 'tick-unit')!
    })),
    text: part(bubble, 'text'),
    words: [...(bubble?.querySelectorAll<HTMLElement>('[data-part="word"]') ?? [])],
    rule: part(bubble, 'rule'),
    rows: [...(bubble?.querySelectorAll<HTMLElement>('[data-part="row"]') ?? [])],
    youLabel: part(you, 'label'),
    youBubble: part(you, 'bubble'),
    youText: part(you, 'text'),
    input: el('chatinput', panel ?? undefined),
    send: part(panel, 'send'),
    arrow: part(panel, 'send-arrow'),
    stop: part(panel, 'send-stop'),
    lift: part(panel, 'lift')
  }
  // What the trace writes takes effect at once. The design's reduced-motion rule gives every
  // element a 0.01 ms transition (`design.css`), and a transition — however short — holds the
  // old value for one more frame: the one thing a state shown "at its end" must not do.
  for (const node of [
    parts.label, parts.sprite, parts.thinking, parts.final, parts.bubble, parts.ticker,
    ...parts.ticks.map((t) => t.line), ...parts.words, parts.rule, ...parts.rows,
    parts.youLabel, parts.youBubble, parts.arrow, parts.stop
  ]) {
    if (node && node.style.transitionProperty !== 'none') node.style.transitionProperty = 'none'
  }
  return parts
}

/**
 * Take off a row everything the trace wrote on it. The trace has moved on — the next turn began
 * while the last reply was still arriving, or the turn failed — and what it leaves has to be
 * that row's end state, which is simply the row as React laid it out: no height of the trace's,
 * every word and row in, nothing held part of the way.
 */
function releaseParts(n: Parts): void {
  for (const node of [n.label, n.sprite, n.bubble, n.rule, ...n.words, ...n.rows, n.youLabel, n.youBubble]) {
    if (!node) continue
    node.style.opacity = ''
    node.style.transform = ''
  }
  if (n.bubble) n.bubble.style.height = ''
  for (const word of n.words) word.style.top = ''
  if (n.youBubble) n.youBubble.style.transformOrigin = ''
  if (n.youText) n.youText.style.visibility = ''
}

const px = (v: number): string => `${Math.round(v * 1000) / 1000}px`
/** An opacity as a style value: nothing at all once it is 1. */
const alpha = (v: number): string => (v >= 1 ? '' : String(Math.round(v * 1000) / 1000))
const setText = (node: HTMLElement, text: string): void => {
  if (node.textContent !== text) node.textContent = text
}

/** The send button's pressed tone: the handoff's `#1B4A45`, which is `--sel-bg` 18 % toward `--accent`. */
const PRESSED = 18

/** The composer's line height and a bubble's, in px: the lift starts with the two baselines together. */
const INPUT_LINE = 12.5 * 1.4
const BUBBLE_LINE = 12.5 * 1.55

/** What stands outside the reply: the composer, the user's row, the line lifting between them. */
function applySend(n: Parts, f: SendFrame | null, panel: HTMLElement | null): void {
  const busy = f ? f.busy : 0
  if (n.arrow) {
    n.arrow.style.opacity = alpha(1 - busy)
    n.arrow.style.transform = busy ? `scale(${1 - 0.5 * busy})` : ''
  }
  if (n.stop) {
    n.stop.style.opacity = String(Math.round(busy * 1000) / 1000)
    n.stop.style.transform = `scale(${0.4 + 0.6 * busy})`
  }
  const press = f ? f.press : 1
  if (n.send) {
    n.send.style.transform = press === 1 ? '' : `scale(${0.9 + 0.1 * press})`
    n.send.style.background =
      press >= 1 ? 'var(--sel-bg)' : `color-mix(in srgb, var(--sel-bg), var(--accent) ${PRESSED * (1 - Math.max(0, press))}%)`
  }
  const placeholder = f ? f.placeholder : 1
  if (n.input) {
    if (placeholder >= 1) n.input.style.removeProperty('--ph')
    else n.input.style.setProperty('--ph', String(placeholder))
  }
  const you = f ? f.you : 1
  if (n.youLabel) {
    n.youLabel.style.opacity = alpha(you)
    n.youLabel.style.transform = you >= 1 ? '' : `translateY(${px((1 - you) * LABEL_RISE)})`
  }
  const bubble = f ? f.bubble : 1
  /** The user's bubble comes in a little small, about the middle of its left edge. */
  const scale = 0.94 + 0.06 * bubble
  if (n.youBubble) {
    n.youBubble.style.opacity = alpha(bubble)
    n.youBubble.style.transform = bubble >= 1 ? '' : `scale(${scale})`
    n.youBubble.style.transformOrigin = bubble >= 1 ? '' : '0 50%'
  }
  // The typed line: out of the composer and up to its bubble, at one x.
  const lifting = !!f && f.lift < 1 && !!n.youText && !!n.youBubble && !!n.input && !!panel
  if (n.youText) n.youText.style.visibility = lifting ? 'hidden' : ''
  if (n.lift) {
    if (!lifting) n.lift.style.display = 'none'
    else {
      const origin = panel!.getBoundingClientRect()
      const from = n.input!.getBoundingClientRect()
      // Where the text will stand once its bubble is full size — not where the scaled bubble
      // has it now: the line is laid out at the width it will have, so it wraps as it will.
      const box = n.youBubble!.getBoundingClientRect()
      const now = n.youText!.getBoundingClientRect()
      const mid = box.top + box.height / 2
      const to = {
        left: box.left + (now.left - box.left) / scale,
        top: mid + (now.top - mid) / scale,
        width: now.width / scale
      }
      // The input's border and padding (1 + 8 px above its text, 1 + 10 px left of it).
      const fromTop = from.top + 9 - (BUBBLE_LINE - INPUT_LINE) / 2
      setText(n.lift, n.youText!.textContent ?? '')
      n.lift.style.display = 'block'
      n.lift.style.width = px(to.width)
      n.lift.style.left = px(to.left + (from.left + 11 - to.left) * (1 - f!.lift) - origin.left - 1)
      n.lift.style.top = px(fromTop + (to.top - fromTop) * f!.lift - origin.top - 1)
    }
  }
}

/** The reply: its label, its status, its bubble, its ticker, its matrix, its words and its rows. */
function applyFrame(n: Parts, f: TraceFrame, canvasH: number): void {
  if (n.label) {
    n.label.style.opacity = alpha(f.label.opacity)
    n.label.style.transform = f.label.y ? `translateY(${px(f.label.y)})` : ''
  }
  if (n.sprite) {
    n.sprite.style.opacity = alpha(f.sprite.opacity)
    n.sprite.style.transform = f.sprite.scale === 1 ? '' : `scale(${Math.round(f.sprite.scale * 1000) / 1000})`
  }
  if (n.thinking) {
    const t = f.status.thinking
    n.thinking.style.opacity = t ? String(Math.round(t.opacity * 1000) / 1000) : '0'
    n.thinking.style.transform = t && t.y ? `translateY(${px(t.y)})` : ''
    // The shimmer: a highlight a third of the text wide, sweeping left to right every 1.6 s.
    n.thinking.style.backgroundPosition = `${f.status.shimmer === null ? 100 : Math.round((100 - f.status.shimmer * 100) * 10) / 10}% 0`
  }
  if (n.final) {
    const t = f.status.final
    n.final.style.opacity = t ? String(Math.round(t.opacity * 1000) / 1000) : '0'
    n.final.style.transform = t && t.y ? `translateY(${px(t.y)})` : ''
  }
  if (n.bubble) {
    // Settled, the bubble is ordinary flow again: its height is its content's.
    n.bubble.style.height = f.settled ? '' : px(f.bubble.height)
    n.bubble.style.opacity = alpha(f.bubble.opacity)
  }
  if (n.ticker) {
    const shown = f.ticker.opacity > 0 && f.ticker.lines.length > 0
    n.ticker.style.display = shown ? 'block' : 'none'
    n.ticker.style.opacity = alpha(f.ticker.opacity)
    n.ticks.forEach((tick, i) => {
      const line = shown ? f.ticker.lines[i] : undefined
      if (!line) {
        tick.line.style.display = 'none'
        return
      }
      tick.line.style.display = 'flex'
      tick.line.style.opacity = alpha(line.opacity)
      tick.line.style.transform = line.y ? `translateY(${px(line.y)})` : ''
      setText(tick.label, line.label)
      setText(tick.mono, line.mono)
      // Nothing in the mono face: no piece for the row's gap to stand beside.
      tick.mono.style.display = line.mono ? '' : 'none'
      tick.count.style.display = line.count ? '' : 'none'
      if (line.count) {
        setText(tick.n, line.count.text)
        setText(tick.unit, line.count.unit)
        tick.n.style.color = line.count.accent ? 'var(--accent-ink)' : 'var(--ink)'
      }
    })
  }
  if (n.canvas && n.bubble) {
    paintMatrix(n.canvas, n.bubble.clientWidth, canvasH, f.cells, f.beam, window.devicePixelRatio || 1)
  }
  n.words.forEach((word, j) => {
    const a = f.words[j] ?? 1
    word.style.opacity = alpha(a)
    word.style.top = a >= 1 ? '' : px((1 - a) * WORD_RISE)
  })
  if (n.rule) n.rule.style.opacity = n.rows.length ? alpha(f.rule) : ''
  n.rows.forEach((row, L) => {
    const a = f.rows[L] ?? 1
    row.style.opacity = alpha(a)
    row.style.transform = a >= 1 ? '' : `translateX(${px(-(1 - a) * ROW_SLIDE)})`
  })
}

/* ────────────────────────────── the panel (`:430`) ────────────────────────────── */

/** The store fields this component reads — it re-renders when one of them changes. */
const PANEL_KEYS = pick(
  'applyPending', 'byId', 'cardTop', 'chatBusy', 'chatErr', 'chatH', 'chatInput', 'chatMsgs',
  'chatOpen', 'chatReplyTo', 'chatSuggestOpen', 'chatW', 'copyTable', 'dismissPending',
  'revertTurn', 'sel', 'selIds', 'select', 'setChatInput', 'setChatOpen', 'setChatReplyTo',
  'setChatSuggestOpen', 'vpW', 'stack', 'hidden', 'loaded', 'library', 'units'
)

/** A running turn with no trace to draw: everything of the send at rest, the button a stop. */
const STOP_ONLY: SendFrame = { lift: 1, press: 1, bubble: 1, you: 1, placeholder: 1, busy: 1, settled: true }

/** The reply being written has no message yet: what its row is drawn from until it does. */
const LIVE_ROW: Pick<ChatRow, 'who' | 'fg' | 'bg' | 'radius'> = {
  who: ASSISTANT,
  fg: 'var(--ink)',
  bg: 'var(--step-bg)',
  radius: BUBBLE_RADIUS
}

export default function ChatPanel(): React.JSX.Element | null {
  const st = useShell(useShallow(PANEL_KEYS))
  const trace = useSyncExternalStore(onTrace, traceState)
  const panel = useRef<HTMLDivElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const lastLen = useRef(0)
  /** The log follows its own foot while the reply grows — unless the user has scrolled up. */
  const stuck = useRef(true)
  const parts = useRef<Parts | null>(null)
  /** The state of the mascot in front of the reply the trace is drawing. */
  const [vee, setVee] = useState<VeeState>('thinking')
  const veeNow = useRef<VeeState>('thinking')
  /** When the send button last stopped a turn (`sendClick`). */
  const stoppedAt = useRef<number | null>(null)

  /**
   * The turn being drawn — running, or answered and not yet replaced by the next. A turn the
   * store no longer shows as running, because the transcript was replaced under it (a new
   * federation's boot audit), has nothing to draw: without this the loop would wait, frame after
   * frame, for an answer to a row that is not there.
   */
  const timeline =
    trace.timeline && (trace.timeline.answer !== null || st.chatBusy) ? trace.timeline : null
  /** The transcript's rows: every message, and while a turn runs the reply being written. */
  const live = st.chatBusy && timeline !== null && trace.index === st.chatMsgs.length
  const count = st.chatMsgs.length + (live ? 1 : 0)
  /** Whether row `i` is the one the trace draws. */
  const drawn = (i: number): boolean => timeline !== null && trace.index === i && i < count

  /**
   * One frame of the trace, put on the page. Called by the loop (`app/Trace.tsx`), and directly
   * after every render so that what React has just laid out is never painted as it stands.
   */
  const frame = (T: number, reduced: boolean): boolean | number => {
    const n = parts.current
    if (!n || !n.log) return false
    if (!timeline) {
      // No trace to draw — but a turn the store says is running still has a stop button: the
      // square stands, with nothing else of the send's motion.
      applySend(n, st.chatBusy ? STOP_ONLY : null, panel.current)
      n.log.removeAttribute('data-moving')
      return false
    }
    const send = traceSend(timeline, T, reduced)
    let settled = send.settled
    applySend(n, send.settled ? null : send, panel.current)
    if (n.row && n.bubble) {
      const dpr = window.devicePixelRatio || 1
      /** The frame for the bubble as it is laid out now; what it was measured from comes back. */
      const draw = (): [number, number, TraceFrame] => {
        const width = n.bubble!.clientWidth - 2 * PAD_X
        const textH = textHeight(n.text)
        const at = traceFrame(timeline, T, { width, dpr, textH, reduced })
        const answer = timeline.answer === null ? 0 : answerHeight(textH, n.rows.length)
        applyFrame(n, at, matrixHeight(answer))
        return [width, textH, at]
      }
      let [width, textH, shown] = draw()
      if (stuck.current) n.log.scrollTop = n.log.scrollHeight
      // Drawing it can change what it was drawn for: a taller bubble brings the log's scrollbar,
      // which narrows the bubble and re-wraps its text. Once more, then, from what is there now.
      if (n.bubble.clientWidth - 2 * PAD_X !== width || textHeight(n.text) !== textH) {
        ;[width, textH, shown] = draw()
      }
      if (veeNow.current !== shown.sprite.state) {
        veeNow.current = shown.sprite.state
        setVee(shown.sprite.state)
      }
      settled = settled && shown.settled
    }
    if (stuck.current) n.log.scrollTop = n.log.scrollHeight
    n.log.toggleAttribute('data-moving', !settled)
    if (settled) return false
    // With no motion to draw there is nothing to do until the turn's next cue.
    return reduced ? (traceNextCue(timeline, T) ?? false) : true
  }
  /**
   * The trace is decoration, and it is drawn from a layout effect: an error thrown there would
   * take the whole window with it. If a frame ever fails, the trace lets go of the row — which
   * is then the reply as React laid it out, readable — says so on the console, and stops.
   */
  const paint = (T: number, reduced: boolean): boolean | number => {
    try {
      return frame(T, reduced)
    } catch (error) {
      console.error('[trace] a frame could not be drawn', error)
      if (parts.current) releaseParts(parts.current)
      return false
    }
  }
  const painter = useRef(paint)
  painter.current = paint

  // One painter for the life of the panel; it always runs the latest render's closure.
  useEffect(() => onTraceFrame((T, reduced) => painter.current(T, reduced)), [])

  // After every render: find the parts again — settling the row the trace has left, if it has
  // moved on — keep the log at its foot when a row was added (`:879`), and draw the trace's
  // frame before the browser paints what React has laid out.
  useLayoutEffect(() => {
    const next = partsOf(panel.current, trace.index)
    const was = parts.current
    if (was && (was.row !== next.row || was.youBubble !== next.youBubble)) releaseParts(was)
    parts.current = next
    const node = log.current
    if (node && count !== lastLen.current) {
      lastLen.current = count
      stuck.current = true
      node.scrollTop = node.scrollHeight
    }
    painter.current(traceNow(), reducedMotion())
    kickTrace()
  })

  // The reply strip's line: a reply of Vee's flattened into plain text (`plainOf`) — once when the
  // transcript or the target changes, never again at every keystroke in the composer.
  const reply = useMemo(() => replyStrip(st.chatMsgs, st.chatReplyTo), [st.chatMsgs, st.chatReplyTo])

  if (!st.chatOpen) return null

  const right = chatRight(st.sel != null && st.byId.has(st.sel), st.vpW)

  /**
   * `:1127` — drag the top-left corner: width grows leftward, height upward, both clamped to
   * the stage. The lane here is `selIds.length && width >= 420` (`:1130`), which is the
   * design's own expression at this site; `:2049` decides the panel's `right` from the derived
   * card instead. They differ only for a selected id the federation no longer carries.
   */
  const onChatResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const stage = el('stage')
    if (!stage) return
    const r = stage.getBoundingClientRect()
    const lane = chatRight(st.selIds.length > 0, r.width)
    const start = { w: st.chatW, h: st.chatH, x: e.clientX, y: e.clientY }
    const move = (ev: PointerEvent): void => {
      const now = useShell.getState()
      const next = clampChatSize(start, ev, r, lane, now.cardTop, now.brow)
      now.setChatSize(next.chatW, next.chatH)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** `:2013` — Enter sends, Shift+Enter does not. During a turn `sendChat` itself does nothing. */
  const onChatKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendChat()
    }
  }

  /**
   * The send button: it stops a running turn, sends otherwise — and for a moment after a stop
   * does neither, so that a double-click on Stop cannot send what was drafted meanwhile.
   */
  const onSendClick = (): void => {
    const now = performance.now()
    const act = sendClick(st.chatBusy, now, stoppedAt.current)
    if (act === 'stop') {
      stoppedAt.current = now
      abortChat()
    } else if (act === 'send') void sendChat()
  }

  /** One row of the transcript: a message, or — `message` null — the reply being written. */
  const row = (message: ChatMessage | null, i: number): React.JSX.Element => {
    const m = message ? chatRow(message, i, st.units) : null
    const look = m ?? LIVE_ROW
    const mine = message?.role === 'user'
    /** A turn's reply — written, or being written: the trace's bubble, and a status by the name. */
    const traced = !message || !!m?.traced
    const owned = traced && drawn(i)
    return (
      <div
        key={i}
        data-row={i}
        data-mine={mine ? '' : undefined}
        // The reply being written is not read out: one hidden line below says Vee is working.
        aria-hidden={message ? undefined : true}
        style={s(
          `display:flex;flex-direction:column;align-items:${m ? m.align : 'flex-start'};gap:4px;opacity:${m ? m.opacity : '1'}`
        )}
      >
        <div
          data-part="label"
          style={s(
            `display:flex;align-items:center;justify-content:${m ? m.just : 'flex-start'};gap:7px;padding:0 3px`
          )}
        >
          {traced ? (
            // The reply's mascot pops in with its row, about a point just under its middle.
            <span data-part="sprite" style={s('display:flex;transform-origin:50% 60%')}>
              <Vee
                slot={VEE_SLOT.label}
                margin={VEE_MARGIN.label}
                offset={veeLabelOffset(i)}
                state={owned ? vee : veeStateOf(st.chatMsgs, i)}
              />
            </span>
          ) : m?.hasSprite ? (
            <Vee slot={VEE_SLOT.label} margin={VEE_MARGIN.label} offset={veeLabelOffset(i)} />
          ) : null}
          <span style={s('font:500 10px/1 var(--sans);letter-spacing:.02em;color:var(--faint)')}>
            {look.who}
          </span>
          {traced ? <TraceStatus text={m ? m.status : ''} rolling={owned} /> : null}
          {message ? (
            <button
              onClick={() => {
                st.setChatReplyTo(i)
                focusComposer()
              }}
              data-tip="Reply to this message"
              className="hv-accent-ink"
              style={s(
                'display:flex;align-items:center;gap:4px;font:500 10px/1 var(--sans);color:var(--faint)'
              )}
            >
              <ReplyArrow />
              reply
            </button>
          ) : null}
          {m?.canRevert ? (
            <button
              onClick={() => st.revertTurn(i)}
              data-tip="Undo just this step"
              className="hv-accent-ink"
              style={s(
                'display:flex;align-items:center;gap:4px;font:400 9.5px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--faint)'
              )}
            >
              <Revert />
              revert
            </button>
          ) : null}
        </div>

        {m?.hasQuote ? (
          <span
            style={s(
              `display:flex;flex-direction:column;gap:2px;max-width:${m.maxW};padding:5px 9px;border-left:2px solid var(--accent);background:var(--step-bg);border-radius:0 6px 6px 0`
            )}
          >
            <span style={s('font:500 9.5px/1 var(--sans);color:var(--accent-ink)')}>
              {m.quoteWho}
            </span>
            <span
              style={s(
                'font:400 11px/1.4 var(--sans);color:var(--muted);display:block;max-height:30px;overflow:hidden'
              )}
            >
              {m.quoteText}
            </span>
          </span>
        ) : null}

        {/* Every message of Vee's is laid out in its blocks — paragraphs, lists, tables
            (2026-10-08) — and a turn's reply also carries its trace. A user's is plain text. */}
        {!mine ? (
          <ReplyBubble
            text={message ? message.text : null}
            trace={message?.trace ?? null}
            owned={owned}
            // The bubble a trace opens is full width; while the turn runs that is still to be seen.
            wide={!m || m.wide}
            base={bubbleStyle(look.fg, look.bg, look.radius, '100%')}
            onPick={(ids) => st.select(ids, false)}
          />
        ) : (
          <span data-part="bubble" style={s(bubbleStyle(m!.fg, m!.bg, m!.radius, m!.maxW))}>
            {/* A block of its own, so the lifting line can be laid exactly over it. */}
            <span data-part="text" style={s('display:block')}>
              {message.text}
            </span>
          </span>
        )}

        {m?.hasChips ? (
          <div style={s('display:flex;flex-wrap:wrap;gap:5px;align-self:stretch;margin-top:1px')}>
            {(message!.chips ?? []).map((c, j) => (
              <button
                key={`${c.label}-${j}`}
                onClick={() => st.select(c.ids, false)}
                onDoubleClick={() => st.select(c.ids, true)}
                data-tip="Click to select · double-click to zoom"
                style={s(
                  'font:500 10.5px/1 var(--mono);color:var(--sel-ink);background:var(--sel-bg);border:1px solid var(--accent);border-radius:999px;padding:5px 9px;white-space:nowrap'
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : null}

        {m?.hasTable ? (
          <div
            style={s(
              'display:flex;flex-direction:column;align-self:stretch;border:1px solid var(--border);border-radius:8px;overflow:hidden'
            )}
          >
            <div
              style={s(
                'display:flex;align-items:center;gap:8px;padding:6px 9px;background:var(--step-bg)'
              )}
            >
              <span
                style={s(
                  'flex:1;font:500 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)'
                )}
              >
                {m.tableTitle}
              </span>
              <button
                // `:2029`. The store's own copy (`copyText`): the design's line called the
                // clipboard API this app always refuses, and copied nothing.
                onClick={() => void st.copyTable(message!.table!)}
                style={s('font:500 10px/1 var(--mono);color:var(--accent-ink)')}
              >
                copy csv
              </button>
            </div>
            {m.tableRows.map((r, j) => (
              <button
                key={`${r.k}-${j}`}
                onClick={() => st.select([...r.ids], true)}
                className="hv-step"
                style={s(
                  'display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:baseline;padding:5px 9px;border-top:1px solid var(--border)'
                )}
              >
                <span
                  style={s(
                    'font:400 11.5px/1.4 var(--sans);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left'
                  )}
                >
                  {r.k}
                </span>
                <span
                  style={s(
                    'font:400 11px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted)'
                  )}
                >
                  {r.q}
                </span>
                <span
                  style={s(
                    'font:500 11px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--ink);min-width:26px;text-align:right'
                  )}
                >
                  {r.n}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {m?.hasPending ? (
          <div
            style={s(
              'display:flex;flex-direction:column;align-self:stretch;gap:8px;padding:9px 10px;background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:8px'
            )}
          >
            <span
              style={s('font:400 11.5px/1.45 var(--sans);color:var(--warn-ink);text-wrap:pretty')}
            >
              {m.pendingLabel}
            </span>
            <div style={s('display:flex;align-items:center;gap:8px')}>
              <button
                onClick={() => st.applyPending(i)}
                className="hv-card"
                style={s(
                  'font:500 11px/1 var(--sans);color:var(--warn-ink);padding:5px 11px;border:1px solid var(--warn-line);border-radius:999px'
                )}
              >
                apply
              </button>
              <button
                onClick={() => st.dismissPending(i)}
                style={s('font:500 11px/1 var(--sans);color:var(--muted);padding:5px 6px')}
              >
                cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      ref={panel}
      style={s(
        `position:absolute;right:${right}px;bottom:calc(52px + var(--brow, 0px));z-index:12;width:max(240px, min(${st.chatW}px, calc(100% - ${right}px - 12px)));height:${st.chatH}px;max-height:calc(100% - ${st.cardTop}px - 64px - var(--brow, 0px));display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border-strong);border-radius:12px;box-shadow:var(--shadow);animation:fadein .15s ease-out;transition:right .18s ease`
      )}
    >
      <div
        onPointerDown={onChatResize}
        className="hv-grab"
        style={s(
          'position:absolute;left:0;top:0;width:34px;height:34px;cursor:nwse-resize;z-index:2;border-top-left-radius:12px'
        )}
      >
        <span
          style={s(
            'position:absolute;left:9px;top:9px;width:17px;height:17px;border-top:2px solid var(--grab, var(--border-strong));border-left:2px solid var(--grab, var(--border-strong));border-top-left-radius:7px;transition:border-color .15s ease'
          )}
        />
      </div>

      <div
        style={s(
          'display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid var(--border)'
        )}
      >
        <Vee slot={VEE_SLOT.header} margin={VEE_MARGIN.header} offset={VEE_OFFSET.header} />
        <span
          id="sgvue-chat-title"
          style={s(
            'flex:1;font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)'
          )}
        >
          Ask Vee
        </span>
        <button
          onClick={() => st.setChatOpen(false)}
          aria-label="Close"
          className="hv-step-ink"
          style={s(
            'width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
          )}
        >
          <Cross size={13} weight={1.8} />
        </button>
      </div>

      <div
        data-role="chatlog"
        ref={log}
        role="log"
        aria-live="polite"
        aria-labelledby="sgvue-chat-title"
        onScroll={(e) => {
          const node = e.currentTarget
          stuck.current = node.scrollHeight - node.scrollTop - node.clientHeight < 2
        }}
        style={s(
          'flex:1;min-height:0;overflow-x:hidden;overflow-y:auto;display:flex;flex-direction:column;gap:9px;padding:12px'
        )}
      >
        {/* One keyed list: the reply being written has the key its message will have, so the
            row that commits is the row that was live — the same element, and nothing in it
            starts again. */}
        {[...st.chatMsgs.map(row), ...(live ? [row(null, st.chatMsgs.length)] : [])]}

        {st.chatMsgs.length === 0 ? (
          <span style={s('font:400 12px/1.55 var(--sans);color:var(--faint);text-wrap:pretty')}>
            {EMPTY_COPY}
          </span>
        ) : null}

        {st.chatErr ? (
          <span
            style={s(
              'font:400 11.5px/1.5 var(--sans);color:var(--warn-ink);background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:7px;padding:7px 9px'
            )}
          >
            {st.chatErr}
          </span>
        ) : null}

        {/* What a screen reader hears of a running turn; the trace itself is not read out. */}
        <span className="sr-only">{st.chatBusy ? `${ASSISTANT} is working on it.` : ''}</span>
      </div>

      <div
        style={s(
          'display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px;border-top:1px solid var(--border)'
        )}
      >
        {reply.replying ? (
          <div
            style={s(
              'display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-left:2px solid var(--accent);background:var(--step-bg);border-radius:0 7px 7px 0'
            )}
          >
            <span style={s('flex:1;min-width:0;display:flex;flex-direction:column;gap:2px')}>
              <span style={s('font:500 9.5px/1 var(--sans);color:var(--accent-ink)')}>
                Replying to {reply.who}
              </span>
              <span
                style={s(
                  'font:400 11px/1.4 var(--sans);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
                )}
              >
                {reply.text}
              </span>
            </span>
            <button
              onClick={() => st.setChatReplyTo(null)}
              title="Cancel reply"
              className="hv-card-ink"
              style={s(
                'flex:none;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:5px;color:var(--faint)'
              )}
            >
              <Cross size={10} weight={2.2} />
            </button>
          </div>
        ) : null}

        <SuggestRow
          items={chatExamples(st)}
          onPick={(t) => {
            st.setChatInput(t)
            st.setChatSuggestOpen(false)
          }}
        />

        <div style={s('display:flex;align-items:flex-end;gap:8px')}>
          <input
            data-role="chatinput"
            type="text"
            value={st.chatInput}
            onChange={(e) => st.setChatInput(e.target.value)}
            onKeyDown={onChatKey}
            aria-labelledby="sgvue-chat-title"
            placeholder="How many doors on L2?"
            style={s(
              'flex:1;min-width:0;font:400 12.5px/1.4 var(--sans);color:var(--ink);background:var(--step-bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px'
            )}
          />
          {/* While a turn runs the same button stops it: its arrow cross-fades to a stop square. */}
          <button
            data-part="send"
            onClick={onSendClick}
            data-tip={st.chatBusy ? 'Stop' : 'Send (Enter)'}
            aria-label={st.chatBusy ? 'Stop' : 'Send (Enter)'}
            className="hv-accent-ground"
            style={s(
              'flex:none;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--sel-bg);color:var(--sel-ink);border:1px solid var(--accent)'
            )}
          >
            <span data-part="send-arrow" style={s('display:flex')}>
              <SendArrow />
            </span>
            <span
              data-part="send-stop"
              style={s(
                'position:absolute;left:50%;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:2px;background:var(--accent-ink);opacity:0;transform:scale(.4);pointer-events:none'
              )}
            />
          </button>
        </div>
      </div>

      {/* The typed line on its way from the composer to its bubble: over both, clipped to the
          panel, and shown only while it lifts. */}
      <div
        aria-hidden="true"
        style={s('position:absolute;inset:0;overflow:hidden;border-radius:11px;pointer-events:none;z-index:3')}
      >
        <span
          data-part="lift"
          style={s(
            'position:absolute;display:none;font:400 12.5px/1.55 var(--sans);color:var(--ink);text-wrap:pretty'
          )}
        />
      </div>
    </div>
  )
}

/* ────────────────────────────── the pill (`:536`) ────────────────────────────── */

/**
 * `:2041` — it lights while the panel is open, and is the only way to open it.
 *
 * Since 2026-10-01 it is the right zone of the stage's bottom row (`app/BottomRow.tsx`), which
 * stands it where the design's `position:absolute;right:12px;bottom:14px` did; the rest of the
 * string is the design's. `z-index:12` still applies: the button is `position:relative`, as
 * every `[data-tip]` is.
 *
 * The same day it took the assistant's name: its label reads `Ask Vee` (the design's: `Ask`) and
 * the mascot stands where the sparkle did, in the sparkle's own 14 px of flow. So the pill is
 * 88.9 px wide where it was 66.6 — the label, and nothing else: its height, colours, tip and
 * offsets are the design's.
 */
export function ChatPill(): React.JSX.Element {
  const chatOpen = useShell((st) => st.chatOpen)
  const setChatOpen = useShell((st) => st.setChatOpen)
  const fg = chatOpen ? 'var(--sel-ink)' : 'var(--muted)'
  const line = chatOpen ? 'var(--accent)' : 'var(--border)'
  return (
    <button
      onClick={() => setChatOpen(!chatOpen)}
      data-tip="Ask the assistant to filter, isolate, hide or navigate the model"
      className="hv-accent-line"
      style={s(
        `z-index:12;display:flex;align-items:center;gap:7px;height:32px;padding:0 12px;background:var(--card);border:1px solid ${line};border-radius:999px;box-shadow:var(--shadow);color:${fg};pointer-events:auto`
      )}
    >
      <Vee slot={VEE_SLOT.pill} margin={VEE_MARGIN.pill} offset={VEE_OFFSET.pill} />
      <span style={s('font:500 11.5px/1 var(--sans);white-space:nowrap')}>Ask Vee</span>
    </button>
  )
}
