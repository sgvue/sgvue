/**
 * The sidebar — `SGVue.dc.html:64–207`, ported element for element.
 *
 * Structure, inline styles, `title` / `data-tip` copy and the order of the four blocks
 * (IfcProject, MODELS, STOREYS, the element tree) are the design's. The derived values come
 * from `state/selectors/`, which is where `renderVals()`'s arithmetic lives; the click
 * handlers are bound here, where the design binds them into the same objects.
 *
 * Two owner-requested changes, 2026-10-01 (`CLAUDE.md`, allowed desktop deviations):
 *
 * · **the element tree is eye-first**, like MODELS and STOREYS. The design's group row is
 *   `[chevron][label][count][eye]` (`:179`) and its element row `[name / meta][eye]` (`:191`);
 *   here they are `[eye][label][count][chevron]` and `[eye][name / meta]`. Every piece keeps
 *   its own markup, class and handler — only the column order and, on the element row, which
 *   side carries the 2 px and which the 8 px of padding;
 * · **a file's full path on hover**, as a native `title`: on a loaded model's name block (the
 *   path the federation holds, `fed.sessionFiles()`) and on each row of the `library` popover.
 *   A model with no file behind it — the demo building — has no `title` at all.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { federation as fed } from '../model/federation-store'
import { openDialog, openLibrary } from '../model/upload-pipeline'
import { uploadRows } from '../state/selectors/uploads'
import { pick, useShell, type SideSize } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { modelRows, addableRows } from '../state/selectors/models'
import { storeyRows } from '../state/selectors/storeys'
import { groupTree, rowWindow, withSelection, type TreeItem } from '../state/selectors/tree'
import { treeKeyAction, treeNodes } from '../state/selectors/tree-keys'
import { clampCtxX } from '../state/selectors/ctx'
import { clampSection, sizedTail, TREE_MIN } from '../state/selectors/sidebar'
import {
  matHint,
  nativeToggle,
  on,
  projectButton,
  projectHeader,
  treeTitle
} from '../state/selectors/status'
import { DEVTOOLS } from '../dev/flags'
import { useDialogFocus } from './focus'
import { s } from './css'
import {
  ChevronLeft,
  Cross,
  Eye,
  EyeOff,
  GroupChevron,
  Logo,
  Target,
  Tick,
  Bang
} from './icons'

/**
 * Groups at or above this many rows are windowed; everything smaller renders the design's own
 * DOM, unchanged. Measured on the 137.9 MB reference model: expanding `IfcMember` (6 805 rows)
 * took **501 ms** from click to painted frame, and the cost is linear in the row count. The
 * threshold is above the mock federation's largest group (124), so every parity capture — and
 * anything a reviewer can see on the prototype's own data — takes the unwindowed path.
 */
const WINDOW_MIN_ROWS = 200
/** Rows kept rendered beyond each edge of the viewport, so a fast scroll never shows a gap. */
const OVERSCAN = 10

/**
 * The sidebar's vertical budget when a real storey ladder will not fit — the user's own rule,
 * 2026-09-20: *"go with the 40 percent split"*, for the case they described as "when the storey
 * levels are too much".
 *
 * The design's aside (`:64`) is a column flexbox in which everything above the element tree is
 * rigid and the tree alone is `flex:1;min-height:0` (`:176`), so **the tree absorbs every
 * shortage**. Its own mock federation has six storeys and never meets one; the reference model
 * has twelve, and the tree then falls to **47 px — one row — at the launch window size**.
 *
 * So above the design's own storey count, and only then:
 *
 * · the tree's floor rises from `0` to `40%` of the aside;
 * · the STOREYS rows wrapper (`:161`) gives way **first** and never below three rows;
 * · the MODELS rows wrapper (`:98`) is the last resort, and is untouched until the storey list
 *   is already at that minimum.
 *
 * At six storeys or fewer every style string below is the design's, byte for byte, at every
 * window size — which is what keeps the design's own four-model mock exactly as drawn. That
 * matters more than it sounds: the prototype's tree is only **18.1 % of the aside** at the
 * parity window, so a floor that applied unconditionally would have moved every Phase 3
 * sidebar capture. An earlier version of this also squeezed the MODELS list of a *single*-model
 * federation until "Original materials" sat below the fold — a regression nobody asked for,
 * and what the ordering below exists to prevent.
 */
const DESIGN_STOREY_COUNT = 6

/** The design's storey row: a 24 px eye button in 4 px of padding (`:162`). Measured: 32.0 px. */
const STOREY_ROW_H = 32
/** The rows wrapper's own `padding:2px 12px 8px 10px` (`:161`), inside `min-height` under `border-box`. */
const STOREY_ROWS_PAD = 10

/**
 * What the STOREYS rows wrapper gains. `overflow:auto` is what lets a flex item shrink past its
 * content at all — CSS Flexbox §4.5 only applies the automatic minimum size while `overflow` is
 * `visible` — and the `min-height` is three rows, which is the clamp that makes the ordering
 * work: this list takes the shortage, freezes at three rows, and only then does the other one
 * give. Both factors are integers because Flexbox §9.7 step 4b scales the distributed space by
 * the sum of the unfrozen factors when it is below 1 — a `0.1` on the models list absorbed a
 * tenth of what was needed and the aside overflowed anyway. The scrollbar is the design's own
 * global rule (`design.css:10`), so nothing is added for it.
 *
 * **The factor is a million, and that is the point.** Flexbox distributes a shortage in
 * proportion to `flex-shrink × flex base size`, so a ratio of 100 : 1 still leaks
 * `119 / (100 × 394 + 119) ≈ 0.3 %` of it to the models list — about **0.85 px** of a 280 px
 * shortage at the launch window size, which is enough for `overflow:auto` to decide that list
 * overflows and to draw the design's always-visible scrollbar beside rows that had no need to
 * move. At `STOREY_SHRINK` the same leak is 0.000085 px, two hundred times below Chromium's
 * 1/64 px `LayoutUnit`, so the priority is strict at every size the app can be given. Once the
 * storey list freezes at its three rows the ratio stops mattering: the models list is then the
 * only unfrozen item and absorbs the remainder in full.
 */
const STOREY_SHRINK = 1_000_000
const STOREY_ROWS_SCROLL =
  `;flex:0 ${STOREY_SHRINK} auto;min-height:${3 * STOREY_ROW_H + STOREY_ROWS_PAD}px;overflow:auto`

/**
 * What the MODELS rows wrapper gains: the last resort. It keeps the default shrink factor, so
 * with the storey list frozen at its three rows this is the only item left that can give; until
 * then it is untouched, and a single-model federation never scrolls it at all. Every popover
 * inside it — the override palette, the remove confirmation, the library list — is in flow, so
 * it scrolls with the rows rather than being clipped.
 */
const MODEL_ROWS_SCROLL = ';flex:0 1 auto;overflow:auto'

/**
 * Dev-only: `#rows=<n>` lowers the threshold so the windowed path can be exercised on the mock
 * federation, whose largest group is 124 rows. Statically false in a production build, exactly
 * like `#mock` and `#backend=webgpu`, so Rollup drops it.
 */
const minRows = ((): number => {
  if (!DEVTOOLS) return WINDOW_MIN_ROWS
  const m = /[#&?]rows=(\d+)/.exec(location.hash + location.search)
  return m ? Number(m[1]) : WINDOW_MIN_ROWS
})()

/**
 * The rows of one open group. Above `WINDOW_MIN_ROWS` only the visible slice is in the DOM,
 * with a spacer above and below carrying the rest of the height — so the scrollbar, the
 * scroll positions and every pixel of what is on screen are the same as rendering all of them.
 *
 * Row height is not assumed: the first painted row is measured and the spacers follow it. Every
 * row is exactly the same height, because the design gives the name and the meta line
 * `white-space: nowrap` with an ellipsis, so nothing ever wraps.
 */
function GroupRows({
  items,
  scroller,
  row
}: {
  items: TreeItem[]
  scroller: React.RefObject<HTMLDivElement | null>
  /** `index` is the row's place in the **whole** group, which is what `aria-posinset` needs. */
  row: (it: TreeItem, index: number) => React.JSX.Element
}): React.JSX.Element {
  // The design's own row container (`SGVue.dc.html:189`); the spacers, when there are any, are
  // its first and last children.
  const host = useRef<HTMLDivElement>(null)
  const [rowH, setRowH] = useState(0)
  const [range, setRange] = useState<[number, number]>([0, Math.min(items.length, 60)])
  const windowed = items.length >= minRows

  useLayoutEffect(() => {
    if (!windowed) return
    const sc = scroller.current
    if (!sc) return
    const measure = (): void => {
      const node = host.current
      if (!node) return
      const first = node.children[1] as HTMLElement | undefined
      const h = rowH || (first ? first.getBoundingClientRect().height : 0)
      if (!h) return
      if (h !== rowH) setRowH(h)
      // The group's own top, relative to the viewport of the scroller: negative once scrolled past.
      const viewTop = -(node.getBoundingClientRect().top - sc.getBoundingClientRect().top)
      const next = rowWindow(viewTop, sc.clientHeight, h, items.length, OVERSCAN)
      setRange((prev) => (prev[0] === next[0] && prev[1] === next[1] ? prev : next))
    }
    measure()
    let queued = 0
    const onScroll = (): void => {
      if (queued) return
      queued = requestAnimationFrame(() => {
        queued = 0
        measure()
      })
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    // 2026-09-24 — the tree's height also changes when a sidebar handle is dragged.
    const ro = new ResizeObserver(onScroll)
    ro.observe(sc)
    return () => {
      if (queued) cancelAnimationFrame(queued)
      sc.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      ro.disconnect()
    }
  }, [windowed, items.length, rowH, scroller])

  const [start, end] = windowed ? range : [0, items.length]
  return (
    <div
      ref={host}
      role="group"
      style={s(
        'display:flex;flex-direction:column;margin:0 0 4px 12px;border-left:1px solid var(--border);padding-left:4px'
      )}
    >
      {windowed && <span aria-hidden="true" style={{ height: start * rowH, flex: 'none' }} />}
      {items.slice(start, end).map((it, i) => row(it, start + i))}
      {windowed && (
        <span aria-hidden="true" style={{ height: (items.length - end) * rowH, flex: 'none' }} />
      )}
    </div>
  )
}

/**
 * 2026-09-24 — a drag handle on the boundary under a rows wrapper (`selectors/sidebar.ts`).
 * It takes no height: a 6 px hit area straddles the boundary, and its 1 px line is transparent
 * until hovered, when it turns `var(--accent)` — so an undragged sidebar looks as designed.
 */
function SplitHandle({
  onDown,
  onReset
}: {
  onDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onReset: () => void
}): React.JSX.Element {
  return (
    <div style={s('position:relative;height:0;flex:none;z-index:1')}>
      <div
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={onDown}
        onDoubleClick={onReset}
        className="hv-split"
        style={s(
          'position:absolute;left:0;right:0;top:-3px;height:6px;display:flex;align-items:center;cursor:row-resize'
        )}
      >
        <span style={s('flex:1;height:1px;background:transparent')}></span>
      </div>
    </div>
  )
}

/**
 * The designed unload confirmation — `SGVue.dc.html:108–113`, markup for markup.
 *
 * It is the one confirm the design has, and Phase 10 gives it the semantics it was missing: a
 * `dialog` named by its own question, with focus moved to `cancel` when it appears and handed
 * back to the × that opened it when it goes. `aria-modal="false"` is the truth — it is an
 * inline strip in the model list, not a scrim over the window, and the rest of the sidebar
 * stays reachable exactly as the design intends.
 */
function ConfirmUnload({
  name,
  onCancel,
  onDelete
}: {
  name: string
  onCancel: () => void
  onDelete: () => void
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const labelId = useId()
  useDialogFocus(true, box)
  return (
    <div
      ref={box}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelId}
      style={s(
        'display:flex;align-items:center;gap:8px;margin:2px 0 4px 32px;padding:7px 9px;background:var(--card);border:1px solid var(--warn-line);border-radius:8px;box-shadow:var(--shadow)'
      )}
    >
      <span
        id={labelId}
        style={s('flex:1;min-width:0;font:400 11.5px/1.35 var(--sans);color:var(--muted)')}
      >
        Unload {name}?
      </span>
      <button
        onClick={onCancel}
        className="hv-step-ink"
        style={s('font:500 11px/1 var(--sans);color:var(--muted);padding:4px 6px;border-radius:6px')}
      >
        cancel
      </button>
      <button
        onClick={onDelete}
        className="hv-warn"
        style={s(
          'font:500 11px/1 var(--sans);color:var(--warn-ink);padding:4px 9px;border:1px solid var(--warn-line);border-radius:999px'
        )}
      >
        delete
      </button>
    </div>
  )
}

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick(
  'federation', 'library', 'treeMode', 'search', 'expanded', 'hidden', 'selIds', 'storeyVis',
  'modelVis', 'modelColors', 'nativeMats', 'uploadNames', 'uploads', 'active', 'palette',
  'confirmRemove', 'addOpen', 'card', 'visibleCount', 'sideModels', 'sideStoreys', 'loaded',
  'activate', 'allStoreys', 'askRemove', 'cancelRemove', 'dropUpload', 'hide', 'openCard',
  'select', 'setCtx', 'setModelColor', 'setSearch', 'setSideSize', 'setTreeMode', 'show',
  'soloStorey', 'toggleAdd', 'toggleGroup', 'toggleModel', 'toggleNative', 'togglePalette',
  'togglePanel', 'toggleStorey', 'units'
)

export default function Sidebar(): React.JSX.Element {
  const st = useShell(useShallow(KEYS))
  /** The tree's scroll container — what a windowed group measures itself against. */
  const tree = useRef<HTMLDivElement>(null)
  /** The MODELS and STOREYS rows wrappers — what the two drag handles size. */
  const modelsRows = useRef<HTMLDivElement>(null)
  const storeysRows = useRef<HTMLDivElement>(null)
  const {
    federation,
    library,
    treeMode,
    search,
    expanded,
    hidden,
    selIds,
    storeyVis,
    modelVis,
    modelColors,
    nativeMats,
    uploadNames,
    uploads,
    active,
    palette,
    confirmRemove,
    addOpen,
    card,
    visibleCount,
    sideModels,
    sideStoreys,
    units
  } = st

  // Activate mode scopes every list to one model — `SGVue.dc.html:1786`.
  const lels = useMemo(
    () => (active ? federation.elements.filter((e) => e.model === active) : federation.elements),
    [federation, active]
  )
  const models = useMemo(
    () =>
      modelRows({
        federation,
        // Each loaded model's file, which is where its path is kept. Read with the federation
        // it belongs to: a file is recorded before the commit that changes `federation`.
        files: fed.sessionFiles(),
        library,
        modelVis,
        modelColors,
        nativeMats,
        uploadNames,
        active,
        palette,
        confirmRemove
      }),
    [federation, library, modelVis, modelColors, nativeMats, uploadNames, active, palette, confirmRemove]
  )
  const addable = useMemo(() => addableRows(library, st.loaded), [library, st.loaded])
  const storeys = useMemo(
    () => storeyRows({ storeys: federation.storeys, elements: lels, storeyVis, active, units }),
    [federation, lels, storeyVis, active, units]
  )
  /**
   * Above the design's own storey count the sidebar's vertical budget changes — see
   * `DESIGN_STOREY_COUNT`. At or below it, every style string in this file is the design's.
   */
  const crowdedStoreys = storeys.length > DESIGN_STOREY_COUNT
  // Grouping scans the whole federation; the selection only restyles rows, so a click in the
  // viewport re-runs the second half alone.
  const grouped = useMemo(
    () => groupTree({ elements: lels, treeMode, search, expanded, hidden }),
    [lels, treeMode, search, expanded, hidden]
  )
  const groups = useMemo(() => withSelection(grouped, selIds), [grouped, selIds])

  /* ── the tree's keyboard (Phase 10) ───────────────────────────────────────
   * The roving tabindex: one node of the tree is tabbable, and the arrow keys move which.
   * `selectors/tree-keys.ts` decides; this only dispatches and moves the DOM focus. */
  const nodes = useMemo(() => treeNodes(groups), [groups])
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const roving = focusKey ?? nodes[0]?.key ?? ''
  /** Set by a key press, so a click never steals the focus back to an old row. */
  const wanted = useRef<string | null>(null)

  useEffect(() => {
    const key = wanted.current
    if (!key) return
    wanted.current = null
    const sc = tree.current
    const find = (): HTMLElement | null =>
      sc?.querySelector<HTMLElement>(`[data-tree-key="${CSS.escape(key)}"]`) ?? null
    const node = find()
    if (node) {
      node.focus()
      node.scrollIntoView({ block: 'nearest' })
      return
    }
    // The one case a node can be absent: Home or End jumping past the rendered window of a
    // group of 200 rows or more. Both land at an end of the scroller, so scrolling there is
    // what renders them; one frame later the row exists.
    if (!sc) return
    sc.scrollTop = nodes[0]?.key === key ? 0 : sc.scrollHeight
    const raf = requestAnimationFrame(() => find()?.focus())
    return () => cancelAnimationFrame(raf)
  }, [focusKey, nodes])

  const onTreeKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // The eyes inside a row are buttons of their own; their Enter and Space belong to them.
    if (event.target !== event.currentTarget && (event.target as HTMLElement).tagName === 'BUTTON') {
      return
    }
    const action = treeKeyAction(event.key, nodes, roving)
    if (!action) return
    // Space scrolls a scroller, and `Home` is the window's own "zoom extents" (`state/keys.ts`).
    event.preventDefault()
    event.stopPropagation()
    switch (action.kind) {
      case 'focus':
        wanted.current = action.key
        return setFocusKey(action.key)
      case 'expand':
      case 'collapse':
        return st.toggleGroup(action.group)
      case 'activate':
        return action.node.kind === 'group'
          ? st.toggleGroup(action.node.group)
          : st.select(action.node.id!, true, 'replace')
    }
  }

  /* ── the two drag handles (2026-09-24, `selectors/sidebar.ts`) ──────────────
   * A section's floor is its first row plus the wrapper's own 10 px of padding. The first
   * drag pins **both** sections at their current heights, so moving one never makes the
   * other jump; the tree keeps `flex:1` and gives up everything above its three rows. */
  const measure = (node: HTMLDivElement | null): SideSize | null => {
    if (!node) return null
    const row = node.querySelector<HTMLElement>('.hv-step')
    const min = Math.ceil((row ? row.getBoundingClientRect().height : 0) + STOREY_ROWS_PAD)
    return { h: node.getBoundingClientRect().height, min }
  }
  const onSplit =
    (which: 'models' | 'storeys') =>
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return
      const self = measure((which === 'models' ? modelsRows : storeysRows).current)
      const other = measure((which === 'models' ? storeysRows : modelsRows).current)
      const tr = tree.current
      if (!self || !other || !tr) return
      e.preventDefault()
      const otherKey = which === 'models' ? 'storeys' : 'models'
      const treeH = tr.getBoundingClientRect().height
      const y0 = e.clientY
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent): void => {
        const now = useShell.getState()
        // A tree already under its three rows would make a pinned pair shrink together and jump,
        // so then the other list is left as it is.
        if (treeH >= TREE_MIN && !(otherKey === 'models' ? now.sideModels : now.sideStoreys)) {
          now.setSideSize(otherKey, other)
        }
        now.setSideSize(which, { h: clampSection(self.h, ev.clientY - y0, self.min, treeH), min: self.min })
      }
      const up = (): void => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', up)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', up)
    }
  /**
   * The tree's floor: the design's `0`, or 40 % above six storeys — unless a section is sized
   * by hand, when it is three rows (above six storeys, only once both are).
   */
  const treeMin =
    crowdedStoreys && !(sideModels && sideStoreys)
      ? '40%'
      : sideModels || sideStoreys
        ? `${TREE_MIN}px`
        : '0'

  const project = projectHeader(st)
  const projBtn = projectButton(card === 'project')
  const seg = { entity: on(treeMode === 'entity'), type: on(treeMode === 'type') }
  const nat = nativeToggle(nativeMats)
  const activeName = models.find((m) => m.key === active)?.name ?? ''
  const total = federation.elements.length
  const storeyNames = federation.storeys.map((x) => x.name)

  return (
    <aside
      style={s(
        'width:300px;flex:none;display:flex;flex-direction:column;min-height:0;background:var(--card);border-right:1px solid var(--border)'
      )}
    >
      {/* ── brand row (`:65`) — brand only; it must not share a row with the project button ── */}
      <div style={s('display:flex;align-items:center;gap:9px;padding:14px 12px 0 16px')}>
        <Logo />
        <span style={s('font:600 15px/1 var(--sans);letter-spacing:-.01em;color:var(--ink)')}>
          SGVue
        </span>
        <span style={s('flex:1')}></span>
        <span
          style={s(
            'font:400 10px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--faint);white-space:nowrap'
          )}
        >
          IFC review
        </span>
      </div>

      {/* ── IfcProject button + collapse (`:71`) ── */}
      <div
        style={s(
          'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 12px 10px 16px'
        )}
      >
        <button
          onClick={() => st.openCard('project')}
          data-tip="Project, site and building information"
          className="hv-step"
          style={s(
            `display:flex;flex-direction:column;gap:3px;min-width:0;text-align:left;padding:4px 6px;margin:-4px -6px;border-radius:8px;border:1px solid ${projBtn.line};background:${projBtn.bg}`
          )}
        >
          <span
            style={s(
              `font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:${projBtn.fg}`
            )}
          >
            IfcProject
          </span>
          <span style={s('font:600 17px/1.3 var(--serif);color:var(--ink)')}>{project.name}</span>
          <span
            style={s(
              'font:400 11.5px/1.5 var(--mono);color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
            )}
          >
            {project.file} · {project.schema}
          </span>
        </button>
        <button
          onClick={st.togglePanel}
          title="Collapse panel"
          className="hv-step-ink"
          style={s(
            'width:28px;height:28px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
          )}
        >
          <ChevronLeft />
        </button>
      </div>

      {/* ── mode segmented control + search (`:82`) ── */}
      <div style={s('display:flex;flex-direction:column;gap:8px;padding:0 12px 10px')}>
        <div
          style={s(
            'display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--card)'
          )}
        >
          <button
            onClick={() => st.setTreeMode('entity')}
            style={s(
              `font:500 12px/1 var(--mono);padding:8px 13px;text-align:center;border-right:1px solid var(--border);color:${seg.entity.fg};background:${seg.entity.bg}`
            )}
          >
            by Entity
          </button>
          <button
            onClick={() => st.setTreeMode('type')}
            style={s(
              `font:500 12px/1 var(--mono);padding:8px 13px;text-align:center;color:${seg.type.fg};background:${seg.type.bg}`
            )}
          >
            by PredefType
          </button>
        </div>
        <input
          value={search}
          onChange={(e) => st.setSearch(e.target.value)}
          placeholder="find an element…"
          className="fv-field"
          style={s(
            'width:100%;font:400 13px/1.4 var(--sans);color:var(--ink);background:var(--card);border:1px solid var(--border-strong);border-radius:8px;padding:7px 10px'
          )}
        />
      </div>

      {/* ── MODELS header (`:90`) ── */}
      <div
        style={s(
          'padding:6px 12px 4px;display:flex;align-items:center;gap:9px;font:600 11px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)'
        )}
      >
        <span>Models</span>
        {active && (
          <button
            onClick={() => st.activate(active)}
            title="Leave activate mode"
            style={s(
              'display:flex;align-items:center;gap:5px;font:500 10.5px/1 var(--mono);letter-spacing:.04em;text-transform:none;color:var(--sel-ink);background:var(--sel-bg);border:1px solid var(--accent);border-radius:999px;padding:3px 7px'
            )}
          >
            {activeName}
            <Cross size={9} weight={2.6} />
          </button>
        )}
        <span style={s('flex:1;height:1px;background:var(--border)')}></span>
        {/* The design wraps a hidden `<input type="file">`; on the desktop the same label
            opens Electron's native Open dialog instead (fidelity contract, allowed
            deviations). Copy, tooltip and colour are unchanged. */}
        <label
          data-tip="Upload an IFC file — it parses in the background"
          onClick={() => void openDialog()}
          style={s(
            'font:500 11px/1 var(--sans);letter-spacing:0;text-transform:none;color:var(--accent-ink);cursor:pointer'
          )}
        >
          upload
        </label>
        {addable.length > 0 && (
          <>
            <span style={s('color:var(--border-strong)')}>·</span>
            <button
              onClick={st.toggleAdd}
              style={s(
                'font:500 11px/1 var(--sans);letter-spacing:0;text-transform:none;color:var(--accent-ink)'
              )}
            >
              library
            </button>
          </>
        )}
      </div>

      {/* ── model rows, upload rows, library popover, native-materials toggle (`:91`) ── */}
      {/* `:98` verbatim; the tail is added only above the design's own storey count. */}
      <div
        ref={modelsRows}
        style={s(
          'display:flex;flex-direction:column;padding:2px 12px 8px 10px;position:relative' +
            (sideModels
              ? sizedTail(sideModels.h, sideModels.min)
              : crowdedStoreys
                ? MODEL_ROWS_SCROLL
                : '')
        )}
      >
        {models.map((md) => (
          <div key={md.key} style={s('display:flex;flex-direction:column')}>
            <div
              className="hv-step"
              style={s(
                `display:grid;grid-template-columns:24px 14px minmax(0,1fr) auto 22px 22px;align-items:center;gap:7px;padding:4px 4px 4px 2px;border-left:2px solid ${md.edge};background:${md.bg};border-radius:0 6px 6px 0;opacity:${md.opacity}`
              )}
            >
              <button
                onClick={() => st.toggleModel(md.key)}
                title="Show / hide model"
                className="hv-ink"
                style={s(
                  'width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
                )}
              >
                {md.vis ? <Eye /> : <EyeOff />}
              </button>
              <button
                onClick={() => st.togglePalette(md.key)}
                title="Override this model's colour"
                className="hv-accent-line"
                style={s(
                  `width:14px;height:14px;border-radius:3px;background:${md.swatch};border:1px solid var(--border-strong);box-shadow:${md.swatchRing}`
                )}
              ></button>
              <div
                title={md.path || undefined}
                style={s('display:flex;flex-direction:column;gap:2px;min-width:0')}
              >
                <span
                  style={s(
                    'font:500 13px/1.3 var(--sans);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
                  )}
                >
                  {md.name}
                </span>
                <span
                  style={s(
                    'font:400 11px/1.3 var(--mono);color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
                  )}
                >
                  {md.file}
                </span>
              </div>
              <span
                style={s(
                  'font:400 11px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);min-width:26px;text-align:right'
                )}
              >
                {md.count}
              </span>
              <button
                onClick={() => st.activate(md.key)}
                title="Activate — lists show only this model; the others stay visible in 3D but can't be selected"
                className="hv-card-accent"
                style={s(
                  `width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:${md.actFg}`
                )}
              >
                <Target dot={md.actDot} />
              </button>
              {md.canRemove && (
                <button
                  onClick={() => st.askRemove(md.key)}
                  title="Unload model"
                  className="hv-card-ink"
                  style={s(
                    'width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
                  )}
                >
                  <Cross size={12} weight={2} />
                </button>
              )}
            </div>
            {md.confirmOpen && (
              <ConfirmUnload
                name={md.name}
                onCancel={st.cancelRemove}
                onDelete={() => void fed.removeModel(md.key)}
              />
            )}
            {md.paletteOpen && (
              <div
                style={s(
                  'display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:2px 0 4px 32px;padding:7px 9px;background:var(--card);border:1px solid var(--border-strong);border-radius:8px;box-shadow:var(--shadow)'
                )}
              >
                {md.colors.map((c) => (
                  <button
                    key={c.c}
                    onClick={() => st.setModelColor(md.key, c.c)}
                    title={c.c}
                    style={s(
                      `width:16px;height:16px;border-radius:4px;background:${c.c};border:1px solid var(--border-strong);box-shadow:${c.ring}`
                    )}
                  ></button>
                ))}
                <span style={s('flex:1;min-width:6px')}></span>
                <button
                  onClick={() => st.setModelColor(md.key, null)}
                  style={s(
                    'font:500 11px/1 var(--sans);color:var(--accent-ink);padding:3px 2px;white-space:nowrap'
                  )}
                >
                  reset
                </button>
              </div>
            )}
          </div>
        ))}

        {/* upload rows (`:126`) — Phase 8 fills `uploads`; the row is the design's. */}
        {uploadRows(uploads).map((u) => {
          const busy = u.busy
          return (
            <div
              key={u.id}
              style={s(
                'display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:8px;padding:4px 4px 6px 2px'
              )}
            >
              <span style={s('width:24px;height:24px;display:flex;align-items:center;justify-content:center')}>
                {busy && (
                  <span
                    style={s(
                      'width:12px;height:12px;border-radius:50%;border:2px solid var(--border-strong);border-top-color:var(--accent);animation:ifcspin .7s linear infinite'
                    )}
                  ></span>
                )}
                {u.done && (
                  <span
                    style={s(
                      'width:16px;height:16px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--ok-bg);color:var(--ok-ink);animation:ifcpop .3s ease-out'
                    )}
                  >
                    <Tick />
                  </span>
                )}
                {u.error && (
                  <button
                    onClick={() => st.dropUpload(u.id)}
                    title="Dismiss"
                    style={s(
                      'width:16px;height:16px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--warn-bg);color:var(--warn-ink)'
                    )}
                  >
                    <Bang />
                  </button>
                )}
              </span>
              <span style={s('display:flex;flex-direction:column;gap:4px;min-width:0')}>
                <span
                  style={s(
                    'font:500 12.5px/1.3 var(--sans);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
                  )}
                >
                  {u.name}
                </span>
                <span style={s('height:3px;border-radius:2px;background:var(--step-bg);overflow:hidden')}>
                  <span
                    style={s(
                      `display:block;height:3px;border-radius:2px;background:var(--accent);width:${u.pct}%;transition:width .3s ease`
                    )}
                  ></span>
                </span>
                <span
                  style={s(
                    'font:400 10.5px/1.3 var(--mono);color:var(--faint);animation:ifcpulse 1.6s ease-in-out infinite'
                  )}
                >
                  {u.stage}
                </span>
              </span>
              <span
                style={s(
                  'font:400 10.5px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted)'
                )}
              >
                {u.pctLabel}
              </span>
            </div>
          )
        })}

        {/* library popover (`:139`) */}
        {addOpen && (
          <div
            style={s(
              'display:flex;flex-direction:column;gap:2px;margin:4px 0 2px 24px;padding:6px;background:var(--card);border:1px solid var(--border-strong);border-radius:8px;box-shadow:var(--shadow)'
            )}
          >
            {addable.map((a) => (
              <button
                key={a.key}
                onClick={() => {
                  st.toggleAdd()
                  void openLibrary([a])
                }}
                title={a.path || undefined}
                className="hv-step"
                style={s(
                  'display:grid;grid-template-columns:10px minmax(0,1fr);align-items:center;gap:8px;padding:6px 8px;border-radius:6px;text-align:left'
                )}
              >
                <span
                  style={s(
                    `width:10px;height:10px;border-radius:2px;background:${a.swatch};border:1px solid var(--border-strong)`
                  )}
                ></span>
                <span style={s('display:flex;flex-direction:column;gap:2px;min-width:0')}>
                  <span style={s('font:500 12.5px/1.3 var(--sans);color:var(--ink)')}>{a.name}</span>
                  <span style={s('font:400 11px/1.3 var(--mono);color:var(--faint)')}>{a.file}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Original materials (`:149`) */}
        <div
          style={s(
            'display:flex;align-items:center;gap:10px;margin:4px 2px 0 24px;padding:7px 9px;border:1px solid var(--border);border-radius:8px;background:var(--card)'
          )}
        >
          <div style={s('display:flex;flex-direction:column;gap:2px;min-width:0;flex:1')}>
            <span style={s('font:500 12.5px/1.3 var(--sans);color:var(--ink)')}>
              Original materials
            </span>
            <span style={s('font:400 11px/1.35 var(--sans);color:var(--faint)')}>
              {matHint(nativeMats, modelColors)}
            </span>
          </div>
          <button
            onClick={st.toggleNative}
            title="Use the surface materials that came with the loaded IFC files"
            style={s(
              `flex:none;width:34px;height:20px;border-radius:999px;padding:2px;display:flex;align-items:center;background:${nat.track};border:1px solid ${nat.line}`
            )}
          >
            <span
              style={s(
                `width:14px;height:14px;border-radius:50%;background:${nat.knob};transform:translateX(${nat.x}px);transition:transform .15s ease`
              )}
            ></span>
          </button>
        </div>
      </div>

      <SplitHandle onDown={onSplit('models')} onReset={() => st.setSideSize('models', null)} />

      {/* ── STOREYS (`:160`) ── */}
      <div
        style={s(
          'padding:6px 12px 4px;display:flex;align-items:center;gap:9px;font:600 11px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)'
        )}
      >
        <span>Storeys</span>
        <span style={s('flex:1;height:1px;background:var(--border)')}></span>
        <button
          onClick={st.allStoreys}
          style={s(
            'font:500 11px/1 var(--sans);letter-spacing:0;text-transform:none;color:var(--accent-ink)'
          )}
        >
          show all
        </button>
      </div>
      {/* `:161` verbatim; the tail is added only above the design's own storey count. */}
      <div
        ref={storeysRows}
        style={s(
          'display:flex;flex-direction:column;padding:2px 12px 8px 10px' +
            (sideStoreys
              ? sizedTail(sideStoreys.h, sideStoreys.min)
              : crowdedStoreys
                ? STOREY_ROWS_SCROLL
                : '')
        )}
      >
        {storeys.map((sr) => (
          <div
            key={sr.name}
            onClick={() => st.soloStorey(sr.name, sr.solo, storeyNames)}
            title="Click: only this storey · click again: all storeys"
            className="hv-step"
            style={s(
              `display:grid;grid-template-columns:24px minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:4px 8px 4px 4px;border-left:2px solid ${sr.edge};background:${sr.bg};border-radius:0 6px 6px 0;opacity:${sr.opacity};cursor:pointer`
            )}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                st.toggleStorey(sr.name)
              }}
              title="Show / hide storey"
              className="hv-ink"
              style={s(
                'width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
              )}
            >
              {sr.vis ? <Eye /> : <EyeOff />}
            </button>
            <span
              style={s(
                `font:500 13px/1.3 var(--sans);color:${sr.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`
              )}
            >
              {sr.name}
            </span>
            <span
              style={s(
                'font:400 11px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--faint)'
              )}
            >
              {sr.elev}
            </span>
            <span
              style={s(
                'font:400 11px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);min-width:26px;text-align:right'
              )}
            >
              {sr.count}
            </span>
          </div>
        ))}
      </div>

      <SplitHandle onDown={onSplit('storeys')} onReset={() => st.setSideSize('storeys', null)} />

      {/* ── element tree (`:175`) ── */}
      <div
        style={s(
          'padding:6px 12px 4px;display:flex;align-items:center;gap:9px;font:600 11px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)'
        )}
      >
        <span id="sgvue-tree-title">{treeTitle(treeMode)}</span>
        <span style={s('flex:1;height:1px;background:var(--border)')}></span>
        <span
          style={s(
            'font:400 11px/1 var(--mono);letter-spacing:0;text-transform:none;color:var(--faint);white-space:nowrap'
          )}
        >
          {visibleCount} / {total}
        </span>
      </div>
      <div
        ref={tree}
        role="tree"
        aria-labelledby="sgvue-tree-title"
        onKeyDown={onTreeKey}
        style={s(
          // `:176` verbatim; `min-height` is `0` there and stays `0` at the design's own
          // storey count. Above it, the tree keeps 40 % of the aside. Sized by hand: `treeMin`.
          `flex:1;min-height:${treeMin};overflow:auto;padding:2px 12px 12px 10px;display:flex;flex-direction:column;gap:1px`
        )}
      >
        {groups.map((g) => (
          <div key={g.key} role="none" style={s('display:flex;flex-direction:column')}>
            <div
              onClick={() => st.toggleGroup(g.key)}
              role="treeitem"
              aria-expanded={g.open}
              aria-level={1}
              data-tree-key={`g:${g.key}`}
              tabIndex={roving === `g:${g.key}` ? 0 : -1}
              onFocus={() => setFocusKey(`g:${g.key}`)}
              className="hv-step"
              style={s(
                // 2026-10-01 — the eye leads and the chevron trails, as the header says. The
                // left padding is the design's 6 px, which is what puts this eye on the storey
                // eye's own x (10 + 6 here, 10 + 2 + 4 there).
                `display:grid;grid-template-columns:24px minmax(0,1fr) auto 14px;align-items:center;gap:6px;padding:5px 4px 5px 6px;border-radius:6px;cursor:pointer;opacity:${g.opacity}`
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (g.vis) st.hide(g.ids)
                  else st.show(g.ids)
                }}
                title="Show / hide group"
                className="hv-ink"
                style={s(
                  'width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
                )}
              >
                {g.vis ? <Eye /> : <EyeOff />}
              </button>
              <span
                style={s(
                  `font:${g.font};color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis`
                )}
              >
                {g.label}
              </span>
              <span
                style={s(
                  'font:400 11px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted)'
                )}
              >
                {g.count}
              </span>
              <span
                style={s(
                  `display:flex;justify-content:center;color:${g.chevColor};transform:rotate(${g.rot}deg);transition:transform .15s`
                )}
              >
                <GroupChevron />
              </span>
            </div>
            {g.open && (
              <GroupRows
                items={g.items}
                scroller={tree}
                row={(it, i) => (
                  <div
                    key={it.id}
                    onClick={(ev) =>
                      st.select(
                        it.id,
                        !(ev.ctrlKey || ev.metaKey),
                        ev.ctrlKey || ev.metaKey ? 'toggle' : 'replace'
                      )
                    }
                    onContextMenu={(ev) => {
                      ev.preventDefault()
                      // `:1831` clamps both axes; the top is clamped against the menu's own
                      // measured height in `app/ContextMenu.tsx` since Phase 10.
                      st.setCtx({
                        x: clampCtxX(ev.clientX, window.innerWidth),
                        y: ev.clientY,
                        id: it.id
                      })
                    }}
                    role="treeitem"
                    aria-level={2}
                    aria-selected={it.sel}
                    aria-posinset={i + 1}
                    aria-setsize={g.items.length}
                    data-tree-key={`i:${it.id}`}
                    tabIndex={roving === `i:${it.id}` ? 0 : -1}
                    onFocus={() => setFocusKey(`i:${it.id}`)}
                    className="hv-step"
                    style={s(
                      // 2026-10-01 — mirrored with its columns: the eye keeps its 2 px from the
                      // row's edge (now the selection edge), the text its 8 px from the other.
                      `display:grid;grid-template-columns:24px minmax(0,1fr);align-items:center;gap:6px;padding:3px 8px 3px 2px;border-left:2px solid ${it.edge};background:${it.bg};border-radius:0 6px 6px 0;cursor:pointer;opacity:${it.opacity}`
                    )}
                  >
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation()
                        if (it.hid) st.show([it.id])
                        else st.hide([it.id])
                      }}
                      title="Show / hide"
                      className="hv-ink"
                      style={s(
                        'width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
                      )}
                    >
                      {it.vis ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <span style={s('display:flex;flex-direction:column;gap:1px;min-width:0')}>
                      <span
                        style={s(
                          `font:400 12.5px/1.3 var(--sans);color:${it.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`
                        )}
                      >
                        {it.name}
                      </span>
                      <span
                        style={s(
                          'font:400 10.5px/1.3 var(--mono);color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
                        )}
                      >
                        {it.sub}
                      </span>
                    </span>
                  </div>
                )}
              />
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
