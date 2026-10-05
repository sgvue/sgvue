/**
 * Dev utility — NOT application code. The renderer benchmark: a real IFC file loaded through
 * the real pipeline inside the built app, then orbited while `on.stats` is sampled.
 *
 *   npm run build && SGVUE_IFC="samples/Sample Ifc Model.ifc" npx electron scripts/bench.cjs
 *
 * **WebGL2 only.** A real model on WebGPU is what kernel-panicked this machine twice on
 * 2026-09-17 (`scripts/lib/electron-guard.cjs`), and `scripts/lib/backend.cjs` refuses it
 * here whatever the environment says. Every run is watched by the guard and is hard-bounded
 * in wall clock and GPU-process memory.
 *
 * The file reaches the renderer over the app's own read-only `sgvue-file:` scheme rather than
 * a synthetic drag-and-drop, which is both simpler and closer to what Phase 8 will do: the
 * renderer only ever sees a `Blob`, never a path. Requires a build made with
 * VITE_SGVUE_DEVTOOLS=1, because `window.__sgvueDev` is absent from a production bundle.
 */
const { app, BrowserWindow, protocol, net } = require('electron')
const { join, resolve, basename } = require('node:path')
const { pathToFileURL } = require('node:url')
const { installGuard } = require('./lib/electron-guard.cjs')
const { resolveBackend } = require('./lib/backend.cjs')

const ROOT = join(__dirname, '..')
/**
 * `SGVUE_IFC=mock` benchmarks the design's own mock federation instead of a file — the same
 * content the parity harness renders, loaded by the app's `#mock` entry. It is the only
 * content WebGPU may be measured on (`scripts/lib/backend.cjs`).
 */
const MOCK = process.env.SGVUE_IFC === 'mock'
const MODEL = MOCK ? 'mock federation' : resolve(ROOT, process.env.SGVUE_IFC || 'samples/Sample Ifc Model.ifc')
const { backend: BACKEND, hash: HASH } = resolveBackend(MOCK ? 'mock' : '')
const SPIN = Number(process.env.SGVUE_SPIN || 12)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Defaults come from the guard (2 500 MB GPU footprint, 25 s) and may only be *raised* from
// the command line, deliberately, for a run that has already been proved flat at 25 s.
const guard = installGuard({ label: `bench ${basename(MODEL)}` })

app.enableSandbox()
// Same registration the app makes in src/main/index.ts: standard + secure + CORS-enabled, or
// Chromium refuses to fetch it from a file:// renderer and the handler is never called.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sgvue-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

app.whenReady().then(async () => {
  protocol.handle('sgvue-file', () => net.fetch(pathToFileURL(MODEL).toString()))

  const win = new BrowserWindow({
    width: 1440,
    height: 860,
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
  win.setBounds({ x: 0, y: 0, width: 1440, height: 860 })
  win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`))

  await win.loadFile(join(ROOT, 'out/renderer/index.html'), HASH ? { hash: HASH } : undefined)
  await wait(2500)

  const js = (code) => win.webContents.executeJavaScript(code)
  const has = await js(`!!window.__sgvueDev`)
  if (!has) {
    console.log('no __sgvueDev — rebuild with VITE_SGVUE_DEVTOOLS=1')
    return app.exit(1)
  }

  console.log(`model   ${basename(MODEL)}`)
  console.log(`backend ${await js(`window.__sgvueDev.viewer.backend`)} (requested ${BACKEND})`)
  const memStart = guard.sample('at start')

  const t0 = Date.now()
  if (MOCK) {
    // `#mock` loads the federation during start-up; by now it is already in the batches.
    await js(`window.__sgvueDev.elementIds().length`)
  } else {
    await js(
      `window.__sgvueDev.open('sgvue-file://model/${encodeURIComponent(basename(MODEL))}', ${JSON.stringify(basename(MODEL))})`
    )
  }
  const loadMs = Date.now() - t0
  await js(`window.__sgvueDev.zoomExtents()`)
  const memLoaded = guard.sample('after load')

  /* ── settle ───────────────────────────────────────────────────────────────
   * A couple of frames after the upload is where the GPU process either goes flat or runs
   * away: on 2026-09-17 it went 634 MB → 5 461 MB inside one 0.5 s poll, in the instant after
   * the batches landed and the first frame was drawn. The guard is sampling at 250 ms
   * throughout, so this window is covered whatever happens. */
  await wait(1500)
  const memSettled = guard.sample('two seconds after the first frame')

  /* ── hover cost ───────────────────────────────────────────────────────────
   * Real `mouseMove` events through Chromium's own pipeline, so the whole path runs: NDC, the
   * element box filter, the sorted walk and the per-part triangle walk. `debug().hoverMs` is
   * the time the frame loop measured around its own `doHover()`. Points are spread across the
   * viewport so some land on geometry and some on empty space. */
  const hovers = []
  // Everything from here is bounded by what the guard has left, so a slow load shortens the
  // measurement rather than overrunning into a trip.
  for (let i = 0; i < 16; i++) {
    if (guard.secondsLeft <= SPIN + 4) break
    const x = 360 + ((i * 137) % 720)
    const y = 200 + ((i * 89) % 420)
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
    await wait(90)
    const d = JSON.parse(await js(`JSON.stringify(window.__sgvueDev.debug())`))
    if (d.hoverMs > 0) hovers.push(d.hoverMs)
  }
  const hoverSorted = [...hovers].sort((a, b) => a - b)

  // Samples land once a second from `on.stats`.
  const spin = Math.max(2, Math.min(SPIN, Math.floor(guard.secondsLeft - 3)))
  await js(`window.__sgvueDev.__fps = []; window.__sgvueDev.__t = setInterval(() => {
    const s = window.__sgvueDev.stats(); if (s) window.__sgvueDev.__fps.push(s.fps);
  }, 1000);`)
  await js(`window.__sgvueDev.spin(${spin})`)
  await js(`clearInterval(window.__sgvueDev.__t)`)
  const memOrbit = guard.sample('after orbit')

  const fps = await js(`JSON.stringify(window.__sgvueDev.__fps)`)
  const debug = JSON.parse(await js(`JSON.stringify(window.__sgvueDev.debug())`))
  const heap = await js(
    `JSON.stringify(performance.memory ? { usedMB: Math.round(performance.memory.usedJSHeapSize/1048576), totalMB: Math.round(performance.memory.totalJSHeapSize/1048576) } : null)`
  )
  const samples = JSON.parse(fps).filter((v) => v > 0)
  const sorted = [...samples].sort((a, b) => a - b)
  const median = sorted.length ? sorted[sorted.length >> 1] : 0
  const pid = win.webContents.getOSProcessId()
  const metric = app.getAppMetrics().find((m) => m.pid === pid)

  console.log('')
  console.log(`load-to-first-frame  ${(loadMs / 1000).toFixed(2)} s`)
  console.log(
    `hover evaluation     n=${hovers.length}  median ${(hoverSorted[hoverSorted.length >> 1] ?? 0).toFixed(2)} ms  min ${(hoverSorted[0] ?? 0).toFixed(2)}  max ${(hoverSorted[hoverSorted.length - 1] ?? 0).toFixed(2)}`
  )
  console.log(`fps while orbiting   samples [${samples.join(', ')}]  median ${median}  min ${sorted[0] ?? 0}  (${spin} s)`)
  console.log(`draw calls           ${debug.calls}`)
  console.log(
    `merged slots         ${debug.slots}   elements ${debug.elements}   parts ${debug.parts}   vertices ${debug.vertices}`
  )
  console.log(`js heap              ${heap}`)
  console.log(
    `renderer process     ${memOrbit.rendererMB} MB phys_footprint` +
      `${metric ? `  (working set ${Math.round(metric.memory.workingSetSize / 1024)} MB — the number that was blind)` : ''}`
  )
  // The number that was never measured before 2026-09-17, and the one that panicked the Mac.
  console.log(
    `gpu process          start ${memStart.gpuMB} MB → load ${memLoaded.gpuMB} → settled ${memSettled.gpuMB} → orbit ${memOrbit.gpuMB}  (peak ${guard.peakGpuMB} MB)`
  )
  console.log(`debug                ${JSON.stringify(debug)}`)
  guard.stop()
  app.exit(0)
})
