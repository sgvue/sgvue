/**
 * Dev utility — NOT application code. **A check. It changes nothing.**
 *
 *   VITE_SGVUE_DEVTOOLS=1 npm run build
 *   node scripts/safe-run.cjs frame-triggers.cjs
 *
 * `viewer-core.ts` stopped drawing a frame that would be identical to the one before it
 * (2026-09-19, "render on demand"). The rule that makes that safe is one sentence — *anything
 * that changes what is drawn must call `invalidate()`* — and the way it fails is silent: a
 * setter nobody wired up leaves the screen showing the state before the click, which no unit
 * test can see. So this drives each class of trigger through the app with the camera at rest
 * and compares what the **compositor** actually has, before and after, by capturing the
 * window from the main process. A capture is not a re-render: if the viewer never drew, the
 * capture shows the old frame and the row fails.
 *
 * It also checks the other half, which is the point of the change: with everything at rest the
 * renderer's own `info.render.calls` stops advancing, while the frame loop keeps running and
 * the designed status bar keeps reporting a frame rate.
 *
 * And the hover rule (`input.ts`): a wheel event cancels a hover queued in the same frame, so
 * a pointer moving through a zoom gesture does not cast a ray into the whole federation.
 *
 * The design's own mock federation, so it needs no sample model and no network. WebGL2 through
 * `scripts/lib/backend.cjs`, and the whole run is inside the memory guard.
 *
 * 2026-10-01: there are two section planes, so the section triggers are the gridline cut and
 * then the second plane beside it — a level cut set, its offset, its flip and its clear, each
 * through `viewer.setSections` with the gridline cut left as it was.
 *
 * The same day, the assistant's thinking trace: a turn is stepped through in real time
 * (`window.__sgvueDev.chat.step`, no API) and the three-dimensional scene has to stay at rest
 * the whole way — 0 scene renders while the trace draws its own frames, 0 while the answer
 * arrives, and afterwards neither a scene render nor a trace frame: its loop is idle.
 *
 * 2026-10-02: the camera calls the assistant's `set_view` now reaches — a direction by its two
 * angles (`viewer.lookAlong`) and a fit with a zoom factor (`viewer.zoomExtents(zoom)`). Each is
 * a flight that nothing else starts, so each has to ask for its own frames.
 *
 * The same day, phase 4: the markups the assistant's `manage_markups` places and the spot tag it
 * sets — `viewer.placeSpot`, `viewer.showSpot` both ways, `viewer.placeMeasure` — and the two
 * lists cleared, so the rows after them are measured on the scene they always were. Each is the
 * click's own commit at a point that is named, with no pointer event to have asked for a frame.
 */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
const { installGuard } = require('./lib/electron-guard.cjs')
const { resolveBackend } = require('./lib/backend.cjs')

const ROOT = join(__dirname, '..')
const W = Number(process.env.SGVUE_W || 1280)
const H = Number(process.env.SGVUE_H || 860)
const { hash: HASH } = resolveBackend('mock')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const guard = installGuard({ label: 'frame-triggers', maxSeconds: 180 })

app.enableSandbox()

app.whenReady().then(async () => {
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
  win.setContentSize(W, H)
  await win.loadFile(join(ROOT, 'out/renderer/index.html'), HASH ? { hash: HASH } : undefined)
  await wait(2500)

  const js = (code) => win.webContents.executeJavaScript(code)
  const json = async (code) => JSON.parse(await js(`(async () => JSON.stringify(await (${code})))()`))

  if (!(await js(`!!window.__sgvueDev`))) {
    console.log('no __sgvueDev — rebuild with VITE_SGVUE_DEVTOOLS=1')
    return app.exit(1)
  }

  const rect = await json(
    `(() => { const c = document.querySelector('[data-role="viewport"]'); const b = c.getBoundingClientRect();
       return { x: Math.round(b.x) + 40, y: Math.round(b.y) + 40,
                width: Math.round(b.width) - 80, height: Math.round(b.height) - 80 } })()`
  )

  /** The viewport as the compositor has it, as raw BGRA. */
  const shot = async () => (await win.capturePage(rect)).toBitmap()

  const differs = (a, b) => {
    if (a.length !== b.length) return 1
    let n = 0
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++
    return n / (a.length / 4)
  }

  const failures = []
  const rows = []

  /** Run one trigger with the camera at rest and prove the picture moved. */
  const trigger = async (name, code, settle = 700) => {
    await wait(600)
    const before = await shot()
    await js(`(async () => { const D = window.__sgvueDev, v = D.viewer; ${code}; return 1 })()`)
    await wait(settle)
    const after = await shot()
    const share = differs(before, after)
    const ok = share > 0.001
    rows.push([name, share])
    if (!ok) failures.push(name)
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} ${(share * 100).toFixed(2)} % of pixels changed`)
  }

  console.log('')
  console.log(`the triggers — camera at rest, ${rect.width} × ${rect.height} of the viewport compared`)
  await js(`window.__sgvueDev.setView('iso')`)
  await wait(1500)

  const pointer = (type, fx, fy, extra) => `(() => {
    const c = document.querySelector('[data-role="viewport"]'); const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('${type}', Object.assign(
      { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', buttons: 0,
        clientX: r.left + r.width * ${fx}, clientY: r.top + r.height * ${fy} }, ${JSON.stringify(extra || {})})))
  })()`

  await trigger('hover highlight (pointer over geometry)', pointer('pointermove', 0.5, 0.55))
  await trigger('select an element', `D.select([D.elementIds()[0]])`)
  await trigger('colour by property', `D.colorBy('IfcEntity')`)
  await trigger('clear the colour scheme', `D.colorBy(null)`)
  await trigger('gridlines off', `v.setGrids(false)`)
  await trigger('gridlines on', `v.setGrids(true)`)
  await trigger('levels on', `v.setLevels(true)`)
  await trigger('theme (light)', `D.setTheme('light')`)
  await trigger('theme (dark)', `D.setTheme('dark')`)
  await trigger('section along grid C', `D.setSection('grid', 'C', true)`, 1600)
  // 2026-10-01 — the second plane. The gridline cut stays on throughout; each trigger changes
  // the level plane alone, through the viewer's own call, and has to repaint by itself.
  const GRID_C = `{ kind: 'grid', name: 'C', cut: true }`
  const level = (extra) => `{ kind: 'storey', name: 'L2', cut: true, ${extra} }`
  await trigger(
    'second plane: level L2 beside grid C',
    `v.setSections({ grid: ${GRID_C}, level: ${level('offset: 1.2')} })`,
    1600
  )
  await trigger(
    'second plane: its offset (grid C untouched)',
    `v.setSections({ grid: ${GRID_C}, level: ${level('offset: 8.2')} })`,
    1600
  )
  await trigger(
    'second plane: flipped',
    `v.setSections({ grid: ${GRID_C}, level: ${level('offset: 8.2, flip: true')} })`,
    1600
  )
  await trigger(
    'second plane: cleared (grid C still cuts)',
    `v.setSections({ grid: ${GRID_C}, level: null })`,
    1600
  )
  // The level plane's flip left the camera under the model. Put it back square on to grid C —
  // a gridline plane that starts cutting re-aims at itself — so the rows below are measured
  // from where they always have been. Not a trigger: nothing is compared across it.
  await js(`(() => { const D = window.__sgvueDev; D.setSection(null); D.setSection('grid', 'C', true); return 1 })()`)
  await wait(1600)
  await trigger('section cleared', `D.setSection(null)`, 1600)
  await trigger('shadows off', `v.setShadows(false)`)
  await trigger('shadows on', `v.setShadows(true)`)
  await trigger('canvas grid off', `v.setGroundGrid(false)`)
  await trigger('canvas grid on', `v.setGroundGrid(true)`)
  await trigger(
    'measure preview (laser under the pointer)',
    `D.setTool('measure'); await new Promise((r) => setTimeout(r, 60)); ${pointer('pointermove', 0.46, 0.6)}`
  )
  await trigger('back to select', `D.setTool('select'); D.select(null)`)
  // 2026-10-02, phase 4 — a markup placed at a named point, as the assistant's `manage_markups`
  // places one: the click's own commit, with no pointer event behind it to have asked for a
  // frame. The point is one the camera can see — where the laser's own row above pointed, or
  // the nearest of a few others that the model is under — so the tag is on screen; and a row
  // that finds nowhere to place anything changes no pixel, and fails as any other row does.
  const AT = `[[-0.08, -0.2], [0, 0], [0.1, -0.1], [-0.2, 0.1], [0.2, 0.2]]`
  const PICK = `const pick = ([x, y]) => v.dev.picker.pick({ x, y }, v.dev.camera())`
  await trigger(
    'markup: a spot placed at a named point',
    `${PICK}; const at = ${AT}.find((c) => pick(c)); if (at) v.placeSpot(pick(at).point.toArray())`
  )
  await trigger('markup: that spot tag set to its full E / N / Z', `const s = D.spots().at(-1); if (s) v.showSpot(s.id, true)`)
  await trigger('markup: and back to its level', `const s = D.spots().at(-1); if (s) v.showSpot(s.id, false)`)
  await trigger(
    'markup: a laser measurement placed at a named point',
    `${PICK}; ${AT}.some((c) => { const h = pick(c); return !!h && v.placeMeasure(h.point.toArray(), h.normal ? h.normal.toArray() : null, h.id) })`
  )
  // …and taken away again, so that every row below is measured on the scene it always was.
  await trigger('markup: both lists cleared', `v.clearMeasures(); v.clearSpots()`)
  await trigger('hide a model (the crossfade)', `D.setVisibility((el) => el.model !== 'STR')`, 900)
  await trigger('show everything again', `D.setVisibility(null)`, 900)
  await trigger('activate one model (inert grey)', `D.activate('ARC')`)
  await trigger('activate off', `D.activate(null)`)
  await trigger('highlight a model', `D.highlightModel('STR')`)
  await trigger('highlight off', `D.highlightModel(null)`)
  await trigger('unload a model', `v.removeModel('ARC')`, 900)
  // 2026-10-02 — the camera, as the assistant's `set_view` moves it: turned where it stands,
  // then framed closer, then framed again. The camera is at rest before each one.
  await trigger('camera: look along a direction', `v.lookAlong(2.4, 0.9)`, 1600)
  await trigger('camera: fit with a zoom', `v.zoomExtents(2)`, 1600)
  await trigger('camera: fit again', `v.zoomExtents()`, 1600)

  /* ── at rest: no renders, and still a frame rate ─────────────────────────── */
  console.log('')
  console.log('at rest — the camera still, nothing changing')
  await js(`window.__sgvueDev.setView('iso')`)
  await wait(2500)
  const still = await json(`(async () => {
    const d = window.__sgvueDev.viewer.dev
    const a = d.renderer.info.render.calls
    await new Promise((r) => setTimeout(r, 2000))
    const b = d.renderer.info.render.calls
    return { renders: b - a, fps: window.__sgvueDev.stats().fps }
  })()`)
  console.log(`  scene renders in 2 s   ${still.renders}`)
  console.log(`  status bar fps         ${still.fps}`)
  if (still.renders !== 0) failures.push(`at rest: ${still.renders} renders in 2 s`)
  if (!(still.fps > 30)) failures.push(`at rest: the status bar reports ${still.fps} fps`)

  /* ── at rest, while the assistant's thinking trace animates ──────────────── */
  // 2026-10-01. The trace is a canvas and a few DOM nodes in the chat panel, redrawn every
  // frame from Send until the answer has settled (`app/Trace.tsx`). None of it is the 3D scene's
  // business: a turn that only reads the model must not cost one scene render. A whole turn is
  // stepped through in real time — Thinking, Reading, Filtering, Checking, the answer flying
  // into its rows — and the renderer's own call counter is read across each part of it.
  console.log('')
  console.log('at rest — while the thinking trace animates in the chat panel')
  await js(`(() => { const D = window.__sgvueDev; D.trace.pin(null); D.chat.setState({ chatOpen: true }); return 1 })()`)
  await wait(1200)
  const trace = await json(`(async () => {
    const D = window.__sgvueDev, d = D.viewer.dev
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const calls = () => d.renderer.info.render.calls
    const out = {}
    let a = calls(), f = D.trace.loop().frames
    D.chat.step.begin('Which walls have no thermal transmittance?')
    D.chat.step.start()
    await D.chat.step.exec('query_elements', { rules: [
      { prop: 'IfcEntity', op: '=', val: 'IfcWall' },
      { prop: 'ThermalTransmittance', op: 'absent', val: null } ] })
    // Send, Think, Read, Filter and most of the Check: 1.4 + 1.8 + 1.6 + 2 s.
    await sleep(6800)
    out.live = { renders: calls() - a, frames: D.trace.loop().frames - f, running: D.trace.loop().running,
      steps: D.trace.cues().steps.map((s) => s.kind).join(' ') }
    a = calls(); f = D.trace.loop().frames
    D.chat.step.done('**24 of 80 walls** have no Thermal Transmittance.')
    await sleep(2200)
    out.answer = { renders: calls() - a, frames: D.trace.loop().frames - f, running: D.trace.loop().running }
    // …and two seconds after the answer nothing of the trace is running at all.
    a = calls(); f = D.trace.loop().frames
    await sleep(2000)
    out.after = { renders: calls() - a, frames: D.trace.loop().frames - f, running: D.trace.loop().running }
    D.chat.setState({ chatOpen: false })
    return out
  })()`)
  console.log(`  the turn running, 6.8 s    ${trace.live.renders} scene renders · ${trace.live.frames} trace frames (${trace.live.steps})`)
  console.log(`  the answer, 2.2 s          ${trace.answer.renders} scene renders · ${trace.answer.frames} trace frames`)
  console.log(`  the 2 s after it           ${trace.after.renders} scene renders · ${trace.after.frames} trace frames · loop ${trace.after.running ? 'running' : 'idle'}`)
  if (trace.live.renders !== 0) failures.push(`the trace, live: ${trace.live.renders} scene renders`)
  if (trace.answer.renders !== 0) failures.push(`the trace, answering: ${trace.answer.renders} scene renders`)
  if (trace.live.frames < 100) failures.push(`the trace drew only ${trace.live.frames} frames in 6.8 s`)
  if (trace.live.steps !== 'read filter check') failures.push(`the trace's steps were "${trace.live.steps}"`)
  if (trace.after.frames !== 0 || trace.after.running) {
    failures.push(`the trace is still animating after the answer settled: ${trace.after.frames} frames`)
  }
  if (trace.after.renders !== 0) failures.push(`after the trace: ${trace.after.renders} scene renders`)

  /* ── and that a moving camera does render ────────────────────────────────── */
  const moving = await json(`(async () => {
    const d = window.__sgvueDev.viewer.dev
    const a = d.renderer.info.render.calls
    await window.__sgvueDev.spin(1.5)
    return d.renderer.info.render.calls - a
  })()`)
  console.log(`  renders while orbiting 1.5 s  ${moving}`)
  if (moving < 30) failures.push(`orbiting: only ${moving} renders in 1.5 s`)

  /* ── the hover rule during a wheel gesture ───────────────────────────────── */
  console.log('')
  console.log('hover during a wheel gesture (`input.ts`)')
  const hover = await json(`(async () => {
    const d = window.__sgvueDev.viewer.dev
    const c = document.querySelector('[data-role="viewport"]')
    const r = c.getBoundingClientRect()
    const real = d.picker.pick.bind(d.picker)
    let picks = 0
    d.picker.pick = (...a) => { picks++; return real(...a) }
    const move = (i) => c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1,
      pointerType: 'mouse', buttons: 0, clientX: r.left + r.width * (0.4 + 0.2 * (i % 5) / 5), clientY: r.top + r.height * 0.5 }))
    const wheel = () => c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 2,
      clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5 }))
    const frames = (n) => new Promise((done) => { let k = 0; const s = () => (++k >= n ? done() : requestAnimationFrame(s)); requestAnimationFrame(s) })

    // 1. moves alone: one hover a frame, which is one pick a frame.
    picks = 0
    for (let i = 0; i < 20; i++) { move(i); await frames(1) }
    const movesOnly = picks
    // 2. the same moves with a wheel event after each: the wheel's own pivot pick, and the
    //    hover the move queued is cancelled.
    picks = 0
    for (let i = 0; i < 20; i++) { move(i); wheel(); await frames(1) }
    const withWheel = picks
    d.picker.pick = real
    return { movesOnly, withWheel }
  })()`)
  console.log(`  20 moves alone                       ${hover.movesOnly} picks — one hover a frame`)
  console.log(`  20 moves, each followed by a wheel    ${hover.withWheel} picks — the wheel's own pivot, and no hover`)
  // Without the cancellation each of those frames casts twice: the hover the move queued and
  // the wheel's pivot. Anything approaching double is the rule not working.
  if (hover.withWheel > hover.movesOnly * 1.5) {
    failures.push(`a wheel gesture still hovers: ${hover.withWheel} picks against ${hover.movesOnly}`)
  }

  console.log('')
  if (failures.length) {
    console.log(`FAILED — ${failures.length}: ${failures.join(' · ')}`)
    guard.stop()
    return app.exit(1)
  }
  console.log(`all ${rows.length} triggers repainted; at rest the scene is not re-rendered.`)
  guard.stop()
  app.exit(0)
})
