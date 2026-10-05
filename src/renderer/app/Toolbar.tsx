/**
 * The floating toolbar — `SGVue.dc.html:222–255`, regrouped on 2026-10-01 (owner-requested:
 * *"organize, group and add divider for the toggles bar … Please separate the schedules toggle.
 * Make it distinct from others."*).
 *
 * **Five groups, with a divider between each two**, in this order:
 *
 *   1. tools    Select · Laser meter · Spot coordinate · Snap
 *   2. panels   Section · Filter · Coordinate system
 *   3. show     Gridlines · Levels · Canvas grid · Shadows · Light / dark
 *   4. view     Saved viewpoints · 3D / Plan / N / S / E / W · persp / ortho
 *   5. Schedules, alone and last — it opens another window
 *
 * Every button keeps its own markup, class, tooltip, handler and on / off colours; only where it
 * sits changed. The design had four groups 10 px apart and **no divider elements**, because
 * dividers strand on wrapped rows (BUILD_PLAN §5 "Toolbar"). That is answered rather than
 * ignored: a divider whose two neighbours are on different rows is `visibility:hidden` — never
 * `display:none`, which would change the layout it was measured from and can oscillate — and
 * the rule is re-run whenever the toolbar's box changes.
 *
 * **Width is a hard constraint.** At the default window the toolbar ends inside the view cube's
 * 148 px canvas, over a corner where the cube draws nothing (`viewer/cube.ts`). So the gaps are
 * chosen to make it no wider: `column-gap:4px`, a 1 px divider — 9 px between groups where the
 * design had 10 — which with the regrouping comes to 737 px against the 741 px before.
 *
 * `left:12px; right:12px; width:fit-content; margin:0 auto` is the exact combination that lets
 * it centre and still use the full width. Tooltips are `data-tip`, never native `title` — a
 * ~1s native delay makes a dense toolbar feel dead (§5 "Tooltips").
 *
 * One transcription note: the design writes `data-tip="Coordinate system &amp; true north"`,
 * which is HTML for a literal ampersand. JSX takes the character itself.
 */
import { useLayoutEffect, useRef } from 'react'
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { toolbarFlags, viewFlags } from '../state/selectors/status'
import { s } from './css'
import {
  IconCoords,
  IconFilter,
  IconGrids,
  IconGroundGrid,
  IconLevels,
  IconMeasure,
  IconMoon,
  IconSchedules,
  IconSection,
  IconSelect,
  IconShadows,
  IconSnap,
  IconSpot,
  IconSun,
  IconViews
} from './icons'

const BTN =
  'width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:6px'
const GROUP =
  'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px;min-width:0'

/** 2026-10-01 — the line between two groups. It takes no part in the tab order or the a11y tree. */
const Divider = (): React.JSX.Element => (
  <span
    aria-hidden="true"
    style={s('width:1px;height:18px;flex:none;background:var(--border-strong)')}
  />
)

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick(
  'tool', 'snap', 'card', 'sections', 'grids', 'levels', 'shadows', 'groundGrid', 'stack', 'view',
  'theme', 'proj', 'openCard', 'setGroundGrid', 'setShadows', 'setTheme', 'setTool', 'setView',
  'toggleGrids', 'toggleLevels', 'toggleProj', 'toggleSnap'
)

export default function Toolbar(): React.JSX.Element {
  const st = useShell(useShallow(KEYS))
  const tb = toolbarFlags(st)
  const vw = viewFlags(st.view)
  const bar = useRef<HTMLDivElement>(null)

  // No stranded dividers: one that ends a row, or starts the next, is hidden in place. Run on
  // mount, whenever the toolbar's box changes — which is whenever its wrapping can — and when
  // the persp / ortho label does.
  useLayoutEffect(() => {
    const node = bar.current
    if (!node) return
    const tidy = (): void => {
      for (const line of node.querySelectorAll<HTMLElement>(':scope > span')) {
        const before = line.previousElementSibling as HTMLElement | null
        const after = line.nextElementSibling as HTMLElement | null
        line.style.visibility = before?.offsetTop === after?.offsetTop ? '' : 'hidden'
      }
    }
    tidy()
    const ro = new ResizeObserver(tidy)
    ro.observe(node)
    return () => ro.disconnect()
  }, [st.proj])

  const view = (name: string, label: string, tip: string, radius: string): React.JSX.Element => {
    const f = vw[name as keyof typeof vw]
    return (
      <button
        onClick={() => st.setView(name)}
        data-tip={tip}
        style={s(
          `font:500 12px/1 var(--mono);height:100%;padding:0 8px;display:flex;align-items:center;justify-content:center;${radius}color:${f.fg};background:${f.bg}`
        )}
      >
        {label}
      </button>
    )
  }

  return (
    <div
      ref={bar}
      data-role="toolbar"
      style={s(
        'position:absolute;top:12px;left:12px;right:12px;width:fit-content;max-width:calc(100% - 24px);margin:0 auto;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;column-gap:4px;row-gap:5px;padding:5px 6px;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow)'
      )}
    >
      {/* 1 — tools */}
      <div style={s(GROUP)}>
        <button
          onClick={() => st.setTool('select')}
          data-tip="Select (Esc) · Ctrl+click: multi-select · drag: pan · Shift+drag: orbit"
          className="hv-step"
          style={s(`${BTN};background:${tb.select.bg};color:${tb.select.fg}`)}
        >
          <IconSelect />
        </button>
        <button
          onClick={() => st.setTool('measure')}
          data-tip="Laser meter (M) · X, Y, Z from a point"
          className="hv-step"
          style={s(`${BTN};background:${tb.measure.bg};color:${tb.measure.fg}`)}
        >
          <IconMeasure />
        </button>
        <button
          onClick={() => st.setTool('spot')}
          data-tip="Spot coordinate (C)"
          className="hv-step"
          style={s(`${BTN};background:${tb.spot.bg};color:${tb.spot.fg}`)}
        >
          <IconSpot />
        </button>
        <button
          onClick={st.toggleSnap}
          data-tip="Snap to corners and edges (S) — for the laser meter and spot coordinates"
          className="hv-step"
          style={s(`${BTN};background:${tb.snap.bg};color:${tb.snap.fg}`)}
        >
          <IconSnap />
        </button>
      </div>

      <Divider />

      {/* 2 — panels: each opens its card, and lights exactly as designed */}
      <div style={s(GROUP)}>
        <button
          onClick={() => st.openCard('section')}
          data-tip="Section from gridline / level"
          className="hv-step"
          style={s(`${BTN};background:${tb.section.bg};color:${tb.section.fg}`)}
        >
          <IconSection />
        </button>
        <button
          onClick={() => st.openCard('filter')}
          data-tip="Filter elements by parameter"
          className="hv-step"
          style={s(`${BTN};background:${tb.filter.bg};color:${tb.filter.fg}`)}
        >
          <IconFilter />
        </button>
        <button
          onClick={() => st.openCard('coords')}
          data-tip="Coordinate system & true north"
          className="hv-step"
          style={s(`${BTN};background:${tb.coords.bg};color:${tb.coords.fg}`)}
        >
          <IconCoords />
        </button>
      </div>

      <Divider />

      {/* 3 — show: what is drawn, and how */}
      <div style={s(GROUP)}>
        <button
          onClick={st.toggleGrids}
          data-tip="Gridlines (G)"
          className="hv-step"
          style={s(`${BTN};background:${tb.grids.bg};color:${tb.grids.fg}`)}
        >
          <IconGrids />
        </button>
        <button
          onClick={st.toggleLevels}
          data-tip="Levels (L)"
          className="hv-step"
          style={s(`${BTN};background:${tb.levels.bg};color:${tb.levels.fg}`)}
        >
          <IconLevels />
        </button>
        {/* 2026-09-24 — not in the design: the owner's canvas (ground) grid toggle. */}
        <button
          onClick={() => st.setGroundGrid(!st.groundGrid)}
          data-tip="canvas grid"
          className="hv-step"
          style={s(`${BTN};background:${tb.groundGrid.bg};color:${tb.groundGrid.fg}`)}
        >
          <IconGroundGrid />
        </button>
        <button
          onClick={() => st.setShadows(!st.shadows)}
          data-tip="Shadows"
          className="hv-step"
          style={s(`${BTN};background:${tb.shadows.bg};color:${tb.shadows.fg}`)}
        >
          <IconShadows />
        </button>
        <button
          onClick={() => st.setTheme(st.theme === 'dark' ? 'light' : 'dark')}
          data-tip="Light / dark"
          className="hv-step-ink"
          style={s(`${BTN};color:var(--muted)`)}
        >
          {st.theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
      </div>

      <Divider />

      {/* 4 — view: where the camera looks from */}
      <div
        style={s(
          'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;min-width:0'
        )}
      >
        <button
          onClick={() => st.openCard('views')}
          data-tip="Saved viewpoints"
          className="hv-step"
          style={s(`${BTN};background:${tb.views.bg};color:${tb.views.fg}`)}
        >
          <IconViews />
        </button>
        <div style={s('display:flex;align-items:center;height:30px;border:1px solid var(--border);border-radius:7px')}>
          {view('iso', '3D', '3D perspective (Home)', 'border-right:1px solid var(--border);border-radius:6px 0 0 6px;')}
          {view('top', 'Plan', 'Plan', 'border-right:1px solid var(--border);')}
          {view('north', 'N', 'North elevation', 'border-right:1px solid var(--border);')}
          {view('south', 'S', 'South elevation', 'border-right:1px solid var(--border);')}
          {view('east', 'E', 'East elevation', 'border-right:1px solid var(--border);')}
          {view('west', 'W', 'West elevation', 'border-radius:0 6px 6px 0;')}
        </div>
        <button
          onClick={st.toggleProj}
          data-tip="Perspective / orthographic"
          className="hv-step-ink"
          style={s(
            'font:500 12px/1 var(--mono);height:30px;padding:0 12px;display:flex;align-items:center;border:1px solid var(--border);border-radius:999px;color:var(--muted);white-space:nowrap'
          )}
        >
          {st.proj === 'persp' ? 'persp' : 'ortho'}
        </button>
      </div>

      <Divider />

      {/* 5 — 2026-09-25, not in the design: opens the Schedules window (owner-approved). It is
          not a toggle and holds no state here, so it never takes the filled "on" look; since
          2026-10-01 it stands alone, in the accent's ink and outline. */}
      <div style={s(GROUP)}>
        <button
          onClick={() => void window.sgvue.openSchedules()}
          data-tip="schedules"
          className="hv-step"
          style={s(
            `${BTN};background:transparent;color:var(--accent-ink);border:1px solid var(--accent)`
          )}
        >
          <IconSchedules />
        </button>
      </div>
    </div>
  )
}
