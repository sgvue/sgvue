/**
 * The Ask Vee window's own end — 2026-11-07 (`renderer/vee/link.ts`, `renderer/vee/store.ts`).
 * It draws what the main window sends and sends back what the user did:
 *   · it takes only what `ToVee` admits, and ignores the rest;
 *   · the composer is typed here: a snapshot's text is taken only when the main window's own
 *     counter has moved, so one a keystroke behind never takes back what was typed;
 *   · a `copy` is made here, under this page's click, and answered `copied`.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { traceState } from '../../src/renderer/ai/trace-store'
import { connect, escClosesVee, receive, themeFromHash } from '../../src/renderer/vee/link'
import { useVee } from '../../src/renderer/vee/store'
import type { VeeSnapshot } from '../../src/shared/vee-messages'

const SNAP: VeeSnapshot = {
  theme: 'dark',
  units: 'mm',
  busy: false,
  err: '',
  replyTo: null,
  suggestOpen: false,
  suggestions: ['Show only doors'],
  composer: { text: '', rev: 0 },
  msgs: [
    {
      id: 7,
      role: 'assistant',
      text: 'Loaded 4 models.',
      quote: null,
      chips: [{ label: 'IfcWall (80)' }],
      table: null,
      pending: null,
      canRevert: false,
      reverted: false,
      trace: null
    }
  ]
}

const update = (snap: Partial<VeeSnapshot> = {}) => ({ type: 'update', origin: 0, snap: { ...SNAP, ...snap }, trace: [] })

function fakePort(): { port: MessagePort; sent: unknown[] } {
  const sent: unknown[] = []
  const port = { postMessage: (m: unknown) => void sent.push(m), close: () => undefined, onmessage: null }
  return { port: port as unknown as MessagePort, sent }
}

beforeEach(() => {
  useVee.setState({ ready: false, chatMsgs: [], chatInput: '', rev: -1 })
})

describe('what the Vee window takes', () => {
  it('a snapshot, under the names the panel reads', () => {
    receive(update())
    const v = useVee.getState()
    expect(v.ready).toBe(true)
    expect(v.chatMsgs).toEqual(SNAP.msgs)
    expect(v.suggestions).toEqual(['Show only doors'])
  })

  it('nothing that fails the schema', () => {
    receive({ type: 'update', origin: 0, snap: { ...SNAP, msgs: [{ ...SNAP.msgs[0], chips: [{ label: 'x', ids: [1] }] }] }, trace: [] })
    receive({ type: 'eval', code: 'alert(1)' })
    receive({ type: 'update', snap: SNAP, trace: [] })
    expect(useVee.getState().ready).toBe(false)
  })

  it('the composer’s text only when the main window changed it itself', () => {
    receive(update({ composer: { text: '', rev: 3 } }))
    // Typed here; a snapshot a keystroke behind (same counter) does not take it back.
    useVee.setState({ chatInput: 'how many d' })
    receive(update({ composer: { text: 'how many', rev: 3 } }))
    expect(useVee.getState().chatInput).toBe('how many d')
    // The main window cleared it (a turn was sent): the counter moved, so it is taken.
    receive(update({ composer: { text: '', rev: 4 } }))
    expect(useVee.getState().chatInput).toBe('')
  })

  it('the trace, moved onto this page’s clock', () => {
    receive({
      type: 'update',
      origin: 1e9,
      trace: [{ kind: 'event', ev: { type: 'begin', at: 2, read: { models: [3], total: 3 } }, index: 1 }]
    })
    const tl = traceState().timeline!
    // The main window's clock started at 1e9 s on the wall clock, this page's at its own load.
    expect(tl.send).toBeCloseTo(2 + 1e9 - performance.timeOrigin / 1000, 3)
    expect(traceState().index).toBe(1)
    receive({ type: 'update', origin: 1e9, trace: [{ kind: 'event', ev: { type: 'fail' } }] })
    expect(traceState().timeline).toBeNull()
  })

  it('a copy, made here and answered', async () => {
    const rec = fakePort()
    connect(rec.port)
    receive({ type: 'copy', n: 5, text: 'G1' })
    await new Promise((r) => setTimeout(r, 0))
    // No clipboard and no document in a unit test: refused — and said so, with the number asked.
    expect(rec.sent).toEqual([{ type: 'copied', n: 5, ok: false }])
    connect(null)
  })
})

describe('Esc, and the theme it opens in', () => {
  it('Esc closes the window — but not from a text field, where it is the field’s', () => {
    expect(escClosesVee({ key: 'Escape', target: { tagName: 'DIV' } })).toBe(true)
    expect(escClosesVee({ key: 'Escape', target: { tagName: 'BUTTON' } })).toBe(true)
    expect(escClosesVee({ key: 'Escape', target: null })).toBe(true)
    // The composer is an <input>: the design's keys leave a field's keys alone.
    expect(escClosesVee({ key: 'Escape', target: { tagName: 'INPUT' } })).toBe(false)
    expect(escClosesVee({ key: 'Escape', target: { tagName: 'TEXTAREA' } })).toBe(false)
    expect(escClosesVee({ key: 'Escape', target: { tagName: 'SELECT' } })).toBe(false)
    // Mid-composition, and any other key, do nothing.
    expect(escClosesVee({ key: 'Escape', isComposing: true, target: { tagName: 'DIV' } })).toBe(false)
    expect(escClosesVee({ key: 'Enter', target: { tagName: 'DIV' } })).toBe(false)
  })

  it('opens in the theme the hash names, and in dark for anything else', () => {
    expect(themeFromHash('#theme=light')).toBe('light')
    expect(themeFromHash('#theme=dark')).toBe('dark')
    expect(themeFromHash('')).toBe('dark')
    expect(themeFromHash('#theme=light&x')).toBe('dark')
    expect(themeFromHash('#theme=blue')).toBe('dark')
  })
})

