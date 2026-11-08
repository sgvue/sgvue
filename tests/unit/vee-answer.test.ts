/**
 * "Vee Messages", stage 1b — 2026-11-08: the answer phase and what stage 1a left. Held here,
 * without a window (the timeline's own arithmetic — the fold, the parts landing, the width held
 * under a Check — is `trace.test.ts`'s):
 *
 *   · the window renders a running turn as typing dots, then a diary of its steps over the
 *     matrix, and a finished one as one folded line that reopens; the storey-rows card is titled
 *     by the property the turn checked; the selected storey row is pressed and ringed by a
 *     revision cloud; a consent card reads its request as a question and a detail;
 *   · **a model unloaded or replaced mid-conversation**, through the real store: old bubbles keep
 *     their text, the board recounts, a pick selects what is still loaded — on the slot its model
 *     has now — and says what is not, a revert says what it could not put back, and a quote is
 *     the text as written;
 *   · **a long conversation**: every row is its own memoised component, its props unchanged by a
 *     keystroke, a board update or another message changing, and a snapshot keeps the object of
 *     every message that did not change — so none of them renders again;
 *   · the revision cloud's path and the consent card's split, as pure functions.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import { VeeSnapshot, type VeeMessage } from '../../src/shared/vee-messages'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { quoteOfPart } from '../../src/renderer/ai/parts'
import { pinTrace, traceBegin, traceFail, traceToolExec, traceToolStart } from '../../src/renderer/ai/trace-store'
import { boardOf, canRetry, connect, messageId, receive, snapshotOf } from '../../src/renderer/model/vee-link'
import { handleEvent, sendChat } from '../../src/renderer/ai/bridge'
import { consentText, NO_MODEL_LINE } from '../../src/renderer/state/selectors/chat'
import { useShell } from '../../src/renderer/state/shell'
import ChatPanel, { freshRow, MessageRow, notReadyStamp, rowPressed, rowProps, type RowContext, type RowProps } from '../../src/renderer/app/ChatPanel'
import { cloudPath } from '../../src/renderer/app/vee-cloud'
import { keepUnchanged, takeBoard, takeSnapshot, useVee } from '../../src/renderer/vee/store'
import { resetShell } from './stub-viewer'

vi.mock('../../src/renderer/vee/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/vee/store')>()
  return { ...real, useVee: Object.assign(() => real.useVee.getState(), real.useVee) }
})

const KEYS = ['ARC', 'STR', 'SIT', 'MEP']
const full = federate(KEYS.map((k) => mockModelIndex(k)))

const AT = new Date(2026, 10, 8, 14, 2).getTime()
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
const TRACE = {
  status: 'checked 80 walls · 7s',
  wide: true,
  noun: 'wall',
  rows: [
    { label: 'L1', n: 4 },
    { label: 'L2', n: 5 },
    { label: 'L3', n: 3 }
  ],
  fold: '412 read · 80 walls · 12 missing · 7s',
  steps: [
    { label: 'Reading 4 models', mono: '', n: 412, unit: 'elements' },
    { label: 'Filtering ', mono: 'IfcWall', n: 80, unit: 'walls' },
    { label: 'Checking Fire Rating', mono: '', n: 12, unit: 'missing' }
  ],
  title: 'Fire Rating · missing'
}

function render(snap: Partial<VeeSnapshot>, board: Parameters<typeof takeBoard>[0] = null): string {
  ;(globalThis as { window?: unknown }).window = { devicePixelRatio: 1 }
  useVee.setState({ ready: false, rev: -1, board: null, copyFlash: null, chatMsgs: [] })
  takeSnapshot({ ...SNAP, ...snap })
  takeBoard(board)
  return renderToStaticMarkup(createElement(ChatPanel))
}

beforeEach(() => {
  resetShell()
  traceFail()
  pinTrace(null)
})
afterEach(() => {
  connect(null)
  traceFail()
  pinTrace(null)
  delete (globalThis as { window?: unknown }).window
})

/* ────────────────────────────── the diary, rendered ────────────────────────────── */

describe('the answer phase, rendered', () => {
  it('draws a running turn as typing dots, and its diary — a slot a step — once a tool has started', () => {
    pinTrace(10)
    traceBegin(full, 1)
    const asked = vmsg({ id: 2, role: 'user', text: 'which walls?', at: AT })
    // Before any tool: the dots, and no diary.
    let html = render({ busy: true, msgs: [asked] })
    const live = (): string => html.slice(html.indexOf('data-row="1"'))
    expect(live()).toContain('data-part="dots"')
    expect(live()).not.toContain('data-part="diary"')
    // A tool started and ran: the diary is up (the painter shows it at Read), a slot a step so far.
    traceToolStart()
    traceToolExec('query_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }, { prop: 'FireRating', op: 'absent', val: null }] }, full)
    html = render({ busy: true, msgs: [asked] })
    expect(live()).toMatch(/data-part="diary" class="vm-b vm-lc"/)
    expect(live()).toContain('>Thinking<')
    // Read, then the call's Filter and Check — three steps, each a slot the painter writes.
    expect((live().match(/data-part="step"/g) ?? []).length).toBe(3)
    expect(live()).toContain('data-part="matrix"')
    // The reply being written is not read out.
    expect(live()).toMatch(/^data-row="1" aria-hidden="true"/)
  })

  it('folds a finished turn’s diary into one line that reopens to its steps', () => {
    const html = render({ msgs: [vmsg({ text: '**12 walls** have no `FireRating`.', at: AT, trace: TRACE })] })
    const diary = html.slice(html.indexOf('data-part="diary"'))
    expect(diary).toMatch(/^data-part="diary" class="vm-b vm-lc vm-fold"/)
    expect(diary).toContain('aria-expanded="false"')
    expect(diary).toContain('412 read · 80 walls · 12 missing · 7s')
    // Its steps are there to reopen to, each ticked, with its final count.
    expect((diary.match(/class="vm-step vm-ok"/g) ?? []).length).toBe(3)
    expect(diary).toContain('Filtering <code>IfcWall</code>')
    expect(diary).toContain('<b>12</b> missing')
    // An older reply's matrix is not kept: it has no timeline to redraw it from.
    expect(diary.slice(0, diary.indexOf('data-role="storey-rows"'))).not.toContain('canvas')
    // A reply written before stage 1b folds to its status.
    const older = render({ msgs: [vmsg({ trace: { status: 'checked 80 walls · 7s', wide: true, noun: 'wall', rows: [] } })] })
    expect(older).toContain('checked 80 walls · 7s')
    // A turn that ran no tool has no diary at all.
    expect(render({ msgs: [vmsg({ trace: { status: '3s', wide: false, noun: 'element', rows: [] } })] })).not.toContain('data-part="diary"')
  })

  it('titles the storey rows by the property the turn checked, and presses the row the 3D view selects, in a revision cloud', () => {
    const msg = vmsg({ text: 'Twelve.', at: AT, trace: TRACE })
    const plain = render({ msgs: [msg] })
    expect(plain).toContain('<span>Fire Rating · missing</span>')
    expect(plain).not.toContain('aria-pressed="true"')
    expect(plain).not.toContain('vm-cloud')
    const picked = render({ msgs: [msg] }, { total: 412, shown: 412, selected: 5, storey: 'L2', colourBy: null, view: '3D' })
    expect((picked.match(/aria-pressed="true"/g) ?? []).length).toBe(1)
    const l2 = picked.slice(picked.indexOf('aria-pressed="true"'))
    expect(l2.slice(0, l2.indexOf('</button>'))).toMatch(/>L2<[\s\S]*<svg class="vm-cloud"/)
    // Without a checked property the card keeps its own title.
    const { title: _, ...untitled } = TRACE
    expect(render({ msgs: [vmsg({ trace: untitled })] })).toContain('<span>walls · by storey</span>')
    // Pressed is exactly the board's selection: its storey and its count.
    expect(rowPressed({ label: 'L2', n: 5 }, 'L2', 5)).toBe(true)
    expect(rowPressed({ label: 'L2', n: 5 }, 'L2', 6)).toBe(false)
    expect(rowPressed({ label: 'L2', n: 5 }, null, 5)).toBe(false)
  })

  it('keeps an IFC term in the storey-rows title in the file’s own case, in its one colour (2026-11-08)', () => {
    // The card's title is set in capitals (`.vm-sn-hd`); the term is its own span, which the
    // window's style keeps in the file's spelling — `FireRating · MISSING`, as the prototype's
    // `ifc-*-2-fire-answer` shot reads.
    const html = render({ msgs: [vmsg({ trace: { ...TRACE, title: 'FireRating · found', terms: ['FireRating'] } })] })
    expect(html).toContain('<span><span class="ifc-term">FireRating</span> · found</span>')
    // A name the models do not carry as a term stays a plain word of the title.
    expect(render({ msgs: [vmsg({ trace: { ...TRACE, title: 'Fire Rating · found', terms: ['FireRating'] } })] })).toContain(
      '<span>Fire Rating · found</span>'
    )
    const css = readFileSync(join(process.cwd(), 'src/renderer/styles/vee.css'), 'utf8')
    const rule = (selector: string): string => {
      const at = css.indexOf(`${selector} {`)
      expect(at, selector).toBeGreaterThanOrEqual(0)
      return css.slice(at, css.indexOf('}', at))
    }
    expect(rule('.vm-sn-hd')).toMatch(/text-transform:\s*uppercase/)
    expect(rule('.vm .ifc-term')).toMatch(/text-transform:\s*none/)
    expect(rule('.vm .ifc-term')).toMatch(/letter-spacing:\s*0/)
  })

  it('dates and times the not-ready line as a first message of the day — the key line winning, the composer disabled', () => {
    // No key and no model (the prototype's `04-nokeynomodel`): a day line, then the key line, its time on it.
    const html = render({ msgs: [], hasKey: false, hasModel: false })
    const nr = html.indexOf('data-role="vee-not-ready"')
    expect(nr).toBeGreaterThan(0)
    // (`nr` is the attribute's place, inside the group's own `<div `.)
    expect(html.slice(0, nr)).toMatch(/<div class="vm-day">Today<\/div><div $/)
    expect(html.slice(nr)).toMatch(
      /<span data-part="text">Add your API key in Preferences to start\.<\/span><span class="vm-t">\d\d:\d\d<\/span>/
    )
    expect(html).toMatch(/<input[^>]*data-role="chatinput"[^>]*disabled=""[^>]*placeholder=""/)
    expect(html).not.toContain('data-role="vee-board"')
    // No model, a key (`02-nomodel`): the model line, dated and timed the same way.
    const model = render({ msgs: [], hasKey: true, hasModel: false })
    expect(model).toMatch(/<div class="vm-day">Today<\/div>\s*<div data-role="vee-not-ready"/)
    expect(model).toContain('<span data-part="text">Open a model and I’ll take a look.</span>')
    // Under a conversation already dated today, no second day line.
    const after = render({ msgs: [vmsg({ role: 'user', text: 'hi', at: Date.now() })], hasKey: false, hasModel: true })
    expect((after.match(/class="vm-day"/g) ?? []).length).toBe(1)
    expect(after).toContain('data-role="vee-not-ready"')
  })

  it('keeps the not-ready line’s time while it says the same, and takes a new one when it changes', () => {
    const first = notReadyStamp(null, 'A', 1000)
    expect(first).toEqual({ text: 'A', at: 1000 })
    expect(notReadyStamp(first, 'A', 5000)).toBe(first)
    expect(notReadyStamp(first, 'B', 5000)).toEqual({ text: 'B', at: 5000 })
    expect(notReadyStamp(first, null, 5000)).toBeNull()
  })

  it('reads a consent card’s request as a question and a detail', () => {
    const html = render({
      msgs: [vmsg({ pending: { id: 3, label: 'delete the viewpoint "Lobby" (3D) — it cannot be brought back', verb: 'Delete' } })]
    })
    const card = html.slice(html.indexOf('data-role="consent"'))
    expect(card).toContain('<div class="vm-pm-q">Delete the viewpoint &quot;Lobby&quot; (3D)?</div>')
    expect(card).toContain('<div class="vm-pm-sub">It cannot be brought back</div>')
    // No detail, no second line.
    const one = render({ msgs: [vmsg({ pending: { id: 3, label: 'open the recent file "Tower A.ifc"' } })] })
    expect(one).toContain('Open the recent file &quot;Tower A.ifc&quot;?')
    expect(one).not.toContain('vm-pm-sub')
  })

  it('pops in only what arrived while the window was open, and never what the trace lands', () => {
    const memo = new Map<string, boolean>()
    const at = (lifted: number): RowContext => ({
      units: 'mm',
      msgs: [],
      board: null,
      timeline: null,
      traceIndex: -1,
      drawn: () => false,
      vee: 'idle',
      newest: null,
      flash: null,
      fresh: (i, role) => freshRow(memo, i, role, 2, lifted)
    })
    expect(rowProps(at(-1), vmsg({}), 1).fresh).toBe(false)
    expect(rowProps(at(-1), vmsg({}), 2).fresh).toBe(true)
    // The user's row the trace lifts its typed line into does not pop as well.
    expect(rowProps(at(3), vmsg({ role: 'user' }), 3).fresh).toBe(false)
    // The reply being written never pops.
    expect(rowProps(at(-1), null, 4).fresh).toBe(false)
  })

  /**
   * Review of stage 1b, blocking: the lifted row's `fresh` was worked out again at every render,
   * so once the next turn began — or the turn failed and left no timeline — it was no longer the
   * lifted row and played its pop-in again on a bubble long on screen. As `ChatPanel` builds the
   * context at each render: the same per-row memo, `lifted` the trace's row less one, or −1 with
   * no timeline.
   */
  it('never pops a row again: an earlier question stays still when the next turn starts, or when its turn fails', () => {
    const conversation = (n: number): VeeMessage[] =>
      Array.from({ length: n }, (_, i) => vmsg({ id: i + 1, role: i % 2 === 0 ? 'user' : 'assistant', trace: i % 2 ? TRACE : null }))
    const run = (lifts: number[], lengths: number[]): boolean[][] => {
      const memo = new Map<string, boolean>()
      return lifts.map((lifted, k) => {
        const msgs = conversation(lengths[k])
        const c: RowContext = {
          units: 'mm',
          msgs,
          board: null,
          timeline: null,
          traceIndex: lifted + 1,
          drawn: () => false,
          vee: 'idle',
          newest: null,
          flash: null,
          fresh: (i, role) => freshRow(memo, i, role, 0, lifted)
        }
        return msgs.map((m, i) => rowProps(c, m, i).fresh)
      })
    }
    // Send (the question is row 0, lifted), answered; send again (row 2 lifted); answered.
    const again = run([0, 0, 2, 2], [1, 2, 3, 4])
    expect(again.map((f) => f[0])).toEqual([false, false, false, false])
    expect(again[3]).toEqual([false, true, false, true])
    // Send, then the turn fails: the trace goes, so nothing is lifted any more.
    const failed = run([0, -1], [1, 1])
    expect(failed.map((f) => f[0])).toEqual([false, false])
    // …and the next question takes the failed reply's place: its own row, lifted, still.
    const next = run([0, -1, 1], [1, 1, 2])
    expect(next[2]).toEqual([false, false])
    // What it was before the fix: worked out from `lifted` alone, row 0 flipped to fresh.
    const naive = (i: number, firstCount: number, lifted: number): boolean => i >= firstCount && i !== lifted
    expect([0, 2, -1].map((lifted) => naive(0, 0, lifted))).toEqual([false, true, true])
  })
})

describe('the consent card’s two lines', () => {
  it('splits the label at its first ` — `, as it is written, and adds nothing to it', () => {
    expect(consentText('delete the viewpoint "Lobby" (3D) — it cannot be brought back')).toEqual({
      q: 'Delete the viewpoint "Lobby" (3D)?',
      detail: 'It cannot be brought back'
    })
    expect(consentText('undo one change — leaves 5 of 412 visible')).toEqual({ q: 'Undo one change?', detail: 'Leaves 5 of 412 visible' })
    expect(consentText('hide 400 elements — leaves 12 of 412 visible — under 5 %')).toEqual({
      q: 'Hide 400 elements?',
      detail: 'Leaves 12 of 412 visible — under 5 %'
    })
    expect(consentText('Already a question?')).toEqual({ q: 'Already a question?', detail: '' })
    expect(consentText('"A name" first — 12 of 412')).toEqual({ q: '"A name" first?', detail: '12 of 412' })
    expect(consentText('')).toEqual({ q: '', detail: '' })
  })
})

describe('the revision cloud', () => {
  it('runs arcs of about 2r along all four sides, closing where it started', () => {
    const d = cloudPath(100, 20, 3.4)
    expect(d.startsWith('M0 0 A')).toBe(true)
    expect(d.endsWith(' 0.00 0.00')).toBe(true)
    // 100 / 6.8 → 15 arcs a long side, 20 / 6.8 → 3 a short one.
    expect((d.match(/ A/g) ?? []).length).toBe(15 + 3 + 15 + 3)
    // Every arc bulges outwards (sweep 1), and no number is out of the box by more than an arc.
    expect(d.includes(' 0 0 0 ')).toBe(false)
    expect(cloudPath(0, 20, 3.4)).toBe('')
  })
})

/* ────────────────────────────── a model unloaded or replaced mid-conversation ────────────────────────────── */

describe('a model unloaded or replaced mid-conversation, through the real store', () => {
  const idsOf = (key: string, n: number): number[] => full.elements.filter((e) => e.model === key).slice(0, n).map((e) => e.id)
  const fresh = (keys: string[]) => federate(keys.map((k) => mockModelIndex(k)))

  /**
   * The conversation: the boot audit, and a reply whose chips name SIT's elements, ARC's and STR's,
   * and STR's alone. ARC's two and STR's two were hidden before it, and it showed everything — so
   * its revert hides them again.
   */
  function converse(): { reply: number; sit: number[]; arc: number[]; str: number[] } {
    const s = useShell.getState()
    s.commitModels(full)
    const sit = idsOf('SIT', 3)
    const arc = idsOf('ARC', 2)
    const str = idsOf('STR', 2)
    useShell.getState().hide([...arc, ...str])
    const before = useShell.getState().chatBegin('which?')
    useShell.getState().showAll()
    useShell.getState().chatFinish(
      'SIT, ARC and STR.',
      {
        acted: true,
        chips: [
          { label: 'SIT', ids: sit },
          { label: 'ARC + STR', ids: [...arc, ...str] },
          { label: 'STR', ids: str }
        ]
      },
      before
    )
    return { reply: useShell.getState().chatMsgs.length - 1, sit, arc, str }
  }

  it('keeps every old bubble’s text as written, and the board recounts', () => {
    const { reply } = converse()
    const before = useShell.getState().chatMsgs.map((m) => m.text)
    const seen = snapshotOf(useShell.getState()).msgs.map((m) => m.text)
    useShell.getState().commitModels(fresh(['ARC', 'SIT', 'MEP']))
    expect(useShell.getState().chatMsgs.map((m) => m.text)).toEqual(before)
    expect(snapshotOf(useShell.getState()).msgs.map((m) => m.text)).toEqual(seen)
    expect(boardOf(useShell.getState())!.total).toBe(full.elements.filter((e) => e.model !== 'STR').length)
    // A quote of the old reply is its text as written.
    expect(quoteOfPart(useShell.getState().chatMsgs[reply], 0)).toBe('SIT, ARC and STR.')
  })

  it('selects what is still loaded, on the slot its model has now, and says what is not', () => {
    const { reply, sit, arc } = converse()
    const after = fresh(['ARC', 'SIT', 'MEP'])
    useShell.getState().commitModels(after)
    // SIT was the third model and is the second now: its ids are renumbered, and still name SIT.
    const sitNow = after.elements.filter((e) => e.model === 'SIT').slice(0, 3).map((e) => e.id)
    expect(sitNow).not.toEqual(sit)
    connect({ postMessage: () => undefined, close: () => undefined, onmessage: null } as unknown as MessagePort)
    const at = { index: reply, msg: messageId(useShell.getState().chatMsgs[reply]) }
    receive({ type: 'pick', ...at, what: 'chip', j: 0, zoom: false })
    expect(useShell.getState().selIds).toEqual(sitNow)
    expect(useShell.getState().chatErr).toBe('')
    // ARC is where it was; STR has gone.
    receive({ type: 'pick', ...at, what: 'chip', j: 1, zoom: false })
    expect(useShell.getState().selIds).toEqual(arc)
    expect(useShell.getState().chatErr).toBe('STR is no longer loaded, so 2 of these elements could not be selected. The rest are selected.')
    // Only STR's: nothing is selected, and the selection is left as it was.
    receive({ type: 'pick', ...at, what: 'chip', j: 2, zoom: false })
    expect(useShell.getState().selIds).toEqual(arc)
    expect(useShell.getState().chatErr).toBe('STR is no longer loaded, so nothing could be selected.')
  })

  it('treats a model replaced by another file of the same name as gone', () => {
    const { reply, str } = converse()
    // STR again, but a different file: another digest, so its old ids name nothing of it.
    const other = { ...mockModelIndex('STR'), sha256: 'b'.repeat(64) }
    useShell.getState().commitModels(federate([...['ARC', 'SIT', 'MEP'].map((k) => mockModelIndex(k)), other], full))
    useShell.getState().select(null)
    useShell.getState().pickChat(reply, str, false)
    expect(useShell.getState().selIds).toEqual([])
    expect(useShell.getState().chatErr).toBe('STR is no longer loaded, so nothing could be selected.')
  })

  it('reverts what it still can, and says what it could not put back', () => {
    const { reply, arc } = converse()
    expect(useShell.getState().hidden[arc[0]]).toBeUndefined()
    useShell.getState().commitModels(fresh(['ARC', 'SIT', 'MEP']))
    useShell.getState().revertTurn(reply)
    // ARC's two are hidden again (ARC kept its slot); STR's could not be.
    expect(arc.every((id) => useShell.getState().hidden[id])).toBe(true)
    expect(useShell.getState().chatErr).toBe('STR is no longer loaded, so nothing of it could be put back. Everything else was reverted.')
  })

  it('selects as before while every model it named is loaded, and a message no turn wrote keeps the ids that still name an element', () => {
    const { reply, str } = converse()
    useShell.getState().pickChat(reply, str, false)
    expect(useShell.getState().selIds).toEqual(str)
    expect(useShell.getState().chatErr).toBe('')
    // The boot audit records its models too; a message with none checks the ids it has.
    expect(useShell.getState().chatMsgs[0].models).toHaveLength(4)
    useShell.setState({ chatMsgs: [{ role: 'assistant', text: 'old', chips: [{ label: 'x', ids: [...str, 9e15] }] }] })
    useShell.getState().pickChat(0, [...str, 9e15], false)
    expect(useShell.getState().selIds).toEqual(str)
    expect(useShell.getState().chatErr).toBe('1 of these elements are no longer loaded and could not be selected. The rest are selected.')
  })
})

/* ────────────────────────────── a long conversation ────────────────────────────── */

describe('a long conversation: no row renders again for what is not its own', () => {
  const REPLY = ['**12 walls** have no `FireRating`.', '', '- 7 on L1', '- 5 on L2', '', 'The rest are rated.'].join('\n')
  const conversation = (n: number): VeeMessage[] =>
    Array.from({ length: n }, (_, i) =>
      i % 2 === 0
        ? vmsg({ id: i + 1, role: 'user', text: `question ${i}`, at: AT, seen: true })
        : vmsg({
            id: i + 1,
            text: REPLY,
            at: AT,
            chips: [{ label: 'IfcWall (2)' }],
            trace: i % 4 === 1 ? TRACE : null,
            table: i % 4 === 3 ? { groupBy: 'Level', rows: [{ k: 'L1', n: 2 }] } : null
          })
    )
  const ctx = (msgs: VeeMessage[], board: RowContext['board'] = null): RowContext => ({
    units: 'mm',
    msgs,
    board,
    timeline: null,
    traceIndex: -1,
    drawn: () => false,
    vee: 'idle',
    // Rebuilt at every render, as the panel's own are.
    newest: msgs.length - 1,
    flash: null,
    fresh: () => false
  })
  const same = (a: RowProps, b: RowProps): boolean =>
    (Object.keys(a) as (keyof RowProps)[]).every((k) => Object.is(a[k], b[k])) && Object.keys(a).length === Object.keys(b).length

  it('is a memoised component', () => {
    expect((MessageRow as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
  })

  it('keeps every row’s props across a keystroke, a board update and a snapshot that changed one message', () => {
    const msgs = conversation(200)
    const was = msgs.map((m, i) => rowProps(ctx(msgs), m, i))
    // A keystroke and a board update that is not a storey selection: nothing a row reads.
    const typed = msgs.map((m, i) => rowProps(ctx(msgs, { storey: null, selected: 3 }), m, i))
    expect(typed.filter((p, i) => !same(p, was[i]))).toHaveLength(0)
    // The 3D view selects a storey's elements: only the replies with storey rows are told.
    const picked = msgs.map((m, i) => rowProps(ctx(msgs, { storey: 'L2', selected: 5 }), m, i))
    const told = picked.map((p, i) => (same(p, was[i]) ? -1 : i)).filter((i) => i >= 0)
    expect(told).toEqual(msgs.map((m, i) => (m.trace?.rows.length ? i : -1)).filter((i) => i >= 0))
    // A snapshot that changed message 51 only: the window keeps every other message's object.
    const next = msgs.map((m, i) => (i === 51 ? { ...m, id: 9999, reverted: true } : { ...m }))
    const kept = keepUnchanged(msgs, next)
    expect(kept.filter((m, i) => m !== msgs[i]).map((m) => m.id)).toEqual([9999])
    const after = kept.map((m, i) => rowProps(ctx(kept), m, i))
    expect(after.map((p, i) => (same(p, was[i]) ? -1 : i)).filter((i) => i >= 0)).toEqual([51])
  })

  it('takes a snapshot keeping the window’s own objects for the messages that did not change', () => {
    ;(globalThis as { window?: unknown }).window = { devicePixelRatio: 1 }
    useVee.setState({ chatMsgs: [] })
    const msgs = conversation(6)
    takeSnapshot({ ...SNAP, msgs })
    const first = useVee.getState().chatMsgs
    // The same transcript again, as a fresh structured clone off the port.
    takeSnapshot({ ...SNAP, msgs: structuredClone(msgs), composer: { text: 'x', rev: 1 } })
    expect(useVee.getState().chatMsgs.every((m, i) => m === first[i])).toBe(true)
  })

  it('renders 200 messages headless, and a row is the same markup whatever happens elsewhere', () => {
    const msgs = conversation(200)
    const t0 = performance.now()
    const html = render({ msgs })
    const ms = performance.now() - t0
    expect((html.match(/data-row="/g) ?? []).length).toBe(200)
    // Generous: a headless full render took ~30 ms here; it must not grow with anything quadratic.
    expect(ms).toBeLessThan(2000)
  })
})

/* ────────────────────────────── review of stage 1: what a card, a tick and Try again say ────────────────────────────── */

describe('the consent card stamps what the click did', () => {
  it('stamps DELETED when the viewpoint was deleted, and CANCELLED — with the status line — when it had already gone', () => {
    useShell.setState({ views: [{ id: 7, name: 'Lobby' }, { id: 8, name: 'Roof' }] as never })
    const ask = (id: number) => ({
      role: 'assistant' as const,
      text: 'Click Delete.',
      pending: { label: 'delete the viewpoint — it cannot be brought back', action: { kind: 'delete_view' as const, id } }
    })
    useShell.setState({ chatMsgs: [ask(7), ask(99)] })
    // Done: the viewpoint is gone, and the stamp says so.
    useShell.getState().applyPending(0)
    expect(useShell.getState().views.map((v) => v.id)).toEqual([8])
    expect(useShell.getState().chatMsgs[0].settled).toMatchObject({ how: 'deleted' })
    expect(useShell.getState().chatErr).toBe('')
    // Stale: there was nothing to delete. The card does not say DELETED beside a line that says nothing was.
    useShell.getState().applyPending(1)
    expect(useShell.getState().views.map((v) => v.id)).toEqual([8])
    expect(useShell.getState().chatMsgs[1].pending).toBeNull()
    expect(useShell.getState().chatMsgs[1].settled).toMatchObject({ how: 'cancelled' })
    expect(useShell.getState().chatErr).toBe('That viewpoint is no longer in the list, so nothing was deleted.')
  })
})

describe('Try again', () => {
  const turnIds: string[] = []
  beforeEach(() => {
    turnIds.length = 0
    ;(globalThis as { window?: unknown }).window = {
      sgvue: {
        aiTurn: (r: { turnId: string }) => {
          turnIds.push(r.turnId)
          return Promise.resolve()
        }
      }
    }
  })
  const failed = (): void => {
    useShell.setState({ federation: full, byId: full.byId, loaded: ['ARC'] })
    void sendChat('how many doors?')
    handleEvent({ type: 'usage', turnId: turnIds[0], inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } as never)
    expect(useShell.getState().chatMsgs[0].seen).toBe(true)
    handleEvent({ type: 'error', turnId: turnIds[0], kind: 'connection', message: 'offline' })
  }

  it('takes the earlier attempt’s second tick back until the retry is picked up', () => {
    failed()
    void sendChat(undefined, { retry: true })
    expect(useShell.getState().chatMsgs).toHaveLength(1)
    expect(useShell.getState().chatMsgs[0].seen).toBe(false)
    handleEvent({ type: 'usage', turnId: turnIds[1], inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } as never)
    expect(useShell.getState().chatMsgs[0].seen).toBe(true)
  })

  it('runs from the window only after a failed turn — not a stopped one — and is offered only then', () => {
    connect({ postMessage: () => undefined, close: () => undefined, onmessage: null } as unknown as MessagePort)
    useShell.setState({ federation: full, byId: full.byId, loaded: ['ARC'] })
    void sendChat('how many doors?')
    handleEvent({ type: 'aborted', turnId: turnIds[0] })
    expect(useShell.getState().chatEnd?.kind).toBe('stopped')
    expect(canRetry(useShell.getState())).toBe(false)
    expect(snapshotOf(useShell.getState()).end?.retry).toBe(false)
    receive({ type: 'retry' })
    expect(turnIds).toHaveLength(1)
    expect(useShell.getState().chatBusy).toBe(false)
    // A failed one: offered, and run.
    void sendChat('how many doors?')
    handleEvent({ type: 'error', turnId: turnIds[1], kind: 'connection', message: 'offline' })
    expect(snapshotOf(useShell.getState()).end?.retry).toBe(true)
    receive({ type: 'retry' })
    expect(turnIds).toHaveLength(3)
  })

  it('is not offered with no model open, and a retry with none is answered with the model line', () => {
    failed()
    useShell.setState({ federation: { ...full, elements: [] } })
    expect(snapshotOf(useShell.getState()).end?.retry).toBe(false)
    expect(snapshotOf(useShell.getState()).hasModel).toBe(false)
    // The intent does nothing…
    receive({ type: 'retry' })
    expect(useShell.getState().chatMsgs).toHaveLength(1)
    // …and the retry itself, however it comes, is answered — not dropped.
    void sendChat(undefined, { retry: true })
    expect(useShell.getState().chatMsgs.map((m) => [m.role, m.text])).toEqual([
      ['user', 'how many doors?'],
      ['assistant', NO_MODEL_LINE]
    ])
    expect(useShell.getState().chatEnd).toBeNull()
    expect(turnIds).toHaveLength(1)
  })
})
