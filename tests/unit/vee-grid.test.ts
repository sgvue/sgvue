/**
 * Vee, the assistant's pixel mascot — `src/renderer/app/vee-grid.ts`, the pure half.
 *
 * The specification is the owner's "Ask Vee" handoff, kept unchanged in
 * `design-reference/ask-vee/`: `ask-thinking-hex.jsx` is the reference code and `README.md` the
 * words. So the port is checked **against the handoff itself** — its `hexGrid` is cut out of the
 * jsx and run, and `veeGrid` has to give the same 256 cells for every state at every frame of a
 * whole cycle — and then against what the README says each state draws, so a reader can see the
 * drawing without running anything.
 *
 * Also here: the palette's roles through the app's own tokens, the device-pixel rule that keeps
 * the cells whole at any display scaling, and the rule the 8 fps clock runs by.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  VEE_BOB,
  VEE_CYCLE,
  VEE_FRAME_MS,
  VEE_HOP,
  VEE_OFFSET,
  VEE_PALETTE,
  VEE_PERIM,
  VEE_PING,
  VEE_ROWS,
  VEE_SIZE,
  VEE_SLOT,
  veeBox,
  veeCell,
  veeClockRuns,
  veeFrame,
  veeGrid,
  veeKey,
  veeLabelOffset,
  veeNextChange,
  veeNextWake,
  veeSpriteFrame,
  type VeeCell,
  type VeeRole,
  type VeeState
} from '../../src/renderer/app/vee-grid'

const ROOT = join(__dirname, '..', '..')
const JSX = readFileSync(join(ROOT, 'design-reference/ask-vee/ask-thinking-hex.jsx'), 'utf8')
const README = readFileSync(join(ROOT, 'design-reference/ask-vee/README.md'), 'utf8')
const CSS = readFileSync(join(ROOT, 'src/renderer/styles/design.css'), 'utf8')

const STATES: VeeState[] = ['idle', 'thinking', 'reading', 'found', 'done']

/** The handoff's sprite code as it is written — `HPAL` … `hexGrid`, `:52–70` — run unchanged. */
const reference = (() => {
  const from = JSX.indexOf('const HPAL')
  const to = JSX.indexOf('function HexSprite')
  if (from < 0 || to < from) throw new Error('ask-thinking-hex.jsx: the sprite code was not found')
  return new Function(
    `${JSX.slice(from, to)}\nreturn { HPAL, HEX_ROWS, HEX_PERIM, PING, HOP, BOB, hexGrid }`
  )() as {
    HPAL: Record<VeeRole, string>
    HEX_ROWS: string[]
    HEX_PERIM: [number, number][]
    PING: number[]
    HOP: number[]
    BOB: number[]
    hexGrid: (s: string, f: number) => string[][]
  }
})()

/** Every period in the drawing divides this: 28 (blink), 12 (dart), 16 (rim), 14 (pip), 8. */
const CYCLE = 336

/** The body's own cell `(x, y)`, with the body's top at grid row `oy` (3 at rest). */
const at = (g: VeeCell[][], x: number, y: number, oy = 3): VeeCell => g[oy + y][2 + x]

/** Every grid cell holding `role`, as `x,y` in grid coordinates. */
const cellsOf = (g: VeeCell[][], role: VeeCell): string[] =>
  g.flatMap((row, y) => row.flatMap((c, x) => (c === role ? [`${x},${y}`] : [])))

/** A 2 × 2 block of body cells whose top-left is `(x, y)`. */
const block = (g: VeeCell[][], x: number, y: number, oy = 3): VeeCell[] => [
  at(g, x, y, oy),
  at(g, x + 1, y, oy),
  at(g, x, y + 1, oy),
  at(g, x + 1, y + 1, oy)
]

describe('veeGrid is the handoff’s hexGrid', () => {
  it('gives the same 16 × 16 cells for every state at every frame of two whole cycles', () => {
    const wrong: string[] = []
    for (const s of STATES) {
      for (let f = 0; f < 2 * CYCLE; f++) {
        const ours = veeGrid(s, f)
        expect(ours).toHaveLength(VEE_SIZE)
        expect(ours.every((row) => row.length === VEE_SIZE)).toBe(true)
        if (veeKey(ours) !== reference.hexGrid(s, f).map((r) => r.join('')).join('\n')) wrong.push(`${s}@${f}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('carries the handoff’s tables unchanged', () => {
    expect(VEE_ROWS).toEqual(reference.HEX_ROWS)
    expect(VEE_PERIM).toEqual(reference.HEX_PERIM)
    expect(VEE_PING).toEqual(reference.PING)
    expect(VEE_HOP).toEqual(reference.HOP)
    expect(VEE_BOB).toEqual(reference.BOB)
    expect(VEE_SIZE).toBe(16)
    // 8 frames a second.
    expect(VEE_FRAME_MS).toBe(1000 / 8)
  })

  it('has the body the README draws: 12 × 12, a rim of 32 cells', () => {
    const drawn = /\*\*Body\*\*[^\n]*\n```\n([\s\S]*?)\n```/.exec(README.replace(/\r\n/g, '\n'))
    expect(drawn).not.toBeNull()
    expect(drawn![1].split('\n')).toEqual([...VEE_ROWS])
    expect(VEE_ROWS).toHaveLength(12)
    expect(VEE_ROWS.every((r) => r.length === 12)).toBe(true)
    expect(VEE_PERIM).toHaveLength(32)
    expect(VEE_ROWS.join('').replace(/[^o]/g, '')).toHaveLength(32)
  })
})

describe('what each state draws (README, "Vee — pixel mascot")', () => {
  /** The body with nothing on its face: the README's rows, placed at (2, 3). */
  const plain = (rows: readonly string[] = VEE_ROWS, oy = 3): string => {
    const g: string[][] = Array.from({ length: 16 }, () => Array(16).fill('.'))
    rows.forEach((r, y) => [...r].forEach((c, x) => void (c !== '.' && (g[oy + y][2 + x] = c))))
    return g.map((r) => r.join('')).join('\n')
  }
  /** A grid with every face cell (eyes, visor, pip, `!`, rim light) put back to the body under it. */
  const faceless = (g: VeeCell[][], rows: readonly string[] = VEE_ROWS, oy = 3): string => {
    const base = plain(rows, oy).split('\n')
    return g
      .map((row, y) => row.map((c, x) => ('ehks'.includes(c) ? base[y][x] : c)).join(''))
      .join('\n')
  }

  it('idle: eyes 2 × 2 at (2, 6) and (8, 6), and a blink on 2 of every 28 frames', () => {
    const open = veeGrid('idle', 5)
    expect(block(open, 2, 6)).toEqual(['e', 'e', 'e', 'e'])
    expect(block(open, 8, 6)).toEqual(['e', 'e', 'e', 'e'])
    expect(cellsOf(open, 'e')).toHaveLength(8)
    // Under the eyes it is the body exactly as drawn, standing at (2, 3).
    expect(faceless(open)).toBe(plain())

    // Frame 0 is the blink: the eyes become 2 × 1 at y 7.
    const shut = veeGrid('idle', 0)
    expect(block(shut, 2, 6)).toEqual(['b', 'b', 'e', 'e'])
    expect(block(shut, 8, 6)).toEqual(['b', 'b', 'e', 'e'])
    expect(cellsOf(shut, 'e')).toHaveLength(4)
    expect(faceless(shut)).toBe(plain())

    const blinks = Array.from({ length: 28 }, (_, f) => f).filter(
      (f) => veeKey(veeGrid('idle', f)) === veeKey(shut)
    )
    expect(blinks).toEqual([0, 1])
    // …and every other frame of the 28 is the open face; then it comes round again.
    for (let f = 2; f < 28; f++) expect(veeKey(veeGrid('idle', f))).toBe(veeKey(open))
    expect(veeKey(veeGrid('idle', 28))).toBe(veeKey(shut))
    expect(veeKey(veeGrid('idle', 30))).toBe(veeKey(open))
  })

  it('thinking: eyes up 1 and darting every 6 frames; a 3-cell light round the rim, 2 cells a frame', () => {
    for (let f = 0; f < 48; f++) {
      const g = veeGrid('thinking', f)
      // Up one row, and one column left for six frames, then one right for six.
      const dx = f % 12 < 6 ? -1 : 1
      expect(block(g, 2 + dx, 5)).toEqual(['e', 'e', 'e', 'e'])
      expect(block(g, 8 + dx, 5)).toEqual(['e', 'e', 'e', 'e'])
      expect(cellsOf(g, 'e')).toHaveLength(8)
      // Three rim cells are lit, and they are the three that follow each other on the rim.
      const lit = [0, 1, 2].map((i) => VEE_PERIM[(2 * f + i) % 32]).map(([x, y]) => `${x + 2},${y + 3}`)
      expect(cellsOf(g, 'h').sort()).toEqual([...lit].sort())
      expect(cellsOf(g, 'o')).toHaveLength(32 - 3)
      expect(faceless(g)).toBe(plain())
    }
    // The dart: frames 0–5 look left, 6–11 right, 12 left again.
    const eyes = (f: number): string => cellsOf(veeGrid('thinking', f), 'e').join(' ')
    expect(eyes(0)).toBe(eyes(5))
    expect(eyes(6)).toBe(eyes(11))
    expect(eyes(0)).not.toBe(eyes(6))
    expect(eyes(12)).toBe(eyes(0))
    // The light is back where it started after 16 frames: 32 rim cells, 2 a frame.
    expect(cellsOf(veeGrid('thinking', 16), 'h')).toEqual(cellsOf(veeGrid('thinking', 0), 'h'))
    expect(cellsOf(veeGrid('thinking', 1), 'h')).not.toEqual(cellsOf(veeGrid('thinking', 0), 'h'))
  })

  it('reading: an 8 × 2 visor at (2, 6), and a pip with dim sides on a 14-frame ping-pong', () => {
    const pipAt: number[] = []
    for (let f = 0; f < 28; f++) {
      const g = veeGrid('reading', f)
      const x = 2 + VEE_PING[f % 14]
      pipAt.push(x)
      for (const y of [6, 7]) {
        // The visor is rows 6 and 7 of columns 2…9; the pip is one column of `h`, with one
        // column of `s` on either side of it (which at either end stands just off the visor).
        for (let c = 1; c <= 10; c++) {
          const want = c === x ? 'h' : c === x - 1 || c === x + 1 ? 's' : c >= 2 && c <= 9 ? 'k' : 'b'
          expect([f, c, y, at(g, c, y)]).toEqual([f, c, y, want])
        }
      }
      expect(cellsOf(g, 'h')).toHaveLength(2)
      expect(cellsOf(g, 's')).toHaveLength(4)
      expect(cellsOf(g, 'e')).toHaveLength(0)
      expect(faceless(g)).toBe(plain())
    }
    // Across the visor and back, twice.
    const sweep = [2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 3]
    expect(pipAt).toEqual([...sweep, ...sweep])
    // Frame 0, the visor's upper row as drawn: rim, a dim cell, the pip, a dim cell, visor.
    expect(veeGrid('reading', 0)[3 + 6].join('')).toBe('..oshskkkkkkbo..')
  })

  it('found: eyes lit, the body hops 0, 1, 2, 1, 0, 0, 0, 0, and a `!` blinks in column 14', () => {
    for (let f = 0; f < 16; f++) {
      const g = veeGrid('found', f)
      const oy = 3 - VEE_HOP[f % 8]
      expect(block(g, 2, 6, oy)).toEqual(['h', 'h', 'h', 'h'])
      expect(block(g, 8, 6, oy)).toEqual(['h', 'h', 'h', 'h'])
      expect(cellsOf(g, 'h')).toHaveLength(8)
      // The `!`: rows 0, 1, 2 and 4 of column 14 — the grid's own, it does not hop — on six of
      // every eight frames.
      expect(cellsOf(g, 'e')).toEqual(f % 8 < 6 ? ['14,0', '14,1', '14,2', '14,4'] : [])
      expect(faceless(g, VEE_ROWS, oy)).toBe(plain(VEE_ROWS, oy))
    }
    // The hop, read off the drawing: how far the rim's top row stands above its place at rest.
    const lift = (f: number): number =>
      3 - Math.min(...cellsOf(veeGrid('found', f), 'o').map((c) => Number(c.split(',')[1])))
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(lift)).toEqual([0, 1, 2, 1, 0, 0, 0, 0])
  })

  it('done: the top facet lit, `^ ^` eyes, and a slow bob 0, 0, 1, 1, 0, 0, 0, 0', () => {
    const lit = VEE_ROWS.map((r) => r.replace(/t/g, 'o'))
    for (let f = 0; f < 16; f++) {
      const g = veeGrid('done', f)
      const oy = 3 - VEE_BOB[f % 8]
      // No facet cell is left: every one of the 26 is the rim's colour now — the lit V.
      expect(cellsOf(g, 't')).toHaveLength(0)
      expect(cellsOf(g, 'o')).toHaveLength(32 + 26)
      // `^ ^`: three cells an eye, the middle one a row higher.
      const eyes = [[2, 7], [3, 6], [4, 7], [7, 7], [8, 6], [9, 7]].map(([x, y]) => `${x + 2},${y + oy}`)
      expect(cellsOf(g, 'e').sort()).toEqual([...eyes].sort())
      expect(faceless(g, lit, oy)).toBe(plain(lit, oy))
    }
    expect(VEE_ROWS.join('').replace(/[^t]/g, '')).toHaveLength(26)
  })

  it('never draws outside the grid, and uses only the seven roles', () => {
    for (const s of STATES) {
      for (let f = 0; f < CYCLE; f++) {
        expect(veeKey(veeGrid(s, f))).toMatch(/^([.ohbtsek]{16}\n){15}[.ohbtsek]{16}$/)
      }
    }
  })
})

/* ────────────────────────────── the palette ────────────────────────────── */

/** `--name: value` pairs of one rule of `styles/design.css`. */
const tokens = (rule: RegExp): Record<string, string> => {
  const body = rule.exec(CSS)
  expect(body).not.toBeNull()
  return Object.fromEntries([...body![1].matchAll(/(--[\w-]+):([^;}]+)/g)].map((m) => [m[1], m[2].trim()]))
}
const DARK = tokens(/:root\{([^}]*)\}/)
const LIGHT = { ...DARK, ...tokens(/:root\[data-theme="light"\]\{([^}]*)\}/) }

const resolve = (theme: 'dark' | 'light'): Record<VeeRole, string> => {
  const from = theme === 'dark' ? DARK : LIGHT
  return Object.fromEntries(
    Object.entries(VEE_PALETTE[theme]).map(([role, v]) => [role, (v.startsWith('--') ? from[v] : v).toUpperCase()])
  ) as Record<VeeRole, string>
}

/** WCAG contrast of two `#RRGGBB` colours. */
const contrast = (a: string, b: string): number => {
  const lum = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('the palette', () => {
  it('is the handoff’s, in the dark theme — five roles through the app’s own tokens', () => {
    expect(resolve('dark')).toEqual(
      Object.fromEntries(Object.entries(reference.HPAL).map(([k, v]) => [k, v.toUpperCase()]))
    )
    // The README states the same seven.
    for (const [role, hex] of Object.entries(reference.HPAL)) {
      expect([role, README.includes(`\`${role} ${hex}\``)]).toEqual([role, true])
    }
    // Tokens wherever one exists; the two that have none are the mascot's own constants.
    expect(VEE_PALETTE.dark).toEqual({
      o: '--accent',
      h: '#8AF0E4',
      b: '--step-bg',
      t: '#2B3B3A',
      s: '--border-strong',
      e: '--ink',
      k: '--ground'
    })
  })

  it('keeps the same roles on the same tokens in the light theme', () => {
    for (const role of ['o', 'b', 's', 'e'] as const) {
      expect([role, VEE_PALETTE.light[role]]).toEqual([role, VEE_PALETTE.dark[role]])
    }
    expect(Object.keys(VEE_PALETTE.light).sort()).toEqual(Object.keys(VEE_PALETTE.dark).sort())
    // Every value is a token the stylesheet defines, or a `#RRGGBB` constant.
    for (const theme of ['dark', 'light'] as const) {
      for (const [role, colour] of Object.entries(resolve(theme))) {
        expect([theme, role, /^#[0-9A-F]{6}$/.test(colour)]).toEqual([theme, role, true])
      }
    }
  })

  it('reads in the light theme, on --card and on --step-bg', () => {
    const p = resolve('light')
    const [card, step] = [LIGHT['--card'], LIGHT['--step-bg']]
    // The three values the port chose: the visor, the top facet, the highlight.
    expect([VEE_PALETTE.light.k, VEE_PALETTE.light.t, VEE_PALETTE.light.h]).toEqual(['--ink', '#CBD8D5', '#35C4B6'])
    for (const page of [card, step]) {
      // The rim draws the creature on either page, and the eyes read on its face.
      expect(contrast(p.o, page)).toBeGreaterThan(3)
      // The rim light is lighter than the rim and darker than the page — it reads against both.
      expect(contrast(p.h, page)).toBeGreaterThan(1.9)
    }
    expect(contrast(p.h, p.o)).toBeGreaterThan(1.9)
    expect(contrast(p.e, p.b)).toBeGreaterThan(7)
    // The visor is clearly darker than the body, and the pip is bright on it.
    expect(contrast(p.k, p.b)).toBeGreaterThan(7)
    expect(contrast(p.h, p.k)).toBeGreaterThan(4.5)
    // The top facet is one step darker than the body: as far from it as the dark one is from its.
    const d = resolve('dark')
    expect(contrast(p.t, p.b)).toBeCloseTo(contrast(d.t, d.b), 1)
    expect(contrast(p.t, p.b)).toBeGreaterThan(1.25)
  })
})

/* ────────────────────────────── size and place ────────────────────────────── */

describe('the device-pixel rule', () => {
  it('draws a whole number of device pixels to a cell — one number for every sprite: max(1, round(dpr))', () => {
    const ratios = [1, 1.25, 1.5, 1.75, 2, 2.5, 3]
    expect(ratios.map(veeCell)).toEqual([1, 1, 2, 2, 2, 3, 3])
    // Never less than one pixel a cell, however small the ratio; always a whole number.
    expect(veeCell(0.5)).toBe(1)
    for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) expect(Number.isInteger(veeCell(dpr))).toBe(true)
    // The slot does not enter into it: the header's, a label's and the pill's sprites are one
    // size at every ratio.
    for (const dpr of ratios) {
      const sizes = [VEE_SLOT.header, VEE_SLOT.label, VEE_SLOT.pill].map((slot) => veeBox(slot, dpr).px)
      expect([dpr, new Set(sizes).size]).toEqual([dpr, 1])
    }
    // The rule it replaces was per slot, `max(1, round(slot × dpr / 16))`: the same number at
    // 100, 150, 175 and 250 %, and a header sprite one step larger at 125 % and 200 %.
    const perSlot = (slot: number, dpr: number): number => Math.max(1, Math.round((slot * dpr) / 16))
    for (const dpr of [1, 1.5, 1.75, 2.5]) {
      for (const slot of [16, 19, 21]) expect([dpr, slot, perSlot(slot, dpr)]).toEqual([dpr, slot, veeCell(dpr)])
    }
    expect([perSlot(21, 1.25), perSlot(19, 1.25), veeCell(1.25)]).toEqual([2, 1, 1])
    expect([perSlot(21, 2), perSlot(19, 2), veeCell(2)]).toEqual([3, 2, 2])
  })

  it('sizes the canvas to exactly those pixels and centres it in its slot on a whole one', () => {
    for (const slot of [16, 19, 21]) {
      for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
        const box = veeBox(slot, dpr)
        const where = `slot ${slot} at ${dpr}`
        expect([where, box.cell, box.px]).toEqual([where, veeCell(dpr), 16 * veeCell(dpr)])
        // What Chromium keeps of the CSS length — it truncates to 1/64 px — is the backing
        // store's size exactly, so one canvas pixel is one device pixel.
        expect([where, Math.floor(box.size * dpr * 64) / 64]).toEqual([where, box.px])
        expect(box.size * dpr - box.px).toBeLessThan(0.001 * dpr + 1e-9)
        // The inset is a whole number of device pixels, and it centres the canvas to within one.
        const inset = box.inset * dpr
        expect([where, Math.abs(inset - Math.round(inset)) < 1e-9]).toEqual([where, true])
        expect(Math.abs(slot * dpr - box.px - 2 * inset)).toBeLessThanOrEqual(1 + 1e-9)
        expect(Object.is(box.inset, -0)).toBe(false)
      }
    }
    // At 100 % all three are the 16 px grid; at 150 %, 32 device pixels — 21.33 px, the
    // reference's own header sprite.
    expect([21, 19, 16].map((slot) => veeBox(slot, 1))).toEqual([
      { cell: 1, px: 16, size: 16, inset: 3 },
      { cell: 1, px: 16, size: 16, inset: 2 },
      { cell: 1, px: 16, size: 16, inset: 0 }
    ])
    expect(veeBox(21, 1.5)).toEqual({ cell: 2, px: 32, size: 21.334, inset: 0 })
    // At 200 % every sprite is 32 device pixels — 16 CSS px — centred in its slot: 2.5 px in
    // from the header slot's edge, 1.5 from a label's, 0 from the pill's.
    expect([21, 19, 16].map((slot) => veeBox(slot, 2))).toEqual([
      { cell: 2, px: 32, size: 16, inset: 2.5 },
      { cell: 2, px: 32, size: 16, inset: 1.5 },
      { cell: 2, px: 32, size: 16, inset: 0 }
    ])
    // At 125 % the same 16 device pixels in all three: 12.8 CSS px.
    expect([21, 19, 16].map((slot) => veeBox(slot, 1.25).size)).toEqual([12.8, 12.8, 12.8])
  })

  it('takes its three slots and its three frame offsets from the reference, ÷ 1.5', () => {
    // `<HexSprite state="idle" f={hexF + 5} px={2} …>` — the header, a reply label, the pill.
    const idle = [...JSX.matchAll(/<HexSprite state="idle" f=\{hexF \+ (\d+)\} px=\{([\d.]+)\}/g)].map(
      (m) => ({ offset: Number(m[1]), slot: Math.round((16 * Number(m[2])) / 1.5) })
    )
    expect(idle).toEqual([
      { offset: VEE_OFFSET.header, slot: VEE_SLOT.header },
      { offset: VEE_OFFSET.label, slot: VEE_SLOT.label },
      { offset: VEE_OFFSET.pill, slot: VEE_SLOT.pill }
    ])
    expect([VEE_SLOT.header, VEE_SLOT.label, VEE_SLOT.pill]).toEqual([21, 19, 16])
    expect([VEE_OFFSET.header, VEE_OFFSET.label, VEE_OFFSET.pill]).toEqual([5, 11, 17])
  })

  it('never has the header, the pill and seven replies in a row blink on the same frame', () => {
    expect(veeLabelOffset(0)).toBe(VEE_OFFSET.label)
    const offsets = [VEE_OFFSET.header, VEE_OFFSET.pill, ...[0, 1, 2, 3, 4, 5, 6].map(veeLabelOffset)]
    const shut = veeKey(veeGrid('idle', 0))
    const blinking = (clock: number): number =>
      offsets.filter((d) => veeKey(veeGrid('idle', clock + d)) === shut).length
    for (let clock = 0; clock < 56; clock++) expect([clock, blinking(clock) <= 1]).toEqual([clock, true])
    // At clock frame 0 — where a pinned or reduced-motion sprite stands — every one has its eyes open.
    expect(blinking(0)).toBe(0)
    // The eighth message comes round to the first one's offset.
    expect(veeLabelOffset(7)).toBe(veeLabelOffset(0))
  })
})

describe('the clock’s rule', () => {
  it('ticks only with a sprite mounted, the window visible, motion allowed and no pinned frame', () => {
    expect(veeClockRuns(1, true, false, false)).toBe(true)
    expect(veeClockRuns(12, true, false, false)).toBe(true)
    expect(veeClockRuns(0, true, false, false)).toBe(false)
    expect(veeClockRuns(1, false, false, false)).toBe(false)
    // `prefers-reduced-motion: reduce`: it does not run at all.
    expect(veeClockRuns(1, true, true, false)).toBe(false)
    expect(veeClockRuns(1, true, false, true)).toBe(false)
  })

  it('shows the clock’s frame, frame 0 under reduced motion, and a pinned frame over both', () => {
    expect(veeFrame(37, false, null)).toBe(37)
    expect(veeFrame(37, true, null)).toBe(0)
    expect(veeFrame(37, false, 4)).toBe(4)
    expect(veeFrame(37, true, 4)).toBe(4)
    expect(veeFrame(37, false, 0)).toBe(0)
  })

  /**
   * Which frame one sprite draws. `idle` stands its offset ahead of the clock; every other state
   * is counted from the frame the sprite entered it, so `found` — half a second, four frames —
   * is the hop itself and not whichever four frames of eight the clock happens to be on.
   */
  it('stands an idle sprite ahead of the clock, and plays every other state from its own start', () => {
    expect(veeSpriteFrame('idle', 11, 0, 37, false, null)).toBe(48)
    // `since` is not `idle`'s business.
    expect(veeSpriteFrame('idle', 11, 30, 37, false, null)).toBe(48)
    // Entered at clock frame 30, seen at 30, 31, 32, 33: frames 0, 1, 2, 3 — the hop, 0 1 2 1.
    const hop = [30, 31, 32, 33].map((clock) => veeSpriteFrame('found', 11, 30, clock, false, null))
    expect(hop).toEqual([0, 1, 2, 3])
    expect(hop.map((f) => VEE_HOP[f % 8])).toEqual([0, 1, 2, 1])
    // Under reduced motion each state holds its frame 0, and `idle` its open-eyed one.
    for (const s of ['thinking', 'reading', 'found', 'done'] as const) {
      expect([s, veeSpriteFrame(s, 11, 30, 37, true, null)]).toEqual([s, 0])
    }
    expect(veeSpriteFrame('idle', 11, 30, 37, true, null)).toBe(11)
    // Pinned, a state shows the pinned frame itself, and `idle` its offset beyond it.
    expect(veeSpriteFrame('reading', 11, 30, 37, false, 5)).toBe(5)
    expect(veeSpriteFrame('idle', 11, 30, 37, false, 5)).toBe(16)
    // Never before a state's first frame.
    expect(veeSpriteFrame('done', 0, 40, 37, false, null)).toBe(0)
  })

  /** When a state's drawing next differs — read off `veeGrid` itself, checked here against it. */
  it('knows the next frame at which each state’s drawing changes', () => {
    for (const s of STATES) {
      for (let f = 0; f < VEE_CYCLE + 40; f++) {
        const next = veeNextChange(s, f)
        expect(next).toBeGreaterThan(f)
        const now = veeKey(veeGrid(s, f))
        // Nothing changes before it…
        for (let g = f + 1; g < next; g++) expect([s, f, g, veeKey(veeGrid(s, g)) === now]).toEqual([s, f, g, true])
        // …and something does at it.
        expect([s, f, veeKey(veeGrid(s, next)) === now]).toEqual([s, f, false])
      }
    }
    // `idle`: the blink's two edges — frames 0 and 2 of every 28.
    expect([0, 1, 2, 5, 27, 28, 29, 30].map((f) => veeNextChange('idle', f))).toEqual([2, 2, 28, 28, 28, 30, 30, 56])
    // `thinking` and `reading` change every frame.
    for (let f = 0; f < 60; f++) {
      expect(veeNextChange('thinking', f)).toBe(f + 1)
      expect(veeNextChange('reading', f)).toBe(f + 1)
    }
    // `found`: the hop (0 1 2 1 0) and the `!` going out for frames 6 and 7.
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((f) => veeNextChange('found', f))).toEqual([1, 2, 3, 4, 6, 6, 8, 8])
    // `done`: the bob's two edges — twice in eight frames, not eight times.
    expect([0, 1, 2, 3, 4, 7, 8].map((f) => veeNextChange('done', f))).toEqual([2, 2, 4, 4, 10, 10, 10])
    expect(VEE_CYCLE).toBe(336)
  })

  /**
   * The clock sleeps until the next frame at which some mounted sprite's drawing changes. The
   * header's, the first reply's and the pill's sprites, all at rest: twelve wake-ups in seven
   * seconds — the two edges of each one's blink, twice round — where a fixed 8 fps tick is 56.
   */
  it('wakes only when a mounted sprite’s drawing will change', () => {
    expect(veeNextWake([], 0)).toBeNull()
    const rest = [VEE_OFFSET.header, veeLabelOffset(0), VEE_OFFSET.pill].map((offset) => ({ state: 'idle' as const, offset }))
    const wakes: number[] = []
    for (let clock = 0; ; ) {
      const next = veeNextWake(rest, clock)!
      if (next >= 56) break
      wakes.push(next)
      clock = next
    }
    // Offsets 5, 11 and 17: each sprite shuts at clock 23 / 17 / 11 and opens two frames later.
    expect(wakes).toEqual([11, 13, 17, 19, 23, 25, 39, 41, 45, 47, 51, 53])
    // Every wake is a frame at which exactly one of the three is redrawn — none is wasted.
    for (const w of wakes) {
      const changed = rest.filter((sp) => veeKey(veeGrid('idle', w + sp.offset)) !== veeKey(veeGrid('idle', w - 1 + sp.offset)))
      expect([w, changed.length]).toEqual([w, 1])
    }
    // The pill alone: 2 wake-ups a blink.
    expect(veeNextWake([{ state: 'idle', offset: 17 }], 0)).toBe(11)
    expect(veeNextWake([{ state: 'idle', offset: 17 }], 11)).toBe(13)
    expect(veeNextWake([{ state: 'idle', offset: 17 }], 13)).toBe(39)
    // A sprite in a state that moves every frame keeps the clock at 8 fps…
    expect(veeNextWake([...rest, { state: 'reading', offset: -4 }], 4)).toBe(5)
    expect(veeNextWake([...rest, { state: 'thinking', offset: -4 }], 9)).toBe(10)
    // …`done`, entered at clock frame 40, only at the bob's edges…
    expect(veeNextWake([{ state: 'done', offset: -40 }], 40)).toBe(42)
    expect(veeNextWake([{ state: 'done', offset: -40 }], 42)).toBe(44)
    expect(veeNextWake([{ state: 'done', offset: -40 }], 44)).toBe(50)
    // …and the earliest of several is the one that counts.
    expect(veeNextWake([{ state: 'done', offset: -40 }, { state: 'idle', offset: 17 }], 44)).toBe(50)
    expect(veeNextWake([{ state: 'done', offset: -40 }, { state: 'idle', offset: 5 }], 44)).toBe(50)
    expect(veeNextWake([{ state: 'done', offset: -40 }, { state: 'idle', offset: 7 }], 44)).toBe(49)
  })
})
