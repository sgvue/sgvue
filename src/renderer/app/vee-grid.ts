/**
 * Vee, the assistant's pixel mascot — the pure half (2026-10-01).
 *
 * The owner's "Ask Vee" handoff (`design-reference/ask-vee/`, option 1a "Hex") gives the
 * assistant a name and a 16 × 16 sprite at 8 frames a second: a hexagon creature from the SGVue
 * mark with five states. Everything here is arithmetic on plain values — no DOM, no React — so
 * the drawing, the palette's roles, the device-pixel rule and the clock's rule are checked by
 * `tests/unit/vee-grid.test.ts`, the first of them against the handoff's own code.
 * `app/Vee.tsx` is the canvas and the clock that draw it.
 *
 * `veeGrid` is `hexGrid` of `ask-thinking-hex.jsx` (`:53–70`), **ported verbatim**: the same
 * body, the same origin, the same tables, the same statement for each state. The header and the
 * pill show `idle`; a reply's label shows all five, driven by the thinking trace (`ai/trace.ts`).
 *
 * Three rules besides the drawing, each pure: **one size for every sprite** — a whole number of
 * device pixels to a cell, the same number whatever slot the sprite stands in (`veeCell`); **the
 * frame a sprite shows** — `idle` stands a few frames ahead of the clock so no two blink
 * together, every other state plays from its own first frame (`veeSpriteFrame`); and **when the
 * clock next has anything to do** (`veeNextWake`), so it sleeps between a blink's two edges
 * instead of ticking eight times a second.
 */

/** `ask-vee/README.md`, "State management": what the assistant is doing. */
export type VeeState = 'idle' | 'thinking' | 'reading' | 'found' | 'done'

/**
 * What a cell is, which decides its colour (`README.md`, "Vee — pixel mascot"): `o` rim ·
 * `h` highlight · `b` body · `t` top facet · `s` dim · `e` eyes · `k` visor.
 */
export type VeeRole = 'o' | 'h' | 'b' | 't' | 's' | 'e' | 'k'

/** One cell of the grid: a role, or `.` for nothing drawn. */
export type VeeCell = VeeRole | '.'

/** The grid is 16 × 16 cells. */
export const VEE_SIZE = 16

/** The clock: 8 frames a second. */
export const VEE_FRAME_MS = 125

/** `HEX_ROWS` (`:53`): the body, 12 × 12, placed at (2, 3) in the grid. */
export const VEE_ROWS: readonly string[] = [
  '....oooo....',
  '..oottttoo..',
  '.otttttttto.',
  'obttttttttbo',
  'obbbttttbbbo',
  'obbbbttbbbbo',
  'obbbbbbbbbbo',
  'obbbbbbbbbbo',
  'obbbbbbbbbbo',
  '.obbbbbbbbo.',
  '..oobbbboo..',
  '....oooo....'
]

/** `HEX_PERIM` (`:54`): the rim's cells, in the order the thinking light runs round them. */
export const VEE_PERIM: readonly (readonly [number, number])[] = (() => {
  const pts: [number, number][] = []
  VEE_ROWS.forEach((r, y) =>
    [...r].forEach((c, x) => {
      if (c === 'o') pts.push([x, y])
    })
  )
  return pts.sort(
    (a, b) => Math.atan2(a[1] - 5.5, a[0] - 5.5) - Math.atan2(b[1] - 5.5, b[0] - 5.5)
  )
})()

/** `:55`: the visor pip's 14-frame ping-pong, and the two 8-frame lifts — a hop, a bob. */
export const VEE_PING: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1]
export const VEE_HOP: readonly number[] = [0, 1, 2, 1, 0, 0, 0, 0]
export const VEE_BOB: readonly number[] = [0, 0, 1, 1, 0, 0, 0, 0]

/**
 * `hexGrid(s, f)` (`:56–70`): the 16 × 16 cells of state `s` at frame `f` — a whole number, 0 or
 * more, which is all the clock produces. Coordinates inside are the body's own; eyes are 2 × 2 at
 * (2, 6) and (8, 6).
 *
 *   idle       eyes `e`; a blink on 2 of every 28 frames (the eyes become 2 × 1 at y 7)
 *   thinking   eyes up 1 and darting ±1 every 6 frames; a 3-cell `h` light runs round the rim,
 *              2 cells a frame
 *   reading    an 8 × 2 `k` visor at (2, 6); an `h` pip with `s` side cells sweeps across it
 *   found      eyes `h`; the body hops; a `!` (rows 0, 1, 2 and 4 of column 14) blinks
 *   done       the top facet `t` turns to `o` — the lit V; `^ ^` eyes; a slow bob
 */
export function veeGrid(s: VeeState, f: number): VeeCell[][] {
  const g: VeeCell[][] = Array.from({ length: VEE_SIZE }, () => Array<VeeCell>(VEE_SIZE).fill('.'))
  const put = (x: number, y: number, c: VeeCell): void => {
    if (x >= 0 && x < VEE_SIZE && y >= 0 && y < VEE_SIZE) g[y][x] = c
  }
  const ox = 2
  const oy = 3 - (s === 'found' ? VEE_HOP[f % 8] : s === 'done' ? VEE_BOB[f % 8] : 0)
  const rows = s === 'done' ? VEE_ROWS.map((r) => r.replace(/t/g, 'o')) : VEE_ROWS
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => {
      if (c !== '.') put(ox + x, oy + y, c as VeeCell)
    })
  )
  const P = (x: number, y: number, c: VeeCell): void => put(ox + x, oy + y, c)
  const box = (x: number, y: number, w: number, h: number, c: VeeCell): void => {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) P(x + i, y + j, c)
  }
  const eyes = (dx: number, dy: number, c: VeeCell): void => {
    box(2 + dx, 6 + dy, 2, 2, c)
    box(8 + dx, 6 + dy, 2, 2, c)
  }
  if (s === 'idle') {
    if (f % 28 < 2) {
      box(2, 7, 2, 1, 'e')
      box(8, 7, 2, 1, 'e')
    } else eyes(0, 0, 'e')
  }
  if (s === 'thinking') {
    eyes(f % 12 < 6 ? -1 : 1, -1, 'e')
    for (let i = 0; i < 3; i++) {
      const [x, y] = VEE_PERIM[(f * 2 + i) % VEE_PERIM.length]
      P(x, y, 'h')
    }
  }
  if (s === 'reading') {
    box(2, 6, 8, 2, 'k')
    const x = 2 + VEE_PING[f % 14]
    box(x - 1, 6, 3, 2, 's')
    box(x, 6, 1, 2, 'h')
  }
  if (s === 'found') {
    eyes(0, 0, 'h')
    if (f % 8 < 6) [0, 1, 2, 4].forEach((y) => put(14, y, 'e'))
  }
  if (s === 'done') {
    ;(
      [
        [2, 7],
        [3, 6],
        [4, 7],
        [7, 7],
        [8, 6],
        [9, 7]
      ] as const
    ).forEach(([x, y]) => P(x, y, 'e'))
  }
  return g
}

/** A grid as one string, so "did the drawing change?" is one comparison. */
export const veeKey = (grid: readonly (readonly VeeCell[])[]): string =>
  grid.map((row) => row.join('')).join('\n')

/* ────────────────────────────── the palette ────────────────────────────── */

/**
 * Each role's colour, per theme: a design token (a name starting `--`, read from the document
 * when the sprite is drawn, so it is the variable and never a copy of its hex) or a constant of
 * the mascot's own.
 *
 * **Dark** is the handoff's `HPAL` (`:52`): five of its seven values are the app's own tokens —
 * `o` `--accent`, `b` `--step-bg`, `s` `--border-strong`, `e` `--ink`, `k` `--ground` — and two
 * are new: the highlight `h` and the top facet `t`.
 *
 * **Light** is the port's — the handoff is dark only. The same roles from the light tokens, and
 * three values chosen so every state reads on `--card` and on `--step-bg`:
 *
 *   `k`  `--ink`: the visor is the darkest thing on a light face, as `--ground` is on a dark one.
 *   `t`  `#CBD8D5`: one step darker than the body, at the contrast the dark facet has against
 *        its body (1.31 : 1 against 1.29 : 1); it lies between `--border` and `--border-strong`,
 *        as the dark one does.
 *   `h`  `#35C4B6`: lighter than the light rim (1.96 : 1) and still darker than the page
 *        (1.92 : 1 on `--step-bg`, 2.16 : 1 on `--card`) — the value that balances the two, and
 *        the dark theme's own accent. On the visor it is the bright pip (6.9 : 1).
 */
export const VEE_PALETTE: Readonly<Record<'dark' | 'light', Readonly<Record<VeeRole, string>>>> = {
  dark: {
    o: '--accent',
    h: '#8AF0E4',
    b: '--step-bg',
    t: '#2B3B3A',
    s: '--border-strong',
    e: '--ink',
    k: '--ground'
  },
  light: {
    o: '--accent',
    h: '#35C4B6',
    b: '--step-bg',
    t: '#CBD8D5',
    s: '--border-strong',
    e: '--ink',
    k: '--ink'
  }
}

/* ────────────────────────────── where it stands ────────────────────────────── */

/**
 * The three layout slots, in CSS px: the reference's 32, 28 and 24 px sprites (`px` 2, 1.75 and
 * 1.5 a cell, `:143`, `:315`, `:367`) ÷ 1.5 — the scale between the handoff and the app.
 */
export const VEE_SLOT = { header: 21, label: 19, pill: 16 } as const

/**
 * The frame offsets that keep the idle sprites from blinking in unison: the reference's
 * `hexF + 5`, `+ 11` and `+ 17` (the same three lines).
 */
export const VEE_OFFSET = { header: 5, label: 11, pill: 17 } as const

/**
 * One reply label's offset. The reference has one past reply, at 11; a transcript has many, so
 * each message stands four frames on from the one before it. A blink is two frames long and
 * these are 11, 15, 19, 23, 27, 3, 7 — two or more apart from each other, from the header's 5
 * and from the pill's 17 — so no two of them blink on the same frame until the eighth message.
 */
export const veeLabelOffset = (index: number): number => (VEE_OFFSET.label + 4 * index) % 28

/**
 * Device pixels to a cell: `max(1, round(devicePixelRatio))` — **one rule for every sprite**,
 * whatever slot it stands in. A whole number, so every cell is the same crisp square at any
 * display scaling, and the header's, a label's and the pill's sprites are the same size beside
 * each other.
 *
 * Until the trace was built the rule was per slot, `max(1, round(slot × ratio / 16))`. That is
 * the same number at 100, 150, 175 and 250 %; at 125 % and 200 % it drew the header's sprite one
 * step larger than the two beside it (25.6 px against 12.8 px at 125 %).
 */
export const veeCell = (dpr: number): number => Math.max(1, Math.round(dpr))

/** The canvas in its slot. */
export interface VeeBox {
  /** Device pixels to a cell. */
  cell: number
  /** The backing store's width and height, in device pixels: 16 cells. */
  px: number
  /** The canvas's CSS width and height. */
  size: number
  /** Its CSS `left` and `top` inside the slot. */
  inset: number
}

/**
 * The canvas for a `slot` (CSS px) at a device pixel ratio: 16 whole-pixel cells, centred in the
 * slot on a whole device pixel of it. The sprite is one size for every slot (`veeCell`), so it
 * may be smaller than its slot or stand a little outside it; the slot is what the layout sees.
 *
 * `size` is rounded **up** in its third decimal: Chromium truncates a length to 1/64 px, and
 * `21.333px` at 1.5× is 31.98 device pixels — one short, on an unlucky sub-pixel position.
 */
export function veeBox(slot: number, dpr: number): VeeBox {
  const cell = veeCell(dpr)
  const px = cell * VEE_SIZE
  return {
    cell,
    px,
    size: Math.ceil((px / dpr) * 1000) / 1000,
    inset: Math.round((slot * dpr - px) / 2) / dpr || 0
  }
}

/* ────────────────────────────── the clock's rule ────────────────────────────── */

/**
 * Whether the 8 fps clock counts at all: only while a sprite is mounted and the window is
 * visible, and never under `prefers-reduced-motion: reduce` or while the dev harness has pinned
 * the frame. While it counts it still **sleeps** between the frames at which a mounted sprite's
 * drawing changes — `veeNextWake` below.
 */
export const veeClockRuns = (
  mounted: number,
  visible: boolean,
  reducedMotion: boolean,
  pinned: boolean
): boolean => mounted > 0 && visible && !reducedMotion && !pinned

/**
 * The frame every sprite starts from: the pinned one, else 0 under reduced motion — each sprite
 * holds one frame of its state — else the clock's.
 */
export const veeFrame = (clock: number, reducedMotion: boolean, pinned: number | null): number =>
  pinned ?? (reducedMotion ? 0 : clock)

/**
 * The frame one sprite draws.
 *
 * `idle` stands `offset` frames ahead of the clock, which is what keeps two sprites side by side
 * from blinking together. **Every other state plays from its own first frame**: `since` is the
 * clock's frame when the sprite entered the state. The reference feeds every sprite one global
 * frame, so its half-second `found` shows whichever four frames of the eight-frame hop the clock
 * happens to be on — sometimes none of the hop at all; counted from the state's start it is the
 * hop itself (0, 1, 2, 1), which is what the handoff's README asks for: "one hop per finding".
 *
 * Held still — pinned by the dev harness, or under reduced motion — a state other than `idle`
 * shows the held frame itself, so under reduced motion it is frame 0 of the state.
 */
export function veeSpriteFrame(
  state: VeeState,
  offset: number,
  since: number,
  clock: number,
  reducedMotion: boolean,
  pinned: number | null
): number {
  const base = veeFrame(clock, reducedMotion, pinned)
  if (state === 'idle') return base + offset
  return pinned !== null || reducedMotion ? base : Math.max(0, base - since)
}

/** Every period in the drawing divides this: 28 (the blink), 12 (the dart), 16 (the rim), 14 (the pip), 8. */
export const VEE_CYCLE = 336

/** Per state, for each frame of one cycle: how many frames until the drawing next differs. */
const gapTables = new Map<VeeState, Uint16Array>()

function gapsOf(state: VeeState): Uint16Array {
  const known = gapTables.get(state)
  if (known) return known
  // Read off the drawing itself, so the rule can never drift from `veeGrid`.
  const keys = Array.from({ length: VEE_CYCLE }, (_, f) => veeKey(veeGrid(state, f)))
  const gaps = new Uint16Array(VEE_CYCLE)
  for (let f = 0; f < VEE_CYCLE; f++) {
    let d = 1
    while (d < VEE_CYCLE && keys[(f + d) % VEE_CYCLE] === keys[f]) d++
    gaps[f] = d
  }
  gapTables.set(state, gaps)
  return gaps
}

/**
 * The first frame after `frame` at which `state`'s drawing differs from the one at `frame`.
 * `idle`: the blink's two edges, 2 and 26 frames apart. `thinking` and `reading`: the next
 * frame, always. `found`: its hop and the `!`'s blink. `done`: the bob's two edges.
 */
export function veeNextChange(state: VeeState, frame: number): number {
  const f = ((Math.floor(frame) % VEE_CYCLE) + VEE_CYCLE) % VEE_CYCLE
  return frame + gapsOf(state)[f]
}

/** One mounted sprite as the clock sees it: its state, and the frames it stands ahead of the clock. */
export interface VeeMounted {
  state: VeeState
  /** `offset` for `idle`; `−since` for a state that plays from its own first frame. */
  offset: number
}

/**
 * **When the clock next has anything to do**: the first clock frame after `clock` at which some
 * mounted sprite's drawing changes, or `null` with none mounted. Between now and then every
 * sprite would be redrawn exactly as it stands, so the clock sleeps: three idle sprites wake it
 * twelve times in seven seconds, not fifty-six.
 */
export function veeNextWake(sprites: readonly VeeMounted[], clock: number): number | null {
  let next: number | null = null
  for (const s of sprites) {
    const at = veeNextChange(s.state, clock + s.offset) - s.offset
    if (next === null || at < next) next = at
  }
  return next
}
