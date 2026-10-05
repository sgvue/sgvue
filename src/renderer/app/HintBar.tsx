/**
 * The hint bar — `SGVue.dc.html:701–703`, shown while a tool other than Select is active and
 * the viewer has something to say (`:2009`). `chatSay` is one of the state keys plan §3.5
 * item 8 drops, so the condition is `hint && tool !== 'select'`.
 *
 * Since 2026-10-01 it is the bottom row's centre zone that places it (`app/BottomRow.tsx`), so
 * the design's `position:absolute;bottom:14px;left:50%;transform:translateX(-50%)` is gone and
 * `white-space:nowrap` is `white-space:normal;text-align:center;text-wrap:balance;
 * max-width:100%`: one line while the zone has room for it, wrapped when it has not — where the
 * design let a 522 px hint run under the status bar.
 */
import { useShell } from '../state/shell'
import { s } from './css'

export default function HintBar(): React.JSX.Element | null {
  const hint = useShell((st) => st.hint)
  const tool = useShell((st) => st.tool)
  if (!hint || tool === 'select') return null
  return (
    <div
      data-role="hintbar"
      style={s(
        'font:400 12px/1.4 var(--sans);color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:7px 12px;box-shadow:var(--shadow);white-space:normal;text-align:center;text-wrap:balance;max-width:100%;pointer-events:auto'
      )}
    >
      {hint}
    </div>
  )
}
