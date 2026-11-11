/**
 * The federating indicator — 2026-11-12, owner-requested (*"create a new simple yet cool techy
 * loading animation when model view is federating the new upload model."*), the owner's pick
 * **"B" · Edge trace** of three prototypes. Two pieces, DOM and CSS only:
 *
 *  · **the line** (`FedLine`), a child of the stage: 2 px, `top:5px;left:5px;right:5px`, five
 *    equal segments, one per real stage — pending `--border`; the current one a `--border-strong`
 *    track with the design's `ifcsweep` glint; a finished one's `--accent` fill growing in
 *    260 ms. Joined: every fill `--ok-ink`. Failed: the current segment `--warn-ink`, still.
 *    At z-index 14 and 5 px in, it is clear of the visibility frame (3 px + 1 px glow), the
 *    toolbar (12 px) and the view cube (8 px).
 *  · **the caption** (`FedCaption`), the top item of the bottom row's centre zone, in the
 *    status bar's own card: `name · stage · n/5`, then the design's ok tick and `+N elements`,
 *    or `could not open — see Models`. The name is the part that shrinks.
 *
 * What either shows is `shared/fed-trace.ts`'s `fedView`; the state is `model/fed-trace-store.ts`.
 * Idle, both are **absent** — `null`, not hidden. Neither takes a pointer event. The motion is
 * CSS: `fadein` and `ifcpop` from the design, `fedfade` (`styles/fed-trace.css`) for the line's
 * entrance, transitions for the fills and the exit; `design.css:6` stills them all under
 * reduced motion, and there the glint is not drawn at all.
 */
import { useSyncExternalStore } from 'react'
import { fedView, type FedSegment, type FedView } from '../../shared/fed-trace'
import { fedTraceState, onFedTrace, reduced } from '../model/fed-trace-store'
import { Tick } from './icons'
import { s } from './css'

/** What the indicator draws now, or `null` while idle. */
export function useFedView(): FedView | null {
  const state = useSyncExternalStore(onFedTrace, fedTraceState, fedTraceState)
  return fedView(state, reduced())
}

/* ────────────────────────────── the line ────────────────────────────── */

const LINE =
  'position:absolute;top:5px;left:5px;right:5px;height:2px;display:flex;gap:2px;pointer-events:none;z-index:14;animation:fedfade .22s linear'
const LINE_OUT =
  'position:absolute;top:5px;left:5px;right:5px;height:2px;display:flex;gap:2px;pointer-events:none;z-index:14;animation:fedfade .22s linear;opacity:0;transition:opacity .22s linear'
const SEG = 'flex:1;position:relative;overflow:hidden;border-radius:1px;background:var(--border)'
const SEG_ON = 'flex:1;position:relative;overflow:hidden;border-radius:1px;background:var(--border-strong)'
const FILL: Record<FedSegment, string> = {
  pending:
    'position:absolute;inset:0;width:0;background:var(--accent);transition:width .26s cubic-bezier(.2,.7,.2,1),background-color .22s ease-out',
  current:
    'position:absolute;inset:0;width:0;background:var(--accent);transition:width .26s cubic-bezier(.2,.7,.2,1),background-color .22s ease-out',
  done: 'position:absolute;inset:0;width:100%;background:var(--accent);transition:width .26s cubic-bezier(.2,.7,.2,1),background-color .22s ease-out',
  ok: 'position:absolute;inset:0;width:100%;background:var(--ok-ink);transition:width .26s cubic-bezier(.2,.7,.2,1),background-color .22s ease-out',
  warn: 'position:absolute;inset:0;width:100%;background:var(--warn-ink)'
}
const GLINT =
  'position:absolute;top:0;left:0;height:100%;width:25%;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:ifcsweep 1.3s linear infinite'

export function FedLine({ view }: { view: FedView | null }): React.JSX.Element | null {
  if (!view) return null
  return (
    <div data-role="fedline" aria-hidden="true" style={s(view.leaving ? LINE_OUT : LINE)}>
      {view.segments.map((seg, i) => (
        <div key={i} data-seg={seg} style={s(seg === 'current' ? SEG_ON : SEG)}>
          <span style={s(FILL[seg])}></span>
          {view.glint === i && <span style={s(GLINT)}></span>}
        </div>
      ))}
    </div>
  )
}

/** The line, as the stage mounts it: a new batch is a new element, so it enters again. */
export function FedTraceLine(): React.JSX.Element | null {
  const view = useFedView()
  return view && <FedLine key={view.batch} view={view} />
}

/* ────────────────────────────── the caption ────────────────────────────── */

/** The status bar's card (`StatusBar.tsx`, `BAR`), with no pointer events and a width cap. */
const CHIP =
  'display:flex;align-items:center;gap:8px;font:400 11px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:7px 10px;box-shadow:var(--shadow);white-space:nowrap;max-width:100%;pointer-events:none;animation:fadein .22s cubic-bezier(.2,.7,.2,1)'
const CHIP_OUT =
  'display:flex;align-items:center;gap:8px;font:400 11px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:7px 10px;box-shadow:var(--shadow);white-space:nowrap;max-width:100%;pointer-events:none;animation:fadein .22s cubic-bezier(.2,.7,.2,1);opacity:0;transition:opacity .22s linear'
const TEXT = 'display:flex;align-items:center;gap:8px;min-width:0'
/** The one part that shrinks; `BottomRow`'s `fit` keeps at least `CAPTION_NAME_MIN` of it. */
const NAME = 'color:var(--ink);min-width:0;max-width:22ch;overflow:hidden;text-overflow:ellipsis'
const DOT = 'color:var(--border-strong)'
const MUTED = 'color:var(--muted)'
const FAINT = 'color:var(--faint)'
const OK = 'color:var(--ok-ink)'
const WARN = 'color:var(--warn-ink)'
/** The upload row's ok badge (`Sidebar.tsx`), 14 px where the row's is 16. */
const TICK =
  'width:14px;height:14px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--ok-bg);color:var(--ok-ink);margin:-2px 0;animation:ifcpop .3s ease-out'

export function FedCaption({ view }: { view: FedView | null }): React.JSX.Element | null {
  if (!view) return null
  const c = view.caption
  return (
    <div data-role="fedcaption" role="status" style={s(view.leaving ? CHIP_OUT : CHIP)}>
      {c.kind === 'joined' && (
        <span style={s(TICK)}>
          <Tick size={9} />
        </span>
      )}
      <span style={s(TEXT)}>
        {c.kind === 'loading' && (
          <>
            <span data-role="fedname" style={s(NAME)}>
              {c.name}
            </span>
            <span style={s(DOT)}>·</span>
            <span style={s(MUTED)}>{c.stage}</span>
            <span style={s(DOT)}>·</span>
            <span style={s(FAINT)}>{c.step}</span>
          </>
        )}
        {c.kind === 'joined' && (
          <>
            <span style={s(OK)}>{c.added}</span>
            {c.failed && (
              <>
                <span style={s(DOT)}>·</span>
                <span style={s(WARN)}>{c.failed}</span>
              </>
            )}
          </>
        )}
        {c.kind === 'failed' && <span style={s(WARN)}>{c.text}</span>}
      </span>
    </div>
  )
}
