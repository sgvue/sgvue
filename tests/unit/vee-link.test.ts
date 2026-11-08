/**
 * The Ask Vee window's port — 2026-11-07. The owner: *"Also bring vee out as a separate window
 * and always on top of our app window."* The chat panel is a window of its own; the conversation
 * stays in the main window, which sends the panel a snapshot and the trace, and does what the
 * panel's intents say.
 *
 * Held here, without a window:
 *   · what crosses is what `shared/vee-messages.ts` admits — the intents are a closed set of
 *     strict shapes, and the snapshot is bounded and carries no element id;
 *   · **consent stays the user's click**: `apply` applies only the request the row showed, on the
 *     message it showed it on — a stale one, a forged id, a transcript replaced since, does nothing;
 *   · a copy the click asked for is made in the Vee window (`copy` / `copied`), and a refusal there
 *     is the store's own `CLIPBOARD_REFUSED`;
 *   · the trace crosses on the wall clock without its ids, and the mirror folds it into the same
 *     timeline;
 *   · `chatOpen` follows the window, and the composer's counter moves only for the main window's
 *     own changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import {
  ToVee,
  VeeIntent,
  VeeSnapshot,
  VEE_MAX_INPUT,
  VEE_MAX_MSGS
} from '../../src/shared/vee-messages'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import {
  onTraceChange,
  shiftChange,
  traceBegin,
  traceDone,
  traceEpoch,
  traceFail,
  traceMirror,
  traceSnapshot,
  traceState,
  traceToolExec,
  type TraceChange
} from '../../src/renderer/ai/trace-store'
import { connect, messageId, pendingId, receive, snapshotOf } from '../../src/renderer/model/vee-link'
import { CLIPBOARD_REFUSED, useShell, type ChatMessage } from '../../src/renderer/state/shell'
import { resetShell } from './stub-viewer'

/** A port that records what it is sent. */
function fakePort(): { port: MessagePort; sent: unknown[]; closed: boolean } {
  const rec = { sent: [] as unknown[], closed: false, port: null as unknown as MessagePort }
  rec.port = {
    postMessage: (m: unknown) => void rec.sent.push(m),
    close: () => void (rec.closed = true),
    onmessage: null
  } as unknown as MessagePort
  return rec
}

/** The end of this task's microtasks: the link posts once per task. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const updates = (sent: unknown[]) =>
  sent.map((m) => ToVee.parse(m)).filter((m): m is Extract<ToVee, { type: 'update' }> => m.type === 'update')
const lastSnap = (sent: unknown[]): VeeSnapshot => {
  const withSnap = updates(sent).filter((u) => u.snap)
  return withSnap[withSnap.length - 1].snap!
}

const GUIDS: ChatMessage = {
  role: 'assistant',
  text: 'Click Apply to copy them.',
  chips: [{ label: 'IfcWall (2)', ids: [11, 12] }],
  table: { groupBy: 'Level', rows: [{ k: 'L1', n: 2, area: 3.5, ids: [11, 12] }] },
  pending: { label: 'copy 2 GlobalIds to the clipboard', action: { kind: 'copy_guids', text: 'G1\nG2' } },
  trace: { status: '2s', wide: true, noun: 'wall', rows: [{ label: 'L1', n: 2, ids: [11, 12] }] }
}

beforeEach(() => {
  resetShell()
  traceFail()
})

afterEach(() => {
  connect(null)
  vi.unstubAllGlobals()
})

describe('the intents: a closed set of strict shapes', () => {
  it('takes each intent the panel sends', () => {
    for (const i of [
      { type: 'send', text: 'how many walls?' },
      { type: 'stop' },
      { type: 'input', text: 'how m' },
      { type: 'apply', index: 1, msg: 4, pending: 5 },
      { type: 'cancel', index: 1, msg: 4, pending: 5 },
      { type: 'revert', index: 1, msg: 4 },
      { type: 'reply', index: 0, msg: 3 },
      { type: 'unreply' },
      { type: 'suggest', text: 'Show only doors' },
      { type: 'suggestOpen', open: true },
      { type: 'pick', index: 1, msg: 4, what: 'chip', j: 0, zoom: false },
      { type: 'copyCsv', index: 1, msg: 4 },
      { type: 'copied', n: 1, ok: true },
      { type: 'close' }
    ]) {
      expect([i.type, VeeIntent.safeParse(i).success]).toEqual([i.type, true])
    }
  })

  it('refuses an unknown kind, an unknown key, a wrong type and an unbounded text', () => {
    for (const bad of [
      { type: 'applyAll' },
      { type: 'apply', index: 1, msg: 4 },
      { type: 'apply', index: 1, msg: 4, pending: 5, action: { kind: 'copy_link' } },
      { type: 'close', force: true },
      { type: 'pick', index: 1, msg: 4, what: 'chip', j: 0, zoom: false, ids: [1, 2, 3] },
      { type: 'pick', index: 1, msg: 4, what: 'everything', j: 0, zoom: false },
      { type: 'revert', index: -1, msg: 4 },
      { type: 'revert', index: 1.5, msg: 4 },
      { type: 'send', text: 'x'.repeat(VEE_MAX_INPUT + 1) },
      'close',
      null
    ]) {
      expect([bad, VeeIntent.safeParse(bad).success]).toEqual([bad, false])
    }
  })

  it('ignores what fails the schema: nothing in the store moves', () => {
    useShell.setState({ chatMsgs: [GUIDS], chatOpen: true })
    const before = useShell.getState()
    receive({ type: 'apply', index: 0, msg: messageId(GUIDS) })
    receive({ type: 'close', now: true })
    receive({ type: 'setState', patch: { hidden: { 1: true } } })
    expect(useShell.getState()).toBe(before)
  })
})

describe('the snapshot', () => {
  it('is what the schema admits, and carries no element id and no request', () => {
    useShell.setState({ chatMsgs: [{ role: 'user', text: 'copy the guids' }, GUIDS] })
    const snap = snapshotOf(useShell.getState())
    expect(VeeSnapshot.safeParse(snap).success).toBe(true)
    const json = JSON.stringify(snap)
    expect(json).not.toMatch(/"ids"/)
    expect(json).not.toContain('G1')
    expect(json).not.toMatch(/"action"|"patch"|"undoSnap"/)
    expect(snap.msgs[1].pending).toEqual({ verb: 'Apply', id: pendingId(GUIDS.pending!), label: GUIDS.pending!.label })
    expect(snap.msgs[1].id).toBe(messageId(GUIDS))
  })

  it('is bounded: a transcript, a label or a text past its cap is refused whole', () => {
    const snap = snapshotOf(useShell.getState())
    const msg = snapshotOf({ ...useShell.getState(), chatMsgs: [GUIDS] }).msgs[0]
    expect(VeeSnapshot.safeParse({ ...snap, msgs: Array(VEE_MAX_MSGS + 1).fill(msg) }).success).toBe(false)
    expect(VeeSnapshot.safeParse({ ...snap, msgs: [{ ...msg, chips: Array(7).fill({ label: 'x' }) }] }).success).toBe(false)
    expect(VeeSnapshot.safeParse({ ...snap, msgs: [{ ...msg, chips: [{ label: 'x', ids: [1] }] }] }).success).toBe(false)
    expect(VeeSnapshot.safeParse({ ...snap, err: 'x'.repeat(5000) }).success).toBe(false)
    expect(VeeSnapshot.safeParse({ ...snap, suggestions: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false)
    expect(VeeSnapshot.safeParse({ ...snap, theme: 'sepia' }).success).toBe(false)
    expect(VeeSnapshot.safeParse({ ...snap, extra: 1 }).success).toBe(false)
  })

  it('is sent on connect, and again — once — after the chat changes', async () => {
    const rec = fakePort()
    useShell.setState({ chatMsgs: [GUIDS] })
    connect(rec.port)
    expect(updates(rec.sent)).toHaveLength(1)
    expect(lastSnap(rec.sent).msgs).toHaveLength(1)
    useShell.setState({ chatErr: 'one' })
    useShell.setState({ chatErr: 'two' })
    await tick()
    expect(updates(rec.sent)).toHaveLength(2)
    expect(lastSnap(rec.sent).err).toBe('two')
  })
})

describe('consent: Apply applies only the request the user saw', () => {
  const ready = (): { rec: ReturnType<typeof fakePort>; msg: ChatMessage } => {
    useShell.setState({ chatMsgs: [{ role: 'user', text: 'copy' }, { ...GUIDS }] })
    const rec = fakePort()
    connect(rec.port)
    return { rec, msg: useShell.getState().chatMsgs[1] }
  }
  const copies = (sent: unknown[]) =>
    sent.map((m) => ToVee.parse(m)).filter((m): m is Extract<ToVee, { type: 'copy' }> => m.type === 'copy')

  it('does nothing for another request, another message, or a transcript replaced since', () => {
    const { rec, msg } = ready()
    receive({ type: 'apply', index: 1, msg: messageId(msg), pending: pendingId(msg.pending!) + 1 })
    receive({ type: 'apply', index: 1, msg: messageId(msg) + 1, pending: pendingId(msg.pending!) })
    receive({ type: 'apply', index: 0, msg: messageId(msg), pending: pendingId(msg.pending!) })
    receive({ type: 'cancel', index: 1, msg: messageId(msg), pending: pendingId(msg.pending!) + 1 })
    expect(useShell.getState().chatMsgs[1].pending).toBe(msg.pending)
    // The same words in a new message object — a new transcript — is not the row the user saw.
    useShell.setState({ chatMsgs: [{ role: 'user', text: 'copy' }, { ...GUIDS, pending: { ...GUIDS.pending! } }] })
    receive({ type: 'apply', index: 1, msg: messageId(msg), pending: pendingId(msg.pending!) })
    expect(useShell.getState().chatMsgs[1].pending).not.toBeNull()
    expect(copies(rec.sent)).toEqual([])
  })

  it('applies the request once, and the copy is made in the Vee window', async () => {
    const { rec, msg } = ready()
    const apply = { type: 'apply', index: 1, msg: messageId(msg), pending: pendingId(msg.pending!) }
    receive(apply)
    expect(useShell.getState().chatMsgs[1].pending).toBeNull()
    const asked = copies(rec.sent)
    expect(asked.map((c) => c.text)).toEqual(['G1\nG2'])
    // A second click — or a replayed intent — finds nothing waiting.
    receive(apply)
    expect(copies(rec.sent)).toHaveLength(1)
    // The Vee window copied it: the property card's own flash.
    receive({ type: 'copied', n: asked[0].n, ok: true })
    await tick()
    expect(useShell.getState().copied).toBe(true)
    expect(useShell.getState().chatErr).toBe('')
  })

  it('says so when the Vee window could not copy', async () => {
    const { rec, msg } = ready()
    receive({ type: 'apply', index: 1, msg: messageId(msg), pending: pendingId(msg.pending!) })
    receive({ type: 'copied', n: copies(rec.sent)[0].n, ok: false })
    await tick()
    expect(useShell.getState().chatErr).toBe(CLIPBOARD_REFUSED)
  })

  it('cancel drops exactly that request', () => {
    const { msg } = ready()
    receive({ type: 'cancel', index: 1, msg: messageId(msg), pending: pendingId(msg.pending!) })
    expect(useShell.getState().chatMsgs[1].pending).toBeNull()
  })
})

describe('the other intents do what the panel’s controls did', () => {
  it('copy csv: the store builds the CSV, the Vee window copies it', async () => {
    useShell.setState({ chatMsgs: [GUIDS] })
    const rec = fakePort()
    connect(rec.port)
    receive({ type: 'copyCsv', index: 0, msg: messageId(GUIDS) })
    const copy = rec.sent.map((m) => ToVee.parse(m)).find((m) => m.type === 'copy') as Extract<ToVee, { type: 'copy' }>
    expect(copy.text).toBe('Level,count,quantity\n"L1",2,3.50')
    receive({ type: 'copied', n: copy.n, ok: false })
    await tick()
    expect(useShell.getState().chatErr).toBe(CLIPBOARD_REFUSED)
  })

  it('a chip, a table row and an answer row select their own elements — by place, from the main window’s message', () => {
    // Elements 11 and 12 are loaded (since stage 1b a pick selects only what still is).
    const byId = new Map([11, 12].map((id) => [id, { id }])) as unknown as ReturnType<typeof useShell.getState>['byId']
    useShell.setState({ chatMsgs: [GUIDS], byId })
    connect(fakePort().port)
    const at = { index: 0, msg: messageId(GUIDS) }
    receive({ type: 'pick', ...at, what: 'chip', j: 0, zoom: false })
    expect(useShell.getState().selIds).toEqual([11, 12])
    useShell.getState().select(null)
    receive({ type: 'pick', ...at, what: 'table', j: 0, zoom: true })
    expect(useShell.getState().selIds).toEqual([11, 12])
    useShell.getState().select(null)
    receive({ type: 'pick', ...at, what: 'row', j: 0, zoom: false })
    expect(useShell.getState().selIds).toEqual([11, 12])
    useShell.getState().select(null)
    // A place the message does not have selects nothing.
    receive({ type: 'pick', ...at, what: 'chip', j: 3, zoom: false })
    receive({ type: 'pick', index: 0, msg: at.msg + 1, what: 'chip', j: 0, zoom: false })
    expect(useShell.getState().selIds).toEqual([])
  })

  it('reply, unreply, suggestions and close', () => {
    useShell.setState({ chatMsgs: [GUIDS], chatOpen: true })
    connect(fakePort().port)
    receive({ type: 'reply', index: 0, msg: messageId(GUIDS) })
    expect(useShell.getState().chatReplyTo).toBe(0)
    receive({ type: 'unreply' })
    expect(useShell.getState().chatReplyTo).toBeNull()
    receive({ type: 'suggestOpen', open: true })
    expect(useShell.getState().chatSuggestOpen).toBe(true)
    receive({ type: 'suggest', text: 'Show only doors' })
    expect(useShell.getState().chatInput).toBe('Show only doors')
    expect(useShell.getState().chatSuggestOpen).toBe(false)
    receive({ type: 'close' })
    expect(useShell.getState().chatOpen).toBe(false)
  })
})

describe('the window and the panel are one state', () => {
  it('a window that joins is an open panel; one that goes is a closed one', () => {
    connect(fakePort().port)
    expect(useShell.getState().chatOpen).toBe(true)
    connect(null)
    expect(useShell.getState().chatOpen).toBe(false)
  })

  it('opens and closes the window as the panel opens and closes', async () => {
    const openVee = vi.fn(async () => undefined)
    const closeVee = vi.fn(async () => undefined)
    vi.stubGlobal('window', { addEventListener: () => undefined, sgvue: { openVee, closeVee } })
    const { installVeeLink } = await import('../../src/renderer/model/vee-link')
    installVeeLink()
    useShell.setState({ theme: 'light' })
    useShell.getState().setChatOpen(true)
    expect(openVee).toHaveBeenCalledTimes(1)
    // In the main window's theme, so the new window's first paint is already in it.
    expect(openVee).toHaveBeenCalledWith('light')
    useShell.getState().setChatOpen(false)
    expect(closeVee).toHaveBeenCalledTimes(1)
  })

  it('the composer’s counter moves for the main window’s own changes only, and "Ask about this" focuses it', async () => {
    useShell.setState({ chatOpen: true })
    const rec = fakePort()
    connect(rec.port)
    const rev0 = lastSnap(rec.sent).composer.rev
    rec.sent.length = 0
    receive({ type: 'input', text: 'how many' })
    await tick()
    // The Vee window's own keystroke is not echoed back: no snapshot per key.
    expect(useShell.getState().chatInput).toBe('how many')
    expect(updates(rec.sent)).toEqual([])
    // Any other change is still sent, and carries the typed text, the counter unmoved.
    receive({ type: 'input', text: 'how many walls' })
    useShell.setState({ chatErr: 'x' })
    await tick()
    expect(updates(rec.sent)).toHaveLength(1)
    expect(lastSnap(rec.sent).composer).toEqual({ text: 'how many walls', rev: rev0 })
    // The main window fills it itself (the context menu's "Ask about this").
    useShell.getState().setChatInput('About Wall L1-1 (IfcWall)')
    await tick()
    expect(lastSnap(rec.sent).composer).toEqual({ text: 'About Wall L1-1 (IfcWall)', rev: rev0 + 1 })
    expect(rec.sent.map((m) => ToVee.parse(m)).some((m) => m.type === 'focus')).toBe(true)
  })
})

describe('the trace crosses to the Vee window', () => {
  const fed = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
  const walls = { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }] }

  it('on the main window’s clock with where it starts, without element ids, batched with the snapshot', async () => {
    const rec = fakePort()
    connect(rec.port)
    rec.sent.length = 0
    useShell.setState({ chatMsgs: [{ role: 'user', text: 'walls?' }], chatBusy: true })
    traceBegin(fed, 1)
    traceToolExec('apply_visibility', walls, fed)
    await tick()
    const [u] = updates(rec.sent)
    // One post for the task: the snapshot and both trace changes, in order.
    expect(updates(rec.sent)).toHaveLength(1)
    expect(u.snap?.busy).toBe(true)
    expect(u.trace.map((c) => (c.kind === 'event' ? c.ev.type : c.kind))).toEqual(['begin', 'tool_exec'])
    const begin = u.trace[0] as Extract<TraceChange, { kind: 'event' }>
    expect(begin.index).toBe(1)
    expect((begin.ev as { at: number }).at).toBe(traceState().timeline!.send)
    expect(u.origin).toBe(traceEpoch())
    const exec = u.trace[1] as Extract<TraceChange, { kind: 'event' }>
    const rows = (exec.ev as { facts: { rules: { rows: { ids: number[]; n: number }[] } } }).facts.rules.rows
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.ids).toEqual([])
  })

  it('folded through the mirror, it is the same timeline', () => {
    const seen: TraceChange[] = []
    const off = onTraceChange((c) => seen.push(c))
    traceBegin(fed, 3)
    traceToolExec('apply_visibility', walls, fed)
    traceDone('**80** walls.', false)
    off()
    const here = traceState()
    // The Vee window starts with nothing, and takes each change as it arrives.
    traceMirror({ kind: 'sync', timeline: null, index: -1, pinned: null })
    for (const c of seen) traceMirror(c)
    expect(traceState().index).toBe(3)
    expect(traceState().timeline).toEqual(here.timeline)
    // …and a window that joins late takes the whole state at once.
    const late = traceSnapshot()
    traceMirror({ kind: 'sync', timeline: null, index: -1, pinned: null })
    traceMirror(late)
    expect(traceState().timeline).toEqual(here.timeline)
    // On a clock that started 2.5 s later, every time is 2.5 s less — and the gaps are exact.
    const moved = shiftChange(late, -2.5) as Extract<TraceChange, { kind: 'sync' }>
    expect(moved.timeline!.send).toBeCloseTo(here.timeline!.send - 2.5, 9)
    expect(moved.timeline!.answer! - moved.timeline!.send).toBeCloseTo(here.timeline!.answer! - here.timeline!.send, 9)
    expect(moved.timeline!.calls[0].at).toBeCloseTo(here.timeline!.calls[0].at - 2.5, 9)
  })
})
