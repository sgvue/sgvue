/**
 * "Vee Messages", stage 1a — 2026-11-08: the Ask Vee window drawn as a messaging conversation.
 * The owner: *"I need the conversation window like texting in messaging"*; direction C, "site
 * group chat" (`prototypes/vee-messages/full/`). What is held here, without a window:
 *
 *   · the port: `reply` names one part, optional, so an older window still works; `retry`;
 *     the snapshot's and the board's new fields, bounded, and the board carries no element id;
 *   · one message as its parts, in order, and the quote of one part — worked out in the main
 *     window from its own message, never from text the Vee window sends;
 *   · the board follows the main window's view whoever changed it, at most once a frame;
 *   · the consent card's verb and stamp, the read tick, the stopped / failed system lines and
 *     their honesty about what a tool already changed;
 *   · the window itself, rendered headless (`react-dom/server`): right / left, bubbles in order,
 *     the consent card's button and no focus of its own, the not-ready states, the polite live
 *     region, and only the newest avatar moving.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import {
  ToVee,
  VeeBoard,
  VeeIntent,
  VeeSnapshot,
  VEE_MAX_PARTS,
  type VeeMessage
} from '../../src/shared/vee-messages'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { partsOf, quoteOfPart } from '../../src/renderer/ai/parts'
import { plainBlock, parseBlocks } from '../../src/renderer/ai/blocks'
import { handleEvent, sendChat } from '../../src/renderer/ai/bridge'
import { traceFail } from '../../src/renderer/ai/trace-store'
import { boardOf, connect, messageId, receive } from '../../src/renderer/model/vee-link'
import {
  boardText,
  dayLabel,
  endLine,
  hhmm,
  NO_KEY_LINE,
  NO_MODEL_LINE,
  notReadyLine,
  pendingVerb,
  presenceOf
} from '../../src/renderer/state/selectors/chat'
import { useShell, type ChatMessage } from '../../src/renderer/state/shell'
import ChatPanel, { announcement, newestVee, shownNotReady, stampText } from '../../src/renderer/app/ChatPanel'
import { takeBoard, takeSnapshot, useVee } from '../../src/renderer/vee/store'
import { resetShell } from './stub-viewer'

/**
 * A server render reads a store's *initial* state (`useSyncExternalStore`'s server snapshot), so
 * here the Vee window's hook reads the store as it stands — what the window draws. Everything
 * else of the store is the real one.
 */
vi.mock('../../src/renderer/vee/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/vee/store')>()
  return { ...real, useVee: Object.assign(() => real.useVee.getState(), real.useVee) }
})

const full = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))

/** A reply of four blocks — a lead, a list, a table, a closing line — with its rows and a request. */
const REPLY = [
  '**12 walls** have no `FireRating`.',
  '',
  '- 7 on L1',
  '- 5 on L2',
  '',
  '| Level | Walls |',
  '|---|---:|',
  '| L1 | 7 |',
  '| L2 | 5 |',
  '',
  'The rest are rated.'
].join('\n')

const ROWS = { status: 'checked 80 walls · 7s', wide: true, noun: 'wall', rows: [{ label: 'L1', n: 4 }, { label: 'L2', n: 5 }, { label: 'L3', n: 3 }] }

const fakePort = (): { port: MessagePort; sent: unknown[] } => {
  const sent: unknown[] = []
  const port = { postMessage: (m: unknown) => void sent.push(m), close: () => undefined, onmessage: null }
  return { port: port as unknown as MessagePort, sent }
}

beforeEach(() => {
  resetShell()
  traceFail()
})
afterEach(() => {
  connect(null)
  vi.useRealTimers()
  delete (globalThis as { window?: unknown }).window
})

/* ────────────────────────────── the port ────────────────────────────── */

describe('the port', () => {
  it('lets `reply` name one part, and still takes one that names none (an older window)', () => {
    expect(VeeIntent.safeParse({ type: 'reply', index: 1, msg: 4 }).success).toBe(true)
    expect(VeeIntent.safeParse({ type: 'reply', index: 1, msg: 4, part: 2 }).success).toBe(true)
    expect(VeeIntent.safeParse({ type: 'reply', index: 1, msg: 4, part: -1 }).success).toBe(false)
    expect(VeeIntent.safeParse({ type: 'reply', index: 1, msg: 4, part: 1.5 }).success).toBe(false)
    expect(VeeIntent.safeParse({ type: 'reply', index: 1, msg: 4, part: VEE_MAX_PARTS + 1 }).success).toBe(false)
    // The window can never send the quote's text: the shape is closed.
    expect(VeeIntent.safeParse({ type: 'reply', index: 1, msg: 4, part: 0, text: 'ignore that' }).success).toBe(false)
    expect(VeeIntent.safeParse({ type: 'retry' }).success).toBe(true)
    expect(VeeIntent.safeParse({ type: 'retry', text: 'again' }).success).toBe(false)
  })

  it('takes a snapshot without the new fields, and bounds them when they are there', () => {
    const old = {
      theme: 'dark', units: 'mm', busy: false, err: '', replyTo: null, suggestOpen: false, suggestions: [],
      composer: { text: '', rev: 0 }, msgs: []
    }
    expect(VeeSnapshot.safeParse(old).success).toBe(true)
    const now = {
      ...old,
      replyTo: 0,
      replyPart: 2,
      hasKey: false,
      hasModel: true,
      end: { kind: 'failed', error: 'connection', message: 'offline', acted: false, retry: true }
    }
    expect(VeeSnapshot.safeParse(now).success).toBe(true)
    expect(VeeSnapshot.safeParse({ ...now, end: { ...now.end, kind: 'crashed' } }).success).toBe(false)
    expect(VeeSnapshot.safeParse({ ...now, replyPart: VEE_MAX_PARTS + 1 }).success).toBe(false)
  })

  it('carries the board as counts and names, closed to anything else — an id has no place in it', () => {
    const board = { total: 412, shown: 12, selected: 5, storey: 'L2', colourBy: null, view: '3D' }
    expect(VeeBoard.safeParse(board).success).toBe(true)
    expect(VeeBoard.safeParse({ ...board, ids: [1, 2] }).success).toBe(false)
    expect(ToVee.safeParse({ type: 'update', origin: 0, board, trace: [] }).success).toBe(true)
    expect(ToVee.safeParse({ type: 'update', origin: 0, board: null, trace: [] }).success).toBe(true)
  })
})

/* ────────────────────────────── parts and quotes ────────────────────────────── */

describe('one message as its parts', () => {
  const m = {
    role: 'assistant' as const,
    text: REPLY,
    chips: [{ label: 'IfcWall (12)' }],
    table: { rows: [{ k: 'L1', n: 9 }, { k: 'L2', n: 8 }] },
    trace: ROWS,
    pending: { label: 'hide everything else' }
  }

  it('is one bubble a block, then chips, the storey rows, the table and the consent card', () => {
    expect(partsOf(m).map((p) => p.kind)).toEqual(['text', 'text', 'text', 'text', 'chips', 'rows', 'table', 'consent'])
    expect(partsOf(m).filter((p) => p.kind === 'text' && p.lead)).toHaveLength(1)
    expect(partsOf({ role: 'user', text: 'a\n\nb' })).toEqual([{ kind: 'text', block: 0, lead: true }])
    // An answered request keeps its card, stamped.
    expect(partsOf({ ...m, pending: null, settled: { how: 'applied' } }).at(-1)).toEqual({ kind: 'consent' })
  })

  it('quotes one bubble — a text, a list, a table block — the storey rows and the table as text; a card to answer, never', () => {
    expect(quoteOfPart(m, 0)).toBe('12 walls have no FireRating.')
    expect(quoteOfPart(m, 1)).toBe('7 on L1; 5 on L2')
    expect(quoteOfPart(m, 2)).toBe('Level, Walls; L1, 7; L2, 5')
    expect(quoteOfPart(m, 3)).toBe('The rest are rated.')
    expect(quoteOfPart(m, 4)).toBeNull()
    expect(quoteOfPart(m, 5)).toBe('L1 4 walls; L2 5 walls; L3 3 walls')
    expect(quoteOfPart(m, 6)).toBe('L1 9; L2 8')
    expect(quoteOfPart(m, 7)).toBeNull()
    expect(quoteOfPart(m, 99)).toBeNull()
    expect(quoteOfPart({ role: 'assistant', text: 'x'.repeat(300) }, 0)).toBe('x'.repeat(220) + '…')
  })

  it('flattens one block by the whole reply’s own rule (`plainBlock`)', () => {
    expect(parseBlocks(REPLY).map(plainBlock)).toEqual([
      '12 walls have no FireRating.',
      '7 on L1; 5 on L2',
      'Level, Walls; L1, 7; L2, 5',
      'The rest are rated.'
    ])
  })
})

describe('a reply on one bubble, in the main window', () => {
  const MSGS: ChatMessage[] = [
    { role: 'user', text: 'which walls have no fire rating?' },
    { role: 'assistant', text: REPLY, trace: { ...ROWS, rows: ROWS.rows.map((r) => ({ ...r, ids: [1] })) } }
  ]
  let asked: { quote?: { who: string; text: string } | null }[] = []
  beforeEach(() => {
    asked = []
    useShell.setState({ federation: full, byId: full.byId, loaded: ['ARC'], chatMsgs: MSGS })
    ;(globalThis as { window?: unknown }).window = {
      sgvue: {
        aiTurn: (r: { quote?: { who: string; text: string } | null }) => {
          asked.push(r)
          return Promise.resolve()
        }
      }
    }
    connect(fakePort().port)
  })

  it('keeps which bubble, and the turn quotes that bubble from its own message', () => {
    const m = useShell.getState().chatMsgs[1]
    receive({ type: 'reply', index: 1, msg: messageId(m), part: 1 })
    expect([useShell.getState().chatReplyTo, useShell.getState().chatReplyPart]).toEqual([1, 1])
    void sendChat('and on L3?')
    expect(asked[0].quote).toEqual({ who: 'Vee', text: '7 on L1; 5 on L2' })
    expect([useShell.getState().chatReplyTo, useShell.getState().chatReplyPart]).toEqual([null, null])
  })

  it('quotes the storey rows as text, and the whole message when no part is named', () => {
    const m = useShell.getState().chatMsgs[1]
    receive({ type: 'reply', index: 1, msg: messageId(m), part: 4 })
    void sendChat('why L2?')
    expect(asked[0].quote?.text).toBe('L1 4 walls; L2 5 walls; L3 3 walls')
    traceFail()
    useShell.setState({ chatBusy: false, chatMsgs: MSGS })
    receive({ type: 'reply', index: 1, msg: messageId(useShell.getState().chatMsgs[1]) })
    expect(useShell.getState().chatReplyPart).toBeNull()
  })

  it('ignores a reply on a part that cannot be quoted, or that is not there', () => {
    const m = { ...MSGS[1], pending: { label: 'hide everything else', patch: { hidden: {} } } }
    useShell.setState({ chatMsgs: [MSGS[0], m] })
    const at = { type: 'reply', index: 1, msg: messageId(useShell.getState().chatMsgs[1]) }
    receive({ ...at, part: 5 }) // the consent card
    receive({ ...at, part: 40 })
    expect(useShell.getState().chatReplyTo).toBeNull()
  })
})

/* ────────────────────────────── the board ────────────────────────────── */

describe('the pinned board', () => {
  it('reads counts and names only, and is gone with no model', () => {
    expect(boardOf(useShell.getState())).toBeNull()
    const walls = full.elements.filter((e) => e.storey === full.elements[0].storey).slice(0, 5).map((e) => e.id)
    useShell.setState({ federation: full, byId: full.byId, visibleCount: 12, selIds: walls, view: 'iso' })
    const b = boardOf(useShell.getState())!
    expect(b).toEqual({ total: full.elements.length, shown: 12, selected: 5, storey: full.elements[0].storey, colourBy: null, view: '3D' })
    expect(VeeBoard.safeParse(b).success).toBe(true)
    // Two storeys selected: no one storey to name.
    const other = full.elements.find((e) => e.storey && e.storey !== full.elements[0].storey)!
    useShell.setState({ selIds: [...walls, other.id], view: null })
    expect(boardOf(useShell.getState())).toMatchObject({ storey: null, view: null })
  })

  it('follows the main window’s own changes, at most one post a frame', () => {
    vi.useFakeTimers()
    useShell.setState({ federation: full, byId: full.byId, visibleCount: full.elements.length })
    const rec = fakePort()
    connect(rec.port)
    const boards = (): unknown[] =>
      rec.sent.map((m) => ToVee.parse(m)).filter((m) => m.type === 'update' && m.board !== undefined)
    expect(boards()).toHaveLength(1)
    // The user's own clicks in the 3D view, three in a frame: one post.
    useShell.getState().select([full.elements[0].id])
    useShell.getState().select([full.elements[1].id])
    useShell.setState({ visibleCount: 12 })
    vi.advanceTimersByTime(100)
    expect(boards()).toHaveLength(2)
    const last = boards().at(-1) as { board: VeeBoard }
    expect(last.board).toMatchObject({ shown: 12, selected: 1 })
    // Nothing changed: nothing sent.
    useShell.setState({ chatInput: 'x' })
    vi.advanceTimersByTime(100)
    expect(boards()).toHaveLength(2)
  })

  it('says what the view shows in one line', () => {
    const base = { total: 412, shown: 412, selected: 0, storey: null, colourBy: null, view: '3D' }
    expect(boardText(base)).toBe('All 412 shown')
    expect(boardText({ ...base, shown: 12, selected: 5, storey: 'L2' })).toBe('12 of 412 shown · 5 selected · L2')
    expect(boardText({ ...base, colourBy: 'FireRating' })).toBe('All 412 shown · coloured by FireRating')
    expect(boardText({ ...base, total: 12_345, shown: 1_234 })).toBe('1,234 of 12,345 shown')
  })
})

/* ────────────────────────────── the consent card, the ticks, the system lines ────────────────────────────── */

describe('the consent card and its stamp', () => {
  it('names the action on its button: Delete, Clear all, else Apply', () => {
    expect(pendingVerb({ action: { kind: 'delete_view', id: 1 } })).toBe('Delete')
    expect(pendingVerb({ action: { kind: 'delete_measure', id: 1 } })).toBe('Delete')
    expect(pendingVerb({ action: { kind: 'delete_filter_set', id: 1 } })).toBe('Delete')
    expect(pendingVerb({ action: { kind: 'clear_spots', ids: [1] } })).toBe('Clear all')
    expect(pendingVerb({ action: { kind: 'clear_measures', ids: [1] } })).toBe('Clear all')
    expect(pendingVerb({ action: { kind: 'undo', snap: '' } })).toBe('Apply')
    expect(pendingVerb({})).toBe('Apply')
  })

  it('keeps what became of the request: applied, cleared or cancelled, with its words', () => {
    useShell.setState({
      chatMsgs: [
        { role: 'assistant', text: 'held', pending: { label: 'hide everything else', patch: { hidden: {} } } },
        { role: 'assistant', text: 'clear?', pending: { label: 'clear all 2 spots', action: { kind: 'clear_spots', ids: [] } } },
        { role: 'assistant', text: 'delete?', pending: { label: 'delete the viewpoint "Lobby"', action: { kind: 'delete_view', id: 9 } } }
      ]
    })
    useShell.getState().applyPending(0)
    useShell.getState().applyPending(1)
    useShell.getState().dismissPending(2)
    const [a, b, c] = useShell.getState().chatMsgs
    expect(a.settled).toMatchObject({ how: 'applied', label: 'hide everything else' })
    expect(b.settled).toMatchObject({ how: 'cleared', label: 'clear all 2 spots' })
    expect(c.settled).toMatchObject({ how: 'cancelled', label: 'delete the viewpoint "Lobby"' })
    expect([a.pending, b.pending, c.pending]).toEqual([null, null, null])
    const at = new Date(2026, 10, 8, 14, 2).getTime()
    expect(stampText({ how: 'applied', at, label: '' })).toBe('APPLIED · 14:02')
    expect(stampText({ how: 'deleted', at, label: '' })).toBe('DELETED · 14:02')
    expect(stampText({ how: 'cancelled', at, label: '' })).toBe('CANCELLED')
  })
})

describe('the read tick', () => {
  it('turns to two when the turn’s first stream event arrives, and stays at one when it never reaches Vee', () => {
    useShell.setState({ federation: full, byId: full.byId, loaded: ['ARC'] })
    let turnId = ''
    ;(globalThis as { window?: unknown }).window = {
      sgvue: {
        aiTurn: (r: { turnId: string }) => {
          turnId = r.turnId
          return Promise.resolve()
        }
      }
    }
    void sendChat('how many doors?')
    expect(useShell.getState().chatMsgs[0].seen).toBeFalsy()
    handleEvent({ type: 'error', turnId, kind: 'connection', message: 'offline' })
    expect(useShell.getState().chatMsgs[0].seen).toBeFalsy()
    expect(useShell.getState().chatEnd).toEqual({ kind: 'failed', error: 'connection', acted: false, message: 'offline' })
    // "Try again" runs the same question, and does not add it again.
    void sendChat(undefined, { retry: true })
    expect(useShell.getState().chatMsgs).toHaveLength(1)
    expect(useShell.getState().chatEnd).toBeNull()
    handleEvent({ type: 'usage', turnId, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } as never)
    expect(useShell.getState().chatMsgs[0].seen).toBe(true)
  })
})

describe('the system lines', () => {
  it('never says nothing changed when something did', () => {
    expect(endLine({ kind: 'stopped', error: '', acted: false, retry: false })).toEqual({ text: 'Stopped · nothing changed', retry: false })
    expect(endLine({ kind: 'stopped', error: '', acted: true, retry: true })).toEqual({ text: 'Stopped · what it already did stays', retry: false })
    expect(endLine({ kind: 'failed', error: 'connection', acted: false, retry: true })).toEqual({ text: 'Couldn’t reach Vee · nothing changed', retry: true })
    expect(endLine({ kind: 'failed', error: 'rate_limit', acted: true, retry: true }).text).toBe('Vee is busy right now · what it already did stays')
    // A second try cannot fix a missing or refused key.
    expect(endLine({ kind: 'failed', error: 'auth', acted: false, retry: true })).toEqual({ text: 'Vee couldn’t sign in · nothing changed', retry: false })
  })

  it('derives the presence line, never stored', () => {
    const p = { hasKey: true, busy: false, toolRan: false, end: null }
    expect(presenceOf(p)).toEqual({ word: 'on site', mode: 'idle' })
    expect(presenceOf({ ...p, busy: true })).toEqual({ word: 'typing', mode: 'busy' })
    expect(presenceOf({ ...p, busy: true, toolRan: true })).toEqual({ word: 'on it', mode: 'busy' })
    expect(presenceOf({ ...p, end: { kind: 'failed', error: 'connection', acted: false, retry: true } })).toEqual({ word: 'no signal', mode: 'off' })
    expect(presenceOf({ ...p, hasKey: false, busy: true })).toEqual({ word: 'no key', mode: 'off' })
  })

  it('says the day and the time', () => {
    const now = new Date(2026, 10, 8, 14, 2).getTime()
    expect(hhmm(now)).toBe('14:02')
    expect(dayLabel(now - 60_000, now)).toBe('Today')
    expect(dayLabel(now - 86_400_000, now)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 9, 1).getTime(), now)).toBe('1 Oct 2026')
  })

  it('lets the key line win over the model line', () => {
    expect(notReadyLine(false, false)).toBe(NO_KEY_LINE)
    expect(notReadyLine(false, true)).toBe(NO_KEY_LINE)
    expect(notReadyLine(true, false)).toBe(NO_MODEL_LINE)
    expect(notReadyLine(undefined, undefined)).toBeNull()
    expect(shownNotReady([{ role: 'assistant', text: NO_MODEL_LINE }], NO_MODEL_LINE)).toBeNull()
  })
})

/* ────────────────────────────── the window, rendered ────────────────────────────── */

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
  suggestions: ['How many walls?'],
  composer: { text: '', rev: 0 },
  msgs: [],
  hasKey: true,
  hasModel: true
}
const AT = new Date(2026, 10, 8, 14, 2).getTime()

function render(snap: Partial<VeeSnapshot>, board: VeeBoard | null = null): string {
  ;(globalThis as { window?: unknown }).window = { devicePixelRatio: 1 }
  // A fresh window: no message object kept from the render before (`keepUnchanged` reuses by id).
  useVee.setState({ ready: false, rev: -1, board: null, copyFlash: null, chatMsgs: [] })
  takeSnapshot({ ...SNAP, ...snap })
  takeBoard(board)
  return renderToStaticMarkup(createElement(ChatPanel))
}
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length

describe('the Vee window, rendered headless', () => {
  const conversation = (): VeeMessage[] => [
    vmsg({ id: 1, role: 'assistant', text: '**4 models**, 412 elements.', at: AT }),
    vmsg({ id: 2, role: 'user', text: 'which walls have no fire rating?', at: AT, seen: true }),
    vmsg({ id: 3, text: REPLY, at: AT, trace: ROWS, pending: { id: 8, label: 'delete the viewpoint "Lobby" (3D) — it cannot be brought back', verb: 'Delete' } })
  ]

  it('puts You on the right and Vee on the left, a reply as its bubbles and cards in order', () => {
    const html = render({ msgs: conversation() })
    expect(html).toMatch(/data-row="1" data-mine="" class="vm-grp vm-me"/)
    expect(count(html, /class="vm-grp vm-vee"/g)).toBe(2)
    // The user's row has no avatar; each of Vee's has one, at the group's foot.
    const userRow = html.slice(html.indexOf('data-row="1"'), html.indexOf('data-row="2"'))
    expect(userRow).not.toContain('vm-av')
    const reply = html.slice(html.indexOf('data-row="2"'))
    expect(count(reply, /class="vm-b vm-tx"/g)).toBe(4)
    const order = ['12 walls', '7 on L1', 'Level', 'The rest are rated.', 'data-role="storey-rows"', 'data-role="consent"'].map((t) =>
      reply.indexOf(t)
    )
    expect(order.every((v, k) => v > 0 && (k === 0 || v > order[k - 1]))).toBe(true)
    // The lead bubble carries the time; the user's carries two ticks once it was picked up.
    expect(count(reply, /class="vm-t"/g)).toBe(1)
    expect(userRow).toContain('aria-label="Picked up"')
    expect(html).toContain('<div class="vm-day">Today</div>')
  })

  it('offers reply on each bubble and card it can quote, and not on the consent card', () => {
    const reply = render({ msgs: conversation() }).split('data-row="2"')[1]
    // Four text bubbles and the storey rows.
    expect(count(reply, /aria-label="Reply"/g)).toBe(5)
    const card = reply.slice(reply.indexOf('data-role="consent"'))
    expect(card).not.toContain('aria-label="Reply"')
  })

  it('draws the consent card taped, its button naming the action, and takes no focus of its own', () => {
    const html = render({ msgs: conversation() })
    const card = html.slice(html.indexOf('data-role="consent"'))
    expect(card).toContain('class="vm-tape"')
    expect(card).toMatch(/>Cancel<\/button>/)
    expect(card).toMatch(/class="vm-go">Delete<\/button>/)
    expect(html).not.toMatch(/autofocus/i)
    expect(card.slice(0, 200)).not.toContain('tabindex')
    const clear = render({ msgs: [vmsg({ pending: { id: 2, label: 'clear all 2 spots', verb: 'Clear all' } })] })
    expect(clear).toMatch(/class="vm-go">Clear all<\/button>/)
    const older = render({ msgs: [vmsg({ pending: { id: 2, label: 'hide everything else' } })] })
    expect(older).toMatch(/class="vm-go">Apply<\/button>/)
  })

  it('stamps an answered card, and puts the reply’s one Revert on the stamp', () => {
    const html = render({
      msgs: [vmsg({ text: 'Held.', canRevert: true, settled: { how: 'applied', at: AT, label: 'hide everything else' } })]
    })
    expect(html).toContain('vm-card vm-pm vm-settled')
    expect(html).toContain('APPLIED · 14:02')
    expect(count(html, />Revert<\/button>/g)).toBe(1)
    expect(html).not.toContain('class="vm-foot"')
    // A reply with no card has its Revert at its foot.
    const foot = render({ msgs: [vmsg({ canRevert: true })] })
    expect(foot).toMatch(/class="vm-foot"><button[^>]*>.*Revert<\/button>/)
  })

  it('without a key: one line, the composer there but disabled and silent, no suggestions', () => {
    const html = render({ hasKey: false, msgs: [] })
    expect(html).toContain(NO_KEY_LINE)
    expect(html).toMatch(/<input[^>]*data-role="chatinput"[^>]*disabled=""/)
    expect(html).toMatch(/<input[^>]*placeholder=""/)
    expect(html).toMatch(/data-part="send"[^>]*disabled=""/)
    expect(html).not.toContain('data-role="chatsuggest"')
    expect(html).toContain('no key')
    // No key and no model: the key line wins.
    const both = render({ hasKey: false, hasModel: false })
    expect(both).toContain(NO_KEY_LINE)
    expect(both).not.toContain(NO_MODEL_LINE)
  })

  it('with no model: one line, the composer usable, no board and no suggestions', () => {
    const board = { total: 412, shown: 412, selected: 0, storey: null, colourBy: null, view: '3D' }
    const html = render({ hasModel: false, msgs: [] }, board)
    expect(html).toContain(NO_MODEL_LINE)
    expect(html).not.toMatch(/<input[^>]*disabled/)
    expect(html).toMatch(/placeholder="How many doors on L2\?"/)
    expect(html).not.toContain('data-role="vee-board"')
    expect(html).not.toContain('data-role="chatsuggest"')
    // Ready: the board and the suggestions are back.
    const ready = render({ msgs: [] }, board)
    expect(ready).toContain('data-role="vee-board"')
    expect(ready).toContain('data-role="chatsuggest"')
  })

  it('draws the board, isolated when not everything is shown', () => {
    const html = render({}, { total: 412, shown: 12, selected: 5, storey: 'L2', colourBy: null, view: '3D' })
    expect(html).toContain('class="vm-board vm-iso"')
    expect(html).toContain('<b>12</b> of 412 shown · <em>5 selected</em> · L2')
    expect(html).toContain('<span class="vm-vw">3D</span>')
    const all = render({}, { total: 412, shown: 412, selected: 0, storey: null, colourBy: 'FireRating', view: null })
    expect(all).toContain('class="vm-board"')
    expect(all).toContain('All <b>412</b> shown · coloured by FireRating')
  })

  it('says each new reply once through a polite live region, and not the log’s every bubble', () => {
    const html = render({ msgs: conversation() })
    expect(html).toMatch(/role="log" aria-live="off"/)
    expect(html).toMatch(/aria-live="polite" data-role="vee-announce">12 walls have no FireRating/)
    expect(announcement(conversation(), true)).toBe('Vee is working on it.')
  })

  it('moves only the newest avatar; every older one holds a still frame', () => {
    const html = render({ msgs: [...conversation(), vmsg({ id: 4, role: 'user', text: 'thanks' }), vmsg({ id: 5, text: 'Copy.' })] })
    const avatars = html.match(/<span class="vm-av"[\s\S]*?<\/span><\/span>/g) ?? []
    expect(avatars).toHaveLength(3)
    expect(avatars.map((a) => a.includes('data-still'))).toEqual([true, true, false])
    expect(newestVee([{ role: 'assistant' }, { role: 'user' }], true, false)).toBe(2)
    expect(newestVee([{ role: 'assistant' }], false, true)).toBe('nr')
  })

  it('says how a stopped or failed turn ended, with Try again on a failed one', () => {
    const stopped = render({ msgs: [vmsg({ role: 'user', text: 'hi' })], err: 'Stopped.', end: { kind: 'stopped', error: '', message: 'Stopped.', acted: true, retry: false } })
    expect(stopped).toContain('Stopped · what it already did stays')
    expect(stopped).not.toContain('Try again')
    expect(count(stopped, /data-role="vee-system"/g)).toBe(1)
    const failed = render({ msgs: [vmsg({ role: 'user', text: 'hi' })], err: 'offline', end: { kind: 'failed', error: 'connection', message: 'offline', acted: false, retry: true } })
    expect(failed).toContain('Couldn’t reach Vee · nothing changed')
    expect(failed).toMatch(/>Try again<\/button>/)
    expect(failed).toContain('title="offline"')
    expect(failed).toContain('no signal')
  })
})
