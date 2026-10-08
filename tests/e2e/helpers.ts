/**
 * What the Electron specs share — not a spec itself (`playwright.config.ts` matches
 * `*.spec.ts` only). Every launch here still happens inside `scripts/safe-e2e.cjs` or
 * `scripts/safe-app.cjs`; nothing in this file starts anything on its own.
 */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const ROOT = resolve(__dirname, '../..')
export const MAIN = join(ROOT, 'out/main/index.js')
export const TINY = join(ROOT, 'tests/fixtures/tiny.ifc')
/** 2026-10-01 — the first product web-ifc streams from this one is its highest (`scripts/make-tiny-ifc.py`). */
export const HIGH_FIRST = join(ROOT, 'tests/fixtures/high-first.ifc')

/** `SGVue.dc.html:769` — the drop zone's own copy. */
export const DROP_COPY = 'Drop IFC files here, or click to choose'

/** The built app (`out/`) on a profile of its own, once its first window has its DOM. */
export async function launch(
  userData: string,
  env: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${userData}`],
    env: { ...process.env, ...env } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/**
 * The status bar's text. Since 2026-10-01 the bar is a zone of the bottom row and carries
 * `data-role="statusbar"`; a package built before that (`packaged.spec.ts` runs whatever is in
 * `dist/`) has no role, and there it is still the one positioned box that carries the live fps.
 */
export const statusText = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const bar =
      document.querySelector('[data-role="statusbar"]') ??
      [...document.querySelectorAll('div')]
        .filter((e) => {
          const c = getComputedStyle(e)
          return (c.position === 'absolute' || c.position === 'fixed') && / fps/.test(e.textContent || '')
        })
        .pop()
    return (bar?.textContent || '').replace(/\s+/g, ' ').trim()
  })

/**
 * The action bar's text (2026-10-01): undo, redo and the markup counts, which the design kept in
 * the status bar. `''` while the bar is not drawn.
 */
export const actionText = (page: Page): Promise<string> =>
  page.evaluate(() =>
    (document.querySelector('[data-role="actionbar"]')?.textContent || '').replace(/\s+/g, ' ').trim()
  )

/**
 * A click the way a hand does it: the pointer arrives, then clicks where it is.
 *
 * At the default window the toolbar's last button — Schedules, since 2026-10-01 — has its centre
 * inside the view cube's 148 px canvas, over a corner where the cube draws nothing. The canvas
 * passes a mouse through there, but only once it has seen the pointer arrive (`viewer/cube.ts`);
 * Playwright's own `click()` asks what is under the point before it moves the mouse, and waits
 * for ever on the canvas.
 */
export async function handClick(page: Page, selector: string): Promise<void> {
  const b = (await page.locator(selector).boundingBox())!
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2]
  await page.mouse.move(x - 20, y)
  await page.mouse.move(x, y)
  await page.mouse.click(x, y)
}

/**
 * Click the toolbar's Schedules button and return the window it opens.
 *
 * A hand's click, tried again if no window came. The click reaches the button only while the
 * cube's canvas has stepped aside, which it does when the pointer arrives and undoes on a
 * pointer move anywhere else (`viewer/cube.ts`). Under test the page can be sent such a move by
 * a second pointer — the desktop's own cursor, which Playwright does not drive. One run in
 * sixteen lost this click, straight after a window resize; that it was a stray move is inferred
 * (no window opened, and nothing else gives the canvas its events back), not observed. A person
 * has one pointer, so the app has nothing to retry, and a second click that does arrive only
 * brings the one Schedules window forward.
 */
export async function openSchedulesWindow(app: ElectronApplication, page: Page): Promise<Page> {
  const before = app.windows()
  await expect(async () => {
    await handClick(page, 'button[data-tip="schedules"]')
    await expect.poll(() => app.windows().length, { timeout: 4_000 }).toBeGreaterThan(before.length)
  }).toPass({ timeout: 30_000 })
  return app.windows().find((w) => !before.includes(w))!
}

/** The session `main/sessions.ts` wrote into this profile. */
export const readSession = async (userData: string): Promise<{ payload: Record<string, unknown> }> =>
  JSON.parse(await readFile(join(userData, 'sessions', 'last.json'), 'utf8'))

/** The viewport, clear of the toolbar, the view cube and the status bar's live fps. */
export async function viewportClip(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const vp = (await page.locator('[data-role="viewport"]').boundingBox())!
  return { x: vp.x + 20, y: vp.y + 90, width: vp.width - 220, height: vp.height - 180 }
}

/**
 * A capture taken once two in a row agree: the pointer is moved off the canvas and off every
 * tooltip first, so the boot ease-in, a camera move and any fade are all over by then.
 *
 * 2026-09-25 (phase 4 review item): **both captures of the agreeing pair are taken at least
 * `minDelayMs` after the call** — the action it follows. Two captures 250 ms apart used to agree
 * *before* the change had reached a frame (the viewer draws on demand, and a toggle's first
 * frame can land later than the first capture), so "Original materials off" compared the old
 * picture with itself and failed now and then. 500 ms is past every fade and ease in the scene
 * (220 ms crossfade, the camera's ease) with room to spare.
 */
export async function settledShot(
  page: Page,
  minDelayMs = 500,
  region?: { x: number; y: number; width: number; height: number }
): Promise<Buffer> {
  const start = Date.now()
  const clip = region ?? (await viewportClip(page))
  await page.mouse.move(5, clip.y + clip.height + 60)
  await page.waitForTimeout(Math.max(0, minDelayMs - (Date.now() - start)))
  let last = await page.screenshot({ clip })
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(250)
    const next = await page.screenshot({ clip })
    if (next.equals(last)) return next
    last = next
  }
  return last
}

/** Pixels that differ between two captures, decoded by the page itself. */
export const pixelsDiffer = (page: Page, a: Buffer, b: Buffer): Promise<number> =>
  page.evaluate(
    async ([x, y]) => {
      const decode = async (b64: string): Promise<Uint8ClampedArray> => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const c = new OffscreenCanvas(bmp.width, bmp.height)
        const g = c.getContext('2d')!
        g.drawImage(bmp, 0, 0)
        return g.getImageData(0, 0, bmp.width, bmp.height).data
      }
      const [p, q] = await Promise.all([decode(x), decode(y)])
      let n = 0
      for (let i = 0; i < p.length; i += 4) {
        if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) n++
      }
      return n
    },
    [a.toString('base64'), b.toString('base64')] as const
  )

/* ────────────────────────────── a held assistant turn ────────────────────────────── */

/*
 * **No API, no key, and no `window.__sgvueDev`** — the suite runs the production bundle. A turn
 * is a conversation between main and the renderer: the renderer asks for one (`ai:turn:start`),
 * main sends events (`ai:event`) and tool calls (`ai:tool:exec`), the renderer answers each call
 * (`ai:tool:result`). A spec replaces **main's two turn handlers** with a pair that only remember
 * the turn, and then sends the events itself over the real channels; everything on the
 * renderer's side — `sendChat`, the real executors on the loaded federation, the panel — is the
 * app's own. (Moved here from `vee-trace.spec.ts` on 2026-10-02, when a second spec needed it;
 * the answers are recorded since then.)
 */

/** A tool call's answer, as the renderer sends it back to main. */
export interface ToolAnswer {
  turnId: string
  callId: string
  ok: boolean
  result?: unknown
  message?: string
}

/** What the stand-in for main keeps of the turn the renderer asked for. */
export interface Held {
  id: string
  wc: { send(channel: string, payload: unknown): void } | null
  aborted: string[]
  calls: number
  /** Every answer to a tool call, in the order they came back — what the model would have read. */
  results: ToolAnswer[]
  /** 2026-10-08 — the question and the quote of the latest turn, as main was handed them. */
  asked?: { userText: string; quote: { who: string; text: string } | null }
}

/** Main's two turn handlers, replaced: remember the turn; answer a stop as main does. */
export async function holdTurns(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const held: Held = { id: '', wc: null, aborted: [], calls: 0, results: [] }
    ;(globalThis as unknown as { __turn: Held }).__turn = held
    ipcMain.removeHandler('ai:turn:start')
    ipcMain.removeHandler('ai:turn:abort')
    ipcMain.handle(
      'ai:turn:start',
      (event, raw: { turnId: string; userText: string; quote?: { who: string; text: string } | null }) => {
        held.id = raw.turnId
        held.wc = event.sender
        held.asked = { userText: raw.userText, quote: raw.quote ?? null }
      }
    )
    ipcMain.handle('ai:turn:abort', (event, raw: { turnId: string }) => {
      held.aborted.push(raw.turnId)
      event.sender.send('ai:event', { type: 'aborted', turnId: raw.turnId })
    })
    // Beside main's own listener, which finds no call of its own waiting and does nothing.
    ipcMain.on('ai:tool:result', (_event, raw: ToolAnswer) => {
      held.results.push(raw)
    })
  })
}

/** One event of the turn, as main's gateway sends it. */
export const emit = (app: ElectronApplication, event: Record<string, unknown>): Promise<void> =>
  app.evaluate((_electron, ev) => {
    const held = (globalThis as unknown as { __turn: Held }).__turn
    held.wc!.send('ai:event', { ...ev, turnId: held.id })
  }, event)

/** One tool call: the stream announces it, then main forwards it for the renderer to run. */
export const tool = (app: ElectronApplication, name: string, input: unknown = {}): Promise<void> =>
  app.evaluate(
    (_electron, call) => {
      const held = (globalThis as unknown as { __turn: Held }).__turn
      held.wc!.send('ai:event', { type: 'tool_start', turnId: held.id, name: call.name })
      held.wc!.send('ai:tool:exec', { turnId: held.id, callId: `c${++held.calls}`, name: call.name, input: call.input })
    },
    { name, input }
  )

/** The answers so far. */
export const toolResults = (app: ElectronApplication): Promise<ToolAnswer[]> =>
  app.evaluate(() => (globalThis as unknown as { __turn: Held }).__turn.results)
