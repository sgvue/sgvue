/**
 * Positions, in the real app (2026-11-11) — the windowed half of the two fixes of that date
 * (`docs/DECISIONS.md`); the headless half is `tests/unit/project-reopen-positions.test.ts` and
 * `tests/unit/selection-dims-plan-frame.test.ts`.
 *
 *   1. **A reopened project keeps its models in place.** Three synthetic models on the synthetic
 *      site, tens of metres apart, are opened one at a time — the way that always worked — and
 *      saved as a `.sgvue`. The project is opened in a fresh run, and the three files are also
 *      opened together from the Open dialog. Each time, every element must be drawn where its own
 *      file puts it (the viewer's box plus the viewer's offset against the index's own box, 1 mm),
 *      where it was drawn before the save (1 mm), and — for three named boxes — where the file's
 *      own numbers put it, worked out here.
 *   2. **The selection dimension fits a turned building.** A wall 6.000 × 0.200 × 3.000 m, square
 *      with a site turned −43.41°: the three labels on its box and the property card's Bounding
 *      box read those numbers, not the world-axis box round it (about 4.5 × 4.3 m).
 *
 * The first model is made of several thousand boxes so that its parse outlasts the upload queue's
 * 500 ms stagger — the condition under which two models used to choose an offset each.
 *
 * **It reads `window.__sgvueDev`, so it needs a development-tools build, and skips with a notice
 * on the production bundle the rest of this suite runs:**
 *
 *   VITE_SGVUE_DEVTOOLS=1 npm run build
 *   npm run test:e2e -- tests/e2e/project-positions.spec.ts
 *
 * Only ever through `npm run test:e2e` (`scripts/safe-e2e.cjs`), the guarded wrapper, and only on
 * the owner's yes. `SGVUE_SHOTS=<folder>` keeps a screenshot of each state. Every coordinate here
 * is the synthetic site's (`tests/unit/synthetic-boxes.ts`).
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boxCorners, boxModel, type BoxSpec, type ModelSpec } from '../unit/synthetic-boxes'
import { DROP_COPY, launch } from './helpers'

/** 1 mm, in metres. */
const TOL = 1e-3
/** How many filler boxes make the first model's parse outlast the queue's stagger. */
const FILLER = Number(process.env.SGVUE_POS_BOXES || 40000)
const SHOTS = process.env.SGVUE_SHOTS || ''

const WALL: BoxSpec = { name: 'ARC wall 1', at: [1000, 2000, 0], size: [6000, 200, 3000] }
const SLAB: BoxSpec = { name: 'STR slab', at: [40000, -15000, 3000], size: [3000, 3000, 300] }
const DUCT: BoxSpec = { name: 'MEP duct', at: [20000, 25000, 6000], size: [5000, 600, 400] }

const filler = (): BoxSpec[] =>
  Array.from({ length: FILLER }, (_, i) => ({
    name: `ARC block ${i}`,
    at: [1000 + (i % 40) * 500, 4000 + Math.floor(i / 40) * 500, 0] as const,
    size: [300, 300, 300 + (i % 7) * 100] as const
  }))

const SPECS: Record<string, ModelSpec> = {
  ARC: { name: 'ARC', guidPrefix: '1', boxes: [WALL, ...filler()] },
  STR: {
    name: 'STR',
    guidPrefix: '2',
    boxes: [SLAB, { name: 'STR column', at: [44000, -15000, 3000], size: [400, 400, 3000] }]
  },
  MEP: {
    name: 'MEP',
    guidPrefix: '3',
    boxes: [DUCT, { name: 'MEP riser', at: [26000, 25000, 0], size: [500, 500, 6000] }]
  }
}
const KEYS = ['ARC', 'STR', 'MEP'] as const
const NAMED: Record<string, BoxSpec> = { ARC: WALL, STR: SLAB, MEP: DUCT }

let dir = ''
const fileOf = (key: string): string => join(dir, 'models', `${key}.ifc`)

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-e2e-positions-'))
  await mkdir(join(dir, 'models'))
  for (const key of KEYS) await writeFile(fileOf(key), boxModel(SPECS[key]))
  if (SHOTS) await mkdir(SHOTS, { recursive: true })
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const menu = (app: ElectronApplication, id: string): Promise<void> =>
  app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) throw new Error(`no menu item ${itemId}`)
    item.click()
  }, id)

/** What the next native Open dialog answers, in a development build (`src/main/index.ts`). */
const answerOpenWith = (app: ElectronApplication, paths: string): Promise<void> =>
  app.evaluate((_electron, p) => {
    process.env.SGVUE_OPEN_PATHS = p
  }, paths)

const hasHarness = (page: Page): Promise<boolean> =>
  page.evaluate(() => typeof (window as unknown as { __sgvueDev?: unknown }).__sgvueDev === 'object')

interface Row {
  model: string
  guid: string
  name: string
  /** The viewer's box plus the viewer's offset: where the element is drawn, world metres. */
  drawn: number[]
  /** The index's own box, from the element's own stream and that stream's offset. */
  file: number[]
}
interface Readout {
  loaded: string[]
  offset: number[]
  planRotationDeg: number
  rows: Row[]
}

/** Every element with geometry: where it is drawn, and where its own file's stream put it. */
const read = (page: Page): Promise<Readout> =>
  page.evaluate(() => {
    const dev = (
      window as unknown as {
        __sgvueDev: {
          federation(): {
            models: { meta: { modelKey: string } }[]
            elements: { id: number; model: string; guid: string; name: string; bbox?: number[] }[]
          }
          debug(): { offset: number[]; planRotationDeg: number }
          elementBox(id: number): number[] | null
        }
      }
    ).__sgvueDev
    const fed = dev.federation()
    const dbg = dev.debug()
    const rows: { model: string; guid: string; name: string; drawn: number[]; file: number[] }[] = []
    for (const e of fed.elements) {
      const b = dev.elementBox(e.id)
      if (!b || !e.bbox) continue
      rows.push({
        model: e.model,
        guid: e.guid,
        name: e.name,
        drawn: b.map((v, k) => v + dbg.offset[k % 3]),
        file: [...e.bbox]
      })
    }
    return {
      loaded: fed.models.map((m) => m.meta.modelKey),
      offset: [...dbg.offset],
      planRotationDeg: dbg.planRotationDeg,
      rows
    }
  })

/** Wait until exactly these models are on screen and no upload row is left. */
async function loaded(page: Page, keys: readonly string[]): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const dev = (
            window as unknown as {
              __sgvueDev: {
                federation(): { models: { meta: { modelKey: string } }[] }
                uploads(): unknown[]
                booted(): boolean
              }
            }
          ).__sgvueDev
          const models = dev.federation().models.map((m) => m.meta.modelKey).sort()
          return `${dev.booted()}|${dev.uploads().length}|${models.join(',')}`
        }),
      { timeout: 150_000 }
    )
    .toBe(`true|0|${[...keys].sort().join(',')}`)
  // The reveal's fade and the boot's ease-in, so a screenshot is of the settled view.
  await page.waitForTimeout(1500)
}

const worst = (a: readonly number[], b: readonly number[]): number =>
  Math.max(...a.map((v, k) => Math.abs(v - b[k])))

/** The world-axis box of a box's eight file corners, as `[x0, y0, z0, x1, y1, z1]`, metres. */
function fileBox(b: BoxSpec): number[] {
  const c = boxCorners(b)
  return [0, 1, 2].map((k) => Math.min(...c.map((p) => p[k]))).concat([0, 1, 2].map((k) => Math.max(...c.map((p) => p[k]))))
}

/** Every element where its own file puts it, and the three named boxes where the numbers say. */
function expectInPlace(what: string, r: Readout): void {
  expect(r.loaded.slice().sort(), what).toEqual([...KEYS].sort())
  const off = r.rows
    .map((row) => ({ row, d: worst(row.drawn, row.file) }))
    .filter((x) => x.d > TOL)
    .sort((a, b) => b.d - a.d)
  expect(
    off.slice(0, 5).map((x) => `${x.row.model} ${x.row.name}: drawn ${(x.d * 1000).toFixed(1)} mm from where its file puts it`),
    `${what}: ${off.length} of ${r.rows.length} elements out of place`
  ).toEqual([])
  for (const key of KEYS) {
    const row = r.rows.find((x) => x.model === key && x.name === NAMED[key].name)
    expect(row, `${what}: ${NAMED[key].name} is drawn`).toBeTruthy()
    expect(worst(row!.drawn, fileBox(NAMED[key])), `${what}: ${NAMED[key].name} against the file's own numbers`).toBeLessThan(TOL)
  }
}

/** The same elements, drawn where they were drawn before. */
function expectUnmoved(what: string, before: Readout, after: Readout): void {
  const was = new Map(before.rows.map((x) => [x.guid, x]))
  expect(after.rows.length, `${what}: the same elements`).toBe(before.rows.length)
  const moved = after.rows
    .map((row) => ({ row, d: was.has(row.guid) ? worst(row.drawn, was.get(row.guid)!.drawn) : Infinity }))
    .filter((x) => x.d > TOL)
    .sort((a, b) => b.d - a.d)
  expect(
    moved.slice(0, 5).map((x) => `${x.row.model} ${x.row.name}: ${(x.d * 1000).toFixed(1)} mm from where it was`),
    `${what}: ${moved.length} elements moved`
  ).toEqual([])
}

/** With `SGVUE_POS_LOG=1`, the app's own `[sgvue]` console lines — how long each parse took. */
const listen = (page: Page, run: string): void => {
  if (!process.env.SGVUE_POS_LOG) return
  page.on('console', (m) => {
    const t = m.text()
    if (t.includes('[sgvue]') && / parsed in /.test(t)) console.log(`[${run}] ${t.replace(/ · sha-256.*$/, '')}`)
  })
}

const shot = async (page: Page, name: string): Promise<void> => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

test('a project of three models reopens with every element where it was', async () => {
  test.setTimeout(480_000)
  const project = join(dir, 'review.sgvue')
  let before: Readout | null = null

  // ── one at a time, the way that always worked; saved as a project ──
  {
    const { app, page } = await launch(join(dir, 'profile-1'), {
      SGVUE_OPEN_PATHS: fileOf('ARC'),
      SGVUE_SAVE_PROJECT_PATH: project
    })
    try {
      await expect(page.getByText(DROP_COPY)).toBeVisible()
      if (!(await hasHarness(page))) {
        test.skip(true, 'needs a development-tools build: VITE_SGVUE_DEVTOOLS=1 npm run build')
      }
      await page.getByText(DROP_COPY).click()
      await loaded(page, ['ARC'])
      for (const key of ['STR', 'MEP']) {
        await answerOpenWith(app, fileOf(key))
        await page.locator('aside label[data-tip^="Upload an IFC file"]').click()
        await loaded(page, KEYS.slice(0, KEYS.indexOf(key as (typeof KEYS)[number]) + 1))
      }
      before = await read(page)
      expectInPlace('opened one at a time', before)
      await shot(page, '1-opened-one-at-a-time')
      await menu(app, 'project-save')
      await expect.poll(() => stat(project).then(() => true, () => false), { timeout: 20_000 }).toBe(true)
    } finally {
      await app.close()
    }
  }

  // ── the project, opened in a fresh run: every model queued together ──
  {
    const { app, page } = await launch(join(dir, 'profile-2'), { SGVUE_OPEN_PROJECT_PATH: project })
    try {
      listen(page, 'project')
      await expect(page.getByText(DROP_COPY)).toBeVisible()
      await menu(app, 'project-open')
      await loaded(page, KEYS)
      const after = await read(page)
      await shot(page, '2-project-reopened')
      expectInPlace('the reopened project', after)
      expectUnmoved('the reopened project', before, after)
    } finally {
      await app.close()
    }
  }

  // ── the three files picked together in the Open dialog ──
  {
    const { app, page } = await launch(join(dir, 'profile-3'), {
      SGVUE_OPEN_PATHS: KEYS.map(fileOf).join(':::')
    })
    try {
      listen(page, 'together')
      await page.getByText(DROP_COPY).click()
      await loaded(page, KEYS)
      const after = await read(page)
      await shot(page, '3-opened-together')
      expectInPlace('opened together', after)
      expectUnmoved('opened together', before, after)
    } finally {
      await app.close()
    }
  }
})

test('the selection dimension and the property card read a turned wall’s own size', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launch(join(dir, 'profile-dims'), { SGVUE_OPEN_PATHS: fileOf('ARC') })
  try {
    await expect(page.getByText(DROP_COPY)).toBeVisible()
    if (!(await hasHarness(page))) {
      test.skip(true, 'needs a development-tools build: VITE_SGVUE_DEVTOOLS=1 npm run build')
    }
    await page.getByText(DROP_COPY).click()
    await loaded(page, ['ARC'])
    const r = await read(page)
    // The building is turned in its file's coordinates, and the plan frame has followed it.
    expect(Math.abs(r.planRotationDeg), 'the plan rotation').toBeGreaterThan(40)
    const wall = r.rows.find((x) => x.name === WALL.name)!
    // What the world-axis box would have said: nowhere near the wall's own 6.000 × 0.200 m.
    expect(wall.file[3] - wall.file[0], 'the world-axis box is not the wall’s size').toBeGreaterThan(4)
    expect(wall.file[4] - wall.file[1]).toBeGreaterThan(4)

    await page.evaluate((name) => {
      const dev = (
        window as unknown as {
          __sgvueDev: {
            federation(): { elements: { id: number; name: string }[] }
            select(ids: number[]): void
            zoomTo(id: number): void
          }
        }
      ).__sgvueDev
      const id = dev.federation().elements.find((e) => e.name === name)!.id
      dev.select([id])
      dev.zoomTo(id)
    }, WALL.name)
    await page.locator('button[title^="Show dimensions of the selection"]').click()
    await page.waitForTimeout(1500)

    const digits = (s: string): string => s.replace(/[^\d.a-z]/gi, '')
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('[data-role="overlay"] div')].map((e) => (e.textContent || '').trim()).filter(Boolean)
    )
    const dimLabels = labels.map(digits).filter((t) => /^\d+mm$/.test(t))
    expect(dimLabels.slice().sort(), `the labels on the box (all overlay labels: ${labels.join(' | ')})`).toEqual(
      ['200mm', '3000mm', '6000mm'].sort()
    )

    // The Geometry section's rows; the section is opened first when it is folded.
    const boundingRow = (): Promise<string> =>
      page.evaluate(() => {
        const key = [...document.querySelectorAll('span')].find((e) => (e.textContent || '').trim() === 'Bounding box')
        return (key?.nextElementSibling?.textContent || '').trim()
      })
    if (!(await boundingRow())) await page.getByText('Geometry', { exact: true }).click()
    await expect.poll(boundingRow, { timeout: 10_000 }).not.toBe('')
    const bounding = await boundingRow()
    expect(
      (bounding.match(/\d[\d\s  ]*/g) || []).map((n) => Number(n.replace(/[^\d]/g, ''))),
      `the property card's Bounding box row: "${bounding}"`
    ).toEqual([6000, 200, 3000])
    await shot(page, '4-dim-3d')

    // Plan: the box and its runs square with the screen, as the building is.
    await page.evaluate(() =>
      (window as unknown as { __sgvueDev: { setView(v: string): void } }).__sgvueDev.setView('top')
    )
    await page.waitForTimeout(2000)
    await shot(page, '5-dim-plan')
  } finally {
    await app.close()
  }
})
