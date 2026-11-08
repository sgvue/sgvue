/**
 * Dev utility — NOT application code. The pure half of running one eval case: the ground truth
 * a case's probes produce, the oracle's and the null agent's turns, and the observation the
 * graders read.
 *
 * Moved out of `scripts/ai-eval.cjs` unchanged (2026-11-07, core protection #11) so that two
 * runners share it: the Electron runner, which answers each probe and each call in a real window,
 * and the headless one in `tests/unit/ai-eval-offline.test.ts`, which answers them with the real
 * store, executors and SQL schema under Node — where the graders must score the oracle 100 % and
 * the null agent 0 % on every push. Neither runner knows how the other answers a probe: each
 * hands `collectTruth` its own `sql` and `tool`.
 *
 * Pure. No Electron, no window, no file system.
 */

/** A dot path, `len:<path>` or `max:<path>.<field>` into a tool's `forModel`. */
function pickFrom(result, expr) {
  const dot = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
  if (expr.startsWith('len:')) {
    const v = dot(result, expr.slice(4))
    return Array.isArray(v) ? v.length : null
  }
  if (expr.startsWith('max:')) {
    const rest = expr.slice(4)
    const cut = rest.lastIndexOf('.')
    const list = dot(result, rest.slice(0, cut))
    const field = rest.slice(cut + 1)
    if (!Array.isArray(list) || !list.length) return null
    return Math.max(...list.map((x) => Number(x[field])).filter((n) => Number.isFinite(n)))
  }
  const v = dot(result, expr)
  return v === undefined ? null : v
}

/**
 * Every probe a case declares, run **after** its setup and **before** its turn, so a case with
 * a pre-existing selection or filter is graded against the state it was actually given.
 *
 * @param {object} kase
 * @param {{ sql: (statement: string) => Promise<{rows?: unknown[][]}>, tool: (name: string, input: object) => Promise<unknown> }} ask
 */
async function collectTruth(kase, ask) {
  const truth = {}
  for (const [name, probe] of Object.entries(kase.truth || {})) {
    if (probe.sql) {
      const r = await ask.sql(probe.sql)
      const rows = r.rows || []
      truth[name] =
        probe.shape === 'pairs'
          ? rows.map((row) => [row[0], row[1]])
          : probe.shape === 'column'
            ? rows.map((row) => row[0])
            : probe.shape === 'rows'
              ? rows
              : rows.length
                ? rows[0][0]
                : null
    } else if (probe.tool) {
      const r = await ask.tool(probe.tool, probe.input || {})
      truth[name] = probe.pick ? pickFrom(r, probe.pick) : r
    }
  }
  return truth
}

/** `{key}` in an oracle's reply or tool input, filled from the probes. */
function fillTemplate(value, truth) {
  if (typeof value === 'string') {
    const whole = /^\{([A-Za-z0-9_]+)\}$/.exec(value)
    if (whole) return truth[whole[1]]
    return value.replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (k in truth ? String(truth[k]) : m))
  }
  if (Array.isArray(value)) return value.map((v) => fillTemplate(v, truth))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, truth)]))
  }
  return value
}

/** The oracle's turn: its calls and its reply, each `{key}` filled from the probes. */
function oracleTurn(kase, truth) {
  return {
    calls: (kase.oracle.calls || []).map((c) => ({ name: c.name, input: fillTemplate(c.input || {}, truth) })),
    reply: fillTemplate(kase.oracle.reply || '', truth)
  }
}

/**
 * 2026-11-08 — a case may be a conversation. `turns` lists the user turns **before** the case's
 * own `prompt`, in order, in one conversation — each `{ prompt, oracle, expect?, choice? }` —
 * and the case's `prompt`, `oracle` and `expect` are its last turn, as in every one-turn case,
 * which is unchanged. This is every turn in order, the last one the case itself; `choice` is a
 * quick reply the user clicks before that turn's text is sent (stage 2's IFC+SG Yes / No).
 */
function turnsOf(kase) {
  return [...(kase.turns || []), { prompt: kase.prompt, oracle: kase.oracle, expect: kase.expect, choice: kase.choice }]
}

/** Two turns' `usage` summed, counter by counter; null only when neither was billed. */
function addUsage(a, b) {
  if (!a) return b || null
  if (!b) return a
  const out = { ...a }
  for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreateTokens']) out[k] = (a[k] || 0) + (b[k] || 0)
  return out
}

/**
 * A conversation's last-turn observation with the turns before it: each earlier turn's own
 * observation (its reply, calls and the view after it), the view before the first turn, and
 * the usage of every turn summed — what the conversation cost. The graders read `calls`,
 * `view` and `viewBefore` as the last turn's, as they always have.
 */
function withEarlier(obs, earlier, start) {
  if (!earlier.length) return obs
  // A turn that did not finish — a rate limit, a timeout — is the conversation's outcome, so the
  // runner files it as plumbing rather than scoring the turns after it as a model failure.
  const unfinished = earlier.map((e) => e.outcome).find((o) => o && o.type !== 'done')
  return {
    ...obs,
    outcome: unfinished || obs.outcome,
    earlier,
    viewStart: start.view,
    storeStart: start.store,
    usageLast: obs.usage,
    usage: [...earlier.map((e) => e.usage), obs.usage].reduce(addUsage, null)
  }
}

/** The null agent's turn: nothing called, nothing said. */
function nullTurn() {
  return { reply: '', calls: [], outcome: { type: 'done', rounds: 0 }, usage: null, model: null, index: -1 }
}

/**
 * The calls of a scripted turn as the graders read them: each harness result beside the input
 * it was given.
 *
 * @param {{name: string, input?: object}[]} calls  what was sent
 * @param {{name: string, ok: boolean, ms: number, forModel?: unknown, error?: string}[]} results  what came back
 */
function scriptedCalls(calls, results) {
  return results.map((r, i) => ({
    name: r.name,
    input: calls[i] ? calls[i].input : {},
    ok: r.ok,
    ms: r.ms,
    result: r.forModel,
    error: r.error
  }))
}

/**
 * What the graders read about one case: the turn, the view before and after it, and the panel's
 * half of the committed message (its table, its pending row, its chips).
 *
 * @param {{reply: string, calls: object[], outcome: object, usage: unknown}} turn
 * @param {{view: object, store: object}} before  the view as read before the turn
 * @param {{view: object, store: object}} after   the view as read after it
 * @param {object | null} message                 the committed assistant message, or null
 */
function observation(turn, before, after, message) {
  const store = {
    ...after.store,
    table: message ? message.table || null : null,
    pending: message ? message.pending || null : null,
    chips: message && message.chips ? message.chips.map((c) => ({ label: c.label, n: c.ids.length })) : [],
    /**
     * 2026-11-08 — stage 2's heads-up line, as the committed reply carries it: the one
     * app-computed observation the reply shows (`{ kind, n, … }`), or null for none
     * (`prototypes/vee-messages/full/HANDOFF.md` §2). A build before stage 2 has none.
     */
    headsUp: message && message.headsUp ? message.headsUp : null
  }
  return {
    reply: turn.reply,
    calls: turn.calls,
    outcome: turn.outcome,
    usage: turn.usage,
    view: after.view,
    viewBefore: before.view,
    store,
    storeBefore: before.store
  }
}

module.exports = { addUsage, collectTruth, fillTemplate, nullTurn, observation, oracleTurn, pickFrom, scriptedCalls, turnsOf, withEarlier }
