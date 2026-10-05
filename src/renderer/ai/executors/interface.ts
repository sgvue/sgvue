/**
 * `set_interface` — the app's own settings, and how `get_view_state` reads them back
 * (2026-10-02; parity with the user, phase 1 — the owner: *"assistant should possess everything
 * user can do on the app"*).
 *
 * Eight settings, each through **the action or handler its own control calls**:
 *
 *   theme            the toolbar's Light / dark button            `setTheme`
 *   units            the Markups card's mm / m                    `setUnits`
 *   treeMode         the sidebar's by Entity / by PredefType      `setTreeMode`
 *   sidebar          its collapse button and the rail's expand    `togglePanel`
 *   card             the six buttons that open a card, and its ×  `openCard` / `closeCard`
 *   tool             the toolbar's Select / Laser meter / Spot    `setTool`
 *   search           the tree's search box                        `setSearch`
 *   schedulesWindow  the toolbar's Schedules button               `window.sgvue.openSchedules()`
 *
 * `togglePanel` and `openCard` are toggles — the card's own button closes it again — so each
 * setting is **compared first and its action called only when it differs**: a call is
 * idempotent, and a setting already as asked is reported as such.
 *
 * None of these is the model, and none is what is visible, so the tool's description tells the
 * model to use it only when the user asks.
 *
 * **A call marks the turn as changed (`acted`) when it changed a setting the per-turn revert
 * can put back** — every one of them but the Schedules window, which no revert closes. Until
 * phase 2 it marked nothing: the revert restored the five visibility keys and could not put a
 * theme or an armed tool back, so it was not offered for one. It restores them now
 * (`state/selectors/snapshot.ts`; the owner, 2026-10-01: *"correct."*).
 *
 * **And it says which parts it changed itself** (`ui.parts`). The settings are applied in one
 * synchronous block; opening the Schedules window then *waits*, for seconds, and whatever the
 * user does meanwhile — an orbit, a click on the gridlines button — would otherwise be measured
 * as this call's and put back by the reply's revert. So the review state is read before that
 * block and again straight after it, before the wait.
 *
 * Arming the laser meter or the spot tool places nothing: the user's own click on the model
 * does. Opening the Schedules window opens nothing inside it.
 */
import { INTERFACE_SEARCH_MAX } from '../../../shared/tool-schemas'
import { api } from '../../api'
import { scheduleConnected, whenScheduleConnected } from '../../model/schedule-link'
import { changedParts } from '../../state/selectors/snapshot'
import type { CardName, ShellState, Theme, TreeMode, Units } from '../../state/shell'
import type { Tool } from '../../viewer/viewer-core'
import { reviewState, type Executor } from './context'
import { CONNECT_WAIT_MS } from './schedule'

/** The interface as the assistant reads it back — `get_view_state`'s `interface`, and this tool's. */
export interface InterfaceState {
  theme: string
  units: string
  treeMode: string
  sidebar: 'open' | 'collapsed'
  /** The card on the stage, or `none`. */
  card: string
  tool: string
  /** The tree's search text. A person types it, so it is clipped here. */
  search: string
  schedulesWindow: 'open' | 'closed'
}

export const interfaceState = (s: ShellState): InterfaceState => ({
  theme: s.theme,
  units: s.units,
  treeMode: s.treeMode,
  sidebar: s.panelOpen ? 'open' : 'collapsed',
  card: s.card ?? 'none',
  tool: s.tool,
  search: s.search.length > INTERFACE_SEARCH_MAX ? s.search.slice(0, INTERFACE_SEARCH_MAX) : s.search,
  schedulesWindow: scheduleConnected() ? 'open' : 'closed'
})

export const set_interface: Executor = async (input, ctx) => {
  /** Before any setting moves: the measurement below is this call's own. */
  const before = reviewState(ctx)
  const changed: string[] = []
  const already: string[] = []
  /** What could not be done, in words. Nothing here throws for it. */
  const notes: string[] = []
  const said: string[] = []
  /** One setting: `was` it already so — else `move` it — and how each outcome reads. */
  const settle = (done: string, same: string, was: boolean, move: () => void): void => {
    if (was) {
      already.push(done)
      said.push(same)
      return
    }
    move()
    changed.push(done)
    said.push(done)
  }
  // Read fresh every time: one setting's action must not be judged against another's snapshot.
  const now = (): ShellState => ctx.state()

  if (typeof input.sidebar === 'string') {
    const open = input.sidebar === 'open'
    settle(`sidebar ${input.sidebar}`, `sidebar already ${input.sidebar}`, now().panelOpen === open, () =>
      now().togglePanel()
    )
  }
  if (typeof input.theme === 'string') {
    const theme = input.theme as Theme
    settle(`theme ${theme}`, `theme already ${theme}`, now().theme === theme, () => now().setTheme(theme))
  }
  if (typeof input.units === 'string') {
    const units = input.units as Units
    settle(`units ${units}`, `units already ${units}`, now().units === units, () => now().setUnits(units))
  }
  if (typeof input.treeMode === 'string') {
    const mode = input.treeMode as TreeMode
    const by = mode === 'entity' ? 'entity' : 'PredefinedType'
    settle(`tree by ${by}`, `tree already by ${by}`, now().treeMode === mode, () => now().setTreeMode(mode))
  }
  if (typeof input.card === 'string') {
    if (input.card === 'none') {
      settle('card closed', 'no card was open', now().card === null, () => now().closeCard())
    } else {
      const card = input.card as CardName
      // `openCard` on the open card closes it, so it is only called for a card that is not up.
      settle(`${card} card open`, `${card} card already open`, now().card === card, () => now().openCard(card))
    }
  }
  if (typeof input.tool === 'string') {
    const tool = input.tool as Tool
    settle(`${tool} tool armed`, `${tool} tool already armed`, now().tool === tool, () => now().setTool(tool))
  }
  if (typeof input.search === 'string') {
    const text = input.search
    settle(
      text ? `tree search "${text}"` : 'tree search cleared',
      text ? `tree search already "${text}"` : 'tree search already empty',
      now().search === text,
      () => now().setSearch(text)
    )
  }
  /** Everything above is a setting the per-turn revert restores; the window below is not. */
  const revertable = changed.length
  // Measured here, before the wait below: what the user does while the window opens is theirs.
  const parts = revertable ? changedParts(before, reviewState(ctx)) : []
  if (input.schedulesWindow === 'open') {
    const bridge = api()
    const was = scheduleConnected()
    if (!bridge) notes.push('The Schedules window cannot be opened here.')
    else {
      let asked = true
      try {
        // The button's own call. On a window that is already open it brings it to the front.
        await bridge.openSchedules()
      } catch {
        asked = false
      }
      if (was) {
        already.push('Schedules window open')
        said.push('Schedules window already open — brought to the front')
      } else if (asked && (await whenScheduleConnected(CONNECT_WAIT_MS))) {
        changed.push('Schedules window open')
        said.push('Schedules window open')
      } else {
        notes.push(
          `The Schedules window did not open within ${CONNECT_WAIT_MS / 1000} s; the user can open it from the toolbar's schedules button.`
        )
      }
    }
  }

  const state = interfaceState(now())
  // The tree is the sidebar's: a search or a grouping set while it is collapsed is not on screen.
  if (state.sidebar === 'collapsed' && (typeof input.search === 'string' || typeof input.treeMode === 'string')) {
    notes.push('The sidebar is collapsed, so the element tree is not on screen.')
  }
  const head = said.length ? said.join(', ') + '.' : notes.length ? '' : 'Nothing to change.'
  return {
    forModel: {
      message: [head, ...notes].filter(Boolean).join(' '),
      changed,
      already,
      interface: state
    },
    // Only what a revert can put back; an opened Schedules window is not (the header has it).
    ui: { acted: revertable > 0, parts }
  }
}

export const INTERFACE_EXECUTORS: Record<string, Executor> = { set_interface }
