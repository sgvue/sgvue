/**
 * Vee, the assistant's pixel mascot — the canvas and the clock (2026-10-01, the owner's "Ask
 * Vee" handoff, `design-reference/ask-vee/`). What is drawn, in which colours and at what size
 * is `app/vee-grid.ts`, which is pure; this is the part that needs a document.
 *
 * **The sprite.** A `<canvas>` whose backing store is a whole number of device pixels to a cell
 * (`veeBox` — one size for every sprite), centred in a layout slot of a fixed CSS size. So the
 * drawing is crisp at any display scaling, and what the layout sees — the slot — does not change
 * with it.
 *
 * **The clock.** One for every sprite, counting 8 frames a second — and **asleep between the
 * frames at which a mounted sprite's drawing actually changes** (`veeNextWake`): one timer, set
 * for the next such frame. Three idle sprites wake it at the two edges of each one's blink; a
 * sprite in `thinking` or `reading` wakes it every frame, `done` twice a second. It counts only
 * while a sprite is mounted and the window is visible, and not at all under
 * `prefers-reduced-motion: reduce`, where each sprite holds one frame of its state
 * (`veeClockRuns`, `veeSpriteFrame`). **It never causes a React render**: a wake redraws each
 * sprite's own canvas, and only when the grid for the new frame differs from the one last drawn.
 * A change of theme (the `data-theme` attribute the tokens hang on) or of the device pixel ratio
 * redraws every sprite the same way.
 *
 * **States.** The header's sprite and the pill's are `idle`. A reply's label takes its state
 * from the thinking trace (`app/Trace.tsx`): `thinking`, `reading`, `found`, `done`. `idle`
 * stands `offset` frames ahead of the clock so that no two sprites blink together; every other
 * state plays from its own first frame, counted from the moment the sprite entered it.
 */
import { useLayoutEffect, useRef } from 'react'
import { s } from './css'
import {
  VEE_FRAME_MS,
  VEE_PALETTE,
  VEE_SIZE,
  veeBox,
  veeClockRuns,
  veeGrid,
  veeKey,
  veeNextWake,
  veeSpriteFrame,
  type VeeCell,
  type VeeRole,
  type VeeState
} from './vee-grid'

/* ────────────────────────────── the colours ────────────────────────────── */

/** The live theme's colour for each role: its tokens read from the document, its constants as they are. */
export function veeColours(): Record<VeeRole, string> {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const palette = VEE_PALETTE[root.dataset.theme === 'light' ? 'light' : 'dark']
  const out = {} as Record<VeeRole, string>
  for (const role of Object.keys(palette) as VeeRole[]) {
    const value = palette[role]
    out[role] = value.startsWith('--') ? style.getPropertyValue(value).trim() : value
  }
  return out
}

/**
 * Paint a grid on a canvas at `cell` device pixels to a cell, in the live theme's colours. The
 * backing store is sized to it (which also clears it). Every cell is one `fillRect` on whole
 * pixels; smoothing is off for whatever scales the canvas afterwards.
 */
export function paintVee(
  canvas: HTMLCanvasElement,
  grid: readonly (readonly VeeCell[])[],
  cell: number
): void {
  const px = cell * VEE_SIZE
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width = px
    canvas.height = px
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, px, px)
  const colours = veeColours()
  grid.forEach((row, y) =>
    row.forEach((c, x) => {
      if (c === '.') return
      ctx.fillStyle = colours[c]
      ctx.fillRect(x * cell, y * cell, cell, cell)
    })
  )
}

/* ────────────────────────────── the clock ────────────────────────────── */

/** One mounted sprite: what it shows, and how to draw a frame of it. */
interface Sprite {
  state: VeeState
  /** The frames an `idle` sprite stands ahead of the clock. */
  offset: number
  /** The clock's frame when the sprite entered its state. */
  since: number
  /** Draw frame `frame` of the state; `force` draws even if the grid is the one last drawn. */
  draw: (frame: number, force: boolean) => void
}

const sprites = new Set<Sprite>()
/** The frame the clock stood at when it last started counting, and when that was. */
let base = 0
let startedAt = 0
let counting = false
/** The one timer: set for the next frame at which some sprite's drawing changes. */
let timer: ReturnType<typeof setTimeout> | null = null
/** How many times that timer has fired, for the dev harness's measurement. */
let wakes = 0
/** The dev harness's pinned frame (`window.__sgvueDev.vee.pin`), or `null`. */
let pinned: number | null = null
let reduced: MediaQueryList | null = null
let ratio: MediaQueryList | null = null
let themes: MutationObserver | null = null

/** The clock's frame now: counted from wall time while it runs, held while it does not. */
const clockFrame = (): number =>
  counting ? base + Math.floor((performance.now() - startedAt) / VEE_FRAME_MS) : base

const redrawAll = (force: boolean): void => {
  const clock = clockFrame()
  const still = !!reduced?.matches
  for (const sp of sprites) {
    sp.draw(veeSpriteFrame(sp.state, sp.offset, sp.since, clock, still, pinned), force)
  }
}

/** Sleep until the next frame at which a mounted sprite's drawing changes. */
function arm(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (!counting) return
  const clock = clockFrame()
  const next = veeNextWake(
    [...sprites].map((sp) => ({
      state: sp.state,
      offset: sp.state === 'idle' ? sp.offset : -sp.since
    })),
    clock
  )
  if (next === null) return
  const due = startedAt + (next - base) * VEE_FRAME_MS - performance.now()
  // Rounded up: a timer's delay is whole milliseconds, and one cut short would wake a fraction
  // of a millisecond before the frame it is for — to find nothing changed and wake again.
  timer = setTimeout(() => {
    timer = null
    wakes++
    redrawAll(false)
    arm()
  }, Math.max(0, Math.ceil(due)))
}

/** Start or stop counting, whichever `veeClockRuns` says, and set the timer again. */
function sync(): void {
  const run = veeClockRuns(sprites.size, !document.hidden, !!reduced?.matches, pinned !== null)
  if (run && !counting) {
    startedAt = performance.now()
    counting = true
  } else if (!run && counting) {
    base = clockFrame()
    counting = false
  }
  arm()
}

/** What the page says changed: reduced motion on or off — or the theme, which only redraws. */
const onEnvironment = (): void => {
  sync()
  redrawAll(true)
}

/** The ratio's media query names the ratio it was built for, so it is re-armed at each change. */
const onRatio = (): void => {
  armRatio()
  redrawAll(true)
}
function armRatio(): void {
  ratio?.removeEventListener('change', onRatio)
  ratio = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
  ratio.addEventListener('change', onRatio)
}

/** The first sprite mounts: listen to the page. */
function attach(): void {
  reduced = matchMedia('(prefers-reduced-motion: reduce)')
  reduced.addEventListener('change', onEnvironment)
  document.addEventListener('visibilitychange', sync)
  themes = new MutationObserver(onEnvironment)
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  armRatio()
}

/** The last one unmounts: stop listening. */
function detach(): void {
  reduced?.removeEventListener('change', onEnvironment)
  reduced = null
  document.removeEventListener('visibilitychange', sync)
  themes?.disconnect()
  themes = null
  ratio?.removeEventListener('change', onRatio)
  ratio = null
}

/** Mount a sprite: it is drawn at once, then whenever the clock or the page asks. */
function subscribe(state: VeeState, offset: number, draw: Sprite['draw']): () => void {
  if (!sprites.size) attach()
  const sprite: Sprite = { state, offset, since: clockFrame(), draw }
  sprites.add(sprite)
  sync()
  draw(veeSpriteFrame(state, offset, sprite.since, clockFrame(), !!reduced?.matches, pinned), true)
  return () => {
    sprites.delete(sprite)
    if (!sprites.size) detach()
    sync()
  }
}

/**
 * Dev harness only (`window.__sgvueDev.vee.pin`, behind `DEVTOOLS`): hold every sprite at
 * clock frame `n`, so a capture is the same on every run; `null` lets the clock run again.
 */
export function pinVeeFrame(n: number | null): void {
  pinned = n
  sync()
  redrawAll(true)
}

/** Dev harness only: how many times the clock's timer has fired since the page loaded. */
export const veeWakes = (): number => wakes

/* ────────────────────────────── the component ────────────────────────────── */

/**
 * One sprite. `slot` is its layout size in CSS px, `margin` the slot's own margins (negative:
 * the 16 × 16 grid is larger than the body in it, so the slot overhangs the row it sits in),
 * `offset` the frames an `idle` sprite stands ahead of the clock, so sprites side by side do not
 * blink together. Decorative: the name beside it is the text.
 */
export function Vee({
  slot,
  margin,
  offset = 0,
  state = 'idle'
}: {
  slot: number
  margin: string
  offset?: number
  state?: VeeState
}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)

  // A layout effect, so the canvas has its size before the first paint: unsized it is the
  // 300 × 150 px every canvas starts at.
  useLayoutEffect(() => {
    const node = canvas.current
    if (!node) return
    let drawn = ''
    return subscribe(state, offset, (frame, force) => {
      const grid = veeGrid(state, frame)
      const key = veeKey(grid)
      if (!force && key === drawn) return
      drawn = key
      const box = veeBox(slot, window.devicePixelRatio || 1)
      node.style.width = node.style.height = `${box.size}px`
      node.style.left = node.style.top = `${box.inset}px`
      paintVee(node, grid, box.cell)
    })
  }, [slot, offset, state])

  return (
    <span
      data-role="vee"
      data-state={state}
      aria-hidden="true"
      style={s(`position:relative;flex:none;width:${slot}px;height:${slot}px;margin:${margin}`)}
    >
      <canvas
        ref={canvas}
        width={VEE_SIZE}
        height={VEE_SIZE}
        style={s('position:absolute;display:block;image-rendering:pixelated;pointer-events:none')}
      />
    </span>
  )
}
