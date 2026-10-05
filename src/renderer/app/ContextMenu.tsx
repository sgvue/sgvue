/**
 * The right-click menu — `SGVue.dc.html:833–839`.
 *
 * `position: fixed`, `z-index: 10`. The items and their separators come from
 * `state/selectors/ctx.ts`, which is the design's `ctxItems`; this file is markup and
 * dispatch.
 *
 * It closes exactly where the design closes it: every item's own action clears `ctx`
 * (`hide` / `isolate` / `showAll` through `up`, `select` through `select`, `askAbout`
 * directly), a pointer-down on the viewport does (`viewer/input.ts` → `on.context(null)`), and
 * Escape does, as the first step of the cascade in `state/keys.ts`.
 *
 * Two Phase 10 additions, both invisible. It is a `menu` of `menuitem`s with roving arrow-key
 * focus and Tab held inside it, and focus returns to whatever opened it — the tree row, or the
 * body after a right-click on the stage. And its **top is clamped against its own measured
 * height** rather than the design's fixed 260 px, which is what stops the 385 px element menu
 * running off the bottom of the window (`clampCtxY`).
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { clampCtxY, ctxItems, type CtxAction } from '../state/selectors/ctx'
import { focusables, trapTab, useDialogFocus } from './focus'
import { s } from './css'

export default function ContextMenu(): React.JSX.Element | null {
  const ctx = useShell((st) => st.ctx)
  // A fresh mount per opening, so the focus is taken and given back once per menu.
  return ctx ? <Menu key={`${ctx.x},${ctx.y},${ctx.id}`} /> : null
}

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick(
  'askAbout', 'byId', 'ctx', 'federation', 'hidden', 'hide', 'isolate', 'selIds', 'select',
  'setCtx', 'setView', 'showAll'
)

function Menu(): React.JSX.Element | null {
  const st = useShell(useShallow(KEYS))
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(0)
  const ctx = st.ctx
  const [top, setTop] = useState(ctx?.y ?? 0)

  // Before the browser paints, so the correction is never on screen.
  useLayoutEffect(() => {
    const node = box.current
    if (!node || !ctx) return
    setTop(clampCtxY(ctx.y, node.offsetHeight, window.innerHeight))
  }, [ctx?.y, ctx?.id])

  useDialogFocus(true, box)

  // `Select similar` walks the whole federation; an arrow key moves the roving focus and
  // re-renders the menu, and must not walk it again.
  const items = useMemo(
    () =>
      ctx
        ? ctxItems({
            elements: st.federation.elements,
            byId: st.byId,
            ctxId: ctx.id,
            selIds: st.selIds,
            hidden: st.hidden
          })
        : [],
    [ctx, st.federation, st.byId, st.selIds, st.hidden]
  )

  if (!ctx) return null

  const run = (action: CtxAction): void => {
    switch (action.kind) {
      case 'hide':
        return st.hide(action.ids)
      case 'isolate':
        return st.isolate(action.ids)
      case 'select':
        return st.select(action.ids, false)
      // `:1915` — "Zoom to" is the same `select`, asked to fly. Both `Properties` and
      // `Select similar` are the `select` case above; only the ids differ.
      case 'zoomTo':
        return st.select(action.ids, true)
      case 'ask':
        return st.askAbout(action.ids)
      case 'showAll':
        return st.showAll()
      case 'zoomExtents':
        // `:1920` — the menu closes itself here, because `view()` does not go through `up`.
        st.setCtx(null)
        return st.setView('iso')
    }
  }

  /** Roving focus, and Tab kept inside. Home / End must not reach the window's own `Home`. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const node = box.current
    if (!node) return
    const list = focusables(node)
    const i = Math.max(0, list.indexOf(document.activeElement as HTMLElement))
    const move = (next: number): void => {
      event.preventDefault()
      event.stopPropagation()
      const n = (next + list.length) % list.length
      setAt(n)
      list[n]?.focus()
    }
    if (event.key === 'ArrowDown') return move(i + 1)
    if (event.key === 'ArrowUp') return move(i - 1)
    if (event.key === 'Home') return move(0)
    if (event.key === 'End') return move(list.length - 1)
    if (trapTab(node, event)) event.preventDefault()
  }

  return (
    <div
      ref={box}
      role="menu"
      onKeyDown={onKeyDown}
      style={s(
        `position:fixed;left:${ctx.x}px;top:${top}px;min-width:200px;display:flex;flex-direction:column;padding:4px;background:var(--card);border:1px solid var(--border-strong);border-radius:8px;box-shadow:var(--shadow);z-index:10;animation:fadein .1s ease-out`
      )}
    >
      {items.map((m, i) => (
        <button
          key={m.label}
          role="menuitem"
          tabIndex={i === at ? 0 : -1}
          onFocus={() => setAt(i)}
          onClick={() => run(m.action)}
          className="hv-step"
          style={s(
            `display:flex;justify-content:space-between;gap:12px;font:400 13px/1.3 var(--sans);color:${m.fg};padding:7px 10px;border-radius:6px;border-top:${m.top}`
          )}
        >
          <span>{m.label}</span>
          <span style={s('font:400 11px/1.3 var(--mono);color:var(--faint)')}>{m.key}</span>
        </button>
      ))}
    </div>
  )
}
