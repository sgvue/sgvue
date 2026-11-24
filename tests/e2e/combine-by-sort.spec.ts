/**
 * 2026-11-24 — itemise off, combine by sort value: one row per distinct value of the sort levels,
 * as Revit does with "Itemize every instance" unticked (owner-approved prototype
 * `prototype/revit-rows/`). The built app, the demo building, the real Schedules window.
 *
 * The schedule arrives the way a schedule file does — the library's Import (the native Open
 * dialog stubbed in main, as `schedules.spec.ts` does) and Use — from the compatibility corpus's
 * `current/doors.schedule.json`, which is sorted by Level and itemised. The Rows chip then turns
 * itemise off and chooses "By sort value". Every door has its own Mark, so Mark reads <varies>.
 *
 * Run it only through `node scripts/safe-e2e.cjs` (`npm run test:e2e`).
 *
 *   SGVUE_SHOTS=<dir>   also writes `combine-table-<theme>.png` (the table) and
 *                       `combine-rows-<theme>.png` (the Rows popover open), both themes
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEMO, launch, openSchedulesWindow, ROOT } from './helpers'

const FIXTURE = join(ROOT, 'tests/fixtures/compat/current/doors.schedule.json')

let dir = ''

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-combine-'))
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const act = (win: Page, name: string, more = '') => win.locator(`[data-act="${name}"]${more}`)
const pop = (win: Page) => win.locator('#popover')
const library = (win: Page) => win.locator('.overlay-card[aria-label="Templates"]')
const rowsChip = (win: Page) => act(win, 'vb-open', '[data-v="rows"]')
const toggleTheme = (page: Page): Promise<void> => page.locator('button[data-tip="Light / dark"]').click()

/** The native Open dialog, answered in main with `path` (as `schedules.spec.ts`'s `stubDialogs`). */
async function answerOpen(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
  }, path)
}

/** Import a schedule file into Mine and Use it; asks to replace only when the one on screen was edited. */
async function importAndUse(app: ElectronApplication, sched: Page, path: string, name: string): Promise<void> {
  await answerOpen(app, path)
  await act(sched, 'open-library').first().click()
  await library(sched).locator('[data-act="import-schedule"]').click()
  await expect(sched.locator('.toast')).toHaveText(`Imported “${name}” into Mine.`)
  await library(sched).locator('[data-act="library-use"]').click()
  const replace = sched.locator('.dlg').getByRole('button', { name: 'Replace' })
  if (await replace.isVisible().catch(() => false)) await replace.click()
  await expect(library(sched)).toHaveCount(0)
  await expect(sched.locator('.schedule-title')).toHaveText(name)
}

test('itemise off, by sort value: one row per Level, <varies> where the doors differ, the chip says so', async () => {
  test.setTimeout(120_000)
  const written = JSON.parse(await readFile(FIXTURE, 'utf8')) as { name: string; sort: unknown[]; itemize: boolean }
  expect(written.itemize).toBe(true)
  expect(written.sort).toHaveLength(1)
  const shots = process.env.SGVUE_SHOTS ? resolve(ROOT, process.env.SGVUE_SHOTS) : ''
  if (shots) await mkdir(shots, { recursive: true })

  const { app, page } = await launch(dir)
  try {
    await page.getByRole('button', { name: DEMO }).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    const sched = await openSchedulesWindow(app, page)
    await sched.waitForLoadState('domcontentloaded')
    await sched.setViewportSize({ width: 1180, height: 760 })
    await expect(sched.locator('.rail-item[data-act="category"]').first()).toBeVisible()

    const file = join(dir, 'doors.schedule.json')
    await writeFile(file, JSON.stringify(written))
    await importAndUse(app, sched, file, written.name)
    await expect(sched.locator('tr.data').first()).toBeVisible()
    const itemised = await sched.locator('tr.data').count()
    await expect(rowsChip(sched)).toHaveAttribute('aria-label', 'Rows: every element')
    await expect(sched.locator('td.varies')).toHaveCount(0)

    // 1 — the Rows chip: itemise off shows the Combine control, "Identical rows" chosen.
    await rowsChip(sched).click()
    await expect(pop(sched).locator('[data-act="combine"]')).toHaveCount(0)
    await pop(sched).locator('label.switch-row', { has: sched.locator('[data-act="itemize"]') }).click()
    await expect(pop(sched).locator('[data-act="combine"][data-v="identical"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(rowsChip(sched)).toHaveAttribute('aria-label', 'Rows: identical rows merged')

    // 2 — By sort value: one row per Level, the chip and the hint say so.
    await pop(sched).locator('[data-act="combine"][data-v="sort"]').click()
    await expect(pop(sched).locator('[data-act="combine"][data-v="sort"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(rowsChip(sched)).toHaveAttribute('aria-label', 'Rows: one row per Level')
    await expect(pop(sched).locator('.hint').first()).toContainText('Off — one row per Level.')
    const combined = await sched.locator('tr.data').count()
    expect(combined).toBeGreaterThan(0)
    expect(combined).toBeLessThan(itemised)

    // 3 — a <varies> cell is there, drawn muted, with no colour rule's style.
    const varies = sched.locator('table.schedule td.varies')
    await expect(varies.first()).toHaveText('<varies>')
    const look = await varies.first().evaluate((td) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--muted)'
      document.body.append(probe)
      const muted = getComputedStyle(probe).color
      probe.remove()
      return { color: getComputedStyle(td).color, muted, style: td.getAttribute('style') }
    })
    expect(look).toEqual({ color: look.muted, muted: look.muted, style: null })

    // 4 — the status line names the sort field.
    await expect(sched.locator('body')).toContainText('by Level')

    // 5 — the screenshots, both themes: the table, then the Rows popover open.
    if (shots) {
      await sched.keyboard.press('Escape')
      for (const theme of ['light', 'dark']) {
        const current = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark')
        if (current !== theme) await toggleTheme(page)
        await expect.poll(() => sched.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
        await sched.mouse.move(5, 5)
        await sched.waitForTimeout(250)
        await writeFile(join(shots, `combine-table-${theme}.png`), await sched.locator('table.schedule').screenshot())
        await rowsChip(sched).click()
        await expect(pop(sched).locator('[data-act="combine"]').first()).toBeVisible()
        await sched.waitForTimeout(250)
        await writeFile(join(shots, `combine-rows-${theme}.png`), await sched.screenshot())
        await sched.keyboard.press('Escape')
      }
    }

    // 6 — undo takes the combine back to identical rows.
    await act(sched, 'undo').click()
    await expect(rowsChip(sched)).toHaveAttribute('aria-label', 'Rows: identical rows merged')
    await expect(sched.locator('td.varies')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
