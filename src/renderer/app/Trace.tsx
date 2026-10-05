/**
 * The thinking trace — its view (2026-10-01, the owner's "Ask Vee" handoff,
 * `design-reference/ask-vee/`). What is shown at any instant is `traceFrame` (`ai/trace.ts`),
 * which is pure; this is the thin part that needs a document: the frame loop, the canvas the
 * matrix is drawn on, and the markup of a turn's reply.
 *
 * **The loop** is one `requestAnimationFrame` chain for everything the trace moves. A painter
 * (`app/ChatPanel.tsx` registers the only one) is called with the trace's time and says whether
 * anything is still moving; the chain continues only while one says yes. So it runs from Send
 * until the answer has settled — never more than two seconds after `done` — and not at all
 * between turns. With the clock pinned by the dev harness one frame is drawn per pin. Under
 * `prefers-reduced-motion: reduce` nothing is animated: a frame is drawn when the turn's state
 * changes — an event, or the next cue, which a timer waits for — and each is that state's end.
 *
 * **The canvas** covers the reply's bubble and draws the cells, the beam and the rings in device
 * pixels. The lattice is already on whole device pixels (`traceLattice`), so a cell at rest is a
 * crisp square with no blending; a cell in flight is drawn where it is.
 *
 * **A turn's reply** is the existing bubble with three things in it: the answer's words, each a
 * span the reveal can fade in — the two inline marks rendered as elements, never as HTML
 * (`ai/marks.ts`) — the rows under it, each a button that selects its elements, and the canvas.
 * Once nothing moves the bubble is ordinary flow again: it re-wraps and grows with the panel,
 * and its rows' cells are redrawn where the rows are.
 */
import { Fragment, memo, useLayoutEffect, useRef, useState } from 'react'
import { s } from './css'
import { markWords, type Mark } from '../ai/marks'
import {
  H_THINK,
  J,
  MATRIX_TOP,
  MONO_CH,
  PAD_X,
  ROW_H,
  ROWS_GAP,
  RULE_GAP,
  ROWS_BOTTOM,
  STATUS_H,
  TICK_H,
  TICK_TOP,
  TRACE_PALETTE,
  rowCells,
  rowLayout,
  type CellRole,
  type TraceCell,
  type TraceFrame
} from '../ai/trace'
import { countText, nounFor, type ChatTrace } from '../ai/trace-facts'
import { traceNow, traceState } from '../ai/trace-store'

/* ────────────────────────────── the loop ────────────────────────────── */

/**
 * Draw the trace as it stands at `T`. Returns the time it next has something to draw: `true` —
 * the next frame; a number — that time, a cue; `false` — nothing more.
 */
export type TracePainter = (T: number, reduced: boolean) => boolean | number

const painters = new Set<TracePainter>()
let raf = 0
let cueTimer: ReturnType<typeof setTimeout> | null = null
let frames = 0
let motion: MediaQueryList | null = null

/** Whether the page asks for no motion (`prefers-reduced-motion: reduce`). */
export const reducedMotion = (): boolean => {
  motion ??= matchMedia('(prefers-reduced-motion: reduce)')
  return motion.matches
}

function tick(): void {
  raf = 0
  frames++
  const T = traceNow()
  const reduced = reducedMotion()
  let next: boolean | number = false
  for (const paint of painters) {
    const wants = paint(T, reduced)
    if (wants === true || next === true) next = true
    else if (typeof wants === 'number') next = typeof next === 'number' ? Math.min(next, wants) : wants
  }
  // A pinned clock does not move: one frame per pin, and `kickTrace` asks for the next.
  if (next === false || traceState().pinned !== null) return
  if (next === true) raf = requestAnimationFrame(tick)
  else cueTimer = setTimeout(kickTrace, Math.max(0, (next - T) * 1000) + 1)
}

/** Ask for a frame: the turn's state changed, a painter mounted, the clock was pinned. */
export function kickTrace(): void {
  if (cueTimer !== null) {
    clearTimeout(cueTimer)
    cueTimer = null
  }
  if (!raf && painters.size) raf = requestAnimationFrame(tick)
}

/** Register a painter; returns the way to remove it. */
export function onTraceFrame(paint: TracePainter): () => void {
  painters.add(paint)
  kickTrace()
  return () => {
    painters.delete(paint)
    if (!painters.size) {
      if (raf) cancelAnimationFrame(raf)
      if (cueTimer !== null) clearTimeout(cueTimer)
      raf = 0
      cueTimer = null
    }
  }
}

/**
 * Dev harness only (`window.__sgvueDev.trace.loop`): whether a frame or a cue is being waited
 * for, and how many frames have been drawn since the page loaded.
 */
export const traceLoop = (): { running: boolean; frames: number } => ({
  running: raf !== 0 || cueTimer !== null,
  frames
})

/* ────────────────────────────── the colours ────────────────────────────── */

type Rgb = readonly [number, number, number]

const rgbOf = (hex: string): Rgb => {
  const h = hex.trim()
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb
}

let coloursFor = ''
let colours: Record<CellRole, Rgb> | null = null

/** The live theme's colour for each role: its tokens read from the document, its constants as they are. */
export function traceColours(): Record<CellRole, Rgb> {
  const root = document.documentElement
  const theme = root.dataset.theme === 'light' ? 'light' : 'dark'
  if (colours && coloursFor === theme) return colours
  const style = getComputedStyle(root)
  const palette = TRACE_PALETTE[theme]
  const out = {} as Record<CellRole, Rgb>
  for (const role of Object.keys(palette) as CellRole[]) {
    const value = palette[role]
    out[role] = rgbOf(value.startsWith('--') ? style.getPropertyValue(value) : value)
  }
  coloursFor = theme
  colours = out
  return out
}

const css = (c: Rgb, alpha = 1): string => (alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`)

const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  const u = Math.max(0, Math.min(1, t))
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * u)) as unknown as Rgb
}

/* ────────────────────────────── the canvas ────────────────────────────── */

/** A CSS length that Chromium's 1/64 px truncation cannot make one device pixel short (`veeBox`). */
const cssLength = (devicePx: number, dpr: number): string => `${Math.ceil((devicePx / dpr) * 1000) / 1000}px`

/** A square no larger than this many device pixels is drawn with square corners: a radius would only blur it. */
const ROUND_FROM_PX = 5

/**
 * Draw the matrix on a canvas covering a bubble `width` × `height` CSS px: the beam and its
 * trail, each ring, each cell. Cell coordinates are the frame's — x from the bubble's inner
 * left, y from its top — and everything is drawn in device pixels.
 */
export function paintMatrix(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  cells: readonly TraceCell[],
  beam: TraceFrame['beam'],
  dpr: number
): void {
  const w = Math.max(1, Math.round(width * dpr))
  const h = Math.max(1, Math.round(height * dpr))
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
    canvas.style.width = cssLength(w, dpr)
    canvas.style.height = cssLength(h, dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const c = traceColours()
  /** The bubble's inner left, on a whole device pixel. */
  const ox = Math.round(PAD_X * dpr)
  const px = (v: number): number => v * dpr

  if (beam && beam.opacity > 0) {
    // `ask-thinking-hex.jsx:184–185` — a 46 px trail fading up to 16 %, then the 2 px beam and
    // its glow.
    const x = ox + px(beam.x)
    const trail = ctx.createLinearGradient(x - px(J(46)), 0, x, 0)
    trail.addColorStop(0, css(c.hit, 0))
    trail.addColorStop(1, css(c.hit, 0.16))
    ctx.globalAlpha = beam.opacity * 0.9
    ctx.fillStyle = trail
    ctx.fillRect(x - px(J(46)), px(MATRIX_TOP - J(4)), px(J(46)), px(J(28)))
    ctx.globalAlpha = beam.opacity
    ctx.shadowColor = css(c.hit, 0.55)
    ctx.shadowBlur = px(J(10))
    ctx.fillStyle = css(c.hit)
    ctx.beginPath()
    ctx.roundRect(x - px(J(1)), px(MATRIX_TOP - J(6)), px(J(2)), px(J(32)), px(J(1)))
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'
  }

  for (const cell of cells) {
    const side = px(cell.size) * cell.scale
    if (side <= 0 || cell.opacity <= 0) continue
    const cx = ox + px(cell.x + cell.size / 2)
    const cy = px(cell.y + cell.size / 2)
    if (cell.ring >= 0) {
      // `:213` — a ring that grows to 2.6× and fades over 0.6 s, and the cell glows while it does.
      const grow = 1 + cell.ring * 1.6
      const ring = (px(cell.size) + px(J(3 + 1.4))) * grow
      ctx.globalAlpha = 0.8 * (1 - cell.ring)
      ctx.strokeStyle = css(c.hit)
      ctx.lineWidth = px(J(1.4)) * grow
      ctx.beginPath()
      ctx.roundRect(cx - ring / 2, cy - ring / 2, ring, ring, px(J(3)) * grow)
      ctx.stroke()
      ctx.shadowColor = css(c.hit, 0.6)
      ctx.shadowBlur = px(J(8))
    }
    ctx.globalAlpha = cell.opacity
    ctx.fillStyle = css(mix(c[cell.a], c[cell.b], cell.t))
    if (side < ROUND_FROM_PX) ctx.fillRect(cx - side / 2, cy - side / 2, side, side)
    else {
      ctx.beginPath()
      ctx.roundRect(cx - side / 2, cy - side / 2, side, side, side * 0.24)
      ctx.fill()
    }
    if (cell.ring >= 0) {
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
    }
  }
  ctx.globalAlpha = 1
}

/* ────────────────────────────── the page changing under it ────────────────────────────── */

/** Hear the two things that change how a drawn canvas looks: the theme, and the device pixel ratio. */
function onEnvironment(fn: () => void): () => void {
  const themes = new MutationObserver(fn)
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  let ratio: MediaQueryList | null = null
  const arm = (): void => {
    ratio?.removeEventListener('change', changed)
    ratio = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    ratio.addEventListener('change', changed)
  }
  const changed = (): void => {
    arm()
    fn()
  }
  arm()
  return () => {
    themes.disconnect()
    ratio?.removeEventListener('change', changed)
  }
}

/* ────────────────────────────── the status beside the name ────────────────────────────── */

/** The status's own type: the label row's 10 px, a weight lighter than the name beside it. */
const STATUS_TEXT = 'font:400 10px/1 var(--sans);letter-spacing:.02em;color:var(--faint);white-space:nowrap'

/**
 * `Thinking`'s shimmer (`ask-thinking-hex.jsx:332`): the text is filled with a gradient three
 * times its width — `--faint`, a band of `--ink` in the middle third, `--faint` — and the panel
 * slides that gradient across it. At `100% 0`, where it rests, the text is plain `--faint`.
 */
const SHIMMER =
  'background-image:linear-gradient(90deg, var(--faint) 0%, var(--faint) 36%, var(--ink) 50%, var(--faint) 64%, var(--faint) 100%);background-size:300% 100%;background-position:100% 0;-webkit-background-clip:text;background-clip:text;color:transparent'

/**
 * The status beside `Vee`. For a finished reply it is one line of text. For the reply the trace
 * is drawing it is the same line's box with a window `STATUS_H` tall laid over it — reaching
 * 1.67 px above and below the 10 px row, which it does not make any taller — in which `Thinking`
 * and the final status roll past each other; `app/ChatPanel.tsx` moves the two lines.
 */
export function TraceStatus({ text, rolling }: { text: string; rolling: boolean }): React.JSX.Element | null {
  if (!rolling) return text ? <span data-part="status" style={s(STATUS_TEXT)}>{text}</span> : null
  const line = 'position:absolute;left:0;top:0;height:100%;display:flex;align-items:center;opacity:0'
  return (
    <span data-part="status" style={s(`${STATUS_TEXT};position:relative;flex:none`)}>
      {/* What gives the box its width: the status once there is one, `Thinking` until then. */}
      <span style={s('visibility:hidden')}>{text || 'Thinking'}</span>
      <span
        style={s(
          `position:absolute;left:0;top:${(10 - STATUS_H) / 2}px;width:100%;height:${STATUS_H}px;overflow-x:visible;overflow-y:clip`
        )}
      >
        <span data-part="status-thinking" aria-hidden="true" style={s(`${line};${SHIMMER}`)}>
          Thinking
        </span>
        <span data-part="status-final" style={s(line)}>
          {text}
        </span>
      </span>
    </span>
  )
}

/* ────────────────────────────── the reply's bubble ────────────────────────────── */

const MARK_STYLE: Record<Mark, string> = {
  '': '',
  b: 'font-weight:600',
  // `:241` — the mono face at 16.5 ÷ 1.5 px, in the text's own colour and on its own line box.
  m: 'font:400 11px/1 var(--mono)'
}

/**
 * The reply's text as words. Each word is a span the reveal can fade and lift — `position:
 * relative`, so it is still inline and the line breaks exactly where plain text would break —
 * and each piece of a word carries its mark as an element.
 *
 * Memoised on the text: the panel renders again at every keystroke in the composer, and a reply
 * that has not changed is neither split nor laid out again. (What the reveal writes on the
 * spans is the painter's own, and no render of this touches it.)
 */
const Words = memo(function Words({ text }: { text: string }): React.JSX.Element {
  const words = markWords(text)
  return (
    <>
      {words.map((word, j) => (
        <Fragment key={j}>
          <span data-part="word" style={s('position:relative')}>
            {word.map((piece, k) =>
              piece.mark ? (
                <span key={k} style={s(MARK_STYLE[piece.mark])}>
                  {piece.text}
                </span>
              ) : (
                piece.text
              )
            )}
          </span>
          {j < words.length - 1 ? ' ' : ''}
        </Fragment>
      ))}
    </>
  )
})

/**
 * The ticker's one line (`ask-thinking-hex.jsx:128`, `:171–180`): a label, what follows it in
 * the mono face, and the count on the right — a flex row centred on the line, 6 ÷ 1.5 px between
 * its pieces. The count is never squeezed; a label or a name too long for the panel is cut with
 * an ellipsis instead.
 */
function TickerLine(): React.JSX.Element {
  const cut = 'min-width:0;overflow:hidden;text-overflow:ellipsis'
  return (
    <div
      data-part="tick"
      style={s(`position:absolute;inset:0;display:none;align-items:center;gap:${J(6)}px;white-space:nowrap`)}
    >
      <span data-part="tick-label" style={s(cut)} />
      {/* The reference's line height is 1; as tall as the ticker's own line it is centred the
          same and its descenders are not cut by the ellipsis's clip. */}
      <span
        data-part="tick-mono"
        style={s(`font:400 10px/${TICK_H}px var(--mono);color:var(--ink);${cut}`)}
      />
      <span
        data-part="tick-count"
        style={s('flex:none;margin-left:auto;font:400 10px/1 var(--mono);color:var(--faint)')}
      >
        <span data-part="tick-n" /> <span data-part="tick-unit" />
      </span>
    </div>
  )
}

/**
 * The height of a reply's text as it is laid out — to the fraction of a pixel, which
 * `offsetHeight` rounds away: two lines of 12.5 px text at 1.55 are 38.75 px, and a quarter of a
 * pixel is what decides which device pixel a row's cell is centred on.
 */
export const textHeight = (text: HTMLElement | null): number => (text ? text.getBoundingClientRect().height : 0)

/** A reply with no rows: one array, so that an effect keyed on the rows does not run again for nothing. */
const NO_ROWS: ChatTrace['rows'] = []

/** The existing reply bubble's own style string (`ChatPanel`), which the trace's bubble starts from. */
export const bubbleStyle = (fg: string, bg: string, radius: string, maxW: string): string =>
  `font:400 12.5px/1.55 var(--sans);color:${fg};background:${bg};border-radius:${radius};padding:8px 11px;max-width:${maxW};text-wrap:pretty`

/**
 * The bubble of a turn's reply — live, being answered, or long finished.
 *
 * It is the existing bubble with its padding moved onto an inner block, so that its height can
 * be drawn from nothing while the trace opens it; settled, its box is the existing bubble's. A
 * reply whose turn opened the trace bubble is full width (`wide`); one with no trace hugs its
 * text as every reply did.
 *
 * `owned` is the reply the trace is drawing: it carries the ticker, and its canvas is painted by
 * the panel's frame loop. Any other reply paints its own canvas — the rows' cells at rest — and
 * again whenever its box, the theme or the display's ratio changes.
 */
export function ReplyBubble({
  text,
  trace,
  owned,
  wide,
  base,
  onPick
}: {
  /** The reply, or `null` while it is being written. */
  text: string | null
  trace: ChatTrace | null
  owned: boolean
  wide: boolean
  /** The existing bubble's style string. */
  base: string
  onPick: (ids: number[]) => void
}): React.JSX.Element {
  const bubble = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const words = useRef<HTMLDivElement>(null)
  const rows = trace?.rows ?? NO_ROWS
  const noun = trace?.noun ?? 'element'
  /** The bubble's inner width, which decides how wide a row's label may be. */
  const [inner, setInner] = useState(0)

  useLayoutEffect(() => {
    const node = bubble.current
    if (!node) return
    const paint = (): void => {
      const width = node.clientWidth - 2 * PAD_X
      setInner((was) => (was === width ? was : width))
      // The reply the trace is drawing is painted by the loop; it only has to be told.
      if (owned) return kickTrace()
      if (!canvas.current || !rows.length) return
      const dpr = window.devicePixelRatio || 1
      const cells = rowCells(rows, noun, { width, dpr, textH: textHeight(words.current) })
      paintMatrix(canvas.current, node.clientWidth, node.clientHeight, cells, null, dpr)
    }
    paint()
    const sized = new ResizeObserver(paint)
    sized.observe(node)
    const stop = onEnvironment(paint)
    return () => {
      sized.disconnect()
      stop()
    }
    // `rows` is the message's own array, stable for as long as the message is.
  }, [owned, rows, noun, text])

  const lay = rowLayout(rows, noun, { width: inner, dpr: window.devicePixelRatio || 1 })
  const hasCanvas = owned || rows.length > 0

  return (
    <span
      ref={bubble}
      data-part="bubble"
      style={s(
        `${base};padding:0;position:relative;overflow:hidden` +
          (wide ? ';align-self:stretch' : '') +
          // Nothing of the bubble shows until the trace opens it.
          (text === null ? ';height:0;opacity:0' : '')
      )}
    >
      {hasCanvas ? (
        <canvas
          ref={canvas}
          data-part="matrix"
          aria-hidden="true"
          width={1}
          height={1}
          style={s('position:absolute;left:0;top:0;width:1px;height:1px;display:block;z-index:1;pointer-events:none')}
        />
      ) : null}
      {owned ? (
        <div
          data-part="ticker"
          aria-hidden="true"
          style={s(
            `position:absolute;left:${PAD_X}px;right:${PAD_X}px;top:${TICK_TOP}px;height:${TICK_H}px;overflow:hidden;font:400 ${J(15.6)}px/${TICK_H}px var(--sans);color:var(--muted);display:none`
          )}
        >
          <TickerLine />
          <TickerLine />
        </div>
      ) : null}
      {text !== null ? (
        <div
          data-part="body"
          style={s(`padding:8px ${PAD_X}px ${rows.length ? ROWS_BOTTOM : 8}px`)}
        >
          <div ref={words} data-part="text">
            <Words text={text} />
          </div>
          {rows.length ? (
            <div data-part="rows" style={s(`position:relative;margin-top:${ROWS_GAP}px`)}>
              <div
                data-part="rule"
                aria-hidden="true"
                style={s(`position:absolute;left:0;right:0;top:${RULE_GAP - ROWS_GAP}px;height:1px;background:var(--border)`)}
              />
              {rows.map((row, L) => {
                // A name cut by the ellipsis carries its whole text on hover, as the property card's do.
                const label = [...row.label].length * MONO_CH > lay.labelMax ? row.label : undefined
                return (
                  <button
                    key={L}
                    data-part="row"
                    onClick={() => onPick(row.ids)}
                    className="hv-card"
                    style={s(
                      `display:flex;align-items:center;width:100%;height:${ROW_H}px;font:400 10px/1 var(--mono);border-radius:3px`
                    )}
                  >
                    <span
                      title={label}
                      style={s(
                        `color:var(--muted);max-width:${lay.labelMax}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`
                      )}
                    >
                      {row.label}
                    </span>
                    <span style={s('margin-left:auto;color:var(--faint);white-space:nowrap')}>
                      <span style={s('color:var(--ink)')}>{countText(row.n)}</span> {nounFor(row.n, noun)}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  )
}

/** The canvas of the reply the trace is drawing: as tall as the trace, or as the answer once it is in. */
export const matrixHeight = (answer: number): number => Math.max(H_THINK, answer)
