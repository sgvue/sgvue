/**
 * The loading badge — `SGVue.dc.html:717–719`. Shown while `ready` is false.
 *
 * 2026-11-12 — not while the federating indicator is up (`app/FedTrace.tsx`, the owner's pick
 * "B"): for a load into an open viewer the line and the caption replace `Rebuilding federation…`.
 * The boot's messages and a removal with no load in flight are as designed.
 */
import { useSyncExternalStore } from 'react'
import { fedTraceState, onFedTrace } from '../model/fed-trace-store'
import { useShell } from '../state/shell'
import { s } from './css'

export default function LoadingBadge(): React.JSX.Element | null {
  const ready = useShell((st) => st.ready)
  const loadMsg = useShell((st) => st.loadMsg)
  const fed = useSyncExternalStore(onFedTrace, fedTraceState, fedTraceState)
  if (ready || fed.phase !== 'idle') return null
  return (
    <div
      style={s(
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none'
      )}
    >
      <span
        style={s(
          'font:400 12px/1 var(--mono);color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:9px 12px'
        )}
      >
        {loadMsg}
      </span>
    </div>
  )
}
