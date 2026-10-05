/**
 * The shell — `SGVue.dc.html:61` (the root box) and `:218–220` (the stage), with the
 * sidebar/rail, toolbar, cards and loading badge mounted in the design's own order. Since
 * 2026-10-01 the stage's bottom edge is one row (`app/BottomRow.tsx`), mounted where the
 * design's hint bar and status bar are: the action bar and the status bar, the hint and the
 * reset pill, the Ask pill. The last two left the design's order to join it, so `reset` and
 * `Ask` are the last two stops of the stage's tab order. The stage declares the action bar's
 * lane as `--abar` beside `--rlane`, and the bottom row's — what its centre zone stands above
 * one line, which the chat panel and the property card clear — as `--brow`.
 *
 * `componentDidMount` (`:857–875`) becomes the effect below: create the viewer, wire its
 * callbacks into the store exactly as `initViewer`'s `on` map does, observe the toolbar for
 * `cardTop` and the stage for `vpW`, and listen for the keyboard shortcuts.
 *
 * The landing page (`:721`) covers the shell while `!booted`, at z-index 30, exactly as the
 * design's `showLanding` does. One structural difference, and it is invisible: the design
 * creates its renderer inside `boot()`, ours at mount, so the landing overlays a live but
 * empty stage rather than an absent one. Every failure below returns to it with the reason in
 * the designed banner.
 */
import { useEffect, useRef, useState } from 'react'
import { federation as fed } from './model/federation-store'
import { installBoot } from './model/boot'
import {
  abortChat,
  chatPayloads,
  installAi,
  lastRequestSnapshot,
  lastTurnLog,
  lastTurnRecord,
  runToolOnce,
  runToolWithUi,
  runTurnOnce,
  scriptedTurn,
  sendChat,
  setTurnRecording
} from './ai/bridge'
import { traceCues, traceFrame, type TraceLayout } from './ai/trace'
import { pinTrace, traceBegin, traceFail, traceNow, traceState } from './ai/trace-store'
import { RULES, TOOLS } from '../shared/tool-schemas'
import { dropFiles, openLibrary } from './model/upload-pipeline'
import type { Rule } from '../shared/rules'
import { api } from './api'
import { el } from './dom'
import { DEVTOOLS } from './dev/flags'
import { onKey } from './state/keys'
import { lastDrawCalls, useShell, type ShellState, type UploadRow } from './state/shell'
import { clampCtxX } from './state/selectors/ctx'
import { abar, brow, cardTopFrom, rlane } from './state/selectors/lanes'
import { hasActionBar, sceneSummary } from './state/selectors/status'
import { pickableFor } from './state/selectors/models'
import { createViewer, type SectionsConfig, type Viewer } from './viewer/viewer-core'
import BottomRow from './app/BottomRow'
import ColorLegend from './app/ColorLegend'
import ContextMenu from './app/ContextMenu'
import Preferences from './app/Preferences'
import ChatPanel from './app/ChatPanel'
import CoordsCard from './app/CoordsCard'
import FilterCard from './app/FilterCard'
import Landing from './app/Landing'
import LoadingBadge from './app/LoadingBadge'
import MarkupsCard from './app/MarkupsCard'
import ProjectCard from './app/ProjectCard'
import PropertyCard from './app/PropertyCard'
import Rail from './app/Rail'
import SectionCard from './app/SectionCard'
import Sidebar from './app/Sidebar'
import Toolbar from './app/Toolbar'
import ViewsCard from './app/ViewsCard'
import VisibilityFrame from './app/VisibilityFrame'
import { kickTrace, traceLoop } from './app/Trace'
import { paintVee, pinVeeFrame, veeColours, veeWakes } from './app/Vee'
import { veeCell, veeGrid, type VeeState } from './app/vee-grid'
import { s } from './app/css'

/**
 * The chat keys `window.__sgvueDev.chat.setState` may write, and no others. `chatStage` is the
 * design's busy-row line, which the parity harness still names for the prototype's sake; the
 * app has had no such row since 2026-10-01, and the key is dropped on the way in.
 */
type ChatPatch = Partial<
  Pick<
    ShellState,
    'chatOpen' | 'chatMsgs' | 'chatInput' | 'chatBusy' | 'chatErr' | 'chatReplyTo' | 'chatW' | 'chatH'
  >
> & { chatStage?: string }


function useShellHost(): {
  canvas: React.RefObject<HTMLCanvasElement | null>
  overlay: React.RefObject<HTMLDivElement | null>
  cube: React.RefObject<HTMLCanvasElement | null>
  stage: React.RefObject<HTMLDivElement | null>
} {
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const cube = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let viewer: Viewer | null = null
    const shell = useShell.getState()
    document.documentElement.dataset.theme = shell.theme

    const ready = (async () => {
      const host = canvas.current
      if (!host) return
      viewer = await createViewer({
        canvas: host,
        cubeCanvas: cube.current,
        overlay: overlay.current,
        theme: useShell.getState().theme,
        // `'auto'` is WebGL2 since 2026-09-17 (`scene.ts`, and `CLAUDE.md` Decisions).
        // `#backend=webgpu` is a **dev-build measurement switch**, so the benchmark can run
        // both backends under the guard — `scripts/lib/backend.cjs` only ever appends it to
        // the mock federation's own hash, and only with two environment variables set. A
        // shipped build ignores it: `DEVTOOLS` is statically false there, so Rollup drops the
        // test and `'auto'` is the only thing this can ask for. That matters because a
        // `sgvue://` launch link arrives in this same hash (`main/index.ts`), and which
        // renderer runs is not a link's to choose — `main/deep-link.ts`'s `launchHash` is the
        // other half of the same rule.
        backend:
          DEVTOOLS && /backend=webgpu/.test(location.hash + location.search) ? 'webgpu' : 'auto',
        shadows: useShell.getState().shadows,
        // `SGVue.dc.html:890–896` — the viewer's callbacks, into the store.
        on: {
          select: (id, mode) => useShell.getState().select(id, false, mode),
          context: (c) =>
            useShell
              .getState()
              // `:892` clamps both axes here; since Phase 10 the top is clamped by
              // `app/ContextMenu.tsx` against the menu's own measured height instead, so the
              // raw `y` is what travels (`selectors/ctx.ts`, `clampCtxY`).
              .setCtx(c ? { x: clampCtxX(c.x, window.innerWidth), y: c.y, id: c.id } : null),
          projection: (p) => useShell.getState().setProjection(p),
          hint: (h) => useShell.getState().setHint(h),
          stats: (st) => useShell.getState().setStats(st),
          cubeView: () => useShell.getState().clearView(),
          measure: (l) => useShell.getState().setMeasures(l),
          spot: (l) => useShell.getState().setSpots(l),
          gridClick: (name) => useShell.getState().gridClick(name)
        }
      })
      if (disposed) {
        viewer.dispose()
        viewer = null
        return
      }
      fed.attach(viewer)
      console.log(`[sgvue] renderer ready · backend ${viewer.backend}`)

      // `initViewer`'s tail (`:899–905`): push the current view state into a fresh viewer.
      const st = useShell.getState()
      viewer.setGrids(st.grids)
      viewer.setLevels(st.levels)
      viewer.setGroundGrid(st.groundGrid)
      viewer.setCoords(st.coords)
      viewer.setTool(st.tool)
      viewer.setModelColors(st.modelColors, st.nativeMats)
      if (st.active) viewer.setPickable(pickableFor(st.active))
      if (!st.snap) viewer.setSnap(false)
      // `:904` divides the card's millimetres by 1000 once, which `setSec` also does. An empty
      // patch changes nothing and pushes both planes.
      if (st.sections.grid.name || st.sections.level.name) st.setSec('grid', {})
      st.applyVis()

      if (DEVTOOLS) await installDevTools(viewer)
    })().catch((err: unknown) => {
      // `SGVue.dc.html:874` — the renderer itself failed. The design writes the reason into
      // its load message; here the landing page is already up, so it goes into its banner.
      console.error(err)
      useShell.setState({
        booted: false,
        ready: false,
        initErr: 'Renderer failed: ' + (err instanceof Error ? err.message : String(err))
      })
    })

    /**
     * Native drag-drop anywhere in the window, which is what the designed drop zone sits over
     * (fidelity contract, allowed deviations). The `File` carries the bytes and the preload's
     * `webUtils.getPathForFile` carries the path, so a dropped file is resumable.
     */
    const onDragOver = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      useShell.getState().setDragging(false)
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length) void dropFiles(files)
    }

    /**
     * Main watches the Electron GPU helper process (`src/main/gpu-guard.ts`, and the three
     * kernel panics recorded there). When it says the budget is blown, the viewer stops
     * drawing at once — `dispose()` cancels the frame loop, the input handlers and every GPU
     * resource, which is what actually releases the pressure.
     */
    const offGuard = api()?.onGpuGuardTripped?.(({ gpuMB, limitMB }) => {
      console.error(
        `[sgvue] GPU process ${gpuMB} MB exceeded the ${limitMB} MB limit — the viewer has been stopped. Reload the window to continue.`
      )
      disposed = true
      void ready.then(() => {
        fed.attach(null)
        viewer?.dispose()
        viewer = null
      })
      // Never leave the user on a broken viewer: back to the landing page with the reason.
      useShell.setState({
        booted: false,
        ready: false,
        initErr: `The 3D renderer was stopped — the graphics process reached ${gpuMB} MB, past the ${limitMB} MB limit. Reload the window to open a model again.`
      })
    })

    const stopBoot = installBoot()
    // The assistant's renderer half: it runs the tools main forwards and turns the turn's
    // events into panel state. No key and no SDK reach this process.
    const stopAi = installAi()

    /* ── cardTop and vpW (`SGVue.dc.html:873–874`) ── */
    const observers: ResizeObserver[] = []
    const toolbar = el('toolbar')
    if (toolbar) {
      const ro = new ResizeObserver(() => {
        const h = cardTopFrom(toolbar.getBoundingClientRect().height)
        if (h !== useShell.getState().cardTop) useShell.getState().setCardTop(h)
      })
      ro.observe(toolbar)
      observers.push(ro)
    }
    if (stage.current) {
      const node = stage.current
      const ro = new ResizeObserver(() => {
        const w = Math.round(node.clientWidth)
        if (w !== useShell.getState().vpW) useShell.getState().setVpW(w)
      })
      ro.observe(node)
      observers.push(ro)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      disposed = true
      offGuard?.()
      stopBoot()
      stopAi()
      for (const ro of observers) ro.disconnect()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      fed.dispose()
      void ready.then(() => viewer?.dispose())
      if (DEVTOOLS) delete (window as unknown as Record<string, unknown>).__sgvueDev
    }
  }, [])

  return { canvas, overlay, cube, stage }
}

/**
 * `window.__sgvueDev` — the parity and benchmark harnesses' entry point, and the `#mock`
 * federation. Absent from a production bundle: `DEVTOOLS` is statically false there, so
 * Rollup drops this and the mock adapter with it.
 *
 * The state helpers call the viewer directly rather than going through the store, which is
 * what `tests/parity/phase2a` and `phase2b` were captured against.
 */
async function installDevTools(viewer: Viewer): Promise<void> {
  const shell = (): ReturnType<typeof useShell.getState> => useShell.getState()
  const dev = {
    viewer,
    stats: () => ({ ...shell().stats, calls: lastDrawCalls() }),
    debug: () => viewer.debug(),
    setTheme: (t: 'dark' | 'light') => shell().setTheme(t),
    setView: (v: string) => viewer.setView(v),
    setProjection: (p: 'persp' | 'ortho') => viewer.setProjection(p),
    zoomExtents: () => viewer.zoomExtents(),
    /**
     * One plane, straight to the viewer: `('grid', 'C')` sets the gridline plane and
     * `('storey', 'L2')` the level plane, each leaving the other as the viewer has it; a kind
     * with no name clears that plane, and `null` clears both.
     */
    setSection: (kind: 'grid' | 'storey' | null, name = '', cut = true) => {
      if (!kind) return viewer.setSections({ grid: null, level: null })
      const live = viewer.debug().section as SectionsConfig
      viewer.setSections({
        ...live,
        [kind === 'storey' ? 'level' : 'grid']: name ? { kind, name, cut } : null
      })
    },
    setVisibility: (fn: ((el: { id: number; model: string }) => boolean) | null) =>
      viewer.setVisibility(fn ?? (() => true)),
    highlightModel: (key: string | null) =>
      viewer.setHighlight(
        key === null
          ? null
          : viewer.elementIds().filter((id) => shell().byId.get(id)?.model === key)
      ),
    activate: (key: string | null) => viewer.setPickable(pickableFor(key)),
    select: (ids: number[] | null) => shell().select(ids),
    selected: () => shell().selIds,
    context: () => shell().ctx,
    hint: () => shell().hint,
    setTool: (t: 'select' | 'measure' | 'spot') => viewer.setTool(t),
    setSnap: (b: boolean) => viewer.setSnap(b),
    setCoords: (c: Record<string, number>) => viewer.setCoords(c),
    /**
     * Phase 7. The design gives colour-by-property no manual control — only the assistant's
     * `color_by_property` tool sets it (`SGVue.dc.html:1547`), which is Phase 9 — so the
     * parity harness reaches the store action here, exactly as it reaches the prototype's own
     * `colorBy` on the other side. The legend's rows and its × are designed controls and are
     * clicked through the DOM on both sides.
     */
    colorBy: (prop: string | null, rules?: Rule[]) => shell().setColorBy(prop, rules),
    scheme: () => shell().colorBy,
    /* ── Phase 6: what the real-model harness reads back ── */
    measures: () => shell().measures,
    spots: () => shell().spots,
    zoomTo: (id: number) => viewer.zoomTo(id),
    elementBox: (id: number) => {
      const b = viewer.elementBox(id)
      return b ? [...b.min.toArray(), ...b.max.toArray()] : null
    },
    /**
     * Fetch a model over `sgvue-file:` (what the benchmark harness serves) and load it,
     * bypassing the staged rows — `bench.cjs` and `shell-sanity.cjs` measure the pipeline,
     * not the animation. `openPath` below is the whole designed path instead.
     */
    open: async (url: string, name: string) => {
      const response = await fetch(url)
      const blob = await response.blob()
      const item = await fed.prepare({ path: url, name, blob }, () => {})
      await fed.addBatch([item])
    },
    /** The real pipeline, from a path: admit → token → protocol stream → worker → rows. */
    openPath: (path: string) => openLibrary([{ key: path, name: path, file: path, swatch: '', path }]),
    uploads: () => shell().uploads,
    booted: () => shell().booted,
    initErr: () => shell().initErr,
    /**
     * Phase 8. The landing page is the one surface whose upload rows the two sides cannot
     * reach the same way — the prototype's five stages are a timer, ours are a real worker —
     * so the parity harness sets the **row state** through each side's own state API, exactly
     * as Phase 7 set `colorBy` through each side's own method. Every other control in those
     * captures is a designed one, clicked by its own copy on both sides.
     */
    setUploads: (rows: UploadRow[]) => useShell.setState({ uploads: rows }),
    setDragging: (b: boolean) => shell().setDragging(b),
    setInitErr: (m: string) => shell().setInitErr(m),
    setLinkCopied: (b: boolean) => shell().setLinkCopied(b),
    /** Orbit for `seconds` by walking the camera goal, for the benchmark. */
    spin: (seconds: number) =>
      new Promise<void>((done) => {
        const start = performance.now()
        const base = viewer.getCamera()
        const step = (): void => {
          const t = (performance.now() - start) / 1000
          if (t >= seconds) return done()
          viewer.setCamera({ ...base, theta: base.theta + t * 0.6 })
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
    federation: () => shell().federation,
    elementIds: () => viewer.elementIds(),
    /**
     * 2026-10-01 — Vee, the assistant's pixel mascot (`app/Vee.tsx`). `pin(n)` holds every
     * sprite at clock frame `n`, so a capture never catches a blink (`pin(null)` lets the clock
     * run again). `paint` draws any state at any frame on a canvas the harness supplies, with
     * the app's own painter in the live theme's colours, and `colours` names those colours:
     * `scripts/screenshot.cjs`'s `vee-sheet` shows all five states with them side by side —
     * the app's own sprites show `idle`, and the other four only on a reply while its turn runs.
     * `cell` is the size rule and `wakes` the clock's count, for the harness to read back.
     */
    vee: {
      pin: (frame: number | null) => pinVeeFrame(frame),
      paint: (canvas: HTMLCanvasElement, state: VeeState, frame: number, cell: number) =>
        paintVee(canvas, veeGrid(state, frame), cell),
      colours: () => veeColours(),
      /** The app's own size rule: device pixels to a cell at this window's ratio (`veeCell`). */
      cell: () => veeCell(window.devicePixelRatio || 1),
      /** How many times the sprite clock's timer has fired — it sleeps between changes. */
      wakes: () => veeWakes()
    },
    /**
     * 2026-09-20. What *this build* can do, read from the catalogue itself rather than from a
     * list a harness keeps.
     *
     * `scripts/ai-eval.cjs` carries cases for capabilities the assistant does not have yet
     * (`docs/AI_REVIEW.md` §9: acting on a found id list, an "is absent" operator, filter sets
     * by name, a proximity tool). A case that needs one has to report **n/a** rather than fail,
     * and it has to start passing by itself the day the capability lands — which only works if
     * the answer comes from `TOOLS` and `RULES`, not from a constant somebody has to remember
     * to update.
     */
    capabilities: () => ({
      tools: TOOLS.map((t) => ({
        name: t.name,
        kind: t.kind,
        inputs: Object.keys(t.input_schema.properties ?? {}),
        /**
         * Each input's enum, where it has one (2026-09-20). A capability can live in an
         * operation name as well as in a tool name: named filter sets are four `op` values on
         * `manage_filters`, not a tool called `save_filter_set`, and a detector that only ever
         * read tool names would report the capability missing for ever.
         */
        enums: Object.fromEntries(
          Object.entries(t.input_schema.properties ?? {})
            .filter(([, v]) => Array.isArray((v as { enum?: unknown[] }).enum))
            .map(([k, v]) => [k, ((v as { enum: unknown[] }).enum ?? []).map(String)])
        )
      })),
      ruleOps: ((RULES.items?.properties?.op?.enum ?? []) as readonly unknown[]).map(String)
    }),
    /**
     * 2026-09-20. The filter stack **with its step colours**, for `scripts/ai-eval.cjs`.
     *
     * `get_view_state` reports every other field of a step (`ai/executors/read.ts`) and
     * deliberately not the colour — the model has no use for it. "Two highlight steps in two
     * different colours" is an outcome the eval has to be able to check, so it is read here
     * instead of widening a tool the assistant sees.
     */
    evalStack: () =>
      shell().stack.map((x) => ({ id: x.id, on: x.on, action: x.action, color: x.color })),
    /**
     * 2026-09-20. The two doors `scripts/shell-sanity.cjs`'s `boxes` block needs to check the
     * per-element boxes on a real model the way the assistant would meet them: one read-only
     * statement against the model database, and one tool run through the real executor. Both
     * are read-only by construction — the SQL worker is `PRAGMA query_only` and the catalogue
     * has no writing tool — and both are dropped from a production bundle with `DEVTOOLS`.
     */
    sql: (statement: string) => fed.query(statement),
    tool: (name: string, input: unknown) => runToolOnce(name, input),
    /**
     * 2026-09-20. The same executor as `tool` above, returning the **panel's** half of the
     * outcome as well — the chips, the table and the patch the 5 % scope guard held back.
     * `scripts/ai-audit.cjs` cannot see any of it through `tool`, because only `forModel`
     * crosses IPC. Read-only by construction, and dropped from a production bundle.
     */
    toolUi: (name: string, input: unknown) => runToolWithUi(name, input),
    /**
     * Phase 9a. `scripts/ai-acceptance.cjs` sends the design's four acceptance prompts
     * through the **real** turn — the same `sendChat` the composer will call in 9b — and
     * reads back what the tools actually did. It is the only way to exercise the gateway
     * end to end before the panel exists, and it runs only when a key is already in the
     * environment.
     */
    chat: {
      send: (text: string) => sendChat(text),
      abort: () => abortChat(),
      messages: () => shell().chatMsgs,
      error: () => shell().chatErr,
      busy: () => shell().chatBusy,
      snapshot: () => lastRequestSnapshot(),
      log: () => lastTurnLog(),
      /**
       * 2026-09-20. `scripts/ai-eval.cjs` grades a turn on the calls the model made — their
       * names, their **arguments**, their order and what came back — and on how the turn
       * ended. `log()` above has names and durations only. Off until asked, and absent from a
       * production bundle (`ai/bridge.ts`).
       */
      record: (on: boolean) => setTurnRecording(on),
      recorded: () => lastTurnRecord(),
      reset: () => {
        traceFail()
        useShell.setState({ chatMsgs: [], chatErr: '', chatBusy: false })
      },
      /**
       * 2026-09-20. One turn's tool sequence without the API, for `scripts/ai-audit.cjs`:
       * the calls accumulate into one `TurnState` and the message is committed with its
       * chips, table, pending patch and undo snapshot — which is what makes the three
       * designed controls below reachable. Read-only with respect to model data; every call
       * goes through the same executors a real turn uses.
       */
      turn: (text: string, calls: { name: string; input?: unknown }[], reply?: string) =>
        runTurnOnce(text, calls, reply),
      /**
       * 2026-10-01. The same turn **a step at a time** (`ai/bridge.ts`, `scriptedTurn`):
       * `begin(text)`, `start()` — the stream's `tool_start` — `exec(name, input)`,
       * `done(reply)`, `fail(message)`. Each step is stamped with the trace's clock, so with
       * that clock pinned (`trace.pin` below) a harness decides when each one happened and can
       * hold the thinking trace at any instant of its choreography.
       */
      step: scriptedTurn,
      /** The cached schema block and the per-turn view-state message, as a turn builds them. */
      payloads: () => chatPayloads(),
      apply: (index: number) => shell().applyPending(index),
      dismiss: (index: number) => shell().dismissPending(index),
      revert: (index: number) => shell().revertTurn(index),
      /**
       * Phase 9b's parity states. A transcript, a busy row and a reply strip cannot be
       * produced without an API key, so both sides are driven through their **own** state —
       * this on ours, the logic instance's `setState` on the prototype's, exactly as Phase 7
       * drove `colorBy` and Phase 8 drove the upload rows. Every other control in those
       * captures is a designed one, clicked by its own copy on both sides.
       */
      setState: ({ chatStage: _stage, ...patch }: ChatPatch) => {
        // A turn "in flight" set by state has no events behind it: it is a turn that has only
        // begun, which is what the live reply then shows — `Vee`, `Thinking`.
        if (patch.chatBusy === true && !shell().chatBusy) {
          traceBegin(shell().federation, (patch.chatMsgs ?? shell().chatMsgs).length)
        } else if (patch.chatBusy === false && shell().chatBusy) traceFail()
        useShell.setState(patch)
      }
    },
    /**
     * 2026-10-01 — the thinking trace (`ai/trace.ts`, `app/Trace.tsx`). `pin(T)` holds the
     * trace's clock at `T` seconds — every event is then stamped `T` and the panel draws the
     * turn as it stands at `T` — and `pin(null)` lets it run again; `now()` is that clock.
     * `cues()` is the live turn's cue times and `frame(layout)` what `traceFrame` draws at
     * `now()`, for a harness to read back; `loop()` says whether the panel's frame loop is
     * waiting for a frame and how many it has drawn.
     */
    trace: {
      pin: (T: number | null) => {
        pinTrace(T)
        kickTrace()
      },
      now: () => traceNow(),
      timeline: () => traceState().timeline,
      index: () => traceState().index,
      cues: () => {
        const tl = traceState().timeline
        return tl ? traceCues(tl) : null
      },
      frame: (layout: TraceLayout) => {
        const tl = traceState().timeline
        return tl ? traceFrame(tl, traceNow(), layout) : null
      },
      loop: () => traceLoop()
    }
  }
  ;(window as unknown as Record<string, unknown>).__sgvueDev = dev

  /**
   * The design's own mock federation, via `#mock`.
   *
   * It is registered as the **library** and opened through the landing page's own "open all N
   * as a federation" handler, which is what the prototype's four pills are. `#mock&landing`
   * stops there instead, with the four pills on screen — which is what Phase 8's landing
   * captures need and what every earlier phase's capture must not do.
   */
  const where = location.hash + location.search
  if (!/(^|[#&?])mock(=1)?\b/.test(where)) return
  const t0 = performance.now()
  const { SAMPLE_FILES } = await import('./dev/mock-adapter')
  const { demoLoader } = await import('./model/demo')
  /**
   * `#mock&hostile` — the same federation with five of its own values carrying text that
   * reads like an instruction (`dev/hostile.ts`). It is `scripts/ai-eval.cjs`'s `resist`
   * fixture and has no other caller; every parity capture and every other harness loads the
   * plain mock, which is unchanged.
   */
  const hostile = /(^|[#&?])hostile\b/.test(where)
    ? (await import('./dev/hostile')).HOSTILE_OPTIONS
    : undefined
  shell().setLibrary(
    SAMPLE_FILES.map((f) => ({ key: f.key, name: f.name, file: f.file, swatch: f.swatch }))
  )
  // The same loader the landing page's demo button uses (`model/demo.ts`).
  fed.setLibraryLoader(demoLoader(hostile))
  if (/(^|[#&?])landing\b/.test(where)) return
  // One batch, as the design's "open all four as a federation" is one `boot()`: the camera is
  // framed once, on the whole federation, not on whichever discipline arrives first.
  await openLibrary(shell().library)
  const federation = shell().federation
  console.log(
    `[sgvue] mock federation in ${(performance.now() - t0).toFixed(0)} ms · ` +
      `${federation.elements.length.toLocaleString('en-US')} elements · ` +
      `${federation.storeys.length} storeys · ${federation.grids.length} grids · ` +
      `${viewer.elementIds().length} rendered`
  )
  console.log('[sgvue] debug', viewer.debug())
}

/**
 * What a screen reader is told the canvas holds — the canvas's text alternative, which it
 * points at with `aria-describedby`. `.sr-only` draws nothing (`styles/a11y.css`).
 *
 * A component of its own since 2026-10-02, so that this subscription is its own. The summary
 * names the selected element and the visible count; read in `App`, every selection and every
 * visibility change re-rendered the whole shell for the sake of one sentence nobody sees — each
 * card, the toolbar, and the bottom row, which measures its layout after every render. The
 * element, its place among the stage's children and its id are what they were.
 */
function SceneSummary(): React.JSX.Element {
  const scene = useShell(sceneSummary)
  return (
    <p id="sgvue-scene" className="sr-only">
      {scene}
    </p>
  )
}

export default function App(): React.JSX.Element {
  const panelOpen = useShell((st) => st.panelOpen)
  // Preferences opens from the native menu (⌘,) and from nowhere else — no designed surface
  // gains a control (fidelity contract, allowed deviations).
  const [prefsOpen, setPrefsOpen] = useState(false)
  useEffect(() => api()?.onOpenSettings(() => setPrefsOpen(true)), [])
  // `:2050` reserves the lane on `sel` — the *derived* card object, not the id list — so a
  // selected id that is no longer in the federation reserves nothing, exactly as it draws
  // nothing. The two decisions have to agree or the stage keeps a lane with no card in it.
  const hasCard = useShell((st) => st.sel != null && st.byId.has(st.sel))
  const vpW = useShell((st) => st.vpW)
  // 2026-10-01 — the action bar's lane, declared like `--rlane`: reserved exactly while the bar
  // is drawn, so the colour legend and the cards that stop above the status bar clear it.
  const hasActions = useShell(hasActionBar)
  // 2026-10-01 — and the bottom row's: what its centre zone stands above the one-line row, as
  // `app/BottomRow.tsx` measured it. `0px` whenever that row is one line.
  const rowLane = useShell((st) => st.brow)
  const { canvas, overlay, cube, stage } = useShellHost()

  return (
    <div
      style={s(
        'position:fixed;inset:0;display:flex;background:var(--ground);color:var(--ink);font:400 13px/1.4 var(--sans)'
      )}
    >
      {panelOpen ? <Sidebar /> : <Rail />}

      <main
        data-role="stage"
        ref={stage}
        style={s(
          `flex:1;position:relative;min-width:0;overflow:hidden;background:var(--ground);--rlane:${rlane(hasCard, vpW)};--abar:${abar(hasActions)};--brow:${brow(rowLane)}`
        )}
      >
        <canvas
          data-role="viewport"
          ref={canvas}
          aria-label="3D view"
          aria-describedby="sgvue-scene"
          style={s(
            'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none'
          )}
        />
        {/* The canvas's text alternative: `<p id="sgvue-scene">`, which draws nothing. */}
        <SceneSummary />
        <div
          data-role="overlay"
          ref={overlay}
          style={s('position:absolute;inset:0;pointer-events:none;overflow:hidden')}
        />
        <Toolbar />
        <ProjectCard />
        {/* `:280` — Viewpoints, then the cube, then the frame: the design's own order. */}
        <ViewsCard />
        <canvas
          data-role="cube"
          ref={cube}
          width={148}
          height={148}
          title="Click a face, edge or corner to look from there"
          style={s('position:absolute;top:8px;right:8px;width:148px;height:148px;display:block')}
        />
        {/* `:305` — the frame. Its pill (`:306`) is in the bottom row below since 2026-10-01. */}
        <VisibilityFrame />
        <PropertyCard />
        {/* `:412` — the legend sits between the property card and the chat panel. */}
        <ColorLegend />
        {/* `:430` — the assistant's panel. Its pill (`:536`) is in the bottom row too. */}
        <ChatPanel />
        {/* `:541`, `:582`, `:605`, `:687` — the design's own order after the property card. */}
        <MarkupsCard />
        <SectionCard />
        <FilterCard />
        <CoordsCard />
        {/* 2026-10-01 — the bottom edge as one row whose zones cannot overlap: the action bar
            (the design's `:711–714`) above the status bar (`:705`), then the hint (`:702`) under
            the reset pill, then the Ask pill. It stands where the design's hint and status bar
            do, so the tab order ends: action bar, reset, Ask. */}
        <BottomRow />
        <LoadingBadge />
      </main>

      {/* `:833` — a child of the root box, not of the stage: a tree row opens it too. */}
      <ContextMenu />
      {/* `:721` — the landing page, z-index 30, over everything while `!booted`. */}
      <Landing />
      {/* Not a designed surface: the native menu's Preferences…, over everything at z 40. */}
      <Preferences open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  )
}
