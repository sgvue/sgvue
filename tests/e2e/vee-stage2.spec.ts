/**
 * "Vee Messages", stage 2 — 2026-11-08 (`prototypes/vee-messages/full/HANDOFF.md` §2, §7, §8; the
 * owner's decisions B, C and D), in the built app. Run it only through `node scripts/safe-e2e.cjs`
 * (`npm run test:e2e`).
 *
 * The unit tests hold the rules (`tests/unit/vee-stage2.test.ts`); this shows the three pieces in
 * the real Ask Vee window, on the demo building:
 *
 *   · **the heads-up line** — the app's own observation over what the reply's call touched — stands
 *     after the answer and **before** its consent card, in amber, with no control, its names mono
 *     and uncoloured;
 *   · **IFC terms** in Vee's text are drawn in their one colour exactly when the loaded models carry
 *     the name, and a near miss is not; a user's own words never are;
 *   · **the IFC+SG question** shows `Yes` / `No` quick replies that never take the focus by
 *     themselves, and the user's click answers it — once.
 *
 * **No API, no key, and no `window.__sgvueDev`.** Main's two turn handlers are held (`helpers.ts`)
 * and each tool call is sent over the real channel; the executors, the store, the heads-up, the
 * term lookup and the Vee window are the app's own.
 *
 * The demo building's facts used here: its D2 entrance doors carry `FireRating` "-" (a placeholder,
 * `ai/heads-up.ts`), few enough that isolating them is held by the 5 % guard; its trees and turf
 * carry `SGPset_Planting` and `SGPset_SoftLandscape`, so the IFC+SG question can be asked about them.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { askVee, demoWithVee, emit, tool, toolResults, type Held } from './helpers'

let dir = ''

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-stage2-'))
})

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const held = (app: ElectronApplication): Promise<Held> =>
  app.evaluate(() => (globalThis as unknown as { __turn: Held }).__turn)

/** One whole turn over the held channels: the question, each call run and answered, the reply. */
async function turn(app: ElectronApplication, vee: Page, question: string, calls: [string, unknown][], reply: string): Promise<void> {
  const send = vee.locator('button[data-part="send"]')
  const before = (await toolResults(app)).length
  await askVee(vee, question)
  await expect(send).toHaveAttribute('aria-label', 'Stop')
  for (const [name, input] of calls) await tool(app, name, input)
  await expect.poll(async () => (await toolResults(app)).length).toBe(before + calls.length)
  await emit(app, { type: 'done', text: reply, rounds: 2 })
  await expect(send).toHaveAttribute('aria-label', 'Send (Enter)')
  await expect(vee.locator('[data-role="chatlog"] > [data-row]').last()).not.toHaveAttribute('aria-hidden', 'true')
}

/** The colour a token resolves to in the Vee window, read off a probe inside its root. */
const token = (vee: Page, name: string): Promise<string> =>
  vee.evaluate((n) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${n})`
    document.querySelector('.vm')!.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  }, name)

const DOORS = [
  { prop: 'IfcEntity', op: '=', val: 'IfcDoor' },
  { prop: 'FireRating', op: '=', val: '-' }
]
/**
 * Two paragraphs — two bubbles — with three names the demo carries (a property, a class, a door
 * type's ObjectType) and two near misses: the prettified `Fire Rating` and a misspelt class.
 */
const TERMS_ANSWER = [
  'These doors have no real fire rating: their `FireRating` reads “-”. Show only those?',
  '',
  'All of them are `IfcDoor` of type `D2 Double 2400x2400` — not `Fire Rating`, and there is no `IfcDor`.'
].join('\n')

test('a heads-up stands before its consent card; IFC terms take their colour and a near miss does not', async () => {
  const { app, vee } = await demoWithVee(dir)
  try {
    const log = vee.locator('[data-role="chatlog"]')
    // The user's own words, backticks and all, are never coloured.
    await turn(app, vee, 'Which `IfcDoor` show only a dash as their fire rating? Show just those.', [['apply_visibility', { action: 'isolate', rules: DOORS }]], TERMS_ANSWER)
    const results = await toolResults(app)
    // Few enough that the 5 % guard held the isolate behind the user's Apply.
    expect(results[results.length - 1]).toMatchObject({ ok: true, result: { applied: false, pending: true } })
    const reply = log.locator(':scope > [data-row]').last()

    // 1 — the heads-up: the app's own line, over the doors that call touched — amber, no control.
    const hu = reply.locator('[data-role="heads-up"]')
    await expect(hu).toHaveCount(1)
    await expect(hu).toHaveText(/^Heads-up: \d+ doors? says? “-” as (its|their) FireRating\. I counted (it|them) in\.$/)
    await expect(hu.locator('button, a, [tabindex]')).toHaveCount(0)
    expect(await hu.evaluate((e) => getComputedStyle(e).color)).toBe(await token(vee, '--warn-ink'))
    // Its name is mono, and uncoloured: amber keeps its one meaning.
    await expect(hu.locator('code')).toHaveText(['FireRating'])
    await expect(hu.locator('.ifc-term')).toHaveCount(0)

    // 2 — before the consent card, which it qualifies: after it in no order, above it on screen.
    const card = reply.locator('[data-role="consent"]')
    await expect(card).toHaveCount(1)
    await expect(card.locator('.vm-tape')).toHaveCount(1)
    expect(await hu.evaluate((h, c) => !!(h.compareDocumentPosition(c!) & Node.DOCUMENT_POSITION_FOLLOWING), await card.elementHandle())).toBe(true)
    expect((await hu.boundingBox())!.y).toBeLessThan((await card.boundingBox())!.y)
    await expect(card.locator('button.vm-no')).toHaveText('Cancel')
    await expect(card.locator('button.vm-go')).toHaveText('Apply')
    // The card asked for this; it never takes the focus by itself.
    expect(await vee.evaluate(() => !!document.activeElement?.closest('[data-role="consent"]'))).toBe(false)

    // 3 — IFC terms: exactly the names the models carry, in the one colour, mono at medium weight;
    // the near misses are the plain mono a code span always was.
    const bubbles = reply.locator('.vm-stack > .vm-b.vm-tx')
    await expect(bubbles).toHaveCount(2)
    await expect(reply.locator('.vm-stack > .vm-b.vm-tx .ifc-term')).toHaveText(['FireRating', 'IfcDoor', 'D2 Double 2400x2400'])
    const termColour = await token(vee, '--ifc-term')
    for (const t of await reply.locator('.ifc-term').all()) {
      expect(await t.evaluate((e) => [getComputedStyle(e).color, getComputedStyle(e).fontWeight, getComputedStyle(e).fontFamily.includes('Mono')])).toEqual([
        termColour,
        '500',
        true
      ])
    }
    const near = bubbles.nth(1).locator('span:not(.ifc-term)', { hasText: /^(Fire Rating|IfcDor)$/ })
    await expect(near).toHaveText(['Fire Rating', 'IfcDor'])
    for (const t of await near.all()) {
      const [colour, mono] = await t.evaluate((e) => [getComputedStyle(e).color, getComputedStyle(e).fontFamily.includes('Mono')] as const)
      expect(colour).not.toBe(termColour)
      expect(mono).toBe(true)
    }
    // Never in the user's bubble, the board or the consent card.
    await expect(log.locator(':scope > [data-mine] .ifc-term')).toHaveCount(0)
    await expect(log.locator(':scope > [data-mine]').last()).toContainText('`IfcDoor`')
    await expect(vee.locator('[data-role="vee-board"] .ifc-term, [data-role="consent"] .ifc-term')).toHaveCount(0)

    // 4 — the user's Apply: the stub tears, the stamp lands with the reply's one Revert on it, and
    // the board says what the 3D view shows now. The heads-up stays where it was.
    await card.locator('button.vm-go').click()
    await expect(card.locator('.vm-stamp')).toHaveText(/^APPLIED · \d\d:\d\d$/)
    await expect(card.locator('.vm-done button.vm-rv')).toHaveText('Revert')
    await expect(vee.locator('[data-role="vee-board"]')).toHaveClass(/vm-iso/)
    await expect(vee.locator('[data-role="vee-board"] .vm-board-txt')).toHaveText(/^\d+ of 412 shown/)
    await expect(hu).toHaveCount(1)
    await card.locator('.vm-done button.vm-rv').click()
    await expect(card.locator('.vm-stamp')).toHaveText(/^REVERTED · \d\d:\d\d$/)
    await expect(vee.locator('[data-role="vee-board"] .vm-board-txt')).toHaveText(/^All 412 shown/)
  } finally {
    await app.close()
  }
})

test('the IFC+SG question: Yes and No that never take the focus, answered once by the user’s click', async () => {
  const { app, vee } = await demoWithVee(dir)
  try {
    const log = vee.locator('[data-role="chatlog"]')
    // The trees and the turf carry SGPset_ sets: read by rule first, then asked about.
    await turn(
      app,
      vee,
      'What types are the trees?',
      [
        ['query_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcGeographicElement' }] }],
        ['ask_choice', { lead: 'These elements carry `SGPset_Planting` and `SGPset_SoftLandscape` values.' }]
      ],
      'One thing first.'
    )
    const results = await toolResults(app)
    expect(results[results.length - 1]).toMatchObject({ ok: true, result: { asked: true } })
    const reply = log.locator(':scope > [data-row]').last()

    // Vee's lead-in is a bubble of Vee's; the question is the app's own, apart from it — no tape,
    // no card — with its two quick replies.
    const ask = reply.locator('[data-role="ask"]')
    await expect(ask).toHaveAttribute('aria-label', 'Question from SGVue')
    await expect(ask.locator('.vm-ask-q')).toHaveText('Is this model for an IFC+SG submission?')
    await expect(reply.locator('.vm-stack > .vm-b.vm-tx').last()).toContainText('These elements carry SGPset_Planting')
    await expect(ask.locator('.vm-tape')).toHaveCount(0)
    expect(await ask.evaluate((e) => e.classList.contains('vm-card'))).toBe(false)
    const replies = ask.locator('[aria-label="Quick replies"] button')
    await expect(replies).toHaveText(['Yes', 'No'])
    // In the tab order, and never focused by themselves.
    for (const b of await replies.all()) expect(await b.evaluate((e) => (e as HTMLButtonElement).tabIndex)).toBe(0)
    await vee.waitForTimeout(500)
    expect(await vee.evaluate(() => !!document.activeElement?.closest('[data-role="ask"]'))).toBe(false)
    // The polite announcement carries the question with the reply.
    await expect(vee.locator('[data-role="vee-announce"]')).toContainText('Is this model for an IFC+SG submission?')

    // The user's click answers it: the reply's text is sent as the user's message, once, and the
    // quick replies are gone — there is nothing left to answer it with.
    const before = (await held(app)).id
    await replies.filter({ hasText: 'Yes' }).click()
    await expect.poll(async () => (await held(app)).id).not.toBe(before)
    expect((await held(app)).asked?.userText).toBe('Yes')
    await expect(ask.locator('button')).toHaveCount(0)
    await expect(ask.locator('.vm-ask-q')).toHaveText('Is this model for an IFC+SG submission?')
    await expect(log.locator(':scope > [data-mine]').last()).toContainText('Yes')
    await expect(log.locator(':scope > [data-mine]', { hasText: /^Yes/ })).toHaveCount(1)

    // The answer is the conversation's now: the view state reads it back, and Vee cannot ask again.
    await tool(app, 'get_view_state', {})
    await tool(app, 'query_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcGeographicElement' }] })
    await tool(app, 'ask_choice', { lead: 'Again?' })
    await expect.poll(async () => (await toolResults(app)).length).toBe(results.length + 3)
    const later = (await toolResults(app)).slice(-3)
    expect(later[0]).toMatchObject({ ok: true, result: { ifcsg: 'yes' } })
    expect(later[2]).toMatchObject({ ok: true, result: { asked: false } })
    await emit(app, { type: 'done', text: 'In IFC+SG terms, then.', rounds: 2 })
    await expect(vee.locator('button[data-part="send"]')).toHaveAttribute('aria-label', 'Send (Enter)')
    await expect(log.locator('[data-role="ask"] button')).toHaveCount(0)
    await expect(log.locator('[data-role="ask"]')).toHaveCount(1)
  } finally {
    await app.close()
  }
})
