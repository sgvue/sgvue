/**
 * 2026-11-23 — the Spatial-structure card compares the models (`docs/DEVIATIONS.md`; the owner's
 * approved prototype `prototype/project-card/`). The built app, the real parse worker, the
 * committed fixtures: `containers/full-ifc4.ifc` (every attribute and property set),
 * `containers/sparse-ifc2x3.ifc` (most of them absent) and `tiny.ifc`.
 *
 * Run it only through `node scripts/safe-e2e.cjs` (`npm run test:e2e`): every Electron start in
 * this repository goes through a footprint / pressure / time guard.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DROP_COPY, launch, ROOT, TINY } from './helpers'

const FULL = join(ROOT, 'tests/fixtures/containers/full-ifc4.ifc')
const SPARSE = join(ROOT, 'tests/fixtures/containers/sparse-ifc2x3.ifc')

let dir = ''

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-e2e-'))
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Open the picked files, wait for the viewer, open the card from the sidebar's IfcProject button. */
async function openCard(page: Page): Promise<Locator> {
  await page.getByText(DROP_COPY).click()
  await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
  await page.locator('button[data-tip="Project, site and building information"]').click()
  const body = page.locator('[data-role="projtable"]')
  await expect(body).toHaveCount(1)
  return body.locator('xpath=..')
}

const width = (l: Locator): Promise<number> => l.evaluate((e) => Math.round(e.getBoundingClientRect().width))

test('one model: the 340 px card, the file’s own attributes, no model heading row and no switch', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: FULL })
  try {
    const card = await openCard(page)
    await expect(card).toContainText('Spatial structure')
    expect(await width(card)).toBe(340)
    await expect(card.locator('thead')).toHaveCount(0)
    await expect(card.getByRole('button', { name: /differences only/ })).toHaveCount(0)
    await expect(card.locator('[aria-label="differs"]')).toHaveCount(0)
    // The file's own IfcProject Name and LongName, a site attribute, a property set and its value.
    for (const text of ['Synthetic Project', 'Synthetic Project — Long Name', 'LOT-0001-A', '12° 34′ 56.789000″ N', 'Project_Information', 'Sample Client']) {
      await expect(card).toContainText(text)
    }
  } finally {
    await app.close()
  }
})

test('three models: a column each, differing rows marked and tinted, "differences only" hides the rest', async () => {
  const { app, page } = await launch(dir, { SGVUE_OPEN_PATHS: `${FULL}:::${SPARSE}:::${TINY}` })
  try {
    const card = await openCard(page)
    // 340 + 190 for each other model, inside the lane.
    expect(await width(card)).toBe(720)
    const heads = card.locator('thead th')
    await expect(heads).toHaveCount(4)
    const labels = (await heads.allInnerTexts()).map((t) => t.trim()).filter(Boolean).sort()
    expect(labels).toEqual(['full-ifc4', 'sparse-ifc2x3', 'tiny'])

    const toggle = card.getByRole('button', { name: /differences only/ })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    const count = Number((await toggle.innerText()).replace(/\D+/g, ''))
    expect(count).toBeGreaterThan(0)
    // One dot per differing row, and the count says how many.
    await expect(card.locator('[aria-label="differs"]')).toHaveCount(count)

    // A differing row: its off cell is tinted, its dot is in the key gutter.
    const longName = card.locator('tr[data-row]', { has: page.locator('td[data-key]', { hasText: /^LongName$/ }) }).first()
    await expect(longName.locator('[aria-label="differs"]')).toHaveCount(1)
    const tints = await longName.locator('td:not([data-key]) span').evaluateAll((spans) =>
      spans.map((s) => getComputedStyle(s).backgroundColor)
    )
    expect(tints.filter((c) => c !== 'rgba(0, 0, 0, 0)').length).toBe(1)

    // An identity row is never marked.
    const gid = card.locator('tr[data-row]', { has: page.locator('td[data-key]', { hasText: /^GlobalId$/ }) }).first()
    await expect(gid.locator('[aria-label="differs"]')).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const rows = card.locator('tbody tr[data-row]')
    await expect(rows).toHaveCount(count)
    await expect(card.locator('td[data-key]', { hasText: /^GlobalId$/ })).toHaveCount(0)
    await expect(card.locator('td[data-key]', { hasText: /^Elements$/ })).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(await card.locator('tbody tr[data-row]').count()).toBeGreaterThan(count)

    // ── Wider than the card: a narrower window, so the 720 px card is clamped by the lane and the
    // table scrolls sideways. The key column stays put, the model columns move, and the group
    // heading still spans the visible width.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 760))
    const body = card.locator('[data-role="projtable"]')
    await expect.poll(() => body.evaluate((b) => b.scrollWidth - b.clientWidth)).toBeGreaterThan(40)
    interface Box {
      key: number
      keyRight: number
      model: number
      label: number
      labelRight: number
      ruleLeft: number
      ruleRight: number
      visibleRight: number
      merged: number
      scrolled: boolean
    }
    const measure = (): Promise<Box> =>
      body.evaluate((b) => {
        const key = b.querySelector('tbody td[data-key]')!.getBoundingClientRect()
        const model = b.querySelectorAll('thead th')[1].getBoundingClientRect()
        // The first group heading: its sticky label, then the rule beside it.
        const row = b.querySelector('tbody tr td > div')!
        const label = row.children[0].getBoundingClientRect()
        const rule = row.children[1].getBoundingClientRect()
        const merged = b.querySelector('[data-merged]')!.getBoundingClientRect()
        const box = b.getBoundingClientRect()
        return {
          key: key.left,
          keyRight: key.right,
          model: model.left,
          label: label.left,
          labelRight: label.right,
          ruleLeft: rule.left,
          ruleRight: rule.right,
          visibleRight: box.left + b.clientLeft + b.clientWidth,
          merged: merged.left,
          scrolled: b.hasAttribute('data-scrolled')
        }
      })
    /** The rule covers the visible width: it starts at the label (8 px gap) and runs to the card's 14 px inset. */
    const ruleSpans = (m: Box): void => {
      expect(m.ruleLeft).toBeLessThanOrEqual(m.labelRight + 8 + 1)
      expect(m.ruleRight).toBeGreaterThanOrEqual(m.visibleRight - 14 - 1)
    }
    const before = await measure()
    expect(before.scrolled).toBe(false)
    ruleSpans(before)
    // At rest a merged value starts where the model columns start, at the key column's edge.
    expect(Math.abs(before.merged - before.keyRight)).toBeLessThanOrEqual(0.5)
    await body.evaluate((b) => { b.scrollLeft = 120 })
    await expect.poll(async () => (await measure()).scrolled).toBe(true)
    // The merged value's 0.12 s move to its scrolled place.
    await expect.poll(async () => { const m = await measure(); return m.merged - m.keyRight }).toBeGreaterThanOrEqual(6)
    const after = await measure()
    expect(Math.abs(after.key - before.key)).toBeLessThanOrEqual(0.5)
    expect(before.model - after.model).toBeGreaterThan(100)
    // The heading's label does not move, and its rule still covers the visible width.
    expect(Math.abs(after.label - before.label)).toBeLessThanOrEqual(0.5)
    ruleSpans(after)
    // Scrolled, a merged value stands clear of the key column's hairline.
    expect(after.merged).toBeGreaterThanOrEqual(after.keyRight + 6)
  } finally {
    await app.close()
  }
})
