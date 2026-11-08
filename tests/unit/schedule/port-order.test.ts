// The Schedules port under every message order — v1.5.0, check 4 of the Schedules safety net.
//
// Both ends are the real code: the main window's `model/schedule-link.ts` (`connect`,
// `requestManage`, `defineSchedule`, `openSchedule`) on the real shell store with a stub viewer,
// and the Schedules window's composition root `schedule-ui/main.ts` on the fake DOM
// (`support/windowHarness.ts`), whose `receive` runs `manage.ts` and `define`. Between them, an
// in-memory MessagePort pair that keeps each direction in order (as a real port does) but lets
// `fc.scheduler` (fast-check 4.10.2) decide WHEN each message arrives — interleaved with the
// passing of time (fake timers in 400 ms ticks, so the asker's 3 s wait and the window's 2 s
// freshness both fall at every possible place), with the user's own edit in the window, with
// the assistant's `define`, with a second request, and with the answer to the window's own
// confirm dialog. Every interleaving fast-check draws is run deterministically and, on a
// failure, shrunk and printed with the seed (`SIM_SEED=<seed>` replays it).
//
// Properties, over every interleaving:
//   1. at most one `manage` is in flight: the main window never posts a second while the first
//      is unanswered, and a request made meanwhile is answered `busy` without being sent;
//   2. an answer reaches only the request it answers: a request resolves with the window's
//      fields only from a `manageAck` carrying its own number, delivered while it waited; one
//      that timed out resolves `timeout` — which claims nothing either way, because the window
//      may have acted and answered late (the assistant is told the outcome is not known) — and
//      its late ack is dropped, never applied to the next request;
//   3. a request delivered more than 2 s after it was asked is dropped by the window: no answer,
//      no change to the schedule, its history or the saved list, no dialog, nothing printed;
//   4. a gated request (delete, print) does nothing until the dialog's answer, and then only on
//      yes: the saved setup is gone, or the print dialog opened, exactly when the user said yes;
//   5. a `define` racing the user's edit lands on the window's history in arrival order — each
//      its own undo step, undone in reverse — and once everything has settled, the `current`
//      the main window holds is the window's final definition;
//   6. nothing throws and no promise is left rejected.

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { redoDepth, undoDepth } from '../../../src/schedule/history';
import { MANAGE_ACK_MS, MANAGE_FRESH_MS, type ManageOp } from '../../../src/schedule/messages';
import * as act from '../../../src/schedule/schedule/actions';
import { parseScheduleDef, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { federate } from '../../../src/shared/federate';
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter';
import { connect, defineSchedule, openSchedule, requestManage, type ManageAnswer } from '../../../src/renderer/model/schedule-link';
import { MANAGE_TIMEOUT_MESSAGE } from '../../../src/renderer/ai/executors/schedule';
import { setViewer, useShell } from '../../../src/renderer/state/shell';
import { resetShell, stubViewer } from '../stub-viewer';
import { FakeEl } from './support/fakeDom';
import { installWindow, type FakePort, type Window } from './support/windowHarness';

/** The window's confirm dialog: each question is answered by a task the scheduler places. */
const dialog = vi.hoisted(() => ({
  open: false,
  asked: 0,
  onAsk: (_message: string, _answer: (ok: boolean) => void): void => undefined,
}));
vi.mock('../../../src/renderer/schedule-ui/dialog', () => ({
  dialogOpen: () => dialog.open,
  confirmDialog: (message: string) => new Promise<boolean>((resolve) => {
    dialog.open = true;
    dialog.asked++;
    dialog.onAsk(message, (ok) => { dialog.open = false; resolve(ok); });
  }),
  promptDialog: async () => null,
}));

const SEED = process.env.SIM_SEED === undefined ? 20261108 : Number(process.env.SIM_SEED);
const RUNS = Number(process.env.PORT_RUNS ?? 150);
const TICK = 400;
const TICKS = 14;
const SAVED_KEY = 'sgvue.schedules.saved.v1';

let W: Window;
type WinMods = {
  state: typeof import('../../../src/renderer/schedule-ui/state');
  schedules: typeof import('../../../src/renderer/schedule-ui/schedules');
};
let Win: WinMods;
const rejections: unknown[] = [];
const onRejection = (e: unknown) => { rejections.push(e); };

beforeAll(async () => {
  vi.useFakeTimers();
  W = installWindow();
  await import('../../../src/renderer/schedule-ui/main');
  Win = {
    state: await import('../../../src/renderer/schedule-ui/state'),
    schedules: await import('../../../src/renderer/schedule-ui/schedules'),
  };
  resetShell();
  setViewer(stubViewer());
  useShell.getState().commitModels(federate(['ARC', 'STR'].map((k) => mockModelIndex(k))));
  process.on('unhandledRejection', onRejection);
});
afterAll(() => {
  process.off('unhandledRejection', onRejection);
  connect(null);
  setViewer(null);
  vi.useRealTimers();
});

/* ────────────────────────────── the port pair ────────────────────────────── */

type Msg = { type: string; [k: string]: unknown };
interface Log { at: number; dir: 'toWin' | 'toMain'; msg: Msg }

/**
 * Two ends of one port. A post is queued in its direction and a delivery task is handed to the
 * scheduler; whichever delivery task runs takes the HEAD of that queue, so each direction stays
 * in order however the tasks interleave. `direct` delivers at once (set-up only).
 */
function portPair(sched: { deliver: (dir: 'toWin' | 'toMain', go: () => void) => void }) {
  const queues: Record<'toWin' | 'toMain', Msg[]> = { toWin: [], toMain: [] };
  const posted: Log[] = [];
  const delivered: Log[] = [];
  let direct = true;
  const end = (dir: 'toWin' | 'toMain', other: () => FakePort): FakePort => {
    const p: FakePort = {
      onmessage: null,
      closed: false,
      close: () => { p.closed = true; },
      postMessage: (data) => {
        if (p.closed) return;
        const msg = structuredClone(data) as Msg;
        posted.push({ at: Date.now(), dir, msg });
        queues[dir].push(msg);
        const go = () => {
          const head = queues[dir].shift()!;
          delivered.push({ at: Date.now(), dir, msg: head });
          const to = other();
          if (!to.closed) to.onmessage?.({ data: head });
        };
        if (direct) go(); else sched.deliver(dir, go);
      },
    };
    return p;
  };
  const toWin: FakePort = end('toWin', () => winEnd);
  const winEnd: FakePort = end('toMain', () => toWin);
  return { mainEnd: toWin, winEnd, posted, delivered, queues, scheduled: () => { direct = false; } };
}

/* ────────────────────────────── one run ────────────────────────────── */

const OPS: ManageOp[] = ['undo', 'redo', 'delete', 'print', 'save'];

interface Plan {
  first: ManageOp;
  second: ManageOp | null;
  yes: boolean;
  define: boolean;
  userEdit: boolean;
  /** The user types a heading and the assistant changes another one: text-only, both. */
  textOnly: boolean;
}

const tally = { runs: 0, dropped: 0, timeouts: 0, lateAcks: 0, busy: 0, gatedYes: 0, gatedNo: 0, races: 0,
  actedThenTimedOut: 0, deliveries: 0, textRaces: 0, closeTextRaces: 0 };

/**
 * A fresh pair of windows joined by a fresh port, set up with everything delivered at once: the
 * schedule on screen is "Doors A", saved under that name (so delete and save have a setup to act
 * on), with three steps on its history — each 1 s apart, so none joins another. Then each post
 * goes to `deliver`, which decides when it arrives.
 */
async function setUp(deliver: (dir: 'toWin' | 'toMain', go: () => void) => void) {
  connect(null);
  W.storage.clear();
  W.storage.set(SAVED_KEY, JSON.stringify([]));
  dialog.open = false;
  dialog.asked = 0;
  dialog.onAsk = () => undefined;
  Win.state.state.store = null;
  const pair = portPair({ deliver });
  W.connect(pair.winEnd);
  connect(pair.mainEnd as unknown as MessagePort);
  await vi.advanceTimersByTimeAsync(1000);
  Win.state.updateDef((d) => act.setGrandTotal(d, true));
  await vi.advanceTimersByTimeAsync(1000);
  Win.state.updateDef((d) => act.setName(d, 'Doors A'));
  await vi.advanceTimersByTimeAsync(1000);
  Win.state.updateDef((d) => act.setHeading(d, 0, 'First'));
  Win.schedules.saveSchedule(Win.state.state.def, null);
  Win.state.state.savedName = 'Doors A';
  Win.state.render();
  await vi.advanceTimersByTimeAsync(1000);
  expect(openSchedule()?.def.name, 'set-up: the main window sees the schedule').toBe('Doors A');
  expect(undoDepth(), 'set-up: three steps to undo').toBe(3);
  return pair;
}

async function runOne(s: fc.Scheduler, plan: Plan) {
  tally.runs++;
  /** What threw inside a scheduled task (a check made on arrival): reported, not lost. */
  const failures: unknown[] = [];
  const later = (label: string, fn: () => unknown) => s.schedule(Promise.resolve(), label).then(fn).catch((e) => { failures.push(e); });
  const pair = await setUp((dir, go) => {
    tally.deliveries++;
    void later(`deliver ${dir}`, go);
  });
  pair.scheduled();
  const start = pair.posted.length;
  const printedBefore = W.printed();

  // ---- what each side does, at a time the scheduler chooses ----
  const requests: { n: number | null; op: ManageOp; asked: number; answer?: ManageAnswer; answeredAt?: number }[] = [];
  const ask = (op: ManageOp) => {
    const before = pair.posted.length;
    const r: (typeof requests)[number] = { n: null, op, asked: Date.now() };
    requests.push(r);
    const inFlight = requests.filter((x) => x !== r && x.n !== null && !x.answer).length;
    const p = requestManage(op, { ...(op === 'delete' ? { name: 'Doors A' } : {}), ask: true }, MANAGE_ACK_MS);
    const mine = pair.posted.slice(before).filter((x) => x.msg.type === 'manage');
    // 1. never a second in flight: a request made while one waits is not sent.
    if (inFlight) expect(mine, 'a second manage posted while one was in flight').toEqual([]);
    r.n = mine.length ? (mine[0].msg.n as number) : null;
    void p.then((a) => { r.answer = a; r.answeredAt = Date.now(); });
  };

  // The window's own answer to each question it raised: a task of its own, answered `plan.yes`.
  // What was so the moment before each answer, for property 4.
  const answers: {
    kind: 'delete' | 'print' | 'save'; entryBefore: boolean; entryAfter?: boolean; printedBefore: number; savedSame: boolean;
  }[] = [];
  dialog.onAsk = (message, answer) => {
    const kind = message.startsWith('Delete') ? 'delete' : message.startsWith('Open the print') ? 'print' : 'save';
    expect(message, 'a question this check does not know').toMatch(/^(Delete the saved|Open the print|Save over the saved)/);
    const savedAtAsk = JSON.stringify(Win.schedules.listSaved());
    void later(`dialog answer (${kind})`, async () => {
      const x: (typeof answers)[number] = {
        kind,
        entryBefore: Win.schedules.listSaved().some((e) => e.name === 'Doors A'),
        printedBefore: W.printed() - printedBefore,
        // Nothing the question is about changed while it was up (no other request may act then).
        savedSame: JSON.stringify(Win.schedules.listSaved()) === savedAtAsk,
      };
      answers.push(x);
      answer(plan.yes);
      // The handler's own `.then` runs next: what the answer did, before anything else can.
      for (let i = 0; i < 3; i++) await Promise.resolve();
      x.entryAfter = Win.schedules.listSaved().some((e) => e.name === 'Doors A');
    });
  };

  // Arrival order on the window, for property 5: each change to its definition, as JSON.
  const arrivals: { kind: 'define' | 'edit'; json: string; at: number; before: string; text: boolean }[] = [];
  const winReceive = pair.winEnd.onmessage!;
  pair.winEnd.onmessage = (e) => {
    const m = e.data as Msg;
    // 3. A request older than 2 s is dropped: no answer, no change, no dialog, nothing printed.
    const stale = m.type === 'manage' && Date.now() - (m.at as number) > MANAGE_FRESH_MS;
    const before = stale ? {
      def: JSON.stringify(Win.state.state.def), undo: undoDepth(), redo: redoDepth(),
      saved: JSON.stringify(Win.schedules.listSaved()), asked: dialog.asked, printed: W.printed(), posts: pair.posted.length,
    } : null;
    const defBefore = JSON.stringify(Win.state.state.def);
    winReceive(e);
    if (before) {
      tally.dropped++;
      expect({
        def: JSON.stringify(Win.state.state.def), undo: undoDepth(), redo: redoDepth(),
        saved: JSON.stringify(Win.schedules.listSaved()), asked: dialog.asked, printed: W.printed(), posts: pair.posted.length,
      }, 'a stale request did something').toEqual(before);
    }
    if (m.type === 'define' && JSON.stringify(Win.state.state.def) !== defBefore) {
      arrivals.push({ kind: 'define', json: JSON.stringify(Win.state.state.def), at: Date.now(), before: defBefore, text: plan.textOnly });
    }
    if (m.type === 'manage' && !stale && (m.op === 'undo' || m.op === 'redo')) arrivals.length = 0; // a step moves the history
    // A save that had to number its name renames the schedule on screen, and is no undo step
    // (`history.ts` `restate`): the last arrival now stands under that name, one step as before.
    if (m.type === 'manage' && !stale && m.op === 'save' && JSON.stringify(Win.state.state.def) !== defBefore) {
      const renamed = { ...(JSON.parse(defBefore) as ScheduleDef), name: Win.state.state.def.name };
      expect(JSON.stringify(Win.state.state.def), 'a save changed more than the name').toBe(JSON.stringify(renamed));
      const last = arrivals.at(-1);
      if (last) last.json = JSON.stringify(Win.state.state.def);
    }
  };

  const defineDef = (): ScheduleDef => {
    // The assistant's change: another column added — its own undo step, whatever its timing.
    const d = structuredClone(openSchedule()!.def);
    return plan.textOnly ? act.setHeading(d, 1, 'From Vee') : act.addSortLevel({ ...d, name: 'Doors A' });
  };

  const at = (label: string, fn: () => void) => { void later(label, fn); };
  for (let i = 0; i < TICKS; i++) at(`tick ${i}`, () => { vi.advanceTimersByTime(TICK); });
  at(`main asks ${plan.first}`, () => ask(plan.first));
  if (plan.second) at(`main asks ${plan.second}`, () => ask(plan.second!));
  if (plan.define) at('main defines', () => {
    const d = defineDef();
    defineSchedule(d, 'edited', 1);
  });
  if (plan.userEdit) at('user edits', () => {
    const before = JSON.stringify(Win.state.state.def);
    Win.state.updateDef((d) => (plan.textOnly
      ? act.setHeading(d, 0, 'Typed')
      : act.setHidden(d, Math.max(0, d.columns.length - 1), true)));
    arrivals.push({ kind: 'edit', json: JSON.stringify(Win.state.state.def), at: Date.now(), before, text: plan.textOnly });
  });

  // ---- run every task, then let time and the stragglers finish ----
  await s.waitAll();
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(MANAGE_ACK_MS + 1000);
    await s.waitAll();
  }
  await vi.advanceTimersByTimeAsync(1000);
  await s.waitAll();

  // ---- the properties ----
  if (failures.length) throw failures[0];
  const acksToMain = pair.delivered.filter((x) => x.dir === 'toMain' && x.msg.type === 'manageAck');
  for (const r of requests) {
    expect(r.answer, `request ${r.op} never resolved`).toBeDefined();
    const a = r.answer!;
    if (r.n === null) {
      // 1. Not sent: answered at once, locally.
      expect(a.result).toBe('busy');
      tally.busy++;
      continue;
    }
    // 2. Its answer is its own ack's, delivered while it waited — or a timeout.
    const mine = acksToMain.filter((x) => x.msg.n === r.n);
    if (a.result === 'timeout') {
      tally.timeouts++;
      expect(a, 'a timeout carries nothing of the window\'s').toEqual({ result: 'timeout' });
      expect(r.answeredAt! - r.asked, 'timed out early').toBeGreaterThanOrEqual(MANAGE_ACK_MS);
      for (const late of mine) {
        expect(late.at, 'an ack in time was ignored').toBeGreaterThanOrEqual(r.answeredAt!);
        tally.lateAcks++;
      }
      // Acted on by the window and answered after the wait: the case a timeout must not deny.
      if (mine.some((x) => x.msg.result === 'done' || x.msg.result === 'asked')) tally.actedThenTimedOut++;
    } else {
      expect(mine.length, `request ${r.n} resolved "${a.result}" without its own ack`).toBeGreaterThan(0);
      const { type: _t, n: _n, ...fields } = mine[0].msg;
      expect(a, 'the answer is not its own ack').toEqual(fields);
      expect(mine[0].at).toBeLessThanOrEqual(r.answeredAt!);
    }
  }
  // 1, from the wire: between any two manage posts the first was answered or gave up.
  const manages = pair.posted.slice(start).filter((x) => x.msg.type === 'manage');
  for (let i = 1; i < manages.length; i++) {
    const prev = requests.find((r) => r.n === manages[i - 1].msg.n)!;
    expect(prev.answeredAt!, 'a manage posted while another was in flight').toBeLessThanOrEqual(manages[i].at);
  }

  // 4. Gated: nothing before its answer, and only on yes.
  const stillThere = Win.schedules.listSaved().some((e) => e.name === 'Doors A');
  const printed = W.printed() - printedBefore;
  const deletes = answers.filter((x) => x.kind === 'delete');
  const prints = answers.filter((x) => x.kind === 'print');
  if (answers.length) { if (plan.yes) tally.gatedYes++; else tally.gatedNo++; }
  // Each delete was asked about a setup that was still there; it is gone only after a yes.
  for (const d of deletes) expect(d.entryBefore, 'deleted before the answer').toBe(true);
  for (const x of answers) expect(x.savedSame, `the saved list changed while "${x.kind}" was being asked`).toBe(true);
  for (const d of deletes) expect(d.entryAfter, 'the saved setup: gone exactly when its delete was answered yes').toBe(!plan.yes);
  // With no delete answered yes, it is still there at the end (a later save may bring a deleted one back).
  if (!(plan.yes && deletes.length)) expect(stillThere, 'a saved setup went without a yes').toBe(true);
  // The print dialog opened once per yes, never before its own answer.
  prints.forEach((x, i) => expect(x.printedBefore, 'printed before the answer').toBe(plan.yes ? i : 0));
  expect(printed, 'printed without a yes').toBe(plan.yes ? prints.length : 0);
  expect(dialog.open, 'a dialog left open').toBe(false);

  // 5. The define and the user's edit, in arrival order, each its own step.
  if (plan.define && plan.userEdit && arrivals.length === 2) {
    tally.races++;
    if (plan.textOnly) tally.textRaces++;
    const [first, second] = arrivals;
    expect(JSON.stringify(Win.state.state.def), 'the later arrival is not on screen').toBe(second.json);
    Win.state.state.overlay = null;
    const undoBtn = new FakeEl('button', { act: 'undo' }, W.pane('output-pane'));
    W.dispatch(undoBtn, 'click', {});
    const back = JSON.stringify(Win.state.state.def);
    // Text-only and within 700 ms of each other, in either order, too: a `define` is never
    // joined to the user's typing (found by this check, 2026-11-08; `history.ts` `alone`).
    if (plan.textOnly && second.at - first.at < 700) tally.closeTextRaces++;
    expect(back, 'the later arrival is not its own undo step').toBe(first.json);
  }
  // …and the main window ends holding what the window shows.
  await vi.advanceTimersByTimeAsync(1000);
  await s.waitAll();
  // (The main window reads what arrives through `parseScheduleDef`, which normalises it.)
  expect(JSON.stringify(openSchedule()?.def), 'the main window\'s `current` is not the window\'s schedule')
    .toBe(JSON.stringify(parseScheduleDef(structuredClone(Win.state.state.def))));

  // 6.
  expect(rejections, 'an unhandled rejection').toEqual([]);
}

describe('the Schedules port under every message order (fc.scheduler)', () => {
  it(`seed ${SEED}: ${RUNS} interleavings hold all six properties`, async () => {
    process.stderr.write(`[port order] seed ${SEED} (replay: SIM_SEED=${SEED})\n`);
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler({ act: async (f) => { await f(); for (let i = 0; i < 8; i++) await Promise.resolve(); } }),
        fc.record({
          first: fc.constantFrom(...OPS),
          second: fc.option(fc.constantFrom(...OPS), { nil: null }),
          yes: fc.boolean(),
          define: fc.boolean(),
          userEdit: fc.boolean(),
          textOnly: fc.boolean(),
        }),
        async (s, plan) => { await runOne(s, plan); },
      ),
      { seed: SEED, numRuns: RUNS },
    );
    process.stderr.write(`[port order] ${JSON.stringify(tally)}\n`);
    // Every branch the properties are about was reached.
    expect(tally.dropped).toBeGreaterThan(0);
    expect(tally.timeouts).toBeGreaterThan(0);
    expect(tally.lateAcks).toBeGreaterThan(0);
    expect(tally.busy).toBeGreaterThan(0);
    expect(tally.gatedYes).toBeGreaterThan(0);
    expect(tally.gatedNo).toBeGreaterThan(0);
    expect(tally.races).toBeGreaterThan(0);
    // `closeTextRaces` (text-only, under 700 ms apart) is logged, not required: some seeds draw
    // none, and the two tests below hold that race in both orders on every run.
    expect(tally.actedThenTimedOut).toBeGreaterThan(0);
  }, 240_000);

  /** Deliveries held until a test releases them, in order, one direction at a time. */
  const held = () => {
    const q: Record<'toWin' | 'toMain', (() => void)[]> = { toWin: [], toMain: [] };
    return { q, deliver: (dir: 'toWin' | 'toMain', go: () => void) => { q[dir].push(go); }, next: (dir: 'toWin' | 'toMain') => q[dir].shift()!() };
  };

  // Found by the property above (2026-11-08): `history.ts` joins two text-only changes under
  // 700 ms apart into one undo step — the rule for typing — and `define` recorded through the
  // same `update`, so an assistant's change that only re-heads a column, landing within 700 ms
  // of the user typing a heading, was folded into the user's step. A define is its own step.
  it('a text-only define within 700 ms of the user\'s typing is its own undo step', async () => {
    const h = held();
    const pair = await setUp(h.deliver);
    pair.scheduled();
    const base = structuredClone(openSchedule()!.def);
    Win.state.updateDef((d) => act.setHeading(d, 0, 'Typed'));
    const typed = JSON.stringify(Win.state.state.def);
    expect(undoDepth()).toBe(4);
    vi.advanceTimersByTime(100);
    defineSchedule(act.setHeading(base, 1, 'From Vee'), 'edited', 1);
    h.next('toWin');
    expect(Win.state.state.def.columns[1].heading).toBe('From Vee');
    expect(undoDepth(), 'the define is a step of its own').toBe(5);
    W.dispatch(new FakeEl('button', { act: 'undo' }, W.pane('output-pane')), 'click', {});
    expect(JSON.stringify(Win.state.state.def), 'undo lands on the state the user typed').toBe(typed);
  });

  it('the user\'s typing within 700 ms after a text-only define is its own undo step', async () => {
    const h = held();
    const pair = await setUp(h.deliver);
    pair.scheduled();
    defineSchedule(act.setHeading(structuredClone(openSchedule()!.def), 1, 'From Vee'), 'edited', 1);
    h.next('toWin');
    const defined = JSON.stringify(Win.state.state.def);
    expect(undoDepth()).toBe(4);
    vi.advanceTimersByTime(100);
    Win.state.updateDef((d) => act.setHeading(d, 0, 'Typed'));
    expect(undoDepth(), 'the typing is a step of its own').toBe(5);
    W.dispatch(new FakeEl('button', { act: 'undo' }, W.pane('output-pane')), 'click', {});
    expect(JSON.stringify(Win.state.state.def), 'undo lands on the assistant\'s schedule').toBe(defined);
  });

  // Found by the property above (2026-11-08): `messages.ts` sets the window's freshness (2 s)
  // under the asker's wait (3 s), but nothing bounds how long the answer takes to come back. A
  // request the window receives at 2 s, acts on and answers, whose answer then waits more than
  // 1 s (the main renderer busy), times out although the window DID act — here, an undo. The
  // assistant was told "most likely nothing was done", and a retry would undo twice. It is now
  // told the outcome is not known, to read the state first, and that asking again could repeat it.
  it('a request acted on at 2 s whose answer comes back after 1 s more is reported as not known, never as not done', async () => {
    const h = held();
    const pair = await setUp(h.deliver);
    pair.scheduled();
    let answer: ManageAnswer | undefined;
    void requestManage('undo', { ask: true }, MANAGE_ACK_MS).then((a) => { answer = a; });
    vi.advanceTimersByTime(MANAGE_FRESH_MS);
    h.next('toWin');
    expect(undoDepth(), 'the window undid one step').toBe(2);
    vi.advanceTimersByTime(MANAGE_ACK_MS - MANAGE_FRESH_MS);
    await Promise.resolve();
    expect(answer).toEqual({ result: 'timeout' });
    while (h.q.toMain.length) h.next('toMain');
    await Promise.resolve();
    expect(answer, 'the late answer is dropped').toEqual({ result: 'timeout' });
    expect(undoDepth(), 'the undo happened').toBe(2);
    // …and what the assistant is told for a timeout says exactly that it may have been done.
    expect(MANAGE_TIMEOUT_MESSAGE).toMatch(/whether this was done is not known — it may have been\./);
    expect(MANAGE_TIMEOUT_MESSAGE).toMatch(/before asking again: asking again could do it twice\.$/);
    expect(MANAGE_TIMEOUT_MESSAGE).not.toMatch(/nothing was done|not done/i);
  });
});
