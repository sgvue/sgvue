/**
 * Dev utility — NOT application code. What a turn cost, from the tokens the API reported.
 *
 * Four counters, four rates. `src/renderer/ai/bridge.ts` keeps them apart for exactly this
 * reason — a turn that reads 9 190 cached tokens and writes none costs a tenth of one that
 * writes them — and a single "tokens" number cannot price either.
 *
 * Rates are **list prices per million tokens** and live in one table, keyed by the model id
 * the request actually carried. A model with no entry prices at `null` rather than at a
 * neighbour's rate: a wrong number is worse than no number, and `docs/AI_EVAL.md` says so.
 *
 * Pure. `tests/unit/ai-eval-graders.test.ts` is its unit test.
 */

/**
 * $ per million tokens, base input and output. Cache rates are derived below.
 *
 * Source: the `claude-api` skill's model table and migration guide (cached 2026-10-06), read
 * 2026-11-09 — Sonnet 5.5 $2 / $10 (cache reads $0.20, 5-minute writes $2.50, 1-hour $4), the same
 * as Sonnet 5, whose entry here read $3 / $15 until then; Haiku 5.5 $0.10 / $0.50 for a prompt of
 * 100 000 tokens or fewer and $0.50 / $2.50 above (`long`), its cache rates the same multiples.
 */
const PRICES = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, long: { above: 100_000, in: 0.5, out: 2.5 } },
  'claude-haiku-4-5': { in: 1, out: 5 }
}

/** A cache **read** is a tenth of base input on every current model. */
const CACHE_READ_MULTIPLIER = 0.1
/** A cache **write** is 1.25× base input at the five-minute TTL, 2× at the one-hour TTL. */
const CACHE_WRITE_MULTIPLIER = { fiveMinute: 1.25, oneHour: 2 }

/**
 * The rate card for one model, or null when the table has no entry for it. A model with two cards
 * (`long`) takes the long one when a request's prompt — `promptTokens`, input plus cache read
 * plus cache write — is over its threshold.
 */
function ratesFor(model, cacheOneHour, promptTokens = 0) {
  const card = PRICES[String(model)]
  if (!card) return null
  const base = card.long && promptTokens > card.long.above ? card.long : card
  return {
    in: base.in,
    out: base.out,
    cacheRead: base.in * CACHE_READ_MULTIPLIER,
    cacheWrite: base.in * (cacheOneHour ? CACHE_WRITE_MULTIPLIER.oneHour : CACHE_WRITE_MULTIPLIER.fiveMinute),
    ttl: cacheOneHour ? '1h' : '5m'
  }
}

/**
 * Dollars for one turn.
 *
 * @param {{inputTokens:number,outputTokens:number,cacheReadTokens:number,cacheCreateTokens:number}|null} usage
 * @param {string} model  the id the request carried, read from the request snapshot
 * @param {boolean} cacheOneHour  the app's own prompt-cache TTL setting
 * @returns {{usd:number|null, rates:object|null, breakdown:object|null}}
 */
function turnCost(usage, model, cacheOneHour) {
  const n = (v) => (Number.isFinite(v) ? v : 0)
  // A turn's usage is summed over its rounds, so the prompt of one request is taken as the mean
  // per round — an approximation, and it matters only for a model with two cards (Haiku 5.5).
  const prompt = usage
    ? (n(usage.inputTokens) + n(usage.cacheReadTokens) + n(usage.cacheCreateTokens)) / Math.max(1, n(usage.rounds) || 1)
    : 0
  const rates = ratesFor(model, cacheOneHour, prompt)
  if (!usage || !rates) return { usd: null, rates, breakdown: null }
  const breakdown = {
    in: (n(usage.inputTokens) * rates.in) / 1e6,
    out: (n(usage.outputTokens) * rates.out) / 1e6,
    cacheRead: (n(usage.cacheReadTokens) * rates.cacheRead) / 1e6,
    cacheWrite: (n(usage.cacheCreateTokens) * rates.cacheWrite) / 1e6
  }
  const usd = breakdown.in + breakdown.out + breakdown.cacheRead + breakdown.cacheWrite
  return { usd, rates, breakdown }
}

/**
 * Sum a run's rows.
 *
 * `usd` is **null** when no row carried a price at all — the two offline modes make no request,
 * and reporting `$0.0000` for them would be a measurement of nothing dressed as a measurement.
 * `unpriced` counts rows that had tokens but no rate card.
 */
function runCost(rows) {
  let usd = 0
  let priced = 0
  let unpriced = 0
  const tokens = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
  for (const r of rows) {
    const u = r && r.usage
    if (u) {
      tokens.in += u.inputTokens || 0
      tokens.out += u.outputTokens || 0
      tokens.cacheRead += u.cacheReadTokens || 0
      tokens.cacheWrite += u.cacheCreateTokens || 0
    }
    if (typeof r.cost_usd === 'number') {
      usd += r.cost_usd
      priced++
    } else if (u) unpriced++
  }
  return { usd: priced ? usd : null, priced, unpriced, tokens }
}

/**
 * 2026-11-08 — the estimate a live run prints **before** it starts, so the owner sees what a pass
 * will roughly cost before paying for it, and can set it beside what the run then measured.
 *
 * A-priori, one turn is taken as `ROUGH_TURN`: about 2.5 rounds of a ~16 000-token prefix (the
 * tool catalogue, ~55 kB, is ~13 700 tokens; the prompt and the cached schema block ~2 000 more)
 * plus the turn's own messages, and about 1 200 tokens written. That is a guess — `docs/AI_EVAL.md`
 * says a token guess is routinely out by 3–10× — so it is priced at the **list input rate with
 * no cache discount**, a deliberately high figure, and replaced by a measured one as soon as one
 * exists: `measuredTurn` reads the mean per turn off every priced row a live run has written.
 */
const ROUGH_TURN = { inTokens: 40_000, outTokens: 1_200 }

/**
 * The mean billed turn of earlier live rows, or null when none was priced. A row of a
 * multi-turn case counts as its `turns` (default 1).
 *
 * @param {{usage?: object, cost_usd?: number, turns?: number}[]} rows
 */
function measuredTurn(rows) {
  let turns = 0
  let usd = 0
  const tokens = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
  for (const r of rows || []) {
    if (!r || typeof r.cost_usd !== 'number' || !r.usage) continue
    const n = Number.isInteger(r.turns) && r.turns > 0 ? r.turns : 1
    turns += n
    usd += r.cost_usd
    tokens.in += r.usage.inputTokens || 0
    tokens.out += r.usage.outputTokens || 0
    tokens.cacheRead += r.usage.cacheReadTokens || 0
    tokens.cacheWrite += r.usage.cacheCreateTokens || 0
  }
  if (!turns) return null
  return {
    turns,
    usd: usd / turns,
    inTokens: (tokens.in + tokens.cacheRead + tokens.cacheWrite) / turns,
    outTokens: tokens.out / turns
  }
}

/**
 * What a run of `plan` should roughly cost.
 *
 * @param {{id: string, runs: number, turns: number}[]} plan  each case, its runs and its user turns
 * @param {string} model
 * @param {{usd: number, inTokens: number, outTokens: number, turns: number} | null} measured  `measuredTurn`'s
 * @returns {{cases: number, runs: number, turns: number, inTokens: number, outTokens: number,
 *            usdList: number|null, usdMeasured: number|null, basis: string}}
 */
function estimateRun(plan, model, measured) {
  const runs = plan.reduce((n, p) => n + p.runs, 0)
  const turns = plan.reduce((n, p) => n + p.runs * p.turns, 0)
  const per = measured || ROUGH_TURN
  const base = PRICES[String(model)]
  const inTokens = Math.round(turns * per.inTokens)
  const outTokens = Math.round(turns * per.outTokens)
  return {
    cases: plan.length,
    runs,
    turns,
    inTokens,
    outTokens,
    // Every input token at the list input rate: no cache read, no cache write.
    usdList: base ? (inTokens * base.in + outTokens * base.out) / 1e6 : null,
    usdMeasured: measured ? turns * measured.usd : null,
    basis: measured ? `measured: the mean of ${measured.turns} billed turn(s) already in this flow` : 'a-priori: ROUGH_TURN in scripts/eval/cost.cjs'
  }
}

/**
 * 2026-11-09 — how fast a model answered, per model served: the median and the 90th percentile
 * (nearest rank) of a case's wall time, `latency_s`, and seconds a user turn — the sum of those
 * times over the sum of the cases' turns. A row with no `latency_s` is left out; a row with no
 * `model` counts under `unknown`. Times are rounded to 0.01 s.
 *
 * @param {{model?: string, latency_s?: number, turns?: number}[]} rows
 * @returns {Record<string, {cases: number, turns: number, median_s: number, p90_s: number, s_per_turn: number}>}
 */
function latencySummary(rows) {
  const by = new Map()
  for (const r of rows || []) {
    if (!r || typeof r.latency_s !== 'number' || !Number.isFinite(r.latency_s)) continue
    const key = typeof r.model === 'string' && r.model ? r.model : 'unknown'
    const acc = by.get(key) || { times: [], turns: 0 }
    acc.times.push(r.latency_s)
    acc.turns += Number.isInteger(r.turns) && r.turns > 0 ? r.turns : 1
    by.set(key, acc)
  }
  const round = (v) => Math.round(v * 100) / 100
  const rank = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]
  const out = {}
  for (const [model, { times, turns }] of by) {
    const sorted = [...times].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    out[model] = {
      cases: sorted.length,
      turns,
      median_s: round(median),
      p90_s: round(rank(sorted, 0.9)),
      s_per_turn: round(sorted.reduce((a, b) => a + b, 0) / turns)
    }
  }
  return out
}

/** `$0.0123`, or `—` when nothing could be priced. */
const money = (usd) => (typeof usd === 'number' ? `$${usd.toFixed(4)}` : '—')

module.exports = {
  PRICES,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  ratesFor,
  turnCost,
  runCost,
  money,
  ROUGH_TURN,
  measuredTurn,
  estimateRun,
  latencySummary
}
