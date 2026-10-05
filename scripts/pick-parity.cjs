/**
 * Dev utility — NOT application code. **A check. It changes nothing.**
 *
 *   VITE_SGVUE_DEVTOOLS=1 npm run build
 *   SGVUE_IFC="samples/Sample Ifc Model.ifc" node scripts/safe-run.cjs pick-parity.cjs
 *
 * `pick-grid.ts` made a pick ray test only the candidates along it. `tests/unit/pick-grid.test.ts`
 * proves that changes no answer on the design's own 412-element federation; this proves it on
 * a **real** one, where the grid actually has work to do — 26 539 elements, boxes that overlap
 * dozens of cells, and a building the rays run the length of.
 *
 * It compares the shipped picker against a second one built over the same store with the grid
 * **off** (`viewer.dev.bruteForcePicker()`, dev-only), on:
 *
 *   1. the **real label rays** the occlusion sweep fires — the 78 grid bubbles on the reference model, plus one per grid-dimension label since 2026-09-24 — at three camera poses;
 *   2. 2 000 seeded random rays, `anyHit` and the nearest `ray()` hit — id and distance.
 *
 * and times both, which is where the 83.8 ms sweep went.
 *
 * WebGL2 only, and the whole run is inside the memory guard.
 */
const { app, BrowserWindow, protocol, net } = require('electron')
const { join, resolve, basename } = require('node:path')
const { pathToFileURL } = require('node:url')
const { installGuard } = require('./lib/electron-guard.cjs')
const { resolveBackend } = require('./lib/backend.cjs')

const ROOT = join(__dirname, '..')
const MOCK = process.env.SGVUE_IFC === 'mock'
const MODEL = MOCK ? 'mock' : resolve(ROOT, process.env.SGVUE_IFC || 'samples/Sample Ifc Model.ifc')
const { hash: HASH } = resolveBackend(MOCK ? 'mock' : '')
const RAYS = Number(process.env.SGVUE_RAYS || 2000)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const guard = installGuard({ label: 'pick-parity', maxSeconds: 240 })

app.enableSandbox()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sgvue-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

app.whenReady().then(async () => {
  if (!MOCK) protocol.handle('sgvue-file', () => net.fetch(pathToFileURL(MODEL).toString()))

  const win = new BrowserWindow({
    width: 1280,
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
  await win.loadFile(join(ROOT, 'out/renderer/index.html'), HASH ? { hash: HASH } : undefined)
  await wait(2000)

  const js = (code) => win.webContents.executeJavaScript(code)
  const json = async (code) => JSON.parse(await js(`(async () => JSON.stringify(await (${code})))()`))

  if (!(await js(`!!window.__sgvueDev`))) {
    console.log('no __sgvueDev — rebuild with VITE_SGVUE_DEVTOOLS=1')
    return app.exit(1)
  }

  if (!MOCK) {
    await js(
      `window.__sgvueDev.open('sgvue-file://model/${encodeURIComponent(basename(MODEL))}', ${JSON.stringify(basename(MODEL))})`
    )
  } else {
    await js(`window.__sgvueDev.elementIds().length`)
  }
  await js(`window.__sgvueDev.zoomExtents()`)
  await wait(1500)
  guard.sample('after load')

  const d0 = await json(`window.__sgvueDev.debug()`)
  console.log(`model    ${d0.elements.toLocaleString('en-US')} elements · ${d0.labels} DOM labels · pickable ${d0.pickable.toLocaleString('en-US')}`)

  /* The comparison, all of it inside the page: two pickers over one store. */
  const CHECK = String.raw`
(async (views, nRays) => {
  const V = window.__sgvueDev.viewer
  const d = V.dev
  const THREE_V3 = Object.getPrototypeOf(d.camera().position).constructor
  const brute = d.bruteForcePicker()
  const out = { poses: [], random: null, timing: {} }

  const rnd = (() => { let a = 0x9e3779b9 >>> 0
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } })()

  /** The sweep's own rays: from far behind each occluding label, towards the camera. */
  const bubbleRays = () => {
    const cam = d.camera()
    const dir = cam.getWorldDirection(new THREE_V3())
    const box = d.store.bbox
    const span = box.getSize(new THREE_V3()).length() * 1.5 + 10
    const rays = []
    for (const L of d.overlay.labels) {
      if (!L.occlude || !L.on) continue
      rays.push({ o: new THREE_V3().copy(L.pos).addScaledVector(dir, -span), d: dir.clone(), far: span - 0.25 })
    }
    return rays
  }

  for (const name of views) {
    V.setView(name)
    // Let the ease land, so the pose the rays are built from is the pose on screen.
    await new Promise((r) => setTimeout(r, 1400))
    brute.rebuild()
    const rays = bubbleRays()
    let same = 0, diff = 0
    const t0 = performance.now()
    for (const r of rays) d.picker.anyHit(r.o, r.d, r.far)
    const fast = performance.now() - t0
    const t1 = performance.now()
    for (const r of rays) brute.anyHit(r.o, r.d, r.far)
    const slow = performance.now() - t1
    for (const r of rays) {
      const a = d.picker.anyHit(r.o, r.d, r.far)
      const b = brute.anyHit(r.o, r.d, r.far)
      if (a === b) same++; else diff++
    }
    out.poses.push({ view: name, rays: rays.length, same, diff, fastMs: fast, bruteMs: slow })
  }

  /* 2 000 random rays: the boolean and the nearest hit, exactly. */
  V.setView('iso')
  await new Promise((r) => setTimeout(r, 1200))
  brute.rebuild()
  const box = d.store.bbox
  const c = box.getCenter(new THREE_V3())
  const radius = box.getSize(new THREE_V3()).length() / 2
  const unit = () => { const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(Math.max(0, 1 - z * z))
    return new THREE_V3(r * Math.cos(t), r * Math.sin(t), z) }
  const rays = []
  for (let i = 0; i < nRays; i++) {
    const o = unit().multiplyScalar(radius * (1.05 + rnd() * 1.2)).add(c)
    const aim = rnd() < 0.2
      ? unit().multiplyScalar(radius * 3).add(c)
      : new THREE_V3(box.min.x + rnd() * (box.max.x - box.min.x), box.min.y + rnd() * (box.max.y - box.min.y),
                     box.min.z + rnd() * (box.max.z - box.min.z))
    rays.push({ o, d: aim.sub(o).normalize() })
  }
  const far = radius * 8
  let anySame = 0, anyDiff = 0, hitSame = 0, hitDiff = 0, hits = 0
  const first = []
  const ta = performance.now()
  for (const r of rays) d.picker.ray(r.o, r.d, far)
  const fastRay = performance.now() - ta
  const tb = performance.now()
  for (const r of rays) brute.ray(r.o, r.d, far)
  const bruteRay = performance.now() - tb
  for (const r of rays) {
    const a = d.picker.anyHit(r.o, r.d, far), b = brute.anyHit(r.o, r.d, far)
    if (a === b) anySame++; else anyDiff++
    const x = d.picker.ray(r.o, r.d, far), y = brute.ray(r.o, r.d, far)
    const ok = (!x && !y) || (x && y && x.id === y.id && x.distance === y.distance &&
      x.point.equals(y.point) && x.normal.equals(y.normal))
    if (ok) hitSame++; else { hitDiff++; if (first.length < 3) first.push({ o: r.o.toArray(), d: r.d.toArray(),
      fast: x && { id: x.id, dist: x.distance }, brute: y && { id: y.id, dist: y.distance } }) }
    if (x) hits++
  }
  out.random = { n: rays.length, anySame, anyDiff, hitSame, hitDiff, hits, first, fastRay, bruteRay }
  brute.dispose()
  return out
})(['iso', 'top', 'north'], ${RAYS})`

  const r = await json(CHECK)

  console.log('')
  console.log('the real label-occlusion rays (grid bubbles and grid-dimension labels), at three camera poses')
  let bad = 0
  for (const p of r.poses) {
    bad += p.diff
    console.log(
      `  ${p.view.padEnd(6)} ${String(p.rays).padStart(3)} rays · ${p.same} identical, ${p.diff} different · ` +
        `sweep ${p.fastMs.toFixed(2)} ms with the grid, ${p.bruteMs.toFixed(2)} ms without`
    )
  }
  const q = r.random
  bad += q.anyDiff + q.hitDiff
  console.log('')
  console.log(`${q.n} random rays (${q.hits} of them hit something)`)
  console.log(`  anyHit   ${q.anySame} identical, ${q.anyDiff} different`)
  console.log(`  ray()    ${q.hitSame} identical (same id, same distance to the bit), ${q.hitDiff} different`)
  console.log(`  time     ${q.fastRay.toFixed(1)} ms with the grid, ${q.bruteRay.toFixed(1)} ms without ` +
    `(${(q.fastRay / q.n).toFixed(3)} ms vs ${(q.bruteRay / q.n).toFixed(3)} ms a ray)`)
  for (const f of q.first) console.log(`  DIFFERENT ${JSON.stringify(f)}`)

  console.log('')
  console.log(bad === 0 ? 'identical everywhere.' : `FAILED — ${bad} rays answered differently`)
  guard.stop()
  app.exit(bad === 0 ? 0 : 1)
})
