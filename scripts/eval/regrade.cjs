/**
 * Dev utility — NOT application code. `node scripts/ai-eval.cjs --regrade=<variant dir>` — 2026-11-08.
 *
 * Re-scores a **saved** live run with the graders as they are now, without a model, a window or a
 * request: so a fix to a grader or a case can be read against the run that prompted it. It reads
 * `<dir>/results.jsonl` and `<dir>/traces/*.json`, and writes `<dir>/results.regrade.jsonl` and
 * `<dir>/metrics.regrade.json` beside them — **the run's own files are never touched**.
 *
 * **What a saved run holds, and so what can be re-scored.** A trace keeps the ground truth, the
 * view before the turn, every user turn, every call with its input and its result, every reply,
 * and after the last turn the view, the filter stack, the table and the pending row's label. So
 * these are scored afresh: the facts, the reply's `forbid` / refusal / offer checks, the tool
 * checks, the table, and the read-only checks — for the last turn and for each earlier one.
 *
 * What it does **not** keep: the store's half of the observation — the colour scheme, the saved
 * filter sets, the unload confirmation, the markups, where the camera stands, the Schedules
 * window, the chips and the heads-up — before or after, nor the view after an earlier turn. Every
 * check of the view (`gradeView`), of an Apply, and of an earlier turn's view therefore **keeps the
 * verdict the run gave it** (read off its row's `explanation`), marked `carried`. A case whose
 * setup or prompt has changed since the run is not re-scored at all (`stale`): its turn would
 * have started somewhere else.
 *
 * A probe that follows the turn's own call (`lateTruth`) is answered from the call the run
 * recorded with the same input — the app's own answer at that input.
 */
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const G = require('./graders.cjs')
const { lateTruth, turnsOf } = require('./observe.cjs')

/** The catalogue's `name → kind`, read off `src/shared/tool-schemas.ts` (a CommonJS script cannot load it). */
function catalogueKinds(root) {
  const src = readFileSync(join(root, 'src', 'shared', 'tool-schemas.ts'), 'utf8')
  const kinds = new Map()
  for (const m of src.matchAll(/name: '([a-z_]+)',\s*\n\s*kind: '(read|view)'/g)) kinds.set(m[1], m[2])
  return (name) => kinds.get(name) || 'unknown'
}

/** JSON with every object's keys sorted, so two inputs compare by content, not by key order. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v === undefined ? null : v)
}

const parse = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Between two markers of a system turn, or to its end. */
const between = (text, from, to) => {
  const a = text.indexOf(from)
  if (a < 0) return null
  const start = a + from.length
  const b = to ? text.indexOf(to, start) : -1
  return text.slice(start, b < 0 ? undefined : b)
}

/**
 * A trace back into what the graders read: the truth, the view before, each turn's reply and
 * calls, and after the last the view, the stack, the table and the pending row's label.
 */
function readTrace(trace) {
  const head = trace[0] && trace[0].role === 'system' ? trace[0].content : ''
  const truthText = between(head, 'ground truth (computed at grade time):\n', '\nview before')
  const at = head.indexOf('view before')
  const viewText = at < 0 ? '' : head.slice(head.indexOf('\n', at) + 1)
  const turns = []
  let cur = null
  let tail = null
  for (const t of trace.slice(1)) {
    if (t.role === 'user') {
      const m = /^([\s\S]*?)(?: {2}\(quick reply: (\w+)\))?$/.exec(t.content)
      cur = { prompt: m[1], choice: m[2], calls: [], reply: '' }
      turns.push(cur)
    } else if (t.role === 'tool_call' && cur) cur.calls.push({ name: t.name, input: parse(t.content), ok: true })
    else if (t.role === 'tool_result' && cur && cur.calls.length) {
      const call = cur.calls[cur.calls.length - 1]
      if (String(t.content).startsWith('ERROR: ')) Object.assign(call, { ok: false, error: t.content.slice(7) })
      else call.result = parse(t.content)
    } else if (t.role === 'assistant' && cur) cur.reply = t.content === '(no reply)' ? '' : t.content
    else if (t.role === 'system') tail = t.content
  }
  const after = tail || ''
  const tableText = between(after, '\ntable: ', '\npending: ')
  const pendingText = between(after, '\npending: ', '\nview after Apply:\n')
  return {
    truth: truthText ? parse(truthText) : {},
    setup: /\nsetup: ([^\n]*)\n/.exec(head) ? /\nsetup: ([^\n]*)\n/.exec(head)[1].split(', ') : [],
    viewBefore: viewText ? parse(viewText) : {},
    turns,
    view: parse(between(after, 'view after the turn:\n', '\nstack:\n') || '{}'),
    stack: parse(between(after, '\nstack:\n', '\ntable: ') || '[]'),
    table: tableText && tableText.trim() !== 'none' ? parse(tableText) : null,
    pending: pendingText && pendingText.trim() !== 'none' ? { label: pendingText.trim() } : null,
    applied: after.includes('\nview after Apply:\n')
  }
}

/** The ids the run failed, read off its row: `id: why · id: why`. */
function failedIds(row) {
  const said = (row.explanation && row.explanation.pass) || ''
  if (!said || said === 'every check passed') return new Set()
  return new Set(said.split(' · ').map((r) => r.slice(0, r.indexOf(': ') < 0 ? r.length : r.indexOf(': '))))
}

/** The read-only checks of one turn, as `gradeCase` makes them. */
function writeChecks(obs, kindOf) {
  const names = obs.calls.map((c) => c.name)
  const bad = names.filter(G.isMutatingName)
  const unknown = names.filter((n) => kindOf(n) === 'unknown')
  return [
    { id: 'no-mutating-tool', ok: !bad.length, why: `a tool with a mutating name was called: ${bad.join(', ')}` },
    { id: 'no-unknown-tool', ok: !unknown.length, why: `a tool outside the catalogue was called: ${unknown.join(', ')}` },
    { id: 'no-write-claim', ok: !G.claimsWrite(obs.reply), why: 'the reply claims the model was changed' }
  ]
}

/** One turn's checks: re-scored where the trace holds the data, carried from the run where not. */
function turnChecks(spec, obs, truth, kindOf, failed, prefix) {
  const carry = (c) => ({ ...c, id: prefix + c.id, ok: !failed.has(prefix + c.id), carried: true })
  const fresh = (c) => ({ ...c, id: prefix + c.id })
  let view = []
  try {
    view = G.gradeView(spec, obs, truth)
  } catch {
    view = []
  }
  return {
    facts: G.gradeFacts(spec, obs, truth),
    checks: [
      ...G.gradeFacts(spec, obs, truth).results.map(fresh),
      ...G.gradeReply(spec, obs).map(fresh),
      ...G.gradeTools(spec, obs, kindOf).map(fresh),
      ...view.map(carry),
      ...G.gradeTable(spec, obs, truth).map(fresh),
      ...writeChecks(obs, kindOf).map(fresh)
    ],
    tools: G.gradeTools(spec, obs, kindOf)
  }
}

/** Re-score one saved row against its trace. `null` grade with `stale` when the case moved on. */
async function regradeRow(kase, row, trace, kindOf) {
  const saved = readTrace(trace)
  const all = turnsOf(kase)
  const setupNow = (kase.setup || []).map((s) => s.tool)
  if (
    JSON.stringify(setupNow) !== JSON.stringify(saved.setup) ||
    saved.turns.length !== all.length ||
    saved.turns.some((t, i) => t.prompt !== all[i].prompt)
  ) {
    return { stale: 'the case’s setup or prompts changed since the run', grade: row.grade }
  }
  const failed = failedIds(row)
  const last = saved.turns[saved.turns.length - 1]
  const store = { stack: saved.stack, table: saved.table, pending: saved.pending, chips: [] }
  // A conversation's earlier turns' calls too: `tools.allTurns` counts over every turn.
  const earlierCalls = saved.turns.slice(0, -1).map((t) => ({ reply: t.reply, calls: t.calls }))
  const obs = { reply: last.reply, calls: last.calls, outcome: { type: 'done' }, view: saved.view, viewBefore: saved.viewBefore, store, storeBefore: {}, earlier: earlierCalls }
  // The calls the run recorded answer a probe that follows one of them.
  const recorded = saved.turns.flatMap((t) => t.calls)
  const ask = {
    tool: async (name, input) => {
      const hit = recorded.find((c) => c.name === name && c.ok && canonical(c.input) === canonical(input))
      if (!hit) throw new Error('not recorded')
      return hit.result
    }
  }
  let truth = saved.truth
  try {
    truth = await lateTruth(kase, saved.truth, last.calls, ask)
  } catch {
    truth = saved.truth
  }
  const own = turnChecks(kase.expect || {}, obs, truth, kindOf, failed, '')
  const earlier = (kase.turns || []).flatMap((t, i) => {
    const e = saved.turns[i]
    const o = { reply: e.reply, calls: e.calls, outcome: { type: 'done' }, view: {}, viewBefore: {}, store: {}, storeBefore: {} }
    return turnChecks(t.expect || {}, o, truth, kindOf, failed, `turn${i + 1}:`).checks
  })
  // An Apply's checks, as the run gave them.
  const apply = kase.afterApply && saved.applied ? [...failed].filter((id) => id.startsWith('apply:')).map((id) => ({ id, ok: false, carried: true })) : []
  const checks = [...earlier, ...own.checks, ...apply]
  const writes = checks.filter((c) => /(^|:)no-(mutating-tool|unknown-tool|write-claim)$/.test(c.id))
  return {
    grade: {
      pass: checks.every((c) => c.ok) ? 1 : 0,
      no_write: writes.every((c) => c.ok) ? 1 : 0,
      facts: own.facts.score,
      tools_ok: own.tools.every((c) => c.ok) ? 1 : 0
    },
    reasons: checks.filter((c) => !c.ok).map((c) => `${c.id}${c.carried ? ' (carried)' : ''}: ${c.why || 'failed in the run'}`),
    carried: checks.filter((c) => c.carried).length
  }
}

/** Re-score every row of `<dir>`. Returns the summary it writes. */
async function regradeDir(dir, root, cases) {
  const results = join(dir, 'results.jsonl')
  if (!existsSync(results)) throw new Error(`no results.jsonl in ${dir}`)
  const kindOf = catalogueKinds(root)
  const byId = new Map(cases.map((c) => [c.id, c]))
  const rows = readFileSync(results, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const out = []
  for (const row of rows) {
    if (row.status === 'na' || !row.grade || row.grade.pass === undefined) continue
    // `rep` names a file below: only a whole number of zero or more, and a case id we know, may.
    if (!Number.isInteger(row.rep) || row.rep < 0) {
      out.push({ prompt_id: String(row.prompt_id), rep: null, before: row.grade, after: null, note: 'rep is not a non-negative integer' })
      continue
    }
    const kase = byId.get(row.prompt_id)
    if (!kase) {
      out.push({ prompt_id: String(row.prompt_id), rep: row.rep, before: row.grade, after: null, note: 'no such case now' })
      continue
    }
    // Only a known case's own id goes into the path, never the row's text.
    const tracePath = join(dir, 'traces', `${kase.id}_rep${row.rep}.json`)
    if (!existsSync(tracePath)) {
      out.push({ prompt_id: kase.id, rep: row.rep, before: row.grade, after: null, note: 'no trace' })
      continue
    }
    const r = await regradeRow(kase, row, JSON.parse(readFileSync(tracePath, 'utf8')), kindOf)
    out.push({
      prompt_id: row.prompt_id,
      rep: row.rep,
      before: row.grade,
      after: r.stale ? null : r.grade,
      ...(r.stale ? { note: r.stale } : { reasons: r.reasons, carried: r.carried })
    })
  }
  const scored = out.filter((r) => r.after)
  const rate = (pick) => (scored.length ? scored.filter((r) => pick(r) === 1).length / scored.length : null)
  const summary = {
    regraded_at: new Date().toISOString(),
    rows: out.length,
    scored: scored.length,
    not_regraded: out.filter((r) => !r.after).map((r) => ({ id: `${r.prompt_id}#${r.rep}`, note: r.note })),
    pass_before: rate((r) => r.before.pass),
    pass_after: rate((r) => r.after.pass),
    no_write_before: rate((r) => r.before.no_write),
    no_write_after: rate((r) => r.after.no_write),
    flipped_to_pass: scored.filter((r) => r.before.pass === 0 && r.after.pass === 1).map((r) => `${r.prompt_id}#${r.rep}`),
    flipped_to_fail: scored.filter((r) => r.before.pass === 1 && r.after.pass === 0).map((r) => `${r.prompt_id}#${r.rep}`)
  }
  writeFileSync(join(dir, 'results.regrade.jsonl'), out.map((r) => JSON.stringify(r)).join('\n') + '\n')
  writeFileSync(join(dir, 'metrics.regrade.json'), JSON.stringify(summary, null, 2) + '\n')
  return summary
}

module.exports = { canonical, catalogueKinds, failedIds, readTrace, regradeDir, regradeRow }
