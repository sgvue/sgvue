/**
 * The `.sgvue` project file, end to end (2026-11-07, plan phase 2): open two models, colour one,
 * hide a storey, File › Save Project, quit, launch again, File › Open Project… — everything is
 * back. And the title: `<name> — SGVue`, with ` •` while there are unsaved changes, and ⌘S
 * writing the same file again with no dialog.
 *
 * **Not run by the builder** — every Electron start needs the owner's yes. Run it only through
 * `npm run test:e2e` (`scripts/safe-e2e.cjs`), the guarded wrapper.
 *
 * 2026-11-07 (phase 3): a saved viewpoint and a spot coordinate come back too — the viewpoint in
 * the project's own list, the spot placed again through the viewer's own commit.
 *
 * 2026-11-08 (phase 4, D4): a project whose model was moved opens with that model's designed row
 * offering `Locate…`; the file picked there joins the open project as that model, the title marks
 * the project unsaved, and Save Project writes the model's new path under the same id.
 *
 * The native dialogs are answered from the environment in a development build, as the IFC
 * Open dialog is (`SGVUE_OPEN_PATHS`): `SGVUE_SAVE_PROJECT_PATH` for Save Project As…,
 * `SGVUE_OPEN_PROJECT_PATH` for Open Project… and `SGVUE_LOCATE_MODEL_PATH` for Locate…
 * (`src/main/projects.ts`; a packaged build has none of them). The menu items are clicked by
 * their ids, as a person's click runs the same handler.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { actionText, DROP_COPY, HIGH_FIRST, launch, statusText, TINY } from './helpers'

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

/** A click on the canvas the way a hand does it: the pointer arrives, then clicks. */
async function clickAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x - 10, y)
  await page.mouse.move(x, y)
  await page.mouse.click(x, y)
}

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

      // Phase 3: a saved viewpoint, and a spot coordinate on the model.
      await page.locator('button[data-tip="Saved viewpoints"]').click()
      await page.getByRole('button', { name: 'Save current view' }).click()
      await expect(page.getByText('Viewpoint 1', { exact: true })).toBeVisible()
      await page.locator('button[data-tip="Saved viewpoints"]').click()
      const vp = (await page.locator('[data-role="viewport"]').boundingBox())!
      await page.locator('button[data-tip="Spot coordinate (C)"]').click()
      await clickAt(page, vp.x + vp.width / 2, vp.y + vp.height / 2)
      await expect.poll(() => actionText(page)).toContain('1 spots')
      await page.locator('button[data-tip^="Select (Esc)"]').click()

      // No project yet: the title is the app's own.
      expect(await windowTitle(app, page)).toBe('SGVue')
      await menu(app, 'project-save')
      await expect.poll(() => stat(project).then(() => true, () => false), { timeout: 20_000 }).toBe(true)
      await expect.poll(() => windowTitle(app, page)).toBe('review — SGVue')
      const file = JSON.parse(await readFile(project, 'utf8')) as {
        format: string
        models: { name: string }[]
        viewpoints: { name: string }[]
        markups: { spots: unknown[] }
      }
      expect(file.format).toBe('sgvue-project')
      expect(file.models.map((m) => m.name).sort()).toEqual(['high-first.ifc', 'tiny.ifc'])
      expect(file.viewpoints.map((v) => v.name)).toEqual(['Viewpoint 1'])
      expect(file.markups.spots).toHaveLength(1)

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
      // Phase 3: the spot is placed again, and the viewpoint is in the project's list — a fresh
      // profile's own list is empty, so it can only have come from the project.
      await expect.poll(() => actionText(page), { timeout: 20_000 }).toContain('1 spots')
      await page.locator('button[data-tip="Saved viewpoints"]').click()
      await expect(page.getByText('Viewpoint 1', { exact: true })).toBeVisible()
      await page.locator('button[data-tip="Saved viewpoints"]').click()
      await expect.poll(() => windowTitle(app, page)).toBe('review — SGVue')
    } finally {
      await app.close()
    }
  }
})

test('a moved model: its row offers Locate…, and the file picked there joins the open project as that model', async () => {
  const project = join(dir, 'moved.sgvue')
  const models = join(dir, 'models')
  const elsewhere = join(dir, 'elsewhere')
  await mkdir(models)
  await mkdir(elsewhere)
  const tiny = join(models, 'tiny.ifc')
  const high = join(models, 'high-first.ifc')
  await copyFile(TINY, tiny)
  await copyFile(HIGH_FIRST, high)
  const moved = join(elsewhere, 'high-first.ifc')
  type Saved = { models: { id: string; name: string; absPath: string }[] }

  // ── first run: two models, saved as a project ──
  let ids: Saved['models'] = []
  {
    const { app, page } = await launch(join(dir, 'profile'), {
      SGVUE_OPEN_PATHS: `${tiny}:::${high}`,
      SGVUE_SAVE_PROJECT_PATH: project
    })
    try {
      await page.getByText(DROP_COPY).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await expect(page.locator('aside div.hv-step', { hasText: 'high-first.ifc' })).toBeVisible()
      await menu(app, 'project-save')
      await expect.poll(() => stat(project).then(() => true, () => false), { timeout: 20_000 }).toBe(true)
      ids = (JSON.parse(await readFile(project, 'utf8')) as Saved).models
      expect(ids.map((m) => m.name).sort()).toEqual(['high-first.ifc', 'tiny.ifc'])
    } finally {
      await app.close()
    }
  }

  // The folder moved: high-first.ifc is no longer where the project says it is.
  await rename(high, moved)
  const highId = ids.find((m) => m.name === 'high-first.ifc')!.id

  // ── second run: open the project, locate the moved model, save ──
  {
    const { app, page } = await launch(join(dir, 'profile-2'), {
      SGVUE_OPEN_PROJECT_PATH: project,
      SGVUE_LOCATE_MODEL_PATH: moved
    })
    try {
      await menu(app, 'project-open')
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await expect(page.locator('aside div.hv-step', { hasText: 'tiny.ifc' })).toBeVisible()
      await expect(page.getByText('not found where the project says it is')).toBeVisible()
      await expect.poll(() => windowTitle(app, page)).toBe('moved — SGVue')

      await page.getByRole('button', { name: 'Locate…' }).click()
      await expect(page.locator('aside div.hv-step', { hasText: 'high-first.ifc' })).toBeVisible({ timeout: 60_000 })
      await expect(page.getByRole('button', { name: 'Locate…' })).toHaveCount(0)
      await expect(page.getByText('not found where the project says it is')).toHaveCount(0)
      // The file on disk still names the old path: unsaved.
      await expect.poll(() => windowTitle(app, page), { timeout: 10_000 }).toBe('moved • — SGVue')

      await menu(app, 'project-save')
      await expect.poll(() => windowTitle(app, page), { timeout: 10_000 }).toBe('moved — SGVue')
      const saved = (JSON.parse(await readFile(project, 'utf8')) as Saved).models
      expect(saved).toHaveLength(2)
      const high2 = saved.find((m) => m.id === highId)!
      expect(high2.name).toBe('high-first.ifc')
      // `admit()` gives the real path (on macOS the temporary folder is a link into /private).
      expect(high2.absPath).toBe(await realpath(moved))
    } finally {
      await app.close()
    }
  }
})
