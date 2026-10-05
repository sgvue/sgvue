/** The collapsed sidebar — `SGVue.dc.html:209–216`. */
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { projectHeader } from '../state/selectors/status'
import { s } from './css'
import { ChevronRight } from './icons'

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick('federation', 'loaded', 'togglePanel', 'visibleCount')

export default function Rail(): React.JSX.Element {
  const st = useShell(useShallow(KEYS))
  const project = projectHeader(st)
  return (
    <aside
      style={s(
        'width:44px;flex:none;display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:14px;background:var(--card);border-right:1px solid var(--border)'
      )}
    >
      <button
        onClick={st.togglePanel}
        title="Open panel"
        className="hv-step-ink"
        style={s(
          'width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
        )}
      >
        <ChevronRight />
      </button>
      <span
        style={s(
          'writing-mode:vertical-rl;transform:rotate(180deg);font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)'
        )}
      >
        {project.name} · {st.visibleCount} / {st.federation.elements.length}
      </span>
    </aside>
  )
}
