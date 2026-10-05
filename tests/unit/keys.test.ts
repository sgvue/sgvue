/** The keyboard map — `SGVue.dc.html:1080–1092`, as a pure decision. */
import { describe, expect, it } from 'vitest'
import { isFieldTarget, keyAction, type KeyState } from '../../src/renderer/state/keys'

const idle: KeyState = {
  hasCtx: false,
  tool: 'select',
  hasCard: false,
  selCount: 0,
  hasSel: false
}
const act = (key: string, s: Partial<KeyState> = {}, mods: Record<string, boolean> = {}) =>
  keyAction({ key, ...mods }, { ...idle, ...s })

describe('onKey', () => {
  it('never fires while a field has focus', () => {
    expect(isFieldTarget('INPUT')).toBe(true)
    expect(isFieldTarget('TEXTAREA')).toBe(true)
    expect(isFieldTarget('SELECT')).toBe(true)
    expect(isFieldTarget('BUTTON')).toBe(false)
    expect(isFieldTarget(undefined)).toBe(false)
  })

  it('Escape unwinds in order: menu, tool, card, selection', () => {
    expect(act('Escape', { hasCtx: true, tool: 'measure', hasCard: true })).toEqual({
      kind: 'closeCtx'
    })
    expect(act('Escape', { tool: 'measure', hasCard: true })).toEqual({ kind: 'cancelTool' })
    expect(act('Escape', { hasCard: true })).toEqual({ kind: 'closeCard' })
    expect(act('Escape')).toEqual({ kind: 'deselect' })
  })

  it('maps the tool, display and camera shortcuts in both cases', () => {
    expect(act('s')).toEqual({ kind: 'toggleSnap' })
    expect(act('S')).toEqual({ kind: 'toggleSnap' })
    expect(act('m')).toEqual({ kind: 'tool', tool: 'measure' })
    expect(act('M')).toEqual({ kind: 'tool', tool: 'measure' })
    expect(act('c')).toEqual({ kind: 'tool', tool: 'spot' })
    expect(act('C')).toEqual({ kind: 'tool', tool: 'spot' })
    expect(act('g')).toEqual({ kind: 'toggleGrids' })
    expect(act('l')).toEqual({ kind: 'toggleLevels' })
    expect(act('Home')).toEqual({ kind: 'view', name: 'iso' })
  })

  it('distinguishes shift-H (show all) from h (hide the selection)', () => {
    expect(act('H')).toEqual({ kind: 'showAll' })
    expect(act('H', { selCount: 3 })).toEqual({ kind: 'showAll' })
    expect(act('h', { selCount: 3 })).toEqual({ kind: 'hide' })
    // …and `h` does nothing with nothing selected.
    expect(act('h')).toBe(null)
  })

  it('needs a selection for isolate, dimensions and zoom-to', () => {
    expect(act('i')).toBe(null)
    expect(act('i', { selCount: 1 })).toEqual({ kind: 'isolate' })
    expect(act('I', { selCount: 1 })).toEqual({ kind: 'isolate' })
    expect(act('d')).toBe(null)
    expect(act('d', { selCount: 1 })).toEqual({ kind: 'toggleDims' })
    expect(act('f')).toBe(null)
    expect(act('f', { hasSel: true })).toEqual({ kind: 'zoomTo' })
    expect(act('F', { hasSel: true })).toEqual({ kind: 'zoomTo' })
  })

  it('reserves ⌘Z / ⇧⌘Z for undo and redo, and only with the modifier', () => {
    expect(act('z', {}, { metaKey: true })).toEqual({ kind: 'step', back: true })
    expect(act('z', {}, { ctrlKey: true })).toEqual({ kind: 'step', back: true })
    expect(act('Z', {}, { metaKey: true, shiftKey: true })).toEqual({ kind: 'step', back: false })
    expect(act('z')).toBe(null)
  })

  it('ignores anything else', () => {
    expect(act('q')).toBe(null)
    expect(act('ArrowLeft')).toBe(null)
  })
})
