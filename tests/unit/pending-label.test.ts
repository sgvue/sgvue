/**
 * 2026-11-08 — a held change's label counts its elements in the right number. The consent card
 * read "Isolate 1 elements?": `apply_visibility`'s two labels — by rules and by a named set —
 * said `elements` whatever the count. One rule now, `elementsText`, and the consent card's
 * question follows it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { runToolWithUi } from '../../src/renderer/ai/bridge'
import { elementsText } from '../../src/renderer/ai/executors/view'
import { traceFail } from '../../src/renderer/ai/trace-store'
import { consentText } from '../../src/renderer/state/selectors/chat'
import { setViewer, useShell } from '../../src/renderer/state/shell'
import { memoryStorage, resetShell, stubViewer } from './stub-viewer'

const fed = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  resetShell()
  traceFail()
  setViewer(stubViewer())
  useShell.getState().commitModels(fed)
})
afterEach(() => {
  setViewer(null)
  vi.unstubAllGlobals()
})

/** An element whose name no other element shares, so a rule on its name matches it alone. */
const lone = fed.elements.find((e) => fed.elements.filter((x) => x.name === e.name).length === 1)!

describe('a held change counts its elements in the right number', () => {
  it('says `1 element` and `3 elements`', () => {
    expect([elementsText(0), elementsText(1), elementsText(2), elementsText(412)]).toEqual([
      '0 elements',
      '1 element',
      '2 elements',
      '412 elements'
    ])
  })

  it('holds one element isolated by rules as "isolate 1 element", and the card asks "Isolate 1 element?"', async () => {
    const r = await runToolWithUi('apply_visibility', { action: 'isolate', rules: [{ prop: 'Name', op: '=', val: lone.name }] })
    expect(r.forModel).toMatchObject({ applied: false, pending: true, matched: 1 })
    const label = r.ui.pending!.label
    expect(label).toBe(`isolate 1 element — leaves 1 of ${fed.elements.length} visible`)
    expect(consentText(label)).toEqual({ q: 'Isolate 1 element?', detail: `Leaves 1 of ${fed.elements.length} visible` })
  })

  it('holds one element named by id the same way, and three as "3 elements"', async () => {
    const one = await runToolWithUi('apply_visibility', { action: 'isolate', ids: [lone.id] })
    expect(one.ui.pending!.label).toBe(`isolate 1 element — leaves 1 of ${fed.elements.length} visible`)
    const three = await runToolWithUi('apply_visibility', { action: 'isolate', ids: fed.elements.slice(0, 3).map((e) => e.id) })
    expect(three.ui.pending!.label).toBe(`isolate 3 elements — leaves 3 of ${fed.elements.length} visible`)
  })
})
