/**
 * The chat panel's pure pieces — `SGVue.dc.html:2015–2051` (the per-message view model, the
 * CSV, the reply strip, the suggestions) and `:1127–1136` (the corner-drag clamp).
 *
 * The panel itself is markup; everything it *decides* is here, so a bubble that comes out on
 * the wrong side, a quantity column that reads `1.0 m²` where the design reads `1 m²`, a CSV
 * that loses its quoting or a drag that inverts the panel is caught without a window.
 *
 * The store side of a turn — chips capped at six, a pending patch applied through `up()`, a
 * turn reverted on its own — is `tests/unit/ai-executors.test.ts`; what is checked here is
 * what the **panel** makes of a finished turn.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { federate } from '../../src/shared/federate'
import { mockModelIndex, SAMPLE_FILES } from '../../src/renderer/dev/mock-adapter'
import { sendChat } from '../../src/renderer/ai/bridge'
import { useShell, type ChatMessage } from '../../src/renderer/state/shell'
import { turnSnapshot, type TurnUndo } from '../../src/renderer/state/selectors/snapshot'
import { addUsage } from '../../src/renderer/ai/bridge'
import { traceState } from '../../src/renderer/ai/trace-store'
import { resetShell } from './stub-viewer'
import {
  ASSISTANT,
  authorOf,
  BUBBLE_RADIUS,
  CHAT_MIN,
  chatExamples,
  chatRow,
  chipsFolded,
  chipsStarted,
  clampChatSize,
  replyStrip,
  sendClick,
  STOP_GUARD_MS,
  suggestInput,
  tableCsv,
  tableQuantity
} from '../../src/renderer/state/selectors/chat'

const reset = resetShell

const full = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
const EMPTY_FEDERATION = federate([])

const message = (patch: Partial<ChatMessage>): ChatMessage => ({
  role: 'assistant',
  text: 'Done.',
  ...patch
})

/** What a reply that changed something carries: the state before it, and the parts it changed. */
const undo = (): TurnUndo => ({ before: turnSnapshot(useShell.getState(), null), changed: ['vis'] })

beforeEach(reset)

/* ────────────────────────────── one message row (`:2015`) ────────────────────────────── */

describe('a message row', () => {
  /**
   * 2026-10-01 — the owner's "Ask Vee" handoff: `You` stands on the left, with the assistant's
   * corner. The design put a user turn on the right with the notch on its own side (`:2015`:
   * `flex-end`, `11px 11px 3px 11px`); on the left, the composer's text and the bubble's are at
   * one x, which is what lets the typed line lift out of the composer in a straight line.
   */
  it('puts a user turn on the left, with the assistant’s corner, in its own colour', () => {
    const row = chatRow(message({ role: 'user', text: 'how many doors?' }), 0)
    expect(row).toMatchObject({
      who: 'You',
      bg: 'var(--sel-bg)',
      align: 'flex-start',
      just: 'flex-start',
      radius: BUBBLE_RADIUS,
      maxW: '86%',
      opacity: '1'
    })
    expect(BUBBLE_RADIUS).toBe('11px 11px 11px 3px')
    // The two sides differ in colour and in how wide they may grow, and in nothing else.
    const theirs = chatRow(message({}), 0)
    expect([row.align, row.just, row.radius]).toEqual([theirs.align, theirs.just, theirs.radius])
    expect([row.bg, theirs.bg, row.maxW, theirs.maxW]).toEqual(['var(--sel-bg)', 'var(--step-bg)', '86%', '100%'])
  })

  it('puts an assistant turn on the left, full width, with its notch at the bottom left', () => {
    const row = chatRow(message({}), 0)
    expect(row).toMatchObject({
      who: 'Vee',
      bg: 'var(--step-bg)',
      align: 'flex-start',
      just: 'flex-start',
      radius: '11px 11px 11px 3px',
      maxW: '100%'
    })
  })

  /**
   * 2026-10-01 — the owner's "Ask Vee" handoff. The assistant has a name of its own; the design
   * called it by the app's (`'SGVue'`, `:1597`, `:2017`, `:2038`). One expression says who a
   * message is from, and the mascot stands in front of the assistant's label only.
   */
  it('names the assistant Vee and the user You, and gives only the assistant the mascot', () => {
    expect(ASSISTANT).toBe('Vee')
    expect(authorOf({ role: 'assistant' })).toBe('Vee')
    expect(authorOf({ role: 'user' })).toBe('You')
    expect(chatRow(message({}), 0)).toMatchObject({ who: 'Vee', hasSprite: true })
    expect(chatRow(message({ role: 'user' }), 1)).toMatchObject({ who: 'You', hasSprite: false })
    // A reverted or quoted turn is still the assistant's.
    expect(chatRow(message({ undoSnap: undo(), reverted: true }), 2)).toMatchObject({ who: 'Vee', hasSprite: true })
  })

  it('offers ↺ only while the turn has a snapshot and has not been reverted', () => {
    expect(chatRow(message({}), 0).canRevert).toBe(false)
    expect(chatRow(message({ undoSnap: null }), 0).canRevert).toBe(false)
    expect(chatRow(message({ undoSnap: undo() }), 0).canRevert).toBe(true)
    const reverted = chatRow(message({ undoSnap: undo(), reverted: true }), 0)
    expect(reverted.canRevert).toBe(false)
    // `:2021` — a reverted turn stays in the transcript at half opacity.
    expect(reverted.opacity).toBe('0.5')
  })

  it('carries the quote a reply was aimed at', () => {
    const row = chatRow(message({ quote: { who: 'You', text: 'isolate L2' } }), 3)
    expect(row).toMatchObject({ hasQuote: true, quoteWho: 'You', quoteText: 'isolate L2', key: 3 })
    expect(chatRow(message({}), 0).hasQuote).toBe(false)
  })

  it('reports chips, a table and a pending change only when they are there', () => {
    expect(chatRow(message({}), 0)).toMatchObject({
      hasChips: false,
      hasTable: false,
      hasPending: false
    })
    const rich = chatRow(
      message({
        chips: [{ label: 'IfcWall (12)', ids: [1, 2] }],
        table: { groupBy: 'Level', rows: [{ k: 'L1', n: 4, area: 12.25, ids: [1] }] },
        pending: { label: 'leaves 3 of 412 visible', patch: {} }
      }),
      0
    )
    expect(rich).toMatchObject({
      hasChips: true,
      hasTable: true,
      tableTitle: 'Level',
      tableClash: false,
      hasPending: true,
      pendingLabel: 'leaves 3 of 412 visible'
    })
    expect(rich.tableRows).toEqual([{ k: 'L1', n: '4', q: '12.3 m²', ids: [1] }])
  })
})

/* ────────────────────────────── the quantity column (`:2029`) ────────────────────────────── */

describe('the table quantity column', () => {
  it('prefers area at one decimal, then volume at two, then nothing', () => {
    expect(tableQuantity({}, { area: 240.06, volume: 9 })).toBe('240.1 m²')
    expect(tableQuantity({}, { volume: 9.128 })).toBe('9.13 m³')
    expect(tableQuantity({}, {})).toBe('')
    // The design tests truthiness, so a zero area falls through to the volume (`:2029`).
    expect(tableQuantity({}, { area: 0, volume: 2 })).toBe('2.00 m³')
  })

  it('reports a clash volume at three decimals, and says so below a millilitre', () => {
    expect(tableQuantity({ clash: true }, { vol: 0.0421 })).toBe('0.042 m³')
    expect(tableQuantity({ clash: true }, { vol: 0.0009 })).toBe('<0.001 m³')
    expect(tableQuantity({ clash: true }, { vol: 0.001 })).toBe('0.001 m³')
  })
})

/* ────────────────────────────── copy csv (`:2031`) ────────────────────────────── */

describe('copy csv', () => {
  it('writes the grouping as the header and quotes every key', () => {
    const csv = tableCsv({
      groupBy: 'SpeciesCommonName',
      rows: [
        { k: 'Rain Tree', n: 12, area: 4.5, ids: [] },
        { k: 'Tembusu, mature', n: 3, ids: [] }
      ]
    })
    expect(csv.split('\n')).toEqual([
      'SpeciesCommonName,count,quantity',
      '"Rain Tree",12,4.50',
      '"Tembusu, mature",3,'
    ])
  })

  it('writes a clash volume at four decimals, in the clash table', () => {
    const csv = tableCsv({
      groupBy: 'Clash candidates',
      clash: true,
      rows: [{ k: 'Duct ↔ Beam', n: 1, vol: 0.01234567, ids: [] }]
    })
    expect(csv.split('\n')[1]).toBe('"Duct ↔ Beam",1,0.0123')
  })
})

/* ────────────────────────────── the reply strip (`:2037`) ────────────────────────────── */

describe('the reply strip', () => {
  const msgs = [message({ role: 'user', text: 'isolate L2' }), message({ text: '14 elements.' })]

  it('names the turn it is aimed at', () => {
    expect(replyStrip(msgs, 0)).toEqual({ replying: true, who: 'You', text: 'isolate L2' })
    expect(replyStrip(msgs, 1)).toEqual({ replying: true, who: 'Vee', text: '14 elements.' })
  })

  it('is absent with no target, and empty rather than broken for a stale index', () => {
    expect(replyStrip(msgs, null).replying).toBe(false)
    expect(replyStrip(msgs, 9)).toEqual({ replying: true, who: '', text: '' })
  })
})

/* ────────────────────────────── the suggestions (`:2051`) ────────────────────────────── */

describe('the contextual suggestions', () => {
  beforeEach(() => {
    useShell.setState({
      federation: full,
      byId: full.byId,
      loaded: ['ARC', 'STR', 'SIT', 'MEP'],
      library: SAMPLE_FILES.map((f) => ({
        key: f.key,
        name: f.name,
        file: f.file,
        swatch: f.swatch
      }))
    })
  })

  it('offers four, in the order the design builds them', () => {
    const out = chatExamples(useShell.getState())
    expect(out).toHaveLength(4)
    expect(out).toEqual([
      'Check Architecture against Structure',
      'How many trees, by species?',
      'Audit the model data',
      'Slab area by level'
    ])
  })

  it('leads with the selection when there is one', () => {
    const wall = full.elements.find((e) => e.type === 'IfcWall')!
    useShell.setState({ sel: wall.id, selIds: [wall.id] })
    const out = chatExamples(useShell.getState())
    expect(out[0]).toBe(`How many more like ${wall.objectType}?`)
    expect(out[1]).toBe(`Isolate every wall on ${wall.storey}`)
  })

  it('offers a reset once something is hidden, and once a step is live', () => {
    useShell.setState({ hidden: { 1: true } })
    expect(chatExamples(useShell.getState())).toContain('Reset the view')
    useShell.setState({
      hidden: {},
      stack: [{ id: 's1', action: 'isolate', on: true, color: '#35C4B6', rules: [] }]
    })
    const live = chatExamples(useShell.getState())
    expect(live).toContain('Add the slabs to that view as well')
    // A live step drops the two-model comparison, exactly as `:1583` does.
    expect(live.join('|')).not.toContain('Check Architecture against')
  })

  it('stops offering the audit once one has been asked for', () => {
    useShell.setState({ chatMsgs: [message({ role: 'user', text: 'Audit the model data' })] })
    expect(chatExamples(useShell.getState())).not.toContain('Audit the model data')
  })

  it('reads the panel state the design reads, and nothing else', () => {
    useShell.setState({ chatMsgs: [message({ text: 'Done.' })] })
    expect(suggestInput(useShell.getState())).toMatchObject({
      lastMessage: { text: 'Done.' },
      messageTexts: ['Done.'],
      sel: null,
      stackLive: false,
      hiddenCount: 0
    })
  })
})

/* ────────────────────────────── the corner drag (`:1127`) ────────────────────────────── */

describe('the resize clamp', () => {
  const stage = { width: 1200, height: 800 }
  const start = { w: 330, h: 420, x: 900, y: 400 }

  it('grows leftward and upward by exactly the drag', () => {
    expect(clampChatSize(start, { x: 820, y: 330 }, stage, 12, 60)).toEqual({
      chatW: 410,
      chatH: 490
    })
  })

  it('never goes under 240 px in either direction', () => {
    expect(clampChatSize(start, { x: 1400, y: 900 }, stage, 12, 60)).toEqual({
      chatW: CHAT_MIN,
      chatH: CHAT_MIN
    })
  })

  it('never grows past the stage, and the lane it has to clear', () => {
    const wide = clampChatSize(start, { x: 0, y: 0 }, stage, 344, 60)
    expect(wide.chatW).toBe(1200 - 344 - 12)
    expect(wide.chatH).toBe(800 - 60 - 64)
  })

  it('keeps the minimum on a stage too small to hold it', () => {
    const tiny = clampChatSize(start, { x: 0, y: 0 }, { width: 300, height: 260 }, 344, 60)
    expect(tiny).toEqual({ chatW: CHAT_MIN, chatH: CHAT_MIN })
  })

  /**
   * 2026-10-01 — the bottom row's lane (`--brow`). The panel's foot stands that much higher, so
   * the tallest it may be dragged is that much less; the width is not its business.
   */
  it('stops that much shorter of the toolbar while the bottom row has a lane', () => {
    const at = { x: 0, y: 0 }
    expect(clampChatSize(start, at, stage, 344, 60, 43)).toEqual({
      chatW: 1200 - 344 - 12,
      chatH: 800 - 60 - 64 - 43
    })
    // No lane — the row is one line — is the design's own bound, with the argument or without.
    expect(clampChatSize(start, at, stage, 344, 60, 0)).toEqual(clampChatSize(start, at, stage, 344, 60))
    // A drag short of the bound is untouched by the lane.
    expect(clampChatSize(start, { x: 820, y: 330 }, stage, 12, 60, 43)).toEqual({ chatW: 410, chatH: 490 })
    // And the 240 px floor still wins on a stage the lane leaves too little of.
    expect(clampChatSize(start, at, { width: 1200, height: 420 }, 12, 60, 121).chatH).toBe(CHAT_MIN)
  })
})

/* ────────────────────────────── the reply's quote (`:1597`) ────────────────────────────── */

describe('the quote a reply carries', () => {
  let sent: { quote: { who: string; text: string } | null }[] = []
  beforeEach(() => {
    sent = []
    useShell.setState({ federation: full, byId: full.byId, loaded: ['ARC'] })
    ;(globalThis as { window?: unknown }).window = {
      sgvue: {
        aiTurn: (request: { quote: { who: string; text: string } | null }) => {
          sent.push(request)
          return Promise.resolve()
        }
      }
    }
  })
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('names the assistant Vee to the model too, and the user You', () => {
    useShell.setState({
      chatMsgs: [message({ role: 'user', text: 'isolate L2' }), message({ text: '14 elements.' })],
      chatReplyTo: 1,
      chatInput: 'and hide those'
    })
    void sendChat()
    expect(sent.map((r) => r.quote)).toEqual([{ who: 'Vee', text: '14 elements.' }])
    // The user's own bubble shows the same quote.
    expect(chatRow(useShell.getState().chatMsgs[2], 2)).toMatchObject({ quoteWho: 'Vee', quoteText: '14 elements.' })
  })

  it('quotes a user turn as You', () => {
    useShell.setState({
      chatMsgs: [message({ role: 'user', text: 'isolate L2' })],
      chatReplyTo: 0,
      chatInput: 'no, L3'
    })
    void sendChat()
    expect(sent.map((r) => r.quote)).toEqual([{ who: 'You', text: 'isolate L2' }])
  })
})

/* ────────────────────────────── the composer's guards (`:1592`) ────────────────────────────── */

/**
 * `sendChat` is 9a's, but these four guards are what the composer relies on: the design's
 * `chatSend` opens with `if (!q || this.state.chatBusy || !this.model) return`, and that single
 * line is the whole of the panel's "disabled" behaviour — there is no `disabled` attribute
 * anywhere in the designed composer, so the guard is the feature.
 */
describe('the composer guards', () => {
  let sent: { userText: string }[] = []
  const noWindow = (): void => {
    delete (globalThis as { window?: unknown }).window
  }
  /** Just enough bridge for `sendChat` to reach `aiTurn`. The turn never finishes: only an
   *  event settles it, and these tests are about what happens before the first one. */
  const fakeBridge = (): void => {
    sent = []
    ;(globalThis as { window?: unknown }).window = {
      sgvue: {
        aiTurn: (request: { userText: string }) => {
          sent.push(request)
          return Promise.resolve()
        }
      }
    }
  }

  beforeEach(() => {
    useShell.setState({ federation: full, byId: full.byId, loaded: ['ARC'] })
    noWindow()
  })
  afterEach(noWindow)

  it('ignores an empty question, and one that is only spaces', async () => {
    useShell.setState({ chatInput: '   ' })
    await sendChat()
    expect(useShell.getState().chatMsgs).toHaveLength(0)
    expect(useShell.getState().chatBusy).toBe(false)
    expect(useShell.getState().chatErr).toBe('')
  })

  it('ignores a second question while one is running', async () => {
    useShell.setState({ chatInput: 'how many walls?', chatBusy: true })
    await sendChat()
    expect(useShell.getState().chatMsgs).toHaveLength(0)
  })

  it('ignores any question with no federation loaded', async () => {
    useShell.setState({ federation: EMPTY_FEDERATION, byId: new Map(), chatInput: 'hello' })
    await sendChat()
    expect(useShell.getState().chatMsgs).toHaveLength(0)
  })

  it('sends the trimmed question, and empties the composer', () => {
    fakeBridge()
    useShell.setState({ chatInput: '  how many walls?  ' })
    void sendChat()
    expect(sent.map((c) => c.userText)).toEqual(['how many walls?'])
    expect(useShell.getState().chatMsgs).toEqual([
      { role: 'user', text: 'how many walls?', quote: null }
    ])
    expect(useShell.getState().chatInput).toBe('')
    expect(useShell.getState().chatBusy).toBe(true)
    // The design set a busy-row line here (`chatStage`, `:1602`). The store keeps none since
    // 2026-10-01: a running turn is the live reply, drawn from the trace `sendChat` begins.
    expect(useShell.getState()).not.toHaveProperty('chatStage')
    expect(traceState().timeline).toMatchObject({ tool: null, calls: [], answer: null })
    expect(traceState().index).toBe(1)
  })
})

/* ══════════════════════════ 2026-09-20 — a turn's token total ══════════════════════════ */

describe('addUsage', () => {
  const round = (
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens = 0,
    cacheCreateTokens = 0
  ): Parameters<typeof addUsage>[1] => ({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreateTokens
  })

  it('starts from nothing and counts the round', () => {
    expect(addUsage(null, round(10, 5, 4, 3))).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 4,
      cacheCreateTokens: 3,
      rounds: 1
    })
  })

  it('accumulates a whole turn rather than keeping only its last round', () => {
    // A three-round tool turn: the cache is written once and read twice, which is exactly the
    // shape the acceptance run checks — and the shape a last-round-only log destroyed.
    let usage = addUsage(null, round(9_000, 300, 0, 9_190))
    usage = addUsage(usage, round(1_700, 250, 9_190, 0))
    usage = addUsage(usage, round(2_200, 180, 9_190, 0))
    expect(usage).toEqual({
      inputTokens: 12_900,
      outputTokens: 730,
      cacheReadTokens: 18_380,
      cacheCreateTokens: 9_190,
      rounds: 3
    })
    // The four counters stay apart, because they are billed at four different rates.
    expect(usage.cacheReadTokens).not.toBe(usage.inputTokens)
  })

  it('never mutates the total it was given', () => {
    const first = addUsage(null, round(1, 1))
    const second = addUsage(first, round(1, 1))
    expect(first.rounds).toBe(1)
    expect(second.rounds).toBe(2)
  })
})

/* ──────────── the suggestion row folds once the conversation starts (2026-09-24) ──────────── */

describe('the suggestion row', () => {
  const seed = message({ text: '1 model, 6 elements.' })
  const asked = message({ role: 'user', text: 'how many walls?' })

  it('shows unfolded before the first user turn — the boot audit alone does not start it', () => {
    expect(chipsStarted([])).toBe(false)
    expect(chipsStarted([seed])).toBe(false)
    expect(chipsFolded([seed], false)).toBe(false)
  })

  it('folds after the first user turn, and the chip opens it', () => {
    expect(chipsStarted([seed, asked])).toBe(true)
    expect(chipsFolded([seed, asked], false)).toBe(true)
    expect(chipsFolded([seed, asked], true)).toBe(false)
  })

  it('a new or cleared conversation starts unfolded again', () => {
    expect(chipsFolded([], false)).toBe(false)
    expect(chipsFolded([], true)).toBe(false)
  })

  it('sending a turn folds an opened row again', () => {
    useShell.getState().setChatSuggestOpen(true)
    expect(useShell.getState().chatSuggestOpen).toBe(true)
    useShell.getState().chatBegin('how many walls?')
    const st = useShell.getState()
    expect(st.chatSuggestOpen).toBe(false)
    expect(chipsFolded(st.chatMsgs, st.chatSuggestOpen)).toBe(true)
  })
})

/* ────────────────────────────── the send button, which is also the stop ────────────────────────────── */

describe('a click on the send button', () => {
  it('stops a running turn, sends otherwise', () => {
    expect(sendClick(true, 5_000, null)).toBe('stop')
    expect(sendClick(false, 5_000, null)).toBe('send')
  })

  /**
   * 2026-10-01. The button is the stop while a turn runs. The second click of a double-click on
   * Stop lands a few milliseconds after the first — when main's `aborted` may already have ended
   * the turn — and it must neither stop a second time nor send what was drafted in the composer
   * while the turn ran.
   */
  it('does nothing for 300 ms after it stopped a turn, whichever state the second click finds', () => {
    expect(STOP_GUARD_MS).toBe(300)
    const stoppedAt = 5_000
    // The turn has already ended: without the guard this click would send the draft.
    expect(sendClick(false, stoppedAt + 40, stoppedAt)).toBe('ignore')
    // The turn has not ended yet: without it this click would ask main to stop a second time.
    expect(sendClick(true, stoppedAt + 40, stoppedAt)).toBe('ignore')
    expect(sendClick(false, stoppedAt + 299.9, stoppedAt)).toBe('ignore')
    // Then the button is itself again.
    expect(sendClick(false, stoppedAt + 300, stoppedAt)).toBe('send')
    expect(sendClick(true, stoppedAt + 300, stoppedAt)).toBe('stop')
    expect(sendClick(false, stoppedAt + 60_000, stoppedAt)).toBe('send')
  })
})
