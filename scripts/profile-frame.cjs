/**
 * Dev utility — NOT application code. **A measurement tool. It changes nothing.**
 *
 * Where does a frame's time go, and what else feels slow?
 *
 *   npm run build  (with VITE_SGVUE_DEVTOOLS=1)
 *   SGVUE_IFC="samples/Sample Ifc Model.ifc" node scripts/safe-run.cjs profile-frame.cjs
 *
 * `scripts/bench.cjs` already reports fps while orbiting, which answers *whether* the viewer
 * is slow but not *why*: one number cannot separate a frame the CPU spent 24 ms building from
 * a frame the GPU spent 24 ms drawing, and it cannot say which of the dozen things a frame
 * does is the one that costs. This does three things bench does not.
 *
 * **1. It times the JS inside the frame callback, not just the interval between frames.**
 * `window.requestAnimationFrame` is wrapped in the page so every callback Chromium runs for a
 * given animation-frame timestamp is timed and the total attributed to that frame. The viewer's
 * own `frame()` (`viewer/viewer-core.ts`) is one of them. So each frame yields a pair:
 *
 *   * `interval` — timestamp to timestamp, i.e. what the user actually sees;
 *   * `js`       — main-thread time inside the callbacks, i.e. what the CPU spent.
 *
 * `interval − js` is time the main thread was *not* running: vsync wait, compositing, and the
 * GPU. A frame where `js ≈ interval` is CPU-bound; one where `js ≪ interval` is GPU-bound or
 * simply capped by the display. That is the whole CPU/GPU split, and it needs no profiler
 * attach and no instrumentation inside `src/`.
 *
 * **2. It turns one thing off at a time.** Each condition below is applied, measured over a
 * fixed orbit, then undone, so the rows are comparable and the difference between two rows is
 * one feature's cost. Most of them are reached through the viewer's *public* API. The rest —
 * hide the edge lines, hide the glass family, stop drawing the view cube, stop the per-frame
 * label occlusion test, drop the pixel ratio — have no public control and must not gain one
 * (no designed surface has a control for them), so they are reached through `viewer.dev`,
 * the dev-only handle on the renderer's own modules. It exists only in a build made with
 * `VITE_SGVUE_DEVTOOLS=1`, exactly as `window.__sgvueDev` does.
 *
 * **3. It measures the things that are not a frame**: click-to-painted latency for the
 * designed interactions, and a census of what was actually uploaded to the GPU.
 *
 * Phases, one process each (`SGVUE_PHASE`):
 *   `frames`   — the conditions table (default)
 *   `latency`  — click-to-painted, the crossfade, and the geometry census
 *   `landing`  — the landing page with no model: idle, and while the pointer moves
 *
 * Other knobs: `SGVUE_W` / `SGVUE_H` (window content size, default 1512 × 982),
 * `SGVUE_SECONDS` (orbit per condition, default 4), `SGVUE_AA=0` (launch with `#aa=0`),
 * `SGVUE_ONLY=1,4,11` (run only those conditions).
 *
 * **WebGL2 only**, through `scripts/lib/backend.cjs`, and the whole run is inside the memory
 * guard. Start it only through `node scripts/safe-run.cjs`.
 */
const { app, BrowserWindow, protocol, net } = require('electron')
const { join, resolve, basename } = require('node:path')
const { pathToFileURL } = require('node:url')
const { installGuard } = require('./lib/electron-guard.cjs')
const { resolveBackend } = require('./lib/backend.cjs')

const ROOT = join(__dirname, '..')
const MOCK = process.env.SGVUE_IFC === 'mock'
const MODEL = MOCK ? 'mock federation' : resolve(ROOT, process.env.SGVUE_IFC || 'samples/Sample Ifc Model.ifc')
const PHASE = process.env.SGVUE_PHASE || 'frames'
const W = Number(process.env.SGVUE_W || 1512)
const H = Number(process.env.SGVUE_H || 982)
const SECONDS = Number(process.env.SGVUE_SECONDS || 4)
const ONLY = (process.env.SGVUE_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean)
/**
 * Turn the per-frame label occlusion test off once, before any condition runs, and leave it
 * off. It is the dominant cost on a real model (measured: a ~130 ms stall on one frame in
 * four), and while it is in the way every other row's *median* is an artifact — after a
 * 130 ms pause the GPU has caught up, so the next three frames return at the vsync floor
 * whatever else is switched on. With it out of the way each feature's own cost is visible.
 */
const NO_OCC = process.env.SGVUE_NOOCC === '1'
/**
 * An explicit sequence, repeats allowed: `SGVUE_ORDER=9a,3,9a,4,9a`. The machine is not a
 * fixed instrument — the first condition after a 22 s load measures a GPU that is still
 * settling, and the run drifts by a couple of milliseconds either way over a minute. Putting
 * the baseline back between every measured row is what makes two rows subtractable.
 */
const ORDER = (process.env.SGVUE_ORDER || '').split(',').map((s) => s.trim()).filter(Boolean)

const base = MOCK ? 'mock' : ''
const { backend: BACKEND, hash: BASE_HASH } = resolveBackend(base)
const HASH = process.env.SGVUE_AA === '0' ? (BASE_HASH ? `${BASE_HASH}&aa=0` : 'aa=0') : BASE_HASH

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const num = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—')

/* ────────────────────────────── the in-page harness ──────────────────────────────
 * One string, evaluated once in the renderer. It owns the rAF wrapper, the sampling
 * window, the synthetic pointer loop and the "wait for the next painted frame" helper.
 * Everything it reports is plain JSON. */
const HARNESS = String.raw`
(() => {
  if (window.__prof) return 'already'
  const raf0 = window.requestAnimationFrame.bind(window)
  let recs = null
  // Chromium hands every callback registered for one animation frame the SAME timestamp, so
  // grouping on it gives per-frame totals across the viewer's frame(), the orbit stepper and
  // anything else that asked for a frame.
  window.requestAnimationFrame = (cb) =>
    raf0((t) => {
      if (!recs) return cb(t)
      let cur = recs.length ? recs[recs.length - 1] : null
      if (!cur || cur.t !== t) recs.push((cur = { t, js: 0 }))
      const a = performance.now()
      try { cb(t) } finally { cur.js += performance.now() - a }
    })

  const canvas = () => document.querySelector('[data-role="viewport"]')
  let hoverRaf = 0

  window.__prof = {
    start() { recs = [] },
    stop() {
      const out = recs || []
      recs = null
      // Drop the first two: the first has no interval, and the second still carries the cost
      // of whatever set the condition up.
      const rows = out.slice(2)
      const intervals = []
      const js = []
      for (let i = 1; i < rows.length; i++) {
        intervals.push(rows[i].t - rows[i - 1].t)
        js.push(rows[i].js)
      }
      return { n: intervals.length, intervals, js }
    },

    /** The renderer's own counters for the frame that was just drawn. */
    info() {
      const d = window.__sgvueDev.viewer.dev
      const r = d.renderer.info.render
      return { calls: r.calls, drawCalls: r.drawCalls, triangles: r.triangles, lines: r.lines, points: r.points }
    },

    /** A pointermove on the viewport every frame, which is what makes the viewer hover-pick. */
    hover(on) {
      if (hoverRaf) { cancelAnimationFrame(hoverRaf); hoverRaf = 0 }
      if (!on) return
      const c = canvas()
      const r = c.getBoundingClientRect()
      let i = 0
      const step = () => {
        i++
        const x = r.left + r.width * (0.35 + 0.3 * Math.abs(((i / 37) % 2) - 1))
        const y = r.top + r.height * (0.35 + 0.3 * Math.abs(((i / 53) % 2) - 1))
        c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: 'mouse' }))
        hoverRaf = requestAnimationFrame(step)
      }
      hoverRaf = requestAnimationFrame(step)
    },

    /**
     * Run fn, then resolve once two animation frames have gone by — the first is the frame
     * that reflects the change and submits it, the second means that frame has been handed to
     * the compositor. It is the closest a page can get to "painted" without a tracing session,
     * and it is measured the same way for every row so the rows compare.
     */
    paint(fn) {
      return new Promise((done) => {
        const t0 = performance.now()
        const r = fn()
        const after = () => requestAnimationFrame(() => done({ ms: performance.now() - t0, value: r === undefined ? null : r }))
        requestAnimationFrame(after)
      })
    },

    /** Frame intervals for ms milliseconds, without an orbit — for the crossfade and for the idle test. */
    watch(ms) {
      return new Promise((done) => {
        this.start()
        setTimeout(() => done(this.stop()), ms)
      })
    }
  }
  return 'ok'
})()
`

/* ────────────────────────────── conditions ──────────────────────────────
 * `set` is applied before the orbit, `clear` after it. Both are expressions evaluated in the
 * page with `v` = the viewer and `d` = its dev handle in scope. */
const CONDITIONS = [
  {
    id: '1',
    name: 'defaults (grids + levels + shadows + edges)',
    set: ``,
    clear: ``
  },
  {
    id: '2',
    name: 'grids and levels off',
    set: `v.setGrids(false); v.setLevels(false)`,
    clear: `v.setGrids(true); v.setLevels(true)`
  },
  {
    id: '2b',
    name: 'grids/levels on, label occlusion test off',
    set: `d.overlay.__occ = d.overlay.updateOcclusion; d.overlay.updateOcclusion = () => {}`,
    clear: `d.overlay.updateOcclusion = d.overlay.__occ`
  },
  {
    id: '3',
    name: 'edges hidden',
    set: `d.edges.group.visible = false`,
    clear: `d.edges.group.visible = true`
  },
  {
    id: '3b',
    /**
     * **A measurement, never a change.** The design's edge is `#… at 0.45 alpha over the lit
     * surface (`materials.ts`, `EDGE_ALPHA`), so an opaque edge is a *different pixel* on every
     * shaded face and could never ship. Turning the blend off for four seconds is the only way
     * to say whether 2.7 million segments cost their blending or their rasterisation — and the
     * answer decides whether there is anything worth doing about them at all.
     */
    name: 'edges opaque (measurement only — blending off)',
    set: `d.materials.edge.transparent = false; d.materials.edge.needsUpdate = true`,
    clear: `d.materials.edge.transparent = true; d.materials.edge.needsUpdate = true`,
    settle: 900
  },
  {
    id: '4',
    name: 'shadows off',
    set: `v.setShadows(false)`,
    clear: `v.setShadows(true)`
  },
  {
    id: '5',
    name: 'glass family hidden',
    set: `for (const s of d.store.slots) if (!s.removed && s.family === 'glass') s.mesh.visible = false`,
    clear: `for (const s of d.store.slots) if (!s.removed && s.family === 'glass') s.mesh.visible = true`
  },
  {
    id: '5b',
    /**
     * **A measurement, never a change.** The glass material is `DoubleSide` and transparent, so
     * three renders it *twice* (`CLAUDE.md`, three.js traps) — 14 draw calls and 365 019
     * triangles a frame through the vertex stage on the reference model. `forceSinglePass`
     * removes that, and it is **not** set (`materials.ts`): the back-then-front order is part
     * of the look, and setting it moves 0.19 % of the light theme's pixels inside the glazing
     * by up to 90 of 255. This turns it on for four seconds to keep the number honest, and
     * puts it back.
     */
    name: 'glass single-pass (measurement only — what the flag would save)',
    set: `d.materials.glass.forceSinglePass = true; d.materials.glass.needsUpdate = true`,
    clear: `d.materials.glass.forceSinglePass = false; d.materials.glass.needsUpdate = true`,
    settle: 900
  },
  {
    id: '6',
    name: 'pixel ratio 1',
    set: `d.renderer.setPixelRatio(1); d.renderer.setSize(window.__profW, window.__profH, false)`,
    clear: `d.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); d.renderer.setSize(window.__profW, window.__profH, false)`
  },
  {
    id: '8',
    name: 'DOM overlay and view cube off',
    set: `d.overlay.__u = d.overlay.update; d.overlay.__o = d.overlay.updateOcclusion; d.overlay.update = () => {}; d.overlay.updateOcclusion = () => {};
          if (d.cube) { d.cube.__r = d.cube.render; d.cube.render = () => {} }`,
    clear: `d.overlay.update = d.overlay.__u; d.overlay.updateOcclusion = d.overlay.__o; if (d.cube) d.cube.render = d.cube.__r`
  },
  {
    id: '8b',
    name: 'view cube off only',
    set: `if (d.cube) { d.cube.__r = d.cube.render; d.cube.render = () => {} }`,
    clear: `if (d.cube) d.cube.render = d.cube.__r`
  },
  { id: '9a', name: 'pointer idle (same as 1)', set: ``, clear: `` },
  { id: '9b', name: 'pointer moving over the model (hover picking)', set: `window.__prof.hover(true)`, clear: `window.__prof.hover(false)` },
  {
    id: '10',
    name: 'materials FrontSide instead of DoubleSide',
    // 0 is THREE.FrontSide, 2 is DoubleSide. A node material recompiles, hence the settle.
    set: `for (const m of [d.materials.solid, d.materials.ghost, d.materials.glass]) { m.side = 0; m.needsUpdate = true }`,
    clear: `for (const m of [d.materials.solid, d.materials.ghost, d.materials.glass]) { m.side = 2; m.needsUpdate = true }`,
    settle: 900
  },
  {
    id: '11',
    name: 'everything cheap off together (the floor)',
    set: `v.setGrids(false); v.setLevels(false); v.setShadows(false);
          d.edges.group.visible = false;
          for (const s of d.store.slots) if (!s.removed && s.family === 'glass') s.mesh.visible = false;
          d.renderer.setPixelRatio(1); d.renderer.setSize(window.__profW, window.__profH, false);
          d.overlay.__u = d.overlay.update; d.overlay.__o = d.overlay.updateOcclusion;
          d.overlay.update = () => {}; d.overlay.updateOcclusion = () => {};
          if (d.cube) { d.cube.__r = d.cube.render; d.cube.render = () => {} }`,
    clear: `v.setGrids(true); v.setLevels(true); v.setShadows(true);
            d.edges.group.visible = true;
            for (const s of d.store.slots) if (!s.removed && s.family === 'glass') s.mesh.visible = true;
            d.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); d.renderer.setSize(window.__profW, window.__profH, false);
            d.overlay.update = d.overlay.__u; d.overlay.updateOcclusion = d.overlay.__o;
            if (d.cube) d.cube.render = d.cube.__r`,
    settle: 400
  },
  { id: '12', name: 'idle: camera still, nothing changing', set: ``, clear: ``, idle: true }
]

const guard = installGuard({ label: `profile ${PHASE} ${basename(MODEL)}` })

app.enableSandbox()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sgvue-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

/** median / p95 of a sample, and the fps the median interval implies. */
function stats(values) {
  const s = [...values].sort((a, b) => a - b)
  if (!s.length) return { n: 0, med: NaN, p95: NaN, min: NaN, max: NaN, mean: NaN }
  return {
    n: s.length,
    med: s[s.length >> 1],
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
    min: s[0],
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length
  }
}

app.whenReady().then(async () => {
  protocol.handle('sgvue-file', () => net.fetch(pathToFileURL(MODEL).toString()))

  const win = new BrowserWindow({
    width: W,
    height: H,
    useContentSize: true,
    frame: false,
    x: 0,
    y: 0,
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
  win.setBounds({ x: 0, y: 0, width: W, height: H })
  win.webContents.on('console-message', (e) => {
    if (/\[sgvue\]/.test(e.message)) console.log(`[renderer] ${e.message}`)
  })

  await win.loadFile(join(ROOT, 'out/renderer/index.html'), HASH ? { hash: HASH } : undefined)
  await wait(2000)

  const js = (code) => win.webContents.executeJavaScript(code)
  const json = async (code) => JSON.parse(await js(`(async () => JSON.stringify(await (${code})))()`))

  if (!(await js(`!!window.__sgvueDev`))) {
    console.log('no __sgvueDev — rebuild with VITE_SGVUE_DEVTOOLS=1')
    return app.exit(1)
  }
  await js(HARNESS)

  const dpr = await js(`window.devicePixelRatio`)
  const vp = await json(
    `(() => { const c = document.querySelector('[data-role="viewport"]'); const p = c.parentElement;
       window.__profW = p.clientWidth; window.__profH = p.clientHeight;
       return { css: [p.clientWidth, p.clientHeight], drawing: [c.width, c.height] } })()`
  )
  console.log(`window   ${W} × ${H} content · dpr ${dpr} · canvas ${vp.css.join(' × ')} css → ${vp.drawing.join(' × ')} device`)
  console.log(`backend  ${await js(`window.__sgvueDev.viewer.backend`)} (requested ${BACKEND})`)
  // 2026-09-25 — which adapter drew these numbers (`debug().gpu`, UNMASKED_RENDERER_WEBGL).
  console.log(`gpu      ${await js(`window.__sgvueDev.debug().gpu`)}`)
  console.log(`aa       ${process.env.SGVUE_AA === '0' ? 'off (#aa=0)' : 'on'}`)

  if (PHASE === 'landing') {
    await runLanding(js, json)
    guard.stop()
    return app.exit(0)
  }

  /* ── load the model ─────────────────────────────────────────────────────── */
  const t0 = Date.now()
  if (MOCK) {
    await js(`window.__sgvueDev.elementIds().length`)
  } else {
    await js(
      `window.__sgvueDev.open('sgvue-file://model/${encodeURIComponent(basename(MODEL))}', ${JSON.stringify(basename(MODEL))})`
    )
  }
  console.log(`load     ${((Date.now() - t0) / 1000).toFixed(2)} s`)
  await js(`window.__sgvueDev.zoomExtents()`)
  await wait(1200)
  guard.sample('after load')

  const d0 = await json(`window.__sgvueDev.debug()`)
  console.log(
    `model    ${d0.elements.toLocaleString('en-US')} elements · ${d0.parts.toLocaleString('en-US')} parts · ` +
      `${d0.slots} slots · ${d0.vertices.toLocaleString('en-US')} vertices · ${d0.calls} draw objects`
  )
  console.log(
    `annot    grids ${d0.annotations.grids} (${d0.annotations.gridLines} lines, ${d0.annotations.gridFamilies} families) · ` +
      `levels ${d0.annotations.levels} (${d0.annotations.levelRings} rings) · ${d0.labels} DOM labels`
  )

  if (NO_OCC) {
    await js(`(() => { window.__sgvueDev.viewer.dev.overlay.updateOcclusion = () => {}; return 1 })()`)
    console.log('occl     the per-frame label occlusion test is OFF for every row below')
  }

  if (PHASE === 'probe') {
    await runProbe(js, json)
    guard.stop()
    return app.exit(0)
  }

  if (PHASE === 'latency') {
    await runLatency(js, json)
    guard.stop()
    return app.exit(0)
  }

  await runFrames(js, json)
  guard.stop()
  app.exit(0)

  /* ───────────────────────────── phases ───────────────────────────── */

  async function runFrames(js, json) {
    console.log('')
    console.log('condition                                          n   median  p95     mean    fps(mean) | js med  js p95 | wait  | calls  tris      lines')
    const rows = []
    const sequence = ORDER.length
      ? ORDER.map((id) => {
          const c = CONDITIONS.find((x) => x.id === id)
          if (!c) throw new Error(`no such condition: ${id}`)
          return c
        })
      : CONDITIONS.filter((c) => !ONLY.length || ONLY.includes(c.id))
    for (const c of sequence) {
      if (guard.secondsLeft < SECONDS + 6) {
        console.log(`(stopping early — ${Math.round(guard.secondsLeft)} s of guard budget left)`)
        break
      }
      const prelude = `(() => { const v = window.__sgvueDev.viewer, d = v.dev; ${c.set || ''}; return 1 })()`
      await js(prelude)
      await wait(c.settle ?? 250)
      await js(`window.__prof.start()`)
      if (!c.idle) await js(`window.__sgvueDev.spin(${SECONDS})`)
      else await wait(SECONDS * 1000)
      const sample = await json(`window.__prof.stop()`)
      const info = await json(`window.__prof.info()`)
      const dbg = await json(`window.__sgvueDev.debug()`)
      await js(`(() => { const v = window.__sgvueDev.viewer, d = v.dev; ${c.clear || ''}; return 1 })()`)
      await wait(150)

      const iv = stats(sample.intervals)
      const jm = stats(sample.js)
      const waitMs = iv.med - jm.med
      rows.push({ c, iv, jm, info, dbg, n: sample.n })
      console.log(
        `${(c.id + '  ' + c.name).padEnd(50)} ${String(sample.n).padStart(3)}  ` +
          `${num(iv.med).padStart(6)}  ${num(iv.p95).padStart(6)}  ${num(iv.mean).padStart(6)}  ${num(1000 / iv.mean, 1).padStart(7)}   | ` +
          `${num(jm.med).padStart(6)}  ${num(jm.p95).padStart(6)} | ${num(waitMs).padStart(5)} | ` +
          `${String(dbg.calls).padStart(5)}  ${String(info.triangles).padStart(8)}  ${String(info.lines).padStart(8)}`
      )
    }
    console.log('')
    console.log('(median / p95 are milliseconds per frame. "js" is main-thread time inside the')
    console.log(' animation-frame callbacks; "wait" is median interval − median js, i.e. vsync +')
    console.log(' compositing + GPU. calls is the viewer\'s own object count; tris/lines are')
    console.log(' renderer.info, which the WebGL backend may under-report.)')
    console.log('')
    console.log(`JSON ${JSON.stringify(rows.map((r) => ({ id: r.c.id, name: r.c.name, n: r.n, med: +r.iv.med.toFixed(2), p95: +r.iv.p95.toFixed(2), mean: +r.iv.mean.toFixed(2), jsMed: +r.jm.med.toFixed(2), jsP95: +r.jm.p95.toFixed(2), calls: r.dbg.calls, tris: r.info.triangles, lines: r.info.lines, hoverMs: r.dbg.hoverMs })))}`)
  }

  /**
   * Click-to-painted, through the **designed** controls wherever one exists: a right-click on
   * the viewport opens the real context menu and its real "Hide" item is clicked, the storey
   * row is the row the user clicks, the Filter card is opened by its own toolbar button. Only
   * the two that have no designed control — hovering, and reading the geometry back — are
   * driven any other way.
   *
   * "Painted" is two animation frames after the action: the first is the frame that reflects
   * the change and submits it, the second means that frame reached the compositor. It is
   * measured identically for every row, so the rows compare with each other.
   */
  async function runLatency(js, json) {
    /* ── the geometry census ── */
    const census = await json(`(() => {
      const d = window.__sgvueDev.viewer.dev
      const out = { solid: { slots: 0, verts: 0, idx: 0 }, glass: { slots: 0, verts: 0, idx: 0 },
                    ghost: { meshes: 0, visible: 0 }, edge: { objects: 0, verts: 0, drawn: 0, sel: 0 } }
      for (const s of d.store.slots) {
        if (s.removed) continue
        const f = out[s.family]
        f.slots++
        f.verts += s.geometry.getAttribute('position').count
        f.idx += s.geometry.getIndex() ? s.geometry.getIndex().count : 0
        if (s.ghost) { out.ghost.meshes++; if (s.ghost.visible) out.ghost.visible++ }
      }
      for (const o of d.edges.group.children) {
        out.edge.objects++
        out.edge.verts += o.geometry.getAttribute('position').count
        const r = o.geometry.drawRange
        if (o.visible && r.count > 0) {
          if (o.material === d.materials.selEdge) out.edge.sel += r.count
          else out.edge.drawn += r.count
        }
      }
      return out
    })()`)
    console.log('')
    console.log('geometry census — what is actually on the GPU')
    const T = (n) => n.toLocaleString('en-US')
    console.log(`  solid        ${census.solid.slots} meshes · ${T(census.solid.verts)} vertices · ${T(census.solid.idx)} indices (${T(Math.round(census.solid.idx / 3))} triangles)`)
    console.log(`  glass        ${census.glass.slots} meshes · ${T(census.glass.verts)} vertices · ${T(census.glass.idx)} indices (${T(Math.round(census.glass.idx / 3))} triangles)`)
    console.log(`  see-through  ${census.ghost.meshes} meshes over the solid buffers · ${census.ghost.visible} currently drawn`)
    console.log(`  edges        ${census.edge.objects} line objects · ${T(census.edge.verts)} vertices · ${T(census.edge.drawn / 2)} segments drawn (+${T(census.edge.sel / 2)} selection)`)

    /* ── the designed interactions ── */
    console.log('')
    console.log('click → painted (ms)')
    const DRIVE = String.raw`
      window.__drive = {
        $$: (s) => [...document.querySelectorAll(s)],
        txt: (e) => (e.textContent || '').trim(),
        canvas: () => document.querySelector('[data-role="viewport"]'),
        at: (fx, fy) => { const r = window.__drive.canvas().getBoundingClientRect();
          return { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy } },
        pointer: (type, fx, fy, extra) => {
          const c = window.__drive.canvas()
          c.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1 }, window.__drive.at(fx, fy), extra || {})))
        },
        menuItem: (re) => window.__drive.$$('[role="menu"] button, [role="menuitem"]').find((b) => re.test(window.__drive.txt(b))),
        byTip: (tip) => document.querySelector('button[data-tip="' + tip + '"]'),
        byText: (sel, t) => window.__drive.$$(sel).find((e) => window.__drive.txt(e) === t),
        groupRows: () => window.__drive.$$('button').filter((b) => b.title === 'Show / hide group').map((b) => b.parentElement),
        storeyRows: () => window.__drive.$$('button').filter((b) => b.title === 'Show / hide storey').map((b) => b.parentElement),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms))
      }; 1`
    await js(DRIVE)

    const row = async (label, code, settle = 250) => {
      if (guard.secondsLeft < 5) return null
      let r = null
      try {
        r = await json(`window.__prof.paint(() => { ${code} })`)
      } catch (err) {
        console.log(`  ${label.padEnd(52)}  skipped — ${String(err).slice(0, 70)}`)
        return null
      }
      console.log(`  ${label.padEnd(52)}  ${num(r.ms).padStart(7)}${r.value == null ? '' : '   ' + JSON.stringify(r.value)}`)
      await wait(settle)
      return r
    }

    await row('hover highlight (pointermove over geometry)', `window.__drive.pointer('pointermove', 0.5, 0.5, { buttons: 0 })`)
    await row(
      'select an element (click on the viewport)',
      `window.__drive.pointer('pointerdown', 0.5, 0.5); window.__drive.pointer('pointerup', 0.5, 0.5)`,
      400
    )
    const sel = await json(`window.__sgvueDev.selected()`)
    console.log(`     (selection is ${JSON.stringify(sel)})`)

    // The element tree's largest group.
    const biggest = await json(`(() => {
      const d = window.__drive
      let best = null, n = 0
      for (const r of d.groupRows()) { const c = Number(d.txt(r.children[2]).replace(/[^0-9]/g, '')); if (c > n) { n = c; best = d.txt(r.children[1]) } }
      window.__drive.bigGroup = best
      return { label: best, count: n }
    })()`)
    await row(
      `expand the largest tree group (${biggest.label} · ${biggest.count} rows)`,
      `(() => { const d = window.__drive; const r = d.groupRows().find((x) => d.txt(x.children[1]) === d.bigGroup); r.click() })()`,
      400
    )
    await row(
      'collapse it again',
      `(() => { const d = window.__drive; const r = d.groupRows().find((x) => d.txt(x.children[1]) === d.bigGroup); r.click() })()`,
      400
    )

    // Hide / isolate through the designed context menu.
    await row('right-click: open the context menu', `(() => { const d = window.__drive
      d.pointer('pointerdown', 0.5, 0.5, { button: 2, buttons: 2 })
      d.pointer('pointerup', 0.5, 0.5, { button: 2, buttons: 0 })
      return d.$$('[role="menu"] button').map((b) => d.txt(b)).slice(0, 3) })()`, 350)
    await row('  → "Hide"', `(() => { const b = window.__drive.menuItem(/^Hide/); if (!b) throw new Error('no Hide item'); b.click() })()`, 500)
    await row('reset (the temporary-state frame)', `(() => { const b = window.__drive.byText('button', 'reset'); if (!b) throw new Error('no reset control'); b.click() })()`, 700)
    await row('right-click: open the context menu', `(() => { const d = window.__drive
      d.pointer('pointerdown', 0.5, 0.5, { button: 2, buttons: 2 })
      d.pointer('pointerup', 0.5, 0.5, { button: 2, buttons: 0 })
      return d.$$('[role="menu"] button').map((b) => d.txt(b)).slice(0, 3) })()`, 350)
    await row('  → "Isolate"', `(() => { const b = window.__drive.menuItem(/^Isolate/); if (!b) throw new Error('no Isolate item'); b.click() })()`, 500)
    await row('reset (the temporary-state frame)', `(() => { const b = window.__drive.byText('button', 'reset'); if (!b) throw new Error('no reset control'); b.click() })()`, 700)

    // The Filter card.
    await row('open the Filter card', `window.__drive.byTip('Filter elements by parameter').click()`, 400)
    await row('  → "+ add filter step"', `(() => { const b = window.__drive.byText('button', '+ add filter step'); if (!b) throw new Error('no add-step control'); b.click() })()`, 500)
    await row('close the Filter card', `window.__drive.byTip('Filter elements by parameter').click()`, 400)

    // Theme.
    await row('toggle the theme (light)', `window.__drive.byTip('Light / dark').click()`, 700)
    await row('toggle the theme (dark)', `window.__drive.byTip('Light / dark').click()`, 700)

    /* ── the 220 ms crossfade ── */
    if (guard.secondsLeft > 8) {
      console.log('')
      console.log('storey solo — the frames during the 220 ms crossfade')
      const fade = await json(`(async () => {
        const d = window.__drive
        const rows = d.storeyRows()
        if (!rows.length) return null
        const pick = rows[(rows.length / 2) | 0]
        const name = d.txt(pick.children[1])
        window.__prof.start()
        pick.click()
        await d.sleep(800)
        const s = window.__prof.stop()
        pick.click()
        await d.sleep(400)
        return Object.assign({ name }, s)
      })()`)
      if (fade && fade.n) {
        const iv = stats(fade.intervals)
        const jm = stats(fade.js)
        console.log(`  solo "${fade.name}" — ${fade.n} frames in 800 ms · median ${num(iv.med)} ms · p95 ${num(iv.p95)} · max ${num(iv.max)}`)
        console.log(`  js median ${num(jm.med)} ms · js max ${num(jm.max)} ms`)
        console.log(`  first 24 intervals: ${fade.intervals.slice(0, 24).map((v) => v.toFixed(1)).join(' ')}`)
        console.log(`  first 24 js:        ${fade.js.slice(0, 24).map((v) => v.toFixed(1)).join(' ')}`)
      } else {
        console.log('  (no storey rows found)')
      }
    }
  }

  /**
   * The mechanism behind the stall, measured directly rather than inferred: how many labels
   * ask to be occlusion-tested, what one of those tests costs, and what the renderer thinks
   * it drew — `calls` against our own object count is where a material that is rendered twice
   * shows up.
   */
  async function runProbe(js, json) {
    const r = await json(`(() => {
      const v = window.__sgvueDev.viewer, d = v.dev
      const occluding = d.overlay.labels.filter((L) => L.occlude)
      const on = occluding.filter((L) => L.on)
      return { labels: d.overlay.labels.length, occluding: occluding.length, occludingOn: on.length,
               pickable: d.picker.size }
    })()`)
    console.log('')
    console.log('label occlusion — the mechanism')
    console.log(`  DOM labels           ${r.labels}`)
    console.log(`  ask to be occluded   ${r.occluding}   (of those, currently on: ${r.occludingOn})`)
    console.log(`  picker candidates    ${r.pickable.toLocaleString('en-US')} elements, each box-tested per ray`)

    const timed = await json(`(() => {
      const d = window.__sgvueDev.viewer.dev
      const cam = d.camera()
      const dir = cam.getWorldDirection(new (Object.getPrototypeOf(cam.position).constructor)())
      const box = d.store.bbox
      const span = box.getSize(new (Object.getPrototypeOf(cam.position).constructor)()).length() * 1.5 + 10
      const on = d.overlay.labels.filter((L) => L.occlude && L.on)
      const one = []
      const O = new (Object.getPrototypeOf(cam.position).constructor)()
      for (const L of on.slice(0, 12)) {
        O.copy(L.pos).addScaledVector(dir, -span)
        const t = performance.now()
        d.picker.anyHit(O, dir, span - 0.25)
        one.push(performance.now() - t)
      }
      // The whole sweep, exactly as one occlusion frame does it.
      const t0 = performance.now()
      for (const L of on) {
        O.copy(L.pos).addScaledVector(dir, -span)
        d.picker.anyHit(O, dir, span - 0.25)
      }
      return { per: one, sweepMs: performance.now() - t0, n: on.length }
    })()`)
    const per = stats(timed.per)
    console.log(`  one ray              median ${num(per.med)} ms  (min ${num(per.min)}, max ${num(per.max)}, n=${per.n})`)
    console.log(`  the whole sweep      ${num(timed.sweepMs)} ms for ${timed.n} labels — and it runs on one frame in four`)
    console.log(`  amortised            ${num(timed.sweepMs / 4)} ms per frame`)

    const info = await json(`(() => {
      const d = window.__sgvueDev.viewer.dev
      const r = d.renderer.info.render
      let solidTris = 0, glassTris = 0
      for (const s of d.store.slots) { if (s.removed) continue
        const t = s.geometry.getIndex().count / 3
        if (s.family === 'glass') glassTris += t; else solidTris += t }
      return { calls: r.calls, drawCalls: r.drawCalls, triangles: r.triangles, lines: r.lines,
               solidTris, glassTris, ours: window.__sgvueDev.debug().calls }
    })()`)
    console.log('')
    console.log('what the renderer says it drew, against what is in the buffers')
    console.log(`  renderer.info        calls ${info.calls} · drawCalls ${info.drawCalls} · triangles ${info.triangles.toLocaleString('en-US')} · lines ${info.lines.toLocaleString('en-US')}`)
    console.log(`  viewer's own count   ${info.ours} objects`)
    console.log(`  in the buffers       solid ${Math.round(info.solidTris).toLocaleString('en-US')} + glass ${Math.round(info.glassTris).toLocaleString('en-US')} = ${Math.round(info.solidTris + info.glassTris).toLocaleString('en-US')} triangles`)
    console.log(`  difference           ${(info.triangles - Math.round(info.solidTris + info.glassTris)).toLocaleString('en-US')} triangles drawn beyond what the buffers hold`)

    // Is the surplus the glass family being rasterised twice? `forceSinglePass` is the flag
    // three offers for exactly that, and `materials.ts` sets it on the ghost material and not
    // on the glass one. Set it and read the counter again — measurement, reverted immediately.
    const after = await json(`(async () => {
      const d = window.__sgvueDev.viewer.dev
      d.materials.glass.forceSinglePass = true
      d.materials.glass.needsUpdate = true
      await new Promise((r) => setTimeout(r, 600))
      const t = d.renderer.info.render.triangles
      const c = d.renderer.info.render.drawCalls
      d.materials.glass.forceSinglePass = false
      d.materials.glass.needsUpdate = true
      return { triangles: t, drawCalls: c }
    })()`)
    console.log(`  with glass forceSinglePass = true: ${after.triangles.toLocaleString('en-US')} triangles · ${after.drawCalls} drawCalls`)
  }

  async function runLanding(js, json) {
    console.log('')
    console.log('landing page (no model)')
    const idle = await json(`window.__prof.watch(2500)`)
    const i1 = stats(idle.intervals)
    const j1 = stats(idle.js)
    console.log(`  idle            ${idle.n} frames · median ${num(i1.med)} ms (${num(1000 / i1.med, 1)} fps) · p95 ${num(i1.p95)} · js median ${num(j1.med)}`)
    const move = await json(`(async () => {
      const t = setInterval(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 + Math.random() * 900, clientY: 150 + Math.random() * 600, bubbles: true })), 8)
      const r = await window.__prof.watch(2500)
      clearInterval(t)
      return r
    })()`)
    const i2 = stats(move.intervals)
    const j2 = stats(move.js)
    console.log(`  pointer moving  ${move.n} frames · median ${num(i2.med)} ms (${num(1000 / i2.med, 1)} fps) · p95 ${num(i2.p95)} · js median ${num(j2.med)}`)
  }
})
