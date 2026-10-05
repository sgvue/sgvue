/**
 * 2026-10-02 — the assistant places markups, in the built app (assistant parity, phase 4 of 4).
 * Run it only through `node scripts/safe-e2e.cjs` (`npm run test:e2e`).
 *
 * A person places a spot coordinate or a laser measurement by clicking a surface. The assistant
 * has no pointer, so `manage_markups` takes an element and a place on its bounding box — and
 * what it places is made by the viewer's own commit for that click (`viewer-core.ts`,
 * `commitSpot` / `commitLaser`). The unit tests hold the arithmetic and the wording
 * (`ai-parity-4.test.ts`, `annotate.test.ts`); what only the real app can show is that the
 * record is **the same one a click makes**: the tag in the overlay, the count in the action bar,
 * the row in the Markups card, the tag's own two states — and that the laser's rays really read
 * the model.
 *
 * The follow-up of the same day: a markup a reply placed is session view state, so **that
 * reply's `revert` takes it away** — from the card, the overlay and the action bar's count, in
 * one click — and takes nothing else: a spot placed by hand before it, and an earlier reply's
 * measurement, stay where they are.
 *
 * **No API and no key.** Main's two turn handlers are held (`helpers.ts`) and each tool call is
 * sent over the real channel, inside a live turn; the executors, the store and the viewer are
 * the app's own.
 */
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signedF3 } from '../../src/shared/fmt'
import { actionText, emit, holdTurns, launch, statusText, tool, toolResults, type ToolAnswer } from './helpers'

const DEMO = 'try the demo building →'
const ASK = 'button[data-tip^="Ask the assistant"]'

let dir = ''

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-markups-'))
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** One whole turn over the held channels: the question, each call run by the app's own executor, the reply. */
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
  const last = page.locator('[data-role="chatlog"] > [data-row]').last()
  await expect(last).not.toHaveAttribute('aria-hidden', 'true')
  // By its own index, so that it is still this reply's row after later turns.
  const row = page.locator(`[data-role="chatlog"] > [data-row="${await last.getAttribute('data-row')}"]`)
  return { row, results: (await toolResults(app)).slice(before) }
}

test('the assistant places a spot coordinate and a laser measurement: the records a click makes, in the Markups card — and a reply’s revert takes away what that reply placed', async () => {
  const { app, page } = await launch(dir)
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: DEMO }).click()
    await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
    await expect.poll(() => statusText(page), { timeout: 20_000 }).toContain('412 / 412')
    await page.locator(ASK).click()
    await expect(page.locator('[data-role="chatlog"]')).toBeVisible()
    await holdTurns(app)
    const overlay = page.locator('[data-role="overlay"]')
    const folded = overlay.locator(':scope > div[title="Show E, N and Z"]')
    const open = overlay.locator(':scope > div[title="Show level only"]')
    expect(await actionText(page)).toBe('')

    // ── the element, and its box, as the model would read them ──
    const found = await turn(
      app,
      page,
      'Where is the ground slab?',
      [
        [
          'query_sql',
          {
            sql:
              "SELECT e.id, b.min_x, b.min_y, b.min_z, b.max_x, b.max_y, b.max_z FROM element e " +
              "JOIN bbox b ON b.element = e.id WHERE e.name = 'Ground Slab' ORDER BY e.id LIMIT 1"
          }
        ]
      ],
      'Found it.'
    )
    const [id, x0, y0, z0, x1, y1, z1] = (found.results[0].result as { rows: number[][] }).rows[0]
    expect(z1).toBeGreaterThan(z0)

    // ── 1. a spot on top of it: one call, and it is in the overlay, the bar and the card ──
    const spot = await turn(
      app,
      page,
      'Put a spot coordinate on top of it.',
      [['manage_markups', { op: 'place_spot', id, at: 'top' }]],
      'Placed spot coordinate C1 on top of the Ground Slab’s bounding box.'
    )
    const placed = spot.results[0].result as {
      placed: boolean
      name: string
      message: string
      at: string
      on: string
      pointFrame: string
      pointMetres: { x: number; y: number; z: number }
      spot: { name: string; level: number }
    }
    expect(spot.results[0].ok).toBe(true)
    expect(placed).toMatchObject({ placed: true, name: 'C1', at: 'top', on: 'bounding box', pointFrame: 'project' })
    // The middle of the box's top face, to the millimetre — the point `get_element` would report.
    expect(placed.pointMetres.x).toBeCloseTo((x0 + x1) / 2, 3)
    expect(placed.pointMetres.y).toBeCloseTo((y0 + y1) / 2, 3)
    expect(placed.pointMetres.z).toBeCloseTo(z1, 3)
    // The demo has no base point, so the spot reads its level in the file's own metres.
    expect(placed.spot.level).toBeCloseTo(z1, 3)
    expect(placed.message).toContain('at the middle of the top face of the bounding box of "Ground Slab"')
    expect(placed.message).toContain('this reply’s revert takes it away again')
    // The reply added a markup to the view, which a revert can take away again: it offers one.
    // (And no Apply: placing is the user's click, not a request.)
    const revertSpot = spot.row.getByRole('button', { name: 'revert', exact: true })
    await expect(revertSpot).toHaveCount(1)
    await expect(spot.row.getByRole('button', { name: 'apply', exact: true })).toHaveCount(0)

    // The same tag a click with the spot tool makes: folded to its level, with the click's own title.
    await expect.poll(() => actionText(page)).toBe('1 spotsclear')
    await expect(folded).toHaveCount(1)
    await expect(open).toHaveCount(0)
    expect((await folded.textContent())!.trim()).toBe(signedF3(z1))

    // ── 2. the tag's two states, set by name — a click on the tag, and idempotent ──
    const full = await turn(app, page, 'Show its full coordinates.', [['manage_markups', { op: 'show', name: 'C1', show: 'full' }]], 'C1 shows E, N and Z now.')
    expect(full.results[0].result).toEqual({ message: 'C1 now shows the full E, N and Z.', show: 'full', changed: 1 })
    await expect(open).toHaveCount(1)
    await expect(folded).toHaveCount(0)
    // The design's grid: its last line is the file's own x, y, z in millimetres.
    const xyz = (await open.locator('span').last().textContent())!.split(', ').map(Number)
    expect(xyz[2]).toBe(Math.round(z1 * 1000))
    expect(xyz[0]).toBe(Math.round(((x0 + x1) / 2) * 1000))
    const again = await turn(app, page, 'And again.', [['manage_markups', { op: 'show', name: 'C1', show: 'full' }]], 'It already does.')
    expect((again.results[0].result as { changed: number }).changed).toBe(0)
    // The user's own click on the tag folds it again: one state, two hands.
    await open.click()
    await expect(folded).toHaveCount(1)

    // ── 3. a laser measurement from the same place: the laser tool's own rays ──
    const laser = await turn(
      app,
      page,
      'Now measure from there.',
      [['manage_markups', { op: 'place_measure', id, at: 'top' }]],
      'Placed laser measurement M1 on top of the Ground Slab’s bounding box.'
    )
    const measured = laser.results[0].result as {
      placed: boolean
      name: string
      measure: { name: string; x?: number; y?: number; z?: number }
    }
    expect(measured).toMatchObject({ placed: true, name: 'M1' })
    // It read something real: at least one axis, each a positive length in the card's unit (mm).
    const lengths = [measured.measure.x, measured.measure.y, measured.measure.z].filter((v): v is number => typeof v === 'number')
    expect(lengths.length).toBeGreaterThan(0)
    for (const mm of lengths) expect(mm).toBeGreaterThan(0)
    await expect.poll(() => actionText(page)).toBe('1 measuresclear·1 spotsclear')

    // ── 4. the Markups card lists both, as it lists the ones a click places ──
    const listed = await turn(app, page, 'What markups are there?', [['manage_markups', { op: 'list' }]], 'One of each.')
    expect(listed.results[0].result).toMatchObject({
      measuresTotal: 1,
      spotsTotal: 1,
      measures: [measured.measure],
      spots: [{ name: 'C1', level: placed.spot.level }]
    })
    await page.locator('[data-role="actionbar"] button', { hasText: '1 measures' }).click()
    const card = page.locator('[data-role="stage"] > div').filter({ hasText: /^Markups/ })
    await expect(card).toBeVisible()
    await expect(card).toContainText('M1')
    await expect(card).toContainText('C1')

    // ── 5. and it is deleted the way any markup is: asked for, behind the user's Apply ──
    const del = await turn(app, page, 'Delete the spot.', [['manage_markups', { op: 'delete', name: 'C1' }]], 'I have asked to delete C1. Click Apply to confirm.')
    expect(del.results[0].result).toMatchObject({ applied: false, pending: true })
    expect(await actionText(page)).toBe('1 measuresclear·1 spotsclear')
    await del.row.getByRole('button', { name: 'apply', exact: true }).click()
    await expect.poll(() => actionText(page)).toBe('1 measuresclear')
    await expect(folded).toHaveCount(0)

    // ── 6. a reply's revert takes away what that reply placed — and nothing else ──
    const spotRows = card.locator('button[data-tip="Zoom to this point"]')
    const laserRows = card.locator('button[data-tip="Zoom to this measurement"]')
    // The first reply's spot is gone already — the user deleted it, above — so its revert has
    // nothing to remove: no markup goes, and nothing is said. The reply is closed all the same.
    // (The panel's status line: the one line the log shows under its rows, only when there is
    // something to say.)
    const status = page.locator('[data-role="chatlog"] > span:not(.sr-only)')
    await expect(revertSpot).toHaveCount(1)
    await revertSpot.click()
    await expect(revertSpot).toHaveCount(0)
    await expect(spot.row).toHaveCSS('opacity', '0.5')
    expect(await actionText(page)).toBe('1 measuresclear')
    await expect(laserRows).toHaveText(['M1'])
    await expect(status).toHaveCount(0)

    // A spot placed by hand: the user's own click with the spot tool, on the building.
    await page.locator('button[data-tip="Spot coordinate (C)"]').click()
    const vp = (await page.locator('[data-role="viewport"]').boundingBox())!
    const [cx, cy] = [vp.x + vp.width / 2, vp.y + vp.height / 2]
    await page.mouse.move(cx - 10, cy)
    await page.mouse.move(cx, cy)
    await page.mouse.click(cx, cy)
    await expect.poll(() => actionText(page)).toBe('1 measuresclear·1 spotsclear')
    await page.locator('button[data-tip^="Select (Esc)"]').click()
    await expect(folded).toHaveCount(1)
    await expect(spotRows).toHaveText(['C1'])
    /** The card's first spot row, whole: its name and what it reads. */
    const firstSpotRow = card.locator('div.hv-step', { has: page.locator('button[data-tip="Zoom to this point"]') }).first()
    const mine = { tag: (await folded.textContent())!.trim(), row: await firstSpotRow.textContent() }

    // The assistant places another, after it: C2 — in the bar's count, the overlay and the card.
    const second = await turn(
      app,
      page,
      'Put another spot on top of the slab.',
      [['manage_markups', { op: 'place_spot', id, at: 'top' }]],
      'Placed spot coordinate C2 on top of the Ground Slab’s bounding box.'
    )
    expect(second.results[0].result).toMatchObject({ placed: true, name: 'C2' })
    await expect.poll(() => actionText(page)).toBe('1 measuresclear·2 spotsclear')
    await expect(folded).toHaveCount(2)
    await expect(spotRows).toHaveText(['C1', 'C2'])
    const revert = second.row.getByRole('button', { name: 'revert', exact: true })
    await expect(revert).toHaveCount(1)
    const before = { bar: await actionText(page), tags: await folded.count(), rows: await spotRows.allTextContents() }

    // One click: gone from the action bar's count, from the overlay and from the card.
    await revert.click()
    await expect.poll(() => actionText(page)).toBe('1 measuresclear·1 spotsclear')
    await expect(folded).toHaveCount(1)
    await expect(spotRows).toHaveText(['C1'])
    // The spot placed by hand before it is still there, exactly as it was — its tag and its
    // row — and so is the measurement an earlier reply placed.
    expect((await folded.textContent())!.trim()).toBe(mine.tag)
    expect(await firstSpotRow.textContent()).toBe(mine.row)
    await expect(laserRows).toHaveText(['M1'])
    // The reply is dimmed, and offers revert no more.
    await expect(revert).toHaveCount(0)
    await expect(second.row).toHaveCSS('opacity', '0.5')
    console.log(
      `\n[markups] a reply's revert: before — action bar "${before.bar}", ${before.tags} spot tags, card rows ${JSON.stringify(before.rows)}; ` +
        `after — action bar "${await actionText(page)}", ${await folded.count()} spot tag, card rows ${JSON.stringify(await spotRows.allTextContents())}, ` +
        `laser rows ${JSON.stringify(await laserRows.allTextContents())}; the hand-placed tag still reads ${mine.tag}`
    )

    // The earlier reply's measurement is that reply's to take away, and only that one's.
    await laser.row.getByRole('button', { name: 'revert', exact: true }).click()
    await expect.poll(() => actionText(page)).toBe('1 spotsclear')
    await expect(spotRows).toHaveText(['C1'])
    await expect(folded).toHaveCount(1)
  } finally {
    await app.close()
  }
})
