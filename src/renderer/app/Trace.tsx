/**
 * The thinking trace — its view (2026-10-01, the owner's "Ask Vee" handoff,
 * `design-reference/ask-vee/`). What is shown at any instant is `traceFrame` and `answerFrame`
 * (`ai/trace.ts`), which are pure; this is the thin part that needs a document: the frame loop,
 * the canvas the matrix is drawn on, the diary a turn's narration is drawn in, and the markup of
 * a reply's blocks.
 *
 * **The loop** is one `requestAnimationFrame` chain for everything the trace moves. A painter
 * (`app/ChatPanel.tsx` registers the only one) is called with the trace's time and says whether
 * anything is still moving; the chain continues only while one says yes. So it runs from Send
 * until the answer has settled — never more than two seconds after `done` — and not at all
 * between turns. With the clock pinned by the dev harness one frame is drawn per pin. Under
 * `prefers-reduced-motion: reduce` nothing is animated: a frame is drawn when the turn's state
 * changes — an event, or the next cue, which a timer waits for — and each is that state's end.
 *
 * **The canvas** draws the cells, the beam and the rings in device pixels. The lattice is already
 * on whole device pixels (`traceLattice`), so a cell at rest is a crisp square with no blending;
 * a cell in flight is drawn where it is.
 *
 * **2026-11-08 — the diary** ("Vee Messages", stage 1b, the approved prototype's "site diary").
 * While a turn runs, Vee's bubble is a card: `Thinking` and the seconds since Send, every step the
 * trace has shown — ticked once the next has begun, with its live count — and the element matrix
 * under them. At the answer it folds into one line (`✓ 412 read · 80 walls · 12 missing · 7s ›`),
 * which reopens to the steps — and, while it is the newest turn's, the final matrix.
 *
 * **Since 2026-10-08 a reply is laid out in blocks** (`ai/blocks.ts`): paragraphs, their line
 * breaks, bulleted and numbered lists, and tables. Since 2026-11-08 each block is a bubble of its
 * own (`BlockView`), and nothing of it is revealed word by word.
 */
import { Fragment, memo, useLayoutEffect, useRef, useState } from 'react'
import { s } from './css'
import { splitMarks, type Mark } from '../ai/marks'
import type { Block } from '../ai/blocks'
import {
  J,
  MATRIX_BAND,
  MATRIX_TOP,
  PAD_X,
  TRACE_PALETTE,
  traceFrame,
  type CellRole,
  type Timeline,
  type TraceCell,
  type TraceFrame
} from '../ai/trace'
import { countText } from '../ai/trace-facts'
import { namePieces } from '../ai/terms'
import { traceNow, traceState } from '../ai/trace-store'
import { Chevron, TickOne } from './VeeIcons'

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
  dpr: number,
  origin: { x: number; y: number } = { x: PAD_X, y: 0 }
): void {
  const w = Math.max(1, Math.round(width * dpr))
  const h = Math.max(1, Math.round(height * dpr))
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
    canvas.style.width = cssLength(w, dpr)
    canvas.style.height = cssLength(h, dpr)
  }
  // Software rasterising from the start: the matrix is read back every frame by the e2e suite and
  // the dev harness, and without this flag Chromium swaps rasterisers after repeated readbacks, so
  // one frame drawn twice gives its rounded cells different corner coverage (2026-11-08).
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const c = traceColours()
  /**
   * Where a cell's coordinates start: the bubble's inner left, on a whole device pixel — and, for
   * the diary's own canvas (2026-11-08), the matrix's band, `origin.y` under the old bubble's top.
   */
  const ox = Math.round(origin.x * dpr)
  const oy = Math.round(origin.y * dpr)
  const px = (v: number): number => v * dpr
  const py = (v: number): number => v * dpr - oy

  if (beam && beam.opacity > 0) {
    // `ask-thinking-hex.jsx:184–185` — a 46 px trail fading up to 16 %, then the 2 px beam and
    // its glow.
    const x = ox + px(beam.x)
    const trail = ctx.createLinearGradient(x - px(J(46)), 0, x, 0)
    trail.addColorStop(0, css(c.hit, 0))
    trail.addColorStop(1, css(c.hit, 0.16))
    ctx.globalAlpha = beam.opacity * 0.9
    ctx.fillStyle = trail
    ctx.fillRect(x - px(J(46)), py(MATRIX_TOP - J(4)), px(J(46)), px(J(28)))
    ctx.globalAlpha = beam.opacity
    ctx.shadowColor = css(c.hit, 0.55)
    ctx.shadowBlur = px(J(10))
    ctx.fillStyle = css(c.hit)
    ctx.beginPath()
    ctx.roundRect(x - px(J(1)), py(MATRIX_TOP - J(6)), px(J(2)), px(J(32)), px(J(1)))
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'
  }

  for (const cell of cells) {
    const side = px(cell.size) * cell.scale
    if (side <= 0 || cell.opacity <= 0) continue
    const cx = ox + px(cell.x + cell.size / 2)
    const cy = py(cell.y + cell.size / 2)
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

/* ────────────────────────────── a reply's blocks ────────────────────────────── */

const MARK_STYLE: Record<Mark, string> = {
  '': '',
  b: 'font-weight:600',
  // `:241` — the mono face at 16.5 ÷ 1.5 px, in the text's own colour and on its own line box.
  m: 'font:400 11px/1 var(--mono)'
}

/**
 * 2026-11-08 (stage 2) — which code spans of a reply are IFC terms (`ai/terms.ts`): their ordinals
 * in render order, as the main window found them in the loaded models' vocabulary, and the
 * ordinal this block's first span has. A coloured span is the `.ifc-term` class — mono medium in
 * the one IFC-term colour — and no inline style; every other code span is the design's mono.
 */
export interface TermMarks {
  terms: ReadonlySet<number>
  first: number
}
const NO_TERMS: TermMarks = { terms: new Set(), first: 0 }

/** How many code spans a line holds: where the next line's ordinals start. */
const spansIn = (pieces: readonly { mark: Mark }[]): number => pieces.reduce((n, p) => n + (p.mark === 'm' ? 1 : 0), 0)

/**
 * A run of pieces, each mark as an element and plain text as text. `at` is the ordinal of the
 * run's first code span, so a span is coloured exactly when `terms` holds its ordinal.
 */
const marked = (pieces: readonly { text: string; mark: Mark }[], at = 0, terms: ReadonlySet<number> = NO_TERMS.terms): React.ReactNode[] => {
  let k = at
  return pieces.map((piece, i) =>
    piece.mark === 'm' && terms.has(k++) ? (
      <span key={i} className="ifc-term">
        {piece.text}
      </span>
    ) : piece.mark ? (
      <span key={i} style={s(MARK_STYLE[piece.mark])}>
        {piece.text}
      </span>
    ) : (
      piece.text
    )
  )
}

/**
 * One line of Vee's text with its two marks as elements and no colour — stage 2's IFC+SG question
 * lead-in, which is not part of the message's text the IFC terms were found in.
 */
export function MarkedText({ text }: { text: string }): React.JSX.Element {
  return <>{marked(splitMarks(text))}</>
}

/** Lines split into their pieces, each with the ordinal its first code span has. */
function linesAt(lines: readonly string[], first: number): { pieces: ReturnType<typeof splitMarks>; at: number }[] {
  let at = first
  return lines.map((line) => {
    const pieces = splitMarks(line)
    const out = { pieces, at }
    at += spansIn(pieces)
    return out
  })
}

/** A block's lines, a line break between each two, each line's marks as elements. */
function Lines({ lines, marks = NO_TERMS }: { lines: readonly { pieces: ReturnType<typeof splitMarks>; at: number }[]; marks?: TermMarks }): React.JSX.Element {
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i ? <br /> : null}
          {marked(line.pieces, line.at, marks.terms)}
        </Fragment>
      ))}
    </>
  )
}

/** Between two items of a list, and from a marker to its text: px. */
const ITEM_GAP = 3
const MARKER_GAP = 6

/** A bullet: the text's own size, in `--faint`, at the text's left edge. */
const BULLET = 'position:relative;flex:none;width:8px;color:var(--faint)'
/** A list's number: the mono face every numeral takes — the result table's quantity (`SGVue.dc.html:474`). */
const NUMBER_MARK =
  'position:relative;flex:none;text-align:right;font:400 11px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted)'

/*
 * A table is the chat's result table (`SGVue.dc.html:466–477`, `ChatPanel`) drawn from the
 * reply's own rows: the same 1 px `--border` box with an 8 px radius, here on `--card` as that
 * table is, the header in its title's mono capitals on `--step-bg`, each row under a 1 px rule,
 * 9 px at either side and 10 px between two columns; text in the row label's sans, numbers in
 * the count's mono. Its box scrolls sideways when the table is wider than the bubble — the log
 * never does.
 */
const TABLE_BOX = 'position:relative;overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--card)'
const TABLE_HEAD =
  'background:var(--step-bg);font:500 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);vertical-align:bottom'
const TABLE_TEXT = 'border-top:1px solid var(--border);vertical-align:baseline;font:400 11.5px/1.4 var(--sans);color:var(--ink)'
const TABLE_NUMBER =
  'border-top:1px solid var(--border);vertical-align:baseline;font:400 11px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--ink);white-space:nowrap'

/**
 * One block of a reply as one bubble's content (2026-11-08: the Ask Vee window draws a reply as
 * one bubble per block, `ai/parts.ts`). A paragraph is its lines inline — so the bubble's time
 * can stand at the end of its last line — a list its items, a table the result table's look.
 * Nothing in it is ever HTML.
 */
export function BlockView({ block, marks = NO_TERMS }: { block: Block; marks?: TermMarks }): React.JSX.Element {
  if (block.kind === 'p') return <Lines lines={linesAt(block.lines, marks.first)} marks={marks} />
  if (block.kind === 'table') {
    // The cells in the order `ai/terms.ts` walks them: the header, then each row.
    const cells = linesAt([...block.head, ...block.rows.flat()], marks.first)
    let cell = 0
    const next = (): React.ReactNode[] => {
      const c = cells[cell++]
      return marked(c.pieces, c.at, marks.terms)
    }
    const last = block.head.length - 1
    const pad = (c: number, y: number): string => `padding:${y}px ${c === last ? 9 : 5}px ${y}px ${c === 0 ? 9 : 5}px`
    return (
      <div style={s(TABLE_BOX)}>
        <table style={s('border-collapse:collapse;width:100%')}>
          <thead>
            <tr>
              {block.head.map((_, c) => (
                <th key={c} scope="col" style={s(`${pad(c, 6)};${TABLE_HEAD};text-align:${block.cols[c].align}`)}>
                  {next()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((_, c) => (
                  <td
                    key={c}
                    style={s(`${pad(c, 5)};${block.cols[c].num ? TABLE_NUMBER : TABLE_TEXT};text-align:${block.cols[c].align}`)}
                  >
                    {next()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  const ordered = block.kind === 'ol'
  const List = ordered ? 'ol' : 'ul'
  /** Every number of a list as wide as its widest, so their full stops stand in a column. */
  const digits = ordered ? String(block.start + block.items.length - 1).length + 1 : 0
  // Each item's lines, with the ordinals its code spans have — item after item, as `ai/terms.ts`.
  let at = marks.first
  const items = block.items.map((item) => {
    const lines = linesAt(item, at)
    for (const l of lines) at += spansIn(l.pieces)
    return lines
  })
  return (
    <List style={s(`margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:${ITEM_GAP}px`)}>
      {block.items.map((_, k) => (
        <li key={k} style={s(`display:flex;align-items:baseline;gap:${MARKER_GAP}px`)}>
          {ordered ? (
            <span style={s(`${NUMBER_MARK};min-width:${digits}ch`)}>{block.start + k}.</span>
          ) : (
            <span aria-hidden="true" style={s(BULLET)}>
              •
            </span>
          )}
          <span style={s('flex:1;min-width:0')}>
            <Lines lines={items[k]} marks={marks} />
          </span>
        </li>
      ))}
    </List>
  )
}

/* ────────────────────────────── the trace's own names ────────────────────────────── */

/**
 * 2026-11-08 — the owner's IFC-term decision, in the trace's own lines: a diary step's names
 * (`Filtering IfcWall`, `Checking FireRating`) and the storey-rows card's title (`FireRating ·
 * missing`) are the file's spelling, and a name that is an IFC term of the loaded models — `terms`,
 * decided in the main window — is drawn as Vee's text draws one: `.ifc-term`, mono 500 in the one
 * colour. Everything else stays as it was. Text only, never HTML.
 */
export function TermText({ text, terms }: { text: string; terms: readonly string[] | undefined }): React.JSX.Element {
  if (!terms?.length) return <>{text}</>
  return (
    <>
      {namePieces(text).map((p, k) =>
        p.name && terms.includes(p.text) ? (
          <span key={k} className="ifc-term">
            {p.text}
          </span>
        ) : (
          <Fragment key={k}>{p.text}</Fragment>
        )
      )}
    </>
  )
}

/** What each painted node shows now, so it is rebuilt only when its text or terms change. */
const painted = new WeakMap<HTMLElement, string>()

/** The same for a node the trace's painter writes: rebuilt only when its text or terms change. */
export function paintTermText(node: HTMLElement, text: string, terms: readonly string[]): void {
  const key = terms.length ? `${text}\u0000${terms.join('\u0000')}` : text
  if (painted.get(node) === key && node.textContent === text) return
  painted.set(node, key)
  if (!terms.length) {
    node.textContent = text
    return
  }
  node.replaceChildren(
    ...namePieces(text).map((p) => {
      if (!p.name || !terms.includes(p.text)) return document.createTextNode(p.text)
      const span = document.createElement('span')
      span.className = 'ifc-term'
      span.textContent = p.text
      return span
    })
  )
}

/* ────────────────────────────── the diary ────────────────────────────── */

/** One step a finished reply keeps (`ChatTrace.steps`). */
export interface DiaryLine {
  label: string
  mono: string
  n: number | null
  unit: string
}

/**
 * Paint a turn's final matrix on `canvas`: the frame at its answer, which is every animation's
 * end. What a reopened diary shows.
 */
export function paintFinal(canvas: HTMLCanvasElement, tl: Timeline): void {
  if (tl.answer === null) return
  const width = canvas.parentElement ? canvas.parentElement.clientWidth : 0
  if (width <= 0) return
  const dpr = window.devicePixelRatio || 1
  const f = traceFrame(tl, tl.answer, { width, dpr, textH: 0, reduced: true })
  paintMatrix(canvas, width, MATRIX_BAND.height, f.cells, null, dpr, { x: 0, y: MATRIX_BAND.top })
}

/**
 * The diary — 2026-11-08 ("Vee Messages", stage 1b). A turn's narration in Vee's bubble: while
 * the turn runs, `Thinking`, the seconds since Send, a line a step and the element matrix — all
 * written by the trace's painter (`app/ChatPanel.tsx`), so nothing here renders again at every
 * frame; once answered, one line that folds the narration away and reopens it.
 *
 * `owned`: the trace's painter draws this diary — while the turn runs and until its answer has
 * settled. A diary it has let go of paints its own final matrix when it is reopened, while its
 * turn's timeline is still the trace's (`timeline`); an older one reopens to its steps alone.
 */
export const Diary = memo(function Diary({
  fold,
  steps,
  slots,
  timeline,
  owned,
  terms
}: {
  /** The folded line, or `null` while the turn runs. */
  fold: string | null
  /** The steps a finished reply keeps. */
  steps: readonly DiaryLine[]
  /** While the turn runs: how many steps the trace has so far (the painter writes them). */
  slots: number
  /** The answered turn's timeline, while it is this reply's. */
  timeline: Timeline | null
  owned: boolean
  /** The names in the finished steps that are IFC terms (`VeeMessage.trace.terms`). */
  terms?: readonly string[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const live = fold === null
  const matrix = owned || (open && timeline !== null)

  useLayoutEffect(() => {
    const node = canvas.current
    if (owned || !open || !timeline || !node) return
    const paint = (): void => paintFinal(node, timeline)
    paint()
    const sized = new ResizeObserver(paint)
    if (node.parentElement) sized.observe(node.parentElement)
    const stop = onEnvironment(paint)
    return () => {
      sized.disconnect()
      stop()
    }
  }, [owned, open, timeline])

  return (
    <div data-part="diary" className={`vm-b vm-lc${live ? '' : ' vm-fold'}${open ? ' vm-open' : ''}`}>
      {live ? (
        <div className="vm-lc-hd">
          <span data-part="thinking" className="vm-shim">
            Thinking
          </span>
          <span data-part="elapsed" className="vm-el" />
        </div>
      ) : (
        <button
          type="button"
          data-part="diary-sum"
          className="vm-lc-sum"
          aria-expanded={open}
          title="What Vee looked at"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="vm-ck">
            <TickOne />
          </span>
          <span>{fold}</span>
          <Chevron />
        </button>
      )}
      <div data-part="diary-body" className="vm-lc-body">
        <ol className="vm-lc-steps">
          {live
            ? Array.from({ length: slots }, (_, k) => (
                <li key={`l${k}`} data-part="step" className="vm-step">
                  <span className="vm-g" aria-hidden="true">
                    <i />
                    <TickOne />
                  </span>
                  <span className="vm-sl">
                    <span data-part="step-label" />
                    <code data-part="step-mono" />
                  </span>
                  <span data-part="step-count" className="vm-n">
                    <b data-part="step-num" /> <span data-part="step-unit" />
                  </span>
                </li>
              ))
            : steps.map((st, k) => (
                <li key={`s${k}`} className="vm-step vm-ok">
                  <span className="vm-g" aria-hidden="true">
                    <i />
                    <TickOne />
                  </span>
                  <span className="vm-sl">
                    {st.label}
                    {st.mono ? (
                      <code>
                        <TermText text={st.mono} terms={terms} />
                      </code>
                    ) : null}
                  </span>
                  <span className="vm-n">
                    {st.n !== null ? (
                      <>
                        <b>{countText(st.n)}</b> {st.unit}
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
        </ol>
        {matrix ? <canvas ref={canvas} data-part="matrix" className="vm-lc-mx" aria-hidden="true" width={1} height={1} /> : null}
      </div>
    </div>
  )
})
