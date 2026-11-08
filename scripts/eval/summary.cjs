/**
 * Dev utility — NOT application code. A live run's `metrics.json`, from its rows.
 *
 * 2026-11-09 (the v4 run, resumed: its `metrics.json` left out 3 of the 141 rows in
 * `results.jsonl`) — the summary is built from **every** row the variant holds, not from the rows
 * this one invocation wrote: `rowsOfRun` reads `results.jsonl` and `errors.jsonl` whole, keeps the
 * last row of each `(case, rep)`, and counts an error only for a `(case, rep)` that has no result
 * — a case that failed once and was scored on a later resume is a result. Pure; unit-tested in
 * `tests/unit/ai-eval-graders.test.ts`.
 */
const { latencySummary, runCost } = require('./cost.cjs')

/** The JSON lines of a file's text; a torn line is not a row. */
function lines(text) {
  const out = []
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      /* a torn line is not a row */
    }
  }
  return out
}

const keyOf = (r) => `${r.prompt_id}\u0000${r.rep}`

/**
 * Every row of a variant: `rows` (scored and truncated), `naRows` and `errorRows`, one per
 * `(case, rep)`, the last written winning.
 *
 * @param {string} resultsText  `results.jsonl`
 * @param {string} errorsText   `errors.jsonl`
 */
function rowsOfRun(resultsText, errorsText) {
  const results = new Map()
  for (const r of lines(resultsText)) results.set(keyOf(r), r)
  const errors = new Map()
  for (const r of lines(errorsText)) if (!results.has(keyOf(r))) errors.set(keyOf(r), r)
  const all = [...results.values()]
  return { rows: all.filter((r) => r.status !== 'na'), naRows: all.filter((r) => r.status === 'na'), errorRows: [...errors.values()] }
}

function summarise(rows, naRows, errorRows) {
  const scored = rows.filter((r) => r.status == null || r.status === 'ok')
  const byGroup = new Map()
  for (const r of scored) {
    const g = r.tags[0]
    const acc = byGroup.get(g) || { n: 0, pass: 0 }
    acc.n++
    acc.pass += r.grade.pass
    byGroup.set(g, acc)
  }
  const cost = runCost(scored)
  /*
   * 2026-11-08 — what each case actually cost, over its runs: the owner's measured cost per
   * case, beside the estimate the run printed before it started (`metrics.json` `estimate`).
   */
  const byCase = {}
  for (const r of scored) {
    const c = (byCase[r.prompt_id] = byCase[r.prompt_id] || { runs: 0, pass: 0, turns: 0, rows: [] })
    c.runs++
    c.pass += r.grade.pass === 1 ? 1 : 0
    c.turns += r.turns || 1
    c.rows.push(r)
  }
  for (const [id, c] of Object.entries(byCase)) {
    const k = runCost(c.rows)
    byCase[id] = { runs: c.runs, pass: c.pass, turns: c.turns, tokens: k.tokens, cost_usd: k.usd == null ? null : Number(k.usd.toFixed(6)) }
  }
  return {
    rows: rows.length + naRows.length,
    scored: scored.length,
    na: naRows.length,
    errors: errorRows.length,
    pass: scored.length ? scored.filter((r) => r.grade.pass === 1).length : 0,
    pass_rate: scored.length ? scored.filter((r) => r.grade.pass === 1).length / scored.length : null,
    no_write_rate: scored.length ? scored.filter((r) => r.grade.no_write === 1).length / scored.length : null,
    by_group: Object.fromEntries([...byGroup].map(([g, v]) => [g, { n: v.n, pass: v.pass }])),
    tokens: cost.tokens,
    cost_usd: cost.usd,
    unpriced: cost.unpriced,
    by_case: byCase,
    // 2026-11-09 — how fast each model answered: median and 90th-percentile case time, seconds a turn.
    latency_by_model: latencySummary(scored)
  }
}

module.exports = { rowsOfRun, summarise }
