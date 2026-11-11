/**
 * The federating indicator, in the real app (2026-11-12, the owner's pick "B" · Edge trace) — the
 * windowed half of `tests/unit/fed-trace.test.ts`.
 *
 * One model is opened from the landing page; then models are added to the open viewer the way a
 * user adds them — the sidebar's `upload` button, answered by `SGVUE_OPEN_PATHS` — and a recorder
 * in the page writes down every state the line and the caption go through:
 *
 *   1. a load into an open viewer shows the line and the caption, stage by stage in the design's
 *      words, `1/5` … `5/5`, never together with the centre `Rebuilding federation…` badge; it
 *      ends on the tick and `+N elements` — N the growth of the status bar's own total — and then
 *      both pieces are **removed**;
 *   2. the line stands 5 px inside the stage's top edge, and neither piece meets the toolbar, the
 *      view cube, the status bar or the Ask pill, nor takes the pointer — at the default window,
 *      at a narrow one, and with a tool hint, the reset pill and the property card all showing;
 *   3. the first load, from the landing page, never shows it;
 *   4. a file that cannot be opened ends on `could not open — see Models`, and is removed;
 *   5. under reduced motion there is no glint, and the pieces are still removed.
 *
 * Only ever through `npm run test:e2e` (`scripts/safe-e2e.cjs`), the guarded wrapper, and only on
 * the owner's yes. `SGVUE_SHOTS=<folder>` keeps a screenshot of each state.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STAGES } from '../../src/shared/upload'
import { FED_FAILED } from '../../src/shared/fed-trace'
import { DROP_COPY, HIGH_FIRST, ROOT, TINY, launch, statusText } from './helpers'

const SHOTS = process.env.SGVUE_SHOTS || ''
const REFERENCE = join(ROOT, 'tests/fixtures/reference.ifc')
const EDGE = join(ROOT, 'tests/fixtures/edge.ifc')
const FEET = join(ROOT, 'tests/fixtures/feet.ifc')
const UPLOAD = '[data-tip="Upload an IFC file — it parses in the background"]'
const LINE = '[data-role="fedline"]'
const CAPTION = '[data-role="fedcaption"]'

let dir = ''
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-e2e-fed-'))
  if (SHOTS) await mkdir(SHOTS, { recursive: true })
  const launched = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  app = launched.app
  page = launched.page
})

test.afterAll(async () => {
  await app.close()
  await rm(dir, { recursive: true, force: true })
})

/** What the next native Open dialog answers, in a development build (`src/main/index.ts`). */
const answerOpenWith = (paths: string): Promise<void> =>
  app.evaluate((_electron, p) => {
    process.env.SGVUE_OPEN_PATHS = p
  }, paths)

interface Recorded {
  /** `caption text|segment states`, one entry per change; `null|null` while neither is drawn. */
  log: string[]
  /** Times the centre badge was in the stage together with a piece of the indicator. */
  badgeWith: number
  /** The most glints the line carried at once. */
  glints: number
}

/** Start (or restart) the recorder: every state the two pieces go through, as the DOM has them. */
const record = (): Promise<void> =>
  page.evaluate(() => {
    const w = window as unknown as { __fed?: Recorded & { stop(): void } }
    w.__fed?.stop()
    const stage = document.querySelector('[data-role="stage"]')!
    const rec: Recorded = { log: [], badgeWith: 0, glints: 0 }
    const look = (): void => {
      const cap = document.querySelector('[data-role="fedcaption"]')
      const line = document.querySelector('[data-role="fedline"]')
      const segs = line ? [...line.children].map((c) => (c as HTMLElement).dataset.seg).join(',') : null
      const entry = `${cap ? cap.textContent : null}|${segs}`
      if (rec.log[rec.log.length - 1] !== entry) rec.log.push(entry)
      if ((cap || line) && (stage.textContent || '').includes('Rebuilding federation')) rec.badgeWith++
      if (line) rec.glints = Math.max(rec.glints, line.querySelectorAll('span').length - line.children.length)
    }
    const mo = new MutationObserver(look)
    mo.observe(stage, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-seg'] })
    look()
    w.__fed = Object.assign(rec, { stop: () => mo.disconnect() })
  })

const recorded = (): Promise<Recorded> =>
  page.evaluate(() => {
    const { log, badgeWith, glints } = (window as unknown as { __fed: Recorded }).__fed
    return { log: [...log], badgeWith, glints }
  })

/** The status bar's `visible / total`: the total. */
const total = async (): Promise<number> => Number((/\/\s*(\d+)/.exec(await statusText(page)) ?? [])[1])

const fmt = (b: number[]): string => `[${b.map((v) => Math.round(v * 100) / 100).join(', ')}]`

const shot = async (name: string): Promise<void> => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

interface Layout {
  stage: number[]
  line: number[]
  caption: number[]
  /** Pairs that intersect, by name. */
  meets: string[]
  /** What is under the middle of each piece: must not be the piece. */
  under: string[]
}

/** Where the two pieces stand, what they meet, and what a pointer over them would reach. */
const layout = (): Promise<Layout> =>
  page.evaluate(() => {
    const box = (el: Element | null | undefined): number[] => {
      if (!el) return []
      const r = el.getBoundingClientRect()
      return [r.left, r.top, r.width, r.height]
    }
    const q = (s: string): Element | null => document.querySelector(s)
    const line = q('[data-role="fedline"]')
    const caption = q('[data-role="fedcaption"]')
    const ask = [...document.querySelectorAll('[data-role="bottomrow"] button')].find((b) => /Ask Vee/.test(b.textContent || ''))
    const others: Record<string, Element | null | undefined> = {
      toolbar: q('[data-role="toolbar"]'),
      cube: q('[data-role="cube"]'),
      statusbar: q('[data-role="statusbar"]'),
      hint: q('[data-role="hintbar"]'),
      reset: q('[data-role="resetpill"]'),
      card: q('[data-role="propcard"]'),
      ask
    }
    const hit = (a: number[], b: number[]): boolean =>
      a.length > 0 && b.length > 0 && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
    const meets: string[] = []
    const under: string[] = []
    for (const [name, piece] of [['line', line], ['caption', caption]] as const) {
      const b = box(piece)
      for (const [other, el] of Object.entries(others)) if (hit(b, box(el))) meets.push(`${name} × ${other}`)
      if (!piece || !b.length) continue
      const at = document.elementFromPoint(b[0] + b[2] / 2, b[1] + b[3] / 2)
      if (at && piece.contains(at)) under.push(name)
    }
    return { stage: box(q('[data-role="stage"]')), line: box(line), caption: box(caption), meets, under }
  })

/** One file added to the open viewer: the stages it showed, and how it ended. */
async function addModel(path: string, name: string, shots: string): Promise<{ rec: Recorded; added: number }> {
  const before = await total()
  await record()
  await answerOpenWith(path)
  await page.locator(UPLOAD).click()
  await expect(page.locator(CAPTION)).toBeVisible()
  await expect(page.locator(LINE)).toBeVisible()
  // Past the 220 ms entrance, so the capture is of the settled pieces (a stage holds 420 ms).
  await page.waitForTimeout(300)
  const mid = await layout()
  await shot(`${shots}-loading`)
  if (SHOTS) console.log(`[fed-trace] ${shots} stage ${fmt(mid.stage)} line ${fmt(mid.line)} caption ${fmt(mid.caption)}`)
  // The line: 2 px, 5 px inside the stage's top, left and right.
  expect(mid.line[1] - mid.stage[1], 'line top').toBeCloseTo(5, 0)
  expect(mid.line[0] - mid.stage[0], 'line left').toBeCloseTo(5, 0)
  expect(mid.line[2], 'line width').toBeCloseTo(mid.stage[2] - 10, 0)
  expect(mid.line[3], 'line height').toBeCloseTo(2, 0)
  expect(mid.meets, 'while loading').toEqual([])
  expect(mid.under, 'pointer events').toEqual([])

  await expect(page.locator(CAPTION)).toHaveText(/^\+[\d ]+ elements?$/, { timeout: 60_000 })
  const end = await layout()
  await shot(`${shots}-joined`)
  expect(end.meets, 'joined').toEqual([])
  const text = (await page.locator(CAPTION).textContent()) ?? ''
  const added = Number(text.replace(/[^\d]/g, ''))

  // Removed, not hidden — and within the hold and the exit.
  await expect(page.locator(CAPTION)).toHaveCount(0, { timeout: 5_000 })
  await expect(page.locator(LINE)).toHaveCount(0)
  expect(added, 'the count is the status bar’s own growth').toBe((await total()) - before)

  const rec = await recorded()
  expect(rec.badgeWith, 'never with the centre badge').toBe(0)
  // The stages, in the design's words and in order, each with its segments.
  const loading = rec.log.filter((e) => e.startsWith(`${name}·`))
  const steps = loading.map((e) => Number((/·(\d)\/5\|/.exec(e) ?? [])[1]))
  expect(steps[0], `first stage of ${loading.join(' → ')}`).toBe(1)
  expect(steps[steps.length - 1], 'last stage').toBe(5)
  expect([...steps].sort((a, b) => a - b), 'never backwards').toEqual(steps)
  for (const e of loading) {
    const n = Number((/·(\d)\/5\|/.exec(e) ?? [])[1])
    const segs = STAGES.map((_, i) => (i < n - 1 ? 'done' : i === n - 1 ? 'current' : 'pending')).join(',')
    expect(e).toBe(`${name}·${STAGES[n - 1][1]}·${n}/5|${segs}`)
  }
  expect(rec.log.some((e) => /^\+[\d ]+ elements?\|ok,ok,ok,ok,ok$/.test(e)), 'the joined state').toBe(true)
  expect(rec.log[rec.log.length - 1]).toBe('null|null')
  return { rec, added }
}

test('a model added to an open viewer shows the line and the caption, and they go', async () => {
  // 3 — the first load, from the landing page, never shows it.
  await page.evaluate(() => {
    const w = window as unknown as { __bootSaw: number }
    w.__bootSaw = 0
    new MutationObserver(() => {
      if (document.querySelector('[data-role="fedline"], [data-role="fedcaption"]')) w.__bootSaw++
    }).observe(document.body, { subtree: true, childList: true })
  })
  await page.getByText(DROP_COPY).click()
  await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
  await expect.poll(() => total()).toBeGreaterThan(0)
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => (window as unknown as { __bootSaw: number }).__bootSaw), 'the boot').toBe(0)
  await expect(page.locator(LINE)).toHaveCount(0)
  await expect(page.locator(CAPTION)).toHaveCount(0)
  await shot('0-idle-dark')

  // 1, 2 — dark, the default window.
  const dark = await addModel(HIGH_FIRST, 'high-first.ifc', '1-dark')
  expect(dark.rec.glints, 'one glint, on the current segment').toBe(1)
  expect(dark.added).toBeGreaterThan(0)

  // …and light.
  await page.locator('[data-tip="Light / dark"]').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await addModel(EDGE, 'edge.ifc', '2-light')

  // 4 — a file that cannot be opened: an archive with no `.ifc` in it.
  const empty = join(dir, 'empty.ifczip')
  await writeFile(empty, Buffer.concat([Buffer.from('PK\x05\x06', 'latin1'), Buffer.alloc(18)]))
  await record()
  await answerOpenWith(empty)
  await page.locator(UPLOAD).click()
  await expect(page.locator(CAPTION)).toHaveText(FED_FAILED, { timeout: 30_000 })
  await page.waitForTimeout(300)
  await shot('3-light-failed')
  expect((await layout()).meets, 'failed').toEqual([])
  await expect(page.locator(CAPTION)).toHaveCount(0, { timeout: 5_000 })
  await expect(page.locator(LINE)).toHaveCount(0)
  expect((await recorded()).badgeWith).toBe(0)

  // 2 — a narrow window, where the bottom row's centre has the least room.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(820, 700))
  await page.waitForTimeout(400)
  await addModel(FEET, 'feet.ifc', '4-narrow')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1264, 755))
  await page.waitForTimeout(400)

  // 2 — the crowded bottom edge: a tool hint, the reset pill above it, and the property card.
  const vp = (await page.locator('[data-role="viewport"]').boundingBox())!
  await page.mouse.click(vp.x + vp.width / 2, vp.y + vp.height / 2)
  await page.locator('[data-tip^="Laser meter"]').click()
  await expect(page.locator('[data-role="hintbar"]')).toBeVisible()
  await page.locator('button[title="Show / hide storey"]').first().click()
  await expect(page.locator('[data-role="resetpill"]')).toBeVisible()
  if (SHOTS) console.log(`[fed-trace] 6-crowded property card shown: ${(await page.locator('[data-role="propcard"]').count()) > 0}`)
  const annex = join(dir, 'annex.ifc')
  await copyFile(HIGH_FIRST, annex)
  await addModel(annex, 'annex.ifc', '6-crowded')
  await page.keyboard.press('Escape')
  await page.locator('[data-role="resetpill"] button').click()
  await expect(page.locator('[data-role="resetpill"]')).toHaveCount(0)

  // 5 — reduced motion: no glint, and still removed.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  // The reference model last: it stands on the synthetic site, far from the others.
  const still = await addModel(REFERENCE, 'reference.ifc', '5-reduced')
  expect(still.rec.glints, 'no glint under reduced motion').toBe(0)

  // Nothing of it is left: no element, no animation.
  expect(
    await page.evaluate(
      () => document.getAnimations().filter((a) => /fedfade|ifcsweep/.test((a as CSSAnimation).animationName || '')).length
    )
  ).toBe(0)
})
