/**
 * 2026-10-01 — the assistant's thinking trace, in the built app (the owner's "Ask Vee" handoff,
 * `design-reference/ask-vee/`). Run it only through `node scripts/safe-e2e.cjs`
 * (`npm run test:e2e`).
 *
 * **No API, no key, and no `window.__sgvueDev`** — the suite runs against the production bundle,
 * which has none. A turn is a conversation between main and the renderer: the renderer asks for
 * one (`ai:turn:start`), main sends events (`ai:event`) and tool calls (`ai:tool:exec`), the
 * renderer answers each call. Here **main's two turn handlers are replaced from the test** — as
 * the About test replaces `dialog.showMessageBox` — with a pair that only remember the turn, and
 * the test then sends the events itself, at its own pace, over the real channels. Everything on
 * the renderer's side is the app's own: `sendChat`, `handleEvent`, the real executor run on the
 * demo building, the trace, the panel.
 *
 * The demo building is the design's mock federation: 4 models, 412 elements, 80 walls, 24 of
 * them with no `ThermalTransmittance` — five on each of L1 … L4 and four on the roof.
 *
 * 2026-10-02 — the last test here is the reply's `revert`, widened (owner-approved): it puts
 * back everything that reply changed — the theme, the camera, a section — not only what is
 * visible, and it is offered exactly on a reply that changed something. It is here because it
 * needs the same held turn: the tools are the app's own, run by the real executor.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emit, holdTurns, launch, tool, type Held } from './helpers'

const DEMO = 'try the demo building →'
const ASK = 'button[data-tip^="Ask the assistant"]'
const QUESTION = 'Which walls have no thermal transmittance?'
const ANSWER = '**24 of 80 walls** have no Thermal Transmittance. Every `EW 200 Brick` wall carries one.'
const WALLS = {
  rules: [
    { prop: 'IfcEntity', op: '=', val: 'IfcWall' },
    { prop: 'ThermalTransmittance', op: 'absent', val: null }
  ]
}

let dir = ''

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-trace-'))
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

// The held turn itself — `holdTurns`, `emit`, `tool` — is in `helpers.ts` since 2026-10-02: the
// consent-gate spec drives its turns the same way.

const stops = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => (globalThis as unknown as { __turn: Held }).__turn.aborted)

/** The demo building open, the panel open, and main's turn handlers held. */
async function ready(media?: { reducedMotion: 'reduce' }): Promise<{ app: ElectronApplication; page: Page }> {
  const { app, page } = await launch(dir)
  if (media) await page.emulateMedia(media)
  await page.getByRole('button', { name: DEMO }).click()
  await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
  await page.locator(ASK).click()
  await expect(page.locator('[data-role="chatlog"]')).toBeVisible()
  await holdTurns(app)
  return { app, page }
}

/**
 * What a canvas shows, as one short string — **whatever rasterised it**. The page installs it as
 * `window.__picture`.
 *
 * Reading a canvas back is what makes Chromium move it from the GPU to the CPU, and the two
 * round a 7 px square's corners differently: the same 24 `roundRect` calls come out as two
 * byte-different pictures, one before the first read and one after. So a picture is not its
 * bytes. It is which pixels are at least a quarter there — every corner pixel is, on either
 * rasteriser, and neither one's faint fringe is — and which solid colours are among them.
 */
const PICTURE = `(canvas) => {
  if (!canvas) return { picture: '', inked: false }
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

type Picture = (canvas: HTMLCanvasElement | null) => { picture: string; inked: boolean }

/** What the last row of the log shows right now. */
interface Seen {
  /** The transcript's rows, the last one's place in it, and whether it is a reply still being written. */
  rows: number
  index: number
  live: boolean
  /** The status lines that can be seen, and their text. */
  status: string[]
  /** The ticker's visible lines: `Reading 4 models · 412 elements`. */
  ticks: string[]
  vee: string
  bubble: { x: number; y: number; w: number; h: number; opacity: number } | null
  /** Each word's opacity, and each answer row's. */
  words: number[]
  answerRows: string[]
  /** The typed line on its way up, when it shows: its top and its text. */
  lift: { top: number; text: string } | null
  moving: boolean
  /** The matrix as drawn (`PICTURE`), and whether anything is drawn on it at all. */
  matrix: string
  inked: boolean
}

/**
 * The page samples itself every 25 ms into `window.__seen` — each sample what `Seen` says — so
 * a test can ask afterwards what was shown, and in what order, without racing the animation.
 */
async function watch(page: Page): Promise<void> {
  await page.evaluate(`window.__picture = ${PICTURE}`)
  await page.evaluate(() => {
    const picture = (window as unknown as { __picture: Picture }).__picture
    const flat = (e: Element | null): string => (e?.textContent || '').replace(/\s+/g, ' ').trim()
    const visible = (e: Element | null): boolean => {
      if (!e) return false
      for (let n: Element | null = e; n && n.getAttribute('data-role') !== 'chatlog'; n = n.parentElement) {
        const c = getComputedStyle(n)
        if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) < 0.5) return false
      }
      return true
    }
    const sample = (): Seen => {
      const log = document.querySelector('[data-role="chatlog"]')!
      const all = [...log.querySelectorAll(':scope > [data-row]')]
      const row = all[all.length - 1] as HTMLElement | undefined
      const part = (name: string): HTMLElement | null => row?.querySelector(`[data-part="${name}"]`) ?? null
      const bubble = part('bubble')
      const box = bubble?.getBoundingClientRect()
      const canvas = bubble?.querySelector('canvas') ?? null
      const lift = document.querySelector<HTMLElement>('[data-part="lift"]')
      const drawn = picture(canvas)
      return {
        rows: all.length,
        index: Number(row?.getAttribute('data-row') ?? -1),
        live: row?.getAttribute('aria-hidden') === 'true',
        status: ['status-thinking', 'status-final', 'status']
          .map((name) => part(name))
          .filter((e) => visible(e) && e!.children.length === 0)
          .map(flat),
        ticks: [...(row?.querySelectorAll('[data-part="tick"]') ?? [])]
          .filter(visible)
          .map((t) => `${t.querySelector('[data-part="tick-label"]')!.textContent}${t.querySelector('[data-part="tick-mono"]')!.textContent}`.trim() +
            (getComputedStyle(t.querySelector('[data-part="tick-count"]')!).display === 'none' ? '' : ` · ${flat(t.querySelector('[data-part="tick-count"]'))}`)),
        vee: row?.querySelector('[data-role="vee"]')?.getAttribute('data-state') ?? '',
        bubble: box && bubble ? { x: box.x, y: box.y, w: box.width, h: box.height, opacity: Number(getComputedStyle(bubble).opacity) } : null,
        words: [...(row?.querySelectorAll('[data-part="word"]') ?? [])].map((w) => Number(getComputedStyle(w).opacity)),
        answerRows: [...(row?.querySelectorAll('[data-part="row"]') ?? [])].filter(visible).map(flat),
        lift: lift && getComputedStyle(lift).display !== 'none' ? { top: lift.getBoundingClientRect().top, text: flat(lift) } : null,
        moving: log.hasAttribute('data-moving'),
        matrix: drawn.picture,
        inked: drawn.inked
      }
    }
    const w = window as unknown as { __seen: Seen[]; __sample: () => Seen; __watch?: number }
    w.__seen = []
    w.__sample = sample
    if (w.__watch) clearInterval(w.__watch)
    w.__watch = window.setInterval(() => w.__seen.push(sample()), 25)
  })
}

const seen = (page: Page): Promise<Seen[]> => page.evaluate(() => (window as unknown as { __seen: Seen[] }).__seen)
const now = (page: Page): Promise<Seen> => page.evaluate(() => (window as unknown as { __sample: () => Seen }).__sample())
/** The distinct values of something across the samples, in the order they first appeared. */
const inOrder = <T,>(samples: Seen[], of: (s: Seen) => T[]): T[] => [...new Set(samples.flatMap(of))]

const ask = async (page: Page, text = QUESTION): Promise<void> => {
  await page.locator('[data-role="chatinput"]').fill(text)
  await page.locator('[data-role="chatinput"]').press('Enter')
}

test('a turn is drawn as it happens: Thinking, Reading, Filtering, Checking — then the answer and its rows', async () => {
  const { app, page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    const send = page.locator('button[data-part="send"]')
    await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
    await watch(page)
    await ask(page)

    // 1 — Send. The composer is empty again, the button is a stop, and the question is the
    // user's row — on the left, under `You`, where the assistant's rows are.
    await expect(page.locator('[data-role="chatinput"]')).toHaveValue('')
    await expect(send).toHaveAttribute('aria-label', 'Stop')
    await expect(send).toHaveAttribute('data-tip', 'Stop')
    const mine = log.locator(':scope > [data-row][data-mine]')
    await expect(mine).toHaveCount(1)
    await expect(mine.locator('[data-part="label"] > span').first()).toHaveText('You')
    const seedBubble = (await log.locator(':scope > [data-row]').first().locator('[data-part="bubble"]').boundingBox())!
    await expect.poll(async () => (await mine.locator('[data-part="bubble"]').boundingBox())!.x).toBe(seedBubble.x)
    // The reply being written is already the transcript's next row.
    await expect.poll(async () => (await now(page)).live).toBe(true)

    // 2 — the first tool: its data exists at once; the trace shows it at its own pace.
    await tool(app, 'query_elements', WALLS)
    await expect
      .poll(async () => (await now(page)).ticks.join(' | '), { timeout: 20_000 })
      .toBe('Checking Thermal Transmittance · 24 missing')

    // What was shown on the way, in order.
    const live = await seen(page)
    // The typed line rose out of the composer, in one piece, to where its bubble is.
    const lift = live.filter((s) => s.lift).map((s) => s.lift!)
    expect(lift.length).toBeGreaterThan(5)
    expect(new Set(lift.map((l) => l.text))).toEqual(new Set([QUESTION]))
    for (let i = 1; i < lift.length; i++) expect(lift[i].top).toBeLessThanOrEqual(lift[i - 1].top + 0.01)
    expect(lift[0].top - lift[lift.length - 1].top).toBeGreaterThan(40)
    // `Thinking` beside the name, from before the first step until the answer.
    expect(inOrder(live, (s) => s.status)).toEqual(['Thinking'])
    // The ticker: three steps, in order, each on its real count.
    const steps = inOrder(live, (s) => s.ticks.map((t) => t.split(' · ')[0]))
    expect(steps).toEqual(['Reading 4 models', 'Filtering IfcWall', 'Checking Thermal Transmittance'])
    const counts = (label: string): number[] =>
      inOrder(live, (s) => s.ticks.filter((t) => t.startsWith(label)).map((t) => Number(t.split(' · ')[1].split(' ')[0].replace(/,/g, ''))))
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
    // The trace bubble opened to ticker + matrix — 52 px — full width, and something was drawn.
    const open = live.filter((s) => s.ticks.length && s.bubble)
    expect(Math.max(...open.map((s) => s.bubble!.h))).toBeCloseTo(52, 0)
    expect(open[open.length - 1].bubble!.w).toBe(seedBubble.width)
    expect(new Set(open.map((s) => s.matrix)).size).toBeGreaterThan(20)
    // Vee, in front of the reply being written: thinking, then reading — and a hop at a finding.
    const states = inOrder(live.filter((s) => s.live), (s) => [s.vee])
    expect(states.slice(0, 2)).toEqual(['thinking', 'reading'])
    expect(states).toContain('found')
    expect(new Set(states)).toEqual(new Set(['thinking', 'reading', 'found']))

    // 3 — `done`. The answer is there at once: the status rolls to what was checked and how
    // long it took, the words come in, and the rows — one a storey, in the ladder's order.
    await page.evaluate(() => ((window as unknown as { __seen: unknown[] }).__seen = []))
    // The row being written, its mascot and its matrix are marked — as elements, not by anything
    // a re-render could copy.
    await log.locator(':scope > [data-row]').last().evaluate((row) => {
      for (const node of [row, row.querySelector('[data-role="vee"] canvas')!, row.querySelector('canvas[data-part="matrix"]')!]) {
        ;(node as unknown as { __live: boolean }).__live = true
      }
    })
    await emit(app, { type: 'done', text: ANSWER, rounds: 2 })
    await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
    const reply = log.locator(':scope > [data-row]').last()
    // The reply that commits is the row that was live: the same three elements, so nothing in it
    // started again and the cells went on from where they were.
    expect(
      await reply.evaluate((row) =>
        [row, row.querySelector('[data-role="vee"] canvas'), row.querySelector('canvas[data-part="matrix"]')].map(
          (node) => (node as unknown as { __live?: boolean } | null)?.__live === true
        )
      )
    ).toEqual([true, true, true])
    await expect(reply.locator('[data-part="status-final"]')).toHaveText(/^checked 80 walls · \d+s$/)
    await expect(reply.locator('[data-part="row"]')).toHaveText(['L15 walls', 'L25 walls', 'L35 walls', 'L45 walls', 'Roof4 walls'])
    await expect(log).not.toHaveAttribute('data-moving', '', { timeout: 10_000 })
    // The inline marks are elements, not characters: no asterisk and no backtick is shown.
    await expect(reply.locator('[data-part="text"]')).toHaveText('24 of 80 walls have no Thermal Transmittance. Every EW 200 Brick wall carries one.')
    const pieces = await reply
      .locator('[data-part="text"]')
      .evaluate((e) =>
        [...e.querySelectorAll('[data-part="word"] > span')].map((x) => [x.textContent, getComputedStyle(x).fontWeight, getComputedStyle(x).fontFamily.includes('Mono')])
      )
    expect(pieces).toEqual([
      ['24', '600', false],
      ['of', '600', false],
      ['80', '600', false],
      ['walls', '600', false],
      ['EW', '400', true],
      ['200', '400', true],
      ['Brick', '400', true]
    ])
    // The reply is announced as any reply is; the trace under it never was.
    await expect(reply).not.toHaveAttribute('aria-hidden', 'true')
    await expect(reply.locator('canvas[data-part="matrix"]')).toHaveAttribute('aria-hidden', 'true')
    // The answer's own motion: the words came in one after another, never all at once.
    const answered = await seen(page)
    const partial = answered.filter((s) => s.words.length && s.words.some((w) => w < 0.5) && s.words.some((w) => w > 0.5))
    expect(partial.length).toBeGreaterThan(2)
    expect(inOrder(answered, (s) => [s.vee]).pop()).toBe('done')

    // 4 — nothing is animating two seconds after the turn ended: the loop is idle, the matrix
    // is the same picture, and nothing in the reply changes.
    await page.waitForTimeout(2000)
    await page.evaluate(() => ((window as unknown as { __seen: unknown[] }).__seen = []))
    await page.waitForTimeout(700)
    const still = await seen(page)
    expect(still.length).toBeGreaterThan(15)
    expect(still.some((s) => s.moving)).toBe(false)
    expect(new Set(still.map((s) => s.matrix)).size).toBe(1)
    expect(new Set(still.map((s) => JSON.stringify([s.bubble, s.words, s.status, s.answerRows]))).size).toBe(1)
    expect(still[0].words.every((w) => w === 1)).toBe(true)
    expect(still[0].status).toEqual([expect.stringMatching(/^checked 80 walls · \d+s$/)])
    // The bubble a trace opened stays full width.
    expect(still[0].bubble!.w).toBe((await log.locator(':scope > [data-row]').first().locator('[data-part="bubble"]').boundingBox())!.width)

    // 5 — a row is a button: it selects the elements it counts.
    await reply.locator('[data-part="row"]').nth(4).click()
    await expect(page.locator('[data-role="propcard"]')).toBeVisible()
    await expect(page.locator('[data-role="propcard"]').getByText('4 selected · showing last')).toBeVisible()
    await reply.locator('[data-part="row"]').first().click()
    await expect(page.locator('[data-role="propcard"]').getByText('5 selected · showing last')).toBeVisible()

    // 6 — and the log, which now scrolls, does not scroll sideways: nothing in it is wider
    // than it is — not the reply's chip, not a tooltip waiting to be shown.
    const widths = await log.evaluate((e) => ({ client: e.clientWidth, scroll: e.scrollWidth, tall: e.scrollHeight > e.clientHeight, x: getComputedStyle(e).overflowX }))
    expect(widths.tall).toBe(true)
    expect(widths.scroll).toBe(widths.client)
    expect(widths.x).toBe('hidden')
    // A tooltip in the log is generated only while it shows, and then it is the design's.
    const replyButton = reply.locator('button[data-tip="Reply to this message"]')
    expect(await replyButton.evaluate((b) => getComputedStyle(b, '::after').content)).toBe('none')
    await replyButton.hover()
    await expect.poll(() => replyButton.evaluate((b) => getComputedStyle(b, '::after').content)).toBe('"Reply to this message"')
    await expect.poll(() => replyButton.evaluate((b) => getComputedStyle(b, '::after').opacity)).toBe('1')
    expect(await log.evaluate((e) => e.scrollLeft)).toBe(0)
  } finally {
    await app.close()
  }
})

test('the send button stops a running turn; Enter during one does nothing', async () => {
  const { app, page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    const send = page.locator('button[data-part="send"]')
    const input = page.locator('[data-role="chatinput"]')
    await ask(page)
    await expect(send).toHaveAttribute('aria-label', 'Stop')
    await tool(app, 'query_elements', WALLS)
    await expect(log.locator('[data-part="tick"]').first()).toBeVisible({ timeout: 10_000 })

    // Enter while the turn runs: the second question stays in the composer, unsent.
    await input.fill('and the doors?')
    await input.press('Enter')
    await expect(input).toHaveValue('and the doors?')
    await expect(log.locator(':scope > [data-row][data-mine]')).toHaveCount(1)
    expect(await stops(app)).toEqual([])
    // The arrow has given way to the square.
    const icon = async (): Promise<{ arrow: number; stop: number }> => ({
      arrow: Number(await send.locator('[data-part="send-arrow"]').evaluate((e) => getComputedStyle(e).opacity)),
      stop: Number(await send.locator('[data-part="send-stop"]').evaluate((e) => getComputedStyle(e).opacity))
    })
    await expect.poll(icon).toEqual({ arrow: 0, stop: 1 })
    expect(await send.locator('[data-part="send-stop"]').evaluate((e) => [e.getBoundingClientRect().width, getComputedStyle(e).borderRadius])).toEqual([8, '2px'])

    // The stop — **a double-click**, the way a hurried hand does it: main is asked to stop
    // exactly this turn, exactly once, and the panel says so. The second click lands when the
    // turn may already be over and the button a send button again; it does not send the draft.
    await send.dblclick()
    await expect(log.getByText('Stopped.', { exact: true })).toBeVisible()
    await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
    await page.waitForTimeout(400)
    expect(await stops(app)).toHaveLength(1)
    await expect(input).toHaveValue('and the doors?')
    await expect(log.locator(':scope > [data-row][data-mine]')).toHaveCount(1)
    await expect(log.getByText('Stopped.', { exact: true })).toBeVisible()
    // The live reply and its trace are gone; the question stays; the button sends again.
    await expect(log.locator(':scope > [data-row]')).toHaveCount(2)
    await expect(log.locator('[data-part="tick"], canvas[data-part="matrix"]')).toHaveCount(0)
    await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
    await expect.poll(icon).toEqual({ arrow: 1, stop: 0 })
    await expect(log).not.toHaveAttribute('data-moving', '')
    // …and the composer still holds what was typed, ready to be sent.
    await input.press('Enter')
    await expect(log.locator(':scope > [data-row][data-mine]')).toHaveCount(2)
    await expect(log.getByText('Stopped.', { exact: true })).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('a turn with no tool has no trace: the reply opens word by word, and says how long it took', async () => {
  const { app, page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    await watch(page)
    await ask(page, 'hello')
    await expect.poll(async () => (await now(page)).status.join()).toBe('Thinking')
    await emit(app, { type: 'done', text: 'Hello. Ask me about the model.', rounds: 1 })
    const reply = log.locator(':scope > [data-row]').last()
    await expect(reply.locator('[data-part="status-final"]')).toHaveText(/^\ds$/)
    await expect(log).not.toHaveAttribute('data-moving', '', { timeout: 10_000 })
    const all = await seen(page)
    // No ticker line was ever shown and nothing was ever drawn on the matrix.
    expect(inOrder(all, (s) => s.ticks)).toEqual([])
    expect(all.some((s) => s.inked)).toBe(false)
    expect(await reply.locator('[data-part="row"]').count()).toBe(0)
    // The reply hugs its text, as every reply did; a trace's bubble would be the log's width.
    const bubble = (await reply.locator('[data-part="bubble"]').boundingBox())!
    const seed = (await log.locator(':scope > [data-row]').first().locator('[data-part="bubble"]').boundingBox())!
    expect(bubble.width).toBeLessThan(seed.width - 40)
    expect(bubble.x).toBe(seed.x)
    await expect(reply.locator('[data-part="text"]')).toHaveText('Hello. Ask me about the model.')
    // It opened from nothing, and its words came in one after another.
    const heights = all.filter((s) => s.bubble && !s.live).map((s) => s.bubble!.h)
    expect(Math.min(...heights)).toBeLessThan(bubble.height / 2)
    expect(heights[heights.length - 1]).toBeCloseTo(bubble.height, 1)
    expect(all.some((s) => s.words.some((w) => w < 0.5) && s.words.some((w) => w > 0.5))).toBe(true)
    expect(inOrder(all.filter((s) => s.index === 2), (s) => [s.vee])).toEqual(['thinking', 'done'])
  } finally {
    await app.close()
  }
})

/**
 * 2026-10-08 — the owner: "the Ask VEE ai assistant answer are in one sentence, which is extremely
 * difficult to read … Present answer in simple table or list if applicable." A reply written as a
 * sentence, a list and a table is laid out as one (`ai/blocks.ts`, `ReplyText`): its pieces come
 * in one after another, its bubble ends exactly at its content, a table too wide for the panel
 * scrolls inside its own box — never the log — and a reply to it quotes it as one plain line.
 */
test('a reply written as a sentence, a list and a table is laid out as one, and quoted as one line', async () => {
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
  /** What the quote reads: no mark, no marker, no pipe — the list and the rows one line. */
  const FLAT =
    '24 of 80 walls have no Thermal Transmittance. 12 are in SB_ARC_R25 and 12 in SB_STR_R25; All 4 walls on the roof are ' +
    'missing it; Every EW 200 Brick wall carries one. Level, Walls, Missing, Type; ' +
    'L1, 19, 5, SB_ARC_R25_EXTERNAL_WALL_TYPE_WITHOUT_THERMAL_TRANSMITTANCE; Roof, 4, 4, all'
  const { app, page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    await watch(page)
    // A turn with no tool: its bubble would hug its text — but a table makes it full width.
    await ask(page, 'Which walls are missing it, by level?')
    await expect.poll(async () => (await now(page)).status.join()).toBe('Thinking')
    await emit(app, { type: 'done', text: FORMATTED, rounds: 1 })
    const reply = log.locator(':scope > [data-row]').last()
    await expect(reply.locator('[data-part="status-final"]')).toHaveText(/^\ds$/)
    await expect(log).not.toHaveAttribute('data-moving', '', { timeout: 10_000 })

    // The blocks: a paragraph, three items, a table — and none of the characters that wrote them.
    const text = reply.locator('[data-part="text"]')
    await expect(text.locator(':scope > p')).toHaveText('24 of 80 walls have no Thermal Transmittance.')
    await expect(text.locator(':scope > ul > li')).toHaveText([
      '•12 are in SB_ARC_R25 and 12 in SB_STR_R25.',
      '•All 4 walls on the roof are missing it.',
      '•Every EW 200 Brick wall carries one.'
    ])
    await expect(text.locator('table th')).toHaveText(['Level', 'Walls', 'Missing', 'Type'])
    await expect(text.locator('table tbody tr')).toHaveCount(2)
    expect(await text.textContent()).not.toMatch(/\*\*|`|\||---/)
    // The header is the result table's capitals; a column of numbers is right-aligned, in mono.
    expect(await text.locator('table th').first().evaluate((e) => getComputedStyle(e).textTransform)).toBe('uppercase')
    const walls = text.locator('table tbody tr').first().locator('td').nth(1)
    expect(await walls.evaluate((e) => [getComputedStyle(e).textAlign, getComputedStyle(e).fontFamily.includes('Mono')])).toEqual([
      'right',
      true
    ])

    // The pieces came in one after another — the sentence's words, each marker and its item's
    // words, the table whole — and are all in now: 8 + (1 + 8) + (1 + 9) + (1 + 7) + 1.
    const all = await seen(page)
    const last = all.filter((s) => s.index === 2 && s.words.length)
    expect(last[last.length - 1].words).toHaveLength(36)
    expect(last.some((s) => s.words.some((w) => w < 0.5) && s.words.some((w) => w > 0.5))).toBe(true)
    expect((await now(page)).words.every((w) => w === 1)).toBe(true)

    // Its bubble is the log's width, as the boot audit's is, and ends exactly at its content.
    const box = await reply.evaluate((row) => {
      const bubble = row.querySelector<HTMLElement>('[data-part="bubble"]')!
      const body = bubble.querySelector<HTMLElement>('[data-part="body"]')!
      const table = bubble.querySelector<HTMLElement>('table')!.parentElement!
      const log = row.parentElement!
      return {
        bubble: bubble.getBoundingClientRect().width,
        height: bubble.getBoundingClientRect().height,
        natural: body.getBoundingClientRect().height,
        inline: bubble.style.height,
        table: { client: table.clientWidth, scroll: table.scrollWidth, x: getComputedStyle(table).overflowX },
        log: { client: log.clientWidth, scroll: log.scrollWidth, x: getComputedStyle(log).overflowX }
      }
    })
    const seed = (await log.locator(':scope > [data-row]').first().locator('[data-part="bubble"]').boundingBox())!
    expect(box.bubble).toBeCloseTo(seed.width, 1)
    expect(box.inline).toBe('')
    expect(box.height).toBeCloseTo(box.natural, 1)
    // The table is wider than the bubble: it scrolls inside its own box, and the log does not.
    expect(box.table.x).toBe('auto')
    expect(box.table.scroll).toBeGreaterThan(box.table.client)
    expect(box.log.scroll).toBe(box.log.client)
    expect(box.log.x).toBe('hidden')

    // A reply to it quotes it as one plain line: in the strip, above the question, and to main.
    await reply.locator('button[data-tip="Reply to this message"]').click()
    const strip = page.locator('span', { hasText: /^Replying to Vee$/ }).locator('xpath=following-sibling::span[1]')
    await expect(strip).toHaveText(FLAT)
    await ask(page, 'and the doors?')
    const quote = FLAT.slice(0, 220) + '…'
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __turn: Held }).__turn.asked)).toEqual({
      userText: 'and the doors?',
      quote: { who: 'Vee', text: quote }
    })
    await expect(log.locator(':scope > [data-row][data-mine]').last()).toContainText(quote)
  } finally {
    await app.close()
  }
})

test('with reduced motion every state shows at its end, and nothing in between', async () => {
  const { app, page } = await ready({ reducedMotion: 'reduce' })
  try {
    const log = page.locator('[data-role="chatlog"]')
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
    await watch(page)
    await ask(page)
    await tool(app, 'query_elements', WALLS)
    await expect
      .poll(async () => (await now(page)).ticks.join(' | '), { timeout: 20_000 })
      .toBe('Checking Thermal Transmittance · 24 missing')
    await page.waitForTimeout(150)
    const live = await seen(page)
    // No lift, no roll, no count-up: each step is its own line with its final count, and only
    // ever one line at a time.
    expect(live.some((s) => s.lift)).toBe(false)
    expect(inOrder(live, (s) => s.ticks)).toEqual([
      'Reading 4 models · 412 elements',
      'Filtering IfcWall · 80 walls',
      'Checking Thermal Transmittance · 24 missing'
    ])
    expect(Math.max(...live.map((s) => s.ticks.length))).toBe(1)
    // The bubble is either not there or open — 52 px — never part of the way.
    expect(new Set(live.filter((s) => s.live && s.bubble).map((s) => Math.round(s.bubble!.h)))).toEqual(new Set([0, 52]))
    // The matrix is three pictures — read, filtered, checked — and none between them.
    expect(new Set(live.filter((s) => s.ticks.length).map((s) => s.matrix)).size).toBe(3)
    // Vee holds one frame of each state: thinking, reading, a finding.
    expect(inOrder(live.filter((s) => s.live), (s) => [s.vee])).toEqual(['thinking', 'reading', 'found'])

    await page.evaluate(() => ((window as unknown as { __seen: unknown[] }).__seen = []))
    await emit(app, { type: 'done', text: ANSWER, rounds: 2 })
    const reply = log.locator(':scope > [data-row]').last()
    await expect(reply.locator('[data-part="row"]')).toHaveCount(5)
    await page.waitForTimeout(1500)
    const after = (await seen(page)).filter((s) => !s.live && s.words.length)
    expect(after.length).toBeGreaterThan(20)
    // From the first sample that has the answer in it, the reply is its finished self: every
    // word in, every row in, the cells in their rows, the status final, the bubble at its height.
    for (const what of ['bubble', 'words', 'status', 'answerRows', 'ticks', 'matrix'] as const) {
      const values = [...new Set(after.map((s) => JSON.stringify(s[what])))]
      expect([what, values.length, values.join(' | ')]).toEqual([what, 1, expect.any(String)])
    }
    expect(after[0].words.every((w) => w === 1)).toBe(true)
    expect(after[0].answerRows).toEqual(['L15 walls', 'L25 walls', 'L35 walls', 'L45 walls', 'Roof4 walls'])
    expect(after[0].status).toEqual([expect.stringMatching(/^checked 80 walls · \d+s$/)])
    expect(after[0].ticks).toEqual([])
    expect(after.some((s) => s.moving)).toBe(false)
    expect(after[after.length - 1].vee).toBe('done')
  } finally {
    await app.close()
  }
})

test('the next turn leaves the reply before it finished and at rest, however soon it is sent', async () => {
  const { app, page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    const input = page.locator('[data-role="chatinput"]')
    const send = page.locator('button[data-part="send"]')
    await page.evaluate(`window.__picture = ${PICTURE}`)
    await ask(page)
    await tool(app, 'query_elements', WALLS)
    await expect(log.locator('[data-part="tick"]').first()).toBeVisible({ timeout: 10_000 })

    // The next question is typed while the turn runs and sent the moment the answer is there —
    // while its words are still coming in and its cells are still on their way to the rows.
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
    const reading = (): Promise<{
      inline: string[]
      words: number[]
      rows: string[]
      rowsIn: boolean
      status: string
      rolling: number
      vee: string | null
      height: number
      natural: number
      matrix: string
      inked: boolean
    }> =>
      first.evaluate((row) => {
        const bubble = row.querySelector<HTMLElement>('[data-part="bubble"]')!
        const body = bubble.querySelector<HTMLElement>('[data-part="body"]')!
        const drawn = (window as unknown as { __picture: Picture }).__picture(bubble.querySelector('canvas'))
        const rows = [...row.querySelectorAll<HTMLElement>('[data-part="row"]')]
        const moved = [
          row.querySelector<HTMLElement>('[data-part="label"]')!,
          row.querySelector<HTMLElement>('[data-part="sprite"]')!,
          bubble,
          ...row.querySelectorAll<HTMLElement>('[data-part="word"]'),
          ...rows
        ]
        return {
          // Every style the trace writes, on every element it writes it on.
          inline: [...new Set([...moved.flatMap((e) => [e.style.opacity, e.style.transform, e.style.top]), bubble.style.height])],
          words: [...row.querySelectorAll('[data-part="word"]')].map((w) => Number(getComputedStyle(w).opacity)),
          rows: rows.map((r) => (r.textContent || '').replace(/\s+/g, ' ').trim()),
          rowsIn: rows.every((r) => getComputedStyle(r).opacity === '1' && getComputedStyle(r).transform === 'none'),
          status: row.querySelector('[data-part="status"]')?.textContent ?? '',
          rolling: row.querySelectorAll('[data-part="status-thinking"], [data-part="status-final"]').length,
          vee: row.querySelector('[data-role="vee"]')?.getAttribute('data-state') ?? null,
          height: bubble.getBoundingClientRect().height,
          natural: body.getBoundingClientRect().height,
          matrix: drawn.picture,
          inked: drawn.inked
        }
      })

    // At once — not after its two seconds of arriving: the trace has left this reply, so it is
    // simply finished. Nothing of the trace's is written on it, every word and row is in, its
    // bubble is as tall as its content, its status is one plain line and its mascot is at rest.
    const now1 = await reading()
    expect(now1.inline).toEqual([''])
    expect(now1.words.length).toBeGreaterThan(8)
    expect(now1.words.every((w) => w === 1)).toBe(true)
    expect(now1.rows).toEqual(['L15 walls', 'L25 walls', 'L35 walls', 'L45 walls', 'Roof4 walls'])
    expect(now1.rowsIn).toBe(true)
    expect(now1.status).toMatch(/^checked 80 walls · \d+s$/)
    expect(now1.rolling).toBe(0)
    expect(now1.vee).toBe('idle')
    expect(now1.height).toBeCloseTo(now1.natural, 1)
    // Its rows' cells are drawn where the rows are — 24 squares of one colour, in five rows —
    // and stay exactly so while the next turn runs.
    await expect.poll(async () => (await reading()).inked).toBe(true)
    const rest = (await reading()).matrix
    // (Counted at this display's own ratio of 1, where a row's cell is 7 device pixels square.)
    if ((await page.evaluate(() => window.devicePixelRatio)) === 1) expect(rest).toMatch(/^\d+x\d+:1176:\d+:[\d.]+$/)
    await page.waitForTimeout(1200)
    const later = await reading()
    expect(later.matrix).toBe(rest)
    expect({ ...later, matrix: '' }).toEqual({ ...now1, matrix: '', inked: true })
    // Meanwhile the trace is the new turn's: its reply is the row being written.
    await expect(second.locator('[data-part="status-thinking"]')).toHaveText('Thinking')
    await expect(second.locator('[data-role="vee"]')).toHaveAttribute('data-state', 'thinking')

    // An older reply's rows still select what they count.
    await first.locator('[data-part="row"]').nth(4).click()
    await expect(page.locator('[data-role="propcard"]').getByText('4 selected · showing last')).toBeVisible()

    // The second turn answers with no tool: its own reply settles, and the first has not changed.
    await emit(app, { type: 'done', text: 'There are 12 doors.', rounds: 1 })
    await expect(second.locator('[data-part="status-final"]')).toHaveText(/^\ds$/)
    await expect(log).not.toHaveAttribute('data-moving', '', { timeout: 10_000 })
    await expect(second.locator('[data-role="vee"]')).toHaveAttribute('data-state', 'done')
    expect({ ...(await reading()), matrix: '' }).toEqual({ ...now1, matrix: '', inked: true })
  } finally {
    await app.close()
  }
})

test('revert puts back everything that reply changed — theme, camera, visibility — and only that', async () => {
  const { app, page } = await ready()
  try {
    const log = page.locator('[data-role="chatlog"]')
    const send = page.locator('button[data-part="send"]')
    const rows = log.locator(':scope > [data-row]')
    const REVERT = 'button[data-tip="Undo just this step"]'
    const html = page.locator('html')
    const proj = page.locator('button[data-tip="Perspective / orthographic"]')
    const plan = page.locator('[data-role="toolbar"] button[data-tip="Plan"]')
    const north = page.locator('[data-role="toolbar"] button[data-tip="North elevation"]')
    const iso = page.locator('[data-role="toolbar"] button[data-tip="3D perspective (Home)"]')
    const grids = page.locator('button[data-tip="Gridlines (G)"]')
    const count = page.locator('[data-role="statusbar"] [title="visible / total elements"]')
    const clearAll = page.getByRole('button', { name: 'Clear all' })
    const colour = (button: typeof plan): Promise<string> => button.evaluate((b) => getComputedStyle(b).color)
    /** One whole turn: the question, the calls, the answer — and the reply's row once it rests. */
    const turn = async (question: string, calls: [string, unknown][], settled: () => Promise<void>) => {
      await ask(page, question)
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
    // A view button that is not lit is the colour of the next one that is not; gridlines are on.
    const planOff = await colour(plan)
    expect(await colour(north)).toBe(planOff)
    // …and the 3D button is the one that is lit: the building boots on that view.
    const isoLit = await colour(iso)
    expect(isoLit).not.toBe(planOff)
    const gridsOn = await colour(grids)

    // 1 — a reply that only read has nothing to revert, so it offers nothing.
    const read = await turn('What is showing?', [['get_view_state', {}]], async () => {})
    await expect(read.locator(REVERT)).toHaveCount(0)

    // 2 — a reply that changed nothing about what is visible: the theme and the camera.
    // Before 2026-10-02 this reply had a `revert` that put nothing back.
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
    // The Plan button is lit: in this theme it is no longer the colour of its unlit neighbour.
    await expect.poll(async () => (await colour(plan)) === (await colour(north))).toBe(false)
    await expect(count).toHaveText('412 / 412')
    await expect(looks.locator(REVERT)).toHaveCount(1)
    await expect(looks.locator(REVERT)).toHaveText('revert')

    // The user carries on by hand with something that reply never touched: the gridlines.
    const gridsOnLight = await colour(grids)
    await grids.click()
    await expect.poll(() => colour(grids)).not.toBe(gridsOnLight)

    await looks.locator(REVERT).click()
    // The theme and the camera are back — the projection with it, the view button unlit…
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await expect(proj).toHaveText('persp')
    await expect.poll(() => colour(plan)).toBe(planOff)
    expect(await colour(north)).toBe(planOff)
    // …the gridlines are still off, as the user left them: in the dark theme again, the button
    // is not the colour it had while they were on. Nothing was hidden, and nothing was lost.
    expect(await colour(grids)).not.toBe(gridsOn)
    await expect(count).toHaveText('412 / 412')
    await expect(log.getByText('Everything else was reverted.')).toHaveCount(0)
    // Used once: the control is gone and the reply is dimmed, as the design dims it.
    await expect(looks.locator(REVERT)).toHaveCount(0)
    await expect(read.locator(REVERT)).toHaveCount(0)

    // 3 — a reply that hides and cuts: one revert puts back both, and the visibility part of
    // it is on the undo stack, as it always was. A cut turns the camera to face it and unlights
    // the view button — the viewer's own doing, and so the reply's too.
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
    await expect(cut.locator(REVERT)).toHaveCount(1)
    await cut.locator(REVERT).click()
    await expect(count).toHaveText('412 / 412')
    // The cut is cleared and the card it opened is shut again; the camera is back on the view
    // it stood on, so its button is lit again.
    await expect(clearAll).toHaveCount(0)
    await expect.poll(() => colour(iso)).toBe(isoLit)
    await expect(proj).toHaveText('persp')
    await expect(cut.locator(REVERT)).toHaveCount(0)
    // ⌘Z walks the revert's visibility back, exactly as before the widening.
    await page.locator('[data-role="actionbar"] button[data-tip^="Undo the last visibility change"]').click()
    await expect(count).toHaveText('92 / 412')
  } finally {
    await app.close()
  }
})
