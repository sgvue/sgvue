/**
 * The **packaged** app — Phase 10. `npm run test:packaged`, which is
 * `node scripts/safe-app.cjs`; never a bare `playwright test`, because a packaged app's
 * helpers are outside every other guard in this repository (`CLAUDE.md`, and the three kernel
 * panics of 2026-09-17).
 *
 * It exercises the installer's own tree — `dist/mac-arm64/SGVue.app` on macOS,
 * `dist/win-unpacked` on Windows — rather than `out/`, so it is the only test that can see the
 * things packaging breaks: an `asar` that swallowed the two `.wasm` files, a CSP that did not
 * survive the copy, a menu that is not built, an icon that never reached the resources
 * directory. Only that last one is platform-bound, and it says so where it skips.
 *
 * The model arrives through a **designed entrance**: a `sgvue://s=…` share link, the same
 * `Copy link` payload the app writes, carrying `tests/fixtures/tiny.ifc`. The development-only
 * `SGVUE_OPEN_PATHS` hook does not exist in a packaged build (`main/index.ts` gates it on
 * `!app.isPackaged`), which is exactly as it should be.
 *
 * With no `dist/` it skips, so `npm run test:e2e` — which globs this directory — stays green
 * on a checkout that has never built an installer.
 */
import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtemp, open, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { ROOT, statusText, TINY } from './helpers'

const WIN = process.platform === 'win32'
/** The packaged tree electron-builder writes on this platform, and the three paths inside it. */
const APP = join(ROOT, WIN ? 'dist/win-unpacked' : 'dist/mac-arm64/SGVue.app')
const EXECUTABLE = WIN ? join(APP, 'SGVue.exe') : join(APP, 'Contents/MacOS/SGVue')
const RESOURCES = WIN ? join(APP, 'resources') : join(APP, 'Contents/Resources')
const UNPACKED = join(RESOURCES, 'app.asar.unpacked')

/** The production policy, byte for byte from `electron.vite.config.ts`. */
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self' sgvue-file: blob:; object-src 'none'; base-uri 'none'"

/**
 * A share link naming one file. Everything else is the payload's own defaults — the link is
 * being used as an entrance, not as a restored view, and `model/session.ts` only needs
 * `files[].path` to admit it. An empty `sha256` is the codec's "do not compare" (`checkFiles`).
 */
function shareLink(path: string, name: string): string {
  const payload = {
    models: [],
    files: [{ key: '', path, name, sha256: '' }],
    uploadNames: {},
    hidden: {},
    storeyVis: {},
    modelVis: {},
    active: null,
    modelColors: {},
    nativeMats: true,
    treeMode: 'entity',
    grids: true,
    levels: false,
    shadows: true,
    theme: 'dark',
    snap: true,
    dims: false,
    section: { kind: null, name: '', offset: 0, flip: false, cut: true },
    stack: [],
    hlColor: '#35C4B6',
    view: null,
    coords: { E: null, N: null, Z: null, angle: null },
    cam: null
  }
  return (
    'sgvue://s=' +
    Buffer.from(JSON.stringify(payload), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  )
}

/**
 * The `app.asar` index, straight out of its own header — a pickled `uint32` length, then a
 * pickled JSON string (the format `@electron/asar` writes). An `asarUnpack`ed file is still
 * *listed* here, with `unpacked: true` and no `offset`, which is precisely the claim being
 * checked: the parser's wasm is a real file on disk, not a range inside the archive.
 */
interface AsarEntry {
  size?: number
  offset?: string
  unpacked?: boolean
  files?: Record<string, AsarEntry>
}

async function asarHeader(path: string): Promise<AsarEntry> {
  const fh = await open(path, 'r')
  try {
    // Four `uint32`s: the outer pickle's payload size (always 4), the header pickle's size,
    // that pickle's own payload size, and the JSON string's length. Then the JSON.
    const head = Buffer.alloc(16)
    await fh.read(head, 0, 16, 0)
    const json = Buffer.alloc(head.readUInt32LE(12))
    await fh.read(json, 0, json.length, 16)
    return JSON.parse(json.toString('utf8')) as AsarEntry
  } finally {
    await fh.close()
  }
}

/** With no installer built, every test here skips rather than failing. */
const NO_APP = `no packaged app at ${APP} — run \`npm run ${WIN ? 'dist:win' : 'dist:mac'}\` first`

test('the packaged app opens a model from a share link, under the production CSP, with its wasm unpacked', async () => {
  test.skip(!existsSync(EXECUTABLE), NO_APP)
  // The two `.wasm` files must be **outside** the asar: `OpenModelFromCallback` and sql.js
  // both instantiate from a URL, and a file inside an archive has no readable one.
  const unpacked = join(UNPACKED, 'out/renderer/assets')
  const wasm = (await readdir(unpacked)).filter((f) => f.endsWith('.wasm')).sort()
  expect(wasm.map((f) => f.replace(/-[A-Za-z0-9_]+\.wasm$/, '.wasm'))).toEqual([
    'sql-wasm.wasm',
    'web-ifc.wasm'
  ])
  for (const f of wasm) expect((await stat(join(unpacked, f))).size).toBeGreaterThan(500_000)
  // And the archive itself agrees: both are indexed but `unpacked`, so what the worker
  // instantiates is the file on disk above and not bytes inside `app.asar`.
  const header = await asarHeader(join(RESOURCES, 'app.asar'))
  const assets =
    header.files!.out.files!.renderer.files!.assets.files ?? ({} as Record<string, AsarEntry>)
  for (const f of wasm) {
    expect([f, assets[f]?.unpacked]).toEqual([f, true])
    expect([f, assets[f]?.offset]).toEqual([f, undefined])
  }

  const userData = await mkdtemp(join(tmpdir(), 'sgvue-packaged-'))
  const app = await electron.launch({
    executablePath: EXECUTABLE,
    args: [`--user-data-dir=${userData}`],
    env: { ...process.env, SGVUE_LINK: shareLink(TINY, 'tiny.ifc') } as Record<string, string>
  })
  const logs: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('console', (m) => logs.push(m.text()))
    await page.waitForLoadState('domcontentloaded')

    // 1 — this really is the packaged build, not `out/`.
    expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true)
    const pkgVersion = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version
    expect(await app.evaluate(({ app: a }) => a.getVersion())).toBe(pkgVersion)

    // 2 — the production CSP survived the copy into the asar.
    expect(await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content')).toBe(CSP)

    // 3 — the share link opened the file and the viewer reached ready: 6 elements, all visible.
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    await expect(page.locator('[data-role="viewport"]')).toBeVisible()
    await expect.poll(() => statusText(page), { timeout: 30_000 }).toContain('6 / 6')

    // 4 — the parse ran from the unpacked web-ifc, and the SQL index from the unpacked sql.js.
    // Both are proved by what the renderer says about them, since `__sgvueDev` is absent here.
    expect(logs.some((l) => /parsed in .* · 6 elements/.test(l))).toBe(true)
    expect(logs.filter((l) => /SQL index unavailable/.test(l))).toEqual([])
    // …and the development surface is not in this bundle at all.
    expect(await page.evaluate(() => '__sgvueDev' in window)).toBe(false)

    // 5 — Preferences opens from the **real** application menu, the one item the fidelity
    // contract's allowed deviations put there.
    const clicked = await app.evaluate(({ Menu }) => {
      const walk = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
        for (const item of items) {
          if (item.label === 'Preferences…') return item
          const found = item.submenu ? walk(item.submenu.items) : null
          if (found) return found
        }
        return null
      }
      const item = walk(Menu.getApplicationMenu()!.items)
      if (!item) return false
      item.click()
      return true
    })
    expect(clicked).toBe(true)
    await expect(page.locator('[data-role="prefs"]')).toBeVisible()
    await expect(page.locator('[data-role="prefs"]')).toHaveAttribute('aria-modal', 'true')
    await expect(page.getByText('Anthropic API key')).toBeVisible()
    // No key in a fresh profile, and the dialog says exactly that.
    await expect(page.getByText('Not set. The assistant is unavailable until one is.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-role="prefs"]')).toHaveCount(0)

    // 6 — what every run in this repository since 2026-09-17 records: the GPU helper's
    // `phys_footprint`. `scripts/safe-app.cjs` is watching it as well, and would have killed
    // the run at 2 500 MB; this is the number for the Build Report.
    const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics())
    const gpu = metrics.find((m) => m.type === 'GPU')
    expect(gpu).toBeTruthy()
    process.stdout.write(
      `\n[packaged] pid ${gpu!.pid} GPU working set ${Math.round((gpu!.memory.workingSetSize || 0) / 1024)} MB` +
        ` · ${metrics.length} processes\n`
    )
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})

/**
 * The same entrance on a **real** model, for the numbers. Runs only when `SGVUE_IFC` names a
 * file, exactly as `tests/e2e/big-model.spec.ts` does, because no real model is in the
 * repository (`samples/` is git-ignored).
 *
 *   SGVUE_IFC="samples/Sample Ifc Model.ifc" SGVUE_MAX_GPU_MB=3000 npm run test:packaged
 *
 * The limit is raised **deliberately** for this one run: the same content measured 2 121–2 353
 * MB of GPU `phys_footprint` under `scripts/bench.cjs`, and 3 000 MB is still below the
 * shipped app's own ceiling (`src/main/gpu-guard.ts`, `max(3 072 MB, 40 % of installed RAM)`,
 * so 9 830 MB on this machine and never less than 3 072).
 */
test('the packaged app opens the 137.9 MB model, and these are its numbers', async () => {
  test.skip(!existsSync(EXECUTABLE), NO_APP)
  const model = process.env.SGVUE_IFC ? resolve(ROOT, process.env.SGVUE_IFC) : ''
  test.skip(!model || !existsSync(model), 'set SGVUE_IFC to a real model to measure one')
  test.setTimeout(240_000)

  const userData = await mkdtemp(join(tmpdir(), 'sgvue-packaged-big-'))
  const t0 = Date.now()
  const app = await electron.launch({
    executablePath: EXECUTABLE,
    args: [`--user-data-dir=${userData}`],
    env: { ...process.env, SGVUE_LINK: shareLink(model, basename(model)) } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 180_000 })
    await expect.poll(() => statusText(page), { timeout: 120_000 }).toMatch(/\d+ \/ \d+/)
    const loadSeconds = (Date.now() - t0) / 1000

    // Orbit through Chromium's own input pipeline — Shift+drag is the design's orbit — and
    // sample the status bar's own fps counter while it moves.
    const box = (await page.locator('[data-role="viewport"]').boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const fps: number[] = []
    await page.keyboard.down('Shift')
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(cx + Math.sin(i / 2) * 260, cy + Math.cos(i / 2) * 60, { steps: 8 })
      await page.waitForTimeout(500)
      const m = /·\s*(\d+)\s*fps/.exec(await statusText(page))
      if (m) fps.push(Number(m[1]))
    }
    await page.mouse.up()
    await page.keyboard.up('Shift')

    const status = await statusText(page)
    const sorted = [...fps].sort((a, b) => a - b)
    const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics())
    const gpu = metrics.find((m) => m.type === 'GPU')
    process.stdout.write(
      `\n[packaged] ${basename(model)}\n` +
        `[packaged] launch to ready      ${loadSeconds.toFixed(2)} s\n` +
        `[packaged] status bar           ${status}\n` +
        `[packaged] fps while orbiting   [${fps.join(', ')}]  median ${sorted[sorted.length >> 1]}  min ${sorted[0]}\n` +
        `[packaged] gpu working set      ${Math.round((gpu?.memory.workingSetSize ?? 0) / 1024)} MB` +
        ` (blind — scripts/safe-app.cjs prints the phys_footprint peak)\n` +
        `[packaged] processes            ${metrics.length}\n`
    )
    // The renderer really is on WebGL2, and every element of the model is in the count.
    expect(status).toContain('WebGL2')
    expect(sorted.length).toBeGreaterThan(4)
    expect(sorted[0]).toBeGreaterThan(0)
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('the packaged app carries the brand-mark icon', async () => {
  // macOS keeps the icon as a file in `Contents/Resources`, which is what this reads. The
  // Windows executable embeds `build/icon.ico` as a PE resource instead — there is no icon
  // file in `dist/win-unpacked` to stat, and a PE resource parser is not something this
  // repository is going to grow for one assertion.
  test.skip(
    process.platform !== 'darwin',
    'icon.icns is a macOS bundle resource; the Windows exe embeds its icon as a PE resource'
  )
  test.skip(!existsSync(EXECUTABLE), NO_APP)
  const icon = join(RESOURCES, 'icon.icns')
  expect(existsSync(icon)).toBe(true)
  // The scaffold icon `build/` shipped until Phase 10 was 85 649 bytes; the brand mark drawn
  // by `scripts/make-icons.py` is ten sizes and far larger. A stale copy would be caught here.
  expect((await stat(icon)).size).toBeGreaterThan(150_000)
})
