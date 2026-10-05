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

/** $ per million tokens, base input and output. Cache rates are derived below. */
const PRICES = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 }
}

/** A cache **read** is a tenth of base input on every current model. */
const CACHE_READ_MULTIPLIER = 0.1
/** A cache **write** is 1.25× base input at the five-minute TTL, 2× at the one-hour TTL. */
const CACHE_WRITE_MULTIPLIER = { fiveMinute: 1.25, oneHour: 2 }

/** The rate card for one model, or null when the table has no entry for it. */
function ratesFor(model, cacheOneHour) {
  const base = PRICES[String(model)]
  if (!base) return null
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
  const rates = ratesFor(model, cacheOneHour)
  if (!usage || !rates) return { usd: null, rates, breakdown: null }
  const n = (v) => (Number.isFinite(v) ? v : 0)
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

/** `$0.0123`, or `—` when nothing could be priced. */
const money = (usd) => (typeof usd === 'number' ? `$${usd.toFixed(4)}` : '—')

module.exports = {
  PRICES,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  ratesFor,
  turnCost,
  runCost,
  money
}
