/**
 * 2026-10-02 — the consent gate, in the built app (assistant parity, phase 3 of 4). Run it only
 * through `node scripts/safe-e2e.cjs` (`npm run test:e2e`).
 *
 * What reaches outside the view or cannot be undone is never done by the assistant. It **asks**
 * — in the chat's own pending row, the sidebar's own "Unload …?" strip or the native Open dialog
 * — and the user's click is what does it. The unit tests hold the rule (`ai-parity-3.test.ts`);
 * three things about it can only be shown in the real app:
 *
 *   1. **The clipboard.** Electron grants a page no clipboard permission here, so
 *      `navigator.clipboard.writeText` is always refused and a copy lands only through
 *      `document.execCommand('copy')` — which Chromium allows only while the page has a user's
 *      activation (`renderer/clipboard.ts`). So: the designed "copy link to this state" really
 *      copies and says so; the same control clicked by nobody copies nothing and **says
 *      nothing** (it used to flash `link copied` either way); and a link the assistant asked to
 *      copy reaches the clipboard on the user's Apply and at no moment before it.
 *   2. **A recent file** is asked for by name and loaded by the user's Apply, through main's own
 *      recents list and `admit()`; and an unload is the sidebar's own question, answered there.
 *   3. **The Open dialog** is only raised. It is answered here from `SGVUE_OPEN_PATHS`, as in
 *      every other spec (`main/index.ts`, dev builds only), and the tool is told nothing of the pick.
 *
 * **No API and no key.** Main's two turn handlers are held (`helpers.ts`) and each tool call is
 * sent over the real channel; the executors, the store, the panel and main's file admission are
 * the app's own. Every answer a tool gave is read back, because that is what the model would
 * have read: it must hold no path and no link.
 *
 * **The first two tests write the machine's real clipboard**, and their restore is text-only:
 * text that was on it is put back, anything else that was on it (an image, files) is lost.
 *
 * Phase 4 (the same day) — the second test: the chat table's `copy csv`. The design's line for
 * it (`SGVue.dc.html:2029`) called the clipboard API this app always refuses, so the control
 * copied nothing; it goes through the store's `copyTable` and `copyText` now. In the built app:
 * the user's click puts exactly the table's CSV on the clipboard and says nothing, as designed
 * (the control has no flash); a click nobody made copies nothing, and the panel's status line
 * says so.
 */
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tableCsv } from '../../src/renderer/state/selectors/chat'
import {
  DROP_COPY,
  HIGH_FIRST,
  TINY,
  emit,
  holdTurns,
  launch,
  readSession,
  statusText,
  tool,
  toolResults,
  type ToolAnswer
} from './helpers'

const DEMO = 'try the demo building →'
const ASK = 'button[data-tip^="Ask the assistant"]'
/** The Viewpoints card's "copy link to this state" (`SGVue.dc.html`, by its own tooltip). */
const COPY_LINK = 'button[data-tip^="A link that reopens"]'
const LINK = /^sgvue:\/\/s=[\w-]+$/
const SENTINEL = 'sgvue e2e — nothing has been copied'
const REFUSED = 'The clipboard could not be written, so nothing was copied.'
/** The newest reply's `apply`, as a script finds it. */
const LAST_APPLY = `[...[...document.querySelectorAll('[data-role="chatlog"] > [data-row]')].pop().querySelectorAll('button')].find((b) => b.textContent.trim() === 'apply')`

let dir = ''

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-gate-'))
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Every string in an answer, at any depth. */
const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []

/** The strings that say where a file is, or that are a link: there must be none. */
const located = (v: unknown): string[] => strings(v).filter((s) => /[\\/]|sgvue:|file:/i.test(s))

const apply = (row: Locator): Locator => row.getByRole('button', { name: 'apply', exact: true })

const sessionModels = (userData: string) => async (): Promise<unknown> => {
  try {
    return (await readSession(userData)).payload.models
  } catch {
    return null
  }
}

/**
 * One whole turn over the held channels: the question, each call run by the app's own executor
 * and answered, the reply. Returns the reply's row once it rests, and the answers.
 */
async function turn(
  app: ElectronApplication,
  page: Page,
  question: string,
  calls: [string, unknown][],
  reply: string
): Promise<{ row: Locator; results: ToolAnswer[] }> {
  const send = page.locator('button[data-part="send"]')
  const before = (await toolResults(app)).length
  await page.locator('[data-role="chatinput"]').fill(question)
  await page.locator('[data-role="chatinput"]').press('Enter')
  await expect(send).toHaveAttribute('aria-label', 'Stop')
  for (const [name, input] of calls) await tool(app, name, input)
  await expect.poll(async () => (await toolResults(app)).length).toBe(before + calls.length)
  await emit(app, { type: 'done', text: reply, rounds: 2 })
  await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
  const row = page.locator('[data-role="chatlog"] > [data-row]').last()
  await expect(row).not.toHaveAttribute('aria-hidden', 'true')
  return { row, results: (await toolResults(app)).slice(before) }
}

/** The panel open and main's turn handlers held. */
async function openChat(app: ElectronApplication, page: Page): Promise<void> {
  await page.locator(ASK).click()
  await expect(page.locator('[data-role="chatlog"]')).toBeVisible()
  await holdTurns(app)
}

/**
 * Long enough for a user's activation to lapse. Chromium keeps it for five seconds after a
 * click or a key, and Playwright's own page calls renew it — so nothing here touches the page.
 */
const idle = (page: Page): Promise<void> => page.waitForTimeout(7_000)

/** A click nobody made: a script's own `click()`, run from main with no user gesture. */
const clickFromMain = (app: ElectronApplication, pick: string): Promise<boolean> =>
  app.evaluate(
    ({ BrowserWindow }, code) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(code, false),
    `(() => { const b = ${pick}; if (!b) return false; b.click(); return true })()`
  )

test('the clipboard: the designed copy really copies, a click nobody made copies nothing, and a request waits for the user’s Apply', async () => {
  const { app, page } = await launch(dir)
  const clipboard = (): Promise<string> => app.evaluate(({ clipboard }) => clipboard.readText())
  const setClipboard = (text: string): Promise<void> =>
    app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text)
  // The machine's own clipboard is what this is about: put back what was on it afterwards.
  const kept = await clipboard()
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: DEMO }).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    await setClipboard(SENTINEL)

    // ── 1. the designed control, clicked by hand: a real link, and the flash that says so ──
    await page.locator('button[data-tip="Saved viewpoints"]').click()
    const copy = page.locator(COPY_LINK)
    await expect(copy).toHaveText('copy link to this state')
    await copy.click()
    await expect(copy).toHaveText('link copied')
    expect(await clipboard()).toMatch(LINK)
    await expect(copy).toHaveText('copy link to this state', { timeout: 5_000 })

    // ── 2. the same control, clicked by nobody: nothing copied, and nothing claimed ──
    // (Before 2026-10-02 it flashed `link copied` here too, with the clipboard untouched.)
    await setClipboard(SENTINEL)
    await idle(page)
    expect(await clickFromMain(app, `document.querySelector('${COPY_LINK}')`)).toBe(true)
    await page.waitForTimeout(600)
    expect(await clipboard()).toBe(SENTINEL)
    await expect(copy).toHaveText('copy link to this state')

    // ── 3. the assistant asks: the designed row, and the clipboard exactly as it was ──
    await openChat(app, page)
    const first = await turn(
      app,
      page,
      'Copy a link to this view.',
      [['request_user_action', { action: 'copy_link' }]],
      'I have asked to copy a link to this view. Click Apply and it is copied.'
    )
    expect(first.results).toHaveLength(1)
    expect(first.results[0]).toMatchObject({ ok: true, result: { applied: false, pending: true } })
    // What the model would have read: no link, and nothing that says where a file is.
    expect(located(first.results)).toEqual([])
    await expect(
      first.row.getByText('copy a link to this view to the clipboard — the view as it stands when you click', { exact: true })
    ).toBeVisible()
    await expect(apply(first.row)).toHaveCount(1)
    await expect(first.row.getByRole('button', { name: 'cancel', exact: true })).toHaveCount(1)
    expect(await clipboard()).toBe(SENTINEL)

    // A click on Apply that nobody made copies nothing — the browser's own rule, under the
    // gate's — and the panel says so instead of leaving the user to think it was copied. The
    // request is spent all the same: it is taken once, by whatever clicked.
    await idle(page)
    expect(await clickFromMain(app, LAST_APPLY)).toBe(true)
    await page.waitForTimeout(600)
    expect(await clipboard()).toBe(SENTINEL)
    await expect(page.getByText(REFUSED, { exact: true })).toBeVisible()
    await expect(apply(first.row)).toHaveCount(0)
    await expect(copy).toHaveText('copy link to this state')

    // ── 4. asked again, and this time the user clicks: now, and only now, it is copied ──
    const second = await turn(
      app,
      page,
      'Ask me again.',
      [['request_user_action', { action: 'copy_link' }]],
      'I have asked again. Click Apply and the link is copied.'
    )
    expect(located(second.results)).toEqual([])
    await expect(page.getByText(REFUSED, { exact: true })).toHaveCount(0)
    expect(await clipboard()).toBe(SENTINEL)
    await apply(second.row).click()
    // The Viewpoints card's own control ran: its flash, and a real link on the clipboard.
    await expect(copy).toHaveText('link copied')
    expect(await clipboard()).toMatch(LINK)
    await expect(apply(second.row)).toHaveCount(0)
    await expect(page.getByText(REFUSED, { exact: true })).toHaveCount(0)
  } finally {
    await app.evaluate(({ clipboard }, text) => (text ? clipboard.writeText(text) : clipboard.clear()), kept)
    await app.close()
  }
})

/** The newest reply's `copy csv`, as a script finds it. */
const LAST_COPY_CSV = `[...document.querySelectorAll('[data-role="chatlog"] > [data-row] button')].filter((b) => b.textContent.trim() === 'copy csv').pop()`

test('the chat table’s copy csv: the user’s click puts the table on the clipboard as CSV and says nothing; a click nobody made copies nothing and says so', async () => {
  const { app, page } = await launch(dir)
  const clipboard = (): Promise<string> => app.evaluate(({ clipboard }) => clipboard.readText())
  const setClipboard = (text: string): Promise<void> =>
    app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text)
  // The machine's own clipboard is what this is about: put back what was on it afterwards.
  const kept = await clipboard()
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: DEMO }).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('412 / 412')
    await openChat(app, page)
    await setClipboard(SENTINEL)

    // A reply that carries a table: the design's own, from `summarize_elements`.
    const asked = await turn(
      app,
      page,
      'How many elements are on each level?',
      [['summarize_elements', { groupBy: 'Level' }]],
      'Here they are, level by level.'
    )
    const answer = asked.results[0].result as {
      groupBy: string
      groups: { value: string; count: number; area?: number; volume?: number }[]
      truncated: boolean
    }
    expect(asked.results[0].ok).toBe(true)
    expect(answer.truncated).toBe(false)
    expect(answer.groups.length).toBeGreaterThan(2)
    // What the control has to copy: the table's own rows, through the app's own `tableCsv`.
    const expected = tableCsv({
      groupBy: answer.groupBy,
      rows: answer.groups.map((g) => ({ k: g.value, n: g.count, area: g.area, volume: g.volume, ids: [] }))
    })
    expect(expected.split('\n')[0]).toBe('Level,count,quantity')
    expect(expected.split('\n')).toHaveLength(answer.groups.length + 1)

    const copy = asked.row.getByRole('button', { name: 'copy csv', exact: true })
    await expect(copy).toHaveCount(1)
    // The panel's status line: the one line the log shows under its rows, drawn only when there
    // is something to say.
    const status = page.locator('[data-role="chatlog"] > span:not(.sr-only)')
    await expect(status).toHaveCount(0)
    // The turn itself copied nothing.
    expect(await clipboard()).toBe(SENTINEL)

    // ── 1. the user's click: the table, as CSV, exactly — and nothing said ──
    await copy.click()
    await expect.poll(clipboard).not.toBe(SENTINEL)
    // (Line by line: the Windows clipboard stores a line break as CRLF.)
    expect((await clipboard()).split(/\r?\n/)).toEqual(expected.split('\n'))
    // The measured result, for the run's log: what the real click left on the real clipboard.
    const got = (await clipboard()).split(/\r?\n/)
    console.log(`\n[copy csv] the real click copied ${got.length} lines: ${got.slice(0, 3).join(' | ')} …`)
    // No flash — the design gives this control none — and the status line stays empty.
    await expect(copy).toHaveText('copy csv')
    await expect(status).toHaveCount(0)
    await expect(page.getByText(REFUSED, { exact: true })).toHaveCount(0)

    // ── 2. the same control, clicked by nobody: nothing copied, and the panel says so ──
    await setClipboard(SENTINEL)
    await idle(page)
    expect(await clickFromMain(app, LAST_COPY_CSV)).toBe(true)
    await page.waitForTimeout(600)
    expect(await clipboard()).toBe(SENTINEL)
    await expect(status).toHaveText(REFUSED)

    // ── 3. the user's click again: copied, and the sentence that no longer holds is gone ──
    await copy.click()
    await expect.poll(clipboard).not.toBe(SENTINEL)
    expect((await clipboard()).split(/\r?\n/)).toEqual(expected.split('\n'))
    await expect(status).toHaveCount(0)
  } finally {
    await app.evaluate(({ clipboard }, text) => (text ? clipboard.writeText(text) : clipboard.clear()), kept)
    await app.close()
  }
})

test('a recent file is asked for by name and loaded by the user’s Apply; an unload is the sidebar’s own question', async () => {
  // ── first run: open both fixtures, so both are on main's recents list ──
  {
    const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: `${TINY}:::${HIGH_FIRST}` })
    try {
      await page.getByText(DROP_COPY).click()
      await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
      await expect.poll(sessionModels(dir), { timeout: 20_000 }).toEqual(['tiny', 'high-first'])
    } finally {
      await app.close()
    }
  }

  // ── second run: one of them open, the other asked for ──
  const { app, page } = await launch(dir)
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator('[data-role="landing"] button', { hasText: 'tiny.ifc' }).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('6 / 6')
    const side = page.locator('aside')
    await expect(side.getByText('high-first.ifc')).toHaveCount(0)
    await openChat(app, page)

    const asked = await turn(
      app,
      page,
      'Open the other model again.',
      [
        // A name the list does not have: the names it does have, and nothing asked.
        ['request_user_action', { action: 'open_recent', recent: 'no-such-file.ifc' }],
        ['request_user_action', { action: 'open_recent', recent: 'high-first.ifc' }]
      ],
      'I have asked to open high-first.ifc. Click Apply to load it.'
    )
    const [unknown, held] = asked.results
    expect(unknown.ok).toBe(true)
    expect([...(unknown.result as { recentFiles: string[] }).recentFiles].sort()).toEqual(['high-first.ifc', 'tiny.ifc'])
    expect((unknown.result as { pending?: boolean }).pending).toBeUndefined()
    expect(held).toMatchObject({ ok: true, result: { applied: false, pending: true, recent: 'high-first.ifc' } })
    // Names only: neither answer says where a file is, and neither does the row.
    expect(located(asked.results)).toEqual([])
    await expect(asked.row.getByText('open the recent file "high-first.ifc"', { exact: true })).toBeVisible()
    expect(located(await asked.row.innerText())).toEqual([])
    // Nothing has loaded.
    expect(await statusText(page)).toContain('6 / 6')
    await expect(side.getByText('high-first.ifc')).toHaveCount(0)

    // The user's click: main's own recents list and `admit()`, then the ordinary load.
    await apply(asked.row).click()
    await expect(side.getByText('high-first.ifc')).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => statusText(page), { timeout: 30_000 }).toContain('11 / 11')
    await expect.poll(sessionModels(dir), { timeout: 20_000 }).toEqual(['tiny', 'high-first'])
    await expect(apply(asked.row)).toHaveCount(0)

    // ── an unload: the sidebar's own strip is raised, and its `delete` is the user's ──
    const strip = side.locator('[role="dialog"][aria-modal="false"]')
    await expect(strip).toHaveCount(0)
    const unload = await turn(
      app,
      page,
      'Unload high-first.',
      [['request_user_action', { action: 'unload_model', model: 'high-first' }]],
      'The sidebar is asking whether to unload high-first. Click delete there to confirm.'
    )
    expect(unload.results[0]).toMatchObject({ ok: true, result: { asked: true, model: 'high-first' } })
    expect(located(unload.results)).toEqual([])
    await expect(strip.locator('span')).toHaveText('Unload high-first?')
    // Asked, not done: both models are still loaded, and the chat row offers nothing to apply.
    expect(await statusText(page)).toContain('11 / 11')
    await expect(apply(unload.row)).toHaveCount(0)
    await strip.getByRole('button', { name: 'delete', exact: true }).click()
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('6 / 6')
    await expect(side.getByText('high-first.ifc')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('the Open dialog is only raised: the user’s pick loads, and the tool is told nothing of it', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: HIGH_FIRST })
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: DEMO }).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('412 / 412')
    await openChat(app, page)

    const asked = await turn(
      app,
      page,
      'Open my own model.',
      [['request_user_action', { action: 'open_files' }]],
      'The Open dialog is up. Pick the files to load there.'
    )
    expect(asked.results[0]).toMatchObject({ ok: true, result: { dialog: true } })
    // Told that the dialog was opened — not what was picked, and not where it is.
    expect(JSON.stringify(asked.results)).not.toContain('high-first')
    expect(located(asked.results)).toEqual([])
    await expect(apply(asked.row)).toHaveCount(0)

    // The pick — here the dev build's stand-in for the chooser — loads through the ordinary
    // admit → token path; a real file picked while the demo is up replaces the demo.
    await expect(page.locator('aside').getByText('high-first.ifc')).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => statusText(page), { timeout: 30_000 }).toContain('5 / 5')
    await expect.poll(sessionModels(dir), { timeout: 20_000 }).toEqual(['high-first'])
  } finally {
    await app.close()
  }
})
