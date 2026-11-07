/**
 * The `.sgvue` project file, end to end (2026-11-07, plan phase 2): open two models, colour one,
 * hide a storey, File › Save Project, quit, launch again, File › Open Project… — everything is
 * back. And the title: `<name> — SGVue`, with ` •` while there are unsaved changes, and ⌘S
 * writing the same file again with no dialog.
 *
 * **Not run by the builder** — every Electron start needs the owner's yes. Run it only through
 * `npm run test:e2e` (`scripts/safe-e2e.cjs`), the guarded wrapper.
 *
 * The two native dialogs are answered from the environment in a development build, as the IFC
 * Open dialog is (`SGVUE_OPEN_PATHS`): `SGVUE_SAVE_PROJECT_PATH` for Save Project As… and
 * `SGVUE_OPEN_PROJECT_PATH` for Open Project… (`src/main/projects.ts`; a packaged build has
 * neither). The menu items are clicked by their ids, as a person's click runs the same handler.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DROP_COPY, HIGH_FIRST, launch, statusText, TINY } from './helpers'

let dir = ''

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-e2e-project-'))
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Click a File menu item by its id, as the menu does. */
const menu = (app: ElectronApplication, id: string): Promise<void> =>
  app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) throw new Error(`no menu item ${itemId}`)
    item.click()
  }, id)

/** The main window's own title — the OS's, not the page's `<title>`. */
const windowTitle = async (app: ElectronApplication, page: Page): Promise<string> =>
  (await app.browserWindow(page)).evaluate((w) => w.getTitle())

/** The status bar's `visible / total`, without the live frame rate beside it. */
const shownOf = async (page: Page): Promise<string> => /\d+ \/ \d+/.exec(await statusText(page))?.[0] ?? ''

/** The MODELS row swatch of a file, as `rgb(…)`. */
const swatchOf = (page: Page, file: string): Promise<string> =>
  page
    .locator('aside div.hv-step', { hasText: file })
    .locator('button[title="Override this model\'s colour"]')
    .evaluate((e) => getComputedStyle(e).backgroundColor)

test('Save Project, quit, Open Project: the models, a colour and a hidden storey are back', async () => {
  const project = join(dir, 'review.sgvue')
  let status = ''
  let colour = ''

  // ── first run: two models, one coloured, a storey hidden, saved as a project ──
  {
    const { app, page } = await launch(join(dir, 'profile'), {
      SGVUE_OPEN_PATHS: `${TINY}:::${HIGH_FIRST}`,
      SGVUE_SAVE_PROJECT_PATH: project
    })
    try {
      await page.getByText(DROP_COPY).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await expect(page.locator('aside div.hv-step', { hasText: 'high-first.ifc' })).toBeVisible()

      // A colour of the user's own on the first model's row.
      const row = page.locator('aside div.hv-step', { hasText: 'tiny.ifc' })
      await row.locator('button[title="Override this model\'s colour"]').click()
      await page.locator('aside button[title^="#"]').last().click()
      colour = await swatchOf(page, 'tiny.ifc')

      // A storey hidden, through its row.
      const shown = await shownOf(page)
      await page.locator('button[title="Show / hide storey"]').nth(1).click()
      await expect.poll(() => shownOf(page), { timeout: 20_000 }).not.toBe(shown)

      // No project yet: the title is the app's own.
      expect(await windowTitle(app, page)).toBe('SGVue')
      await menu(app, 'project-save')
      await expect.poll(() => stat(project).then(() => true, () => false), { timeout: 20_000 }).toBe(true)
      await expect.poll(() => windowTitle(app, page)).toBe('review — SGVue')
      const file = JSON.parse(await readFile(project, 'utf8')) as { format: string; models: { name: string }[] }
      expect(file.format).toBe('sgvue-project')
      expect(file.models.map((m) => m.name).sort()).toEqual(['high-first.ifc', 'tiny.ifc'])

      // A change marks it unsaved; undoing it by hand clears the mark — dirty is by value.
      const eye = page.locator('button[title="Show / hide storey"]').nth(0)
      await eye.click()
      await expect.poll(() => windowTitle(app, page), { timeout: 10_000 }).toBe('review • — SGVue')
      await eye.click()
      await expect.poll(() => windowTitle(app, page), { timeout: 10_000 }).toBe('review — SGVue')
      // Changed again, Save Project writes the same file — the open project, no dialog — and the
      // mark goes.
      const before = (await stat(project)).mtimeMs
      await eye.click()
      await expect.poll(() => windowTitle(app, page), { timeout: 10_000 }).toBe('review • — SGVue')
      status = await shownOf(page)
      await menu(app, 'project-save')
      await expect.poll(() => windowTitle(app, page), { timeout: 10_000 }).toBe('review — SGVue')
      expect((await stat(project)).mtimeMs).toBeGreaterThan(before)
    } finally {
      await app.close()
    }
  }

  // ── second run: a fresh profile and nothing open; File › Open Project… brings it all back ──
  {
    const { app, page } = await launch(join(dir, 'profile-2'), { SGVUE_OPEN_PROJECT_PATH: project })
    try {
      await expect(page.locator('[data-role="landing"]')).toBeVisible()
      await menu(app, 'project-open')
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await expect(page.locator('aside div.hv-step', { hasText: 'high-first.ifc' })).toBeVisible()
      await expect.poll(() => shownOf(page), { timeout: 20_000 }).toBe(status)
      await expect.poll(() => swatchOf(page, 'tiny.ifc')).toBe(colour)
      await expect.poll(() => windowTitle(app, page)).toBe('review — SGVue')
    } finally {
      await app.close()
    }
  }
})
