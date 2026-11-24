/**
 * 2026-11-24 — a calculated column Vee made carries a dot after its heading, and its column menu
 * says "Calculated by Vee", Vee's note and the formula (owner-approved prototype
 * `prototype/vee-column-icon/`). The built app, the demo building, the real Schedules window.
 *
 * No live AI call: the Vee-made column arrives the way a schedule file does — the library's
 * Import (the native Open dialog stubbed in main, as `schedules.spec.ts` does) and Use — from the
 * compatibility corpus's `current/calculated.schedule.json`, which carries one `by: "vee"` entry
 * with a note and one user entry.
 *
 * Run it only through `node scripts/safe-e2e.cjs` (`npm run test:e2e`).
 *
 *   SGVUE_SHOTS=<dir>   also writes `vee-dot-head-<theme>.png` (the table head) and
 *                       `vee-dot-menu-<theme>.png` (the Vee column's menu open), both themes
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEMO, launch, openSchedulesWindow, ROOT } from './helpers'

const FIXTURE = join(ROOT, 'tests/fixtures/compat/current/calculated.schedule.json')

let dir = ''

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-veedot-'))
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const act = (win: Page, name: string, more = '') => win.locator(`[data-act="${name}"]${more}`)
const pop = (win: Page) => win.locator('#popover')
const library = (win: Page) => win.locator('.overlay-card[aria-label="Templates"]')
const heading = (win: Page, i: number) => win.locator(`table.schedule thead th[data-defcol="${i}"]`)
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

/** Where the dot sits against its heading's text (the text node just before it), in CSS px. */
const dotGeometry = (win: Page) =>
  win.locator('table.schedule thead .th-dot').evaluate((dot) => {
    const text = dot.previousSibling
    if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('the dot does not follow the heading text')
    const range = document.createRange()
    range.selectNodeContents(text)
    const t = range.getBoundingClientRect()
    const d = dot.getBoundingClientRect()
    const cs = getComputedStyle(dot)
    const probe = document.createElement('span')
    probe.style.background = 'var(--accent)'
    document.body.append(probe)
    const accent = getComputedStyle(probe).backgroundColor
    probe.remove()
    return {
      width: cs.width,
      height: cs.height,
      radius: cs.borderRadius,
      background: cs.backgroundColor,
      accent,
      // The gap along each axis; whichever way the text runs, one of the two is the gap.
      gapX: Math.max(d.left - t.right, t.left - d.right),
      gapY: Math.max(d.top - t.bottom, t.top - d.bottom),
    }
  })

/** The column menu's note: its text lines, and the formula line's own text. */
const menuNote = (win: Page) =>
  pop(win).locator('.pop-note').evaluate((n) => ({
    lines: ((n.querySelector('.grow-1') as HTMLElement).innerText).split('\n').map((l) => l.trim()).filter(Boolean),
    formula: n.querySelector('.f')?.textContent ?? null,
    bad: n.classList.contains('bad'),
  }))

test('a Vee-made calculated column: the dot, its title, its menu, print, vertical, edit and undo', async () => {
  test.setTimeout(120_000)
  const written = JSON.parse(await readFile(FIXTURE, 'utf8')) as {
    name: string
    calculated: { id: string; formula: string; note?: string; by?: string }[]
  }
  const veeCalc = written.calculated.find((c) => c.by === 'vee')!
  const userCalc = written.calculated.find((c) => c.by === undefined)!
  // Column order in the fixture: Name, Level, Width, Vee's (calc1), the user's (calc2).
  const VEE = 3
  const USER = 4
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

    const fileA = join(dir, 'a.schedule.json')
    await writeFile(fileA, JSON.stringify(written))
    await importAndUse(app, sched, fileA, written.name)
    await expect(sched.locator('tr.data').first()).toBeVisible()

    // 1 — exactly one dot in the head, on Vee's column; none on the user's or a model column.
    const dots = sched.locator('table.schedule thead .th-dot')
    await expect(dots).toHaveCount(1)
    await expect(heading(sched, VEE).locator('.th-dot')).toHaveCount(1)
    for (const i of [0, 1, 2, USER]) await expect(heading(sched, i).locator('.th-dot')).toHaveCount(0)

    // 2 — 6 × 6 px, round, the page's accent, 6 px after the heading text.
    const g = await dotGeometry(sched)
    expect([g.width, g.height]).toEqual(['6px', '6px'])
    expect(g.radius).toBe('50%')
    expect(g.background).toBe(g.accent)
    expect(Math.abs(g.gapX - 6)).toBeLessThan(0.5)

    // 3 — its title is three lines; its accessible name says who made it.
    await expect(dots).toHaveAttribute('title', `Calculated by Vee\n${veeCalc.note}\n${veeCalc.formula}`)
    await expect(dots).toHaveAccessibleName('Calculated by Vee')

    // 4 — the menus: Vee's says so, with the note and the formula; the user's says "Calculated column".
    await heading(sched, VEE).click()
    await expect(pop(sched).locator('.pop-note')).toBeVisible()
    expect(await menuNote(sched)).toEqual({ lines: ['Calculated by Vee', veeCalc.note, veeCalc.formula], formula: veeCalc.formula, bad: false })
    await sched.keyboard.press('Escape')
    await heading(sched, USER).click()
    await expect(pop(sched).locator('.pop-note')).toBeVisible()
    expect(await menuNote(sched)).toEqual({ lines: ['Calculated column', userCalc.formula], formula: userCalc.formula, bad: false })
    await sched.keyboard.press('Escape')

    // 5 — print hides the dot.
    await sched.emulateMedia({ media: 'print' })
    expect(await dots.evaluate((d) => getComputedStyle(d).display)).toBe('none')
    await sched.emulateMedia({ media: 'screen' })

    // 6 — the screenshots, both themes.
    if (shots) {
      for (const theme of ['light', 'dark']) {
        const current = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark')
        if (current !== theme) await toggleTheme(page)
        await expect.poll(() => sched.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
        await sched.mouse.move(5, 5)
        await sched.waitForTimeout(250)
        await writeFile(join(shots, `vee-dot-head-${theme}.png`), await sched.locator('table.schedule thead').screenshot())
        await heading(sched, VEE).click()
        await expect(pop(sched).locator('.pop-note')).toBeVisible()
        await sched.waitForTimeout(250)
        await writeFile(join(shots, `vee-dot-menu-${theme}.png`), await sched.screenshot())
        await sched.keyboard.press('Escape')
      }
    }

    // 7 — a 600-character unbroken formula and a 160-character note stay inside the menu.
    const long = `${'Width*1+'.repeat(74)}Width*10`
    expect(long).toHaveLength(600)
    const sentence = 'Twice the door width, read from the model and worked out by Vee for each door in this schedule. '
    let note = (sentence + sentence).slice(0, 159).trimEnd()
    note += '.'.repeat(160 - note.length)
    expect(note).toHaveLength(160)
    const nameB = `${written.name} long`
    const fileB = join(dir, 'b.schedule.json')
    await writeFile(fileB, JSON.stringify({
      ...written,
      name: nameB,
      calculated: written.calculated.map((c) => (c.by === 'vee' ? { ...c, formula: long, note } : c)),
    }))
    await importAndUse(app, sched, fileB, nameB)
    await heading(sched, VEE).click()
    await expect(pop(sched).locator('.pop-note')).toBeVisible()
    expect(await menuNote(sched)).toMatchObject({ lines: ['Calculated by Vee', note, long], bad: false })
    const fits = await pop(sched).evaluate((p) => {
      const n = p.querySelector('.pop-note') as HTMLElement
      const [pr, nr] = [p.getBoundingClientRect(), n.getBoundingClientRect()]
      return { note: n.scrollWidth <= n.clientWidth, pop: p.scrollWidth <= p.clientWidth, inside: nr.right <= pr.right + 0.5 }
    })
    expect(fits).toEqual({ note: true, pop: true, inside: true })

    // 8 — a vertical heading (the menu's own Heading control): the dot is clear of the text
    // along the direction the text runs.
    await pop(sched).locator('[data-act="cm-orient"][data-v="vertical"]').click()
    await expect(heading(sched, VEE)).toHaveClass(/\bvertical\b/)
    await sched.keyboard.press('Escape')
    const v = await dotGeometry(sched)
    expect(v.gapY).toBeGreaterThanOrEqual(4)

    // 9 — the user editing the formula takes the dot away; undo brings it back.
    await heading(sched, VEE).click()
    await pop(sched).locator('[data-act="open-calc"]').click()
    const box = sched.locator(`[data-act="calc-formula"][data-id="${veeCalc.id}"]`)
    await expect(box).toBeVisible()
    await box.fill('Width * 4')
    await expect(dots).toHaveCount(0)
    await sched.keyboard.press('Escape')
    await expect(sched.locator('[data-act="calc-formula"]')).toHaveCount(0)
    await act(sched, 'undo').click()
    await expect(dots).toHaveCount(1)
    await expect(heading(sched, VEE).locator('.th-dot')).toHaveCount(1)
  } finally {
    await app.close()
  }
})
