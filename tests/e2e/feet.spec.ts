/**
 * 2026-10-09 — a model drawn in feet, in the built app (owner-requested: *"Why model units not
 * automatically using the units provided by model? in other countries are feets"* — *"Starts in
 * the first model's unit, adds feet-and-inches next to mm and m, and shows coordinates in the
 * file's map unit"*). Run it only through `node scripts/safe-e2e.cjs` (`npm run test:e2e`).
 *
 * `tests/fixtures/feet.ifc` (`scripts/make-tiny-ifc.py`): one small building in FOOT, SQUARE FOOT
 * and CUBIC FOOT, its storeys at 0'-0" and 10'-6", its grid at 20'-0" and 30'-0", placed at the
 * repository's synthetic map position in US survey feet. Opened through the real pipeline, it
 * must boot in `ft` — the status bar, the storey list, the level tags, the grid dimensions, a
 * laser measurement, the Markups card, the Section card's field, the session — and the
 * Coordinate-system card must read its base point in US survey feet. Then the card's own `mm`
 * puts every one of them back in millimetres.
 *
 * The laser measurement is placed by the assistant's `manage_markups`, which is the viewer's
 * own commit for a click (`viewer-core.ts`): **no API and no key** — main's two turn handlers are
 * held and each call is sent over the real channel (`helpers.ts`).
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { THIN_SPACE as T } from '../../src/shared/fmt'
import { DROP_COPY, emit, holdTurns, launch, readSession, ROOT, statusText, tool, toolResults } from './helpers'

const FEET = join(ROOT, 'tests/fixtures/feet.ifc')
const ASK = 'button[data-tip^="Ask the assistant"]'

let dir = ''

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-feet-'))
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** One held turn: the question, each call run by the app's own executor, the reply. */
async function turn(app: ElectronApplication, page: Page, question: string, calls: [string, unknown][]): Promise<unknown[]> {
  const send = page.locator('button[data-part="send"]')
  const before = (await toolResults(app)).length
  await page.locator('[data-role="chatinput"]').fill(question)
  await page.locator('[data-role="chatinput"]').press('Enter')
  await expect(send).toHaveAttribute('aria-label', 'Stop')
  for (const [name, input] of calls) await tool(app, name, input)
  await expect.poll(async () => (await toolResults(app)).length).toBe(before + calls.length)
  await emit(app, { type: 'done', text: 'Done.', rounds: 2 })
  await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
  return (await toolResults(app)).slice(before).map((r) => r.result)
}

/** Every label the 3D overlay draws, as text — every kind of space read as one plain space. */
const overlayTexts = async (page: Page): Promise<string[]> =>
  (await page.locator('[data-role="overlay"] > div').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim())

test('a model in feet boots in ft, every readout follows, and the card’s mm puts them back', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: FEET })
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })

    // ── the boot model's own unit: the status bar, the storey list, the session ──
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('5 / 5·ft·')
    const side = page.locator('aside')
    await expect(side.getByText(`+10'-6"`, { exact: true })).toBeVisible()
    await expect(side.getByText(`+0'-0"`, { exact: true })).toBeVisible()
    await expect
      .poll(async () => {
        try {
          return (await readSession(dir)).payload.units
        } catch {
          return null
        }
      }, { timeout: 20_000 })
      .toBe('ft')

    // ── the 3D labels: the grid dimensions, and the level tags once levels are on ──
    await expect.poll(() => overlayTexts(page)).toContain(`20'-0"`)
    await page.locator('button[data-tip="Levels (L)"]').click()
    await expect.poll(async () => (await overlayTexts(page)).some((t) => t.includes('Level 2') && t.includes(`+10'-6"`))).toBe(true)

    // ── a laser measurement from the top of the ground slab, in feet and inches ──
    await page.locator(ASK).click()
    await expect(page.locator('[data-role="chatlog"]')).toBeVisible()
    await holdTurns(app)
    const [found] = (await turn(app, page, 'Where is the slab?', [
      ['query_sql', { sql: "SELECT e.id FROM element e WHERE e.name = 'Slab L1' LIMIT 1" }]
    ])) as { rows: number[][] }[]
    const id = found.rows[0][0]
    const [placed] = (await turn(app, page, 'Measure from the top of it.', [
      ['manage_markups', { op: 'place_measure', id, at: 'top' }]
    ])) as { placed: boolean; measure: Record<string, unknown> }[]
    expect(placed.placed).toBe(true)
    // In the card's unit, which is decimal feet: 19.5 ft to Wall W, 14.5 ft to Wall S, 9.5 ft up.
    expect(placed.measure).toMatchObject({ x: 19.5, y: 14.5, z: 9.5 })
    const labels = await overlayTexts(page)
    for (const reading of [`X 19'-6"`, `Y 14'-6"`, `Z 9'-6"`]) {
      expect([reading, labels.includes(reading)]).toEqual([reading, true])
    }
    await page.locator(ASK).click()

    // ── the Markups card: ft is the lit button, and its row reads feet and inches ──
    await page.locator('[data-role="actionbar"] button', { hasText: '1 measures' }).click()
    const card = page.locator('[data-role="stage"] > div').filter({ hasText: /^Markups/ })
    await expect(card).toBeVisible()
    const row = card.locator('div.hv-step', { has: page.locator('button[data-tip="Zoom to this measurement"]') })
    await expect(row).toContainText(`X 19'-6"`)
    await expect(row).toContainText(`Z 9'-6"`)
    const lit = (name: string): Promise<string> =>
      card.getByRole('button', { name, exact: true }).evaluate((b) => getComputedStyle(b).backgroundColor)
    const [ftBg, mmBg] = [await lit('ft'), await lit('mm')]
    expect(ftBg).not.toBe(mmBg)

    // ── the Coordinate-system card: the base point in the US survey feet the file states ──
    await page.locator('button[data-tip="Coordinate system & true north"]').click()
    const coords = page.locator('[data-role="stage"] > div').filter({ hasText: /^Coordinate system/ })
    await expect(coords).toContainText('Easting US ft')
    await expect(coords).toContainText('Northing US ft')
    await expect(coords).toContainText('Elevation US ft')
    expect(await coords.locator('input').first().inputValue()).toBe('40503.387')

    // ── the Section card: its field and its nudges in feet ──
    await page.locator('button[data-tip="Section from gridline / level"]').click()
    const section = page.locator('[data-role="stage"] > div').filter({ hasText: /^Section/ })
    const level = section.locator('[role="group"][aria-label="At a level"]')
    await level.getByRole('button', { name: 'Level 2', exact: true }).click()
    // The design's 1 200 mm above the storey, shown in feet and inches as the nudges are.
    await expect(level.locator('input')).toHaveValue(`3'-11 1/4"`)
    await expect(level).toContainText('offset ft · level Level 2 · cut')
    await level.getByRole('button', { name: `+2'-0"`, exact: true }).click()
    await expect(level.locator('input')).toHaveValue(`5'-11 1/4"`)
    // Typed as feet and inches, or as decimal feet: it reads back in feet and inches.
    await level.locator('input').fill(`12'-6"`)
    await level.locator('input').blur()
    await expect(level.locator('input')).toHaveValue(`12'-6"`)
    await level.locator('input').fill('10.25')
    await level.locator('input').blur()
    await expect(level.locator('input')).toHaveValue(`10'-3"`)

    // ── the card's own mm: every readout back in millimetres ──
    await page.locator('[data-role="actionbar"] button', { hasText: '1 measures' }).click()
    await card.getByRole('button', { name: 'mm', exact: true }).click()
    await expect.poll(() => statusText(page)).toContain('5 / 5·mm·')
    await expect(row).toContainText(`X 5${T}944 mm`)
    await expect(side.getByText(`+3${T}200`, { exact: true })).toBeVisible()
    await expect.poll(() => overlayTexts(page)).toContain('6 096 mm')
    await expect.poll(() => overlayTexts(page)).toContain('Z 2 896 mm')
    await expect
      .poll(async () => {
        try {
          return (await readSession(dir)).payload.units
        } catch {
          return null
        }
      }, { timeout: 20_000 })
      .toBe('mm')
  } finally {
    await app.close()
  }
})
