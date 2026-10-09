/**
 * The Electron smoke test — the built app, the real main process, the real protocol handler
 * and the real parse worker, on a committed fixture (`tests/fixtures/tiny.ifc`).
 *
 * Run it only through `node scripts/safe-e2e.cjs` (`npm run test:e2e`): every Electron start
 * in this repository goes through a footprint / pressure / time guard.
 *
 * Nothing here reads `window.__sgvueDev` — the suite runs against the **production** bundle,
 * which does not have it. Everything is asserted through what a person can see, plus the two
 * files `main/sessions.ts` writes.
 */
import { test, expect, type Page } from '@playwright/test'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ABOUT_STORY, SITE_URL } from '../../src/main/about'
import { spotGridHtml } from '../../src/shared/annotate'
import { signedF3 } from '../../src/shared/fmt'
import { BOTTOM_GAP, HINT_MIN } from '../../src/renderer/state/selectors/lanes'
import {
  actionText,
  DROP_COPY,
  HIGH_FIRST,
  launch,
  openSchedulesWindow,
  pixelsDiffer,
  readSession,
  ROOT,
  settledShot,
  statusText,
  TINY
} from './helpers'

let dir = ''

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-e2e-'))
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test('opens on the landing page, under the production CSP, with the pinned preload API', async () => {
  const { app, page } = await launch(dir)
  try {
    // 1 — the landing page, and nothing auto-loaded.
    await expect(page.locator('[data-role="landing"]')).toBeVisible()
    await expect(page.getByText('Open a model to begin')).toBeVisible()
    await expect(page.getByText(DROP_COPY)).toBeVisible()
    // The footer strip is not in the port (2026-09-21): no copy, no legal links.
    await expect(page.getByText('Parsed locally, never uploaded')).toHaveCount(0)
    await expect(page.locator('a[href="#privacy"], a[href="#terms"], a[href="#support"]')).toHaveCount(0)
    // Its theme toggle stays, so the theme can be switched before a model is open.
    await expect(page.locator('button[data-tip="switch to light"], button[data-tip="switch to dark"]')).toHaveCount(1)
    // 2026-09-24 — the app's version sits on the left of that same strip.
    const pkgVersion = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version
    await expect(page.locator('[data-role="landing"]').getByText(`v${pkgVersion}`, { exact: true })).toBeVisible()
    // No recents in a fresh profile, so the design's `hasSamples: false` branch.
    await expect(page.getByText('Recent', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Resume last session')).toHaveCount(0)

    // 2 — the CSP meta tag, byte-identical to `electron.vite.config.ts`'s constant.
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content')
    expect(csp).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self' sgvue-file: blob:; object-src 'none'; base-uri 'none'"
    )

    // 3 — the preload's exposed keys, in the order `tests/readonly-guard.test.ts` pins.
    const keys = await page.evaluate(() => Object.keys((window as unknown as { sgvue: object }).sgvue))
    expect(keys).toEqual([
      'platform',
      'versions',
      'onGpuGuardTripped',
      'openDialog',
      'admitPaths',
      'pathForFile',
      'fileUrl',
      'confirmReplace',
      'saveSession',
      'clearSession',
      'listRecents',
      'addRecent',
      'onDeepLink',
      'aiTurn',
      'aiAbort',
      'onAiEvent',
      'onAiToolExec',
      'aiToolResult',
      'getSettings',
      'setSettings',
      'setApiKey',
      'clearApiKey',
      'onOpenSettings',
      'openSchedules',
      'checkUpdate',
      'openUpdatePage'
    ])

    // 3b — the renderer can learn whether a key is stored, and nothing else about it.
    const settings = await page.evaluate(() =>
      (window as unknown as { sgvue: { getSettings(): Promise<object> } }).sgvue.getSettings()
    )
    expect(Object.keys(settings).sort()).toEqual([
      'backend',
      'cacheOneHour',
      'effort',
      'hasKey',
      'keyStorageAvailable',
      'model',
      'preferNvidia'
    ])
    expect(JSON.stringify(settings)).not.toMatch(/sk-ant-/)
    // There is no getter for the key — not on the bridge, and not in main's IPC table.
    expect(keys).not.toContain('getApiKey')

    // 4 — a bogus token is refused, and so is a URL that is not a token at all.
    const statuses = await page.evaluate(async () => {
      const probe = async (url: string): Promise<number> => {
        try {
          return (await fetch(url)).status
        } catch {
          return -1
        }
      }
      return {
        bogus: await probe('sgvue-file://t/00000000-0000-0000-0000-000000000000'),
        notAToken: await probe('sgvue-file://model/tiny.ifc')
      }
    })
    expect(statuses.bogus).toBe(403)
    expect(statuses.notAToken).toBe(403)
  } finally {
    await app.close()
  }
})

test('opens the fixture through the real pipeline and reaches the viewer', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  try {
    await page.getByText(DROP_COPY).click()

    // The designed stage rows appear before anything renders. Scoped to the landing page:
    // the sidebar carries a row of its own with the same copy (`SGVue.dc.html:126`).
    const landing = page.locator('[data-role="landing"]')
    await expect(landing.getByText('tiny.ifc')).toBeVisible()
    await expect(landing.getByText(/reading file|parsing entities/)).toBeVisible()

    // …and the landing page goes when the federation forms.
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    await expect(page.locator('[data-role="viewport"]')).toBeVisible()

    // The status bar: a real backend and the fixture's own six elements.
    const status = await statusText(page)
    expect(status).toMatch(/WebGL2|WebGPU/)
    expect(status).toContain('6 / 6')

    // The sidebar filled in from the index: two storeys, four walls, two slabs. Scoped to the
    // `<aside>` — the 3D overlay draws a level tag with the same text.
    const side = page.locator('aside')
    await expect(side.getByText('Level 1', { exact: true })).toBeVisible()
    await expect(side.getByText('Level 2', { exact: true })).toBeVisible()
    await expect(side.getByText('IfcWall', { exact: true })).toBeVisible()
    await expect(side.getByText('IfcSlab', { exact: true })).toBeVisible()
    await expect(side.getByText('tiny.ifc')).toBeVisible()

    // The session is written, with the file's path and hash.
    await expect
      .poll(async () => {
        try {
          return (await readSession(dir)).payload.models
        } catch {
          return null
        }
      }, { timeout: 20_000 })
      .toEqual(['tiny'])
    const { payload } = await readSession(dir)
    const files = payload.files as { path: string; name: string; sha256: string }[]
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('tiny.ifc')
    expect(files[0].sha256).toMatch(/^[0-9a-f]{64}$/)
  } finally {
    await app.close()
  }
})

test('saves a session; the next launch offers the file under Recent, with no Resume card', async () => {
  // ── first run: open the fixture and hide a storey, so the session has something to say ──
  {
    const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
    try {
      await page.getByText(DROP_COPY).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })

      // Hide the three elements on Level 2, through the designed storey row.
      await page.locator('button[title="Show / hide storey"]').nth(1).click()
      await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('3 / 6')
      await expect
        .poll(async () => {
          try {
            return (await readSession(dir)).payload.storeyVis
          } catch {
            return null
          }
        }, { timeout: 20_000 })
        .toMatchObject({ 'Level 2': false })
    } finally {
      await app.close()
    }
  }

  // ── second run: no Resume card (2026-09-24); the file is under "Recent", and opens fresh ──
  {
    const { app, page } = await launch(dir)
    try {
      // The recents list is what the designed library is backed by, so the pills are there.
      await expect(page.getByText('Recent', { exact: true })).toBeVisible()
      await expect(page.getByText('Sample federation')).toHaveCount(0)
      await expect(page.getByText('Resume last session')).toHaveCount(0)

      await page.locator('[data-role="landing"] button', { hasText: 'tiny.ifc' }).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })

      // A fresh load: the storey the first run hid is shown again.
      await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('6 / 6')
    } finally {
      await app.close()
    }
  }
})

/**
 * Records whether the landing page's warning banner ever showed, so a test can assert that a
 * replaced load said nothing — the banner is gone with the landing page by the time it looks.
 */
const watchBanner = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const w = window as unknown as { __banner: string }
    w.__banner = ''
    const look = (): void => {
      const text = document.querySelector('[data-role="landing"]')?.textContent || ''
      const m = /Could not open that model[^.]*\.|already loading[^"]*"[^"]*"/.exec(text)
      if (m && !w.__banner) w.__banner = m[0]
      requestAnimationFrame(look)
    }
    look()
  })
const bannerSeen = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __banner: string }).__banner)

const sessionModels = (userData: string) => async (): Promise<unknown> => {
  try {
    return (await readSession(userData)).payload.models
  } catch {
    return null
  }
}

test('on the landing page a second pick mid-load replaces the first, with no warning', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  try {
    await watchBanner(page)
    const landing = page.locator('[data-role="landing"]')
    await page.getByText(DROP_COPY).click()
    // Mid-load: the row is up and still on a stage.
    await expect(landing.getByText(/reading file|parsing entities|building geometry/)).toBeVisible()
    // The same file again — before 2026-09-24, `already loading "tiny"`.
    await page.getByText(DROP_COPY).click()

    await expect(landing).toHaveCount(0, { timeout: 60_000 })
    expect(await bannerSeen(page)).toBe('')
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('6 / 6')
    // One model, under its own name — not `tiny` and `tiny (2)`.
    await expect.poll(sessionModels(dir), { timeout: 20_000 }).toEqual(['tiny'])
  } finally {
    await app.close()
  }
})

test('two quick Recent pills: no warning, and only the last one picked is loaded', async () => {
  const other = join(dir, 'other.ifc')
  await copyFile(TINY, other)

  // ── first run: open both, so both are recents ──
  {
    const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: `${TINY}:::${other}` })
    try {
      await page.getByText(DROP_COPY).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await expect.poll(sessionModels(dir), { timeout: 20_000 }).toEqual(['tiny', 'other'])
    } finally {
      await app.close()
    }
  }

  const pill = (page: Page, file: string) =>
    page.locator('[data-role="landing"] button', { hasText: file })

  // ── the same pill twice, quickly: one model ──
  {
    const { app, page } = await launch(dir)
    try {
      await watchBanner(page)
      await pill(page, 'tiny.ifc').click()
      await pill(page, 'tiny.ifc').click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      expect(await bannerSeen(page)).toBe('')
      await expect.poll(sessionModels(dir), { timeout: 20_000 }).toEqual(['tiny'])
    } finally {
      await app.close()
    }
  }

  // ── one pill, then another mid-load: only the last one ──
  {
    const { app, page } = await launch(dir)
    try {
      await watchBanner(page)
      await pill(page, 'tiny.ifc').click()
      await expect(page.locator('[data-role="landing"]').getByText(/reading file|parsing entities/)).toBeVisible()
      await pill(page, 'other.ifc').click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      expect(await bannerSeen(page)).toBe('')
      await expect.poll(sessionModels(dir), { timeout: 20_000 }).toEqual(['other'])
      await expect(page.locator('aside').getByText('tiny.ifc')).toHaveCount(0)
    } finally {
      await app.close()
    }
  }
})

/**
 * 2026-09-24 — after boot, the same file picked again is confirmed in a native message box and
 * then **replaces** the model, instead of joining as `tiny (2)`. A native box cannot be driven
 * by Playwright, so `dialog.showMessageBox` is replaced **in the main process** with one that
 * records its options and answers the button asked for — the handler, the IPC channel and the
 * whole renderer path are the real ones.
 */
test('after boot, the same file again asks first: Replace leaves one model, Cancel changes nothing', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  try {
    let parses = 0
    page.on('console', (m) => {
      if (/tiny\.ifc parsed in/.test(m.text())) parses++
    })
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    await expect.poll(() => parses, { timeout: 20_000 }).toBe(1)

    const answer = (button: number): Promise<void> =>
      app.evaluate(({ dialog }, button) => {
        const g = globalThis as unknown as { __asked: unknown[] }
        g.__asked = []
        dialog.showMessageBox = (async (...args: unknown[]) => {
          g.__asked.push(args[args.length - 1])
          return { response: button, checkboxChecked: false }
        }) as typeof dialog.showMessageBox
      }, button)
    const asked = (): Promise<unknown[]> =>
      app.evaluate(() => (globalThis as unknown as { __asked: unknown[] }).__asked)
    const sidebar = page.locator('aside')
    const upload = sidebar.getByText('upload', { exact: true })
    const pageText = (): Promise<string> => page.evaluate(() => document.body.textContent || '')

    // ── Replace ──
    await answer(0)
    await upload.click()
    await expect.poll(asked, { timeout: 10_000 }).toHaveLength(1)
    expect((await asked())[0]).toMatchObject({
      title: 'Replace model?',
      message: '"tiny.ifc" is already open.',
      detail: 'Replace it with the file you just picked?',
      buttons: ['Replace', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    })
    // The new file really was parsed, and has joined: its row is gone and one model is left.
    await expect.poll(() => parses, { timeout: 30_000 }).toBe(2)
    await expect(sidebar.getByText('tiny.ifc', { exact: true })).toHaveCount(1, { timeout: 20_000 })
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('6 / 6')
    expect(await pageText()).not.toMatch(/tiny \(2\)|already loading|Could not open/)
    await expect.poll(sessionModels(dir), { timeout: 20_000 }).toEqual(['tiny'])

    // ── Cancel ──
    await answer(1)
    await upload.click()
    await expect.poll(asked, { timeout: 10_000 }).toHaveLength(1)
    // Nothing is queued: no row, no parse, no warning, and the model is still there.
    await page.waitForTimeout(1_500)
    expect(parses).toBe(2)
    await expect(sidebar.getByText('tiny.ifc', { exact: true })).toHaveCount(1)
    expect(await pageText()).not.toMatch(/tiny \(2\)|already loading|Could not open/)
    await expect.poll(() => statusText(page)).toContain('6 / 6')
    await expect.poll(sessionModels(dir)).toEqual(['tiny'])
  } finally {
    await app.close()
  }
})

test('a share link reopens the same view, and a broken one is refused by name', async () => {
  // ── build a link from a real session ──
  let link = ''
  {
    const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
    try {
      await page.getByText(DROP_COPY).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await page.locator('button[title="Show / hide storey"]').nth(1).click()
      await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('3 / 6')
      // The autosave has recorded the hidden storey — polled, not waited for.
      await expect
        .poll(async () => {
          try {
            return (await readSession(dir)).payload.storeyVis
          } catch {
            return null
          }
        }, { timeout: 20_000 })
        .toMatchObject({ 'Level 2': false })
      const { payload } = await readSession(dir)
      link =
        'sgvue://s=' +
        Buffer.from(JSON.stringify(payload), 'utf8')
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
    } finally {
      await app.close()
    }
  }

  // ── a fresh profile: the link alone reopens the view ──
  {
    const fresh = await mkdtemp(join(tmpdir(), 'sgvue-e2e-link-'))
    const { app, page } = await launch(fresh, { SGVUE_LINK: link })
    try {
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('3 / 6')
    } finally {
      await app.close()
      await rm(fresh, { recursive: true, force: true })
    }
  }

  // ── a link naming a file that is not there stays on the landing page and says which ──
  {
    const fresh = await mkdtemp(join(tmpdir(), 'sgvue-e2e-bad-'))
    const broken = JSON.parse(
      Buffer.from(link.slice('sgvue://s='.length).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    )
    broken.files = [{ key: 'tiny', path: '/nowhere/moved.ifc', name: 'moved.ifc', sha256: 'x' }]
    const badLink =
      'sgvue://s=' +
      Buffer.from(JSON.stringify(broken), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    const { app, page } = await launch(fresh, { SGVUE_LINK: badLink })
    try {
      await expect(page.locator('[data-role="landing"]')).toBeVisible()
      await expect(page.getByText(/moved\.ifc/)).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('dismiss')).toBeVisible()
    } finally {
      await app.close()
      await rm(fresh, { recursive: true, force: true })
    }
  }
})

/**
 * A launch link carries **only its payload** into the window.
 *
 * `#backend=webgpu` is a dev-build measurement switch (`App.tsx`), and WebGPU on a real model
 * is the path that kernel-panicked the development Mac (`CLAUDE.md` Decisions, 2026-09-17) —
 * so a link someone is handed must not be able to choose it. Both halves are asserted here at
 * once: main drops everything after the payload (`deep-link.ts`'s `launchHash`), and a shipped
 * renderer ignores the hash switch anyway. The model still loads, on WebGL2.
 */
test('a launch link with &backend=webgpu still opens on WebGL2', async () => {
  // ── build a link from a real session, exactly as the share-link test does ──
  let link = ''
  {
    const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
    try {
      await page.getByText(DROP_COPY).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await expect
        .poll(async () => {
          try {
            return (await readSession(dir)).payload.models
          } catch {
            return null
          }
        }, { timeout: 20_000 })
        .toEqual(['tiny'])
      const { payload } = await readSession(dir)
      link =
        'sgvue://s=' +
        Buffer.from(JSON.stringify(payload), 'utf8')
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
    } finally {
      await app.close()
    }
  }

  // ── a fresh profile: the same link, with a backend switch appended to it ──
  {
    const fresh = await mkdtemp(join(tmpdir(), 'sgvue-e2e-backend-'))
    const { app, page } = await launch(fresh, { SGVUE_LINK: `${link}&backend=webgpu` })
    try {
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('6 / 6')
      const status = await statusText(page)
      expect(status).toContain('WebGL2')
      expect(status).not.toContain('WebGPU')
    } finally {
      await app.close()
      await rm(fresh, { recursive: true, force: true })
    }
  }
})

/**
 * Phase 9a. The assistant's shell, with **no key and no network**: the one allowed new
 * surface opens from the real application menu, the key never crosses the bridge, and a turn
 * asked for without a key fails with a sentence rather than hanging.
 */
test('Preferences opens from the native menu, and a keyless turn fails cleanly', async () => {
  const { app, page } = await launch(dir, { ANTHROPIC_API_KEY: '' })
  try {
    // 1 — the menu item exists, with the platform accelerator, and nothing else opens it.
    const item = await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu()
      if (!menu) return null
      for (const top of menu.items) {
        for (const sub of top.submenu?.items ?? []) {
          if (sub.label === 'Preferences…') return { accelerator: sub.accelerator, under: top.label }
        }
      }
      return null
    })
    expect(item).not.toBeNull()
    expect(item!.accelerator).toBe('CmdOrCtrl+,')

    // 2 — clicking it opens the dialog, built from the design tokens, with the privacy note.
    await expect(page.locator('[data-role="prefs"]')).toHaveCount(0)
    await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu()!
      for (const top of menu.items) {
        for (const sub of top.submenu?.items ?? []) if (sub.label === 'Preferences…') sub.click()
      }
    })
    const prefs = page.locator('[data-role="prefs"]')
    await expect(prefs).toBeVisible()
    await expect(
      page.getByText('The IFC file itself never leaves this computer.', { exact: false })
    ).toBeVisible()
    await expect(page.getByText('Not set. The assistant is unavailable until one is.')).toBeVisible()

    // 3 — "Data sent to AI" shows the last request, and there has not been one.
    await page.getByRole('button', { name: 'Data sent to AI' }).click()
    await expect(page.locator('[data-role="prefs-snapshot"]')).toHaveText(
      'Nothing has been sent yet this session.'
    )

    // 4 — a turn with no key comes back as one error event, not as a hang.
    const failure = await page.evaluate(async () => {
      const api = (window as unknown as {
        sgvue: {
          onAiEvent(fn: (e: { type: string; kind?: string; message?: string }) => void): () => void
          aiTurn(r: unknown): Promise<void>
        }
      }).sgvue
      const seen: { type: string; kind?: string; message?: string }[] = []
      const off = api.onAiEvent((e) => seen.push(e))
      await api.aiTurn({ turnId: 'e2e', userText: 'how many walls?', viewState: {}, schema: {} })
      await new Promise((r) => setTimeout(r, 200))
      off()
      return seen
    })
    expect(failure.map((e) => e.type)).toEqual(['error'])
    expect(failure[0].kind).toBe('no_key')
    expect(failure[0].message).toContain('Preferences')

    // 5 — the scrim closes it, and nothing designed gained a control.
    await page.locator('[data-role="prefs-scrim"]').click({ position: { x: 5, y: 5 } })
    await expect(prefs).toHaveCount(0)
  } finally {
    await app.close()
  }
})

/**
 * Phase 9b. The panel itself, in the **production** bundle, with **no key**: it opens from its
 * own pill, it renders the local boot audit — chips included — a chip selects what it names,
 * and a question asked without a key comes back as the designed error row rather than a hang.
 *
 * Nothing here needs a key, and nothing here uses `window.__sgvueDev`: the chips come from
 * `seedAudit`, which is arithmetic over the federation (`SGVue.dc.html:1642`) and the only
 * producer of chips that never calls the API.
 */
test('the assistant panel opens from its pill, seeds the audit, and refuses a keyless turn', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY, ANTHROPIC_API_KEY: '' })
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })

    // 1 — the pill is the only way in, and it opens the panel. `SGVue.dc.html:536`. It is
    // found by its own `data-tip`, as the parity harness finds every toolbar button: the
    // design's tooltip is a `content: attr(data-tip)` pseudo-element, and Chromium folds that
    // into the button's accessible name, so a role+name lookup would have to repeat the tip.
    const pill = page.locator(
      'button[data-tip="Ask the assistant to filter, isolate, hide or navigate the model"]'
    )
    await expect(page.locator('[data-role="chatlog"]')).toHaveCount(0)
    // 2026-10-01 — the assistant is Vee: the pill says so, and carries its mascot — a canvas
    // sprite, something drawn on it — in a pill the design's own height.
    await expect(pill).toHaveText('Ask Vee')
    await expect(pill.locator('[data-role="vee"] canvas')).toHaveCount(1)
    expect((await pill.boundingBox())!.height).toBe(32)
    await pill.click()
    const log = page.locator('[data-role="chatlog"]')
    await expect(log).toBeVisible()
    // …the panel's title too, with the mascot where the design's sparkle was; the header is the
    // height it had (11 + 24 + 11 px, and its rule).
    const title = page.locator('#sgvue-chat-title')
    await expect(title).toHaveText('Ask Vee')
    const header = title.locator('xpath=..')
    await expect(header.locator('[data-role="vee"] canvas')).toHaveCount(1)
    await expect(header.locator('svg')).toHaveCount(1) // the close button's ×, and no sparkle
    expect((await header.boundingBox())!.height).toBe(47)
    await expect(page.getByText('Ask SGVue')).toHaveCount(0)

    // 2 — the boot audit is already the first turn, with its own chips (`:1642`).
    await expect(log.getByText('1 model, 6 elements, 2 storeys.', { exact: false })).toBeVisible()
    // It is the assistant's, so it is labelled `Vee`, the mascot in front of the name and the
    // design's `reply` after it — in a row no taller than the design's 10 px.
    const seedLabel = log.locator(':scope > div').first().locator(':scope > div').first()
    expect(await seedLabel.evaluate((row) => [...row.children].map((k) => (k.textContent || '').trim()))).toEqual([
      '',
      'Vee',
      'reply'
    ])
    await expect(seedLabel.locator(':scope > [data-role="vee"] canvas')).toHaveCount(1)
    expect((await seedLabel.boundingBox())!.height).toBe(10)
    // Every sprite is decorative, and every one has been painted: opaque pixels on its canvas.
    const painted = await page.locator('[data-role="vee"]').evaluateAll((slots) =>
      slots.map((slot) => {
        const canvas = slot.querySelector('canvas')!
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        let opaque = 0
        for (let i = 3; i < data.length; i += 4) if (data[i] === 255) opaque++
        // Whole device pixels to a cell: the backing store is 16 cells of them.
        return { hidden: slot.getAttribute('aria-hidden'), cells: canvas.width / 16, square: canvas.width === canvas.height, opaque }
      })
    )
    expect(painted).toHaveLength(3)
    for (const sprite of painted) {
      expect(sprite.hidden).toBe('true')
      expect(Number.isInteger(sprite.cells) && sprite.cells >= 1 && sprite.square).toBe(true)
      // The idle face is 116 cells of its 256 (the rim, the body, the facet, the eyes).
      expect(sprite.opaque).toBe(116 * sprite.cells * sprite.cells)
    }
    const chips = log.locator('button[data-tip="Click to select · double-click to zoom"]')
    await expect(chips.first()).toBeVisible()
    expect(await chips.count()).toBeGreaterThan(0)
    expect(await chips.count()).toBeLessThanOrEqual(6)

    // 3 — a chip selects what it names: the property card opens on the elements behind it.
    await chips.first().click()
    await expect(page.locator('[data-role="propcard"]')).toBeVisible()

    // 3b — the context menu's "Ask about this" (`:1650`) pre-fills the composer and focuses
    // it with the caret at the end, so the question can be finished by typing.
    // The panel is closed first, so the right-click below reaches the viewport rather than a
    // bubble — and so this also proves `askAbout` **opens** the panel, as the design does.
    await pill.click()
    await expect(page.locator('[data-role="chatlog"]')).toHaveCount(0)
    const side = page.locator('aside')
    await side.getByText('IfcWall', { exact: true }).click()
    // Select the one row first: the menu acts on the whole selection when the target is part
    // of it (`:1899`), and the chip above selected six, which would pre-fill "6 selected
    // elements" instead of this wall. `F` then frames it, so the right-click below lands on
    // that wall and the menu opens near the middle of the window rather than at its foot —
    // the design clamps the menu's top to `innerHeight - 260` (`:1901`), which is short of
    // this menu's own 385 px, so a menu opened low runs off the bottom on both sides.
    await side.getByText('Wall L1-1', { exact: true }).click()
    await page.keyboard.press('f')
    // Until the framing move is over: two viewport captures in a row agree.
    await settledShot(page)
    await page.locator('[data-role="viewport"]').click({ button: 'right' })
    await page.getByText('Ask about this', { exact: true }).click()
    await expect(page.locator('[data-role="chatlog"]')).toBeVisible()
    await expect(page.locator('[data-role="chatinput"]')).toHaveValue(/^About Wall L1-1 \(IfcWall/)
    await expect(page.locator('[data-role="chatinput"]')).toBeFocused()

    // 3c — 2026-09-24: before the first user turn the suggestions are one unfolded line,
    // with no fold chip.
    const suggest = page.locator('[data-role="chatsuggest"]')
    const fold = page.getByRole('button', { name: /suggestions$/ })
    await expect(suggest).toBeVisible()
    expect(await suggest.locator('button').count()).toBeGreaterThan(0)
    expect((await suggest.boundingBox())!.height).toBeLessThan(30)
    await expect(fold).toHaveCount(0)

    // 4 — Enter sends, and with no key the turn fails into the designed error row with the
    // sentence main produced — not a hang, and not a silent nothing.
    await page.locator('[data-role="chatinput"]').fill('how many walls?')
    await page.locator('[data-role="chatinput"]').press('Enter')
    await expect(log.getByText(/Preferences/)).toBeVisible({ timeout: 30_000 })
    // The composer emptied and the busy row is gone: `chatBegin` then `chatFail` (`:1602`).
    await expect(page.locator('[data-role="chatinput"]')).toHaveValue('')
    await expect(log.getByText('reading the model')).toHaveCount(0)
    // The question stays in the transcript as the user's: labelled `You`, and no mascot on it.
    const asked = log.locator(':scope > div').filter({ hasText: 'how many walls?' })
    await expect(asked).toHaveCount(1)
    await expect(asked.locator(':scope > div').first().locator(':scope > span').first()).toHaveText('You')
    await expect(asked.locator('[data-role="vee"]')).toHaveCount(0)

    // 4a — 2026-09-24: after the first user turn the row folds behind one `suggestions` chip;
    // the chip opens it, and a picked suggestion fills the composer and folds it again.
    await expect(suggest).toHaveCount(0)
    await expect(fold).toHaveText('▸ suggestions')
    await fold.click()
    await expect(suggest).toBeVisible()
    await expect(fold).toHaveText('▾ suggestions')
    const firstSuggestion = suggest.locator('button').first()
    const picked = (await firstSuggestion.textContent())!
    await firstSuggestion.click()
    await expect(page.locator('[data-role="chatinput"]')).toHaveValue(picked)
    await expect(suggest).toHaveCount(0)
    await page.locator('[data-role="chatinput"]').fill('')

    // 4b — the top-left corner stroke resizes the panel: width grows leftward, height upward,
    // by exactly the drag (`:1127`). The handle is the 34 px `nwse-resize` square at its
    // corner, so the drag starts inside it.
    const panel = page.locator('[data-role="chatlog"]').locator('..')
    const before = (await panel.boundingBox())!
    await page.mouse.move(before.x + 10, before.y + 10)
    await page.mouse.down()
    await page.mouse.move(before.x - 50, before.y - 30, { steps: 8 })
    await page.mouse.up()
    await expect
      .poll(async () => {
        const b = (await panel.boundingBox())!
        return [Math.round(b.width - before.width), Math.round(b.height - before.height)]
      })
      .toEqual([60, 40])

    // 5 — the pill closes it again, and nothing else on the stage changed.
    await pill.click()
    await expect(page.locator('[data-role="chatlog"]')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

/**
 * 2026-09-24 — Help › About shows the name, the version and the owner's story. The native
 * box cannot be driven by Playwright, so the call that shows it is replaced **in the main
 * process** with one that records its options; the menu item is the real one.
 */
test('Help › About carries the name, the version and the story', async () => {
  const { app } = await launch(dir)
  try {
    const shown = await app.evaluate(async ({ app: electronApp, dialog, Menu }) => {
      const seen: unknown[] = []
      dialog.showMessageBox = (async (...args: unknown[]) => {
        seen.push(args[args.length - 1])
        return { response: 0, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
      electronApp.setAboutPanelOptions = (o: unknown) => void seen.push(o)
      electronApp.showAboutPanel = () => undefined
      for (const top of Menu.getApplicationMenu()!.items) {
        for (const sub of top.submenu?.items ?? []) if (sub.label === 'About SGVue') sub.click()
      }
      // Off macOS the box waits for the GPU process to name the adapter (2026-09-25).
      for (let i = 0; i < 40 && !seen.length; i++) await new Promise((r) => setTimeout(r, 50))
      return { seen, electron: process.versions.electron }
    })
    expect(shown.seen).toHaveLength(1)
    const text = JSON.stringify(shown.seen[0])
    // The story opens the box's detail (the panel's credits on macOS), verbatim.
    const shownBox = shown.seen[0] as { detail?: string; credits?: string }
    const body = shownBox.detail ?? shownBox.credits ?? ''
    expect(body.startsWith(ABOUT_STORY)).toBe(true)
    expect(text).toContain('SGVue')
    // The build-time version, the one the landing page shows — not `app.getVersion()`, which
    // reads Electron's own in a launch like this one.
    const pkgVersion = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version
    expect(text).toContain(pkgVersion)
    expect(text).not.toContain(shown.electron)
    if (process.platform !== 'darwin') expect(text).toContain(`SGVue ${pkgVersion}`)
    // 2026-09-25 — and the adapter actually drawing, by name, on its own line under the story.
    if (process.platform !== 'darwin') expect(body).toMatch(/\n\nGraphics: \S/)
  } finally {
    await app.close()
  }
})

/**
 * 2026-09-25 — Help › Check for updates… opens a page in the user's browser; since 2026-09-28
 * the product site, told this build's exact version. `shell.openExternal` is replaced in the
 * main process with a recorder; the item is the real one.
 */
test('Help › Check for updates… opens the product site with this version', async () => {
  const pkgVersion = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version
  const { app } = await launch(dir)
  try {
    const opened = await app.evaluate(async ({ shell, Menu }) => {
      const seen: string[] = []
      shell.openExternal = (async (url: string) => void seen.push(url)) as typeof shell.openExternal
      for (const top of Menu.getApplicationMenu()!.items) {
        for (const sub of top.submenu?.items ?? []) if (sub.label === 'Check for updates…') sub.click()
      }
      await new Promise((r) => setTimeout(r, 100))
      return seen
    })
    expect(opened).toEqual([`${SITE_URL}?v=${encodeURIComponent(pkgVersion)}`])
    expect(opened[0]).toMatch(/^https:\/\/sgvue\.github\.io\/\?v=/)
  } finally {
    await app.close()
  }
})

/**
 * 2026-10-01 — the landing page says when a newer version is out, with a button to the download
 * page (owner-chosen: "Check at every start"). A development launch like this one never asks
 * GitHub (`main/updates.ts`): the answer is `SGVUE_UPDATE_LATEST`, put through the same
 * validation and comparison as a tag from GitHub. `shell.openExternal` is replaced in the main
 * process with a recorder, as in the Help-menu test above.
 */
test('the landing page shows an update notice with a link when a newer version is out, and nothing otherwise', async () => {
  const pkgVersion = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version
  const NOTICE = '[data-role="update-notice"]'
  /** What the page itself was told, once the answer is in. */
  const answer = (page: Page): Promise<unknown> =>
    page.evaluate(() =>
      (window as unknown as { sgvue: { checkUpdate(): Promise<unknown> } }).sgvue.checkUpdate()
    )
  /** The notice's own colours against the tokens it is meant to be drawn in, in this theme. */
  const tokens = (page: Page): Promise<{ got: string[]; want: string[] }> =>
    page.evaluate((q) => {
      const box = document.querySelector(q) as HTMLElement
      const [text, button] = [box.querySelector('span')!, box.querySelector('button')!]
      const probe = document.createElement('span')
      probe.style.cssText =
        'background:var(--sel-bg);border:1px solid var(--accent);color:var(--sel-ink);outline:1px solid var(--accent-ink)'
      document.body.append(probe)
      const p = getComputedStyle(probe)
      const want = [p.backgroundColor, p.borderTopColor, p.color, p.outlineColor]
      probe.remove()
      const b = getComputedStyle(box)
      return {
        got: [b.backgroundColor, b.borderTopColor, getComputedStyle(text).color, getComputedStyle(button).color],
        want
      }
    }, NOTICE)

  // ── a newer version is out ──
  {
    const { app, page } = await launch(dir, { SGVUE_UPDATE_LATEST: '99.0.0' })
    try {
      const landing = page.locator('[data-role="landing"]')
      const notice = landing.locator(NOTICE)
      await expect(notice).toBeVisible()
      expect(await answer(page)).toEqual({ latest: '99.0.0' })
      // The copy: the new version, and the one this build is.
      await expect(notice.locator('span')).toHaveText(
        `SGVue 99.0.0 is available — you have ${pkgVersion}.`
      )
      const button = notice.locator('button')
      await expect(button).toHaveText('get the update →')
      // One text and one button: no icon, no dismiss control.
      expect(await notice.evaluate((e) => [...e.children].map((k) => k.tagName))).toEqual(['SPAN', 'BUTTON'])

      // In the 620 px column, between the introduction and the drop zone, a column gap from each.
      const drop = page.getByText(DROP_COPY).locator('xpath=ancestor::label')
      const [n, d] = [(await notice.boundingBox())!, (await drop.boundingBox())!]
      const intro = (await page.getByText('Open a model to begin').locator('xpath=..').boundingBox())!
      expect(n.x).toBeCloseTo(d.x, 1)
      expect(n.width).toBeCloseTo(d.width, 1)
      expect(n.y - (intro.y + intro.height)).toBeCloseTo(22, 1)
      expect(d.y - (n.y + n.height)).toBeCloseTo(22, 1)
      expect(
        await notice.evaluate((e) => {
          const c = getComputedStyle(e)
          return [c.display, c.alignItems, c.borderTopWidth, c.borderRadius, c.paddingTop, c.paddingLeft]
        })
      ).toEqual(['flex', 'center', '1px', '10px', '12px', '14px'])

      // The accent tokens, in both themes.
      const dark = await tokens(page)
      expect(dark.got).toEqual(dark.want)
      await landing.locator('button[data-tip="switch to light"]').click()
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
      const light = await tokens(page)
      expect(light.got).toEqual(light.want)
      expect(light.want).not.toEqual(dark.want)

      // The button opens exactly the product site, told this version. Main builds that URL.
      await app.evaluate(({ shell }) => {
        const g = globalThis as unknown as { __opened: string[] }
        g.__opened = []
        shell.openExternal = (async (url: string) => void g.__opened.push(url)) as typeof shell.openExternal
      })
      await button.click()
      await expect
        .poll(() => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened))
        .toEqual([`${SITE_URL}?v=${encodeURIComponent(pkgVersion)}`])
      // The notice has no dismiss, so it is still there.
      await expect(notice).toBeVisible()
    } finally {
      await app.close()
    }
  }

  // ── nothing newer (the same version, an older one, no answer at all): no notice ──
  for (const latest of [pkgVersion, '0.0.1', '']) {
    const { app, page } = await launch(dir, { SGVUE_UPDATE_LATEST: latest })
    try {
      await expect(page.locator('[data-role="landing"]')).toBeVisible()
      // The answer is in, and it is "no" — not merely not here yet.
      expect(await answer(page)).toBeNull()
      await expect(page.locator(NOTICE)).toHaveCount(0)
    } finally {
      await app.close()
    }
  }

  // ── with the warning banner up as well, the update notice is the first of the two ──
  {
    const broken = Buffer.from(
      JSON.stringify({ models: ['gone'], files: [{ key: 'gone', path: '/nowhere/gone.ifc', name: 'gone.ifc', sha256: 'x' }] }),
      'utf8'
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const { app, page } = await launch(dir, { SGVUE_UPDATE_LATEST: '99.0.0', SGVUE_LINK: `sgvue://s=${broken}` })
    try {
      const notice = page.locator(NOTICE)
      const dismiss = page.locator('[data-role="landing"]').getByText('dismiss', { exact: true })
      await expect(dismiss).toBeVisible({ timeout: 20_000 })
      await expect(notice).toBeVisible()
      const banner = dismiss.locator('xpath=..')
      const [n, b] = [(await notice.boundingBox())!, (await banner.boundingBox())!]
      expect(b.y - (n.y + n.height)).toBeCloseTo(22, 1)
      expect(b.x).toBeCloseTo(n.x, 1)
      expect(b.width).toBeCloseTo(n.width, 1)
    } finally {
      await app.close()
    }
  }
})

/**
 * 2026-09-24 — the sidebar's drag handles. Undragged, the STOREYS rows carry the design's
 * style string and nothing else; dragging the handle under them grows them by the drag and
 * the element tree gives up the same; a double-click puts them back.
 */
test('a sidebar handle resizes the section above it, and a double-click resets it', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    const side = page.locator('aside')
    await expect(side.getByText('Level 2', { exact: true })).toBeVisible()

    const handles = side.locator('[role="separator"]')
    await expect(handles).toHaveCount(2)
    const read = (): Promise<{ rows: number; tree: number; style: string }> =>
      page.evaluate(() => {
        const handle = document.querySelectorAll('aside [role="separator"]')[1]
        const rows = handle.parentElement!.previousElementSibling as HTMLElement
        const tree = document.querySelector('aside [role="tree"]') as HTMLElement
        return {
          rows: rows.getBoundingClientRect().height,
          tree: tree.getBoundingClientRect().height,
          style: rows.getAttribute('style') || ''
        }
      })
    const before = await read()
    expect(before.style).not.toContain('flex:')
    expect(before.style).not.toContain('overflow')

    const box = (await handles.nth(1).boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 40, { steps: 8 })
    await page.mouse.up()
    await expect
      .poll(async () => {
        const now = await read()
        return [Math.round(now.rows - before.rows), Math.round(before.tree - now.tree)]
      })
      .toEqual([40, 40])

    await handles.nth(1).dblclick()
    await expect.poll(async () => Math.round((await read()).rows)).toBe(Math.round(before.rows))
    expect((await read()).style).not.toContain('flex:')
  } finally {
    await app.close()
  }
})

test('the canvas grid toggle hides and shows the ground grid, and survives a theme switch', async () => {
  // 2026-09-24, owner-requested. There is no DOM for the ground grid — it is drawn into the
  // canvas — so it is asserted on the viewport's own pixels. The viewer draws on demand, so a
  // scene at rest repaints the same picture to within a stray pixel or two of rasteriser noise;
  // the ground grid is tens of thousands of pixels on this fixture.
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    const toggle = page.locator('button[data-tip="canvas grid"]')
    await expect(toggle).toHaveCount(1)
    // It sits right after the Levels button, in the same group.
    expect(
      await toggle.evaluate((b) => (b.previousElementSibling as HTMLElement | null)?.dataset.tip)
    ).toBe('Levels (L)')

    const lit = (): Promise<string> => toggle.evaluate((b) => getComputedStyle(b).color)

    const on = await settledShot(page)
    const litOn = await lit()
    await toggle.click()
    const off = await settledShot(page)
    expect(await pixelsDiffer(page, on, off)).toBeGreaterThan(1000)
    expect(await lit()).not.toBe(litOn)
    await toggle.click()
    expect(await pixelsDiffer(page, on, await settledShot(page))).toBeLessThan(20)

    // Off, then a theme switch — which rebuilds the grid helper in the new theme's colours.
    await toggle.click()
    // Since 2026-10-01 the theme button is in this same group, two after the toggle and clear
    // of the view cube's canvas. (The button under the canvas's empty corner is Schedules now;
    // the toolbar test below clicks that one through it.)
    const theme = page.locator('button[data-tip="Light / dark"]')
    expect(
      await theme.evaluate(
        (b) => b.parentElement === document.querySelector('button[data-tip="canvas grid"]')!.parentElement
      )
    ).toBe(true)
    const cb = (await page.locator('[data-role="cube"]').boundingBox())!
    const icon = await theme.innerHTML()
    await theme.click()
    // The sun becomes the moon.
    await expect.poll(() => theme.innerHTML()).not.toBe(icon)
    const lightOff = await settledShot(page)
    await toggle.click()
    const lightOn = await settledShot(page)
    expect(await pixelsDiffer(page, lightOff, lightOn)).toBeGreaterThan(1000)
    await toggle.click()
    expect(await pixelsDiffer(page, lightOff, await settledShot(page))).toBeLessThan(20)

    // The cube itself still takes a click where it is drawn: its centre is a zone, and a zone
    // click moves the camera, so no named view stays lit.
    const iso = page.locator('button[data-tip="3D perspective (Home)"]')
    const isoLit = await iso.evaluate((b) => getComputedStyle(b).color)
    await page.mouse.move(cb.x + 70, cb.y + 70)
    await page.mouse.move(cb.x + 74, cb.y + 70)
    await page.mouse.click(cb.x + 74, cb.y + 70)
    await expect.poll(() => iso.evaluate((b) => getComputedStyle(b).color)).not.toBe(isoLit)
  } finally {
    await app.close()
  }
})

test('the ground stands at the file’s zero, not at the height of the first part streamed', async () => {
  // 2026-10-01. `high-first.ifc` is a floor slab on the file's zero under a strip of roof 12 m
  // up, and the roof is the first product web-ifc streams — so the federation offset's Z is 12
  // and scene z = 0 is the roof. The ground used to stand there, the building hanging under it.
  // There is no DOM for the ground and this suite runs the production bundle, so it is read off
  // the canvas: seen in plan, the floor slab hides the canvas grid lying under it, so the grid
  // toggle changes nothing in the middle of the slab — and a great deal around the building.
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: HIGH_FIRST })
  try {
    await page.getByText(DROP_COPY).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('5 / 5')
    await page.locator('button[data-tip="Plan"]').click()

    // Plan frames the building's box, so the middle of the viewport is the middle of the 6 × 4 m
    // slab — about 280 × 185 px here — and 60 px of it is clear of the roof strip along one edge.
    const vp = (await page.locator('[data-role="viewport"]').boundingBox())!
    const middle = {
      x: Math.round(vp.x + vp.width / 2) - 30,
      y: Math.round(vp.y + vp.height / 2) - 30,
      width: 60,
      height: 60
    }
    const toggle = page.locator('button[data-tip="canvas grid"]')
    const on = { all: await settledShot(page), middle: await settledShot(page, 0, middle) }
    await toggle.click()
    const off = { all: await settledShot(page), middle: await settledShot(page, 0, middle) }
    expect(await pixelsDiffer(page, on.all, off.all)).toBeGreaterThan(1000)
    expect(await pixelsDiffer(page, on.middle, off.middle)).toBeLessThan(20)
  } finally {
    await app.close()
  }
})

/* ── 2026-09-24, owner-requested: the demo building, renaming a viewpoint, class colours ── */

const DEMO = 'try the demo building →'

async function openDemo(page: Page): Promise<void> {
  await page.getByRole('button', { name: DEMO }).click()
  await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
  await expect(page.locator('aside').getByText('SB_ARC_R25.ifc', { exact: true })).toBeVisible()
}

test('the demo building opens from a fresh landing page, and is never a recent', async () => {
  const { app, page } = await launch(dir)
  try {
    // A fresh profile: no recents, but the "or" divider and the demo button are there.
    const landing = page.locator('[data-role="landing"]')
    await expect(landing.getByText('Recent', { exact: true })).toHaveCount(0)
    await expect(landing.getByText('or', { exact: true })).toBeVisible()
    const demo = landing.getByRole('button', { name: DEMO })
    await expect(demo).toBeVisible()
    // The style string is "open all N as a federation →"'s, verbatim.
    expect(
      await demo.evaluate((b) => {
        const c = getComputedStyle(b)
        return [c.fontSize, c.fontWeight, c.alignSelf, c.paddingTop, c.paddingLeft]
      })
    ).toEqual(['12px', '500', 'flex-start', '2px', '0px'])

    await openDemo(page)
    // All four of the design's discipline models, and the design's own elements.
    const side = page.locator('aside')
    for (const name of ['SB_ARC_R25.ifc', 'SB_STR_R25.ifc', 'SB_SIT_R25.ifc', 'SB_MEP_R25.ifc']) {
      await expect(side.getByText(name, { exact: true })).toBeVisible()
    }
    const status = await statusText(page)
    const m = /(\d[\d\s]*) \/ (\d[\d\s]*)/.exec(status)!
    expect(Number(m[1].replace(/\s/g, ''))).toBeGreaterThan(100)

    // Nothing was added to the recents, so the next launch still has none.
    const recents = await page.evaluate(() =>
      (window as unknown as { sgvue: { listRecents(): Promise<unknown[]> } }).sgvue.listRecents()
    )
    expect(recents).toHaveLength(0)
  } finally {
    await app.close()
  }
})

test('the demo button sits under the Recent section when there are recents', async () => {
  {
    const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
    try {
      await page.getByText(DROP_COPY).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    } finally {
      await app.close()
    }
  }
  const { app, page } = await launch(dir)
  try {
    const landing = page.locator('[data-role="landing"]')
    const openAll = landing.getByRole('button', { name: /as a federation/ })
    const demo = landing.getByRole('button', { name: DEMO })
    await expect(landing.getByText('Recent', { exact: true })).toBeVisible()
    await expect(demo).toBeVisible()
    const a = (await openAll.boundingBox())!
    const b = (await demo.boundingBox())!
    expect(b.y).toBeGreaterThan(a.y + a.height)
    expect(Math.round(b.x)).toBe(Math.round(a.x))
  } finally {
    await app.close()
  }
})

test('a viewpoint is renamed by double-click: Enter keeps it, Esc cancels', async () => {
  const { app, page } = await launch(dir)
  try {
    await openDemo(page)
    await page.locator('button[data-tip="Saved viewpoints"]').click()
    await page.getByRole('button', { name: 'Save current view' }).click()
    const name = page.getByText('Viewpoint 1', { exact: true })
    await expect(name).toBeVisible()
    // The row itself, held by handle: the name's text is gone while it is being edited.
    const row = (await name.locator('xpath=../..').elementHandle())!
    const before = (await row.boundingBox())!

    await name.dblclick()
    const field = page.locator('input[data-role="view-rename"]')
    await expect(field).toBeFocused()
    // The whole name is selected, and the row did not move or grow.
    expect(
      await field.evaluate((i: HTMLInputElement) => [i.selectionStart, i.selectionEnd, i.value.length])
    ).toEqual([0, 11, 11])
    const during = (await row.boundingBox())!
    expect(during).toEqual(before)
    // Same font as the name it replaced.
    expect(
      await field.evaluate((i) => {
        const c = getComputedStyle(i)
        return [c.fontSize, c.fontWeight, c.lineHeight]
      })
    ).toEqual(['13px', '500', '16.9px'])

    await field.fill('  Entrance lobby  ')
    await field.press('Enter')
    await expect(field).toHaveCount(0)
    await expect(page.getByText('Entrance lobby', { exact: true })).toBeVisible()

    // Esc throws the edit away.
    await page.getByText('Entrance lobby', { exact: true }).dblclick()
    await field.fill('Something else')
    await field.press('Escape')
    await expect(field).toHaveCount(0)
    await expect(page.getByText('Entrance lobby', { exact: true })).toBeVisible()
    await expect(page.getByText('Something else')).toHaveCount(0)
    // The card is still open: Esc in the field is the field's.
    await expect(page.getByRole('button', { name: 'Save current view' })).toBeVisible()

    // A blank name keeps the old one.
    await page.getByText('Entrance lobby', { exact: true }).dblclick()
    await field.fill('   ')
    await field.press('Enter')
    await expect(page.getByText('Entrance lobby', { exact: true })).toBeVisible()

    // Refactor pass 2, P6: a rename in progress when the card closes does not come back with
    // it. Escape reaches the window's own handler — not the field's — and closes the card.
    await page.getByText('Entrance lobby', { exact: true }).dblclick()
    await expect(field).toBeFocused()
    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    )
    await expect(page.getByRole('button', { name: 'Save current view' })).toHaveCount(0)
    await page.locator('button[data-tip="Saved viewpoints"]').click()
    await expect(page.getByText('Entrance lobby', { exact: true })).toBeVisible()
    await expect(field).toHaveCount(0)
  } finally {
    await app.close()
  }

  // The name persists with the list: the next launch, the same building, the same name.
  const again = await launch(dir)
  try {
    await openDemo(again.page)
    await again.page.locator('button[data-tip="Saved viewpoints"]').click()
    await expect(again.page.getByText('Entrance lobby', { exact: true })).toBeVisible()
  } finally {
    await again.app.close()
  }
})

test('a spot shows its level only; a click on the tag shows E, N and Z, a second folds it', async () => {
  // 2026-09-28, owner-requested. The demo has no georeferencing, so the level is the file's own
  // z — and since 2026-10-08 the Coordinate-system card is read-only, so it stays the file's.
  const { app, page } = await launch(dir)
  try {
    await openDemo(page)
    await page.locator('button[data-tip="Spot coordinate (C)"]').click()
    const vp = (await page.locator('[data-role="viewport"]').boundingBox())!
    // The demo boots framed on its building, so the middle of the viewport is on it.
    const cx = vp.x + vp.width / 2
    const cy = vp.y + vp.height / 2
    await page.mouse.move(cx - 10, cy)
    await page.mouse.move(cx, cy)
    await page.mouse.click(cx, cy)
    await expect.poll(() => actionText(page)).toContain('1 spots')

    const overlay = page.locator('[data-role="overlay"]')
    const folded = overlay.locator(':scope > div[title="Show E, N and Z"]')
    const open = overlay.locator(':scope > div[title="Show level only"]')
    await expect(folded).toHaveCount(1)
    await expect(open).toHaveCount(0)
    // One line: the drawn mark, then the signed level to the millimetre.
    const level = (await folded.textContent())!.trim()
    expect(level).toMatch(/^[+−]\d+\.\d{3}$/)
    expect(await folded.evaluate((e) => e.firstElementChild?.tagName.toLowerCase())).toBe('svg')

    // What the canvas shows, labels aside: the camera, the selection and the model.
    const canvasOnly = async (): Promise<Buffer> => {
      await overlay.evaluate((e) => (e.style.visibility = 'hidden'))
      const shot = await settledShot(page)
      await overlay.evaluate((e) => (e.style.visibility = ''))
      return shot
    }
    const scene = await canvasOnly()

    // A click on the tag opens it to the design's grid, byte for byte, and does nothing else.
    await folded.click()
    await expect(open).toHaveCount(1)
    await expect(folded).toHaveCount(0)
    const html = await open.innerHTML()
    const xyz = (await open.locator('span').last().textContent())!.split(', ').map(Number)
    const f = { x: xyz[0] / 1000, y: xyz[1] / 1000, z: xyz[2] / 1000 }
    expect(html).toBe(spotGridHtml(f, null))
    // The level it showed folded is the file's z of that same point.
    expect(level).toBe(signedF3(f.z))
    expect(await actionText(page)).toContain('1 spots')
    expect(await pixelsDiffer(page, scene, await canvasOnly())).toBeLessThan(20)

    // A second click folds it again.
    await open.click()
    await expect(folded).toHaveCount(1)
    expect((await folded.textContent())!.trim()).toBe(level)
    expect(await actionText(page)).toContain('1 spots')

    // The Coordinate-system card is read-only (2026-10-08, the owner's): its four fields take no
    // typing, and the tag keeps the file's own level — the demo states no base point.
    await page.locator('button[data-tip="Coordinate system & true north"]').click()
    const field = (label: string) => page.locator('label', { hasText: label }).locator('input')
    for (const label of ['Easting m', 'Northing m', 'Elevation m', 'True north °']) {
      await expect(field(label)).toHaveAttribute('readonly', '')
      await expect(field(label)).toHaveValue('')
    }
    await field('Easting m').click()
    await page.keyboard.type('28500')
    await expect(field('Easting m')).toHaveValue('')
    await expect(folded).toHaveText(level)
    expect(await actionText(page)).toContain('1 spots')
  } finally {
    await app.close()
  }
})

/**
 * 2026-10-08 — coordinates part 2. The Coordinate-system card is read-only (the owner: *"Maybe just
 * make the coordinates system toggle a read only, dont let user change anything."*), its caption
 * names the method that placed the boot file, and a one-line note under the caption names a
 * model that could not be lined up (the owner's choice: *"One-line note on screen"*). Two synthetic
 * fixtures that line up, then one of them beside `tiny.ifc`, which states no map position.
 */
test('the Coordinate-system card is read-only, and names a model that could not be lined up', async () => {
  const A = join(ROOT, 'tests/fixtures/georef/a-site-placement.ifc')
  const B = join(ROOT, 'tests/fixtures/georef/b-map-conversion.ifc')
  const caption = (page: Page) => page.locator('span', { hasText: /^project base point/ })
  const field = (page: Page, label: string) => page.locator('label', { hasText: label }).locator('input')
  const note = (page: Page) => page.locator('[data-role="coords-note"]')

  // ── two files that line up: the file's base point, read-only, and no note ──
  {
    const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: `${A}:::${B}` })
    try {
      await page.getByText(DROP_COPY).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await page.locator('button[data-tip="Coordinate system & true north"]').click()
      await expect(caption(page)).toHaveText('project base point · IfcSite placement')
      const want: [string, string][] = [
        ['Easting m', '12345.457'],
        ['Northing m', '23456.766'],
        ['Elevation m', '5.05'],
        ['True north °', '-43.4103']
      ]
      for (const [label, value] of want) {
        await expect(field(page, label)).toHaveValue(value)
        await expect(field(page, label)).toHaveAttribute('readonly', '')
      }
      // Typing reaches no field; a value can still be selected, to be copied.
      await field(page, 'Northing m').click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type('30200')
      await expect(field(page, 'Northing m')).toHaveValue('23456.766')
      expect(
        await field(page, 'Northing m').evaluate((e) => {
          const i = e as HTMLInputElement
          return i.value.slice(i.selectionStart ?? 0, i.selectionEnd ?? 0)
        })
      ).toBe('23456.766')
      await expect(note(page)).toHaveCount(0)
      expect(await statusText(page)).toContain('SVY21')
    } finally {
      await app.close()
    }
  }

  // ── one of them beside a file with no map position: the note, on one line, its title whole ──
  {
    const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: `${A}:::${TINY}` })
    try {
      await page.getByText(DROP_COPY).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await page.locator('button[data-tip="Coordinate system & true north"]').click()
      const text = 'tiny.ifc could not be lined up — it has no map position.'
      await expect(note(page)).toHaveText(text)
      await expect(note(page)).toHaveAttribute('title', text)
      const style = await note(page).evaluate((e) => {
        const c = getComputedStyle(e)
        return [c.whiteSpace, c.overflow, c.textOverflow, c.fontSize, Math.round(e.getBoundingClientRect().height)]
      })
      expect(style.slice(0, 4)).toEqual(['nowrap', 'hidden', 'ellipsis', '12px'])
      // One line of 12 px text.
      expect(style[4]).toBeLessThan(20)
      // The base point is still the boot file's, and still read-only.
      await expect(field(page, 'Easting m')).toHaveValue('12345.457')
      await expect(field(page, 'Easting m')).toHaveAttribute('readonly', '')
    } finally {
      await app.close()
    }
  }
})

test('"Original materials" off colours the model by IFC class', async () => {
  const { app, page } = await launch(dir)
  try {
    await openDemo(page)
    const toggle = page.locator(
      'button[title="Use the surface materials that came with the loaded IFC files"]'
    )
    const on = await settledShot(page)
    await toggle.click()
    await expect(page.getByText('Coloured by IFC class', { exact: true })).toBeVisible()
    const off = await settledShot(page)
    expect(await pixelsDiffer(page, on, off)).toBeGreaterThan(5000)
    await toggle.click()
    await expect(page.getByText('Surface colours as authored in the IFC files')).toBeVisible()
    expect(await pixelsDiffer(page, on, await settledShot(page))).toBeLessThan(50)
  } finally {
    await app.close()
  }
})

/* ── 2026-09-28, owner-requested: the cut outline ─────────────────────────── */

/** Pixels within ±6 of `hex` in a PNG, decoded by the page itself. */
const pixelsOf = (page: Page, png: Buffer, hex: number): Promise<number> =>
  page.evaluate(
    async ([b64, want]) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const g = c.getContext('2d')!
      g.drawImage(bmp, 0, 0)
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data
      const r = (want >> 16) & 255
      const gg = (want >> 8) & 255
      const b = want & 255
      let n = 0
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - r) <= 6 && Math.abs(d[i + 1] - gg) <= 6 && Math.abs(d[i + 2] - b) <= 6) n++
      }
      return n
    },
    [png.toString('base64'), hex] as const
  )

test('a section outlines what it cuts in the accent; hide, preview, clear and the theme follow', async () => {
  // Asserted on the canvas's own pixels: the outline is the only thing drawn in the exact accent
  // there (the plane's outline is blended at 0.8, its preview sheet at 0.1, and the grid bubbles
  // are DOM, hidden for the capture). The segment count of a known wall is a unit test
  // (`tests/unit/section-cut.test.ts`), because this suite runs the production bundle.
  const DARK = 0x35c4b6
  const LIGHT = 0x0e8a80
  const { app, page } = await launch(dir)
  try {
    await openDemo(page)
    const overlay = page.locator('[data-role="overlay"]')
    const vp = (await page.locator('[data-role="viewport"]').boundingBox())!
    // Right of the Section card (12 + 300 px), clear of the toolbar, the cube and the status bar.
    const clip = { x: vp.x + 330, y: vp.y + 64, width: vp.width - 500, height: vp.height - 124 }
    const accent = async (hex: number): Promise<number> => {
      await overlay.evaluate((e) => (e.style.visibility = 'hidden'))
      const shot = await settledShot(page, 800, clip)
      await overlay.evaluate((e) => (e.style.visibility = ''))
      return pixelsOf(page, shot, hex)
    }

    const none = await accent(DARK)
    await page.locator('button[data-tip="Section from gridline / level"]').click()
    await page.getByRole('button', { name: 'C', exact: true }).click()
    // Grid C cut, the camera square to the plane: an elevation, outlined.
    const cut = await accent(DARK)
    expect(cut).toBeGreaterThan(1000)
    expect(none).toBeLessThan(cut / 50)

    // Hide one element the plane cuts — the L3 floor slab, cut across its whole width — and its
    // outline goes.
    await page.getByPlaceholder('find an element…').fill('Floor Slab L3')
    const eye = page.locator('aside button[title="Show / hide"]')
    await expect(eye).toHaveCount(1)
    await eye.click()
    const hidden = await accent(DARK)
    expect(hidden).toBeLessThan(cut * 0.97)
    await eye.click()
    expect(Math.abs((await accent(DARK)) - cut)).toBeLessThan(cut / 50)

    // Preview (`cut` off): the plane is shown, nothing is cut, nothing is outlined. The card has
    // two planes since 2026-10-01, each with its own controls; these are the gridline plane's.
    const gridBlock = page.getByRole('group', { name: 'Along a gridline' })
    const cutBtn = gridBlock.getByRole('button', { name: 'cut', exact: true })
    await cutBtn.click()
    expect(await accent(DARK)).toBeLessThan(cut / 50)
    await cutBtn.click()
    expect(Math.abs((await accent(DARK)) - cut)).toBeLessThan(cut / 50)

    // The theme recolours it: light's accent, and none of dark's.
    const theme = page.locator('button[data-tip="Light / dark"]')
    const tb = (await theme.boundingBox())!
    await page.mouse.move(tb.x + tb.width / 2 - 20, tb.y + tb.height / 2)
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
    await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2)
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
    expect(await accent(LIGHT)).toBeGreaterThan(cut / 2)
    expect(await accent(DARK)).toBeLessThan(cut / 50)

    // Cleared: gone.
    await gridBlock.getByRole('button', { name: 'Clear', exact: true }).click()
    expect(await accent(LIGHT)).toBeLessThan(cut / 50)
  } finally {
    await app.close()
  }
})

/* ── 2026-10-01, owner-requested: two section planes — a gridline cut and a level cut ── */

/** One block of the Section card: its summary line, its offset field and its own buttons. */
function sectionBlock(page: Page, label: 'Along a gridline' | 'At a level') {
  const block = page.getByRole('group', { name: label })
  // The summary names the field's unit: `mm`, `m` or `ft` since 2026-10-09.
  const summary = block.getByText(/^offset (mm|m|ft) · /)
  return {
    block,
    summary: (): Promise<string> =>
      summary.evaluate((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()),
    /** The summary's native tooltip, and whether its own line is too narrow for its text. */
    summaryLine: (): Promise<{ title: string | null; clipped: boolean }> =>
      summary.evaluate((e) => ({ title: e.getAttribute('title'), clipped: e.scrollWidth > e.clientWidth })),
    offset: block.locator('input'),
    button: (name: string) => block.getByRole('button', { name, exact: true })
  }
}

/** The two keys the autosave writes for the section: both planes, and the legacy single one. */
async function savedSections(userData: string): Promise<{ sections: unknown; section: unknown } | null> {
  try {
    const { payload } = await readSession(userData)
    return { sections: payload.sections, section: payload.section }
  } catch {
    return null
  }
}

test('a gridline cut and a level cut are independent: own offset, cut, flip side and Clear, and Clear all', async () => {
  const DARK = 0x35c4b6
  const NONE = { name: '', offset: 0, flip: false, cut: false }
  const { app, page } = await launch(dir)
  try {
    await openDemo(page)
    const overlay = page.locator('[data-role="overlay"]')
    const vp = (await page.locator('[data-role="viewport"]').boundingBox())!
    const clip = { x: vp.x + 330, y: vp.y + 64, width: vp.width - 500, height: vp.height - 124 }
    /** Pixels of the cut outline: the one thing drawn in the exact accent on the canvas. */
    const accent = async (): Promise<number> => {
      await overlay.evaluate((e) => (e.style.visibility = 'hidden'))
      const shot = await settledShot(page, 800, clip)
      await overlay.evaluate((e) => (e.style.visibility = ''))
      return pixelsOf(page, shot, DARK)
    }
    const sectionBtn = page.locator('button[data-tip="Section from gridline / level"]')
    const lit = (): Promise<string> => sectionBtn.evaluate((b) => getComputedStyle(b).color)
    const idle = await lit()

    await sectionBtn.click()
    const grid = sectionBlock(page, 'Along a gridline')
    const level = sectionBlock(page, 'At a level')

    // ── the card: Clear all beside the ×, the gridline chips in two rows with a rule between,
    //    and each block with its own offset row and its own cut / flip side / Clear ──
    await expect(page.getByRole('button', { name: 'Clear all', exact: true })).toBeVisible()
    const rule = grid.block.locator('span[aria-hidden="true"]')
    await expect(rule).toHaveCount(1)
    await expect(level.block.locator('span[aria-hidden="true"]')).toHaveCount(0)
    // Every box read in one go, once the card's 150 ms fade-in has finished moving it.
    const card = grid.block.locator('xpath=..')
    await card.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)))
    const rows = await grid.block.evaluate((block) => {
      const top = (e: Element): number => Math.round(e.getBoundingClientRect().top)
      const line = block.querySelector('span[aria-hidden="true"]')!.getBoundingClientRect()
      const chip: Record<string, number> = {}
      for (const b of block.querySelectorAll('button')) chip[(b.textContent || '').trim()] = top(b)
      return {
        rule: Math.round(line.top),
        ruleHeight: line.height,
        ruleWidth: Math.round(line.width),
        width: block.clientWidth,
        chip
      }
    })
    // A 1 px rule across the block, A…E on one row above it, 1…4 on one row below it.
    expect([rows.ruleHeight, rows.ruleWidth]).toEqual([1, rows.width])
    const rowOf = (names: string[]): number[] => [...new Set(names.map((n) => rows.chip[n]))]
    const upper = rowOf(['A', 'B', 'C', 'D', 'E'])
    const lower = rowOf(['1', '2', '3', '4'])
    expect([upper.length, lower.length]).toEqual([1, 1])
    expect(upper[0]).toBeLessThan(rows.rule)
    expect(lower[0]).toBeGreaterThan(rows.rule)
    for (const b of [grid, level]) {
      await expect(b.offset).toHaveValue('0')
      expect(await b.summary()).toBe('offset mm · no section')
      for (const name of ['−500', '+500', 'cut', 'flip side', 'Clear']) await expect(b.button(name)).toBeVisible()
      // The summary has a line of its own, the block's whole width, 6 px above its three buttons,
      // which stand in a row of their own, right-aligned, in the design's order. Beside the
      // buttons it had about 75 px and read `offset mm …`.
      const line = await b.block.evaluate((block) => {
        const box = (e: Element): DOMRect => e.getBoundingClientRect()
        const span = [...block.querySelectorAll('span')].find((e) => /^offset mm · /.test(e.textContent || ''))!
        const row = span.nextElementSibling!
        return {
          width: Math.round(box(span).width),
          block: block.clientWidth,
          gap: +(box(row).top - box(span).bottom).toFixed(2),
          names: [...row.children].map((e) => `${e.tagName}:${(e.textContent || '').trim()}`),
          // Right-aligned: the last button ends where the block does, the first starts inside it.
          flushRight: Math.abs(box(row.lastElementChild!).right - box(block).right) < 0.01,
          startsInside: box(row.firstElementChild!).left - box(block).left > 20
        }
      })
      expect(line).toEqual({
        width: line.block,
        block: line.block,
        gap: 6,
        names: ['BUTTON:cut', 'BUTTON:flip side', 'BUTTON:Clear'],
        flushRight: true,
        startsInside: true
      })
      expect(await b.summaryLine()).toEqual({ title: 'offset mm · no section', clipped: false })
    }
    // The card stops above the status bar and scrolls inside itself, as the Markups card does.
    expect(await card.evaluate((e) => [getComputedStyle(e).overflowY, e.style.maxHeight])).toEqual([
      'auto',
      'calc(100% - 110px - var(--abar, 0px))'
    ])

    // ── a gridline cut, then a level cut beside it: both on, neither replacing the other ──
    await grid.button('C').click()
    expect(await grid.summary()).toBe('offset mm · grid C · cut')
    expect(await level.summary()).toBe('offset mm · no section')
    const one = await accent()
    expect(one).toBeGreaterThan(1000)

    await level.button('L2').click()
    expect(await level.summary()).toBe('offset mm · level L2 · cut')
    expect(await grid.summary()).toBe('offset mm · grid C · cut')
    await expect(level.offset).toHaveValue('1200')
    await expect(grid.offset).toHaveValue('0')
    // The session carries both planes — and the old single key, for a build that knows no other.
    await expect
      .poll(() => savedSections(dir), { timeout: 20_000 })
      .toEqual({
        sections: {
          grid: { name: 'C', offset: 0, flip: false, cut: true },
          level: { name: 'L2', offset: 1200, flip: false, cut: true }
        },
        section: { kind: 'grid', name: 'C', offset: 0, flip: false, cut: true }
      })
    // Both planes are outlined where they cut, in the accent.
    const two = await accent()
    expect(two).toBeGreaterThan(1000)

    // ── one offset moves, the other does not ──
    await level.button('+500').click()
    await expect(level.offset).toHaveValue('1700')
    await expect(grid.offset).toHaveValue('0')
    await grid.offset.fill('250')
    await expect(grid.offset).toHaveValue('250')
    await expect(level.offset).toHaveValue('1700')
    await grid.button('−500').click()
    await expect(grid.offset).toHaveValue('-250')
    await expect(level.offset).toHaveValue('1700')

    // ── flip one: only its own summary says so ──
    await grid.button('flip side').click()
    expect(await grid.summary()).toBe('offset mm · grid C · cut · flipped')
    expect(await level.summary()).toBe('offset mm · level L2 · cut')
    // The longest summary there is, read whole on its own line — and the same text on hover.
    expect(await grid.summaryLine()).toEqual({ title: 'offset mm · grid C · cut · flipped', clipped: false })
    expect(await level.summaryLine()).toEqual({ title: 'offset mm · level L2 · cut', clipped: false })

    // ── one plane's cut off is a preview of that plane; the other still cuts ──
    await level.button('cut').click()
    expect(await level.summary()).toBe('offset mm · level L2 · plane only')
    expect(await grid.summary()).toBe('offset mm · grid C · cut · flipped')
    await level.button('cut').click()
    expect(await level.summary()).toBe('offset mm · level L2 · cut')

    // ── a viewpoint names both planes, and brings both back ──
    await page.locator('button[data-tip="Saved viewpoints"]').click()
    await page.getByRole('button', { name: 'Save current view' }).click()
    await expect(page.getByText('grid C + level L2', { exact: true })).toBeVisible()
    await sectionBtn.click()

    // ── Clear one: the other stays exactly as it was ──
    await level.button('Clear').click()
    expect(await level.summary()).toBe('offset mm · no section')
    await expect(level.offset).toHaveValue('0')
    expect(await grid.summary()).toBe('offset mm · grid C · cut · flipped')
    await expect(grid.offset).toHaveValue('-250')
    await expect
      .poll(() => savedSections(dir), { timeout: 20_000 })
      .toEqual({
        sections: { grid: { name: 'C', offset: -250, flip: true, cut: true }, level: NONE },
        section: { kind: 'grid', name: 'C', offset: -250, flip: true, cut: true }
      })
    // The gridline cut is still drawn — seen edge-on here, from the level plane's plan view.
    expect(await accent()).toBeGreaterThan(100)

    // ── Clear all: both gone, the model whole, the old key back to "none" ──
    await level.button('L3').click()
    expect(await level.summary()).toBe('offset mm · level L3 · cut')
    await page.getByRole('button', { name: 'Clear all', exact: true }).click()
    for (const b of [grid, level]) {
      expect(await b.summary()).toBe('offset mm · no section')
      await expect(b.offset).toHaveValue('0')
    }
    await expect
      .poll(() => savedSections(dir), { timeout: 20_000 })
      .toEqual({
        sections: { grid: NONE, level: NONE },
        section: { kind: null, name: '', offset: 0, flip: false, cut: false }
      })
    expect(await accent()).toBeLessThan(one / 50)

    // ── the toolbar button is lit while either plane is set, the card closed ──
    await page.locator('button[data-tip="Section from gridline / level"]').click()
    await expect(page.getByRole('group', { name: 'Along a gridline' })).toHaveCount(0)
    expect(await lit()).toBe(idle)
    // The saved viewpoint restores both planes; the button lights with the card still closed.
    await page.locator('button[data-tip="Saved viewpoints"]').click()
    await page.getByText('Viewpoint 1', { exact: true }).click()
    await page.locator('button[data-tip="Saved viewpoints"]').click()
    await expect.poll(lit).not.toBe(idle)
    await sectionBtn.click()
    expect(await grid.summary()).toBe('offset mm · grid C · cut · flipped')
    expect(await level.summary()).toBe('offset mm · level L2 · cut')
    await expect(grid.offset).toHaveValue('-250')
    await expect(level.offset).toHaveValue('1700')
    // Only the level plane left: still lit once the card is closed.
    await grid.button('Clear').click()
    await sectionBtn.click()
    await expect.poll(lit).not.toBe(idle)
  } finally {
    await app.close()
  }
})

test('a share link written before there were two planes still restores its one section', async () => {
  // ── a real session's payload, put back into the shape every build before 2026-10-01 wrote:
  //    one `section`, no `sections` ──
  let link = ''
  {
    const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
    try {
      await page.getByText(DROP_COPY).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await expect
        .poll(async () => {
          try {
            return (await readSession(dir)).payload.models
          } catch {
            return null
          }
        }, { timeout: 20_000 })
        .toEqual(['tiny'])
      const { payload } = await readSession(dir)
      // This build writes both keys; the old one says "none" while nothing is cut.
      expect(payload.sections).toEqual({
        grid: { name: '', offset: 0, flip: false, cut: false },
        level: { name: '', offset: 0, flip: false, cut: false }
      })
      expect(payload.section).toEqual({ kind: null, name: '', offset: 0, flip: false, cut: false })
      // 2026-10-09: the fixture is drawn in metres, so the app starts in `m` — and says so.
      expect(payload.units).toBe('m')
      const old: Record<string, unknown> = { ...payload }
      delete old.sections
      old.section = { kind: 'level', name: 'Level 2', offset: 1500, flip: false, cut: true }
      link =
        'sgvue://s=' +
        Buffer.from(JSON.stringify(old), 'utf8')
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
    } finally {
      await app.close()
    }
  }

  const fresh = await mkdtemp(join(tmpdir(), 'sgvue-e2e-oldlink-'))
  const { app, page } = await launch(fresh, { SGVUE_LINK: link })
  try {
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('6 / 6')
    // The old section is on the level plane; the gridline plane is untouched. Its 1 500 mm read
    // in metres since 2026-10-09: the fixture is drawn in metres, and the app starts in its unit.
    await page.locator('button[data-tip="Section from gridline / level"]').click()
    const grid = sectionBlock(page, 'Along a gridline')
    const level = sectionBlock(page, 'At a level')
    expect(await level.summary()).toBe('offset m · level Level 2 · cut')
    await expect(level.offset).toHaveValue('1.5')
    expect(await grid.summary()).toBe('offset m · no section')
    await expect(grid.offset).toHaveValue('0')
    // It really cuts: the plane's outline of the model is on the canvas, in the accent.
    const overlay = page.locator('[data-role="overlay"]')
    const vp = (await page.locator('[data-role="viewport"]').boundingBox())!
    const clip = { x: vp.x + 330, y: vp.y + 64, width: vp.width - 500, height: vp.height - 124 }
    await overlay.evaluate((e) => (e.style.visibility = 'hidden'))
    const cut = await pixelsOf(page, await settledShot(page, 800, clip), 0x35c4b6)
    await level.button('Clear').click()
    const whole = await pixelsOf(page, await settledShot(page, 800, clip), 0x35c4b6)
    await overlay.evaluate((e) => (e.style.visibility = ''))
    expect(cut).toBeGreaterThan(100)
    expect(whole).toBeLessThan(cut / 20)
    // And what this build writes from here on carries both keys again.
    await expect
      .poll(() => savedSections(fresh), { timeout: 20_000 })
      .toEqual({
        sections: {
          grid: { name: '', offset: 0, flip: false, cut: false },
          level: { name: '', offset: 0, flip: false, cut: false }
        },
        section: { kind: null, name: '', offset: 0, flip: false, cut: false }
      })
  } finally {
    await app.close()
    await rm(fresh, { recursive: true, force: true })
  }
})

/* ── 2026-10-01, owner-requested: the action bar, the grouped toolbar, the eye-first tree,
 *    hover titles for clipped text and for file paths ─────────────────────────── */

interface Box {
  x: number
  y: number
  width: number
  height: number
}
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** A click on the canvas the way a hand does it: the pointer arrives, then clicks. */
async function clickAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x - 10, y)
  await page.mouse.move(x, y)
  await page.mouse.click(x, y)
}

test('the status bar keeps its five fields; undo, redo and the markup counts are a bar above it', async () => {
  const { app, page } = await launch(dir)
  try {
    await openDemo(page)
    const stage = page.locator('[data-role="stage"]')
    const status = page.locator('[data-role="statusbar"]')
    const bar = page.locator('[data-role="actionbar"]')
    const pill = page.locator('[data-role="resetpill"]')
    const lane = (): Promise<string> =>
      stage.evaluate((e) => getComputedStyle(e).getPropertyValue('--abar').trim())
    const tags = (of: typeof bar): Promise<string[]> =>
      of.evaluate((e) => [...e.children].map((k) => k.tagName))
    /** The status bar's third field, `visible / total`. */
    const count = async (): Promise<string> => (await statusText(page)).split('·')[2]

    // 1 — at rest: five fields, four dots and no button; no action bar, and no lane for one.
    // (Polled: the backend's name arrives with the viewer's first frame-rate report.)
    await expect(status).toHaveCount(1)
    await expect
      .poll(() => statusText(page), { timeout: 20_000 })
      .toMatch(/^(WebGL2|WebGPU)·\d+ fps·\d+ \/ \d+·mm·—$/)
    expect(await tags(status)).toEqual(Array(9).fill('SPAN'))
    await expect(bar).toHaveCount(0)
    expect(await lane()).toBe('0px')
    const atRest = (await status.boundingBox())!
    const all = await count()

    // 2 — a spot and a laser measure: the bar appears, two groups, no dot in front of the first.
    const vp = (await page.locator('[data-role="viewport"]').boundingBox())!
    const [cx, cy] = [vp.x + vp.width / 2, vp.y + vp.height / 2]
    await page.locator('button[data-tip="Spot coordinate (C)"]').click()
    await clickAt(page, cx, cy)
    await expect.poll(() => actionText(page)).toBe('1 spotsclear')
    await page.locator('button[data-tip^="Laser meter"]').click()
    // Left of the spot's tag, which stands to the right of its point and takes a click itself.
    await clickAt(page, cx - 60, cy + 30)
    await expect.poll(() => actionText(page)).toBe('1 measuresclear·1 spotsclear')
    expect(await tags(bar)).toEqual(['BUTTON', 'BUTTON', 'SPAN', 'BUTTON', 'BUTTON'])
    await page.locator('button[data-tip^="Select (Esc)"]').click()

    // 3 — a storey hidden: `undo` leads, the lane is declared, the status bar is still five fields.
    await page.locator('button[title="Show / hide storey"]').nth(2).click()
    await expect.poll(() => actionText(page)).toBe('undo·1 measuresclear·1 spotsclear')
    await expect.poll(count).not.toBe(all)
    expect(await lane()).toBe('30px')
    expect(await tags(status)).toEqual(Array(9).fill('SPAN'))
    await expect(status.locator('button')).toHaveCount(0)
    await expect(pill).toHaveCount(1)

    // The bar is the status bar's own card, 3 px above it; neither runs under the reset pill.
    const sb = (await status.boundingBox())!
    const ab = (await bar.boundingBox())!
    const pb = (await pill.boundingBox())!
    expect(ab.x).toBe(sb.x)
    expect(ab.height).toBe(sb.height)
    expect(sb.y - (ab.y + ab.height)).toBeCloseTo(3, 5)
    // Its width no longer depends on what has been done: at most a digit of the live fields.
    expect(Math.abs(sb.width - atRest.width)).toBeLessThan(15)
    expect(overlaps(sb, pb)).toBe(false)
    expect(overlaps(ab, pb)).toBe(false)

    // 4 — the bar's own count opens the Markups card, which stops above the bar.
    const measures = bar.locator('button', { hasText: '1 measures' })
    await expect(measures).toHaveAttribute('data-tip', 'Open the markups list')
    await measures.click()
    const card = stage.locator(':scope > div').filter({ hasText: /^Markups/ })
    await expect(card).toBeVisible()
    expect(await card.evaluate((e) => getComputedStyle(e).maxHeight)).toBe('calc(100% - 140px)')
    const cb = (await card.boundingBox())!
    expect(cb.y + cb.height).toBeLessThan(ab.y)
    await measures.click()
    await expect(card).toHaveCount(0)

    // 5 — undo puts the storey back and leaves redo; redo hides it again.
    await bar.locator('button', { hasText: 'undo' }).click()
    await expect.poll(() => actionText(page)).toBe('redo·1 measuresclear·1 spotsclear')
    await expect.poll(count).toBe(all)
    await expect(pill).toHaveCount(0)
    await bar.locator('button', { hasText: 'redo' }).click()
    await expect.poll(() => actionText(page)).toBe('undo·1 measuresclear·1 spotsclear')
    await expect.poll(count).not.toBe(all)

    // 6 — each `clear` empties its own list; with only history left, the bar is `undo`.
    await bar.locator('button', { hasText: 'clear' }).first().click()
    await expect.poll(() => actionText(page)).toBe('undo·1 spotsclear')
    await bar.locator('button', { hasText: 'clear' }).click()
    await expect.poll(() => actionText(page)).toBe('undo')
    expect(await tags(bar)).toEqual(['BUTTON'])
    expect(await lane()).toBe('30px')
  } finally {
    await app.close()
  }
})

/** The five pieces of the stage's bottom row (`app/BottomRow.tsx`), each by the mark it carries. */
const BOTTOM = {
  status: '[data-role="statusbar"]',
  action: '[data-role="actionbar"]',
  hint: '[data-role="hintbar"]',
  pill: '[data-role="resetpill"]',
  ask: 'button[data-tip^="Ask the assistant"]'
} as const
type BottomBoxes = Record<keyof typeof BOTTOM, Box | null>

const bottomBoxes = (page: Page): Promise<BottomBoxes> =>
  page.evaluate(
    (sel) =>
      Object.fromEntries(
        Object.entries(sel).map(([name, q]) => {
          const b = document.querySelector(q)?.getBoundingClientRect()
          return [name, b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null]
        })
      ) as BottomBoxes,
    BOTTOM
  )

/** Every pair of the pieces on screen that intersects, as `a×b`. */
function meetings(boxes: Record<string, Box | null>): string[] {
  const shown = Object.entries(boxes).filter((e): e is [string, Box] => e[1] !== null)
  const out: string[] = []
  shown.forEach(([a, boxA], i) => {
    for (const [b, boxB] of shown.slice(i + 1)) if (overlaps(boxA, boxB)) out.push(`${a}×${b}`)
  })
  return out
}

/**
 * The row's boxes once it has finished re-laying itself out after a window resize.
 *
 * `BottomRow` measures itself in a `ResizeObserver` and places its centre zone in the render
 * that follows. So for about a frame after the window changes size, the page holds the layout
 * from *before* that placement — at 760 px the hint squeezed to 62 px between the two bars —
 * and nothing in it overlaps, so "no two pieces meet" is already true of it. Reading the boxes
 * there is what failed this test three runs in ten (2026-10-01, measured on the build before
 * this fix). The boxes are therefore read until two consecutive reads, 100 ms apart, give the
 * same rectangles with nothing meeting: the first read only sets the mark, so the earliest
 * answer is the second one.
 */
async function settledBottomBoxes(page: Page): Promise<BottomBoxes> {
  let boxes = {} as BottomBoxes
  let last = ''
  await expect
    .poll(
      async () => {
        boxes = await bottomBoxes(page)
        const now = JSON.stringify(boxes)
        const settled = now === last && meetings(boxes).length === 0
        last = now
        return settled
      },
      { intervals: [100], timeout: 10_000, message: 'the bottom row never stood still after the resize' }
    )
    .toBe(true)
  return boxes
}

test('the bottom edge is one row: the bars, the hint, the reset pill and the Ask pill never meet', async () => {
  const { app, page } = await launch(dir)
  try {
    await openDemo(page)
    const stageBox = async (): Promise<Box> => (await page.locator('[data-role="stage"]').boundingBox())!
    /** How far a box stands from the stage's left, right and bottom edges. */
    const inset = (b: Box, st: Box): { left: number; right: number; bottom: number } => ({
      left: b.x - st.x,
      right: st.x + st.width - (b.x + b.width),
      bottom: st.y + st.height - (b.y + b.height)
    })
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toMatch(/^(WebGL2|WebGPU)·\d+ fps/)
    /** The row's lane on the stage: what its centre zone stands above one line (2026-10-01). */
    const lane = (): Promise<string> =>
      page.locator('[data-role="stage"]').evaluate((e) => getComputedStyle(e).getPropertyValue('--brow').trim())

    // 1 — at rest the two pieces that are always there stand where the design put them: the
    // status bar at `left:12px;bottom:12px`, the Ask pill at `right:12px;bottom:14px`.
    const st = await stageBox()
    const rest = await bottomBoxes(page)
    expect([rest.action, rest.hint, rest.pill]).toEqual([null, null, null])
    expect(inset(rest.status!, st).left).toBeCloseTo(12, 3)
    expect(inset(rest.status!, st).bottom).toBeCloseTo(12, 3)
    expect(inset(rest.ask!, st).right).toBeCloseTo(12, 3)
    expect(inset(rest.ask!, st).bottom).toBeCloseTo(14, 3)
    expect(await lane()).toBe('0px')
    // The row itself takes no clicks: across the gap between its zones, nothing under the
    // pointer is the row's — it is the canvas, or a grid bubble that stands there.
    const gap = await page.evaluate(
      ([from, to, y]) => {
        const rows: boolean[] = []
        for (let x = from; x < to; x += 20) {
          rows.push(!!document.elementFromPoint(x, y)?.closest('[data-role="bottomrow"]'))
        }
        return rows
      },
      [rest.status!.x + rest.status!.width + 4, rest.ask!.x - 4, rest.status!.y + rest.status!.height / 2]
    )
    expect(gap.length).toBeGreaterThan(10)
    expect(gap).not.toContain(true)

    // 2 — the reset pill alone stands on the stage's centre line at `bottom:14px`, as designed.
    const vp = (await page.locator('[data-role="viewport"]').boundingBox())!
    const [cx, cy] = [vp.x + vp.width / 2, vp.y + vp.height / 2]
    await page.locator('button[data-tip="Spot coordinate (C)"]').click()
    await clickAt(page, cx, cy)
    await expect.poll(() => actionText(page)).toBe('1 spotsclear')
    await page.locator('button[data-tip^="Laser meter"]').click()
    await clickAt(page, cx - 60, cy + 30)
    await expect.poll(() => actionText(page)).toBe('1 measuresclear·1 spotsclear')
    await page.locator('button[data-tip^="Select (Esc)"]').click()
    await page.locator('button[title="Show / hide storey"]').nth(2).click()
    await expect.poll(() => actionText(page)).toBe('undo·1 measuresclear·1 spotsclear')
    const alone = await bottomBoxes(page)
    expect(alone.hint).toBeNull()
    expect(alone.pill!.x + alone.pill!.width / 2).toBeCloseTo(st.x + st.width / 2, 1)
    expect(inset(alone.pill!, st).bottom).toBeCloseTo(14, 3)
    expect(meetings(alone)).toEqual([])
    // One line is the design's own layout: no lane is declared for it.
    expect(await lane()).toBe('0px')
    // The row takes no pointer events and its pieces do: a `data-tip` still shows on hover.
    await page.locator(`${BOTTOM.action} button`).first().hover()
    await expect
      .poll(() =>
        page.evaluate(
          (q) => getComputedStyle(document.querySelector(`${q} button`)!, '::after').opacity,
          BOTTOM.action
        )
      )
      .toBe('1')

    // 3 — the laser tool. Its hint is 522 px on one line, which the design centred on the stage:
    // under the status bar, and under the pill. Here all five are on screen and no two meet.
    await page.locator('button[data-tip^="Laser meter"]').click()
    await expect(page.locator(BOTTOM.hint)).toHaveText(/^Click a surface — the laser reads X, Y and Z/)
    const five = await bottomBoxes(page)
    expect(Object.values(five).every(Boolean)).toBe(true)
    expect(meetings(five)).toEqual([])
    // The hint starts a zone gap clear of both bars, on one line, at `bottom:14px`…
    const barsEnd = Math.max(five.status!.x + five.status!.width, five.action!.x + five.action!.width)
    expect(five.hint!.x - barsEnd).toBeGreaterThanOrEqual(BOTTOM_GAP - 0.01)
    expect(five.hint!.height).toBeLessThan(34)
    expect(inset(five.hint!, st).bottom).toBeCloseTo(14, 3)
    // …the pill stands above it, 6 px clear…
    expect(five.hint!.y - (five.pill!.y + five.pill!.height)).toBeCloseTo(6, 3)
    // …and neither of the two that were already there has moved.
    expect([five.status!.x, five.status!.y, five.ask!.x, five.ask!.y]).toEqual([
      rest.status!.x,
      rest.status!.y,
      rest.ask!.x,
      rest.ask!.y
    ])

    // 3b — 2026-10-01, the row's lane. The centre zone is two levels tall here — the reset pill
    // over the hint — and the design stops the chat panel 52 px, and the property card 56 px,
    // above the stage's foot, which is room for one. So the row declares what it stands above
    // that line as `--brow`, and the four things that used to meet no longer do: an element
    // selected (its card), the assistant's panel open (in the card's lane), the laser's hint and
    // something hidden (the pill above the hint).
    const tall = Math.ceil(st.y + st.height - five.pill!.y + 6 - 52)
    expect(tall).toBeGreaterThan(0)
    expect(await lane()).toBe(`${tall}px`)
    await page.locator('button[data-tip^="Select (Esc)"]').click()
    const tree = page.locator('[role="tree"]')
    await tree.locator('[role="treeitem"]').first().click()
    await tree.locator('[role="treeitem"][aria-level="2"]').first().click()
    const card = page.locator('[data-role="propcard"]')
    await expect(card).toBeVisible()
    await page.locator(BOTTOM.ask).click()
    const panel = page.locator('[data-role="chatlog"]').locator('xpath=..')
    await expect(panel).toBeVisible()
    // With the row one line again — the hint went with the laser tool — both are the design's:
    // the panel `bottom:52px` and no taller than the stage less `cardTop` and 64 px, the card no
    // taller than the stage less 240 px.
    const cardTop = Math.round((await page.locator('[data-role="toolbar"]').boundingBox())!.height) + 24
    const panelStyle = (): Promise<string[]> =>
      panel.evaluate((e) => [getComputedStyle(e).bottom, getComputedStyle(e).maxHeight])
    const cardStyle = (): Promise<string> => card.evaluate((e) => getComputedStyle(e).maxHeight)
    expect(await lane()).toBe('0px')
    expect(await panelStyle()).toEqual(['52px', `calc(100% - ${cardTop + 64}px)`])
    expect(await cardStyle()).toBe('calc(100% - 240px)')
    await page.locator('button[data-tip^="Laser meter"]').click()
    await expect(page.locator(BOTTOM.hint)).toHaveText(/^Click a surface — the laser reads X, Y and Z/)
    await expect.poll(lane).toBe(`${tall}px`)
    // Both panels are settled (each fades in over 150 ms) before their boxes are read.
    for (const box of [panel, card]) await box.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)))
    const four = { ...(await bottomBoxes(page)), panel: (await panel.boundingBox())!, card: (await card.boundingBox())! }
    expect(Object.values(four).every(Boolean)).toBe(true)
    expect(meetings(four)).toEqual([])
    // The panel stops the design's 6 px above the pill (the lane is whole pixels, so up to 7),
    // and the card the 4 px further up it always stopped.
    const overPill = four.pill!.y - (four.panel.y + four.panel.height)
    expect(overPill).toBeGreaterThanOrEqual(6)
    expect(overPill).toBeLessThan(7)
    expect(await panelStyle()).toEqual([`${52 + tall}px`, `calc(100% - ${cardTop + 64 + tall}px)`])
    expect(await cardStyle()).toBe(`calc(100% - ${240 + tall}px)`)
    // The row itself is as it was: the lane feeds nothing back into what it was measured from.
    expect([four.hint!.y, four.hint!.height, four.pill!.y, four.pill!.height]).toEqual([
      five.hint!.y,
      five.hint!.height,
      five.pill!.y,
      five.pill!.height
    ])
    expect([four.status!.x, four.status!.y, four.ask!.x, four.ask!.y]).toEqual([
      rest.status!.x,
      rest.status!.y,
      rest.ask!.x,
      rest.ask!.y
    ])
    // Put back: the panel closed and nothing selected, the laser tool still active.
    await page.locator(BOTTOM.ask).click()
    await expect(page.locator('[data-role="chatlog"]')).toHaveCount(0)
    await card.locator('button[title="Close (Esc)"]').click()
    await expect(card).toHaveCount(0)

    // 4 — narrower windows, the sidebar open. A hint wraps where it stands, but never narrower
    // than `HINT_MIN`; and where the bars leave the centre less room than it needs beside them,
    // it stands above them instead, 6 px clear — at 760 px, and since the Ask pill reads
    // `Ask Vee` (89 px, 67 before) at 900 px too, where 180 px are left of the 200 a hint needs.
    const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
    const resize = async (w: number, h: number): Promise<BottomBoxes> => {
      await app.evaluate(
        ({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch),
        [w, h]
      )
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(w)
      // Not `bottomBoxes` straight away: the row places its centre a frame after the window
      // has its new size (`settledBottomBoxes`).
      return settledBottomBoxes(page)
    }
    const at900 = await resize(900, 700)
    expect(Object.values(at900).every(Boolean)).toBe(true)
    expect(at900.hint!.width).toBeGreaterThanOrEqual(HINT_MIN - 0.01)
    expect(at900.action!.y - (at900.hint!.y + at900.hint!.height)).toBeCloseTo(6, 3)
    expect(at900.hint!.y - (at900.pill!.y + at900.pill!.height)).toBeCloseTo(6, 3)
    const at760 = await resize(760, 700)
    expect(Object.values(at760).every(Boolean)).toBe(true)
    expect(at760.hint!.width).toBeGreaterThanOrEqual(HINT_MIN - 0.01)
    expect(at760.action!.y - (at760.hint!.y + at760.hint!.height)).toBeCloseTo(6, 3)
    expect(at760.hint!.y - (at760.pill!.y + at760.pill!.height)).toBeCloseTo(6, 3)
    // The pill alone at that width too: above the bars, not across them.
    await page.locator('button[data-tip^="Select (Esc)"]').click()
    await expect(page.locator(BOTTOM.hint)).toHaveCount(0)
    await expect.poll(async () => meetings(await bottomBoxes(page))).toEqual([])
    const pill760 = await bottomBoxes(page)
    expect(pill760.action!.y - (pill760.pill!.y + pill760.pill!.height)).toBeCloseTo(6, 3)

    // Wide again: the pill is back on the bottom line, between the zones.
    await resize(size[0], size[1])
    await expect
      .poll(async () => inset((await bottomBoxes(page)).pill!, await stageBox()).bottom)
      .toBeCloseTo(14, 3)

    // 5 — nothing in the centre, so no gap is kept for it: in a window with room for the two
    // side zones and no more (715 px — 391 for a 287 px bar and the 89 px pill, which was 67 px
    // while it read `Ask`), each of them still stands at the design's own offset.
    await page.locator(`${BOTTOM.pill} button`).click()
    await expect(page.locator(BOTTOM.pill)).toHaveCount(0)
    const bare = await resize(715, 700)
    const narrow = await stageBox()
    expect(inset(bare.status!, narrow).left).toBeCloseTo(12, 3)
    expect(inset(bare.ask!, narrow).right).toBeCloseTo(12, 3)
  } finally {
    await app.close()
  }
})

/** The toolbar's five groups, each button by its own `data-tip`, in the order they are drawn. */
const TOOLBAR_GROUPS = [
  [
    'Select (Esc) · Ctrl+click: multi-select · drag: pan · Shift+drag: orbit',
    'Laser meter (M) · X, Y, Z from a point',
    'Spot coordinate (C)',
    'Snap to corners and edges (S) — for the laser meter and spot coordinates'
  ],
  ['Section from gridline / level', 'Filter elements by parameter', 'Coordinate system & true north'],
  ['Gridlines (G)', 'Levels (L)', 'canvas grid', 'Shadows', 'Light / dark'],
  [
    'Saved viewpoints',
    '3D perspective (Home)',
    'Plan',
    'North elevation',
    'South elevation',
    'East elevation',
    'West elevation',
    'Perspective / orthographic'
  ],
  ['schedules']
]

interface ToolbarShape {
  width: number
  height: number
  /** Each direct child: a group (`DIV`) or a divider (`SPAN`), with the row it is on. */
  kids: {
    tag: string
    row: number
    w: number
    h: number
    hidden: boolean
    aria: string | null
    tips: string[]
  }[]
}

const toolbarShape = (page: Page): Promise<ToolbarShape> =>
  page.evaluate(() => {
    const tb = document.querySelector('[data-role="toolbar"]') as HTMLElement
    const box = tb.getBoundingClientRect()
    return {
      width: box.width,
      height: box.height,
      kids: [...tb.children].map((k) => {
        const el = k as HTMLElement
        return {
          tag: el.tagName,
          // A row is told by its centre line: a divider is shorter than a group.
          row: el.offsetTop + el.offsetHeight / 2,
          w: el.offsetWidth,
          h: el.offsetHeight,
          hidden: getComputedStyle(el).visibility === 'hidden',
          aria: el.getAttribute('aria-hidden'),
          tips: [...el.querySelectorAll('button')].map((b) => (b as HTMLElement).dataset.tip ?? '')
        }
      })
    }
  })

/**
 * Whether anything the view cube draws is under the Schedules button. `viewer/cube.ts` answers
 * that itself: its canvas takes a mouse's events only where its zones, compass ring, north kite
 * or `N` are drawn, and passes them through everywhere else.
 */
const scheduleButtonUnderCube = (page: Page): Promise<{ inside: boolean; tested: number; drawn: number }> =>
  page.evaluate(() => {
    const b = document.querySelector('button[data-tip="schedules"]')!.getBoundingClientRect()
    const cube = document.querySelector('[data-role="cube"]') as HTMLElement
    const c = cube.getBoundingClientRect()
    const within = (x: number, y: number): boolean =>
      x >= c.left && x < c.right && y >= c.top && y < c.bottom
    const move = (x: number, y: number): boolean =>
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'mouse' }))
    let tested = 0
    let drawn = 0
    for (let x = Math.floor(b.left) + 0.5; x < b.right; x++) {
      for (let y = Math.floor(b.top) + 0.5; y < b.bottom; y++) {
        if (x < b.left || y < b.top || !within(x, y)) continue
        tested++
        move(x, y)
        if (cube.style.pointerEvents !== 'none') drawn++
      }
    }
    move(0, 0)
    return { inside: within(b.left + b.width / 2, b.top + b.height / 2), tested, drawn }
  })

test('the toolbar is five groups with a divider between each two, Schedules alone and last', async () => {
  const { app, page } = await launch(dir)
  try {
    await openDemo(page)
    const stage = page.locator('[data-role="stage"]')

    // 1 — five groups and four dividers, alternating, in the owner's order.
    const one = await toolbarShape(page)
    expect(one.kids.map((k) => k.tag)).toEqual(['DIV', 'SPAN', 'DIV', 'SPAN', 'DIV', 'SPAN', 'DIV', 'SPAN', 'DIV'])
    expect(one.kids.filter((k) => k.tag === 'DIV').map((k) => k.tips)).toEqual(TOOLBAR_GROUPS)
    for (const d of one.kids.filter((k) => k.tag === 'SPAN')) {
      expect(d).toMatchObject({ w: 1, h: 18, aria: 'true', hidden: false, tips: [] })
    }
    // One row at the default window, and no wider than before the regrouping (741 px) plus 4.
    expect(new Set(one.kids.map((k) => k.row)).size).toBe(1)
    expect(one.height).toBe(42)
    expect(one.width).toBeLessThanOrEqual(745)
    expect(one.width).toBeCloseTo(737, 0)

    // 2 — Schedules is drawn apart: the accent's ink and outline, never the filled "on" look.
    const look = await page.evaluate(() => {
      const b = document.querySelector('button[data-tip="schedules"]') as HTMLElement
      const c = getComputedStyle(b)
      const probe = document.createElement('span')
      probe.style.cssText = 'color:var(--accent-ink);background:var(--accent)'
      document.body.append(probe)
      const want = { ink: getComputedStyle(probe).color, line: getComputedStyle(probe).backgroundColor }
      probe.remove()
      return {
        size: [b.offsetWidth, b.offsetHeight],
        cls: b.className,
        color: c.color,
        bg: c.backgroundColor,
        border: [c.borderTopWidth, c.borderTopStyle, c.borderTopColor],
        want
      }
    })
    expect(look).toMatchObject({ size: [30, 30], cls: 'hv-step', bg: 'rgba(0, 0, 0, 0)' })
    expect(look.color).toBe(look.want.ink)
    expect(look.border).toEqual(['1px', 'solid', look.want.line])

    // 3 — the keyboard walks the buttons in the order they are drawn.
    const order = TOOLBAR_GROUPS.flat()
    const xs = await page
      .locator('[data-role="toolbar"] button')
      .evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().x))
    expect(xs.every((x, i) => i === 0 || x > xs[i - 1])).toBe(true)
    await page.locator('[data-role="toolbar"] button').first().focus()
    const walked: string[] = []
    for (let i = 0; i < order.length; i++) {
      walked.push(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.tip ?? ''))
      await page.keyboard.press('Tab')
    }
    expect(walked).toEqual(order)

    // 4 — at the default window the last button's centre is inside the view cube's 148 px
    // canvas, and nothing the cube draws is under the button — in the 3D view, or in Plan.
    const in3D = await scheduleButtonUnderCube(page)
    if ((await page.evaluate(() => innerWidth)) <= 1264) {
      expect(in3D).toMatchObject({ inside: true, tested: 900 })
    }
    expect(in3D.drawn).toBe(0)
    await page.locator('button[data-tip="Plan"]').click()
    await settledShot(page)
    expect((await scheduleButtonUnderCube(page)).drawn).toBe(0)
    await page.locator('button[data-tip="3D perspective (Home)"]').click()
    await settledShot(page)

    // 5 — a narrow window: the toolbar wraps, and a divider that would end a row or start the
    // next is hidden in place — every other one still stands between two groups of its own row.
    const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 700))
    await expect
      .poll(async () => (await toolbarShape(page)).kids.filter((k) => k.hidden).length)
      .toBeGreaterThan(0)
    const wrapped = await toolbarShape(page)
    expect(new Set(wrapped.kids.filter((k) => k.tag === 'DIV').map((k) => k.row)).size).toBeGreaterThan(1)
    wrapped.kids.forEach((k, i) => {
      if (k.tag !== 'SPAN') return
      expect(k.hidden).toBe(wrapped.kids[i - 1].row !== wrapped.kids[i + 1].row)
    })
    expect(wrapped.kids.some((k) => k.tag === 'SPAN' && !k.hidden)).toBe(true)
    // The cards still open under the toolbar, however tall it is (`cardTop`, `App.tsx`).
    await page.locator('button[data-tip="Filter elements by parameter"]').click()
    const filter = stage.locator(':scope > div').filter({ hasText: /^Filter/ })
    await expect
      .poll(async () => Math.round((await filter.boundingBox())!.y))
      .toBe(Math.round(wrapped.height) + 24)
    await page.locator('button[data-tip="Filter elements by parameter"]').click()
    // Wide again: one row, every divider back.
    await app.evaluate(
      ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h),
      size
    )
    await expect.poll(async () => (await toolbarShape(page)).kids.filter((k) => k.hidden).length).toBe(0)
    expect(new Set((await toolbarShape(page)).kids.map((k) => k.row)).size).toBe(1)
    // …and at rest again, before a pointer is brought to it.
    await settledShot(page)

    // 6 — and the button works where it is: a hand's click, through the canvas's empty corner,
    // opens the Schedules window (`helpers.ts` says why that click may be made twice).
    const win = await openSchedulesWindow(app, page)
    await win.waitForLoadState('domcontentloaded')
    expect(win.url()).toContain('schedule.html')
  } finally {
    await app.close()
  }
})

test('the element tree is eye-first like the storeys, and clipped card texts carry their whole text', async () => {
  const { app, page } = await launch(dir)
  try {
    await openDemo(page)
    const side = page.locator('aside')
    const tree = side.locator('[role="tree"]')
    /** Each row's children, as `TAG:title`, `TAG:svg` or `TAG:text`. */
    const kinds = (level: 1 | 2): Promise<string[][]> =>
      tree.locator(`[role="treeitem"][aria-level="${level}"]`).evaluateAll((rows) =>
        rows.map((r) =>
          [...r.children].map(
            (k) => `${k.tagName}:${(k as HTMLElement).title || (k.querySelector('svg') ? 'svg' : 'text')}`
          )
        )
      )
    const eyeX = async (title: string): Promise<number> =>
      (await side.locator(`button[title="${title}"]`).first().boundingBox())!.x

    // 1 — a group row: eye, label, count, chevron — the eye on the storey eye's own x.
    const groups = await kinds(1)
    expect(groups.length).toBeGreaterThan(5)
    for (const g of groups) {
      expect(g).toEqual(['BUTTON:Show / hide group', 'SPAN:text', 'SPAN:text', 'SPAN:svg'])
    }
    expect(await eyeX('Show / hide group')).toBe(await eyeX('Show / hide storey'))

    // 2 — the eye hides its group without opening it; the row opens it, and the chevron turns.
    const first = tree.locator('[role="treeitem"][aria-level="1"]').first()
    const visible = async (): Promise<string> => (await statusText(page)).split('·')[2]
    const all = await visible()
    await first.locator('button[title="Show / hide group"]').click()
    await expect.poll(visible).not.toBe(all)
    await expect(first).toHaveAttribute('aria-expanded', 'false')
    await first.locator('button[title="Show / hide group"]').click()
    await expect.poll(visible).toBe(all)
    const chevron = first.locator(':scope > span').last()
    expect(await chevron.evaluate((e) => (e as HTMLElement).style.transform)).toBe('rotate(0deg)')
    await first.click()
    await expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(await chevron.evaluate((e) => (e as HTMLElement).style.transform)).toBe('rotate(90deg)')

    // 3 — an element row: eye, then the name and its meta line, indented under the group's eye.
    const items = await kinds(2)
    expect(items.length).toBeGreaterThan(0)
    for (const it of items) expect(it).toEqual(['BUTTON:Show / hide', 'SPAN:text'])
    expect(await eyeX('Show / hide')).toBeGreaterThan(await eyeX('Show / hide group'))
    await first.click()

    // 4 — the demo building has no file behind it, so its model rows carry no path title.
    const demoBlock = side.getByText('SB_ARC_R25.ifc', { exact: true }).locator('xpath=..')
    // (The block is the row's two lines: the name over the file name.)
    expect(await demoBlock.evaluate((e) => e.children.length)).toBe(2)
    expect(await demoBlock.getAttribute('title')).toBeNull()

    // 5 — the property card. A tree is an `IfcGeographicElement`, which its tile cannot fit:
    // every text the card clips with an ellipsis has its whole text as a native `title`.
    await page.getByPlaceholder('find an element…').fill('Angsana')
    await tree.locator('[role="treeitem"][aria-level="2"]').first().click()
    const card = page.locator('[data-role="propcard"]')
    await expect(card).toBeVisible()
    const titled = await card.evaluate((c) =>
      [...c.querySelectorAll('span[title]')].map((e) => ({
        title: e.getAttribute('title'),
        text: e.textContent,
        clipped: e.scrollWidth > e.clientWidth
      }))
    )
    // The four identity tiles: the title is the value, clipped or not.
    expect(titled.slice(0, 4).map((t) => [t.title, t.text])).toEqual([
      ['IfcGeographicElement', 'IfcGeographicElement'],
      ['VEGETATION', 'VEGETATION'],
      ['Angsana 200mm girth', 'Angsana 200mm girth'],
      ['L1', 'L1']
    ])
    expect(titled[0].clipped).toBe(true)
    const by = new Map(titled.map((t) => [t.title, t]))
    // A set's header shows the prettified name and says the set's own.
    expect(by.get('SGPset_Planting')?.text).toBe('Planting')
    expect(by.get('Pset_GeographicElementCommon')?.text).toBe('Geographic Element Common')
    expect(by.get('Qto_GeographicElementBaseQuantities')?.text).toBe('Geographic Element Base Quantities')
    // A property's name says itself.
    expect(by.get('Species Botanical Name')).toMatchObject({ text: 'Species Botanical Name', clipped: true })
    // Nothing the card clips is left without one.
    expect(
      await card.evaluate((c) =>
        [...c.querySelectorAll('span')]
          .filter((e) => getComputedStyle(e).textOverflow === 'ellipsis' && e.textContent && !e.title)
          .map((e) => e.textContent)
      )
    ).toEqual([])
  } finally {
    await app.close()
  }
})

test('a file’s full path is the hover title of its model row, its library row and its Recent pill', async () => {
  // The path is the one main admitted and the session recorded — read back from the session, so
  // no path of this machine is spelled here.
  let path = ''
  {
    const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
    try {
      await page.getByText(DROP_COPY).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await expect.poll(sessionModels(dir), { timeout: 20_000 }).toEqual(['tiny'])
      path = ((await readSession(dir)).payload.files as { path: string }[])[0].path
      expect(path).toMatch(/[\\/]tiny\.ifc$/)

      // The loaded model's name block — and only that: the row's buttons keep their own titles.
      const side = page.locator('aside')
      const block = side.getByText('tiny.ifc', { exact: true }).locator('xpath=..')
      await expect(block).toHaveAttribute('title', path)
      const row = block.locator('xpath=..')
      expect(await row.getAttribute('title')).toBeNull()
      expect(
        await row.locator('button').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).title))
      ).toEqual([
        'Show / hide model',
        "Override this model's colour",
        "Activate — lists show only this model; the others stay visible in 3D but can't be selected"
      ])

      // The library popover lists the same file as a recent, with the same path.
      await side.getByText('library', { exact: true }).click()
      await expect(
        side.locator('button.hv-step').filter({ hasText: 'tiny.ifc' }).last()
      ).toHaveAttribute('title', path)
    } finally {
      await app.close()
    }
  }
  {
    const { app, page } = await launch(dir)
    try {
      await expect(
        page.locator('[data-role="landing"] button', { hasText: 'tiny.ifc' })
      ).toHaveAttribute('title', path)
    } finally {
      await app.close()
    }
  }
})

/* ── 2026-10-01, the owner's "Ask Vee" handoff: the assistant's pixel mascot at rest ───────── */

/**
 * The sprite's clock, in the real app: 8 frames a second, an idle sprite blinking on 2 of every
 * 28 — so in four seconds every sprite has shown exactly two pictures — and the header's, the
 * reply's and the pill's never blinking together (`VEE_OFFSET`, `veeLabelOffset`). Under
 * `prefers-reduced-motion: reduce` the clock does not run: one picture each, the eyes open.
 *
 * A canvas is read as its data URL, the page sampling itself every 40 ms. The clock stops while
 * the window is hidden — its own rule — so a run whose window the desktop has covered skips
 * rather than read a stopped clock as a failure.
 */
test('Vee blinks at rest, no two sprites together, and holds still under reduced motion', async () => {
  const { app, page } = await launch(dir)
  try {
    await openDemo(page)
    await page.locator(BOTTOM.ask).click()
    await expect(page.locator('[data-role="chatlog"]')).toBeVisible()
    // The header's, the boot audit's label's and the pill's.
    await expect(page.locator('[data-role="vee"] canvas')).toHaveCount(3)
    test.skip(
      await page.evaluate(() => document.hidden),
      'the window is not visible, so the sprite clock is stopped by its own rule'
    )

    // The sprite is drawn in the theme's own colours and follows a theme switch by itself: the
    // rim — cell (6, 3) of the grid is the first of its top row — is `--accent`.
    const rim = (): Promise<number[]> =>
      page.locator(`${BOTTOM.ask} canvas`).evaluate((c) => {
        const canvas = c as HTMLCanvasElement
        const cell = canvas.width / 16
        return [...canvas.getContext('2d')!.getImageData(6 * cell, 3 * cell, 1, 1).data]
      })
    const theme = page.locator('button[data-tip="Light / dark"]')
    expect(await rim()).toEqual([0x35, 0xc4, 0xb6, 255])
    await theme.click()
    await expect.poll(rim).toEqual([0x0e, 0x8a, 0x80, 255])
    await theme.click()
    await expect.poll(rim).toEqual([0x35, 0xc4, 0xb6, 255])

    /** What the sprites showed over `ms`: every sample, and each sprite's distinct pictures. */
    const watch = (ms: number): Promise<{ pictures: string[][]; samples: string[][] }> =>
      page.evaluate(async (span) => {
        const all = [...document.querySelectorAll('[data-role="vee"] canvas')] as HTMLCanvasElement[]
        const samples: string[][] = []
        const end = performance.now() + span
        while (performance.now() < end) {
          samples.push(all.map((c) => c.toDataURL()))
          await new Promise((r) => setTimeout(r, 40))
        }
        return { pictures: all.map((_, i) => [...new Set(samples.map((s) => s[i]))]), samples }
      }, ms)

    // 1 — four seconds at rest: more than one whole 28-frame cycle.
    const moving = await watch(4000)
    for (const shown of moving.pictures) expect(shown).toHaveLength(2)
    // Each sprite's open face is the picture it shows most; the other is its blink.
    const open = moving.pictures.map((shown, i) => {
      const count = (p: string): number => moving.samples.filter((s) => s[i] === p).length
      return count(shown[0]) >= count(shown[1]) ? shown[0] : shown[1]
    })
    const shutTogether = moving.samples.filter((s) => s.filter((p, i) => p !== open[i]).length > 1)
    expect(shutTogether).toHaveLength(0)
    // A blink is two frames of 125 ms: a sprite is shut in well under a fifth of the samples.
    for (let i = 0; i < open.length; i++) {
      const shut = moving.samples.filter((s) => s[i] !== open[i]).length
      expect(shut).toBeGreaterThan(0)
      expect(shut / moving.samples.length).toBeLessThan(0.2)
    }

    // 2 — reduced motion: the clock does not run, and every sprite holds its open face.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect
      .poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
      .toBe(true)
    // The page's own listener hears the change with its next frame, not at once: a sprite that
    // was mid-blink stays shut until then. So wait for the open faces, then watch them hold.
    await expect.poll(async () => (await watch(120)).pictures).toEqual(open.map((p) => [p]))
    const still = await watch(4000)
    expect(still.pictures).toEqual(open.map((p) => [p]))

    // 3 — and it starts again when motion is allowed again.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect
      .poll(async () => (await watch(400)).pictures.some((shown, i) => shown.length > 1 || shown[0] !== open[i]), {
        timeout: 8_000
      })
      .toBe(true)
  } finally {
    await app.close()
  }
})
