/**
 * 2026-11-08 — the owner's IFC-term decision, in the trace's own lines. The diary's steps and the
 * storey-rows card's title name what a call filtered and checked **in the file's own spelling**
 * (`Filtering IfcWall`, `Checking FireRating`, `FireRating · missing` — the approved prototype's
 * diary, where the app had `Checking Fire Rating`), and a name that is an IFC term of the loaded
 * models is drawn as Vee's text draws one: `.ifc-term`, the one colour. What is held here:
 *
 *   · `toolFacts` keeps the file's spelling and lists the shown names that are terms — only those,
 *     and nothing at all without a vocabulary, so a fact is otherwise as it was;
 *   · the live diary's steps carry them, from the real trace store on the demo building;
 *   · a finished reply's trace carries its terms over the port, worked out per federation, so a
 *     name no longer loaded falls back to plain;
 *   · the renderers colour exactly those names — a near miss stays plain — and never as HTML.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import { VeeMessage } from '../../src/shared/vee-messages'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { toolFacts } from '../../src/renderer/ai/trace-facts'
import { isTerm, namePieces, traceTermsOf, vocabularyOf } from '../../src/renderer/ai/terms'
import { traceFrame } from '../../src/renderer/ai/trace'
import { pinTrace, traceBegin, traceDone, traceFail, traceState, traceToolExec, traceToolStart } from '../../src/renderer/ai/trace-store'
import { snapshotOf } from '../../src/renderer/model/vee-link'
import { setViewer, useShell, type ChatMessage } from '../../src/renderer/state/shell'
import { Diary, paintTermText, TermText } from '../../src/renderer/app/Trace'
import { memoryStorage, resetShell, stubViewer } from './stub-viewer'

const fed = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
const vocab = vocabularyOf(fed)
const term = (n: string): boolean => isTerm(vocab, n)
const rule = (prop: string, op: string, val: unknown, join?: 'and' | 'or') => ({ prop, op, val, ...(join ? { join } : {}) })
const WALLS = { rules: [rule('IfcEntity', '=', 'IfcWall'), rule('ThermalTransmittance', 'absent', null, 'and')] }

beforeEach(() => {
  resetShell()
  traceFail()
})
afterEach(() => {
  pinTrace(null)
  setViewer(null)
  vi.unstubAllGlobals()
})

describe('toolFacts: the file’s spelling, and which names are IFC terms', () => {
  it('names the class and the property as the file does, and lists both as terms', () => {
    const r = toolFacts('query_elements', WALLS, fed, term).rules!
    expect(r.filter).toEqual({ what: 'IfcWall', count: 80, noun: 'wall', terms: ['IfcWall'] })
    expect(r.check).toEqual({ props: 'ThermalTransmittance', count: 24, unit: 'missing', terms: ['ThermalTransmittance'] })
  })

  it('lists no term for a name the models do not carry as one — a storey, an absent phrase, three properties', () => {
    const level = toolFacts('query_elements', { rules: [rule('Level', '=', 'L2'), rule('FireRating', '=', '-', 'and')] }, fed, term).rules!
    expect(level.filter).toEqual({ what: 'L2', count: expect.any(Number), noun: 'element' })
    expect(level.check).toMatchObject({ props: 'FireRating', terms: ['FireRating'] })
    const absent = toolFacts('query_elements', { rules: [rule('FireRating', 'absent', null), rule('IfcEntity', '=', 'IfcDoor', 'and')] }, fed, term)
    expect(absent.rules!.check).toMatchObject({ props: 'FireRating', terms: ['FireRating'] })
    const three = toolFacts(
      'query_elements',
      { rules: [rule('FireRating', '=', '2 HR'), rule('LoadBearing', '=', 'true', 'and'), rule('IsExternal', '=', 'false', 'and')] },
      fed,
      term
    ).rules!
    expect(three.check).toEqual({ props: '3 properties', count: expect.any(Number), unit: 'found' })
  })

  it('adds nothing without a vocabulary: the facts are what they were, but for the spelling', () => {
    const r = toolFacts('query_elements', WALLS, fed).rules!
    expect(r.filter).toEqual({ what: 'IfcWall', count: 80, noun: 'wall' })
    expect(r.check).toEqual({ props: 'ThermalTransmittance', count: 24, unit: 'missing' })
  })
})

describe('the live diary: its steps carry the terms, from the real trace store', () => {
  it('shows `Filtering IfcWall` and `Checking ThermalTransmittance`, each name a term', () => {
    pinTrace(10)
    traceBegin(fed, 1)
    pinTrace(12.4)
    traceToolStart()
    pinTrace(12.5)
    traceToolExec('query_elements', WALLS, fed)
    const tl = traceState().timeline!
    const steps = traceFrame(tl, 20, { width: 266, dpr: 1, textH: 0, reduced: true }).steps
    expect(steps.map((st) => [st.label + st.mono, st.terms])).toEqual([
      ['Reading 4 models', []],
      ['Filtering IfcWall', ['IfcWall']],
      ['Checking ThermalTransmittance', ['ThermalTransmittance']]
    ])
    pinTrace(20.2)
    const kept = traceDone('Done.', false)!
    expect(kept.title).toBe('ThermalTransmittance · missing')
    expect(kept.steps!.map((st) => st.mono)).toEqual(['', 'IfcWall', 'ThermalTransmittance'])
  })
})

describe('a finished reply: its trace’s terms cross the port, worked out per federation', () => {
  it('names the title’s and the steps’ terms, a near miss and a storey left out', () => {
    expect(namePieces('FireRating, IsExternal · missing')).toEqual([
      { text: 'FireRating', name: true },
      { text: ', ', name: false },
      { text: 'IsExternal', name: true },
      { text: ' · ', name: false },
      { text: 'missing', name: true }
    ])
    // A name with a space in it is one name.
    expect(namePieces('D2 Double 2400x2400')).toEqual([{ text: 'D2 Double 2400x2400', name: true }])
    expect(
      traceTermsOf(vocab, {
        title: 'FireRating · missing',
        steps: [{ mono: '' }, { mono: 'IfcDoor' }, { mono: 'Fire Rating' }, { mono: 'L2' }, { mono: 'D2 Double 2400x2400' }]
      })
    ).toEqual(['FireRating', 'IfcDoor', 'D2 Double 2400x2400'])
  })

  it('sends them on the snapshot, bounded and strict, and drops a name no longer loaded', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    setViewer(stubViewer())
    useShell.getState().commitModels(fed)
    const reply: ChatMessage = {
      role: 'assistant',
      text: 'Done.',
      trace: {
        status: '1s',
        wide: true,
        rows: [],
        noun: 'wall',
        fold: '412 read · 80 walls · 24 missing · 1s',
        steps: [
          { label: 'Filtering ', mono: 'IfcWall', n: 80, unit: 'walls' },
          { label: 'Checking ', mono: 'ThermalTransmittance', n: 24, unit: 'missing' }
        ],
        title: 'ThermalTransmittance · missing'
      }
    }
    useShell.setState({ chatMsgs: [reply] })
    const sent = snapshotOf(useShell.getState()).msgs[0]
    expect(sent.trace!.terms).toEqual(['ThermalTransmittance', 'IfcWall'])
    expect(VeeMessage.safeParse(sent).success).toBe(true)
    // The site model alone carries no wall: neither name is a term of it any more.
    useShell.getState().commitModels(federate(['SIT'].map((k) => mockModelIndex(k))))
    useShell.setState({ chatMsgs: [reply] })
    expect(snapshotOf(useShell.getState()).msgs[0].trace).not.toHaveProperty('terms')
  })
})

describe('the renderers: exactly the terms in the one colour, never HTML', () => {
  it('draws a reopened diary’s step and the storey-rows title with their terms coloured, a near miss plain', () => {
    const html = renderToStaticMarkup(
      createElement(Diary, {
        fold: 'x',
        steps: [
          { label: 'Filtering ', mono: 'L2', n: 9, unit: 'elements' },
          { label: 'Checking ', mono: 'FireRating', n: 3, unit: 'missing' },
          { label: 'Checking ', mono: 'Fire Rating', n: 3, unit: 'missing' }
        ],
        slots: 0,
        timeline: null,
        owned: false,
        terms: ['FireRating']
      })
    )
    expect(html).toContain('<code><span class="ifc-term">FireRating</span></code>')
    expect(html).toContain('<code>L2</code>')
    expect(html).toContain('<code>Fire Rating</code>')
    const title = renderToStaticMarkup(createElement(TermText, { text: 'FireRating · missing', terms: ['FireRating'] }))
    expect(title).toBe('<span class="ifc-term">FireRating</span> · missing')
    expect(renderToStaticMarkup(createElement(TermText, { text: 'FireRating · missing', terms: undefined }))).toBe('FireRating · missing')
    const evil = '<img src=x onerror=alert(1)>'
    expect(renderToStaticMarkup(createElement(TermText, { text: evil, terms: [evil] }))).not.toContain('<img')
  })

  it('paints a live step’s names the same way, and only rebuilds when they change', () => {
    // The smallest document the painter needs: text nodes and spans, as plain objects.
    type Fake = { className?: string; textContent: string }
    const made: Fake[] = []
    vi.stubGlobal('document', {
      createTextNode: (t: string): Fake => ({ textContent: t }),
      createElement: (): Fake => {
        const e: Fake = { className: '', textContent: '' }
        made.push(e)
        return e
      }
    })
    let kids: Fake[] = []
    const node = {
      get textContent(): string {
        return kids.map((k) => k.textContent).join('')
      },
      set textContent(t: string) {
        kids = [{ textContent: t }]
      },
      replaceChildren: (...c: Fake[]): void => {
        kids = c
      }
    } as unknown as HTMLElement
    paintTermText(node, 'IfcWall', ['IfcWall'])
    expect(kids).toEqual([{ className: 'ifc-term', textContent: 'IfcWall' }])
    paintTermText(node, 'IfcWall', ['IfcWall'])
    expect(made).toHaveLength(1)
    paintTermText(node, 'L2', [])
    expect(kids).toEqual([{ textContent: 'L2' }])
  })
})
