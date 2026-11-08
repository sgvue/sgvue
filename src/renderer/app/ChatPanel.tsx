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
 * **2026-11-07 — the panel is a window of its own.** The owner: *"Also bring vee out as a
 * separate window and always on top of our app window. because when the vee panel and properties
 * panel show up together, they blocked my model view."* This component is now the whole page of
 * the Ask Vee window (`renderer/vee/main.tsx`, `main/vee-window.ts`), a child of the main window.
 * **The conversation still runs in the main window**; this is its view. It reads the main
 * window's snapshot (`vee/store.ts`, under the names it read from the shell store) and the
 * trace, which its own page's trace store mirrors; every control sends one intent back
 * (`vee/link.ts`, `post`) and does nothing else — the composer, which is typed here, aside.
 * Every style string is the design's, but the panel's place in the stage: it fills the window,
 * so its `position`, `right`, `bottom`, `z-index`, width, height, `max-height`, border, radius,
 * shadow, fade-in and `right` transition are the OS window's now, and so is the top-left resize
 * corner and its clamp — the window is resized by its own edges. (The `--brow` lane the panel
 * cleared, which the property card still clears, is the bottom row's own.)
 *
 * **2026-11-08 — a messaging conversation ("Vee Messages", stage 1a).** The owner: *"I need the
 * conversation window like texting in messaging"*, and of three directions, the third — "site
 * group chat" (`prototypes/vee-messages/full/`, its `HANDOFF.md`). What changed, and only that:
 *
 * · **A header** — the 32 px Vee (two whole device pixels to a cell), `Vee`, and a presence line
 *   (`presenceOf`) — and under it **the pinned board**: what the main window's 3D view shows now,
 *   as counts only (`VeeBoard`, sent at most once a frame, whoever changed the view). The title
 *   `Ask Vee` is the OS window's.
 * · **`You` on the right**, Vee on the left. A reply of Vee's is a group: **one bubble per block of
 *   its text** (`ai/parts.ts`), then its cards — chips, the storey rows, the table, the consent
 *   card — with the avatar at the group's foot. Only the newest reply's avatar moves; older ones
 *   hold one open-eyed frame. The lead bubble carries the time; a user's carries one tick (sent)
 *   or two (picked up — its turn's first stream event arrived).
 * · **Reply quotes one bubble.** A bubble or card shows `reply` on hover or focus; the main window
 *   works out the quote from its own message.
 * · **The consent card** is the pending row, taped (tape means "Vee needs your OK"): the request,
 *   `Cancel`, and a confirm button that names the action (`pendingVerb`). It takes no focus by
 *   itself. Once answered it keeps a stamp — `APPLIED · 14:02`, `DELETED …`, `CANCELLED` — and the
 *   reply's one `Revert` stands on it; a reply with no card has its `Revert` at its foot.
 * · **System lines** for a turn that stopped or failed, in neutral ink, saying whether anything
 *   had already changed (`endLine`), with `Try again` on a failed turn; a `New message` pill when
 *   an answer lands while the thread is scrolled up; **not-ready lines** — no key (the composer
 *   is disabled, with no placeholder) or no model (no board, no suggestions).
 * · **The thinking trace** (`app/Trace.tsx`) draws a running turn as typing dots, then a diary —
 *   every step with its live count, over the element matrix.
 *
 * **2026-11-08 — stage 1b: the answer phase.** At the answer the diary folds into one line that
 * reopens, and the reply's parts land one after another, 110 ms apart at most and all in under
 * half a second (`answerFrame`) — on the very row and elements they settle in, so there is no
 * re-layout when the trace lets go. A Check's beam keeps the width it started with if the window
 * is resized under it (`planWidth`). The selected storey row is pressed and ringed by a revision
 * cloud; a consent card reads its request as a question and a detail; a bubble pops in, a card's
 * stub tears and its stamp lands — and under reduced motion each is simply there. **Every message
 * is its own memoised row** (`MessageRow`), so a keystroke or a board update renders none of them
 * again.
 *
 * The window's new look is classes in `styles/vee.css` under `.vm`, from the prototype's values.
 */
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  answerFrame,
  hasTrace,
  MATRIX_BAND,
  planWidth,
  traceCues,
  traceFrame,
  traceNextCue,
  traceSend,
  type AnswerFrame,
  type SendFrame,
  type Timeline,
  type TraceFrame,
  type WidthHold
} from '../ai/trace'
import { onTrace, traceNow, traceState } from '../ai/trace-store'
import { parseBlocks } from '../ai/blocks'
import { partsOf as messageParts, quoteOfPart, type Part } from '../ai/parts'
import { countText, nounFor } from '../ai/trace-facts'
import type { DisplayUnit } from '../../shared/units'
import type { VeeMessage } from '../../shared/vee-messages'
import {
  ASSISTANT,
  boardLine,
  chipsFolded,
  chipsStarted,
  consentText,
  dayLabel,
  endLine,
  hhmm,
  notReadyLine,
  plainOf,
  presenceOf,
  replyStrip,
  sendClick,
  veeStateOf,
  viewRow
} from '../state/selectors/chat'
import { el } from '../dom'
import { focusComposer, post } from '../vee/link'
import { useVee } from '../vee/store'
import { s } from './css'
import { Cross } from './icons'
import { BlockView, Diary, kickTrace, onTraceFrame, paintMatrix, reducedMotion } from './Trace'
import { Vee } from './Vee'
import { cloudPath } from './vee-cloud'
import {
  BoardEye,
  BoardEyeOff,
  Crosshair,
  DownArrow,
  NoSignal,
  ReplyHook,
  RevertHook,
  SendUp,
  StopCross,
  TickOne,
  TickTwo
} from './VeeIcons'
import { VEE_AVATAR, VEE_FACE, VEE_OFFSET, veeLabelOffset, type VeeState } from './vee-grid'

/** `:495` — the empty state, one string so it diffs against the design's own line. */
const EMPTY_COPY =
  'Ask what you want to see or what you want to know — filter, isolate, section, quantities, audits, interference checks. Review only: SGVue never writes to your model.'

/** `:2051`'s suggestion pill, verbatim — shared by the suggestions and the fold chip. */
const CHIP_STYLE =
  'font:400 10.5px/1 var(--mono);color:var(--muted);padding:5px 8px;border:1px solid var(--border);border-radius:999px'

/**
 * 2026-09-24 — the owner: *"The ASK SGVUE AI suggestion are great but take up too many
 * space."*, then *"one line + hide after start"*. The design's `flex-wrap:wrap` row is one
 * line that scrolls sideways — scrollbar hidden, a soft fade on the right edge while more is
 * off it, and a vertical wheel turned into a horizontal scroll. Once the conversation has a
 * user turn the row folds behind one `suggestions` chip in the same pill; picking a
 * suggestion fills the composer and folds it again. What is suggested is unchanged.
 */
function SuggestRow({ items, onPick }: { items: string[]; onPick: (t: string) => void }): React.JSX.Element {
  const st = useVee()
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
          onClick={() => post({ type: 'suggestOpen', open: folded })}
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
  sprite: HTMLElement | null
  /** Typing dots: in the reply being written, until Read. */
  dots: HTMLElement | null
  /** The diary, its live header, its folded line, and its body — the steps and the matrix. */
  diary: HTMLElement | null
  thinking: HTMLElement | null
  elapsed: HTMLElement | null
  sum: HTMLElement | null
  body: HTMLElement | null
  steps: {
    li: HTMLElement
    label: HTMLElement
    mono: HTMLElement
    count: HTMLElement
    num: HTMLElement
    unit: HTMLElement
  }[]
  canvas: HTMLCanvasElement | null
  /** The answer's parts — its bubbles, its cards and its foot — in the order they land. */
  lands: HTMLElement[]
  /** The user's row above it. */
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
  const diary = part(row, 'diary')
  const parts: Parts = {
    log,
    row,
    sprite: part(row, 'sprite'),
    dots: part(row, 'dots'),
    diary,
    thinking: part(diary, 'thinking'),
    elapsed: part(diary, 'elapsed'),
    sum: part(diary, 'diary-sum'),
    body: part(diary, 'diary-body'),
    steps: [...(diary?.querySelectorAll<HTMLElement>('[data-part="step"]') ?? [])].map((li) => ({
      li,
      label: part(li, 'step-label')!,
      mono: part(li, 'step-mono')!,
      count: part(li, 'step-count')!,
      num: part(li, 'step-num')!,
      unit: part(li, 'step-unit')!
    })),
    canvas: diary?.querySelector('canvas') ?? null,
    lands: [...(row?.querySelectorAll<HTMLElement>('[data-land]') ?? [])],
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
    parts.sprite, parts.dots, parts.diary, parts.sum, parts.body, ...parts.steps.map((t) => t.li), ...parts.lands,
    parts.youBubble, parts.arrow, parts.stop
  ]) {
    if (node && node.style.transitionProperty !== 'none') node.style.transitionProperty = 'none'
  }
  return parts
}

/**
 * Take off a row everything the trace wrote on it. The trace has let go of it — its answer has
 * settled, the next turn began, or the turn failed — and what it leaves has to be that row's end
 * state, which is simply the row as React laid it out: every part in, the diary as its own
 * classes have it, nothing held part of the way.
 */
function releaseParts(n: Parts): void {
  for (const node of [n.sprite, n.diary, n.sum, n.body, ...n.lands, n.youBubble]) {
    if (!node) continue
    node.style.opacity = ''
    node.style.transform = ''
  }
  for (const node of [n.diary, n.body]) {
    if (!node) continue
    node.style.display = ''
    node.style.height = ''
    node.style.overflow = ''
  }
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

/**
 * A user's bubble's line height, in px (13 px at 1.42, `styles/vee.css`): the lift starts from the
 * composer's middle, on the line it will have in its bubble.
 */
const BUBBLE_LINE = 13 * 1.42
/** From the composer's edge to its text: its 1 px border and 11 px of padding. */
const INPUT_INSET = 12

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
  const bubble = f ? f.bubble : 1
  /**
   * The user's bubble comes in a little small, about the middle of its edge on the window's side —
   * its right edge since 2026-11-08, when `You` moved to the right.
   */
  const scale = 0.94 + 0.06 * bubble
  if (n.youBubble) {
    n.youBubble.style.opacity = alpha(bubble)
    n.youBubble.style.transform = bubble >= 1 ? '' : `scale(${scale})`
    n.youBubble.style.transformOrigin = bubble >= 1 ? '' : '100% 50%'
  }
  // The typed line: out of the composer and up to its bubble — since 2026-11-08 on a slant, from
  // the composer's left to the bubble on the right.
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
      // The composer's text is centred in it; it starts its border and padding in from its edge.
      const fromTop = from.top + from.height / 2 - BUBBLE_LINE / 2
      setText(n.lift, n.youText!.textContent ?? '')
      n.lift.style.display = 'block'
      n.lift.style.width = px(to.width)
      // (Measured from the panel's edge: since 2026-11-07 the window is the panel, with no border.)
      n.lift.style.left = px(to.left + (from.left + INPUT_INSET - to.left) * (1 - f!.lift) - origin.left)
      n.lift.style.top = px(fromTop + (to.top - fromTop) * f!.lift - origin.top)
    }
  }
}

/** The diary's body's height before its fold, measured once per element. */
const unfolded = new WeakMap<HTMLElement, number>()

/**
 * The fold, at the answer: the diary's steps and matrix close up over `FOLD_S` while its one line
 * comes in. The row is already laid out folded — its classes say so — so the body is held open
 * here and let go once the fold is over; nothing else of the row moves but what is under it.
 */
function applyFold(n: Parts, a: AnswerFrame, answered: boolean): void {
  if (!n.body) return
  const folding = answered && a.fold < 1 && !!n.sum && !n.diary?.classList.contains('vm-open')
  if (!folding) {
    n.body.style.display = ''
    n.body.style.height = ''
    n.body.style.overflow = ''
    n.body.style.opacity = ''
    if (n.sum) n.sum.style.opacity = ''
    return
  }
  let h = unfolded.get(n.body)
  if (h === undefined) {
    n.body.style.display = 'block'
    n.body.style.height = ''
    h = n.body.offsetHeight
    unfolded.set(n.body, h)
  }
  n.body.style.display = 'block'
  n.body.style.overflow = 'hidden'
  n.body.style.height = px(h * (1 - a.fold))
  n.body.style.opacity = alpha(1 - a.fold)
  if (n.sum) n.sum.style.opacity = alpha(a.fold)
}

/** The reply's parts, each landing: its opacity and how far below its place it stands. */
function applyLands(n: Parts, a: AnswerFrame): void {
  n.lands.forEach((node, k) => {
    const q = a.parts[k] ?? { opacity: 1, y: 0 }
    node.style.opacity = alpha(q.opacity)
    node.style.transform = q.y ? `translateY(${px(q.y)})` : ''
  })
}

/** The diary while the turn runs — its header, its steps and its matrix — and Vee and the dots. */
function applyFrame(n: Parts, f: TraceFrame, dpr: number): void {
  if (n.sprite) {
    n.sprite.style.opacity = alpha(f.sprite.opacity)
    n.sprite.style.transform = f.sprite.scale === 1 ? '' : `scale(${Math.round(f.sprite.scale * 1000) / 1000})`
  }
  if (n.dots) n.dots.style.display = f.dots ? '' : 'none'
  if (n.diary && !n.sum) {
    // Running: the diary opens at Read.
    n.diary.style.display = f.bubble.opacity > 0 ? '' : 'none'
    n.diary.style.opacity = alpha(f.bubble.opacity)
  }
  if (n.thinking) {
    // The shimmer: a highlight a third of the text wide, sweeping left to right every 1.6 s.
    n.thinking.style.backgroundPosition = `${f.thinking.shimmer === null ? 100 : Math.round((100 - f.thinking.shimmer * 100) * 10) / 10}% 0`
  }
  if (n.elapsed) setText(n.elapsed, `${f.thinking.seconds}s`)
  n.steps.forEach((slot, k) => {
    const step = f.steps[k]
    if (!step) {
      slot.li.style.display = 'none'
      return
    }
    slot.li.style.display = ''
    slot.li.classList.toggle('vm-ok', step.done)
    slot.li.style.opacity = alpha(step.opacity)
    slot.li.style.transform = step.y ? `translateY(${px(step.y)})` : ''
    setText(slot.label, step.label)
    setText(slot.mono, step.mono)
    // Nothing in the mono face: no piece for the line's gap to stand beside.
    slot.mono.style.display = step.mono ? '' : 'none'
    slot.count.style.display = step.count ? '' : 'none'
    if (step.count) {
      setText(slot.num, step.count.text)
      setText(slot.unit, step.count.unit)
      slot.num.classList.toggle('vm-hit', step.count.accent)
    }
  })
  const width = n.canvas?.parentElement?.clientWidth ?? 0
  if (n.canvas && width > 0) {
    paintMatrix(n.canvas, width, MATRIX_BAND.height, f.cells, f.beam, dpr, { x: 0, y: MATRIX_BAND.top })
  }
}

/* ────────────────────────────── a message ────────────────────────────── */

/** A running turn with no trace to draw: everything of the send at rest, the button a stop. */
const STOP_ONLY: SendFrame = { lift: 1, press: 1, bubble: 1, you: 1, placeholder: 1, busy: 1, settled: true }

/** The composer's placeholder: the design's, and none while the composer cannot be used. */
const PLACEHOLDER = 'How many doors on L2?'

/** How long the table card's `copied` flash stays: the design's `copy csv` has none; the prototype's 1 400 ms. */
const COPY_FLASH_MS = 1400

/** A consent card's stub tears away for this long once answered (the prototype's `tear`). */
const TEAR_MS = 420

/** The composer's text, typed here and kept in step with the main window's `chatInput`. */
const setInput = (text: string): void => {
  useVee.setState({ chatInput: text })
  post({ type: 'input', text })
}

/**
 * A message's blocks and parts, worked out once per message object: a snapshot keeps the object
 * of every message that did not change (`vee/store.ts`), and the window renders again at every
 * keystroke in the composer.
 */
const blockCache = new WeakMap<VeeMessage, ReturnType<typeof parseBlocks>>()
const partCache = new WeakMap<VeeMessage, Part[]>()
const blocksOf = (m: VeeMessage): ReturnType<typeof parseBlocks> => {
  let b = blockCache.get(m)
  if (!b) blockCache.set(m, (b = parseBlocks(m.text)))
  return b
}
const partsOfMessage = (m: VeeMessage): Part[] => {
  let p = partCache.get(m)
  if (!p) partCache.set(m, (p = messageParts(m)))
  return p
}

/** A stamp's words: the outcome in capitals and, but for a cancel, when. */
export function stampText(settled: NonNullable<VeeMessage['settled']>): string {
  return settled.how === 'cancelled' ? 'CANCELLED' : `${settled.how.toUpperCase()} · ${hhmm(settled.at)}`
}

/** The newest of Vee's rows — the one whose avatar moves: `'nr'` for the not-ready line, else an index. */
export function newestVee(msgs: readonly Pick<VeeMessage, 'role'>[], live: boolean, notReady: boolean): number | 'nr' | null {
  if (notReady) return 'nr'
  if (live) return msgs.length
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') return i
  return null
}

/**
 * The not-ready line under the thread — unless the newest message already is it (Vee's answer
 * to a question asked with no model open), so it is not said twice in a row.
 */
export function shownNotReady(msgs: readonly Pick<VeeMessage, 'role' | 'text'>[], line: string | null): string | null {
  const last = msgs[msgs.length - 1]
  return line !== null && last?.role === 'assistant' && last.text === line ? null : line
}

/** What the polite live region says: a turn is running, else the newest reply of Vee's, once. */
export function announcement(msgs: readonly Pick<VeeMessage, 'role' | 'text'>[], busy: boolean): string {
  if (busy) return `${ASSISTANT} is working on it.`
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') return plainOf(msgs[i])
  return ''
}

/**
 * 2026-11-08 (stage 1b) — whether a storey row is the one the 3D view has selected, as the board
 * says it: exactly its count of elements, all on its storey.
 */
export const rowPressed = (row: { label: string; n: number }, storey: string | null, selected: number): boolean =>
  storey !== null && row.label === storey && row.n === selected

/** The hover bar of a bubble or a card: `reply`, quoting just that one. */
function ReplyBar({ onReply }: { onReply: () => void }): React.JSX.Element {
  return (
    <div className="vm-rx">
      <button type="button" title="Reply" aria-label="Reply" onClick={onReply}>
        <ReplyHook />
      </button>
    </div>
  )
}

/**
 * The revision cloud around the selected storey row (the prototype's): measured from the row it
 * stands in, and drawn again whenever that row's box changes — a resize of the window included.
 */
function Cloud(): React.JSX.Element {
  const ref = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const host = ref.current?.parentElement
    if (!host) return
    const measure = (): void => {
      const w = host.offsetWidth
      const h = host.offsetHeight
      setBox((b) => (b && b.w === w && b.h === h ? b : { w, h }))
    }
    measure()
    const sized = new ResizeObserver(measure)
    sized.observe(host)
    return () => sized.disconnect()
  }, [])
  const d = box && box.w > 8 && box.h > 8 ? cloudPath(box.w - 8, box.h - 8, 3.4) : ''
  return (
    <svg ref={ref} className="vm-cloud" aria-hidden="true" width={box?.w ?? 0} height={box?.h ?? 0}>
      {d ? <path transform="translate(4 4)" pathLength={1} d={d} /> : null}
    </svg>
  )
}

/** Where an act on a message is sent: its place, and the identity the snapshot gave it. */
type At = { index: number; msg: number }

/** What lands at the answer, while the trace draws the row; and what pops in, on a fresh one. */
type Entry = { land: boolean; pop: boolean }

const landAttr = (e: Entry): { 'data-land'?: '' } => (e.land ? { 'data-land': '' } : {})
const popClass = (e: Entry, base: string): string => (e.pop ? `${base} vm-in` : base)

/**
 * The consent card (the pending row, taped): the request as a question and a detail, `Cancel`
 * and a confirm button that names the action; once answered, its stub tears away and a stamp
 * lands, with the reply's one `Revert` on it. It takes no focus by itself.
 */
function Consent({ message, canRevert, at, entry }: { message: VeeMessage; canRevert: boolean; at: At; entry: Entry }): React.JSX.Element {
  const settled = message.settled
  const label = message.pending ? message.pending.label : (settled?.label ?? '')
  const { q, detail } = consentText(label)
  /** The stub tearing away (its verb), and whether the stamp lands — only for a card answered while it is shown. */
  const [tearing, setTearing] = useState<string | null>(null)
  const [stamped, setStamped] = useState(false)
  const was = useRef(message.pending)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useLayoutEffect(() => {
    const before = was.current
    was.current = message.pending
    if (!before || message.pending) return
    setStamped(true)
    if (reducedMotion()) return
    setTearing(before.verb ?? 'Apply')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setTearing(null), TEAR_MS)
  }, [message.pending])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const answered = !message.pending
  return (
    <div
      data-role="consent"
      {...landAttr(entry)}
      className={popClass(entry, answered ? 'vm-card vm-pm vm-settled' : 'vm-card vm-pm')}
    >
      <div className="vm-tape" aria-hidden="true" />
      <div className="vm-pm-body">
        <span className="vm-hole" aria-hidden="true" />
        <div className="vm-pm-q">{q}</div>
        {detail ? <div className="vm-pm-sub">{detail}</div> : null}
      </div>
      <div className="vm-perf" aria-hidden="true" />
      {message.pending ? (
        <div className="vm-stub">
          <button type="button" className="vm-no" onClick={() => post({ type: 'cancel', ...at, pending: message.pending!.id })}>
            Cancel
          </button>
          <button
            type="button"
            className="vm-go"
            // The user's click on the confirm button, for the request this card shows — and nothing else.
            onClick={() => post({ type: 'apply', ...at!, pending: message!.pending!.id })}
          >
            {message.pending.verb ?? 'Apply'}
          </button>
        </div>
      ) : tearing !== null ? (
        <div className="vm-stub vm-tear" aria-hidden="true">
          <button type="button" className="vm-no" disabled tabIndex={-1}>
            Cancel
          </button>
          <button type="button" className="vm-go" disabled tabIndex={-1}>
            {tearing}
          </button>
        </div>
      ) : (
        <div className="vm-done">
          {message.reverted ? (
            <span className={stamped ? 'vm-stamp vm-muted vm-land' : 'vm-stamp vm-muted'}>
              REVERTED{message.revertedAt !== undefined ? ` · ${hhmm(message.revertedAt)}` : ''}
            </span>
          ) : settled ? (
            <span className={`vm-stamp${settled.how === 'cancelled' ? ' vm-muted' : ''}${stamped ? ' vm-land' : ''}`}>{stampText(settled)}</span>
          ) : null}
          {canRevert ? (
            <button type="button" className="vm-rv" title="Undo just this reply" onClick={() => post({ type: 'revert', ...at })}>
              <RevertHook />
              Revert
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

export interface RowProps {
  /** The message, or `null` for the reply being written. */
  message: VeeMessage | null
  index: number
  units: DisplayUnit
  /** Vee's state in front of this row, and whether its avatar holds a still frame. */
  state: VeeState
  still: boolean
  /** The trace's painter draws this row: while its turn runs, and until its answer has settled. */
  owned: boolean
  /** The reply being written: whether its diary is up, and how many steps it has so far. */
  diary: boolean
  slots: number
  /** The answered turn's timeline, while it is this reply's: its diary reopens to the final matrix. */
  timeline: Timeline | null
  /** The 3D view's selection, as the board says it — only to a reply with storey rows. */
  selStorey: string | null
  selCount: number
  /** The table card's `copy csv` flash — only to the reply it was clicked on. */
  copied: 'ok' | 'fail' | null
  /** A message that arrived while the window was open: it pops in (unless the trace lands it). */
  fresh: boolean
}

/**
 * One row of the transcript — 2026-11-08 (stage 1b): its own memoised component, so that a
 * keystroke, a board update or another message changing renders none of the rows that did not
 * change. Every act is one intent, sent from here.
 */
export const MessageRow = memo(function MessageRow(props: RowProps): React.JSX.Element {
  const { message, index: i, owned, state, still } = props

  /** A reply on part `k` of this message: the main window keeps which, and quotes it when it sends. */
  const replyOn = (at: At, k: number): void => {
    post({ type: 'reply', ...at, part: k })
    focusComposer()
  }

  /** The avatar at the foot of a group of Vee's: only the newest moves. */
  const avatar = (
    <span className="vm-av" data-part="sprite">
      <Vee slot={VEE_AVATAR.slot} margin="0px" mult={VEE_AVATAR.mult} offset={veeLabelOffset(i)} state={state} still={still} />
    </span>
  )

  if (message?.role === 'user') {
    return (
      <div data-row={i} data-mine="" className="vm-grp vm-me">
        <div className="vm-stack">
          <span data-part="bubble" className={props.fresh ? 'vm-b vm-b-me vm-in' : 'vm-b vm-b-me'}>
            {message.quote ? (
              <span className="vm-q">
                <i>{message.quote.who}</i>
                {message.quote.text}
              </span>
            ) : null}
            <span data-part="text">{message.text}</span>
            {message.at !== undefined ? (
              <span className="vm-t">
                {hhmm(message.at)}
                <span className={message.seen ? 'vm-tk vm-read' : 'vm-tk'} aria-label={message.seen ? 'Picked up' : 'Sent'} role="img">
                  {message.seen ? <TickTwo /> : <TickOne />}
                </span>
              </span>
            ) : null}
          </span>
        </div>
      </div>
    )
  }

  if (!message) {
    // The reply being written: the diary once a tool has started, typing dots until Read. Not read
    // out — the live region says Vee is working.
    return (
      <div data-row={i} aria-hidden="true" className="vm-grp vm-vee">
        {avatar}
        <div className="vm-stack">
          {props.diary ? <Diary fold={null} steps={NO_STEPS} slots={props.slots} timeline={null} owned /> : null}
          <span data-part="dots" className="vm-b vm-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    )
  }

  const m = viewRow(message, i, props.units)
  const at: At = { index: i, msg: message.id }
  /** The trace lands a turn's parts; a message no turn wrote pops in when it arrives. */
  const entry: Entry = { land: owned, pop: props.fresh && !owned && !message.trace }
  const trace = message.trace
  const list = partsOfMessage(message)
  const hasCard = list.some((p) => p.kind === 'consent')

  const piece = (p: Part, k: number): React.JSX.Element | null => {
    if (p.kind === 'text') {
      const block = blocksOf(message)[p.block]
      if (!block) return null
      return (
        <div key={k} {...landAttr(entry)} className={popClass(entry, message.reverted ? 'vm-b vm-tx vm-reverted' : 'vm-b vm-tx')} tabIndex={0}>
          <BlockView block={block} />
          {p.lead && message.at !== undefined ? <span className="vm-t">{hhmm(message.at)}</span> : null}
          <ReplyBar onReply={() => replyOn(at, k)} />
        </div>
      )
    }
    if (p.kind === 'chips') {
      return (
        <div
          key={k}
          {...landAttr(entry)}
          className={entry.pop ? 'vm-in' : undefined}
          style={s('display:flex;flex-wrap:wrap;gap:5px;align-self:stretch;margin-top:1px')}
        >
          {message.chips.map((c, j) => (
            <button
              key={`${c.label}-${j}`}
              onClick={() => post({ type: 'pick', ...at, what: 'chip', j, zoom: false })}
              onDoubleClick={() => post({ type: 'pick', ...at, what: 'chip', j, zoom: true })}
              data-tip="Click to select · double-click to zoom"
              style={s(
                'font:500 10.5px/1 var(--mono);color:var(--sel-ink);background:var(--sel-bg);border:1px solid var(--accent);border-radius:999px;padding:5px 9px;white-space:nowrap'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )
    }
    if (p.kind === 'rows' && trace) {
      const noun = trace.noun
      const total = trace.rows.reduce((a, r) => a + r.n, 0)
      return (
        <div key={k} {...landAttr(entry)} data-role="storey-rows" className={popClass(entry, 'vm-card vm-tx')} tabIndex={0}>
          <div className="vm-sn-hd">
            <span className="vm-hole" aria-hidden="true" />
            {/* The property the turn checked, when it checked one (stage 1b); else what the rows count. */}
            <span>{trace.title ?? `${nounFor(2, noun)} · by storey`}</span>
            <b>{countText(total)}</b>
          </div>
          <div className="vm-sn-rows">
            {trace.rows.map((r, j) => {
              const pressed = rowPressed(r, props.selStorey, props.selCount)
              return (
                <button
                  key={j}
                  type="button"
                  className="vm-sn-row"
                  title="Select in 3D"
                  aria-pressed={pressed}
                  onClick={() => post({ type: 'pick', ...at, what: 'row', j, zoom: false })}
                >
                  <span className="vm-lv">{r.label}</span>
                  <span className="vm-cl" aria-hidden="true">
                    {Array.from({ length: Math.min(r.n, 12) }, (_, c) => (
                      <i key={c} />
                    ))}
                  </span>
                  <span className="vm-ct">
                    <b>{countText(r.n)}</b> {nounFor(r.n, noun)}
                  </span>
                  <span className="vm-xh">
                    <Crosshair />
                  </span>
                  {pressed ? <Cloud /> : null}
                </button>
              )
            })}
          </div>
          <ReplyBar onReply={() => replyOn(at, k)} />
        </div>
      )
    }
    if (p.kind === 'table' && message.table) {
      const total = message.table.rows.reduce((a, r) => a + r.n, 0)
      return (
        <div key={k} {...landAttr(entry)} data-role="chat-table" className={popClass(entry, 'vm-card vm-tx')} tabIndex={0}>
          <div className="vm-sn-hd">
            <span className="vm-hole" aria-hidden="true" />
            <span>{m.tableTitle}</span>
            <b>{countText(total)}</b>
          </div>
          <div className="vm-sn-rows">
            {m.tableRows.map((r, j) => (
              <button
                key={`${r.k}-${j}`}
                type="button"
                className="vm-sn-row vm-tb-row"
                title="Select in 3D"
                onClick={() => post({ type: 'pick', ...at, what: 'table', j, zoom: true })}
              >
                <span className="vm-lv">{r.k}</span>
                <span className="vm-qty">{r.q}</span>
                <span className="vm-ct">
                  <b>{r.n}</b>
                </span>
                <span className="vm-xh">
                  <Crosshair />
                </span>
              </button>
            ))}
          </div>
          <div className="vm-tb-ft">
            <span className={props.copied ? 'vm-fl vm-on' : 'vm-fl'} aria-live="polite">
              {props.copied === 'ok' ? 'copied' : props.copied === 'fail' ? 'couldn’t copy' : ''}
            </span>
            <button
              type="button"
              className="vm-cp"
              // `:2029`. The main window's store copies (`copyTable`), and the text is put on the
              // clipboard here, under this click (`vee/link.ts`): the design's line called the
              // clipboard API this app always refuses, and copied nothing.
              onClick={() => {
                useVee.setState({ copyFlash: { msg: message.id, ok: null, at: Date.now() } })
                post({ type: 'copyCsv', ...at })
              }}
            >
              copy csv
            </button>
          </div>
          <ReplyBar onReply={() => replyOn(at, k)} />
        </div>
      )
    }
    if (p.kind === 'consent') return <Consent key={k} message={message} canRevert={m.canRevert} at={at} entry={entry} />
    return null
  }

  return (
    <div data-row={i} className="vm-grp vm-vee">
      {avatar}
      <div className="vm-stack">
        {/* A turn that ran a tool: its diary, folded (the same element the trace drew it in). */}
        {trace?.wide ? (
          <Diary
            fold={trace.fold ?? trace.status}
            steps={trace.steps ?? NO_STEPS}
            slots={0}
            timeline={props.timeline}
            owned={owned}
          />
        ) : null}
        {list.map(piece)}
        {/* One revert a reply: on the consent card's stamp once it has one, else here. */}
        {!hasCard || message.pending ? (
          m.canRevert ? (
            <div {...landAttr(entry)} className="vm-foot">
              <button type="button" className="vm-rv" title="Undo just this reply" onClick={() => post({ type: 'revert', ...at })}>
                <RevertHook />
                Revert
              </button>
            </div>
          ) : message.reverted && !hasCard ? (
            <div className="vm-foot">
              <span>Reverted{message.revertedAt !== undefined ? ` · ${hhmm(message.revertedAt)}` : ''}</span>
            </div>
          ) : null
        ) : null}
      </div>
    </div>
  )
})

/** What every row's props are worked out from. */
export interface RowContext {
  units: DisplayUnit
  msgs: readonly VeeMessage[]
  board: { storey: string | null; selected: number } | null
  timeline: Timeline | null
  /** The transcript place the trace is about. */
  traceIndex: number
  /** Whether row `i` is the one the trace draws. */
  drawn: (i: number) => boolean
  /** The state of the mascot in front of the reply the trace draws. */
  vee: VeeState
  /** The newest of Vee's rows (`newestVee`). */
  newest: number | 'nr' | null
  /** The table card's `copy csv` flash, while it shows. */
  flash: { msg: number; ok: boolean | null } | null
  /** Whether the message at row `i` pops in — decided once per row (`freshRow`). */
  fresh: (i: number, role: VeeMessage['role']) => boolean
}

/**
 * Whether a message's row pops in (`.vm-in`) — **decided the first time the row is drawn, and
 * never again** (review of stage 1b). A row pops when it arrived while the window was open
 * (`i ≥ firstCount`) and is not the user's row the trace lifts its typed line into (`lifted`).
 * Worked out afresh at every render, the second half flipped: once the next turn began — or the
 * turn failed and left no timeline — the row that had been lifted was no longer `lifted`, gained
 * `.vm-in` and played its entrance again from nothing on a bubble long on screen. So the answer is
 * kept per row (`memo`, keyed by place and role: a failed turn's reply place can be the next
 * question's), and a row's `fresh` never changes after it is first drawn.
 */
export function freshRow(
  memo: Map<string, boolean>,
  i: number,
  role: VeeMessage['role'],
  firstCount: number,
  lifted: number
): boolean {
  const key = `${i}:${role}`
  let fresh = memo.get(key)
  if (fresh === undefined) memo.set(key, (fresh = i >= firstCount && i !== lifted))
  return fresh
}

/**
 * One row's props — 2026-11-08 (stage 1b). **Every prop is a value, or an object that changes
 * only with what it says** (the message, the timeline), and a prop a row does not use is a fixed
 * value: the selection reaches only a reply with storey rows, the flash only the reply it was
 * clicked on, the trace's own state only the row it draws. So a keystroke, a board update or
 * another message changing leaves every other row's props as they were, and `MessageRow`, being
 * `memo`, is not rendered again. Exported for the unit test that holds it to that.
 */
export function rowProps(c: RowContext, message: VeeMessage | null, i: number): RowProps {
  const owned = c.drawn(i)
  const rows = !!message?.trace?.rows.length
  const tl = c.timeline
  return {
    message,
    index: i,
    units: c.units,
    state: owned ? c.vee : veeStateOf(c.msgs, i),
    still: c.newest !== i,
    owned,
    diary: !message && !!tl && hasTrace(tl),
    slots: !message && tl ? traceCues(tl).steps.length : 0,
    timeline: message && tl && tl.answer !== null && c.traceIndex === i ? tl : null,
    // A row is pressed only for a selection on one storey, so a count alone tells a row nothing.
    selStorey: rows ? (c.board?.storey ?? null) : null,
    selCount: rows && c.board?.storey ? c.board.selected : 0,
    copied: message && c.flash && c.flash.ok !== null && c.flash.msg === message.id ? (c.flash.ok ? 'ok' : 'fail') : null,
    // The reply being written never pops: the trace draws it.
    fresh: message ? c.fresh(i, message.role) : false
  }
}

/** No steps: one array, so a memoised row is not rendered again for nothing. */
const NO_STEPS: readonly { label: string; mono: string; n: number | null; unit: string }[] = []

/* ────────────────────────────── the panel (`:430`) ────────────────────────────── */

export default function ChatPanel(): React.JSX.Element | null {
  const st = useVee()
  const trace = useSyncExternalStore(onTrace, traceState, traceState)
  const panel = useRef<HTMLDivElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const lastLen = useRef(0)
  const lastMsgs = useRef(0)
  /** The log follows its own foot while the reply grows — unless the user has scrolled up. */
  const stuck = useRef(true)
  const parts = useRef<Parts | null>(null)
  /** The state of the mascot in front of the reply the trace is drawing. */
  const [vee, setVee] = useState<VeeState>('thinking')
  const veeNow = useRef<VeeState>('thinking')
  /** When the send button last stopped a turn (`sendClick`). */
  const stoppedAt = useRef<number | null>(null)
  /** Replies of Vee's that landed while the thread was scrolled up: the `New message` pill. */
  const [unread, setUnread] = useState(0)
  /**
   * The turn (by its send time) whose reply the trace has let go of: its answer has settled, and
   * the row is drawn by React alone — the same row, so nothing moves when it does.
   */
  const [released, setReleased] = useState<number | null>(null)
  const releasedRef = useRef<number | null>(null)
  /** The width the running turn's matrix is planned for (`planWidth`), by its send time. */
  const hold = useRef<{ send: number; at: WidthHold } | null>(null)
  /** How many messages there were when the window first drew: the ones after it pop in. */
  const firstCount = useRef<number | null>(null)
  /** Each row's pop, decided once (`freshRow`), and the transcript length it was decided for. */
  const freshMemo = useRef(new Map<string, boolean>())
  const freshLen = useRef(0)
  /** The table card's `copied` flash is shown until this time. */
  const [, setTick] = useState(0)

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
  /** Whether the trace still draws its reply (it has not let go of it). */
  const owning = timeline !== null && released !== timeline.send
  /** Whether row `i` is the one the trace draws. */
  const drawn = (i: number): boolean => owning && trace.index === i && i < count

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
    if (owning && n.row) {
      const dpr = window.devicePixelRatio || 1
      const answered = timeline.answer !== null && T >= timeline.answer
      const ans = answerFrame(timeline, T, n.lands.length, { dpr, reduced })
      applyFold(n, ans, answered)
      // The width the matrix is planned for: the canvas's, but held while a Check's beam runs.
      const measured = n.canvas?.parentElement?.clientWidth ?? 0
      const was = hold.current && hold.current.send === timeline.send ? hold.current.at : null
      const at = planWidth(timeline, T, measured > 0 ? measured : (was?.width ?? 0), was)
      hold.current = { send: timeline.send, at }
      const shown = traceFrame(timeline, T, { width: at.width, dpr, textH: 0, reduced })
      applyFrame(n, shown, dpr)
      applyLands(n, ans)
      if (veeNow.current !== shown.sprite.state) {
        veeNow.current = shown.sprite.state
        setVee(shown.sprite.state)
      }
      settled = settled && ans.settled
    }
    if (stuck.current) n.log.scrollTop = n.log.scrollHeight
    n.log.toggleAttribute('data-moving', !settled)
    // The answer is in and nothing moves any more: React alone draws the row from here.
    if (settled && timeline.answer !== null && releasedRef.current !== timeline.send) {
      releasedRef.current = timeline.send
      if (n.row) releaseParts(n)
      setReleased(timeline.send)
    }
    if (settled) return false
    if (!reduced) return true
    // With no motion to draw there is nothing to do until the turn's next cue — or, while it
    // runs, the next whole second of the diary's clock, which is a count and not motion.
    const cue = traceNextCue(timeline, T)
    const second = timeline.answer === null ? timeline.send + Math.floor(T - timeline.send) + 1 : null
    return cue === null ? (second ?? false) : second === null ? cue : Math.min(cue, second)
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
  // moved on — keep the log at its foot when a row was added (`:879`) unless the user has
  // scrolled up (then count the reply that landed for the pill), and draw the trace's frame
  // before the browser paints what React has laid out.
  useLayoutEffect(() => {
    const next = partsOf(panel.current, trace.index)
    const was = parts.current
    if (was && (was.row !== next.row || was.youBubble !== next.youBubble)) releaseParts(was)
    parts.current = next
    const node = log.current
    const msgs = st.chatMsgs.length
    if (node && msgs !== lastMsgs.current) {
      const added = msgs - lastMsgs.current
      lastMsgs.current = msgs
      // The user's own message, or a transcript replaced: back to the foot.
      if (added < 0 || st.chatMsgs[msgs - 1]?.role === 'user') stuck.current = true
      if (stuck.current) {
        node.scrollTop = node.scrollHeight
        if (unread) setUnread(0)
      } else setUnread((u) => u + added)
    }
    if (node && count !== lastLen.current) {
      lastLen.current = count
      if (stuck.current) node.scrollTop = node.scrollHeight
    }
    painter.current(traceNow(), reducedMotion())
    kickTrace()
  })

  // The reply strip's line: the bubble replied to, or a whole message, flattened into plain text —
  // once when the transcript or the target changes, never again at every keystroke.
  const reply = useMemo(() => {
    const strip = replyStrip(st.chatMsgs, st.chatReplyTo)
    const target = st.chatReplyTo == null ? undefined : st.chatMsgs[st.chatReplyTo]
    const one = target && st.chatReplyPart != null ? quoteOfPart(target, st.chatReplyPart) : null
    return one === null ? strip : { ...strip, text: one }
  }, [st.chatMsgs, st.chatReplyTo, st.chatReplyPart])

  // Opening the window gives its composer the keyboard.
  useEffect(() => {
    if (st.ready) focusComposer(true)
  }, [st.ready])

  // The table card's flash goes out after its time.
  const flash = st.copyFlash
  useEffect(() => {
    if (!flash || flash.ok === null) return
    const t = setTimeout(() => setTick((k) => k + 1), Math.max(0, flash.at + COPY_FLASH_MS - Date.now()))
    return () => clearTimeout(t)
  }, [flash])

  if (!st.ready) return null
  firstCount.current ??= st.chatMsgs.length
  // A transcript replaced by a shorter one — a new conversation: its rows are new rows.
  if (st.chatMsgs.length < freshLen.current) {
    freshMemo.current.clear()
    firstCount.current = st.chatMsgs.length
  }
  freshLen.current = st.chatMsgs.length

  const notReady = shownNotReady(st.chatMsgs, notReadyLine(st.hasKey, st.hasModel))
  const noKey = st.hasKey === false
  const presence = presenceOf({ hasKey: st.hasKey, busy: st.chatBusy, toolRan: !!timeline && timeline.tool !== null, end: st.chatEnd })
  const newest = newestVee(st.chatMsgs, live, notReady !== null)
  const hideSuggest = notReadyLine(st.hasKey, st.hasModel) !== null
  const now = Date.now()
  const flashOn = flash && flash.ok !== null && now < flash.at + COPY_FLASH_MS ? flash : null
  /** The user's row the trace lifts the typed line into: it does not also pop. */
  const lifted = timeline ? trace.index - 1 : -1

  /** `:2013` — Enter sends, Shift+Enter does not. During a turn the main window's `sendChat` does nothing. */
  const onChatKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      post({ type: 'send', text: st.chatInput })
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
      post({ type: 'stop' })
    } else if (act === 'send') post({ type: 'send', text: st.chatInput })
  }

  const ctx: RowContext = {
    units: st.units,
    msgs: st.chatMsgs,
    board: st.board,
    timeline,
    traceIndex: trace.index,
    drawn,
    vee,
    newest,
    flash: flashOn,
    fresh: (i, role) => freshRow(freshMemo.current, i, role, firstCount.current ?? 0, lifted)
  }
  const row = (message: VeeMessage | null, i: number): React.JSX.Element => (
    <MessageRow key={i} {...rowProps(ctx, message, i)} />
  )

  /** The thread: a day separator over each day's first message, and every row. */
  const thread: React.JSX.Element[] = []
  let day = ''
  st.chatMsgs.forEach((message, i) => {
    if (message.at !== undefined) {
      const label = dayLabel(message.at, now)
      if (label !== day) {
        day = label
        thread.push(
          <div key={`day-${i}`} className="vm-day">
            {label}
          </div>
        )
      }
    }
    thread.push(row(message, i))
  })
  // One keyed list: the reply being written has the key its message will have, so the row that
  // commits is the row that was live — the same element, and nothing in it starts again.
  if (live) thread.push(row(null, st.chatMsgs.length))

  const end = st.chatEnd ? endLine(st.chatEnd) : null
  const board = st.hasModel === false ? null : st.board
  const line = board ? boardLine(board) : null

  return (
    <div ref={panel} className="vm">
      <header className="vm-hd">
        <span className="vm-face">
          <Vee
            slot={VEE_FACE.slot}
            margin="0px"
            mult={VEE_FACE.mult}
            offset={VEE_OFFSET.header}
            state={st.chatBusy ? (live ? vee : 'thinking') : 'idle'}
          />
        </span>
        <div className="vm-who">
          <span className="vm-nm" id="sgvue-chat-title">
            {ASSISTANT}
          </span>
          <span data-role="vee-presence" className={`vm-pr vm-${presence.mode}`}>
            <i aria-hidden="true" />
            <span>{presence.word}</span>
          </span>
        </div>
        <span className={st.chatBusy ? 'vm-sq vm-on' : 'vm-sq'} aria-hidden="true">
          <b />
          <b />
          <b />
        </span>
      </header>

      {board && line ? (
        <div data-role="vee-board" className={line.iso ? 'vm-board vm-iso' : 'vm-board'} title="What the 3D view shows now">
          {line.iso ? <BoardEyeOff /> : <BoardEye />}
          <span className="vm-board-txt">
            {line.lead.before ? null : 'All '}
            <b>{line.lead.strong}</b>
            {line.lead.text}
            {line.sel ? (
              <>
                {' · '}
                <em>{line.sel}</em>
              </>
            ) : null}
            {line.rest.map((r, k) => (
              <Fragment key={k}>
                {' · '}
                {r}
              </Fragment>
            ))}
          </span>
          {board.view ? <span className="vm-vw">{board.view}</span> : null}
        </div>
      ) : null}

      <div className="vm-tw">
        <div
          data-role="chatlog"
          ref={log}
          role="log"
          // Each new reply is said once, by the live region below — not every bubble and card.
          aria-live="off"
          aria-labelledby="sgvue-chat-title"
          onScroll={(e) => {
            const node = e.currentTarget
            stuck.current = node.scrollHeight - node.scrollTop - node.clientHeight < 2
            if (stuck.current && unread) setUnread(0)
          }}
          className="vm-thread"
        >
          {thread}

          {notReady !== null ? (
            <div key="nr" data-role="vee-not-ready" className="vm-grp vm-vee">
              <span className="vm-av" data-part="sprite">
                <Vee
                  slot={VEE_AVATAR.slot}
                  margin="0px"
                  mult={VEE_AVATAR.mult}
                  offset={veeLabelOffset(st.chatMsgs.length)}
                  state="idle"
                  still={newest !== 'nr'}
                />
              </span>
              <div className="vm-stack">
                <div className="vm-b">{notReady}</div>
              </div>
            </div>
          ) : st.chatMsgs.length === 0 && !hideSuggest ? (
            <span style={s('font:400 12px/1.55 var(--sans);color:var(--faint);text-wrap:pretty')}>{EMPTY_COPY}</span>
          ) : null}

          {end && st.chatEnd ? (
            <div data-role="vee-system" className="vm-sys" title={st.chatEnd.message || undefined}>
              {st.chatEnd.kind === 'stopped' ? <StopCross /> : <NoSignal />}
              <span>{end.text}</span>
              {end.retry && !st.chatBusy ? (
                <button type="button" className="vm-again" onClick={() => post({ type: 'retry' })}>
                  Try again
                </button>
              ) : null}
            </div>
          ) : null}
          {st.chatErr && st.chatErr !== st.chatEnd?.message ? (
            <div data-role="vee-system" className="vm-sys">
              <span>{st.chatErr}</span>
            </div>
          ) : null}
        </div>
        {unread > 0 ? (
          <button
            type="button"
            className="vm-newpill"
            onClick={() => {
              stuck.current = true
              setUnread(0)
              if (log.current) log.current.scrollTop = log.current.scrollHeight
            }}
          >
            <DownArrow />
            <span>{unread === 1 ? 'New message' : `${unread} new messages`}</span>
          </button>
        ) : null}
      </div>

      {/* What a screen reader hears: that a turn is running, then each new reply of Vee's, once. */}
      <span className="sr-only" aria-live="polite" data-role="vee-announce">
        {announcement(st.chatMsgs, st.chatBusy)}
      </span>

      <div className="vm-dock">
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
              onClick={() => post({ type: 'unreply' })}
              title="Cancel reply"
              aria-label="Cancel reply"
              className="hv-card-ink"
              style={s(
                'flex:none;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:5px;color:var(--faint)'
              )}
            >
              <Cross size={10} weight={2.2} />
            </button>
          </div>
        ) : null}

        {!hideSuggest ? (
          <SuggestRow
            items={st.suggestions}
            onPick={(t) => {
              useVee.setState({ chatInput: t })
              post({ type: 'suggest', text: t })
            }}
          />
        ) : null}

        <div className="vm-cmp">
          <input
            data-role="chatinput"
            type="text"
            value={st.chatInput}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onChatKey}
            aria-label="Message Vee"
            // Not ready for want of a key: the composer is there but cannot be used, and says
            // nothing itself — the line above says what to do.
            disabled={noKey}
            placeholder={noKey ? '' : PLACEHOLDER}
          />
          {/* While a turn runs the same button stops it: its arrow cross-fades to a stop square. */}
          <button
            type="button"
            data-part="send"
            onClick={onSendClick}
            data-tip={st.chatBusy ? 'Stop' : 'Send (Enter)'}
            aria-label={st.chatBusy ? 'Stop' : 'Send (Enter)'}
            disabled={noKey}
            className="vm-key hv-accent-ground"
          >
            <span data-part="send-arrow" style={s('display:flex')}>
              <SendUp />
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
            'position:absolute;display:none;font:400 13px/1.42 var(--sans);color:var(--ink);text-wrap:pretty'
          )}
        />
      </div>
    </div>
  )
}
