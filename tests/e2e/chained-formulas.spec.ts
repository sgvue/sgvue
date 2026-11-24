/**
 * 2026-11-24 — a formula may use another calculated column by its name, and calculated names are
 * unique. The built app, the demo building, the real Schedules window: a chained column's cells,
 * a rename carried into the formula that uses it, a duplicate name refused in the editor and in
 * the column menu's heading box, a loop marked bad on both members, and undo. 2026-11-25: a
 * calculated column's heading box refusing another column's heading (F1), and a model heading
 * typed through another column's heading refused, then landing (F2).
 *
 * No live AI call: the schedule arrives the way a schedule file does — the library's Import (the
 * native Open dialog stubbed in main, as `vee-column-dot.spec.ts` does) and Use — built from the
 * compatibility corpus's `current/calculated.schedule.json`, its second calculated column
 * rewritten to name the first.
 *
 * Run it only through `node scripts/safe-e2e.cjs` (`npm run test:e2e`).
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEMO, launch, openSchedulesWindow, ROOT } from './helpers'

const FIXTURE = join(ROOT, 'tests/fixtures/compat/current/calculated.schedule.json')

let dir = ''

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-chain-'))
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const act = (win: Page, name: string, more = '') => win.locator(`[data-act="${name}"]${more}`)
const pop = (win: Page) => win.locator('#popover')
const library = (win: Page) => win.locator('.overlay-card[aria-label="Templates"]')
const heading = (win: Page, i: number) => win.locator(`table.schedule thead th[data-defcol="${i}"]`)

async function answerOpen(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
  }, path)
}

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

/** The first data rows' cells in columns `a` and `b`, as numbers (thousands separators dropped). */
const pairs = (win: Page, a: number, b: number) =>
  win.locator('table.schedule tbody tr.data').evaluateAll((rows, [i, j]) =>
    rows.slice(0, 8).map((r) => {
      const cells = r.querySelectorAll('td')
      const n = (k: number) => parseFloat((cells[k]?.textContent ?? '').replace(/,/g, ''))
      return [n(i), n(j)]
    }), [a, b])

test('a formula naming another calculated column: cells, rename, duplicate names, a loop, undo', async () => {
  test.setTimeout(120_000)
  const written = JSON.parse(await readFile(FIXTURE, 'utf8')) as {
    name: string
    calculated: { id: string; name: string; formula: string }[]
  }
  // Name, Level, Width, Double (calc1: Width * 2), then calc2 rewritten as "Plus" = Double * 1.1.
  const DOUBLE = 3
  const PLUS = 4
  const def = {
    ...written,
    calculated: written.calculated.map((c) => (c.id === 'calc2' ? { ...c, name: 'Plus', formula: 'Double * 1.1' } : c)),
  }

  const { app, page } = await launch(dir)
  try {
    await page.getByRole('button', { name: DEMO }).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    const sched = await openSchedulesWindow(app, page)
    await sched.waitForLoadState('domcontentloaded')
    await sched.setViewportSize({ width: 1180, height: 760 })
    await expect(sched.locator('.rail-item[data-act="category"]').first()).toBeVisible()

    const file = join(dir, 'chain.schedule.json')
    await writeFile(file, JSON.stringify(def))
    await importAndUse(app, sched, file, written.name)
    await expect(sched.locator('tr.data').first()).toBeVisible()

    // 1 — Plus is Double × 1.1 on every row that has a value, and its menu shows no problem.
    const rows = (await pairs(sched, DOUBLE, PLUS)).filter(([d]) => Number.isFinite(d))
    expect(rows.length).toBeGreaterThan(0)
    for (const [d, p] of rows) expect(Math.abs(p - d * 1.1)).toBeLessThan(0.01 * Math.max(1, d))
    await heading(sched, PLUS).click()
    await expect(pop(sched).locator('.pop-note')).toBeVisible()
    await expect(pop(sched).locator('.pop-note.bad')).toHaveCount(0)

    // 2 — the editor: a duplicate name is refused there with the reason; the heading keeps the old name.
    await pop(sched).locator('[data-act="open-calc"]').click()
    const nameBox = sched.locator('[data-act="calc-name"][data-id="calc1"]')
    await expect(nameBox).toBeVisible()
    await nameBox.fill('width')
    await expect(sched.locator('.subcard[data-id="calc1"] .tip-error'))
      .toHaveText('Another column is already called "width" — each calculated column needs a name of its own.')
    await expect(nameBox).toHaveValue('width')

    // 3 — a free name lands, and Plus's formula follows it.
    await nameBox.fill('Twice width')
    await expect(sched.locator('.subcard[data-id="calc1"] .tip-error')).toHaveCount(0)
    await expect(sched.locator('[data-act="calc-formula"][data-id="calc2"]')).toHaveValue('[Twice width] * 1.1')
    await sched.keyboard.press('Escape')
    await expect(heading(sched, DOUBLE)).toContainText('Twice width')
    const after = (await pairs(sched, DOUBLE, PLUS)).filter(([d]) => Number.isFinite(d))
    for (const [d, p] of after) expect(Math.abs(p - d * 1.1)).toBeLessThan(0.01 * Math.max(1, d))

    // 4 — undo puts back the old name and the old formula in one step.
    await act(sched, 'undo').click()
    await expect(heading(sched, DOUBLE)).toContainText('Double')

    // 5 — the column menu's heading box refuses a calculated name in its bad note.
    await heading(sched, 2).click()
    const headingBox = pop(sched).locator('[data-act="fmt-heading"]')
    await headingBox.fill('plus')
    await expect(pop(sched).locator('.pop-note.bad'))
      .toHaveText('A calculated column is already called "Plus" — give this column another heading.')
    await sched.keyboard.press('Escape')
    await expect(heading(sched, 2)).toContainText('Width')

    // 5b (2026-11-25, F1) — a calculated column's heading box refuses another column's heading.
    await heading(sched, DOUBLE).click()
    await pop(sched).locator('[data-act="fmt-heading"]').fill('width')
    await expect(pop(sched).locator('.pop-note.bad').first())
      .toHaveText('Another column is already called "Width" — give this column another heading.')
    await sched.keyboard.press('Escape')
    await expect(heading(sched, DOUBLE)).toContainText('Double')

    // 5c (F2) — typing Width's heading through "Level", which another column has, while a formula
    // uses Width: refused once that edit lands; " (net)" then lands from "Width", the formula follows.
    const widthDouble = await pairs(sched, 2, DOUBLE)
    await heading(sched, 2).click()
    const widthBox = pop(sched).locator('[data-act="fmt-heading"]')
    await widthBox.fill('Level')
    await expect(pop(sched).locator('.pop-note.bad'))
      .toHaveText('Another column is already called "Level", and a formula uses one of the two — give this column another heading.')
    await widthBox.press('End')
    await widthBox.pressSequentially(' (net)')
    await expect(pop(sched).locator('.pop-note.bad')).toHaveCount(0)
    await sched.keyboard.press('Escape')
    await expect(heading(sched, 2)).toContainText('Level (net)')
    expect(await pairs(sched, 2, DOUBLE)).toEqual(widthDouble)
    await heading(sched, DOUBLE).click()
    await pop(sched).locator('[data-act="open-calc"]').click()
    await expect(sched.locator('[data-act="calc-formula"][data-id="calc1"]')).toHaveValue('[Level (net)] * 2')
    await sched.keyboard.press('Escape')

    // 6 — a loop: both members marked bad, both columns blank.
    await heading(sched, DOUBLE).click()
    await pop(sched).locator('[data-act="open-calc"]').click()
    await sched.locator('[data-act="calc-formula"][data-id="calc1"]').fill('Plus + 1')
    await expect(sched.locator('.subcard.bad')).toHaveCount(2)
    await expect(sched.locator('.subcard[data-id="calc2"] .tip-error')).toContainText('"Double" and "Plus" use each other in a loop')
    await sched.keyboard.press('Escape')
    const blank = await sched.locator('table.schedule tbody tr.data').first().evaluate((r, [i, j]) => {
      const cells = r.querySelectorAll('td')
      return [cells[i]?.textContent?.trim(), cells[j]?.textContent?.trim()]
    }, [DOUBLE, PLUS])
    expect(blank).toEqual(['', ''])
    await act(sched, 'undo').click()
    await expect(sched.locator('table.schedule tbody tr.data').first().locator('td').nth(PLUS)).not.toHaveText('')
  } finally {
    await app.close()
  }
})
