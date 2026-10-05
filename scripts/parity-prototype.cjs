/**
 * Dev utility — NOT application code, and it never writes into `design-reference/`.
 *
 * Captures the **design prototype** (`design-reference/design/SGVue.dc.html`) through the
 * same Electron window, at the same size and in the same states as `scripts/screenshot.cjs`
 * captures the app, so the two sets in `tests/parity/` are genuinely comparable rather than
 * one browser against another.
 *
 *   python3 -m http.server 8765 --directory design-reference/design &
 *   SGVUE_OUT=tests/parity/phase2a/prototype \
 *   SGVUE_STATES=iso,plan,north,section-C,highlight,activate,isolate \
 *   npx electron scripts/parity-prototype.cjs
 *
 * The prototype is served over http because it loads its modules with dynamic `import()`,
 * which Chromium refuses from `file://`; it pulls React and three from CDNs, so the machine
 * needs to be online. It also needs the design tool's own runtime, `support.js`, beside it —
 * which the repository does not carry (`design-reference/README.md`, 2026-10-05): a maintainer
 * who has it puts it in `design-reference/design/`, where `.gitignore` keeps it out of commits.
 *
 * The designed chrome is hidden before capture — sidebar, rail, toolbar, cards, status bar —
 * and the 3D grid lines and level tags are switched off, because those are Phase 6. What is
 * left in frame on both sides is exactly what Phase 2 is responsible for: the viewport, the
 * DOM annotation overlay (Phase 2b's snap marker lives there) and the 148 px view cube.
 *
 * The chrome is hidden with a **stylesheet plus data attributes**, not inline styles: 2b's
 * states click the canvas, the prototype's React shell re-renders, and a re-render restores
 * every inline style the template owns. The tagging is redone before each capture, so a node
 * the shell has only just mounted is hidden too.
 *
 * 2b's states are driven by real mouse events through `webContents.sendInputEvent`, exactly
 * as `scripts/screenshot.cjs` drives the app — same coordinates, same order, same window — so
 * both sides go through their own real pointer handlers.
 */
const { app, BrowserWindow } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { installGuard } = require('./lib/electron-guard.cjs')

const ROOT = join(__dirname, '..')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The prototype is the specification of record and this script cannot change how it renders:
 * `viewer-core.js` creates its own WebGPU renderer. That is acceptable **only** because its
 * federation is the 590-part mock (~2 071 draw calls a frame, not the reference model's
 * ~134 745), and only under a tight guard — see `scripts/lib/electron-guard.cjs` for the two
 * kernel panics that put it there. The limits are lower than any other script's.
 */
const guard = installGuard({
  label: 'parity-prototype (its own WebGPU renderer, mock federation)',
  maxGpuMB: 2000,
  maxSeconds: 180
})

const URL = process.env.SGVUE_URL || 'http://127.0.0.1:8765/SGVue.dc.html'
const SIZE = (process.env.SGVUE_SIZE || '1440x860').split('x').map(Number)
const STATES = (process.env.SGVUE_STATES || 'iso').split(',').filter(Boolean)
const THEMES = (process.env.SGVUE_THEMES || 'dark,light').split(',').filter(Boolean)
const SETTLE = Number(process.env.SGVUE_SETTLE || 1400)
const OUT = resolve(ROOT, process.env.SGVUE_OUT || 'tests/parity/phase2b/prototype')

// The mouse coordinates, the DOM helpers and every state table the app also runs are one
// shared file with `scripts/screenshot.cjs`, so the two sides cannot drift apart.
const {
  MOVE,
  CLICK,
  DBLCLICK,
  CUBE,
  HOVER,
  SECOND,
  CORNER,
  UI,
  CHROME_STATES,
  PROP_STATES,
  FILTER_STATES,
  ANNOTATION_STATES,
  COLOR_STATES,
  LANDING_STATES,
  CHAT_STATES,
  RECTS,
  sendInput
} = require('./lib/parity-states.cjs')

/**
 * From Phase 3 the designed chrome is the subject, so it is **not** stripped: set
 * `SGVUE_BARE=0`. The Phase 2 sets keep the default, which hides everything but the viewport,
 * the overlay and the cube.
 */
const BARE_ON = process.env.SGVUE_BARE !== '0'

/** `V` is the prototype's own `window.__ifcViewer`; `ids(model)` reads its `recs` map. */
const STATE_JS = {
  iso: 'V.setView("iso")',
  plan: 'V.setView("top")',
  north: 'V.setView("north")',
  east: 'V.setView("east")',
  'section-C': 'V.setView("iso"); V.setSection({ kind: "grid", name: "C", offset: 0, cut: true })',
  'section-off': 'V.setSection(null)',
  highlight: 'V.setView("iso"); V.setSection(null); V.setHighlight(ids("STR"))',
  'highlight-off': 'V.setHighlight(null)',
  activate: 'V.setView("iso"); V.setHighlight(null); V.setPickable((el) => el.model === "ARC")',
  'activate-off': 'V.setPickable(null)',
  isolate:
    'V.setPickable(null); V.setVisibility((el) => el.model === "ARC" || el.model === "STR")',
  'isolate-off': 'V.setVisibility(() => true)',
  ortho: 'V.setProjection("ortho")',
  persp: 'V.setProjection("persp")',

  /* ── Phase 2b, the same list and order as scripts/screenshot.cjs ─────────── */
  hover: { js: 'V.setView("iso"); V.setSelected([]); V.setTool("select")', input: [MOVE(HOVER[0], HOVER[1])] },
  select: { js: '', input: [CLICK(HOVER[0], HOVER[1])] },
  multiselect: { js: '', input: [CLICK(SECOND[0], SECOND[1], { ctrl: true })] },
  'dblclick-frame': { js: '', input: [DBLCLICK(HOVER[0], HOVER[1]), { wait: 900 }] },
  'snap-corner': {
    js: 'V.setView("iso"); V.setSelected([]); V.setTool("spot"); V.setSnap(true)',
    input: [MOVE(CORNER[0], CORNER[1])]
  },
  'snap-measure': { js: 'V.setTool("measure")', input: [MOVE(CORNER[0], CORNER[1])] },
  'cube-hover': { js: 'V.setTool("select"); V.setView("iso")', input: [MOVE(CUBE.e[0], CUBE.e[1])] },
  'cube-click-east': { js: '', input: [CLICK(CUBE.e[0], CUBE.e[1]), { wait: 1200 }] },

  ...CHROME_STATES,
  ...PROP_STATES,
  ...FILTER_STATES,
  ...ANNOTATION_STATES,
  ...COLOR_STATES,
  ...LANDING_STATES,
  ...CHAT_STATES
}

/**
 * Strip the designed chrome so the stage is the whole window, as the app's stage is — with a
 * stylesheet and a data attribute, because React owns every inline style in the template and
 * restores it on the next re-render (and 2b's clicks cause re-renders). Re-run before each
 * capture so a node the shell has only just mounted is caught.
 */
const BARE = `
  (() => {
    const stage = document.querySelector('[data-role="stage"]');
    if (!stage) return 'no-stage';
    if (!document.getElementById('sgvue-bare')) {
      const style = document.createElement('style');
      style.id = 'sgvue-bare';
      style.textContent =
        '[data-sgvue-bare]{display:none !important}' +
        '[data-role="stage"]{position:fixed !important;inset:0 !important;width:100% !important;height:100% !important;margin:0 !important}';
      document.head.appendChild(style);
    }
    let el = stage;
    while (el && el.parentElement && el !== document.body) {
      for (const sib of el.parentElement.children) if (sib !== el) sib.setAttribute('data-sgvue-bare', '');
      el = el.parentElement;
    }
    // The viewport, the annotation overlay and the view cube are what Phase 2 is judged on.
    const keep = '[data-role="viewport"],[data-role="overlay"],[data-role="cube"]';
    for (const child of [...stage.children]) {
      if (!child.matches(keep)) child.setAttribute('data-sgvue-bare', '');
    }
    window.dispatchEvent(new Event('resize'));
    return 'bare';
  })()
`

app.enableSandbox()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE[0],
    height: SIZE[1],
    useContentSize: true,
    frame: false,
    x: 0,
    y: 0,
    show: true,
    backgroundColor: '#0F1516',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  win.setContentSize(SIZE[0], SIZE[1])
  win.setBounds({ x: 0, y: 0, width: SIZE[0], height: SIZE[1] })

  win.webContents.on('console-message', (e) => console.log(`[proto:${e.level}] ${e.message}`))

  // Phase 5 persists saved filter sets and viewpoints to `localStorage` under the design's own
  // keys, so a second capture run would start with the first run's sets already in the card.
  // Both sides clear it before loading, which is what makes `filter-saved-set` and
  // `viewpoints-one-saved` say the same thing on every run.
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })

  await win.loadURL(URL)
  await wait(4000) // CDN React + three

  // "open all four as a federation →" on the landing page.
  //
  // `SGVUE_LANDING=1` leaves it alone, which is Phase 8: its states start on the landing page
  // and open the federation through that same button themselves. It mirrors the app side's
  // `#mock&landing` (`src/renderer/App.tsx`), so both harnesses stop in the same place.
  if (process.env.SGVUE_LANDING === '1') {
    console.log('boot = skipped (SGVUE_LANDING=1)')
  } else {
    const booted = await win.webContents.executeJavaScript(`
      (() => {
        const b = [...document.querySelectorAll('button')].find((x) => /open all/i.test(x.textContent || ''));
        if (!b) return 'no-button';
        b.click();
        return 'clicked';
      })()
    `)
    console.log('boot =', booted)
    await wait(6000)
  }

  if (BARE_ON) {
    const bare = await win.webContents.executeJavaScript(BARE)
    console.log('chrome =', bare)
  } else {
    console.log('chrome = kept (SGVUE_BARE=0)')
  }
  // Until Phase 6 the app recorded `grids: true` and drew nothing, so the prototype's grid
  // lines, bubbles and level tags were switched off here to keep the two comparable. The app
  // draws them now, so nothing is suppressed: both sides open with grids on and levels off,
  // which is the designed default state.
  await win.webContents.executeJavaScript(
    `(() => { const V = window.__ifcViewer; if (!V) return 'no-viewer'; V.setTool('select'); return 'ok' })()`
  )
  await wait(1500)

  await mkdir(OUT, { recursive: true })
  // Phase 8 runs states on the **landing page**, where the prototype has no viewer at all
  // (nothing loads up front — `SGVue.dc.html:1095`), so a missing viewer is no longer a
  // refusal. `V` is simply null there and `ids` answers with an empty list; the states that
  // need a viewer only ever run once a federation is open.
  const run = (js) =>
    win.webContents.executeJavaScript(`
      (async () => {
        const V = window.__ifcViewer || null;
        const ids = (m) => V ? [...V.recs.values()].filter((r) => r.el.model === m).map((r) => r.el.id) : [];
        ${UI}
        ${js};
        return V ? 'ok' : 'ok-no-viewer';
      })()
    `)

  for (const theme of THEMES) {
    await win.webContents.executeJavaScript(
      // Through the designed toolbar control when it is in the DOM, not by writing the
      // attribute: the prototype's `setModels` rebuilds its viewer with `this.state.theme`, so
      // a theme set behind the component's back reverts the *scene* to dark the moment a model
      // is unloaded, while the CSS chrome stays light. Falls back to the attribute in bare
      // mode, where the toolbar is hidden and nothing rebuilds the viewer.
      `(() => {
        const want = ${JSON.stringify(theme)};
        if ((document.documentElement.dataset.theme || 'dark') !== want) {
          // The toolbar's control when the shell is up; the landing footer's own when it is
          // not (SGVue.dc.html:824) — writing the attribute instead leaves state.theme dark,
          // and boot() then builds the scene dark under a light chrome.
          const tips = ['Light / dark', 'switch to light', 'switch to dark'];
          const b = [...document.querySelectorAll('button')].find((x) => tips.includes(x.dataset.tip));
          if (b) { b.click(); return 'clicked'; }
        }
        document.documentElement.dataset.theme = want;
        if (window.__ifcViewer) window.__ifcViewer.setTheme(want);
        return 'attr';
      })()`
    )
    await wait(500)
    for (const state of STATES) {
      const entry = STATE_JS[state]
      if (entry === undefined) {
        console.log(`unknown state "${state}"`)
        continue
      }
      const { js, input, after } = typeof entry === 'string' ? { js: entry } : entry
      const said = js ? await run(js) : 'ok'
      if (input) {
        // A state's own JavaScript may have started a 620 ms flight; hover is evaluated where
        // the pointer is *when it moves*, so let the camera settle first.
        await wait(SETTLE)
        for (const step of input) await sendInput(win, step)
      }
      // Phase 4: a menu the mouse has just opened, then chosen from.
      if (after) await run(after)
      // The shell re-renders on a click; re-hide anything it has just mounted — *before* the
      // settle, because `capturePage` hands back the last composited frame and a hide that
      // has not been painted yet is a property card in the middle of the parity shot.
      if (BARE_ON) await win.webContents.executeJavaScript(BARE)
      await wait(SETTLE)
      const image = await win.webContents.capturePage()
      const path = join(OUT, `${state}-${theme}.png`)
      await writeFile(path, image.toPNG())
      await writeFile(join(OUT, `${state}-${theme}.json`), await win.webContents.executeJavaScript(RECTS))
      const size = image.getSize()
      console.log(`saved ${path} (${size.width}×${size.height}, ${said})`)
    }
  }

  console.log(
    'debug =',
    await win.webContents.executeJavaScript(
      `window.__ifcViewer ? JSON.stringify(window.__ifcViewer.debug()) : '"no-viewer"'`
    )
  )
  guard.sample('done')
  guard.stop()
  app.exit(0)
})
