/**
 * Dev utility — NOT application code. Phase 9a's acceptance run.
 *
 *   VITE_SGVUE_DEVTOOLS=1 npm run build
 *   node scripts/safe-run.cjs ai-acceptance.cjs
 *
 * It sends the plan's four acceptance prompts through the **real** gateway, on the design's
 * own mock federation, and reports what the tools actually did:
 *
 *   1. "isolate L2 then hide the windows"  → exactly one `set_filter_stack` with two steps
 *   2. "colour each species"               → a legend with one colour per species
 *   3. "how many trees, by species?"       → a table
 *   4. "rename this wall to W-01"          → refused, and **no tool that mutates**, because
 *                                            none exists
 *   5. a `query_sql` question              → a real table off the model database
 *   6. prompt 1 again, in a fresh turn     → `usage.cache_read_input_tokens > 0`
 *
 * **It never asks for a key and never reads one from disk.** If `ANTHROPIC_API_KEY` is not
 * already in the environment it prints that it is skipped and exits 0 — which is what makes
 * it safe to leave in a checklist. When it does run, it spends real money.
 *
 * WebGL2 only and guarded, like every Electron script here.
 */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ai-acceptance: skipped: no key (ANTHROPIC_API_KEY is not set in the environment)')
  process.exit(0)
}

const { installGuard } = require('./lib/electron-guard.cjs')
const { resolveBackend } = require('./lib/backend.cjs')

const { hash: BACKEND_HASH } = resolveBackend('mock')
const HASH = ['mock', BACKEND_HASH].filter(Boolean).join('&')
const SIZE = [1280, 820]
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Six turns against a real API, each of which may think for a while.
const guard = installGuard({ label: 'ai-acceptance (mock)', maxSeconds: 420 })

app.enableSandbox()

/** One turn, and everything the harness can see about it. */
const TURN = (prompt) => `(async () => {
  const dev = window.__sgvueDev;
  const before = dev.chat.messages().length;
  await dev.chat.send(${JSON.stringify(prompt)});
  const msgs = dev.chat.messages();
  const reply = msgs.slice(before).find((m) => m.role === 'assistant') || null;
  const shell = dev.federation();
  return JSON.stringify({
    reply: reply ? reply.text : null,
    error: dev.chat.error() || null,
    chips: reply && reply.chips ? reply.chips.map((c) => c.label) : [],
    table: reply && reply.table ? { groupBy: reply.table.groupBy, rows: reply.table.rows.slice(0, 6).map((r) => [r.k, r.n]) } : null,
    pending: reply && reply.pending ? reply.pending.label : null,
    tools: dev.chat.log().tools,
    usage: dev.chat.log().usage,
    elements: shell.elements.length
  });
})()`

/** The colour-by legend and the live filter stack, read straight off the store. */
const VIEW = `JSON.stringify({
  scheme: window.__sgvueDev.scheme()
    ? {
        prop: window.__sgvueDev.scheme().prop,
        groups: window.__sgvueDev.scheme().groups.map((g) => [g.v, g.n, g.color])
      }
    : null
})`

const PROMPTS = [
  ['1. two-step filter stack', 'isolate L2 then hide the windows'],
  ['2. colour each species', 'colour each tree species'],
  ['3. table', 'how many trees, by species?'],
  ['4. refusal', 'rename this wall to W-01'],
  ['5. sql', 'using query_sql, how many elements are there per IFC entity? top five.'],
  ['6. cache', 'isolate L2 then hide the windows']
]

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE[0],
    height: SIZE[1],
    useContentSize: true,
    show: true,
    backgroundColor: '#0F1516',
    webPreferences: {
      preload: join(ROOT, 'out/preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })
  win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`))
  await win.loadFile(join(ROOT, 'out/renderer/index.html'), { hash: HASH })
  await wait(3000)

  const js = (code) => win.webContents.executeJavaScript(code)
  if (!(await js('!!window.__sgvueDev'))) {
    console.log('no __sgvueDev — rebuild with VITE_SGVUE_DEVTOOLS=1')
    return app.exit(1)
  }
  guard.sample('loaded')

  let failures = 0
  const check = (label, ok, detail) => {
    console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
    if (!ok) failures++
  }

  for (const [label, prompt] of PROMPTS) {
    console.log(`\n── ${label}\n   > ${prompt}`)
    const started = Date.now()
    let out
    try {
      out = JSON.parse(await js(TURN(prompt)))
    } catch (error) {
      console.log(`   FAIL  the turn threw: ${error && error.message}`)
      failures++
      continue
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`   reply  ${out.error ? `ERROR: ${out.error}` : out.reply}`)
    console.log(
      `   tools  ${out.tools.length ? out.tools.map((t) => `${t.name} ${t.ms}ms${t.ok ? '' : ' (error)'}`).join(', ') : 'none'}  ·  ${seconds}s`
    )
    if (out.usage) {
      console.log(
        `   usage  in ${out.usage.inputTokens}  out ${out.usage.outputTokens}  cache read ${out.usage.cacheReadTokens}  cache write ${out.usage.cacheCreateTokens}`
      )
    }
    if (out.chips.length) console.log(`   chips  ${out.chips.join(' · ')}`)
    if (out.table) console.log(`   table  ${out.table.groupBy}: ${JSON.stringify(out.table.rows)}`)
    if (out.pending) console.log(`   pending  ${out.pending}`)

    const names = out.tools.map((t) => t.name)
    if (label.startsWith('1.') || label.startsWith('6.')) {
      check('exactly one set_filter_stack call', names.filter((n) => n === 'set_filter_stack').length === 1, names.join(','))
      check('no apply_visibility chain', !names.includes('apply_visibility'))
      const visible = await js('window.__sgvueDev.federation().elements.length')
      check('the federation is still loaded', visible === 412, `${visible} elements`)
    }
    if (label.startsWith('2.')) {
      const scheme = JSON.parse(await js(VIEW)).scheme
      console.log(`   legend  ${scheme ? JSON.stringify(scheme.groups) : 'none'}`)
      check('a legend is showing', !!scheme && scheme.groups.length >= 2)
      check('coloured by a species property', !!scheme && /Species/.test(scheme.prop))
    }
    if (label.startsWith('3.')) {
      check('a table came back', !!out.table)
      const rows = out.table ? Object.fromEntries(out.table.rows) : {}
      check('Angsana 8 / Tembusu 8', rows.Angsana === 8 && rows.Tembusu === 8, JSON.stringify(rows))
    }
    if (label.startsWith('4.')) {
      check('refused in words', /cannot|can’t|can't|read-only|review tool/i.test(out.reply || ''))
      check('no tool changed the model', names.every((n) => !/write|edit|rename|delete|update|create/i.test(n)), names.join(',') || 'none')
    }
    if (label.startsWith('5.')) {
      check('query_sql ran', names.includes('query_sql'))
      check('it succeeded', out.tools.filter((t) => t.name === 'query_sql').every((t) => t.ok))
    }
    if (label.startsWith('6.')) {
      check('the identical prefix read the cache', !!out.usage && out.usage.cacheReadTokens > 0, out.usage ? `cache_read_input_tokens = ${out.usage.cacheReadTokens}` : 'no usage')
    }
    // A fresh turn between the two identical prompts is what the cache check needs; the
    // conversation is left standing so the prefix is the same one.
    await wait(500)
  }

  const snapshot = await js('window.__sgvueDev.chat.snapshot()')
  console.log(`\nrequest snapshot  ${snapshot.length} bytes`)
  console.log(`contains a key?   ${/sk-ant-/.test(snapshot) ? 'YES — DEFECT' : 'no'}`)
  if (/sk-ant-/.test(snapshot)) failures++

  guard.sample('done')
  console.log(`\n${failures ? `${failures} check(s) FAILED` : 'all checks passed'}`)
  app.exit(failures ? 1 : 0)
})
