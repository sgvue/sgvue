/**
 * 2026-11-09 — the owner's feedback from trying the Ask Vee window, held here:
 *
 *   · an IFC term is coloured only when it is, case for case, a name the loaded files carry, and
 *     it is bold; the app's own lines name a property in the file's spelling;
 *   · a reply of Vee's is never drawn twice — its IFC+SG lead-in is not repeated when the reply's
 *     text already says it, and a snapshot whose rows share an id is reported in a dev build;
 *   · the header's `New conversation` button: present, labelled, disabled while a turn runs; its
 *     intent is strict, starts the conversation again in the main window and is ignored while a
 *     turn runs; and the next turn tells main to start its transcript afresh.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate, type Federation } from '../../src/shared/federate'
import { AiTurnStart } from '../../src/shared/ipc-contract'
import { VeeIntent, type VeeMessage, type VeeSnapshot } from '../../src/shared/vee-messages'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { MESSY_OPTIONS } from '../../src/renderer/dev/messy'
import { partsOf, saysAlready } from '../../src/renderer/ai/parts'
import { isTerm, termsOf, vocabularyOf } from '../../src/renderer/ai/terms'
import { traceFail } from '../../src/renderer/ai/trace-store'
import { connect, receive } from '../../src/renderer/model/vee-link'
import { setViewer, useShell } from '../../src/renderer/state/shell'
import ChatPanel from '../../src/renderer/app/ChatPanel'
import { sharedIds, takeSnapshot, useVee } from '../../src/renderer/vee/store'
import { memoryStorage, resetShell, stubViewer } from './stub-viewer'

vi.mock('../../src/renderer/vee/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/vee/store')>()
  return { ...real, useVee: Object.assign(() => real.useVee.getState(), real.useVee) }
})

const KEYS = ['ARC', 'STR', 'SIT', 'MEP']
const mock = federate(KEYS.map((k) => mockModelIndex(k)))
const messy = federate(KEYS.map((k) => mockModelIndex(k, MESSY_OPTIONS)))
const st = useShell.getState

function open(fed: Federation): void {
  vi.stubGlobal('localStorage', memoryStorage())
  resetShell()
  setViewer(stubViewer())
  st().commitModels(fed)
}

const vmsg = (p: Partial<VeeMessage>): VeeMessage => ({
  id: 1,
  role: 'assistant',
  text: 'Done.',
  quote: null,
  chips: [],
  table: null,
  pending: null,
  canRevert: false,
  reverted: false,
  trace: null,
  ...p
})
const SNAP: VeeSnapshot = {
  theme: 'dark',
  units: 'mm',
  busy: false,
  err: '',
  replyTo: null,
  suggestOpen: false,
  suggestions: [],
  composer: { text: '', rev: 0 },
  msgs: [],
  hasKey: true,
  hasModel: true
}
function render(msgs: VeeMessage[], over: Partial<VeeSnapshot> = {}): string {
  ;(globalThis as { window?: unknown }).window = { devicePixelRatio: 1 }
  useVee.setState({ ready: false, rev: -1, board: null, copyFlash: null, chatMsgs: [] })
  takeSnapshot({ ...SNAP, ...over, msgs })
  return renderToStaticMarkup(createElement(ChatPanel))
}

beforeEach(() => {
  resetShell()
  traceFail()
})
afterEach(() => {
  connect(null)
  setViewer(null)
  vi.unstubAllGlobals()
  delete (globalThis as { window?: unknown }).window
})

/* ────────────────────────────── item 3: the IFC-term colour ────────────────────────────── */

describe('an IFC term: the file’s exact spelling, and bold', () => {
  const vocab = vocabularyOf(mock)

  it('colours the file’s spelling and never a prettified, re-cased or re-spaced one', () => {
    expect(isTerm(vocab, 'FireRating')).toBe(true)
    for (const near of ['Fire Rating', 'firerating', 'FIRERATING', 'Fire_Rating', 'FireRating ', 'fireRating']) {
      expect([near, isTerm(vocab, near)]).toEqual([near, false])
    }
    // The ordinals that cross the port: only the second code span of four.
    expect(termsOf(vocab, '`Fire Rating`, `FireRating`, `firerating` and `Fire_Rating`.', 'assistant')).toEqual([1])
  })

  it('colours both spellings only when the files carry both — the messy model’s FireRating beside Fire_Rating', () => {
    const v = vocabularyOf(messy)
    expect([isTerm(v, 'FireRating'), isTerm(v, 'Fire_Rating'), isTerm(v, 'Fire Rating')]).toEqual([true, true, false])
  })

  it('names a property in the file’s spelling in the app’s own lines, even when Vee sent another one', async () => {
    open(mock)
    const { runTurnOnce } = await import('../../src/renderer/ai/bridge')
    // Vee wrote "Fire Rating"; the file says FireRating, and the call is matched to it.
    const t = await runTurnOnce(
      'Which walls are missing a fire rating?',
      [{ name: 'query_elements', input: { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }, { prop: 'Fire Rating', op: 'absent', val: '' }] } }],
      'Done.'
    )
    const trace = st().chatMsgs[t.index].trace!
    expect(trace.title).toBe('FireRating · missing')
    expect(JSON.stringify(trace)).not.toContain('Fire Rating')
    // …and the live diary's step is the file's spelling too, from the same facts.
    const { toolFacts } = await import('../../src/renderer/ai/trace-facts')
    const facts = toolFacts('query_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }, { prop: 'FireRating', op: 'absent', val: '' }] }, mock, (n) => isTerm(vocab, n))
    expect(facts.rules?.check).toMatchObject({ props: 'FireRating', terms: ['FireRating'] })
  })

  it('is bold — weight 600 — in the window’s style, keeping its one colour and the file’s case', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/styles/vee.css'), 'utf8')
    const at = css.indexOf('.vm .ifc-term {')
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).toMatch(/font:\s*600 11px\/1 var\(--mono\)/)
    expect(rule).toMatch(/color:\s*var\(--ifc-term\)/)
    expect(rule).toMatch(/text-transform:\s*none/)
  })
})

/* ────────────────────────────── item 4: a reply drawn twice ────────────────────────────── */

describe('a reply of Vee’s is drawn once', () => {
  const ASK = (lead: string): VeeMessage['ask'] => ({
    lead,
    question: 'Is this model for an IFC+SG submission?',
    replies: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' }
    ],
    chosen: null,
    open: true
  })

  it('drops the IFC+SG lead-in when the reply’s text already says it — marks, case and stops aside', () => {
    expect(saysAlready('These doors carry `SGPset_Door` values.', 'These doors carry SGPset_Door values')).toBe(true)
    expect(saysAlready('**12** doors. These doors carry SGPset_Door values!', 'these doors carry SGPset_Door values.')).toBe(true)
    expect(saysAlready('One thing first.', 'These doors carry SGPset_Door values.')).toBe(false)
    expect(saysAlready('Anything', '')).toBe(false)
    const lead = 'These doors carry `SGPset_Door` values.'
    expect(partsOf({ role: 'assistant', text: lead, ask: { lead } }).map((p) => p.kind)).toEqual(['text', 'ask'])
    expect(partsOf({ role: 'assistant', text: 'One thing first.', ask: { lead } }).map((p) => p.kind)).toEqual(['text', 'askLead', 'ask'])
  })

  it('renders the repeated lead-in once in the window', () => {
    const lead = 'These doors carry SGPset_Door values.'
    const html = render([vmsg({ text: lead, ask: ASK(lead) })])
    // Once in the bubbles, and once in the live region that reads the reply out.
    const live = html.indexOf('data-role="vee-announce"')
    expect(html.slice(0, live).split('These doors carry').length - 1).toBe(1)
    expect(html.slice(live).split('These doors carry').length - 1).toBe(1)
    expect(html).toContain('Is this model for an IFC+SG submission?')
  })

  it('names the ids two rows of one snapshot share — what a dev build warns about', () => {
    expect(sharedIds([{ id: 1 }, { id: 2 }, { id: 3 }])).toEqual([])
    expect(sharedIds([{ id: 1 }, { id: 2 }, { id: 1 }, { id: 2 }, { id: 2 }])).toEqual([1, 2])
  })
})

/* ────────────────────────────── item 5: New conversation ────────────────────────────── */

describe('the header’s New conversation button', () => {
  it('is in the header, labelled, with its tip, and disabled while a turn runs', () => {
    const at = (html: string): string => {
      const hd = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
      return hd.slice(hd.indexOf('data-part="new-chat"') - 30, hd.indexOf('</button>', hd.indexOf('data-part="new-chat"')))
    }
    const idle = at(render([vmsg({})]))
    expect(idle).toContain('aria-label="New conversation"')
    expect(idle).toContain('data-tip="New conversation"')
    expect(idle).toContain('class="vm-new"')
    expect(idle).not.toContain('disabled')
    expect(idle).toContain('<svg')
    expect(at(render([vmsg({})], { busy: true }))).toContain('disabled=""')
  })

  it('crosses the port as a strict intent that carries nothing', () => {
    expect(VeeIntent.safeParse({ type: 'newChat' }).success).toBe(true)
    expect(VeeIntent.safeParse({ type: 'newChat', keep: true }).success).toBe(false)
    expect(VeeIntent.safeParse({ type: 'newChat', index: 0 }).success).toBe(false)
  })

  it('starts the conversation again in the main window: transcript, request, IFC+SG answer, reply target', async () => {
    open(messy)
    const { runTurnOnce } = await import('../../src/renderer/ai/bridge')
    await runTurnOnce('Hide the walls', [{ name: 'apply_visibility', input: { action: 'hide', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }] } }], 'Hidden.')
    const stack = st().stack
    expect(stack).toHaveLength(1)
    useShell.setState({ chatIfcsg: 'yes', chatIfcsgAsked: true, chatReplyTo: 1, chatReplyPart: 0, chatSuggestOpen: true })
    const epoch = st().chatEpoch
    receive({ type: 'newChat' })
    const s = st()
    // The boot line alone, as a fresh window shows it.
    expect(s.chatMsgs).toHaveLength(1)
    expect(s.chatMsgs[0].role).toBe('assistant')
    expect(s.chatMsgs.some((m) => m.pending)).toBe(false)
    expect([s.chatIfcsg, s.chatIfcsgAsked, s.chatIfcsgHeadsUp, s.chatReplyTo, s.chatReplyPart, s.chatSuggestOpen]).toEqual([
      'unknown',
      false,
      null,
      null,
      null,
      false
    ])
    expect(s.chatEpoch).toBe(epoch + 1)
    // What the old replies did to the view stays: a revert went with its reply.
    expect(s.stack).toBe(stack)
  })

  it('leaves the transcript empty — the not-ready line — with no model open', () => {
    resetShell()
    useShell.setState({ chatMsgs: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'Open a model' }] })
    receive({ type: 'newChat' })
    expect(st().chatMsgs).toEqual([])
  })

  it('is ignored while a turn runs, and by anything that fails the schema', () => {
    open(mock)
    const msgs = [...st().chatMsgs, { role: 'user' as const, text: 'q' }]
    useShell.setState({ chatMsgs: msgs, chatBusy: true })
    receive({ type: 'newChat' })
    expect(st().chatMsgs).toBe(msgs)
    useShell.setState({ chatBusy: false })
    receive({ type: 'newChat', extra: 1 })
    expect(st().chatMsgs).toBe(msgs)
  })

  it('tells main, with the next turn only, to start its transcript afresh', async () => {
    open(mock)
    const sent: AiTurnStart[] = []
    const { installAi, sendChat, handleEvent } = await import('../../src/renderer/ai/bridge')
    ;(globalThis as { window?: unknown }).window = {
      sgvue: {
        aiTurn: async (req: AiTurnStart) => {
          sent.push(AiTurnStart.parse(req))
          queueMicrotask(() => handleEvent({ type: 'done', turnId: req.turnId, text: 'ok', rounds: 0 }))
        }
      }
    }
    void installAi
    await sendChat('one')
    await sendChat('two')
    receive({ type: 'newChat' })
    await sendChat('three')
    expect(sent.map((r) => r.fresh === true)).toEqual([sent[0].fresh === true, false, true])
  })
})

/* ────────────────────────────── 2026-11-09: the v4 / v5 diagnosis ────────────────────────────── */

describe('the IFC+SG nudge: answer and ask in one reply, once a conversation', () => {
  const L4_DOORS = { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcDoor' }, { prop: 'Level', op: '=', val: 'L4' }] }
  const nudgeOf = (r: { results: { forModel?: unknown }[] }, k = 0): string | undefined =>
    (r.results[k].forModel as { ifcsg?: string } | undefined)?.ifcsg

  it('says it on a read of elements that carry an SGPset_ set, while nothing is answered or asked', async () => {
    open(messy)
    const { runTurnOnce } = await import('../../src/renderer/ai/bridge')
    const { IFCSG_NUDGE } = await import('../../src/renderer/ai/executors')
    const t = await runTurnOnce('q', [{ name: 'query_elements', input: L4_DOORS }, { name: 'ask_choice', input: { lead: 'These doors carry SGPset_Door values.' } }, { name: 'query_elements', input: L4_DOORS }])
    expect(nudgeOf(t)).toBe(IFCSG_NUDGE)
    expect(IFCSG_NUDGE).toMatch(/answer it now in plain IFC terms and, in this same reply, call ask_choice once/)
    // Asked in this turn: the next read is quiet.
    expect(nudgeOf(t, 2)).toBeUndefined()
    // Asked in this conversation: quiet in every later turn, answered or not.
    expect(st().chatIfcsgAsked).toBe(true)
    expect(nudgeOf(await runTurnOnce('q', [{ name: 'query_elements', input: L4_DOORS }]))).toBeUndefined()
    useShell.setState({ chatIfcsgAsked: false, chatIfcsg: 'no' })
    expect(nudgeOf(await runTurnOnce('q', [{ name: 'query_elements', input: L4_DOORS }]))).toBeUndefined()
  })

  it('is never said for a view tool, nor where no loaded model carries an SGPset_ set', async () => {
    open(messy)
    const { runTurnOnce } = await import('../../src/renderer/ai/bridge')
    expect(nudgeOf(await runTurnOnce('q', [{ name: 'apply_visibility', input: { action: 'isolate', ...L4_DOORS } }]))).toBeUndefined()
    open(federate(['ARC', 'STR'].map((k) => mockModelIndex(k))))
    expect(nudgeOf(await runTurnOnce('q', [{ name: 'query_elements', input: L4_DOORS }]))).toBeUndefined()
  })
})

describe('a turn’s heads-up across its calls: the first of the highest kind', () => {
  it('keeps the earlier observation on a tie of kind, a higher kind over a lower, and nothing erases it', async () => {
    const { betterObservation } = await import('../../src/renderer/ai/heads-up')
    const tbc = { kind: 'placeholder', prop: 'FireRating', value: 'TBC', n: 6, noun: 'wall', counted: 'out', op: 'list' } as const
    const dash = { ...tbc, value: '-', n: 60 }
    const dup = { kind: 'dupGlobalId', n: 2, groups: 1, noun: 'wall' } as const
    expect(betterObservation(tbc, dash)).toBe(tbc)
    expect(betterObservation(dup, dash)).toBe(dash)
    expect(betterObservation(tbc, dup)).toBe(tbc)
    expect(betterObservation(tbc, null)).toBe(tbc)
    expect(betterObservation(null, dup)).toBe(dup)
  })

  it('on the messy walls: the "TBC" the first, narrow call found is the one the reply shows', async () => {
    open(messy)
    const { runTurnOnce } = await import('../../src/renderer/ai/bridge')
    const t = await runTurnOnce('How many walls are rated 1 HR?', [
      { name: 'list_values', input: { attr: 'FireRating', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }] } },
      { name: 'query_elements', input: { rules: [{ prop: 'FireRating', op: '=', val: '1 HR' }] } }
    ])
    expect(st().chatMsgs[t.index].headsUp).toMatchObject({ kind: 'placeholder', prop: 'FireRating', value: 'TBC' })
  })
})

describe('a fixed choice that arrives in a stray pair of quotes', () => {
  it('is read without them; a free string never is', async () => {
    const { parseToolInput } = await import('../../src/renderer/ai/executors')
    const { unquote } = await import('../../src/renderer/ai/executors/inputs')
    expect(parseToolInput('make_schedule', { base: '"open"', columns: [{ field: 'Name' }] })).toMatchObject({ base: 'open' })
    expect(parseToolInput('set_view', { view: '“top”' })).toMatchObject({ view: 'top' })
    expect(() => parseToolInput('make_schedule', { base: '"shut"' })).toThrow(/base/)
    expect([unquote("'iso'"), unquote('open'), unquote('"a" and "b"'), unquote(3)]).toEqual(['iso', 'open', '"a" and "b"', 3])
    // A rule's value is the model's text, and keeps its quotes.
    expect(parseToolInput('query_elements', { rules: [{ prop: 'Name', op: '=', val: '"Door"' }] })).toMatchObject({ rules: [{ val: '"Door"' }] })
  })
})
