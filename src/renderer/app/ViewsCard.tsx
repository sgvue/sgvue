/**
 * The Viewpoints card — `SGVue.dc.html:280–300`, ported element for element.
 *
 * A left-lane card, z-order 14, 300 px wide, clamped against `--rlane` like the others.
 *
 * "copy link to this state" is the design's control, copy, tooltip, icon and 1 600 ms flash;
 * the link it copies is `sgvue://s=<base64url(sessionPayload())>` rather than a location hash,
 * because a desktop app has no address bar (`CLAUDE.md`, allowed desktop deviations). Since
 * 2026-10-02 the flash stands only when the link really is on the clipboard (`model/session.ts`).
 *
 * 2026-09-24 (owner-requested: *"allow double click to edit saved view name."*): a
 * double-click on a name swaps it, in place, for a text field in the name's own font, colour
 * and box, with the text selected. Enter or leaving the field commits (`renameView`: trimmed,
 * blank keeps the old name); Esc cancels. The double-click's first click restores the view as
 * a single click always has; its second click is ignored, so the view is restored once and
 * the undo stack gains one entry, not two.
 */
import { useMemo, useRef, useState } from 'react'
import { copyLink } from '../model/session'
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { viewRows } from '../state/selectors/views'
import { s } from './css'
import { Cross, Link, Plus } from './icons'

/** The name's own style string — the field that replaces it while renaming borrows it whole. */
const NAME =
  'font:500 13px/1.3 var(--sans);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'

export default function ViewsCard(): React.JSX.Element | null {
  const open = useShell((st) => st.card === 'views')
  // Mounted only while the card is open (`ContextMenu`'s `Menu` pattern), so a rename that was
  // in progress when the card closed does not come back when it reopens.
  return open ? <Views /> : null
}

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick(
  'activeView', 'card', 'cardTop', 'closeCard', 'dropView', 'linkCopied', 'renameView',
  'restoreView', 'saveView', 'views'
)

function Views(): React.JSX.Element {
  const st = useShell(useShallow(KEYS))
  const rows = useMemo(() => viewRows(st.views, st.activeView), [st.views, st.activeView])
  /** The viewpoint whose name is being edited, if any. */
  const [editing, setEditing] = useState<number | null>(null)
  /** Set by Esc so the blur that follows does not commit what was typed. */
  const cancelled = useRef(false)
  const finish = (id: number, value: string): void => {
    if (!cancelled.current) st.renameView(id, value)
    cancelled.current = false
    setEditing(null)
  }
  return (
    <div
      style={s(
        `position:absolute;z-index:14;top:${st.cardTop}px;left:12px;width:300px;max-width:calc(100% - 24px - var(--rlane, 0px));display:flex;flex-direction:column;gap:12px;padding:14px;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out`
      )}
    >
      <div style={s('display:flex;align-items:center;justify-content:space-between')}>
        <span
          style={s(
            'font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)'
          )}
        >
          Viewpoints
        </span>
        <button
          onClick={st.closeCard}
          className="hv-step-ink"
          style={s(
            'width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
          )}
        >
          <Cross size={14} weight={1.8} />
        </button>
      </div>
      {rows.length === 0 && (
        <span style={s('font-size:12.5px;line-height:1.5;color:var(--muted)')}>
          Nothing saved yet. A viewpoint keeps the camera, section and what is hidden.
        </span>
      )}
      {rows.length > 0 && (
        <div
          style={s(
            'display:flex;flex-direction:column;gap:2px;max-height:280px;overflow:auto;margin:0 -6px'
          )}
        >
          {rows.map((v) => (
            <div
              key={v.id}
              onClick={(ev) => {
                // The second click of a double-click, and any click while the name is being
                // edited, restores nothing.
                if (ev.detail > 1 || editing === v.id) return
                const found = st.views.find((x) => x.id === v.id)
                if (found) st.restoreView(found)
              }}
              className="hv-step"
              style={s(
                `display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:7px 6px 7px 10px;border-radius:7px;cursor:pointer;border-left:2px solid ${v.edge}`
              )}
            >
              <div style={s('display:flex;flex-direction:column;gap:3px;min-width:0')}>
                {editing === v.id ? (
                  <input
                    data-role="view-rename"
                    aria-label="Viewpoint name"
                    defaultValue={v.name}
                    autoFocus
                    onFocus={(ev) => ev.currentTarget.select()}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') ev.currentTarget.blur()
                      else if (ev.key === 'Escape') {
                        cancelled.current = true
                        ev.currentTarget.blur()
                      }
                    }}
                    onBlur={(ev) => finish(v.id, ev.currentTarget.value)}
                    style={s(
                      `${NAME};display:block;width:100%;min-width:0;height:1.3em;box-sizing:content-box;padding:0;margin:0;border:0;border-radius:0;outline:none;background:transparent`
                    )}
                  />
                ) : (
                  <span
                    onDoubleClick={(ev) => {
                      ev.stopPropagation()
                      cancelled.current = false
                      setEditing(v.id)
                    }}
                    style={s(NAME)}
                  >
                    {v.name}
                  </span>
                )}
                <span
                  style={s(
                    'font:400 11px/1.3 var(--mono);color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
                  )}
                >
                  {v.sub}
                </span>
              </div>
              <button
                onClick={(ev) => {
                  ev.stopPropagation()
                  st.dropView(v.id)
                }}
                title="Delete viewpoint"
                className="hv-card-ink"
                style={s(
                  'width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
                )}
              >
                <Cross size={13} weight={1.8} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={st.saveView}
        className="hv-accent-line"
        style={s(
          'display:flex;align-items:center;justify-content:center;gap:8px;font:500 12.5px/1 var(--sans);padding:9px 12px;border:1px solid var(--border-strong);border-radius:8px;color:var(--ink);background:var(--step-bg)'
        )}
      >
        <Plus />
        Save current view
      </button>
      <button
        onClick={() => void copyLink()}
        data-tip="A link that reopens these models, visibility, section and camera"
        style={s(
          'display:flex;align-items:center;justify-content:center;gap:7px;font:500 11.5px/1 var(--sans);color:var(--accent-ink);padding:2px 0'
        )}
      >
        <Link />
        {st.linkCopied ? 'link copied' : 'copy link to this state'}
      </button>
    </div>
  )
}
