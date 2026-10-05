/**
 * The Schedules window (2026-09-25, phases 1, 2 and 3) — the built app, the real main process
 * and the real port between the two windows.
 *
 * Run it only through `node scripts/safe-e2e.cjs` (`npm run test:e2e`). Nothing here reads
 * `window.__sgvueDev`: selection is read back from what a person sees — the designed
 * property card naming the element.
 *
 *   SGVUE_SHOTS=<dir>   also writes the Schedules window beside the main window, and every
 *                       phase-2 surface (tabs, overlays, dialog, print media), both themes, and
 *                       phase 3's (the row menu, the heading menu, colour-by beside the legend,
 *                       two-way selection) under <dir>/p3
 *   SGVUE_IFC=<model>   also opens a real model and prints the snapshot's cost, the largest
 *                       category's render time, 3D selection → row mark and a colour-by
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  DROP_COPY,
  emit,
  handClick,
  holdTurns,
  launch,
  openSchedulesWindow,
  ROOT,
  TINY,
  tool as liveTool,
  toolResults
} from './helpers'

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self' sgvue-file: blob:; object-src 'none'; base-uri 'none'"

let dir = ''
/**
 * Why each Schedules menu closed, as the page logs it under a guard (`schedule-ui/menu.ts`,
 * `#guarded`). Printed when a test fails, so a menu that vanished names its trigger.
 */
let menuLog: string[] = []

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-sched-'))
  menuLog = []
})

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus && menuLog.length) {
    console.log(`\n[schedules] menu closes, last first:\n  ${menuLog.slice(-20).reverse().join('\n  ')}`)
  }
  await rm(dir, { recursive: true, force: true })
})

/**
 * The toolbar's Schedules button: last in the toolbar since 2026-10-01, under the view cube's
 * canvas at the default window, so it is clicked the way a hand does (`helpers.ts`).
 */
const SCHEDULES = 'button[data-tip="schedules"]'

/** Click the toolbar's Schedules button and return the window it opened. */
async function openSchedules(app: ElectronApplication, page: Page): Promise<Page> {
  const win = await openSchedulesWindow(app, page)
  win.on('console', (m) => {
    if (m.text().startsWith('[menu] ')) menuLog.push(`${new Date().toISOString().slice(11, 23)} ${m.text()}`)
  })
  await win.waitForLoadState('domcontentloaded')
  return win
}

const railItems = (win: Page) => win.locator('.rail-item')

/**
 * The main window's theme toggle. Since 2026-10-01 it sits in the toolbar's third group, clear
 * of the view cube's canvas, so it is an ordinary click again.
 */
const toggleTheme = (page: Page): Promise<void> =>
  page.locator('button[data-tip="Light / dark"]').click()

test('the toolbar opens Schedules; a row click selects in 3D; closing main closes it', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  let quit = false
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })

    // 1 — Window › Schedules exists, with its accelerator.
    const item = await app.evaluate(({ Menu }) => {
      for (const top of Menu.getApplicationMenu()?.items ?? []) {
        for (const sub of top.submenu?.items ?? []) {
          if (sub.label === 'Schedules') return { under: top.label, accelerator: sub.accelerator }
        }
      }
      return null
    })
    expect(item).toEqual({ under: 'Window', accelerator: 'CmdOrCtrl+Shift+T' })

    // 2 — the toolbar button opens it: the production CSP, and a preload that exposes nothing.
    const sched = await openSchedules(app, page)
    expect(await sched.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content')).toBe(CSP)
    expect(await sched.evaluate(() => 'sgvue' in window)).toBe(false)

    // 3 — the rail lists the categories with their counts; the opening schedule shows.
    await expect(railItems(sched)).toHaveCount(2)
    await expect(railItems(sched).nth(0)).toContainText('IfcWall')
    await expect(railItems(sched).nth(0)).toContainText('4')
    await expect(railItems(sched).nth(1)).toContainText('IfcSlab')
    await expect(railItems(sched).nth(1)).toContainText('2')
    await expect(sched.locator('.schedule-title')).toHaveText('Wall Schedule')
    await expect(sched.locator('tr.data')).toHaveCount(4)

    // 4 — a row click selects that element in the main window, through the tree's own path:
    // the designed property card opens on it.
    await sched.locator('tr.data', { hasText: 'Level 2' }).first().click()
    const card = page.locator('[data-role="propcard"]')
    await expect(card).toBeVisible()
    await expect(card).toContainText(/Wall L2-[12]/)
    await expect(sched.locator('tr.data.on')).toHaveCount(1)

    await sched.locator('tr.data', { hasText: 'Level 1' }).first().click()
    await expect(card).toContainText(/Wall L1-[12]/)

    // 5 — another category, then its row.
    await railItems(sched).nth(1).click()
    await expect(sched.locator('.schedule-title')).toHaveText('Slab Schedule')
    await sched.locator('tr.data', { hasText: 'Level 2' }).first().click()
    await expect(card).toContainText('Slab L2')

    // 6 — the theme follows the main window.
    const themeOf = (p: Page) => p.evaluate(() => document.documentElement.dataset.theme ?? 'dark')
    const before = await themeOf(page)
    expect(await themeOf(sched)).toBe(before)
    await toggleTheme(page)
    const after = before === 'dark' ? 'light' : 'dark'
    await expect.poll(() => themeOf(sched)).toBe(after)

    // 7 — at most one: the button again brings the same window forward.
    await handClick(page, SCHEDULES)
    await page.waitForTimeout(500)
    expect(app.windows()).toHaveLength(2)

    // 8 — closing Schedules leaves the main window; opening it again gets a working port.
    const gone = sched.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('schedule.html'))!
        .close()
    })
    await gone
    expect(app.windows()).toHaveLength(1)
    await expect(page.locator('[data-role="viewport"]')).toBeVisible()
    const again = await openSchedules(app, page)
    await expect(railItems(again)).toHaveCount(2)
    await again.locator('tr.data', { hasText: 'Level 1' }).first().click()
    await expect(card).toContainText(/Wall L1-[12]/)

    // 9 — closing the main window closes Schedules with it.
    const closed = again.waitForEvent('close')
    const exited = new Promise<void>((r) => app.process().once('exit', () => r()))
    quit = true
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('index.html'))!
        .close()
    })
    await closed
    await exited
  } finally {
    if (!quit) await app.close()
  }
})

test('the demo building: many categories, and both themes side by side', async () => {
  const { app, page } = await launch(dir)
  try {
    await page.getByRole('button', { name: 'try the demo building →' }).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    const sched = await openSchedules(app, page)
    await expect.poll(() => railItems(sched).count()).toBeGreaterThan(3)
    await expect(sched.locator('tr.data').first()).toBeVisible()

    const shots = process.env.SGVUE_SHOTS ? resolve(ROOT, process.env.SGVUE_SHOTS) : ''
    if (!shots) return
    await mkdir(shots, { recursive: true })
    await sched.locator('tr.data').nth(2).click()
    await expect(page.locator('[data-role="propcard"]')).toBeVisible()
    for (const theme of ['dark', 'light']) {
      const current = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark')
      if (current !== theme) await toggleTheme(page)
      await expect.poll(() => sched.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
      await page.mouse.move(5, 5)
      await sched.mouse.move(5, 5)
      await page.waitForTimeout(1500)
      await writeFile(join(shots, `schedules-beside-main-${theme}.png`), await beside(page, sched))
    }
  } finally {
    await app.close()
  }
})

/** Both windows side by side in one PNG — composed by the main page itself, no image library. */
async function beside(page: Page, sched: Page): Promise<Buffer> {
  const [a, b] = [await page.screenshot(), await sched.screenshot()]
  const png = await page.evaluate(
    async ([x, y]) => {
      const decode = (b64: string) =>
        createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }))
      const [p, q] = await Promise.all([decode(x), decode(y)])
      const c = new OffscreenCanvas(p.width + q.width + 16, Math.max(p.height, q.height))
      const g = c.getContext('2d')!
      g.fillStyle = '#808080'
      g.fillRect(0, 0, c.width, c.height)
      g.drawImage(p, 0, 0)
      g.drawImage(q, p.width + 16, 0)
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
      let s = ''
      for (const v of bytes) s += String.fromCharCode(v)
      return btoa(s)
    },
    [a.toString('base64'), b.toString('base64')] as const
  )
  return Buffer.from(png, 'base64')
}

/** A control in the Schedules window by its `data-act` (and, optionally, more attributes). */
const act = (win: Page, name: string, more = '') => win.locator(`[data-act="${name}"]${more}`)

/** The inspector tab by id. */
const tab = (win: Page, id: string) => act(win, 'section', `[data-section="${id}"]`).first()

test('phase 2: template → filter → group (itemise off) → a grouped row selects its elements; undo; saved round trip', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    const sched = await openSchedules(app, page)
    await expect(sched.locator('tr.data')).toHaveCount(4)

    // 1 — the header's template gallery; the Wall Schedule card applies its columns.
    await act(sched, 'open-templates').click()
    const gallery = sched.locator('.overlay-card[aria-label="Start from a template"]')
    await expect(gallery).toBeVisible()
    // Focus went into the card (its search box), as it does in the Preferences dialog.
    await expect(gallery.locator('[data-act="template-search"]')).toBeFocused()
    await gallery.locator('[data-act="apply-template"][data-id="wall-schedule"]').click()
    await expect(gallery).toHaveCount(0)
    await expect(sched.locator('.schedule-title')).toHaveText('Wall Schedule')
    await expect(sched.locator('.tpl-chip')).toContainText('Wall Schedule')
    await expect(sched.locator('table.schedule thead th', { hasText: 'IsExternal' })).toHaveCount(1)

    // 2 — a filter rule on Level: it says what it does before anything else.
    await tab(sched, 'filter').click()
    await act(sched, 'filter-add').click()
    await act(sched, 'filter-field', '[data-i="0"]').selectOption('core|storey')
    await expect(sched.locator('.rule-effect .keeps')).toHaveText('Keeps 4')
    await expect(sched.locator('.tab[data-section="filter"] .tab-badge')).toHaveText('1')

    // 3 — group by Level with a header row, and switch itemise off: identical rows collapse.
    await tab(sched, 'sort').click()
    await act(sched, 'sort-add').click()
    await act(sched, 'sort-field', '[data-i="0"]').selectOption('core|storey')
    await act(sched, 'sort-header', '[data-i="0"]').check()
    await expect(sched.locator('tr.group')).toHaveCount(2)
    await act(sched, 'itemize').uncheck()
    await expect(sched.locator('table.schedule thead th', { hasText: 'Count' })).toHaveCount(1)
    await expect(sched.locator('tr.data')).toHaveCount(2)
    // Header rows select nothing: they carry no data-row.
    await expect(sched.locator('tr.group[data-row]')).toHaveCount(0)

    // 4 — a collapsed row stands for two walls; clicking it selects both in the main window.
    const level2 = sched.locator('tr.data', { hasText: 'Level 2' })
    await expect(level2.locator('td').last()).toHaveText('2')
    await level2.click()
    await expect(level2).toHaveClass(/\bon\b/)
    await expect(page.locator('[data-role="propcard"]')).toContainText('2 selected')

    // 5 — undo in this window: itemise comes back on; redo puts it off again.
    await sched.keyboard.press('Control+Z')
    await expect(sched.locator('tr.data')).toHaveCount(4)
    await expect(sched.locator('table.schedule thead th', { hasText: 'Count' })).toHaveCount(0)
    await act(sched, 'redo').click()
    await expect(sched.locator('tr.data')).toHaveCount(2)
    // The marked element follows its row through the re-render.
    await expect(sched.locator('tr.data.on')).toHaveText(/Level 2/)

    // 6 — save; the rail lists it as the setup in use.
    await act(sched, 'save-schedule').first().click()
    await expect(sched.locator('.toast')).toHaveText('Saved “Wall Schedule”.')
    await expect(sched.locator('.rail-saved.on')).toContainText('Wall Schedule')

    // 7 — edit, then switch category: the window's own dialog asks first.
    await tab(sched, 'appearance').click()
    await act(sched, 'app-zebra').uncheck()
    await sched.locator('.rail-item', { hasText: 'IfcSlab' }).click()
    const dialog = sched.locator('.dlg[role="dialog"]')
    await expect(dialog).toContainText('Replace the current schedule setup?')
    await dialog.getByRole('button', { name: 'Replace' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(sched.locator('.schedule-title')).toHaveText('Slab Schedule')

    // 8 — the saved setup survives the window: close Schedules, open it again, load it from
    // My templates, and the whole setup comes back — filter, grouping, itemise off.
    const gone = sched.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('schedule.html'))!.close()
    })
    await gone
    const again = await openSchedules(app, page)
    await expect(again.locator('.rail-saved')).toHaveCount(1)
    await act(again, 'open-saved').click()
    const mine = again.locator('.overlay-card[aria-label="My templates"]')
    await expect(mine.locator('.saved-row')).toHaveCount(1)
    // Rename through the window's own prompt.
    await mine.locator('[data-act="rename-saved"]').click()
    const prompt = again.locator('.dlg[role="dialog"]')
    await expect(prompt.locator('.dlg-field')).toBeFocused()
    await prompt.locator('.dlg-field').fill('Walls by level')
    await prompt.locator('.dlg-field').press('Enter')
    await expect(mine.locator('.saved-row')).toContainText('Walls by level')
    await mine.locator('[data-act="load-saved"]').click()
    await expect(mine).toHaveCount(0)
    await expect(again.locator('.schedule-title')).toHaveText('Walls by level')
    await expect(again.locator('tr.group')).toHaveCount(2)
    await expect(again.locator('tr.data')).toHaveCount(2)
    await expect(again.locator('.tab[data-section="filter"] .tab-badge')).toHaveText('1')
    // And the loaded setup still drives the 3D selection.
    await again.locator('tr.data', { hasText: 'Level 1' }).click()
    await expect(page.locator('[data-role="propcard"]')).toContainText('2 selected')
    // Escape closes an overlay, and focus goes back to the button that opened it.
    await act(again, 'open-templates').click()
    await again.keyboard.press('Escape')
    await expect(again.locator('.overlay')).toHaveCount(0)
    await expect(act(again, 'open-templates')).toBeFocused()
  } finally {
    await app.close()
  }
})

test('phase 2: column selection, auto-fit, equal width, a resize drag, keyboard reorder, coverage, the inspector', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    const sched = await openSchedules(app, page)
    await act(sched, 'open-templates').click()
    await sched.locator('[data-act="apply-template"][data-id="wall-schedule"]').click()
    const heads = sched.locator('table.schedule thead th[data-defcol]')
    const widthVar = (i: number) =>
      sched.locator('table.schedule').evaluate((t, n) => (t as HTMLElement).style.getPropertyValue(`--colw-${n}`), i)

    // Coverage: the tiny model carries no wall quantities, so those columns say so on the
    // heading, and the Fields tab offers a remap under them.
    await expect(sched.locator('table.schedule thead th .badge', { hasText: '0 values' }).first()).toBeVisible()
    await expect(sched.locator('.drag-row.empty').first()).toBeVisible()
    await expect(sched.locator('.tab[data-section="fields"] .tab-alert')).toHaveCount(1)

    // Shift-click marks a run of headings; Equal width wakes up; Escape clears the marks.
    await heads.nth(0).click()
    await heads.nth(2).click({ modifiers: ['Shift'] })
    await expect(sched.locator('table.schedule thead th.sel')).toHaveCount(3)
    await expect(act(sched, 'fit-equal')).toBeEnabled()
    await sched.keyboard.press('Escape')
    await expect(sched.locator('table.schedule thead th.sel')).toHaveCount(0)
    await expect(act(sched, 'fit-equal')).toBeDisabled()

    // Auto-fit writes a width for every column.
    await act(sched, 'fit-all').click()
    await expect.poll(() => widthVar(0)).toMatch(/^\d+px$/)

    // Ctrl-click two, Equal width: both take the width of the column Format is editing.
    await heads.nth(1).click()
    await heads.nth(0).click({ modifiers: ['Control'] })
    await heads.nth(3).click({ modifiers: ['Control'] })
    await act(sched, 'fit-equal').click()
    await expect.poll(async () => [await widthVar(0), await widthVar(3)]).toEqual([await widthVar(1), await widthVar(1)])

    // A drag on a heading's right edge widens that column by what the pointer moved. (Paused
    // first: history merges edits of the same shape made within 700 ms into one undo step.)
    await sched.keyboard.press('Escape')
    await sched.waitForTimeout(800)
    const before = parseInt(await widthVar(2), 10)
    const box = (await heads.nth(2).boundingBox())!
    await sched.mouse.move(box.x + box.width - 2, box.y + box.height / 2)
    await sched.mouse.down()
    await sched.mouse.move(box.x + box.width + 38, box.y + box.height / 2, { steps: 4 })
    await sched.mouse.up()
    await expect.poll(async () => parseInt(await widthVar(2), 10)).toBe(before + 40)
    // …and one undo puts it back.
    await sched.keyboard.press('Control+Z')
    await expect.poll(async () => parseInt(await widthVar(2), 10)).toBe(before)

    // Keyboard reorder: focus a column's grip, arrow down; the column moves and focus follows.
    await tab(sched, 'fields').click()
    const firstHeading = (await heads.nth(0).textContent())?.trim()
    await sched.locator('.drag-row[data-i="0"] .handle').focus()
    await sched.keyboard.press('ArrowDown')
    await expect(heads.nth(1)).toHaveText(firstHeading!)
    await expect(sched.locator('.drag-row[data-i="1"] .handle')).toBeFocused()

    // The inspector: resizable by its edge (kept in this window's own storage), collapsible
    // to its icon strip, and each icon both reopens it and picks its tab.
    const pane = sched.locator('#inspector-pane')
    const w0 = (await pane.boundingBox())!.width
    const edge = (await sched.locator('.panel-resize').boundingBox())!
    await sched.mouse.move(edge.x + edge.width / 2, edge.y + 200)
    await sched.mouse.down()
    await sched.mouse.move(edge.x + edge.width / 2 - 100, edge.y + 200, { steps: 4 })
    await sched.mouse.up()
    await expect.poll(async () => Math.round((await pane.boundingBox())!.width)).toBe(Math.round(w0 + 100))
    expect(await sched.evaluate(() => localStorage.getItem('sgvue.schedules.inspectorW'))).toBe(String(Math.round(w0 + 100)))
    await sched.locator('.inspector-head [data-act="panel-toggle"]').click()
    await expect(pane).toHaveClass(/closed/)
    await sched.locator('.strip-tab[data-section="sort"]').click()
    await expect(pane).not.toHaveClass(/closed/)
    await expect(sched.locator('.tab.on')).toHaveAttribute('data-section', 'sort')
  } finally {
    await app.close()
  }
})

/**
 * Every surface of the window, both themes — for the Build Report and the reviewer. Writes
 * `sched-<state>-<theme>.png` into SGVUE_SHOTS; skipped without it.
 */
test('phase 2 screenshots (SGVUE_SHOTS)', async () => {
  const shots = process.env.SGVUE_SHOTS ? resolve(ROOT, process.env.SGVUE_SHOTS) : ''
  test.skip(!shots, 'set SGVUE_SHOTS to a folder')
  test.setTimeout(240_000)
  await mkdir(shots, { recursive: true })
  const { app, page } = await launch(dir)
  try {
    await page.getByRole('button', { name: 'try the demo building →' }).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    const sched = await openSchedules(app, page)
    await sched.setViewportSize({ width: 1440, height: 860 })
    await expect.poll(() => railItems(sched).count()).toBeGreaterThan(3)

    // A grouped door schedule with a filter, footers, a grand total and conditional colours.
    await act(sched, 'open-templates').click()
    await sched.locator('[data-act="apply-template"][data-id="door-schedule"]').click()
    await tab(sched, 'filter').click()
    await act(sched, 'filter-add').click()
    await act(sched, 'filter-field', '[data-i="0"]').selectOption('core|storey')
    await tab(sched, 'sort').click()
    await act(sched, 'sort-add').click()
    await act(sched, 'sort-field', '[data-i="0"]').selectOption('core|storey')
    await act(sched, 'sort-header', '[data-i="0"]').check()
    await act(sched, 'sort-footer', '[data-i="0"]').check()
    await act(sched, 'itemize').uncheck()
    await act(sched, 'grand-total').check()
    await sched.locator('table.schedule thead th[data-defcol="0"]').click()
    await act(sched, 'cond-add').click()
    const first = ((await sched.locator('tr.data td').first().textContent()) ?? '').trim()
    await act(sched, 'cond-value', '[data-i="0"]').fill(first)
    await act(sched, 'cond-add').click()
    await act(sched, 'cond-preset', '[data-i="1"]').nth(2).click()
    await act(sched, 'cond-op', '[data-i="1"]').selectOption('!=')
    await act(sched, 'cond-value', '[data-i="1"]').fill(first)
    await sched.locator('tr.data').first().click()

    const snap = async (name: string, theme: string): Promise<void> => {
      await sched.mouse.move(700, 5)
      await sched.waitForTimeout(250)
      await writeFile(join(shots, `sched-${name}-${theme}.png`), await sched.screenshot())
    }
    for (const theme of ['dark', 'light']) {
      const current = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark')
      if (current !== theme) await toggleTheme(page)
      await expect.poll(() => sched.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)

      await snap('grouped-conditional', theme)
      for (const id of ['fields', 'filter', 'sort', 'appearance']) {
        await tab(sched, id).click()
        await snap(`tab-${id}`, theme)
      }
      await tab(sched, 'fields').click()
      await act(sched, 'open-fields').first().click()
      await act(sched, 'field-search').fill('fire')
      await sched.waitForTimeout(300)
      await snap('field-browser', theme)
      await act(sched, 'field-search').fill('')
      if (!(await sched.locator('[data-act="calc-formula"]').count())) {
        await act(sched, 'calc-add-formula').click()
        await act(sched, 'calc-formula').fill('Width * Height')
        await act(sched, 'calc-add-percent').click()
      }
      await sched.waitForTimeout(300)
      await sched.locator('.browse-chosen').evaluate((e) => e.scrollTo(0, e.scrollHeight))
      await snap('calc-editor', theme)
      await act(sched, 'open-formula').click()
      await snap('formula-help', theme)
      await sched.keyboard.press('Escape')
      await sched.keyboard.press('Escape')
      await act(sched, 'open-templates').click()
      await snap('template-gallery', theme)
      await sched.keyboard.press('Escape')
      await act(sched, 'save-schedule').first().click()
      await act(sched, 'open-saved').click()
      await snap('my-templates', theme)
      await sched.keyboard.press('Escape')
      await sched.locator('table.schedule thead th[data-defcol="0"]').click()
      await snap('tab-format', theme)
      // An edit that changes nothing on screen, so a category click has something to ask about.
      await tab(sched, 'appearance').click()
      await act(sched, 'app-zebra').uncheck()
      await act(sched, 'app-zebra').check()
      await sched.locator('.rail-item', { hasText: 'IfcWall' }).first().click()
      await snap('dialog', theme)
      await sched.keyboard.press('Escape')
    }
    // The printout is neutral whatever the theme: dark here, white paper there.
    await toggleTheme(page)
    await expect.poll(() => sched.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    await sched.emulateMedia({ media: 'print' })
    await writeFile(join(shots, 'sched-print-media-dark.png'), await sched.screenshot())
    await sched.emulateMedia({ media: 'screen' })
  } finally {
    await app.close()
  }
})

/** The menu open in the Schedules window, and one of its items by its exact label. */
const menu = (win: Page) => win.locator('.ctx-menu[role="menu"]')
const menuItem = (win: Page, name: string) => menu(win).getByRole('menuitem', { name, exact: true })

/** The main window's status bar `visible / total`. */
async function counts(page: Page): Promise<number[]> {
  const text = (await page.locator('span[title="visible / total elements"]').textContent()) ?? ''
  return text.split('/').map((n) => Number(n.replace(/\D/g, '')))
}

/** Open the row menu on `row`, read one item's disabled state, and close the menu again. */
async function itemOff(win: Page, row: ReturnType<Page['locator']>, name: string): Promise<boolean> {
  await row.click({ button: 'right' })
  const off = await menuItem(win, name).isDisabled()
  await win.keyboard.press('Escape')
  await expect(menu(win)).toHaveCount(0)
  return off
}

test('phase 3: two-way selection, multi-row, the row menu, the Model column, colour 3D by a column', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launch(dir)
  try {
    await page.getByRole('button', { name: 'try the demo building →' }).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    const sched = await openSchedules(app, page)
    await sched.setViewportSize({ width: 1100, height: 560 })
    await expect.poll(() => railItems(sched).count()).toBeGreaterThan(3)
    const heads = sched.locator('table.schedule thead th[data-defcol]')
    const rows = sched.locator('tr.data')
    const marked = sched.locator('tr.data.on')
    const wrap = sched.locator('.table-wrap')
    const note = sched.locator('.status .sel-note')
    const card = page.locator('[data-role="propcard"]')
    const cardName = card.locator('> div').first().locator('span').nth(1)
    const side = page.locator('aside')

    // 1 — four models are loaded, so the opening schedule starts with a Model column.
    await expect(heads.first()).toHaveText('Model')

    // 2 — select in 3D: the row is marked and scrolled into view. The beam is found by
    // clicking the table's last row once (the property card names it), then deselected in 3D,
    // which clears the mark, and picked again from the main window's element tree.
    await railItems(sched).filter({ hasText: 'IfcBeam' }).click()
    await expect(rows).toHaveCount(124)
    const last = rows.last()
    const lastRow = (await last.getAttribute('data-row'))!
    await last.click()
    await expect(card).toBeVisible()
    const beam = ((await cardName.textContent()) ?? '').trim()
    expect(beam).toMatch(/^Beam /)
    await card.locator('button[title="Close (Esc)"]').click()
    await expect(marked).toHaveCount(0)
    await wrap.evaluate((w) => { w.scrollTop = 0 })
    await side.getByText('IfcBeam', { exact: true }).click()
    await side.getByText(beam, { exact: true }).click()
    await expect(marked).toHaveCount(1)
    await expect(marked).toHaveAttribute('data-row', lastRow)
    await expect.poll(() => wrap.evaluate((w) => w.scrollTop)).toBeGreaterThan(0)
    const inView = async (): Promise<boolean> => {
      const [w, r] = [(await wrap.boundingBox())!, (await marked.boundingBox())!]
      return r.y >= w.y && r.y + r.height <= w.y + w.height
    }
    await expect.poll(inView).toBe(true)
    await expect(note).toHaveText('')

    // 3 — a 3D selection this table does not show: the status line says so, and the rail
    // marks the category that holds it.
    await side.getByText('IfcBeam', { exact: true }).click()
    await side.getByText('IfcDoor', { exact: true }).click()
    await side.locator('[role="treeitem"][aria-level="2"]').first().click()
    await expect(note).toHaveText(/^1 selected in 3D · not in this schedule\s*·$/)
    await expect(railItems(sched).filter({ hasText: 'IfcDoor' })).toHaveClass(/sel-here/)
    await expect(marked).toHaveCount(0)
    await side.getByText('IfcDoor', { exact: true }).click()

    // 4 — Ctrl-click adds a row, Shift-click takes the range from the anchor, the arrow keys
    // move the selection, and each time the main window selects the union.
    await wrap.evaluate((w) => { w.scrollTop = 0 })
    await rows.nth(0).click()
    await expect(note).toHaveText('')
    await expect(railItems(sched).filter({ hasText: 'IfcDoor' })).not.toHaveClass(/sel-here/)
    await rows.nth(2).click({ modifiers: ['Control'] })
    await expect(marked).toHaveCount(2)
    await expect(card).toContainText('2 selected')
    await rows.nth(4).click({ modifiers: ['Shift'] })
    await expect(marked).toHaveCount(3)
    await expect(card).toContainText('3 selected')
    await rows.nth(2).click({ modifiers: ['Control'] })
    await expect(marked).toHaveCount(2)
    await expect(card).toContainText('2 selected')
    await sched.keyboard.press('ArrowDown')
    await expect(marked).toHaveCount(1)
    await expect(marked).toHaveAttribute('data-row', (await rows.nth(3).getAttribute('data-row'))!)
    await expect(card).toContainText('Properties')
    const third = ((await cardName.textContent()) ?? '').trim()
    await sched.keyboard.press('ArrowUp')
    await expect(marked).toHaveAttribute('data-row', (await rows.nth(2).getAttribute('data-row'))!)
    await expect(cardName).not.toHaveText(third)
    // Enter frames the selection in 3D: the same one stays selected.
    await sched.keyboard.press('Enter')
    await expect(marked).toHaveCount(1)
    // …and Shift+F10 (the ContextMenu key's twin) opens the row menu on it.
    await sched.keyboard.press('Shift+F10')
    await expect(menu(sched)).toBeVisible()
    await expect(menuItem(sched, 'Select in 3D')).toBeDisabled()
    await sched.keyboard.press('Escape')
    await expect(menu(sched)).toHaveCount(0)

    // 5 — the row menu on a Ctrl-selected pair: Isolate leaves only those two in the main
    // window, and Ctrl+Z there brings everything back.
    await rows.nth(0).click()
    await rows.nth(1).click({ modifiers: ['Control'] })
    await expect(card).toContainText('2 selected')
    const [, total] = await counts(page)
    await expect.poll(() => counts(page)).toEqual([total, total])
    await rows.nth(1).click({ button: 'right' })
    await expect(menu(sched)).toBeVisible()
    await expect(menuItem(sched, 'Select in 3D (2)')).toBeDisabled()
    await expect(menuItem(sched, 'Show')).toBeDisabled()
    await expect(menuItem(sched, 'Show all')).toBeDisabled()
    await menuItem(sched, 'Isolate (2)').click()
    await expect(menu(sched)).toHaveCount(0)
    await expect.poll(() => counts(page)).toEqual([2, total])
    await expect.poll(() => itemOff(sched, rows.nth(1), 'Isolate (2)')).toBe(true)
    await page.keyboard.press('Control+Z')
    await expect.poll(() => counts(page)).toEqual([total, total])

    // 6 — Hide one row (not in the selection, so the menu acts on it alone), Show it, Hide it
    // again and Show all. Each item is live only when it would do something.
    await rows.nth(3).click({ button: 'right' })
    await menuItem(sched, 'Hide').click()
    await expect.poll(() => counts(page)).toEqual([total - 1, total])
    await expect.poll(() => itemOff(sched, rows.nth(3), 'Hide')).toBe(true)
    await rows.nth(3).click({ button: 'right' })
    await menuItem(sched, 'Show').click()
    await expect.poll(() => counts(page)).toEqual([total, total])
    await expect.poll(() => itemOff(sched, rows.nth(3), 'Show')).toBe(true)
    await rows.nth(3).click({ button: 'right' })
    await menuItem(sched, 'Hide').click()
    await expect.poll(() => counts(page)).toEqual([total - 1, total])
    await expect.poll(() => itemOff(sched, rows.nth(0), 'Show all')).toBe(false)
    await rows.nth(0).click({ button: 'right' })
    await menuItem(sched, 'Show all').click()
    await expect.poll(() => counts(page)).toEqual([total, total])

    // 7 — Copy GUIDs: the clipboard holds exactly the GUIDs a GUID column shows for the two rows.
    await act(sched, 'open-fields').first().click()
    await sched.locator('[data-act="browse-add"][data-id="core|guid"]').click()
    await sched.keyboard.press('Escape')
    await expect(sched.locator('.overlay')).toHaveCount(0)
    await expect(heads.last()).toHaveText('GUID')
    await rows.nth(0).click()
    await rows.nth(1).click({ modifiers: ['Control'] })
    await rows.nth(0).click({ button: 'right' })
    await menuItem(sched, 'Copy GUIDs (2)').click()
    await expect(sched.locator('.toast')).toHaveText('Copied 2 GUIDs.')
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
    const shownGuids = await Promise.all(
      [0, 1].map(async (i) => ((await rows.nth(i).locator('td').last().textContent()) ?? '').trim())
    )
    expect(shownGuids.every((g) => g.length > 0)).toBe(true)
    // One per line; the Windows clipboard stores a line break as CRLF.
    expect(clip.split(/\r?\n/)).toEqual(shownGuids)
    // A column of 124 distinct GUIDs cannot be read as colours: refused, and it says why.
    await heads.last().click({ button: 'right' })
    await menuItem(sched, 'Colour 3D by this column').click()
    await expect(sched.locator('.toast')).toHaveText(
      '124 distinct values — too many to colour by. Group or narrow the column first.'
    )
    await expect(page.locator('button[title="Clear colour scheme"]')).toHaveCount(0)

    // 8 — the Model column filters like any field. IfcWall is in two of the four models.
    await railItems(sched).filter({ hasText: 'IfcWall' }).click()
    const replace = sched.locator('.dlg[role="dialog"]').getByRole('button', { name: 'Replace' })
    await replace.click({ timeout: 3_000 }).catch(() => undefined)
    await expect(rows).toHaveCount(80)
    await expect(heads.first()).toHaveText('Model')
    const models = await rows.evaluateAll((trs) =>
      [...new Set(trs.map((t) => t.querySelector('td')!.textContent))].sort()
    )
    expect(models).toEqual(['SB_ARC_R25', 'SB_STR_R25'])
    await tab(sched, 'filter').click()
    await act(sched, 'filter-add').click()
    await act(sched, 'filter-field', '[data-i="0"]').selectOption('core|model')
    await act(sched, 'filter-op', '[data-i="0"]').selectOption('=')
    await act(sched, 'filter-value', '[data-i="0"]').fill('SB_STR_R25')
    await expect(rows).toHaveCount(12)
    await act(sched, 'filter-remove', '[data-i="0"]').click()
    await expect(rows).toHaveCount(80)

    // 9 — Colour 3D by the Model column: the main window's legend is titled with the column and
    // lists its values; the table draws each value's swatch; Clear 3D colours resets both.
    await heads.first().click({ button: 'right' })
    await expect(menuItem(sched, 'Clear 3D colours')).toBeDisabled()
    await menuItem(sched, 'Colour 3D by this column').click()
    const legendHead = page.locator('button[title="Clear colour scheme"]').locator('..')
    await expect(legendHead).toHaveText('Model')
    const legendRows = page.locator('button[data-tip="Select these elements"]')
    await expect(legendRows).toHaveCount(2)
    await expect(legendRows.nth(0)).toContainText('SB_ARC_R25')
    await expect(legendRows.nth(0)).toContainText('68')
    await expect(legendRows.nth(1)).toContainText('SB_STR_R25')
    await expect(legendRows.nth(1)).toContainText('12')
    await expect(sched.locator('td .sw')).toHaveCount(80)
    await expect(sched.locator('th.colour-src')).toHaveText('Model')
    // The table's swatch is the legend's colour.
    const legendColour = await legendRows.nth(0).locator('span').first()
      .evaluate((e) => getComputedStyle(e).backgroundColor)
    const cellColour = await rows.filter({ hasText: 'SB_ARC_R25' }).first().locator('td .sw')
      .evaluate((e) => getComputedStyle(e).backgroundColor)
    expect(cellColour).toBe(legendColour)
    await heads.first().click({ button: 'right' })
    await menuItem(sched, 'Clear 3D colours').click()
    await expect(legendHead).toHaveCount(0)
    await expect(sched.locator('td .sw')).toHaveCount(0)
    await expect(sched.locator('th.colour-src')).toHaveCount(0)
    // The legend's own × takes the table's swatches away too.
    await heads.first().click({ button: 'right' })
    await menuItem(sched, 'Colour 3D by this column').click()
    await expect(sched.locator('td .sw')).toHaveCount(80)
    await page.locator('button[title="Clear colour scheme"]').click()
    await expect(sched.locator('td .sw')).toHaveCount(0)

    // 9b — the same from the keyboard: headings take focus and Tab walks them; Shift+F10 or the
    // ContextMenu key opens the heading's menu, and focus comes back to the heading through the
    // repaint the swatches cost.
    await heads.first().focus()
    await sched.keyboard.press('Tab')
    await expect(heads.nth(1)).toBeFocused()
    await sched.keyboard.press('Shift+Tab')
    await expect(heads.first()).toBeFocused()
    await sched.keyboard.press('Shift+F10')
    await expect(menu(sched)).toBeVisible()
    await expect(menuItem(sched, 'Colour 3D by this column')).toBeFocused()
    await sched.keyboard.press('Enter')
    await expect(legendHead).toHaveText('Model')
    await expect(sched.locator('td .sw')).toHaveCount(80)
    await expect(heads.first()).toBeFocused()
    await sched.keyboard.press('ContextMenu')
    await expect(menu(sched)).toBeVisible()
    await sched.keyboard.press('ArrowDown')
    await expect(menuItem(sched, 'Clear 3D colours')).toBeFocused()
    await sched.keyboard.press('Enter')
    await expect(legendHead).toHaveCount(0)
    await expect(sched.locator('td .sw')).toHaveCount(0)
    await expect(heads.first()).toBeFocused()

    // 10 — a model unloaded in the main window: the new snapshot keeps this window's schedule,
    // its filter and where the table was scrolled, since the category is still there.
    await tab(sched, 'filter').click()
    await act(sched, 'filter-add').click()
    await act(sched, 'filter-field', '[data-i="0"]').selectOption('core|model')
    await act(sched, 'filter-op', '[data-i="0"]').selectOption('=')
    await act(sched, 'filter-value', '[data-i="0"]').fill('SB_ARC_R25')
    await expect(rows).toHaveCount(68)
    await wrap.evaluate((w) => { w.scrollTop = 300 })
    const before = await wrap.evaluate((w) => w.scrollTop)
    expect(before).toBeGreaterThan(0)
    const unload = page.locator('button[title="Unload model"]')
    await expect(unload).toHaveCount(4)
    await unload.nth(3).click()
    await expect(page.getByText('Unload SB_MEP_R25?')).toBeVisible()
    await page.getByRole('button', { name: 'delete', exact: true }).click()
    await expect(unload).toHaveCount(3)
    await expect(railItems(sched).filter({ hasText: 'IfcDuctSegment' })).toHaveCount(0)
    await expect(rows).toHaveCount(68)
    await expect(act(sched, 'filter-value', '[data-i="0"]')).toHaveValue('SB_ARC_R25')
    await expect(heads.first()).toHaveText('Model')
    expect(await wrap.evaluate((w) => w.scrollTop)).toBe(before)
  } finally {
    await app.close()
  }
})

/**
 * Phase 3's surfaces, both themes — for the Build Report and the reviewer: the row menu, the
 * heading menu, colour-by with the legend beside the swatched table, and two-way selection.
 * Writes `p3-<state>-<theme>.png` into SGVUE_SHOTS/p3; skipped without it.
 */
test('phase 3 screenshots (SGVUE_SHOTS)', async () => {
  const root = process.env.SGVUE_SHOTS ? resolve(ROOT, process.env.SGVUE_SHOTS) : ''
  test.skip(!root, 'set SGVUE_SHOTS to a folder')
  test.setTimeout(240_000)
  const shots = join(root, 'p3')
  await mkdir(shots, { recursive: true })
  const { app, page } = await launch(dir)
  try {
    await page.getByRole('button', { name: 'try the demo building →' }).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    const sched = await openSchedules(app, page)
    await sched.setViewportSize({ width: 1180, height: 760 })
    await expect.poll(() => railItems(sched).count()).toBeGreaterThan(3)
    await railItems(sched).filter({ hasText: 'IfcWall' }).click()
    const rows = sched.locator('tr.data')
    const heads = sched.locator('table.schedule thead th[data-defcol]')
    await expect(rows).toHaveCount(80)
    const side = page.locator('aside')

    for (const theme of ['dark', 'light']) {
      const current = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark')
      if (current !== theme) await toggleTheme(page)
      await expect.poll(() => sched.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
      await sched.mouse.move(5, 5)

      // The row menu, on a Ctrl-selected pair.
      await rows.nth(1).click()
      await rows.nth(2).click({ modifiers: ['Control'] })
      await rows.nth(2).click({ button: 'right' })
      await expect(menu(sched)).toBeVisible()
      await sched.waitForTimeout(300)
      await writeFile(join(shots, `p3-row-menu-${theme}.png`), await sched.screenshot())
      await sched.keyboard.press('Escape')

      // The heading menu, on Level.
      await heads.filter({ hasText: 'Level' }).first().click({ button: 'right' })
      await expect(menu(sched)).toBeVisible()
      await sched.waitForTimeout(300)
      await writeFile(join(shots, `p3-heading-menu-${theme}.png`), await sched.screenshot())

      // Colour 3D by Level: the legend beside the swatched table.
      await menuItem(sched, 'Colour 3D by this column').click()
      await expect(sched.locator('td .sw').first()).toBeVisible()
      await expect(page.locator('button[title="Clear colour scheme"]')).toBeVisible()
      await page.mouse.move(5, 5)
      await sched.mouse.move(5, 5)
      await page.waitForTimeout(1500)
      await writeFile(join(shots, `p3-colour-by-${theme}.png`), await beside(page, sched))
      await page.locator('button[title="Clear colour scheme"]').click()

      // Two-way selection: a beam picked in the main window's tree, marked and scrolled to in
      // the table; then a door, which is not in this table — the note and the rail's dot.
      await railItems(sched).filter({ hasText: 'IfcBeam' }).click()
      await side.getByText('IfcBeam', { exact: true }).click()
      await side.locator('[role="treeitem"][aria-level="2"]').nth(40).click()
      await expect(sched.locator('tr.data.on')).toHaveCount(1)
      await page.mouse.move(5, 5)
      await page.waitForTimeout(1500)
      await writeFile(join(shots, `p3-two-way-${theme}.png`), await beside(page, sched))
      await side.getByText('IfcBeam', { exact: true }).click()
      await side.getByText('IfcDoor', { exact: true }).click()
      await side.locator('[role="treeitem"][aria-level="2"]').first().click()
      await expect(sched.locator('.status .sel-note')).not.toHaveText('')
      await page.waitForTimeout(800)
      await writeFile(join(shots, `p3-not-in-schedule-${theme}.png`), await sched.screenshot())
      await side.getByText('IfcDoor', { exact: true }).click()
      await railItems(sched).filter({ hasText: 'IfcWall' }).click()
      await expect(rows).toHaveCount(80)
    }
  } finally {
    await app.close()
  }
})

/* ────────────────────────────── phase 4: export and the schedule file ────────────────────────────── */

/**
 * A native Save or Open dialog cannot be driven by Playwright, so `dialog.showSaveDialog` and
 * `dialog.showOpenDialog` are replaced **in the main process** with ones that record their
 * options (and whether they were attached to the Schedules window) and answer the path this
 * test chose — `''` for Cancel. The preload bridge, the IPC channels, main's sender and zod
 * checks, and the writer (`main/exports.ts`) are the real ones.
 */
async function stubDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __dlg: { saves: unknown[]; opens: unknown[]; saveTo: string; openFrom: string } }
    g.__dlg = { saves: [], opens: [], saveTo: '', openFrom: '' }
    const record = (list: unknown[], args: unknown[]) => {
      const [win, opts] = args as [{ webContents: { getURL(): string } } | undefined, Record<string, unknown>]
      list.push({ ...opts, attached: !!win && win.webContents.getURL().includes('schedule.html') })
    }
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      record(g.__dlg.saves, args)
      return { canceled: !g.__dlg.saveTo, filePath: g.__dlg.saveTo }
    }) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      record(g.__dlg.opens, args)
      return { canceled: !g.__dlg.openFrom, filePaths: g.__dlg.openFrom ? [g.__dlg.openFrom] : [] }
    }) as typeof dialog.showOpenDialog
  })
}

type Dlg = { saves: Record<string, unknown>[]; opens: Record<string, unknown>[] }
const dialogs = (app: ElectronApplication): Promise<Dlg> =>
  app.evaluate(() => (globalThis as unknown as { __dlg: Dlg }).__dlg)
const answerSave = (app: ElectronApplication, path: string): Promise<void> =>
  app.evaluate((_, p) => { (globalThis as unknown as { __dlg: { saveTo: string } }).__dlg.saveTo = p }, path)
const answerOpen = (app: ElectronApplication, path: string): Promise<void> =>
  app.evaluate((_, p) => { (globalThis as unknown as { __dlg: { openFrom: string } }).__dlg.openFrom = p }, path)

/** The header's Export menu, then one of its items. */
async function exportAs(win: Page, label: string): Promise<void> {
  await act(win, 'export-menu').click()
  await menuItem(win, label).click()
}

/** The table on screen as text: the headings, then every data row — badges and swatches left out. */
const tableText = (win: Page): Promise<string[][]> =>
  win.evaluate(() => {
    const text = (el: Element): string => {
      const c = el.cloneNode(true) as HTMLElement
      c.querySelectorAll('.badge, .hd-sw, .sw').forEach((x) => x.remove())
      return (c.textContent ?? '').trim()
    }
    return [
      [...document.querySelectorAll('table.schedule thead th')].map(text),
      ...[...document.querySelectorAll('table.schedule tbody tr.data')].map((tr) => [...tr.querySelectorAll('td')].map(text))
    ]
  })

/** RFC 4180, enough for what the exporter writes: quotes, doubled quotes, CRLF rows. */
function parseCsv(s: string): string[][] {
  return s.split('\r\n').map((line) => {
    const out: string[] = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') quoted = false
        else cur += c
      } else if (c === '"') quoted = true
      else if (c === ',') { out.push(cur); cur = '' } else cur += c
    }
    out.push(cur)
    return out
  })
}

/** The screen's thousands separators out, as the exporter writes numbers. */
const plain = (s: string): string => s.replace(/(\d),(?=\d{3}(?!\d))/g, '$1')

const today = (): string => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

test('phase 4: export CSV, Excel, a workbook and a schedule file through the native dialogs; open it back', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    const sched = await openSchedules(app, page)
    // Anything the production CSP refused — exceljs is the one new library, loaded on demand.
    const refused: string[] = []
    sched.on('console', (m) => {
      if (/Content Security Policy|EvalError|unsafe-eval/i.test(m.text())) refused.push(m.text())
    })
    sched.on('pageerror', (e) => refused.push(String(e)))
    await expect(sched.locator('tr.data')).toHaveCount(4)
    await stubDialogs(app)
    const out = join(dir, 'exports')
    await mkdir(out)
    const toast = sched.locator('.toast')
    const documents = await app.evaluate(({ app: a }) => a.getPath('documents'))

    // 0 — the bridge: two calls in this window, none in the main one.
    expect(await sched.evaluate(() => Object.keys((window as unknown as { sgvueSchedule: object }).sgvueSchedule)))
      .toEqual(['saveExport', 'openScheduleFile'])
    expect(await page.evaluate(() => 'sgvueSchedule' in window)).toBe(false)
    expect(await page.evaluate(() =>
      Object.keys((window as unknown as { sgvue: object }).sgvue).filter((k) => /export|schedulefile/i.test(k)))).toEqual([])

    // 1 — a numeric column, so the workbook has numbers to prove: the core Level Elevation.
    await act(sched, 'open-fields').first().click()
    await sched.locator('[data-act="browse-add"][data-id="core|storeyElevation"]').click()
    await sched.keyboard.press('Escape')
    await expect(sched.locator('table.schedule thead th', { hasText: 'Level Elevation' })).toHaveCount(1)

    // 2 — the menu from the keyboard: Enter opens it on its first item, the arrows move,
    // Escape gives focus back to the button. Nothing saved yet, so the workbook item is off.
    await act(sched, 'export-menu').focus()
    await sched.keyboard.press('Enter')
    await expect(menuItem(sched, 'Excel (.xlsx)')).toBeFocused()
    await expect(menuItem(sched, 'All saved schedules (.xlsx)')).toBeDisabled()
    await expect(menuItem(sched, 'Schedule file (.schedule.json)')).toBeEnabled()
    await sched.keyboard.press('ArrowDown')
    await expect(menuItem(sched, 'CSV')).toBeFocused()
    await sched.keyboard.press('Escape')
    await expect(menu(sched)).toHaveCount(0)
    await expect(act(sched, 'export-menu')).toBeFocused()
    // Under the guard the page says why a menu closed (what a failing test prints).
    await expect.poll(() => menuLog.some((l) => l.endsWith('[menu] closed: escape'))).toBe(true)

    // 3 — CSV, chosen from the keyboard: the dialog is the Schedules window's, offers
    // `<name> — <today>.csv` in Documents, and the file is the table — with its BOM.
    const csvPath = join(out, 'walls.csv')
    await answerSave(app, csvPath)
    await sched.keyboard.press('Enter')
    await sched.keyboard.press('ArrowDown')
    await sched.keyboard.press('Enter')
    await expect(toast).toHaveText('Exported 4 rows to CSV.')
    await expect.poll(() => menuLog.some((l) => l.endsWith('[menu] closed: pick'))).toBe(true)
    const [csvDialog] = (await dialogs(app)).saves
    expect(csvDialog).toMatchObject({
      attached: true,
      title: 'Export to CSV',
      defaultPath: join(documents, `Wall Schedule — ${today()}.csv`),
      filters: [{ name: 'CSV (comma-separated)', extensions: ['csv'] }]
    })
    const csv = await readFile(csvPath, 'utf8')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const screen = await tableText(sched)
    expect(parseCsv(csv.slice(1))).toEqual(screen.map((row) => row.map(plain)))

    // 4 — Excel: the same table, one sheet named after the schedule; text is text, and a
    // numeric cell is a NUMBER holding what the screen shows.
    const xlsxPath = join(out, 'walls.xlsx')
    await answerSave(app, xlsxPath)
    await exportAs(sched, 'Excel (.xlsx)')
    await expect(toast).toHaveText('Exported 4 rows to Excel.')
    expect((await dialogs(app)).saves[1]).toMatchObject({
      attached: true,
      title: 'Export to Excel',
      // The folder the last export went to, this session.
      defaultPath: join(out, `Wall Schedule — ${today()}.xlsx`)
    })
    // exceljs is CommonJS: under this runner its classes sit on the module's `default`.
    const excel = await import('exceljs')
    const Workbook = excel.Workbook ?? (excel as unknown as { default: typeof excel }).default.Workbook
    const wb = new Workbook()
    await wb.xlsx.readFile(xlsxPath)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Wall Schedule'])
    const ws = wb.worksheets[0]
    expect(ws.rowCount).toBe(screen.length)
    let numbers = 0
    screen.forEach((row, r) => {
      row.forEach((shown, c) => {
        const v = ws.getRow(r + 1).getCell(c + 1).value
        if (typeof v === 'number') {
          numbers++
          expect([r, c, v]).toEqual([r, c, Number.parseFloat(plain(shown))])
        } else {
          expect([r, c, v ?? '']).toEqual([r, c, shown])
        }
      })
    })
    const elev = screen[0].indexOf('Level Elevation')
    expect(numbers).toBeGreaterThanOrEqual(4)
    expect(typeof ws.getRow(2).getCell(elev + 1).value).toBe('number')

    // 5 — Cancel writes nothing, and says so.
    await answerSave(app, '')
    await exportAs(sched, 'CSV')
    await expect(toast).toHaveText('Export cancelled — nothing was saved.')
    expect((await readdir(out)).sort()).toEqual(['walls.csv', 'walls.xlsx'])

    // 6 — the main window cannot reach either channel. Its bridge has neither (above); and the
    // real handlers, asked with the main window as the sender, refuse before they read a byte
    // or show a dialog. (`_invokeHandlers` is where `ipcMain.handle` keeps them.)
    const before = await dialogs(app)
    const asMain = await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, (e: unknown, a?: unknown) => unknown> })
        ._invokeHandlers
      if (!handlers) return ['no handler table']
      const main = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))!
      const said: string[] = []
      const calls: [string, unknown][] = [
        ['export:save', { kind: 'csv', suggestedName: 'x.csv', bytes: new Uint8Array([97]) }],
        ['scheduleFile:open', undefined]
      ]
      for (const [ch, arg] of calls) {
        try {
          await handlers.get(ch)!({ sender: main.webContents }, arg)
          said.push(`${ch}: answered`)
        } catch (e) {
          said.push(`${ch}: ${(e as Error).message}`)
        }
      }
      return said
    })
    expect(asMain).toEqual(['export:save: not available', 'scheduleFile:open: not available'])
    const after = await dialogs(app)
    expect([after.saves.length, after.opens.length]).toEqual([before.saves.length, before.opens.length])

    // 7 — save the setup; the workbook of every saved schedule is one sheet per setup.
    await act(sched, 'save-schedule').first().click()
    await expect(toast).toHaveText('Saved “Wall Schedule”.')
    const bookPath = join(out, 'book.xlsx')
    await answerSave(app, bookPath)
    await exportAs(sched, 'All saved schedules (.xlsx)')
    await expect(toast).toHaveText('Exported 1 schedule to one workbook.')
    expect(String((await dialogs(app)).saves.at(-1)!.defaultPath)).toMatch(/tiny — schedules — \d{4}-\d{2}-\d{2}\.xlsx$/)
    const book = new Workbook()
    await book.xlsx.readFile(bookPath)
    expect(book.worksheets.map((w) => w.name)).toEqual(['Wall Schedule'])
    expect(book.worksheets[0].rowCount).toBe(5)

    // 8 — the schedule file: a distinctive setup (renamed, grouped by level, itemise off)
    // exported from the menu; the Save dialog's name is forced to .schedule.json.
    await sched.locator('.schedule-name').fill('Walls round trip')
    await sched.locator('.schedule-name').press('Tab')
    await tab(sched, 'sort').click()
    await act(sched, 'sort-add').click()
    await act(sched, 'sort-field', '[data-i="0"]').selectOption('core|storey')
    // The switches are labels over a 1 px input: clicked where a hand clicks them.
    const toggleOf = (input: ReturnType<Page['locator']>) => sched.locator('label', { has: input })
    await toggleOf(act(sched, 'sort-header', '[data-i="0"]')).click()
    await expect(act(sched, 'sort-header', '[data-i="0"]')).toBeChecked()
    await toggleOf(act(sched, 'itemize')).click()
    await expect(act(sched, 'itemize')).not.toBeChecked()
    await expect(sched.locator('tr.data')).toHaveCount(2)
    await answerSave(app, join(out, 'setup.json'))
    await exportAs(sched, 'Schedule file (.schedule.json)')
    await expect(toast).toHaveText('Exported “Walls round trip” as a schedule file.')
    expect((await dialogs(app)).saves.at(-1)).toMatchObject({
      attached: true,
      title: 'Export schedule file',
      filters: [{ name: 'Schedule file', extensions: ['json'] }]
    })
    const setupPath = join(out, 'setup.schedule.json')
    const setup = JSON.parse(await readFile(setupPath, 'utf8')) as { name: string; itemize: boolean; entity: string[] }
    expect(setup).toMatchObject({ name: 'Walls round trip', itemize: false, entity: ['IfcWall'] })

    // …and My templates' own row action exports a saved setup the same way.
    await act(sched, 'open-saved').click()
    const mine = sched.locator('.overlay-card[aria-label="My templates"]')
    await answerSave(app, join(out, 'saved-one'))
    await mine.locator('[data-act="export-saved"]').click()
    await expect(toast).toHaveText('Exported “Wall Schedule” as a schedule file.')
    expect(JSON.parse(await readFile(join(out, 'saved-one.schedule.json'), 'utf8')).name).toBe('Wall Schedule')
    await sched.keyboard.press('Escape')

    // 9 — another category replaces it…
    await railItems(sched).filter({ hasText: 'IfcSlab' }).click()
    await sched.locator('.dlg[role="dialog"]').getByRole('button', { name: 'Replace' }).click()
    await expect(sched.locator('.schedule-title')).toHaveText('Slab Schedule')

    // …and Open schedule file… in My templates brings the whole setup back.
    await answerOpen(app, setupPath)
    await act(sched, 'open-saved').click()
    await mine.locator('[data-act="import-schedule"]').click()
    await expect(toast).toHaveText('Loaded “Walls round trip”.')
    await expect(mine).toHaveCount(0)
    await expect(sched.locator('.schedule-title')).toHaveText('Walls round trip')
    await expect(sched.locator('tr.group')).toHaveCount(2)
    await expect(sched.locator('tr.data')).toHaveCount(2)
    await expect(sched.locator('table.schedule thead th', { hasText: 'Count' })).toHaveCount(1)
    expect((await dialogs(app)).opens.at(-1)).toMatchObject({
      attached: true,
      properties: ['openFile'],
      filters: [{ name: 'Schedule files', extensions: ['json'] }]
    })
    // One undo step, like a template: back to the slab schedule.
    await act(sched, 'undo').click()
    await expect(sched.locator('.schedule-title')).toHaveText('Slab Schedule')

    // 10 — a file that is not a schedule is refused, and says why; the schedule stays.
    const bad = join(out, 'bad.schedule.json')
    await writeFile(bad, '{"hello":"world"}')
    await answerOpen(app, bad)
    await act(sched, 'open-saved').click()
    await mine.locator('[data-act="import-schedule"]').click()
    await expect(sched.locator('.toast.bad')).toHaveText('Missing "version" — is this a schedule file?')
    await writeFile(bad, 'not json at all')
    await mine.locator('[data-act="import-schedule"]').click()
    await expect(sched.locator('.toast.bad')).toHaveText('That file is not a schedule definition.')
    await sched.keyboard.press('Escape')
    await expect(sched.locator('.schedule-title')).toHaveText('Slab Schedule')

    expect(refused).toEqual([])
  } finally {
    await app.close()
  }
})

test('phase 4: a focused column heading takes Enter and Space as its click', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    const sched = await openSchedules(app, page)
    const heads = sched.locator('table.schedule thead th[data-defcol]')
    await expect(heads.first()).toHaveAttribute('title', /Keys: Enter or Space for a click/)

    // Enter formats the column, as a click does.
    await tab(sched, 'fields').click()
    await heads.nth(1).focus()
    await sched.keyboard.press('Enter')
    await expect(sched.locator('.tab.on')).toHaveAttribute('data-section', 'format')
    await expect(heads.nth(1)).toBeFocused()
    // Shift+Enter takes the run from there, as Shift+click does; Escape clears it.
    await heads.nth(0).focus()
    await sched.keyboard.press('Shift+Enter')
    await expect(sched.locator('table.schedule thead th.sel')).toHaveCount(2)
    // Ctrl+Space adds one more, as Ctrl+click does.
    await heads.nth(2).focus()
    await sched.keyboard.press('Control+Space')
    await expect(sched.locator('table.schedule thead th.sel')).toHaveCount(3)
    await sched.keyboard.press('Escape')
    await expect(sched.locator('table.schedule thead th.sel')).toHaveCount(0)
    // Space alone is a plain click too.
    await tab(sched, 'fields').click()
    await heads.nth(0).focus()
    await sched.keyboard.press('Space')
    await expect(sched.locator('.tab.on')).toHaveAttribute('data-section', 'format')
  } finally {
    await app.close()
  }
})

/* ────────────────────────────── 2026-09-28: the assistant and the Schedules window ────────────────────────────── */

/** What the renderer answers a tool call with — `AiToolResult`. */
interface ToolAnswer {
  ok: boolean
  /** `forModel` — read field by field in the test, so left loosely typed. */
  result?: any
  message?: string
}

/**
 * Run one assistant tool the way a model turn does: main sends `ai:tool:exec` to the main
 * window, the renderer runs `executeTool` and answers on `ai:tool:result`. The production
 * path, with no dev hook — only the model is missing.
 */
function tool(app: ElectronApplication, name: string, input: unknown): Promise<ToolAnswer> {
  return app.evaluate(
    ({ BrowserWindow, ipcMain }, [tool, args]) =>
      new Promise<ToolAnswer>((resolve) => {
        // A window closed a moment ago can still be listed, and a destroyed one throws on getURL —
        // and so does a closing window's webContents, which can go before the window does.
        const win = BrowserWindow.getAllWindows().find(
          (w) => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().includes('index.html')
        )!
        const callId = `e2e-${tool}-${Date.now()}-${Math.random()}`
        const on = (_event: unknown, raw: { callId?: string }): void => {
          if (raw?.callId !== callId) return
          ipcMain.off('ai:tool:result', on)
          resolve(raw as ToolAnswer)
        }
        ipcMain.on('ai:tool:result', on)
        win.webContents.send('ai:tool:exec', { turnId: 'e2e', callId, name: tool, input: args })
      }),
    [name, input] as const
  )
}

/**
 * One assistant call run **inside a live turn** (2026-10-02). `tool()` above sends its calls for
 * no turn at all, and since the consent gate's review a call for a turn the renderer is not in
 * is run only when it is a read: one that asks the user is answered *The turn was stopped, so
 * nothing was asked.*, and — phase 4 — one that changes the view *The turn was stopped, so
 * nothing was changed.* So every `kind: 'view'` tool here goes through this, and `tool()` is
 * for the reads.
 *
 * The turn is the panel's own: a question typed into the composer, main's turn handlers held
 * (`helpers.ts`), the call sent over the real channel, the turn ended. A turn asks the user for
 * one thing, so each call gets a turn of its own. The panel has to be open and `holdTurns`
 * called first.
 */
async function inTurn(app: ElectronApplication, page: Page, name: string, input: unknown): Promise<ToolAnswer> {
  const send = page.locator('button[data-part="send"]')
  const before = (await toolResults(app)).length
  await page.locator('[data-role="chatinput"]').fill('Do it.')
  await page.locator('[data-role="chatinput"]').press('Enter')
  await expect(send).toHaveAttribute('aria-label', 'Stop')
  await liveTool(app, name, input)
  await expect.poll(async () => (await toolResults(app)).length).toBe(before + 1)
  const answer = (await toolResults(app))[before] as ToolAnswer
  await emit(app, { type: 'done', text: 'Done.', rounds: 2 })
  await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
  return answer
}

const ASK = 'button[data-tip^="Ask the assistant"]'

/** The chat panel open and main's turn handlers held: what `inTurn` needs. */
async function openChat(app: ElectronApplication, page: Page): Promise<void> {
  await page.locator(ASK).click()
  await expect(page.locator('[data-role="chatlog"]')).toBeVisible()
  await holdTurns(app)
}

/**
 * `inTurn` with the panel opened for it and put away again — for a step whose assertions are
 * about the main window itself (the legend, the status bar, Ctrl+Z), with the turn handlers
 * already held.
 */
async function inTurnAside(app: ElectronApplication, page: Page, name: string, input: unknown): Promise<ToolAnswer> {
  await page.locator(ASK).click()
  await expect(page.locator('[data-role="chatlog"]')).toBeVisible()
  const answer = await inTurn(app, page, name, input)
  await page.locator('button[aria-label="Close"]').click()
  await expect(page.locator('[data-role="chatlog"]')).toHaveCount(0)
  return answer
}

test('the assistant makes a schedule, sees it, and changes it keeping the user’s columns (2026-09-28)', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    expect(app.windows()).toHaveLength(1)
    expect((await tool(app, 'get_schedule', {})).result.message).toContain('No Schedules window is open')
    // `make_schedule` changes what a window shows, so it runs inside a live turn (`inTurn`).
    await openChat(app, page)
    const WALLS = {
      title: 'Walls from chat',
      category: ['IfcWall'],
      columns: [{ field: 'Name' }, { field: 'level' }],
      groupBy: ['Level'],
      grandTotals: true
    }
    // 0 — with no turn at all it is answered in words (2026-10-02, phase 4): nothing is built,
    // and no window opens.
    expect((await tool(app, 'make_schedule', WALLS)).result).toEqual({
      message: 'The turn was stopped, so nothing was changed.',
      applied: false
    })
    expect(app.windows()).toHaveLength(1)

    // 1 — make_schedule with the window closed: it opens, showing that schedule, on the window's
    // own toast; the model reads back the rows and totals it shows.
    const opened = app.waitForEvent('window')
    const made = await inTurn(app, page, 'make_schedule', WALLS)
    const sched = await opened
    await sched.waitForLoadState('domcontentloaded')
    expect(made.ok).toBe(true)
    expect(made.result.headings).toEqual(['Name', 'Level'])
    expect(made.result.rowCount).toBe(4)
    expect(made.result.groups.map((g: { group: string; count: number }) => [g.group, g.count])).toEqual([
      ['Level 1', 2],
      ['Level 2', 2]
    ])
    expect(made.result.grandTotal.count).toBe(4)
    await expect(sched.locator('.schedule-title')).toHaveText('Walls from chat')
    const heads = sched.locator('table.schedule thead th[data-defcol]')
    await expect(heads).toHaveText(['Name', 'Level'])
    await expect(sched.locator('tr.data')).toHaveCount(4)
    await expect(sched.locator('tr.group')).toHaveCount(2)
    await expect(sched.locator('.toast')).toHaveText('Schedule from Ask Vee')
    await expect(sched.locator('#status-bar')).toContainText('4 rows')

    // 2 — the main window's view state now names it, and get_schedule reads the same table.
    await expect
      .poll(async () => (await tool(app, 'get_view_state', {})).result.schedule)
      .toEqual({ title: 'Walls from chat', category: ['IfcWall'], columns: ['Name', 'Level'], filters: '', rowCount: 4 })
    const read = await tool(app, 'get_schedule', { limit: 2 })
    expect(read.result.rows).toHaveLength(2)
    expect(read.result.truncated).toBe(true)
    expect(read.result.schedule.groupBy).toEqual(['Level'])

    // 3 — the user makes it theirs in the window: the Wall Schedule template, columns and all.
    // The schedule from chat is unsaved work, so the window's own dialog asks first.
    await act(sched, 'open-templates').click()
    await sched.locator('[data-act="apply-template"][data-id="wall-schedule"]').click()
    const dialog = sched.locator('.dlg[role="dialog"]')
    await expect(dialog).toContainText('Replace the current schedule setup?')
    await dialog.getByRole('button', { name: 'Replace' }).click()
    await expect(sched.locator('.tpl-chip')).toContainText('Wall Schedule')
    const theirs = await heads.count()
    await expect
      .poll(async () => (await tool(app, 'get_view_state', {})).result.schedule?.title)
      .toBe('Wall Schedule')

    // 4 — "add Name to this": one column more, every one of theirs kept — the template's too.
    const edited = await inTurn(app, page, 'make_schedule', { base: 'open', columns: [{ field: 'Name' }] })
    expect(edited.ok).toBe(true)
    expect(edited.result.message).toMatch(/^Changed the open schedule in the Schedules window/)
    await expect(sched.locator('.toast')).toHaveText('Schedule changed by Ask Vee')
    await expect(heads).toHaveCount(theirs + 1)
    await expect(heads.last()).toHaveText('Name')
    await expect(sched.locator('table.schedule thead th', { hasText: 'IsExternal' })).toHaveCount(1)
    await expect(sched.locator('.tpl-chip')).toContainText('Wall Schedule')

    // 5 — it went onto the window's own undo history: one undo takes that column away, and
    // only that column.
    await act(sched, 'undo').click()
    await expect(heads).toHaveCount(theirs)
    await expect(sched.locator('table.schedule thead th', { hasText: 'IsExternal' })).toHaveCount(1)

    // 6 — a name that is not one changes nothing, and says which names are near.
    const wrong = await inTurn(app, page, 'make_schedule', { base: 'open', columns: [{ field: 'Levle' }] })
    expect(wrong.result.message).toMatch(/^Nothing was changed\. "Levle" is not a Schedules field/)
    await expect(heads).toHaveCount(theirs)

    // 7 — closing the window: the view state no longer names a schedule.
    const gone = sched.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('schedule.html'))!.close()
    })
    await gone
    await expect.poll(async () => (await tool(app, 'get_view_state', {})).result.schedule).toBeNull()
  } finally {
    await app.close()
  }
})

test('the assistant exports the open schedule through its Save dialog, and colours the model by one of its columns (2026-09-28)', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    await stubDialogs(app)
    const documents = await app.evaluate(({ app: a }) => a.getPath('documents'))
    // `export_schedule` asks the user, so it runs inside a live turn (`inTurn`, above): the
    // panel is open for the export steps, and put away again before the main window is used.
    await openChat(app, page)
    // With no turn at all it is answered in words, and no dialog is asked for.
    expect((await tool(app, 'export_schedule', { format: 'xlsx' })).result).toEqual({
      message: 'The turn was stopped, so nothing was asked.',
      applied: false,
      pending: false
    })
    expect((await dialogs(app)).saves).toHaveLength(0)

    // 0 — no Schedules window: refused, and no dialog is asked for.
    expect((await inTurn(app, page, 'export_schedule', { format: 'xlsx' })).result).toEqual({
      message: 'No Schedules window is open, so there is no schedule to export. Nothing was exported — make_schedule shows one.',
      dialog: false
    })

    // 1 — a schedule from chat, which opens the window.
    const opened = app.waitForEvent('window')
    const made = await inTurn(app, page, 'make_schedule', {
      title: 'Walls from chat',
      category: ['IfcWall'],
      columns: [{ field: 'Name' }, { field: 'Level' }]
    })
    expect(made.ok).toBe(true)
    const sched = await opened
    await sched.waitForLoadState('domcontentloaded')
    await expect(sched.locator('tr.data')).toHaveCount(4)
    const toast = sched.locator('.toast')
    await expect
      .poll(async () => (await tool(app, 'get_view_state', {})).result.schedule?.title)
      .toBe('Walls from chat')

    // Each time main brings the Schedules window forward — the toolbar button's own route.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(
        (b) => !b.isDestroyed() && !b.webContents.isDestroyed() && b.webContents.getURL().includes('schedule.html')
      )!
      const g = globalThis as unknown as { __raised: number }
      g.__raised = 0
      const focus = w.focus.bind(w)
      w.focus = () => {
        g.__raised++
        focus()
      }
    })
    const raised = (): Promise<number> => app.evaluate(() => (globalThis as unknown as { __raised: number }).__raised)

    // 2 — All saved schedules, with none saved: the menu's own rule refuses it, no dialog, and
    // the window is not raised.
    const none = await inTurn(app, page, 'export_schedule', { format: 'all_saved' })
    expect(none.result.message).toMatch(/^There are no saved schedules to export/)
    expect((await dialogs(app)).saves).toHaveLength(0)
    expect(await raised()).toBe(0)

    // 3 — Excel: the Export menu's own Save dialog, attached to the Schedules window, with the
    // menu's own title and suggested name; the tool returns at once, claiming no file; a stubbed
    // Save then writes a real workbook through main/exports.ts.
    const out = join(dir, 'exports')
    await mkdir(out)
    const xlsxPath = join(out, 'from-chat.xlsx')
    await answerSave(app, xlsxPath)
    const x = await inTurn(app, page, 'export_schedule', { format: 'xlsx' })
    expect(x.ok).toBe(true)
    expect(x.result.dialog).toBe(true)
    expect(x.result.message).toMatch(/^The Save dialog for Excel \(\.xlsx\) is opening in the Schedules window/)
    expect(x.result.message).toContain('do not say a file was saved')
    await expect(toast).toHaveText('Exported 4 rows to Excel.')
    expect(await raised()).toBe(1)
    expect((await dialogs(app)).saves).toHaveLength(1)
    expect((await dialogs(app)).saves[0]).toMatchObject({
      attached: true,
      title: 'Export to Excel',
      defaultPath: join(documents, `Walls from chat — ${today()}.xlsx`)
    })
    const excel = await import('exceljs')
    const Workbook = excel.Workbook ?? (excel as unknown as { default: typeof excel }).default.Workbook
    const wb = new Workbook()
    await wb.xlsx.readFile(xlsxPath)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Walls from chat'])
    expect(wb.worksheets[0].rowCount).toBe(5)

    // 4 — Cancel: the dialog opens, nothing is written, and the menu's own toast says so.
    await answerSave(app, '')
    const c = await inTurn(app, page, 'export_schedule', { format: 'csv' })
    expect(c.result.dialog).toBe(true)
    await expect(toast).toHaveText('Export cancelled — nothing was saved.')
    const saves = (await dialogs(app)).saves
    expect(saves).toHaveLength(2)
    expect(saves[1]).toMatchObject({ attached: true, title: 'Export to CSV' })
    expect(await readdir(out)).toEqual(['from-chat.xlsx'])
    // The export steps are done: the panel is put away, and the rest is the main window's.
    await page.locator('button[aria-label="Close"]').click()
    await expect(page.locator('[data-role="chatlog"]')).toHaveCount(0)

    // 5 — colour 3D by the Level column from its heading menu, then from chat: the same legend —
    // title, values, counts and colours — and the same swatches in the table.
    const heads = sched.locator('table.schedule thead th[data-defcol]')
    await expect(heads).toHaveText(['Name', 'Level'])
    const legendHead = page.locator('button[title="Clear colour scheme"]').locator('..')
    const legendRows = page.locator('button[data-tip="Select these elements"]')
    const legend = (): Promise<string[][]> =>
      legendRows.evaluateAll((bs) =>
        bs.map((b) => [(b.textContent ?? '').replace(/\s+/g, ' ').trim(), getComputedStyle(b.querySelector('span')!).backgroundColor])
      )
    await heads.nth(1).click({ button: 'right' })
    await menuItem(sched, 'Colour 3D by this column').click()
    await expect(legendHead).toHaveText('Level')
    await expect(legendRows).toHaveCount(2)
    const viaMenu = await legend()
    await page.locator('button[title="Clear colour scheme"]').click()
    await expect(legendHead).toHaveCount(0)
    await expect(sched.locator('td .sw')).toHaveCount(0)

    // A visibility change first, so the main window's undo has a step to take: Hide one row.
    const visible = page.locator('span[title="visible / total elements"]')
    const all = (await visible.textContent())!.trim()
    await sched.locator('tr.data').first().click({ button: 'right' })
    await menuItem(sched, 'Hide').click()
    await expect(visible).not.toHaveText(all)
    const undo = page.locator('button[data-tip="Undo the last visibility change (⌘Z)"]')
    await expect(undo).toHaveCount(1)

    // (A colour-by changes the view: a live turn, with the panel out of the way again after it.)
    const col = await inTurnAside(app, page, 'color_by_schedule_column', { column: 'Level' })
    expect(col.ok).toBe(true)
    expect(col.result.column).toBe('Level')
    expect(col.result.groups.map((g: { value: string; count: number }) => [g.value, g.count])).toEqual([
      ['Level 1', 2],
      ['Level 2', 2]
    ])
    await expect(legendHead).toHaveText('Level')
    expect(await legend()).toEqual(viaMenu)
    await expect(sched.locator('td .sw')).toHaveCount(4)
    await expect(sched.locator('th.colour-src')).toHaveText('Level')

    // 6 — undo in the main window. A colour-by is not a visibility change (the design keeps it
    // out of `VIS_KEYS`), so — exactly as after the heading menu's — ⌘Z takes back the Hide and
    // leaves the colours; the legend's clear (here `column: null`) is what takes them away.
    await page.keyboard.press('Control+z')
    await expect(visible).toHaveText(all)
    await expect(legendHead).toHaveText('Level')

    // 7 — a column the schedule does not show is refused with the ones it does; null clears.
    const wrong = await inTurnAside(app, page, 'color_by_schedule_column', { column: 'Width' })
    expect(wrong.result.valid_values).toEqual({ columns: ['Name', 'Level'] })
    await expect(legendHead).toHaveText('Level')
    const cleared = await inTurnAside(app, page, 'color_by_schedule_column', { column: null })
    expect(cleared.result.message).toBe('Colour scheme cleared.')
    await expect(legendHead).toHaveCount(0)
    await expect(sched.locator('td .sw')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

/* ────────────────────────────── 2026-10-02: parity with the user, phase 4 ────────────────────────────── */

test('the assistant works the Schedules window’s own controls: undo and redo, a template, a saved setup saved and loaded — and deleting, printing and opening a file are only asked for (2026-10-02)', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    await openChat(app, page)
    const manage = (op: string, more: Record<string, unknown> = {}): Promise<ToolAnswer> =>
      inTurn(app, page, 'manage_schedules', { op, ...more })

    // 0 — no Schedules window: every control is refused in words; `open` is the toolbar button.
    expect((await manage('undo')).result).toEqual({
      message: 'No Schedules window is open, so nothing was done. op:"open" opens it, and make_schedule opens it with a schedule.',
      done: false,
      open: false
    })
    expect(app.windows()).toHaveLength(1)
    const opening = app.waitForEvent('window')
    const open = await manage('open')
    const sched = await opening
    await sched.waitForLoadState('domcontentloaded')
    expect(open.result).toMatchObject({ message: 'Opened the Schedules window.', done: true, open: true })
    const heads = sched.locator('table.schedule thead th[data-defcol]')
    const title = sched.locator('.schedule-title')
    const toast = sched.locator('.toast')
    await expect(sched.locator('tr.data')).toHaveCount(4)

    // 1 — a schedule from chat, then a change to it: two entries on the window's own history.
    await inTurn(app, page, 'make_schedule', { title: 'Walls from chat', category: ['IfcWall'], columns: [{ field: 'Name' }, { field: 'Level' }] })
    await expect(heads).toHaveText(['Name', 'Level'])
    // (Phase 4's own inputs, through the same port: a column placed first, and one hidden.)
    const edited = await inTurn(app, page, 'make_schedule', {
      base: 'open',
      columns: [{ field: 'GUID', after: '' }, { field: 'Level', hidden: true }],
      calculated: [{ name: 'Label', formula: 'if(contains(Name, "Wall"), "wall", "other")', result: 'text' }]
    })
    expect(edited.ok).toBe(true)
    await expect(heads).toHaveText(['GUID', 'Name', 'Label'])
    await expect(toast).toHaveText('Schedule changed by Ask Vee')
    expect(edited.result.schedule.calculated).toEqual([
      { name: 'Label', formula: 'if(contains(Name, "Wall"), "wall", "other")', result: 'text' }
    ])
    // A formula that does not parse refuses the call with the engine's reason: nothing changes.
    const bad = await inTurn(app, page, 'make_schedule', { base: 'open', calculated: [{ name: 'Bad', formula: 'Name *' }] })
    expect(bad.result.message).toMatch(/^Nothing was changed\. Calculated column "Bad": /)
    await expect(heads).toHaveText(['GUID', 'Name', 'Label'])

    // 2 — undo and redo through the port are the header's own two buttons: the same history,
    // the same toast, the steps left read back.
    const undone = await manage('undo')
    expect(undone.result).toMatchObject({ done: true, redoSteps: 1 })
    expect(undone.result.schedule.columns).toEqual(['Name', 'Level'])
    await expect(heads).toHaveText(['Name', 'Level'])
    await expect(toast).toHaveText(`Undo — ${undone.result.undoSteps} step${undone.result.undoSteps === 1 ? '' : 's'} left.`)
    const redone = await manage('redo')
    expect(redone.result).toMatchObject({ done: true, redoSteps: 0, undoSteps: undone.result.undoSteps + 1 })
    await expect(heads).toHaveText(['GUID', 'Name', 'Label'])
    await expect(toast).toHaveText('Redo — 0 steps left.')
    expect((await manage('redo')).result).toMatchObject({ message: 'There is nothing to redo in the Schedules window.', done: false })
    // And the user's own Undo button takes the assistant's step back, as it takes any other.
    await act(sched, 'undo').click()
    await expect(heads).toHaveText(['Name', 'Level'])

    // 3 — the template gallery: listed with each card's figures, and one applied by its name.
    const templates = (await manage('templates')).result.templates as { id: string; name: string; inUse: boolean; elements: number }[]
    const wall = templates.find((t) => t.id === 'wall-schedule')!
    expect(wall).toMatchObject({ name: 'Wall Schedule', inUse: false, elements: 4 })
    const applied = await manage('apply_template', { name: 'wall schedule' })
    expect(applied.result).toMatchObject({ done: true, name: 'Wall Schedule' })
    await expect(sched.locator('.tpl-chip')).toContainText('Wall Schedule')
    await expect(toast).toHaveText('Applied “Wall Schedule”.')
    expect((await manage('apply_template', { name: 'No such template' })).result.message).toBe(
      'No template for the loaded models is called "No such template". Nothing was done — op:"templates" lists them.'
    )
    // One step on the same history: back to the schedule from chat.
    await manage('undo')
    await expect(title).toHaveText('Walls from chat')

    // 4 — My templates: saved, listed, and loaded back after the schedule has become another.
    expect((await manage('saved_list')).result).toMatchObject({ saved: [], total: 0 })
    const saved = await manage('save')
    expect(saved.result).toMatchObject({ done: true, name: 'Walls from chat' })
    await expect(toast).toHaveText('Saved “Walls from chat”.')
    await expect(sched.locator('.rail-saved.on')).toContainText('Walls from chat')
    expect((await manage('saved_list')).result.saved).toEqual([
      { name: 'Walls from chat', classes: ['IfcWall'], columns: 2, saved: new Date().toISOString().slice(0, 10), inUse: true, lacks: false }
    ])
    await inTurn(app, page, 'make_schedule', { title: 'Slabs', category: ['IfcSlab'], columns: [{ field: 'Name' }] })
    await expect(title).toHaveText('Slabs')
    const loaded = await manage('load', { name: 'walls FROM chat' })
    expect(loaded.result).toMatchObject({ done: true, name: 'Walls from chat' })
    expect(loaded.result.schedule).toMatchObject({ title: 'Walls from chat', columns: ['Name', 'Level'], rowCount: 4 })
    await expect(title).toHaveText('Walls from chat')
    await expect(heads).toHaveText(['Name', 'Level'])
    await expect(toast).toHaveText('Loaded “Walls from chat”.')
    // Loading is one undo step in that window too.
    await act(sched, 'undo').click()
    await expect(title).toHaveText('Slabs')
    await act(sched, 'redo').click()
    await expect(title).toHaveText('Walls from chat')

    // 5 — rename and duplicate, the panel's own two actions; a name that is taken is refused.
    expect((await manage('rename', { name: 'Walls from chat', to: 'Walls L1' })).result).toMatchObject({ done: true, name: 'Walls L1' })
    expect((await manage('duplicate', { name: 'Walls L1' })).result).toMatchObject({ done: true, name: 'Walls L1 (2)' })
    expect((await manage('rename', { name: 'Walls L1 (2)', to: 'Walls L1' })).result).toEqual({
      message: 'A saved setup is already called "Walls L1", so "Walls L1 (2)" was not renamed.',
      done: false
    })
    const names = async (): Promise<string[]> =>
      ((await manage('saved_list')).result.saved as { name: string }[]).map((x) => x.name).sort()
    expect(await names()).toEqual(['Walls L1', 'Walls L1 (2)'])

    // 6 — delete only asks: the window's own dialog, under the assistant's name. Nothing is
    // deleted by the call; Cancel keeps it; the user's click on Delete is what deletes.
    const dialog = sched.locator('.dlg[role="dialog"]')
    const asked = await manage('delete', { name: 'Walls L1 (2)' })
    expect(asked.result).toMatchObject({ done: false, asked: true, name: 'Walls L1 (2)' })
    expect(asked.result.message).toContain('Nothing is deleted unless the user clicks Delete there')
    await expect(dialog.locator('.dlg-label')).toHaveText('Ask Vee')
    await expect(dialog.locator('.dlg-message')).toHaveText('Delete the saved template “Walls L1 (2)”? This cannot be undone.')
    // It takes no default button (the follow-up of the same day): the dialog itself has the
    // focus, not Delete. The question appears while the user may be typing — the turn that
    // raised it was typed into the chat a moment ago, and this window has just come forward —
    // so a key press already under way must answer nothing: not Enter, and not the space of a
    // sentence.
    await expect(dialog).toBeFocused()
    const focus = await sched.evaluate(() => {
      const a = document.activeElement as HTMLElement
      return {
        on: `${a.tagName.toLowerCase()}.${a.className}`,
        tabindex: a.getAttribute('tabindex'),
        ring: a.matches(':focus-visible'),
        outline: getComputedStyle(a).outlineStyle
      }
    })
    expect(focus).toMatchObject({ on: 'div.dlg', tabindex: '-1' })
    // No ring of its own: only the one the design's `:focus-visible` rule draws, when it does.
    expect(focus.outline).toBe(focus.ring ? 'solid' : 'none')
    for (const key of ['Enter', 'Space', 'Enter', 'Space']) await sched.keyboard.press(key)
    await sched.waitForTimeout(250)
    await expect(dialog).toHaveCount(1)
    await expect(dialog).toBeFocused()
    // While that question is up the window is the user's: it lists, and changes nothing.
    expect(await names()).toEqual(['Walls L1', 'Walls L1 (2)'])
    expect((await manage('undo')).result.message).toMatch(/^The Schedules window has a dialog of its own up/)
    await expect(title).toHaveText('Walls from chat')
    console.log(
      `\n[schedules] the assistant's delete question: focus on ${focus.on} (tabindex ${focus.tabindex}, :focus-visible ${focus.ring}, outline ${focus.outline}); ` +
        `after Enter, Space, Enter, Space the dialog is still up and the saved setups are ${JSON.stringify(await names())}`
    )
    // Tab reaches Cancel first, then Delete, and stays inside the dialog; Escape cancels.
    await sched.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await sched.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Delete' })).toBeFocused()
    await sched.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await sched.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(await names()).toEqual(['Walls L1', 'Walls L1 (2)'])
    // Cancel keeps it too; a real click on Delete is what deletes.
    await manage('delete', { name: 'Walls L1 (2)' })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await names()).toEqual(['Walls L1', 'Walls L1 (2)'])
    await manage('delete', { name: 'Walls L1 (2)' })
    await expect(dialog).toBeFocused()
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(names).toEqual(['Walls L1'])
    console.log(`[schedules] …and after a real click on Delete they are ${JSON.stringify(await names())}`)

    // 7 — print only asks, and in the window's own confirm first — never in the native print
    // dialog, whose default button prints: a stray Enter there would send the schedule to the
    // default printer. Nothing prints for the call, for a key press or for Cancel; the click on
    // Print… is what opens the print dialog (stood in for here).
    await sched.evaluate(() => {
      const w = window as unknown as { __printed: number; print: () => void }
      w.__printed = 0
      w.print = () => {
        w.__printed++
      }
    })
    const printed = (): Promise<number> => sched.evaluate(() => (window as unknown as { __printed: number }).__printed)
    const printAsk = await manage('print')
    expect(printAsk.result).toMatchObject({ done: false, asked: true })
    expect(printAsk.result.dialog).toBeUndefined()
    expect(printAsk.result.message).toContain(
      'is asking whether to open the print dialog for the schedule it shows. The print dialog does not open, and nothing is printed, unless the user clicks Print… there'
    )
    await expect(dialog.locator('.dlg-label')).toHaveText('Ask Vee')
    await expect(dialog.locator('.dlg-message')).toHaveText('Open the print dialog for this schedule?')
    await expect(dialog).toBeFocused()
    for (const key of ['Enter', 'Space']) await sched.keyboard.press(key)
    await sched.waitForTimeout(250)
    await expect(dialog).toHaveCount(1)
    const beforeClick = await printed()
    expect(beforeClick).toBe(0)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await sched.waitForTimeout(250)
    expect(await printed()).toBe(0)
    await manage('print')
    await dialog.getByRole('button', { name: 'Print…' }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(printed).toBe(1)
    console.log(
      `[schedules] print from chat: ${beforeClick} print dialogs after the call, Enter and Space; 0 after Cancel; ${await printed()} after the click on Print…`
    )

    // …and the user's own Delete is what it always was: their click asked for it, so its confirm
    // button has the focus — and the Enter that answered nothing above answers this one.
    await sched.locator('.rail-saved [data-act="delete-saved"][data-name="Walls L1"]').click()
    await expect(dialog.locator('.dlg-label')).toHaveText('Schedules')
    await expect(dialog.getByRole('button', { name: 'Delete' })).toBeFocused()
    expect(await sched.evaluate(() => document.querySelector('.dlg')!.hasAttribute('tabindex'))).toBe(false)
    await sched.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect.poll(names).toEqual([])

    // 8 — open_file only asks: the native Open dialog, attached to the Schedules window. The
    // file the user picks there becomes the schedule; the tool is told nothing of it.
    await stubDialogs(app)
    const file = join(dir, 'picked.schedule.json')
    await writeFile(
      file,
      JSON.stringify({
        version: 1, name: 'From a file', entity: ['IfcSlab'], columns: [{ field: { kind: 'core', key: 'name' } }],
        filters: [], filterLogic: 'and', sort: [], itemize: true, grandTotal: false
      })
    )
    await answerOpen(app, file)
    const picked = await manage('open_file')
    expect(picked.result).toMatchObject({ done: false, asked: true, dialog: true })
    expect(JSON.stringify(picked.result)).not.toMatch(/picked|From a file|[A-Za-z]:[\\/]/)
    await expect(title).toHaveText('From a file')
    await expect(toast).toHaveText('Loaded “From a file”.')
    expect((await dialogs(app)).opens.at(-1)).toMatchObject({ attached: true, properties: ['openFile'] })

    // 9 — the schedule's rows as a set, in the main window: select what it lists.
    await inTurn(app, page, 'make_schedule', { title: 'Walls', category: ['IfcWall'], columns: [{ field: 'Name' }] })
    const sel = await inTurn(app, page, 'select_elements', { schedule: true })
    expect(sel.result).toMatchObject({ target: 'schedule' })
    await expect(page.locator('[data-role="propcard"]')).toContainText('4 selected')
    await expect(sched.locator('tr.data.on')).toHaveCount(4)
  } finally {
    await app.close()
  }
})

const BIG = process.env.SGVUE_IFC ? resolve(ROOT, process.env.SGVUE_IFC) : ''

test('a real model: what the snapshot costs (SGVUE_IFC)', async () => {
  test.skip(!BIG, 'set SGVUE_IFC to a model')
  test.setTimeout(600_000)
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: BIG })
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 480_000 })
    const heapMB = async (p: Page): Promise<number> => {
      const cdp = await p.context().newCDPSession(p)
      await cdp.send('HeapProfiler.collectGarbage')
      const { usedSize } = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }
      await cdp.detach()
      return usedSize / 1048576
    }
    const mainBefore = await heapMB(page)
    const t0 = Date.now()
    const sched = await openSchedules(app, page)
    await expect.poll(() => railItems(sched).count(), { timeout: 120_000 }).toBeGreaterThan(0)
    await expect(sched.locator('tr.data').first()).toBeVisible()
    const openMs = Date.now() - t0
    const t1 = Date.now()
    await sched.locator('tr.data').first().click()
    await expect(page.locator('[data-role="propcard"]')).toBeVisible()
    const clickMs = Date.now() - t1
    const [mainAfter, schedHeap] = [await heapMB(page), await heapMB(sched)]
    const rss = await app.evaluate(({ app: a, BrowserWindow }) => {
      const pid = (s: string) =>
        BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(s))!.webContents.getOSProcessId()
      const ws = (p: number) => a.getAppMetrics().find((m) => m.pid === p)?.memory.workingSetSize ?? 0
      return { main: ws(pid('index.html')) / 1024, sched: ws(pid('schedule.html')) / 1024 }
    })
    // Phase 2: the largest category, drawn. The status line's own number is the engine run; a
    // synchronous click that repaints every pane (an inspector tab) is the whole paint, and the
    // rail's A→Z switch is a 'panes' repaint, which leaves the table alone.
    const largest = railItems(sched).first()
    const largestName = ((await largest.locator('.grow').textContent()) ?? '').trim()
    if (!/\bon\b/.test((await largest.getAttribute('class')) ?? '')) await largest.click()
    await expect(largest).toHaveClass(/\bon\b/)
    const engineMs = ((await sched.locator('.status').textContent()) ?? '').match(/Rendered in (\d+) ms/)?.[1]
    const timed = (selector: string) => sched.evaluate((sel) => {
      const t = performance.now()
      document.querySelector<HTMLElement>(sel)!.click()
      return performance.now() - t
    }, selector)
    const paints: number[] = []
    const panes: number[] = []
    for (const id of ['filter', 'sort', 'fields', 'filter']) {
      paints.push(await timed(`.tab[data-section="${id}"]`))
      panes.push(await timed('[data-act="rail-sort"]'))
    }
    const dataRows = await sched.locator('tr.data').count()
    console.log(
      `\n[schedules] largest category ${largestName}: ${dataRows} rows drawn · engine ${engineMs} ms · ` +
        `full repaint ${paints.map((m) => m.toFixed(0)).join(' / ')} ms · ` +
        `panes-only repaint ${panes.map((m) => m.toFixed(0)).join(' / ')} ms`
    )
    // Phase 3: a click in the main window's tree → the row marked in this window, clock to
    // clock (both pages stamp `timeOrigin + now` on the one system clock); then a colour-by on
    // the largest category's Type column → the main legend, and → the swatches drawn here.
    await sched.evaluate(() => {
      const w = window as unknown as Record<string, number>
      w.__on = 0
      w.__sw = 0
      w.__clk = 0
      const stamp = (): number => performance.timeOrigin + performance.now()
      new MutationObserver(() => {
        if (!w.__on && document.querySelector('tr.data.on')) w.__on = stamp()
        if (!w.__sw && document.querySelector('td .sw')) w.__sw = stamp()
      }).observe(document.getElementById('output-pane')!, { attributes: true, childList: true, subtree: true })
      addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.ctx-menu')) w.__clk = stamp()
      }, true)
    })
    await page.evaluate(() => {
      const w = window as unknown as Record<string, number>
      w.__pick = 0
      w.__legend = 0
      const stamp = (): number => performance.timeOrigin + performance.now()
      addEventListener('click', (e) => {
        if (!w.__pick && (e.target as HTMLElement).closest('[role="treeitem"][aria-level="2"]')) w.__pick = stamp()
      }, true)
      new MutationObserver(() => {
        if (!w.__legend && document.querySelector('button[title="Clear colour scheme"]')) w.__legend = stamp()
      }).observe(document.body, { childList: true, subtree: true })
    })
    // No mark on screen, so the one the timer waits for is the new one.
    await sched.evaluate(() => document.querySelectorAll('tr.data.on').forEach((tr) => tr.classList.remove('on')))
    // The main window in front, as it is when someone clicks in it.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))!.focus()
    )
    // The group's own rows (it is windowed at this size, so only the first few exist).
    const group = page
      .locator('aside [role="none"]')
      .filter({ has: page.locator('[aria-level="1"]').getByText(largestName, { exact: true }) })
    const header = group.locator('[aria-level="1"]')
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
    await group.locator('[role="treeitem"][aria-level="2"]').nth(3).click()
    await expect(sched.locator('tr.data.on')).toHaveCount(1, { timeout: 30_000 })
    const pick = await page.evaluate(() => (window as unknown as Record<string, number>).__pick)
    const markedAt = await sched.evaluate(() => (window as unknown as Record<string, number>).__on)
    const typeHead = sched.locator('table.schedule thead th[data-defcol]', { hasText: /^Type$/ }).first()
    await typeHead.click({ button: 'right' })
    await sched
      .locator('.ctx-menu')
      .getByRole('menuitem', { name: 'Colour 3D by this column', exact: true })
      .click()
    await expect(page.locator('button[title="Clear colour scheme"]')).toBeVisible({ timeout: 30_000 })
    await expect(sched.locator('td .sw').first()).toBeAttached({ timeout: 30_000 })
    const [clk, sw] = await sched.evaluate(() => {
      const w = window as unknown as Record<string, number>
      return [w.__clk, w.__sw]
    })
    const legendAt = await page.evaluate(() => (window as unknown as Record<string, number>).__legend)
    const values = await page.locator('button[data-tip="Select these elements"]').count()
    console.log(
      `\n[schedules] phase 3 on ${largestName} (${dataRows} rows): tree click → row marked ` +
        `${(markedAt - pick).toFixed(0)} ms · colour-by on Type (${values} values) → legend ` +
        `${(legendAt - clk).toFixed(0)} ms, → swatches drawn ${(sw - clk).toFixed(0)} ms`
    )
    // Phase 4: the largest category to Excel and to CSV — click → saved, the file's size, and
    // the Schedules renderer's JS heap sampled every ~25 ms while it runs (a sample waits for a
    // long synchronous task to end, so the peak is a floor, not a ceiling).
    await stubDialogs(app)
    const exported: string[] = []
    for (const [label, ext, done] of [
      ['Excel (.xlsx)', 'xlsx', /^Exported [\d,]+ rows to Excel\.$/],
      ['CSV', 'csv', /^Exported [\d,]+ rows to CSV\.$/]
    ] as const) {
      const to = join(dir, `largest.${ext}`)
      await answerSave(app, to)
      const base = await heapMB(sched)
      const cdp = await sched.context().newCDPSession(sched)
      let peak = 0
      let sampling = true
      const sampler = (async () => {
        while (sampling) {
          const { usedSize } = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }
          peak = Math.max(peak, usedSize / 1048576)
          await new Promise((r) => setTimeout(r, 25))
        }
      })()
      await act(sched, 'export-menu').click()
      const t = Date.now()
      await menuItem(sched, label).click()
      await expect(sched.locator('.toast')).toHaveText(done, { timeout: 180_000 })
      const ms = Date.now() - t
      sampling = false
      await sampler
      await cdp.detach()
      const bytes = (await stat(to)).size
      exported.push(
        `${ext.toUpperCase()} ${ms} ms, ${(bytes / 1048576).toFixed(2)} MB (${bytes} bytes), ` +
          `heap ${base.toFixed(0)} → peak ${peak.toFixed(0)} MB`
      )
    }
    console.log(`\n[schedules] phase 4 export of ${largestName} (${dataRows} rows): ${exported.join(' · ')}`)
    // 2026-09-28: the assistant's store. No chat turn builds it — the view state is the window's
    // own report — so the first get_schedule pays for it, once per federation; the second reads
    // the held one.
    const heapBeforeStore = await heapMB(page)
    const tFirst = Date.now()
    const firstRead = await tool(app, 'get_schedule', { limit: 1 })
    const firstMs = Date.now() - tFirst
    const tAgain = Date.now()
    await tool(app, 'get_schedule', { limit: 1 })
    const againMs = Date.now() - tAgain
    expect(firstRead.ok).toBe(true)
    console.log(
      `\n[schedules] assistant store: first get_schedule (builds it) ${firstMs} ms · again ${againMs} ms · ` +
        `main renderer JS heap ${heapBeforeStore.toFixed(0)} → ${(await heapMB(page)).toFixed(0)} MB ` +
        `(${firstRead.result?.rowCount} rows in the open schedule)`
    )
    const rows = await railItems(sched).evaluateAll((els) =>
      els.reduce((n, e) => n + Number((e.querySelector('.n')?.textContent ?? '0').replace(/\D/g, '')), 0)
    )
    console.log(
      `\n[schedules] ${rows} rows · button → first table ${openMs} ms · row click → property card ${clickMs} ms\n` +
        `[schedules] main renderer JS heap ${mainBefore.toFixed(0)} → ${mainAfter.toFixed(0)} MB · ` +
        `Schedules renderer JS heap ${schedHeap.toFixed(0)} MB · working set main ${rss.main.toFixed(0)} MB, ` +
        `Schedules ${rss.sched.toFixed(0)} MB`
    )
  } finally {
    await app.close()
  }
})
