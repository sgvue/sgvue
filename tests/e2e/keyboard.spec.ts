/**
 * Phase 10's accessibility work, walked with a keyboard — the element tree, the context menu
 * and the two dialogs. Run it only through `node scripts/safe-e2e.cjs` (`npm run test:e2e`).
 *
 * Everything asserted here is invisible: roles, `aria-*`, which element has focus and which
 * one is tabbable. Not one pixel of a designed surface changes, which is what the parity
 * re-capture in `tests/parity/phase10/README.md` measures.
 *
 * The fixture is the committed `tiny.ifc`: 4 `IfcWall` and 2 `IfcSlab` over two storeys, so
 * the tree has two groups and six rows — small enough to name every node in an assertion.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DROP_COPY, launch, TINY } from './helpers'

/** What the browser says has focus, as `<role>:<data-tree-key or text>`. */
const focused = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return 'body'
    const key = el.getAttribute('data-tree-key')
    const label = key || (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    return `${el.getAttribute('role') || el.tagName.toLowerCase()}:${label}`
  })

let dir = ''
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-keys-'))
  const launched = await launch(dir, { SGVUE_OPEN_PATHS: TINY })
  app = launched.app
  page = launched.page
  await page.getByText(DROP_COPY).click()
  await expect(page.locator('[data-role="landing"]')).toHaveCount(0, { timeout: 60_000 })
})

test.afterAll(async () => {
  await app.close()
  await rm(dir, { recursive: true, force: true })
})

test('the element tree is a tree, and the arrow keys walk it', async () => {
  const tree = page.locator('[role="tree"]')
  await expect(tree).toHaveAttribute('aria-labelledby', 'sgvue-tree-title')
  // The design's own heading is what names it, so no copy was invented for a screen reader.
  await expect(page.locator('#sgvue-tree-title')).toHaveText('Elements by Entity')

  const groups = tree.locator('[role="treeitem"][aria-level="1"]')
  await expect(groups).toHaveCount(2)
  await expect(groups.nth(0)).toHaveAttribute('data-tree-key', 'g:IfcSlab')
  await expect(groups.nth(1)).toHaveAttribute('data-tree-key', 'g:IfcWall')
  await expect(groups.nth(0)).toHaveAttribute('aria-expanded', 'false')

  // Exactly one node of the tree is tabbable — the roving tabindex.
  const tabbable = async (): Promise<number> =>
    tree.locator('[role="treeitem"][tabindex="0"]').count()
  expect(await tabbable()).toBe(1)

  await groups.nth(0).focus()
  expect(await focused(page)).toBe('treeitem:g:IfcSlab')

  // ↓ / ↑ move one node at a time.
  await page.keyboard.press('ArrowDown')
  expect(await focused(page)).toBe('treeitem:g:IfcWall')
  await page.keyboard.press('ArrowUp')
  expect(await focused(page)).toBe('treeitem:g:IfcSlab')

  // → opens the group…
  await page.keyboard.press('ArrowRight')
  await expect(groups.nth(0)).toHaveAttribute('aria-expanded', 'true')
  await expect(tree.locator('[role="treeitem"][aria-level="2"]')).toHaveCount(2)
  // …and again descends into it, onto a row that says where it sits in the group.
  await page.keyboard.press('ArrowRight')
  expect(await focused(page)).toMatch(/^treeitem:i:\d+$/)
  const row = tree.locator('[role="treeitem"][aria-level="2"]').first()
  await expect(row).toHaveAttribute('aria-posinset', '1')
  await expect(row).toHaveAttribute('aria-setsize', '2')
  await expect(row).toHaveAttribute('aria-selected', 'false')
  expect(await tabbable()).toBe(1)

  // Enter does what a click does: it selects, and the designed property card opens.
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-role="propcard"]')).toBeVisible()
  await expect(row).toHaveAttribute('aria-selected', 'true')

  // ← climbs back to the group, and again closes it.
  await page.keyboard.press('ArrowLeft')
  expect(await focused(page)).toBe('treeitem:g:IfcSlab')
  await page.keyboard.press('ArrowLeft')
  await expect(groups.nth(0)).toHaveAttribute('aria-expanded', 'false')
  await expect(tree.locator('[role="treeitem"][aria-level="2"]')).toHaveCount(0)

  // End reaches the last node, Home the first.
  await page.keyboard.press('End')
  expect(await focused(page)).toBe('treeitem:g:IfcWall')
  await page.keyboard.press('Home')
  expect(await focused(page)).toBe('treeitem:g:IfcSlab')

  // Space toggles the group, exactly as Enter and a click do.
  await page.keyboard.press(' ')
  await expect(groups.nth(0)).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press(' ')
  await expect(groups.nth(0)).toHaveAttribute('aria-expanded', 'false')
})

test('the context menu is a menu, traps focus, and gives it back on Escape', async () => {
  const tree = page.locator('[role="tree"]')
  await tree.locator('[role="treeitem"][aria-level="1"]').nth(1).click() // open IfcWall
  const row = tree.locator('[role="treeitem"][aria-level="2"]').first()
  const key = await row.getAttribute('data-tree-key')
  await row.click({ button: 'right' })

  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  const items = menu.locator('[role="menuitem"]')
  await expect(items).toHaveCount(12)
  // Focus went to the first item, and it is the only tabbable one.
  expect(await focused(page)).toMatch(/^menuitem:Hide/)
  await expect(menu.locator('[role="menuitem"][tabindex="0"]')).toHaveCount(1)

  await page.keyboard.press('ArrowDown')
  expect(await focused(page)).toMatch(/^menuitem:Hide similar ·/)
  await page.keyboard.press('End')
  expect(await focused(page)).toMatch(/^menuitem:Zoom extents/)
  // Tab cannot leave the menu.
  await page.keyboard.press('Tab')
  expect(await focused(page)).toMatch(/^menuitem:/)

  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  // …and focus came back to the row it was opened from.
  expect(await focused(page)).toBe(`treeitem:${key}`)
})

test('a menu opened low in the window is lifted by exactly what it overflows', async () => {
  const innerHeight = await page.evaluate(() => window.innerHeight)
  const stage = (await page.locator('[data-role="viewport"]').boundingBox())!
  // 40 px from the bottom edge — past the design's `innerHeight - 260` clamp (`:1901`), which
  // put every menu at the same place whatever it contained.
  const clickY = Math.round(stage.y + stage.height - 40)
  await page.mouse.move(stage.x + 200, clickY)
  await page.mouse.click(stage.x + 200, clickY, { button: 'right' })

  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  // The design's `fadein` is `.1s` and starts at `translateY(3px)`, which a bounding box
  // reports and `offsetTop` does not — measuring during it is measuring the animation. So wait
  // for the menu's own animations to finish rather than for a guessed interval.
  await menu.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished)
    ).then(() => undefined)
  )
  const box = (await menu.boundingBox())!
  const height = await menu.evaluate((el) => (el as HTMLElement).offsetHeight)

  // It never runs off the bottom, which is the whole point…
  expect(box.y + box.height).toBeLessThanOrEqual(innerHeight)
  expect(box.y).toBeGreaterThanOrEqual(0)
  // …it is near the pointer rather than at the design's fixed `innerHeight - 260`, which for
  // this menu was far above it…
  expect(box.y).toBeGreaterThan(innerHeight - 260)
  // …and the top is `clampCtxY`'s arithmetic to the pixel, with its 8 px edge gap.
  const expected = clickY + height <= innerHeight - 8 ? clickY : innerHeight - height - 8
  expect(Math.round(box.y)).toBe(expected)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('Preferences is a labelled modal that takes focus and returns it', async () => {
  const opened = await app.evaluate(({ Menu }) => {
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
  expect(opened).toBe(true)

  const dialog = page.locator('[data-role="prefs"]')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('role', 'dialog')
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  // Named by its own heading, not by invented copy.
  const labelledBy = (await dialog.getAttribute('aria-labelledby'))!
  // An attribute selector, not `#id`: React's `useId()` writes `«r3»`, and `CSS.escape` is a
  // browser API that does not exist in the Node process this test runs in.
  await expect(page.locator(`[id="${labelledBy}"]`)).toHaveText('Preferences')

  // Focus is inside it, and Tab keeps it there.
  expect(await page.evaluate(() => document.querySelector('[data-role="prefs"]')!.contains(document.activeElement))).toBe(true)
  for (let i = 0; i < 14; i++) await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.querySelector('[data-role="prefs"]')!.contains(document.activeElement))).toBe(true)

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('the canvas has a text alternative that says what is loaded', async () => {
  await expect(page.locator('[data-role="viewport"]')).toHaveAttribute('aria-label', '3D view')
  const describedBy = await page.getAttribute('[data-role="viewport"]', 'aria-describedby')
  expect(describedBy).toBe('sgvue-scene')
  const text = (await page.locator('#sgvue-scene').textContent())!
  expect(text).toMatch(/^A 3D view of .*: 1 model, 6 elements, 2 storeys\. 6 of 6 visible\./)
  // It is read, never drawn: no width, no height, nothing painted.
  const box = await page.locator('#sgvue-scene').boundingBox()
  expect(box!.width).toBeLessThanOrEqual(1)
  expect(box!.height).toBeLessThanOrEqual(1)
})

test('the chat transcript is a live log with a labelled composer', async () => {
  // The pill, by its own copy — `Ask Vee` since 2026-10-01, when the assistant got its name.
  await page.getByText('Ask Vee', { exact: true }).click()
  const log = page.locator('[data-role="chatlog"]')
  await expect(log).toHaveAttribute('role', 'log')
  await expect(log).toHaveAttribute('aria-live', 'polite')
  await expect(log).toHaveAttribute('aria-labelledby', 'sgvue-chat-title')
  await expect(page.locator('#sgvue-chat-title')).toHaveText('Ask Vee')
  // The mascot beside the title, in each reply's label and on the pill is decoration: every
  // one is hidden from the accessibility tree, and the name next to it is the text.
  const sprites = page.locator('[data-role="vee"]')
  expect(await sprites.count()).toBeGreaterThanOrEqual(3)
  expect(await sprites.evaluateAll((all) => all.every((e) => e.getAttribute('aria-hidden') === 'true'))).toBe(true)
  const input = page.locator('[data-role="chatinput"]')
  await expect(input).toHaveAttribute('aria-labelledby', 'sgvue-chat-title')
  // The send button is named by the design's own tooltip.
  await expect(page.locator('button[data-tip="Send (Enter)"]')).toHaveAttribute(
    'aria-label',
    'Send (Enter)'
  )
})
