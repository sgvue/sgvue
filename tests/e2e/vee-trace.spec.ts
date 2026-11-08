/**
 * The assistant's thinking trace, in the built app. Run it only through `node scripts/safe-e2e.cjs`
 * (`npm run test:e2e`).
 *
 * 2026-10-01 — the owner's "Ask Vee" handoff (`design-reference/ask-vee/`): a running turn is
 * drawn from its own events. **2026-11-08 — rewritten for "Vee Messages"** (stage 1, the approved
 * prototype `prototypes/vee-messages/full/`): the Ask Vee window is a messaging conversation, and
 * the trace's look and its answer are the app's own. While a turn runs, Vee's bubble is typing
 * dots, then a diary — `Thinking`, the seconds since Send, every step with its live count, over the
 * element matrix; at the answer the diary folds into one dashed line that reopens, and the reply's
 * parts — a bubble a block, then its cards — land one after another on the row they settle in
 * (`answerFrame`, `data-land`). The status beside the name, the ticker bubble and the word-by-word
 * reveal are gone; what the old spec proved is proved here again where it still applies:
 *
 *   · the answer is never delayed by animation, and its numbers are the federation's own;
 *   · the frame loop ends at most 1.95 s after `done`, and nothing moves afterwards;
 *   · the parts land at most 110 ms apart, all within half a second of the answer;
 *   · every lift, canvas and sprite stands on whole device pixels;
 *   · under reduced motion every state shows at its end, and nothing in between;
 *   · a stopped or failed turn leaves the transcript as it was, and says honestly whether
 *     anything had changed;
 *   · a Check keeps the matrix width it started with when the window is resized under it.
 *
 * **No API, no key, and no `window.__sgvueDev`** — the suite runs against the production bundle,
 * which has none. Main's two turn handlers are replaced from the test (`holdTurns`), which then
 * sends a turn's events and tool calls over the real channels, at its own pace; everything on the
 * renderer's side is the app's own: `sendChat`, the real executors on the demo building, the
 * trace, the Vee window. `E2E_KEY` (`helpers.ts`) is a stand-in, never sent anywhere.
 *
 * The demo building is the design's mock federation: 4 models, 412 elements, 80 walls, 24 of
 * them with no `ThermalTransmittance` — five on each of L1 … L4 and four on the roof.
 *
 * 2026-10-02 — the last test is the reply's `revert`, widened (owner-approved): it puts back
 * everything that reply changed — the theme, the camera, a section — not only what is visible.
 */
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { quoteOfPart } from '../../src/renderer/ai/parts'
import { columnsIn, traceLattice } from '../../src/renderer/ai/trace-plan'
import { askVee, demoWithVee, emit, tool, type Held } from './helpers'

const QUESTION = 'Which walls have no thermal transmittance?'
const ANSWER = '**24 of 80 walls** have no Thermal Transmittance. Every `EW 200 Brick` wall carries one.'
const ANSWER_TEXT = '24 of 80 walls have no Thermal Transmittance. Every EW 200 Brick wall carries one.'
const WALLS = {
  rules: [
    { prop: 'IfcEntity', op: '=', val: 'IfcWall' },
    { prop: 'ThermalTransmittance', op: 'absent', val: null }
  ]
}
/** The demo's walls, and those of them with no thermal transmittance. */
const WALLS_N = 80
const STEPS = ['Reading 4 models · 412 elements', 'Filtering IfcWall · 80 walls', 'Checking Thermal Transmittance · 24 missing']
const FOLD = /^412 read · 80 walls · 24 missing · \d+s$/
const ROWS = ['L15 walls', 'L25 walls', 'L35 walls', 'L45 walls', 'Roof4 walls']
/** The answer's parts land at most this far apart, and all of them within `ANSWER_TOTAL_MS`. */
const STAGGER_MS = 110
const ANSWER_TOTAL_MS = 500
/** The frame loop ends at most this long after the answer. */
const LOOP_END_MS = 1950
/** Two display frames: what a sample taken on `requestAnimationFrame` can be late by. */
const FRAME_SLACK_MS = 34

let dir = ''

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-trace-'))
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const held = (app: ElectronApplication): Promise<Held> =>
  app.evaluate(() => (globalThis as unknown as { __turn: Held }).__turn)

const ready = (media?: { reducedMotion: 'reduce' }): Promise<{ app: ElectronApplication; main: Page; vee: Page }> =>
  demoWithVee(dir, media)

/**
 * What a canvas shows, as one short string — **whatever rasterised it**. The page installs it as
 * `window.__picture`.
 *
 * Reading a canvas back is what makes Chromium move it from the GPU to the CPU, and the two
 * round a square's corners differently. So a picture is not its bytes: it is which pixels are at
 * least a quarter there, and which solid colours are among them.
 */
const PICTURE = `(canvas) => {
  if (!canvas || !canvas.width) return { picture: '', inked: false }
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let hash = 2166136261
  let count = 0
  const colours = new Set()
  for (let i = 0; i < data.length; i += 4) {
    const there = data[i + 3] >= 64
    if (there) count++
    if (data[i + 3] === 255) colours.add((data[i] >> 4) + '.' + (data[i + 1] >> 4) + '.' + (data[i + 2] >> 4))
    hash = Math.imul(hash ^ (there ? 1 : 0), 16777619)
  }
  return {
    picture: canvas.width + 'x' + canvas.height + ':' + count + ':' + (hash >>> 0) + ':' + [...colours].sort().join(','),
    inked: count > 0
  }
}`

/**
 * How many separate cells one row of the matrix shows: along every pixel row of the canvas, the
 * runs of solid pixels, and the most of them on any one row — which is a row through the cells'
 * centres. The beam is upright, so it adds at most one. The page installs it as `window.__runs`.
 */
const RUNS = `(canvas) => {
  if (!canvas || !canvas.width) return 0
  const w = canvas.width, h = canvas.height
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data
  let best = 0
  for (let y = 0; y < h; y++) {
    let runs = 0, on = false
    for (let x = 0; x < w; x++) {
      const solid = data[(y * w + x) * 4 + 3] >= 128
      if (solid && !on) runs++
      on = solid
    }
    if (runs > best) best = runs
  }
  return best
}`

type Picture = (canvas: HTMLCanvasElement | null) => { picture: string; inked: boolean }

/** A part landing: its opacity (as the trace writes it — none written is 1) and its lift, CSS px. */
interface Land {
  op: number
  y: number
}

/** What the last row of the log shows at one display frame. */
interface Seen {
  /** `performance.now()` in the Vee window. */
  t: number
  /** The transcript's rows, the last one's place in it, and whether it is a reply still being written. */
  rows: number
  index: number
  live: boolean
  presence: string
  /** Typing dots in the last row, shown. */
  dots: boolean
  /** The last row's diary: not there or not shown, running, folded, or folded and reopened. */
  diary: 'none' | 'live' | 'folded' | 'open'
  /** Its seconds since Send while it runs, and its folded line once answered. */
  elapsed: string
  fold: string
  /** Its steps as shown — `Filtering IfcWall · 80 walls` — and which of them are ticked. */
  steps: string[]
  ticked: boolean[]
  /** The answer's parts, each landing. */
  lands: Land[]
  vee: string
  /** The typed line on its way up, while it shows. */
  lift: { top: number; left: number; text: string } | null
  moving: boolean
  /** The diary's matrix as drawn (`PICTURE`), and whether anything is drawn on it at all. */
  matrix: string
  inked: boolean
}

/**
 * The Vee window samples itself at every display frame into `window.__seen` — each sample what
 * `Seen` says — so a test can ask afterwards what was shown, when and in what order, without
 * racing the animation.
 */
async function watch(page: Page): Promise<void> {
  await page.evaluate(`window.__picture = ${PICTURE}`)
  await page.evaluate(() => {
    const picture = (window as unknown as { __picture: Picture }).__picture
    const flat = (e: Element | null | undefined): string => (e?.textContent || '').replace(/\s+/g, ' ').trim()
    const visible = (e: Element | null | undefined): boolean => {
      if (!e) return false
      for (let n: Element | null = e; n && n.getAttribute('data-role') !== 'chatlog'; n = n.parentElement) {
        const c = getComputedStyle(n)
        if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) < 0.5) return false
      }
      return true
    }
    const liftOf = (style: string): number => {
      const m = /translateY\((-?[\d.]+)px\)/.exec(style)
      return m ? Number(m[1]) : 0
    }
    const sample = (): Seen => {
      const log = document.querySelector('[data-role="chatlog"]')!
      const all = [...log.querySelectorAll(':scope > [data-row]')]
      const row = all[all.length - 1] as HTMLElement | undefined
      const diaryEl = row?.querySelector<HTMLElement>('[data-part="diary"]') ?? null
      const diary: Seen['diary'] = !visible(diaryEl)
        ? 'none'
        : !diaryEl!.classList.contains('vm-fold')
          ? 'live'
          : diaryEl!.classList.contains('vm-open')
            ? 'open'
            : 'folded'
      const steps = diaryEl ? [...diaryEl.querySelectorAll<HTMLElement>('li.vm-step')].filter((li) => visible(li)) : []
      const lift = document.querySelector<HTMLElement>('[data-part="lift"]')
      const drawn = picture(diaryEl?.querySelector('canvas') ?? null)
      return {
        t: performance.now(),
        rows: all.length,
        index: Number(row?.getAttribute('data-row') ?? -1),
        live: row?.getAttribute('aria-hidden') === 'true',
        presence: flat(document.querySelector('[data-role="vee-presence"]')),
        dots: visible(row?.querySelector('[data-part="dots"]')),
        diary,
        elapsed: flat(diaryEl?.querySelector('[data-part="elapsed"]')),
        fold: flat(diaryEl?.querySelector('[data-part="diary-sum"] > span:nth-child(2)')),
        steps: steps.map((li) => {
          const count = flat(li.querySelector('.vm-n'))
          return flat(li.querySelector('.vm-sl')) + (count ? ` · ${count}` : '')
        }),
        ticked: steps.map((li) => li.classList.contains('vm-ok')),
        lands: [...(row?.querySelectorAll<HTMLElement>('[data-land]') ?? [])].map((e) => ({
          op: e.style.opacity === '' ? 1 : Number(e.style.opacity),
          y: liftOf(e.style.transform)
        })),
        vee: row?.querySelector('.vm-av [data-role="vee"]')?.getAttribute('data-state') ?? '',
        lift:
          lift && getComputedStyle(lift).display !== 'none'
            ? { top: lift.getBoundingClientRect().top, left: lift.getBoundingClientRect().left, text: flat(lift) }
            : null,
        moving: log.hasAttribute('data-moving'),
        matrix: drawn.picture,
        inked: drawn.inked
      }
    }
    const w = window as unknown as { __seen: Seen[]; __sample: () => Seen; __watch?: number }
    w.__seen = []
    w.__sample = sample
    if (w.__watch) cancelAnimationFrame(w.__watch)
    const frame = (): void => {
      w.__seen.push(sample())
      w.__watch = requestAnimationFrame(frame)
    }
    w.__watch = requestAnimationFrame(frame)
  })
}

const seen = (page: Page): Promise<Seen[]> => page.evaluate(() => (window as unknown as { __seen: Seen[] }).__seen)
const now = (page: Page): Promise<Seen> => page.evaluate(() => (window as unknown as { __sample: () => Seen }).__sample())
const forget = (page: Page): Promise<void> => page.evaluate(() => void ((window as unknown as { __seen: Seen[] }).__seen = []))
/** The distinct values of something across the samples, in the order they first appeared. */
const inOrder = <T,>(samples: Seen[], of: (s: Seen) => T[]): T[] => [...new Set(samples.flatMap(of))]
/** A step's count, as a number: `Filtering IfcWall · 80 walls` → 80. */
const countOf = (step: string): number => Number(step.split(' · ')[1].split(' ')[0].replace(/,/g, ''))

/**
 * The answer phase, read off the samples taken from the `done` event on: the first frame that
 * shows the committed reply, when each part first stood above zero opacity and when all of them
 * were in, and the last frame anything still moved.
 */
function answerPhase(samples: Seen[]): { at: number; first: Seen; starts: number[]; allIn: number; lastMoving: number } {
  const first = samples.find((s) => !s.live && s.lands.length > 0) ?? samples.find((s) => !s.live)
  if (!first) throw new Error('no frame showed the committed reply')
  const after = samples.filter((s) => s.t >= first.t)
  const n = first.lands.length
  const starts = Array.from({ length: n }, (_, k) => after.find((s) => (s.lands[k]?.op ?? 1) > 0)?.t ?? Number.NaN)
  const allIn = after.find((s) => s.lands.every((l) => l.op >= 1))?.t ?? Number.NaN
  const moving = after.filter((s) => s.moving)
  return { at: first.t, first, starts, allIn, lastMoving: moving.length ? moving[moving.length - 1].t : first.t }
}

/** A bubble's own words: its text without the time it carries or its hover bar. */
const words = (bubble: Locator): Promise<string> =>
  bubble.evaluate((b) => {
    const copy = b.cloneNode(true) as HTMLElement
    for (const x of copy.querySelectorAll('.vm-t, .vm-rx')) x.remove()
    return (copy.textContent || '').replace(/\s+/g, ' ').trim()
  })

/** Every sprite and canvas in the window, measured against its device pixels. */
const devicePixels = (page: Page): Promise<{ what: string; whole: boolean }[]> =>
  page.evaluate(() => {
    const dpr = window.devicePixelRatio || 1
    const out: { what: string; whole: boolean }[] = []
    for (const c of document.querySelectorAll<HTMLCanvasElement>('[data-role="vee"] canvas')) {
      // Its CSS width as laid out — not its box, which a pop's scale would shrink.
      const css = parseFloat(getComputedStyle(c).width)
      // A whole number of device pixels to a cell, and a backing store exactly its CSS box.
      out.push({ what: `sprite ${c.width}`, whole: c.width % 16 === 0 && c.width === c.height && Math.abs(css * dpr - c.width) < 0.05 })
    }
    for (const c of document.querySelectorAll<HTMLCanvasElement>('[data-part="diary"] canvas')) {
      const parent = c.parentElement!.clientWidth
      out.push({ what: `matrix ${c.width}`, whole: c.width === Math.round(parent * dpr) })
    }
    return out
  })

test('a turn is drawn as it happens — dots, then a diary of every step — and its answer lands at once', async () => {
  const { app, main, vee: page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    const send = page.locator('button[data-part="send"]')
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1)
    await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
    await expect(page.locator('[data-role="vee-presence"]')).toHaveText('on site')
    await watch(page)
    await askVee(page, QUESTION)

    // 1 — Send. The composer is empty again, the button is a stop, and the question is the
    // user's bubble — on the right, with one tick: sent, not yet picked up.
    await expect(page.locator('[data-role="chatinput"]')).toHaveValue('')
    await expect(send).toHaveAttribute('aria-label', 'Stop')
    await expect(send).toHaveAttribute('data-tip', 'Stop')
    const mine = log.locator(':scope > [data-row][data-mine]')
    await expect(mine).toHaveCount(1)
    await expect(mine).toHaveClass(/vm-me/)
    await expect(mine.locator('[aria-label="Sent"]')).toHaveCount(1)
    const logBox = (await log.boundingBox())!
    const mineBox = (await mine.locator('[data-part="bubble"]').boundingBox())!
    expect(logBox.x + logBox.width - (mineBox.x + mineBox.width)).toBeLessThan(24)
    // The reply being written is already the transcript's next row: typing dots, Vee typing.
    await expect.poll(async () => (await now(page)).live).toBe(true)
    await expect.poll(async () => (await now(page)).dots).toBe(true)
    await expect(page.locator('[data-role="vee-presence"]')).toHaveText('typing')
    await expect(page.locator('header .vm-sq')).toHaveClass(/vm-on/)

    // 2 — the first tool: its data exists at once; the diary shows it at its own pace.
    await tool(app, 'query_elements', WALLS)
    await expect(mine.locator('[aria-label="Picked up"]')).toHaveCount(1)
    await expect.poll(async () => (await now(page)).steps.join(' | '), { timeout: 20_000 }).toBe(STEPS.join(' | '))

    const live = await seen(page)
    // The typed line rose out of the composer, in one piece, on a slant to its bubble on the right.
    const lift = live.filter((s) => s.lift).map((s) => s.lift!)
    expect(lift.length).toBeGreaterThan(5)
    expect(new Set(lift.map((l) => l.text))).toEqual(new Set([QUESTION]))
    for (let i = 1; i < lift.length; i++) expect(lift[i].top).toBeLessThanOrEqual(lift[i - 1].top + 0.01)
    expect(lift[0].top - lift[lift.length - 1].top).toBeGreaterThan(40)
    expect(lift[lift.length - 1].left).toBeGreaterThan(lift[0].left)
    // Typing dots before the diary, and never beside it.
    const running = live.filter((s) => s.live)
    expect(running.some((s) => s.dots && s.diary === 'none')).toBe(true)
    expect(running.some((s) => s.dots && s.diary !== 'none')).toBe(false)
    expect(inOrder(running, (s) => [s.dots ? 'dots' : s.diary])).toEqual(expect.arrayContaining(['dots', 'live']))
    expect(inOrder(running, (s) => [s.presence])).toEqual(['typing', 'on it'])
    // The diary's clock: whole seconds since Send, counting up.
    const seconds = inOrder(running.filter((s) => s.diary === 'live'), (s) => [s.elapsed]).map((e) => Number(e.replace(/s$/, '')))
    expect(seconds.length).toBeGreaterThan(2)
    expect(seconds).toEqual([...seconds].sort((a, b) => a - b))
    // Every step stays, in order, each on its real count; a step is ticked once the next has begun.
    expect(inOrder(running, (s) => s.steps.map((t) => t.split(' · ')[0]))).toEqual([
      'Reading 4 models',
      'Filtering IfcWall',
      'Checking Thermal Transmittance'
    ])
    const counts = (label: string): number[] =>
      inOrder(running, (s) => s.steps.filter((t) => t.startsWith(label)).map(countOf))
    // Reading counts up to the federation's 412; Filtering down from it to the 80 walls;
    // Checking up, cell by cell, to the 24 that match.
    const reading = counts('Reading')
    expect(reading[reading.length - 1]).toBe(412)
    expect(reading).toEqual([...reading].sort((a, b) => a - b))
    const filtering = counts('Filtering')
    expect(filtering[filtering.length - 1]).toBe(80)
    expect(filtering).toEqual([...filtering].sort((a, b) => b - a))
    expect(Math.max(...filtering)).toBeLessThanOrEqual(412)
    const checking = counts('Checking')
    expect(checking[0]).toBe(0)
    expect(checking[checking.length - 1]).toBe(24)
    expect(checking).toEqual([...checking].sort((a, b) => a - b))
    expect(checking.length).toBeGreaterThan(4)
    expect((await now(page)).ticked).toEqual([true, true, false])
    // The matrix moved: many pictures while the diary ran.
    expect(new Set(running.filter((s) => s.diary === 'live').map((s) => s.matrix)).size).toBeGreaterThan(20)
    // Vee, at the foot of the reply being written: thinking, then reading — and a hop at a finding.
    const states = inOrder(running, (s) => [s.vee])
    expect(states.slice(0, 2)).toEqual(['thinking', 'reading'])
    expect(new Set(states)).toEqual(new Set(['thinking', 'reading', 'found']))
    // Whole device pixels: every sprite and the running matrix.
    for (const c of await devicePixels(page)) expect(c).toEqual({ what: c.what, whole: true })

    // 3 — `done`. The row, its avatar and its diary are marked — as elements, not by anything a
    // re-render could copy — and the answer arrives.
    await log.locator(':scope > [data-row]').last().evaluate((row) => {
      for (const node of [row, row.querySelector('.vm-av [data-role="vee"] canvas')!, row.querySelector('[data-part="diary"]')!]) {
        ;(node as unknown as { __live: boolean }).__live = true
      }
    })
    await forget(page)
    await emit(app, { type: 'done', text: ANSWER, rounds: 2 })
    await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
    const reply = log.locator(':scope > [data-row]').last()
    await expect(reply).not.toHaveAttribute('aria-hidden', 'true')
    // The reply that commits is the row that was live: the same three elements, so nothing in it
    // started again.
    expect(
      await reply.evaluate((row) =>
        [row, row.querySelector('.vm-av [data-role="vee"] canvas'), row.querySelector('[data-part="diary"]')].map(
          (node) => (node as unknown as { __live?: boolean } | null)?.__live === true
        )
      )
    ).toEqual([true, true, true])
    await expect(log).not.toHaveAttribute('data-moving', '', { timeout: 10_000 })
    await page.waitForTimeout(150)
    const answered = await seen(page)
    const phase = answerPhase(answered)
    // **Never delayed**: the first frame that shows the reply already has its folded line at its
    // final numbers and every part in its place, and the first part is landing at once.
    expect(phase.first.diary).toBe('folded')
    expect(phase.first.fold).toMatch(FOLD)
    expect(phase.first.lands.length).toBeGreaterThanOrEqual(2)
    expect(phase.starts[0] - phase.at).toBeLessThanOrEqual(FRAME_SLACK_MS)
    // The parts land one after another, at most 110 ms apart, and all of them within 0.5 s.
    for (let k = 1; k < phase.starts.length; k++) {
      expect(phase.starts[k] - phase.starts[k - 1]).toBeLessThanOrEqual(STAGGER_MS + FRAME_SLACK_MS)
    }
    // …and not all at once — unless the window first drew the reply after its second part had
    // already begun, which says nothing about the stagger.
    if (phase.first.lands[1].op === 0) expect(phase.starts[1] - phase.starts[0]).toBeGreaterThan(40)
    expect(phase.allIn - phase.at).toBeLessThanOrEqual(ANSWER_TOTAL_MS + FRAME_SLACK_MS)
    // …each lift on a whole device pixel…
    for (const s of answered) for (const l of s.lands) expect(Math.abs(l.y * dpr - Math.round(l.y * dpr))).toBeLessThan(0.02)
    // …and the frame loop stopped within 1.95 s of the answer.
    expect(phase.lastMoving - phase.at).toBeLessThanOrEqual(LOOP_END_MS + FRAME_SLACK_MS)
    expect(inOrder(answered, (s) => [s.vee]).pop()).toBe('done')

    // What the reply says: its words, its marks as elements — bold in weight, the IFC term in its
    // one colour — its folded diary and its storey rows, in the ladder's order.
    const bubbles = reply.locator('.vm-stack > .vm-b.vm-tx')
    await expect(bubbles).toHaveCount(1)
    expect(await words(bubbles.first())).toBe(ANSWER_TEXT)
    await expect(bubbles.first().locator('.vm-t')).toHaveText(/^\d\d:\d\d$/)
    expect(await bubbles.first().locator('span[style*="font-weight"]').evaluateAll((e) => e.map((x) => [x.textContent, getComputedStyle(x).fontWeight]))).toEqual([
      ['24 of 80 walls', '600']
    ])
    await expect(bubbles.first().locator('.ifc-term')).toHaveText(['EW 200 Brick'])
    await expect(reply.locator('[data-part="diary-sum"] > span').nth(1)).toHaveText(FOLD)
    const rows = reply.locator('[data-role="storey-rows"]')
    await expect(rows.locator('.vm-sn-hd')).toHaveText(/^Thermal Transmittance · missing\s*24$/)
    await expect(rows.locator('.vm-sn-row')).toHaveText(ROWS)
    // The reply is announced, once, by the live region; the trace under it never was.
    await expect(page.locator('[data-role="vee-announce"]')).toHaveText(new RegExp(`^${ANSWER_TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    await expect(log).toHaveAttribute('aria-live', 'off')

    // 4 — nothing is animating two seconds after the turn ended: the loop is idle, and nothing
    // in the reply changes.
    await page.waitForTimeout(2000)
    const before = await reply.evaluate((row) => row.outerHTML)
    await forget(page)
    await page.waitForTimeout(700)
    const still = await seen(page)
    expect(still.length).toBeGreaterThan(15)
    expect(still.some((s) => s.moving)).toBe(false)
    expect(new Set(still.map((s) => JSON.stringify([s.lands, s.diary, s.fold]))).size).toBe(1)
    expect(await reply.evaluate((row) => row.outerHTML)).toBe(before)

    // 5 — the folded line reopens to every step at its final count, ticked, and to the final
    // matrix; and closes again.
    const sum = reply.locator('[data-part="diary-sum"]')
    await expect(sum).toHaveAttribute('aria-expanded', 'false')
    await sum.click()
    await expect(sum).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(async () => (await now(page)).steps).toEqual(STEPS)
    expect((await now(page)).ticked).toEqual([true, true, true])
    await expect.poll(async () => (await now(page)).inked).toBe(true)
    await expect(reply.locator('[data-part="diary"] canvas')).toHaveAttribute('aria-hidden', 'true')
    for (const c of await devicePixels(page)) expect(c).toEqual({ what: c.what, whole: true })
    await sum.click()
    await expect(sum).toHaveAttribute('aria-expanded', 'false')
    await expect(reply.locator('[data-part="diary"] canvas')).toHaveCount(0)

    // 6 — a storey row is a button: it selects the elements it counts, in the main window, and the
    // board says so; the row that is the 3D view's selection is pressed and ringed by a cloud.
    const storeyRows = rows.locator('.vm-sn-row')
    await storeyRows.nth(4).click()
    await expect(main.locator('[data-role="propcard"]').getByText('4 selected · showing last')).toBeVisible()
    await storeyRows.first().click()
    await expect(main.locator('[data-role="propcard"]').getByText('5 selected · showing last')).toBeVisible()
    await expect(page.locator('[data-role="vee-board"] .vm-board-txt')).toHaveText(/5 selected · L1/)
    await expect(storeyRows.first()).toHaveAttribute('aria-pressed', 'true')
    await expect(storeyRows.first().locator('svg.vm-cloud')).toHaveCount(1)
    await expect(storeyRows.nth(4)).toHaveAttribute('aria-pressed', 'false')

    // 7 — the log does not scroll sideways: nothing in it is wider than it is.
    const widths = await log.evaluate((e) => ({ client: e.clientWidth, scroll: e.scrollWidth, x: getComputedStyle(e).overflowX }))
    expect(widths.scroll).toBe(widths.client)
    expect(widths.x).toBe('hidden')
    // A bubble's hover bar shows on hover only.
    const bar = bubbles.first().locator('.vm-rx')
    expect(await bar.evaluate((b) => getComputedStyle(b).opacity)).toBe('0')
    await bubbles.first().hover()
    await expect.poll(() => bar.evaluate((b) => getComputedStyle(b).opacity)).toBe('1')
    expect(await log.evaluate((e) => e.scrollLeft)).toBe(0)
  } finally {
    await app.close()
  }
})

test('an answer that comes before the diary could show anything is not held back for it', async () => {
  const { app, vee: page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    await watch(page)
    await askVee(page, QUESTION)
    await tool(app, 'query_elements', WALLS)
    // The answer at once — the moment the tool has answered, long before Read could open the diary.
    await expect.poll(async () => (await held(app)).results.length).toBe(1)
    await emit(app, { type: 'done', text: ANSWER, rounds: 2 })
    const reply = log.locator(':scope > [data-row]').last()
    await expect(reply).not.toHaveAttribute('aria-hidden', 'true')
    await expect(log).not.toHaveAttribute('data-moving', '', { timeout: 10_000 })
    await page.waitForTimeout(150)
    const all = await seen(page)
    const phase = answerPhase(all)
    // Its folded line is final at the first frame that shows it — every count the federation's —
    // and its rows are there at once; nothing waited for a step the diary never got to show.
    expect(phase.first.fold).toMatch(FOLD)
    expect(phase.starts[0] - phase.at).toBeLessThanOrEqual(FRAME_SLACK_MS)
    expect(phase.allIn - phase.at).toBeLessThanOrEqual(ANSWER_TOTAL_MS + FRAME_SLACK_MS)
    expect(phase.lastMoving - phase.at).toBeLessThanOrEqual(LOOP_END_MS + FRAME_SLACK_MS)
    await expect(reply.locator('[data-role="storey-rows"] .vm-sn-row')).toHaveText(ROWS)
    expect(await words(reply.locator('.vm-stack > .vm-b.vm-tx').first())).toBe(ANSWER_TEXT)
    // The loop is from Send to the answer's end: the whole turn, a second or two, and then none.
    expect(phase.lastMoving - all[0].t).toBeLessThan(5000)
  } finally {
    await app.close()
  }
})

test('the send button stops a running turn; Enter during one does nothing; a failed turn offers Try again', async () => {
  const { app, vee: page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    const send = page.locator('button[data-part="send"]')
    const input = page.locator('[data-role="chatinput"]')
    const system = log.locator('[data-role="vee-system"]')
    await askVee(page, QUESTION)
    await expect(send).toHaveAttribute('aria-label', 'Stop')
    await tool(app, 'query_elements', WALLS)
    await expect(log.locator('[data-part="diary"] li.vm-step').first()).toBeVisible({ timeout: 10_000 })

    // Enter while the turn runs: the second question stays in the composer, unsent.
    await input.fill('and the doors?')
    await input.press('Enter')
    await expect(input).toHaveValue('and the doors?')
    await expect(log.locator(':scope > [data-row][data-mine]')).toHaveCount(1)
    expect((await held(app)).aborted).toEqual([])
    // The arrow has given way to the square.
    const icon = async (): Promise<{ arrow: number; stop: number }> => ({
      arrow: Number(await send.locator('[data-part="send-arrow"]').evaluate((e) => getComputedStyle(e).opacity)),
      stop: Number(await send.locator('[data-part="send-stop"]').evaluate((e) => getComputedStyle(e).opacity))
    })
    await expect.poll(icon).toEqual({ arrow: 0, stop: 1 })
    expect(await send.locator('[data-part="send-stop"]').evaluate((e) => [e.getBoundingClientRect().width, getComputedStyle(e).borderRadius])).toEqual([8, '2px'])

    // The stop — **a double-click**, the way a hurried hand does it: main is asked to stop exactly
    // this turn, exactly once. The second click lands when the turn may already be over and the
    // button a send button again; it does not send the draft.
    await send.dblclick()
    // A neutral system line that says honestly nothing had changed — the turn only read.
    await expect(system).toHaveText('Stopped · nothing changed')
    await expect(system).toHaveAttribute('title', 'Stopped.')
    await expect(system.getByRole('button', { name: 'Try again' })).toHaveCount(0)
    await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
    await page.waitForTimeout(400)
    expect((await held(app)).aborted).toHaveLength(1)
    await expect(input).toHaveValue('and the doors?')
    // The reply being written and its diary are gone; the question stays; the button sends again.
    await expect(log.locator(':scope > [data-row]')).toHaveCount(2)
    await expect(log.locator(':scope > [data-row][data-mine]')).toHaveCount(1)
    await expect(log.locator('[data-part="diary"], [data-part="dots"]')).toHaveCount(0)
    await expect.poll(icon).toEqual({ arrow: 1, stop: 0 })
    await expect(log).not.toHaveAttribute('data-moving', '')
    await expect(page.locator('[data-role="vee-presence"]')).toHaveText('on site')

    // …and the composer still holds what was typed, ready to be sent. This turn changes something
    // — L2 alone — and then cannot reach the service: its line says so, and does not claim that
    // nothing changed.
    const before = (await held(app)).id
    await input.press('Enter')
    await expect(log.locator(':scope > [data-row][data-mine]')).toHaveCount(2)
    await expect(system).toHaveCount(0)
    await expect.poll(async () => (await held(app)).id).not.toBe(before)
    await tool(app, 'set_storeys', { visible: ['L2'] })
    await expect.poll(async () => (await held(app)).results.length).toBe(2)
    await emit(app, { type: 'error', kind: 'connection', message: 'Could not reach the API.' })
    await expect(system).toContainText('Couldn’t reach Vee · what it already did stays')
    await expect(system).toHaveAttribute('title', 'Could not reach the API.')
    await expect(page.locator('[data-role="vee-presence"]')).toHaveText('no signal')
    await expect(log.locator('[data-part="diary"], [data-part="dots"]')).toHaveCount(0)
    await expect(log.locator(':scope > [data-row]')).toHaveCount(3)

    // Try again runs the same question once more — without adding it to the transcript again.
    const failed = (await held(app)).id
    await system.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect.poll(async () => (await held(app)).id).not.toBe(failed)
    expect((await held(app)).asked?.userText).toBe('and the doors?')
    await expect(log.locator(':scope > [data-row][data-mine]')).toHaveCount(2)
    await expect(system).toHaveCount(0)
    await expect(send).toHaveAttribute('aria-label', 'Stop')
    await emit(app, { type: 'done', text: 'There are 12 doors.', rounds: 1 })
    await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
    await expect(page.locator('[data-role="vee-presence"]')).toHaveText('on site')
  } finally {
    await app.close()
  }
})

test('a turn with no tool has no diary: typing dots until its answer, which lands as it does', async () => {
  const { app, vee: page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    await watch(page)
    await askVee(page, 'hello')
    await expect.poll(async () => (await now(page)).dots).toBe(true)
    await page.waitForTimeout(1500)
    await emit(app, { type: 'done', text: 'Hello. Ask me about the model.', rounds: 1 })
    const reply = log.locator(':scope > [data-row]').last()
    await expect(reply).not.toHaveAttribute('aria-hidden', 'true')
    await expect(log).not.toHaveAttribute('data-moving', '', { timeout: 10_000 })
    await page.waitForTimeout(150)
    const all = await seen(page)
    // Dots for the whole turn, no diary ever, nothing drawn on a matrix; Vee typing, not on it.
    const running = all.filter((s) => s.live)
    expect(running.length).toBeGreaterThan(20)
    expect(running.every((s) => s.diary === 'none')).toBe(true)
    expect(all.some((s) => s.inked)).toBe(false)
    expect(inOrder(running, (s) => [s.presence])).toEqual(['typing'])
    expect(running.slice(-5).every((s) => s.dots)).toBe(true)
    await expect(reply.locator('[data-part="diary"], [data-role="storey-rows"]')).toHaveCount(0)
    // One bubble, hugging its text; it landed as every answer lands.
    const bubble = reply.locator('.vm-stack > .vm-b.vm-tx')
    await expect(bubble).toHaveCount(1)
    expect(await words(bubble)).toBe('Hello. Ask me about the model.')
    expect((await bubble.boundingBox())!.width).toBeLessThan((await log.boundingBox())!.width - 60)
    const phase = answerPhase(all)
    expect(phase.allIn - phase.at).toBeLessThanOrEqual(ANSWER_TOTAL_MS + FRAME_SLACK_MS)
    expect(phase.lastMoving - phase.at).toBeLessThanOrEqual(LOOP_END_MS + FRAME_SLACK_MS)
    const at = all[all.length - 1].index
    expect(inOrder(all.filter((s) => s.index === at), (s) => [s.vee])).toEqual(['thinking', 'done'])
  } finally {
    await app.close()
  }
})

/**
 * 2026-10-08 — the owner: "the Ask VEE ai assistant answer are in one sentence, which is extremely
 * difficult to read … Present answer in simple table or list if applicable." Since 2026-11-08 each
 * block is a bubble of its own (`ai/parts.ts`): a sentence, a list and a table are three bubbles, a
 * table too wide for its bubble scrolls inside its own box — never the log — and `reply` on one
 * bubble quotes that bubble alone.
 */
test('a reply written as a sentence, a list and a table is three bubbles, and a reply quotes one of them', async () => {
  const FORMATTED = [
    '**24 of 80 walls** have no Thermal Transmittance.',
    '',
    '- 12 are in `SB_ARC_R25` and 12 in `SB_STR_R25`.',
    '- All 4 walls on the roof are missing it.',
    '- Every `EW 200 Brick` wall carries one.',
    '',
    '| Level | Walls | Missing | Type |',
    '|---|---:|---:|---|',
    '| L1 | 19 | 5 | `SB_ARC_R25_EXTERNAL_WALL_TYPE_WITHOUT_THERMAL_TRANSMITTANCE` |',
    '| Roof | 4 | 4 | all |'
  ].join('\n')
  const { app, vee: page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    await askVee(page, 'Which walls are missing it, by level?')
    await expect.poll(async () => (await held(app)).asked?.userText).toBe('Which walls are missing it, by level?')
    await emit(app, { type: 'done', text: FORMATTED, rounds: 1 })
    const reply = log.locator(':scope > [data-row]').last()
    await expect(reply).not.toHaveAttribute('aria-hidden', 'true')
    await expect(log).not.toHaveAttribute('data-moving', '', { timeout: 10_000 })

    // Three bubbles — a sentence, a list, a table — and none of the characters that wrote them.
    const bubbles = reply.locator('.vm-stack > .vm-b.vm-tx')
    await expect(bubbles).toHaveCount(3)
    expect(await words(bubbles.nth(0))).toBe('24 of 80 walls have no Thermal Transmittance.')
    await expect(bubbles.nth(0).locator('.vm-t')).toHaveCount(1)
    await expect(bubbles.nth(1).locator('.vm-t')).toHaveCount(0)
    await expect(bubbles.nth(1).locator('ul > li')).toHaveText([
      '•12 are in SB_ARC_R25 and 12 in SB_STR_R25.',
      '•All 4 walls on the roof are missing it.',
      '•Every EW 200 Brick wall carries one.'
    ])
    const table = bubbles.nth(2).locator('table')
    await expect(table.locator('th')).toHaveText(['Level', 'Walls', 'Missing', 'Type'])
    await expect(table.locator('tbody tr')).toHaveCount(2)
    for (const b of await bubbles.all()) expect(await words(b)).not.toMatch(/\*\*|`|\||---/)
    // The header is the result table's capitals; a column of numbers is right-aligned, in mono.
    expect(await table.locator('th').first().evaluate((e) => getComputedStyle(e).textTransform)).toBe('uppercase')
    expect(
      await table.locator('tbody tr').first().locator('td').nth(1).evaluate((e) => [getComputedStyle(e).textAlign, getComputedStyle(e).fontFamily.includes('Mono')])
    ).toEqual(['right', true])
    // The table is wider than its bubble: it scrolls inside its own box, and the log does not.
    const box = await table.evaluate((t) => {
      const own = t.parentElement!
      const log = t.closest('[data-role="chatlog"]')!
      return {
        table: { client: own.clientWidth, scroll: own.scrollWidth, x: getComputedStyle(own).overflowX },
        log: { client: log.clientWidth, scroll: log.scrollWidth }
      }
    })
    expect(box.table.x).toBe('auto')
    expect(box.table.scroll).toBeGreaterThan(box.table.client)
    expect(box.log.scroll).toBe(box.log.client)

    // `reply` on the list quotes the list alone — in the strip, above the question, and to main.
    const QUOTE = quoteOfPart({ role: 'assistant', text: FORMATTED }, 1)!
    expect(QUOTE).toMatch(/^12 are in SB_ARC_R25/)
    await bubbles.nth(1).hover()
    await bubbles.nth(1).locator('.vm-rx button[aria-label="Reply"]').click()
    const strip = page.locator('span', { hasText: /^Replying to Vee$/ }).locator('xpath=following-sibling::span[1]')
    await expect(strip).toHaveText(QUOTE)
    await expect(page.locator('[data-role="chatinput"]')).toBeFocused()
    await askVee(page, 'and the doors?')
    await expect.poll(async () => (await held(app)).asked).toEqual({ userText: 'and the doors?', quote: { who: 'Vee', text: QUOTE } })
    const asked = log.locator(':scope > [data-row][data-mine]').last()
    await expect(asked.locator('.vm-q')).toHaveText(`Vee${QUOTE}`)
  } finally {
    await app.close()
  }
})

test('with reduced motion every state shows at its end, and nothing in between', async () => {
  const { app, vee: page } = await ready({ reducedMotion: 'reduce' })
  try {
    const log = page.locator('[data-role="chatlog"]')
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
    await watch(page)
    await askVee(page, QUESTION)
    await tool(app, 'query_elements', WALLS)
    await expect.poll(async () => (await now(page)).steps.join(' | '), { timeout: 20_000 }).toBe(STEPS.join(' | '))
    await page.waitForTimeout(150)
    const live = (await seen(page)).filter((s) => s.live)
    // No lift, no count-up: each step comes in at its final count.
    expect(live.some((s) => s.lift)).toBe(false)
    expect(inOrder(live, (s) => s.steps)).toEqual(STEPS)
    // Dots, then the diary — each the moment its cue is reached.
    expect(live.some((s) => s.dots && s.diary === 'none')).toBe(true)
    expect(live.some((s) => s.dots && s.diary !== 'none')).toBe(false)
    // The matrix is three pictures — read, filtered, checked — and none between them.
    expect(new Set(live.filter((s) => s.diary === 'live').map((s) => s.matrix)).size).toBe(3)
    // Vee holds one frame of each state: thinking, reading, a finding.
    expect(inOrder(live, (s) => [s.vee])).toEqual(['thinking', 'reading', 'found'])
    expect(live.some((s) => s.moving)).toBe(false)

    await forget(page)
    await emit(app, { type: 'done', text: ANSWER, rounds: 2 })
    const reply = log.locator(':scope > [data-row]').last()
    await expect(reply).not.toHaveAttribute('aria-hidden', 'true')
    await page.waitForTimeout(1500)
    const after = (await seen(page)).filter((s) => !s.live)
    expect(after.length).toBeGreaterThan(20)
    // From the first frame that has the answer, the reply is its finished self: folded, every
    // part in and standing in its place, and nothing ever moving.
    expect(after.every((s) => s.diary === 'folded' && FOLD.test(s.fold))).toBe(true)
    expect(after.every((s) => s.lands.every((l) => l.op === 1 && l.y === 0))).toBe(true)
    expect(after.some((s) => s.moving)).toBe(false)
    expect(after[after.length - 1].vee).toBe('done')
    await expect(reply.locator('[data-role="storey-rows"] .vm-sn-row')).toHaveText(ROWS)
    // The consent card and a fresh bubble pop in only with motion: under reduced motion there is
    // no running animation anywhere in the reply.
    expect(await reply.evaluate((row) => row.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length)).toBe(0)
  } finally {
    await app.close()
  }
})

test('the next turn leaves the reply before it finished and at rest, however soon it is sent', async () => {
  const { app, main, vee: page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    const input = page.locator('[data-role="chatinput"]')
    const send = page.locator('button[data-part="send"]')
    await askVee(page, QUESTION)
    await tool(app, 'query_elements', WALLS)
    await expect(log.locator('[data-part="diary"] li.vm-step').first()).toBeVisible({ timeout: 10_000 })

    // The next question is typed while the turn runs and sent the moment the answer is there —
    // while its parts are still landing and its diary still folding.
    await input.fill('and the doors?')
    await emit(app, { type: 'done', text: ANSWER, rounds: 2 })
    await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
    await input.press('Enter')
    await expect(log.locator(':scope > [data-row][data-mine]')).toHaveCount(2)
    // Rows: 0 the boot audit, 1 the question, 2 its reply, 3 the next question, 4 its reply.
    await expect(log.locator(':scope > [data-row]')).toHaveCount(5)
    const first = log.locator(':scope > [data-row="2"]')
    const second = log.locator(':scope > [data-row="4"]')
    await expect(second).toHaveAttribute('aria-hidden', 'true')

    /** The first reply as it stands: what the trace may have left on it, and what it shows. */
    const reading = (): Promise<{ inline: string[]; lands: number; diary: string; fold: string; rows: string[]; vee: string | null }> =>
      first.evaluate((row) => {
        const touched = [
          row.querySelector<HTMLElement>('.vm-av')!,
          ...row.querySelectorAll<HTMLElement>('.vm-stack > *'),
          ...row.querySelectorAll<HTMLElement>('[data-part="diary-sum"], [data-part="diary-body"]')
        ]
        const diary = row.querySelector<HTMLElement>('[data-part="diary"]')!
        return {
          // Every style the trace writes, on every element it writes it on.
          inline: [...new Set(touched.flatMap((e) => [e.style.opacity, e.style.transform, e.style.height, e.style.display]))],
          lands: row.querySelectorAll('[data-land]').length,
          diary: diary.className,
          fold: (row.querySelector('[data-part="diary-sum"] > span:nth-child(2)')?.textContent || '').trim(),
          rows: [...row.querySelectorAll('.vm-sn-row')].map((r) => (r.textContent || '').replace(/\s+/g, ' ').trim()),
          vee: row.querySelector('.vm-av [data-role="vee"]')?.getAttribute('data-state') ?? null
        }
      })

    // At once — not after its half second of landing: the trace has let go of this reply, so it is
    // simply finished. Nothing of the trace's is written on it, its diary is folded, its rows are
    // in, and its avatar is at rest — no longer the newest.
    const now1 = await reading()
    expect(now1.inline).toEqual([''])
    expect(now1.lands).toBe(0)
    expect(now1.diary).toMatch(/\bvm-fold\b/)
    expect(now1.diary).not.toMatch(/\bvm-open\b/)
    expect(now1.fold).toMatch(FOLD)
    expect(now1.rows).toEqual(ROWS)
    expect(now1.vee).toBe('idle')
    // …and stays exactly so while the next turn runs.
    await page.waitForTimeout(1200)
    expect(await reading()).toEqual(now1)
    // Meanwhile the trace is the new turn's: its reply is the row being written.
    await expect(second.locator('[data-part="dots"]')).toBeVisible()
    await expect(second.locator('.vm-av [data-role="vee"]')).toHaveAttribute('data-state', 'thinking')

    // An older reply's rows still select what they count.
    await first.locator('.vm-sn-row').nth(4).click()
    await expect(main.locator('[data-role="propcard"]').getByText('4 selected · showing last')).toBeVisible()

    // The second turn answers with no tool: its own reply settles, and the first has not changed.
    await emit(app, { type: 'done', text: 'There are 12 doors.', rounds: 1 })
    await expect(second).not.toHaveAttribute('aria-hidden', 'true')
    await expect(log).not.toHaveAttribute('data-moving', '', { timeout: 10_000 })
    await expect(second.locator('.vm-av [data-role="vee"]')).toHaveAttribute('data-state', 'done')
    expect(await reading()).toEqual(now1)
  } finally {
    await app.close()
  }
})

/**
 * 2026-11-08 — a Check's beam keeps the width it started with (`planWidth`): re-planned mid-sweep,
 * its count could jump. Here the Ask Vee window is resized while the Check runs, to a width at
 * which the walls would be planned differently — two to a cell instead of one, or the other way —
 * and the matrix keeps its plan until the answer; the folded diary, reopened, follows the window.
 * Which plan is drawn is read off the canvas: how many cells one of its rows shows.
 */
test('a Check keeps the matrix width it started with while the window is resized under it', async () => {
  const { app, vee: page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    await page.evaluate(`window.__runs = ${RUNS}`)
    const runs = (): Promise<number> =>
      log
        .locator(':scope > [data-row]')
        .last()
        .locator('[data-part="diary"] canvas')
        .evaluate((c) => (window as unknown as { __runs: (c: HTMLCanvasElement) => number }).__runs(c as HTMLCanvasElement))
    const canvasWidth = (): Promise<number> =>
      log.locator(':scope > [data-row]').last().locator('[data-part="diary"] canvas').evaluate((c) => c.parentElement!.clientWidth)
    const veeContentWidth = (): Promise<number> =>
      app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => /\/vee\.html(#|$)/.test(x.webContents.getURL()))!
        return w.getContentSize()[0]
      })
    const resizeVee = (width: number): Promise<void> =>
      app.evaluate(({ BrowserWindow }, to) => {
        const w = BrowserWindow.getAllWindows().find((x) => /\/vee\.html(#|$)/.test(x.webContents.getURL()))!
        w.setContentSize(to, w.getContentSize()[1])
      }, width)

    await askVee(page, QUESTION)
    await tool(app, 'query_elements', WALLS)
    await expect(log.locator('[data-part="diary"] li.vm-step', { hasText: 'Checking' })).toBeVisible({ timeout: 20_000 })

    // The planner's own lattice for this display: how many cells a row of the walls shows at a width.
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1)
    const grid = traceLattice(dpr).b
    const perAt = (w: number): number => {
      const capacity = columnsIn(w, grid) * grid.rows
      return WALLS_N <= capacity ? 1 : Math.ceil(WALLS_N / capacity)
    }
    const colsAt = (w: number): number => Math.ceil(Math.ceil(WALLS_N / perAt(w)) / grid.rows)
    const W0 = await canvasWidth()
    const window0 = await veeContentWidth()
    const target = [300, 380, 420, 480, 560, 640, 760].find((t) => perAt(W0 + t - window0) !== perAt(W0))
    expect(target, `no window width re-plans the walls from ${W0} px at ${dpr}x`).toBeDefined()

    // The metric itself, before the resize: it reads the plan the Check started with.
    const before = await runs()
    expect(Math.abs(before - colsAt(W0))).toBeLessThan(Math.abs(before - colsAt(W0 + target! - window0)))

    // The window is resized while the Check stands: the canvas follows the window, the plan does not.
    await resizeVee(target!)
    await expect.poll(canvasWidth).not.toBe(W0)
    await page.waitForTimeout(300)
    // (Measured, not predicted: a scrollbar that comes or goes with the wrapping moves it a little.)
    const W1 = await canvasWidth()
    expect(perAt(W1), `the walls are planned alike at ${W0} and ${W1} px`).not.toBe(perAt(W0))
    // What each plan shows on a canvas W1 wide: the held plan is cut at the canvas's edge.
    const heldCols = Math.min(colsAt(W0), columnsIn(W1, grid))
    const replanned = colsAt(W1)
    expect(Math.abs(heldCols - replanned)).toBeGreaterThan(4)
    const during = await runs()
    expect(Math.abs(during - heldCols), `${during} cells a row: held ${heldCols}, re-planned ${replanned}`).toBeLessThan(
      Math.abs(during - replanned)
    )

    // The answer is the next step boundary: from there the plan follows the window, and the folded
    // diary, reopened, shows the walls planned for the width it has now.
    await emit(app, { type: 'done', text: ANSWER, rounds: 2 })
    const reply = log.locator(':scope > [data-row]').last()
    await expect(reply).not.toHaveAttribute('aria-hidden', 'true')
    await expect(log).not.toHaveAttribute('data-moving', '', { timeout: 10_000 })
    await reply.locator('[data-part="diary-sum"]').click()
    await expect(reply.locator('[data-part="diary"] canvas')).toHaveCount(1)
    await expect.poll(runs).toBeGreaterThan(0)
    const after = await runs()
    expect(Math.abs(after - replanned), `${after} cells a row: held ${heldCols}, re-planned ${replanned}`).toBeLessThan(
      Math.abs(after - heldCols)
    )
  } finally {
    await app.close()
  }
})

test('revert puts back everything that reply changed — theme, camera, visibility — and only that', async () => {
  const { app, main, vee: page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    const send = page.locator('button[data-part="send"]')
    const rows = log.locator(':scope > [data-row]')
    // 2026-11-08 — the reply's one `Revert`: at the foot of its group, since none of these has a
    // consent card; once used, the foot says when.
    const REVERT = 'button.vm-rv[title="Undo just this reply"]'
    // The main window's: the model's theme, camera, toolbar and status bar.
    const html = main.locator('html')
    const proj = main.locator('button[data-tip="Perspective / orthographic"]')
    const plan = main.locator('[data-role="toolbar"] button[data-tip="Plan"]')
    const north = main.locator('[data-role="toolbar"] button[data-tip="North elevation"]')
    const iso = main.locator('[data-role="toolbar"] button[data-tip="3D perspective (Home)"]')
    const grids = main.locator('button[data-tip="Gridlines (G)"]')
    const count = main.locator('[data-role="statusbar"] [title="visible / total elements"]')
    const clearAll = main.getByRole('button', { name: 'Clear all' })
    const board = page.locator('[data-role="vee-board"]')
    const colour = (button: Locator): Promise<string> => button.evaluate((b) => getComputedStyle(b).color)
    /** One whole turn: the question, the calls, the answer — and the reply's row once it rests. */
    const turn = async (question: string, calls: [string, unknown][], settled: () => Promise<void>): Promise<Locator> => {
      await askVee(page, question)
      await expect(send).toHaveAttribute('aria-label', 'Stop')
      for (const [name, input] of calls) await tool(app, name, input)
      await settled()
      await emit(app, { type: 'done', text: 'Done.', rounds: 2 })
      await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
      const reply = rows.last()
      await expect(reply).not.toHaveAttribute('aria-hidden', 'true')
      return reply
    }

    await expect(html).toHaveAttribute('data-theme', 'dark')
    await expect(proj).toHaveText('persp')
    await expect(count).toHaveText('412 / 412')
    await expect(board).not.toHaveClass(/vm-iso/)
    // A view button that is not lit is the colour of the next one that is not; gridlines are off
    // (by default since 2026-11-07).
    const planOff = await colour(plan)
    expect(await colour(north)).toBe(planOff)
    // …and the 3D button is the one that is lit: the building boots on that view.
    const isoLit = await colour(iso)
    expect(isoLit).not.toBe(planOff)
    const gridsOff = await colour(grids)

    // 1 — a reply that only read has nothing to revert, so it offers nothing.
    const read = await turn('What is showing?', [['get_view_state', {}]], async () => {})
    await expect(read.locator(REVERT)).toHaveCount(0)

    // 2 — a reply that changed nothing about what is visible: the theme and the camera.
    const looks = await turn(
      'Light theme and a plan view.',
      [
        ['set_interface', { theme: 'light' }],
        ['set_view', { view: 'top' }]
      ],
      async () => {
        await expect(html).toHaveAttribute('data-theme', 'light')
        await expect(proj).toHaveText('ortho')
      }
    )
    // The Ask Vee window follows the theme; the Plan button is lit.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect.poll(async () => (await colour(plan)) === (await colour(north))).toBe(false)
    await expect(count).toHaveText('412 / 412')
    await expect(looks.locator(REVERT)).toHaveCount(1)
    await expect(looks.locator(REVERT)).toHaveText('Revert')
    await expect(board.locator('.vm-vw')).toHaveText('Plan')

    // The user carries on by hand with something that reply never touched: the gridlines, on.
    const gridsOffLight = await colour(grids)
    await grids.click()
    await expect.poll(() => colour(grids)).not.toBe(gridsOffLight)

    await looks.locator(REVERT).click()
    // The theme and the camera are back — the projection with it, the view button unlit…
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(proj).toHaveText('persp')
    await expect.poll(() => colour(plan)).toBe(planOff)
    expect(await colour(north)).toBe(planOff)
    // …the gridlines are still on, as the user left them. Nothing was hidden, and nothing was lost.
    expect(await colour(grids)).not.toBe(gridsOff)
    await expect(count).toHaveText('412 / 412')
    await expect(log.getByText('Everything else was reverted.')).toHaveCount(0)
    // Used once: the control is gone, and the reply's foot says it was reverted, and when.
    await expect(looks.locator(REVERT)).toHaveCount(0)
    await expect(looks.locator('.vm-foot')).toHaveText(/^Reverted · \d\d:\d\d$/)
    await expect(read.locator(REVERT)).toHaveCount(0)

    // 3 — a reply that hides and cuts: one revert puts back both, and the visibility part of it is
    // on the undo stack, as it always was. A cut turns the camera to face it and unlights the view
    // button — the viewer's own doing, and so the reply's too.
    await expect.poll(() => colour(iso)).toBe(isoLit)
    const cut = await turn(
      'Only L2, cut at gridline C.',
      [
        ['set_storeys', { visible: ['L2'] }],
        ['set_section', { kind: 'grid', name: 'C' }]
      ],
      async () => {
        await expect(count).toHaveText('92 / 412')
        // `set_section` opens the Section card, as a click on a grid bubble does.
        await expect(clearAll).toBeVisible()
        await expect.poll(() => colour(iso)).toBe(planOff)
      }
    )
    // The board says what the 3D view shows now, whoever changed it.
    await expect(board).toHaveClass(/vm-iso/)
    await expect(board.locator('.vm-board-txt')).toHaveText(/^92 of 412 shown/)
    await expect(cut.locator(REVERT)).toHaveCount(1)
    await cut.locator(REVERT).click()
    await expect(count).toHaveText('412 / 412')
    await expect(board).not.toHaveClass(/vm-iso/)
    // The cut is cleared and the card it opened is shut again; the camera is back on the view it
    // stood on, so its button is lit again.
    await expect(clearAll).toHaveCount(0)
    await expect.poll(() => colour(iso)).toBe(isoLit)
    await expect(proj).toHaveText('persp')
    await expect(cut.locator(REVERT)).toHaveCount(0)
    // ⌘Z walks the revert's visibility back, exactly as before the widening.
    await main.locator('[data-role="actionbar"] button[data-tip^="Undo the last visibility change"]').click()
    await expect(count).toHaveText('92 / 412')
    await expect(board.locator('.vm-board-txt')).toHaveText(/^92 of 412 shown/)
  } finally {
    await app.close()
  }
})
