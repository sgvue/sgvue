/**
 * The guarded real-model run — the whole Phase 8 chain on a file from `samples/`, end to end:
 * the injected dialog answer → `admit` → a single-use token → the `sgvue-file://` stream → the
 * parse worker → the designed five stage rows → the federation → the session → a relaunch and
 * the same file again from its Recent pill.
 *
 * Skipped unless `SGVUE_IFC` names a file, because `samples/` is git-ignored: real project
 * models never enter the repository.
 *
 *   npm run build
 *   SGVUE_IFC="samples/Sample Ifc Model.ifc" npm run test:e2e -- tests/e2e/big-model.spec.ts
 *
 * Every Electron it starts is watched by `scripts/safe-e2e.cjs`, which is what `npm run
 * test:e2e` is. Never run it any other way — see `CLAUDE.md` for the three kernel panics.
 */
import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { DROP_COPY, launch, readSession, ROOT, statusText } from './helpers'

const MODEL = process.env.SGVUE_IFC ? resolve(ROOT, process.env.SGVUE_IFC) : ''

test.skip(!MODEL, 'set SGVUE_IFC to a model in samples/')
test.setTimeout(600_000)

/** Whatever the landing page's one upload row currently says its stage is. */
const stageText = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const landing = document.querySelector('[data-role="landing"]')
    if (!landing) return ''
    const stages = ['reading file', 'parsing entities', 'building geometry', 'indexing properties', 'federating', 'ready']
    const found = [...landing.querySelectorAll('span')]
      .map((e) => (e.textContent || '').trim())
      .filter((t) => stages.includes(t))
    return found[found.length - 1] || ''
  })

test('opens a real model through the whole pipeline, then again from Recent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sgvue-big-'))
  const bytes = (await stat(MODEL)).size
  console.log(`\n[big] ${MODEL} — ${(bytes / 1048576).toFixed(1)} MB`)

  let sha = ''

  // ── run 1: open it ──────────────────────────────────────────────────────
  {
    const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: MODEL })
    try {
      const t0 = Date.now()
      await page.getByText(DROP_COPY).click()

      // Every stage transition, as the person sees it.
      const seen = new Map<string, number>()
      const poll = setInterval(() => {
        void stageText(page)
          .then((s) => {
            if (s && !seen.has(s)) seen.set(s, Date.now() - t0)
          })
          .catch(() => undefined)
      }, 60)

      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 300_000 })
      const toViewer = Date.now() - t0
      clearInterval(poll)

      console.log('[big] stage first seen (ms from the click):')
      for (const [name, at] of seen) console.log(`[big]   ${name.padEnd(20)} ${at}`)
      console.log(`[big] landing → viewer: ${(toViewer / 1000).toFixed(2)} s`)

      const status = await statusText(page)
      console.log(`[big] status bar: ${status}`)
      expect(status).toMatch(/WebGL2|WebGPU/)

      // The session, with the file's real path and the hash the parse produced.
      await expect
        .poll(
          async () => {
            try {
              return (await readSession(dir)).payload.models
            } catch {
              return null
            }
          },
          { timeout: 60_000 }
        )
        .not.toBeNull()
      const { payload } = await readSession(dir)
      const files = payload.files as { path: string; name: string; sha256: string }[]
      sha = files[0].sha256
      console.log(`[big] session: ${JSON.stringify(payload.models)} · sha-256 ${sha}`)
      expect(sha).toMatch(/^[0-9a-f]{64}$/)

      // Hide a storey and orbit, so the session has something to record.
      await page.locator('button[title="Show / hide storey"]').nth(1).click()
      await page.waitForTimeout(2000)
      const box = (await page.locator('[data-role="viewport"]').boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2 + 50, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(2000)
      const after = await readSession(dir)
      console.log(`[big] hidden after the storey click: ${JSON.stringify(after.payload.storeyVis)}`)
      console.log(`[big] status bar now: ${await statusText(page)}`)
    } finally {
      await app.close()
    }
  }

  // ── run 2: open it again from its Recent pill (the Resume card left the port 2026-09-24) ──
  {
    const { app, page } = await launch(dir)
    try {
      await expect(page.getByText('Recent', { exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('Resume last session')).toHaveCount(0)
      const t0 = Date.now()
      await page.locator('[data-role="landing"] button', { hasText: basename(MODEL) }).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 300_000 })
      console.log(`[big] Recent pill → viewer: ${((Date.now() - t0) / 1000).toFixed(2)} s`)
      console.log(`[big] status bar: ${await statusText(page)}`)

      // The same bytes: the session written for this load carries the same digest.
      await expect
        .poll(
          async () => {
            try {
              const { payload } = await readSession(dir)
              return (payload.files as { sha256: string }[])[0].sha256
            } catch {
              return null
            }
          },
          { timeout: 60_000 }
        )
        .toBe(sha)
      await expect(page.locator('[data-role="viewport"]')).toBeVisible()
    } finally {
      await app.close()
    }
  }

  await rm(dir, { recursive: true, force: true })
})
