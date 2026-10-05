/**
 * `onKey` — `SGVue.dc.html:1080–1092`, split into a pure decision and a dispatcher so the
 * mapping can be tested without a window.
 *
 * Two details that look like typos and are not: `H` (shift) shows everything while `h` hides
 * the selection, and the Escape branch is a **cascade** — context menu, then tool, then card,
 * then selection — so one key unwinds whatever is on top.
 */
import type { Tool } from '../viewer/viewer-core'
import { getViewer, useShell, type ShellState } from './shell'

export type KeyAction =
  | { kind: 'closeCtx' }
  | { kind: 'cancelTool' }
  | { kind: 'closeCard' }
  | { kind: 'deselect' }
  /** ⌘Z / Ctrl+Z; `back: false` is the ⇧⌘Z redo. */
  | { kind: 'step'; back: boolean }
  | { kind: 'toggleSnap' }
  | { kind: 'tool'; tool: Tool }
  | { kind: 'toggleGrids' }
  | { kind: 'toggleLevels' }
  | { kind: 'view'; name: string }
  | { kind: 'showAll' }
  | { kind: 'hide' }
  | { kind: 'isolate' }
  | { kind: 'toggleDims' }
  | { kind: 'zoomTo' }

export interface KeyState {
  hasCtx: boolean
  tool: Tool
  hasCard: boolean
  selCount: number
  hasSel: boolean
}

export interface KeyEventLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
}

/** The design's own guard: a key typed into a field is not a shortcut. `:1081`. */
export const isFieldTarget = (tagName: string | undefined): boolean =>
  !!tagName && /INPUT|SELECT|TEXTAREA/.test(tagName)

export function keyAction(e: KeyEventLike, s: KeyState): KeyAction | null {
  const k = e.key
  if (k === 'Escape') {
    if (s.hasCtx) return { kind: 'closeCtx' }
    if (s.tool !== 'select') return { kind: 'cancelTool' }
    if (s.hasCard) return { kind: 'closeCard' }
    return { kind: 'deselect' }
  }
  if ((k === 'z' || k === 'Z') && (e.metaKey || e.ctrlKey)) return { kind: 'step', back: !e.shiftKey }
  if (k === 's' || k === 'S') return { kind: 'toggleSnap' }
  if (k === 'm' || k === 'M') return { kind: 'tool', tool: 'measure' }
  if (k === 'c' || k === 'C') return { kind: 'tool', tool: 'spot' }
  if (k === 'g' || k === 'G') return { kind: 'toggleGrids' }
  if (k === 'l' || k === 'L') return { kind: 'toggleLevels' }
  if (k === 'Home') return { kind: 'view', name: 'iso' }
  if (k === 'H') return { kind: 'showAll' }
  if (k === 'h' && s.selCount) return { kind: 'hide' }
  if ((k === 'i' || k === 'I') && s.selCount) return { kind: 'isolate' }
  if ((k === 'd' || k === 'D') && s.selCount) return { kind: 'toggleDims' }
  if ((k === 'f' || k === 'F') && s.hasSel) return { kind: 'zoomTo' }
  return null
}

export const keyStateOf = (s: ShellState): KeyState => ({
  hasCtx: !!s.ctx,
  tool: s.tool,
  hasCard: !!s.card,
  selCount: s.selIds.length,
  hasSel: s.sel != null
})

/** Window `keydown` handler. Mounted by `App`, removed on unmount — `:872`, `:876`. */
export function onKey(e: KeyboardEvent): void {
  if (isFieldTarget((e.target as HTMLElement | null)?.tagName)) return
  const s = useShell.getState()
  const action = keyAction(e, keyStateOf(s))
  if (!action) return
  const viewer = getViewer()
  switch (action.kind) {
    case 'closeCtx':
      return s.setCtx(null)
    case 'cancelTool':
      viewer?.cancel()
      return s.setTool('select')
    case 'closeCard':
      return s.closeCard()
    case 'deselect':
      return s.select(null)
    case 'step':
      // `SGVue.dc.html:1084` preventDefaults before stepping, so the platform's own undo
      // never also fires in whatever has focus.
      e.preventDefault()
      return s.step(action.back)
    case 'toggleSnap':
      return s.toggleSnap()
    case 'tool':
      return s.setTool(action.tool)
    case 'toggleGrids':
      return s.toggleGrids()
    case 'toggleLevels':
      return s.toggleLevels()
    case 'view':
      return s.setView(action.name)
    case 'showAll':
      return s.showAll()
    case 'hide':
      return s.hide(s.selIds)
    case 'isolate':
      return s.isolate(s.selIds)
    case 'toggleDims':
      return s.toggleDims()
    case 'zoomTo':
      if (s.sel != null) viewer?.zoomTo(s.sel)
      return
  }
}
