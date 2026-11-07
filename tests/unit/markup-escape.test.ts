/**
 * 2026-11-07, lint hardening step 4 — text authored inside an IFC file is untrusted, and the two
 * places it reached `innerHTML` unescaped were the 3D view's grid bubbles (an `IfcGridAxis` tag)
 * and its level tags (an `IfcBuildingStorey` name). Both now go through `esc` (`shared/html.ts`).
 *
 * The test environment has no DOM, so "renders as text" is checked the way the HTML parser
 * decides it: a string with no `<` in it cannot open an element, and one whose every `&` starts
 * one of `esc`'s five references cannot spell any other entity — so the parser's text node is
 * exactly the original string, which `unesc` reads back.
 */
import { Box3, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { levelTagHtml } from '../../src/shared/annotate'
import { esc } from '../../src/shared/html'
import { formatElevation } from '../../src/shared/units'
import { esc as scheduleEsc } from '../../src/renderer/schedule-ui/dom'
import { createAnnotations, type AnnotationHost } from '../../src/renderer/viewer/annotations'
import type { Label, LabelOverlay } from '../../src/renderer/viewer/overlay'

const HOSTILE = '<img src=x onerror=alert(1)>'
const REFS: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

/** True when the HTML parser can only read `s` as text: no tag, no reference but esc's own. */
const inertText = (s: string): boolean => !s.includes('<') && !/&(?!amp;|lt;|gt;|quot;|#39;)/.test(s)
const unesc = (s: string): string => s.replace(/&(amp|lt|gt|quot|#39);/g, (r) => REFS[r])

describe('esc', () => {
  it('escapes the five characters that can open markup or leave an attribute', () => {
    expect(esc(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
    expect(esc(null)).toBe('')
    expect(esc(12)).toBe('12')
    const out = esc(HOSTILE)
    expect(inertText(out)).toBe(true)
    expect(unesc(out)).toBe(HOSTILE)
  })

  it('leaves ordinary names byte for byte as they were', () => {
    for (const name of ['A', '1', 'A.1', 'Level 2', 'L02 — Podium', 'Ebene 3 / Dach']) expect(esc(name)).toBe(name)
  })

  it('is the Schedules window’s esc, not a second one', () => {
    expect(scheduleEsc).toBe(esc)
  })
})

describe('the level tag prints a storey name as text', () => {
  it('escapes a hostile name', () => {
    const html = levelTagHtml(HOSTILE, 4)
    const inner = /^<b style="font-weight:500;color:var\(--ink\)">(.*)<\/b>&nbsp; /.exec(html)?.[1]
    expect(inner).toBeDefined()
    expect(inertText(inner!)).toBe(true)
    expect(unesc(inner!)).toBe(HOSTILE)
    expect(html).not.toContain('<img')
  })

  it('is the markup it always was for an ordinary name', () => {
    expect(levelTagHtml('L2', 4)).toBe(`<b style="font-weight:500;color:var(--ink)">L2</b>&nbsp; ${formatElevation(4, 'mm')}`)
  })
})

/** The labels the annotation layer makes for these grids and storeys, through a stub overlay. */
function labelsFor(
  grids: { name: string; p0: [number, number]; p1: [number, number] }[],
  storeys: { name: string; elev: number; authored: number }[]
): Label[] {
  const labels: Label[] = []
  const overlay = {
    labels,
    labelBase: () => ({}),
    mkLabel: (pos: Vector3, html: string, style = {}, dx = 0, dy = 0) => {
      const el = { innerHTML: html, style: { ...style }, title: '', addEventListener: () => {} }
      const label: Label = {
        el: el as unknown as HTMLDivElement,
        pos: pos.clone(),
        dx,
        dy,
        on: true,
        remove: () => void labels.splice(labels.indexOf(label), 1)
      }
      labels.push(label)
      return label
    },
    mkElement: () => {
      throw new Error('not used')
    },
    update: () => {},
    updateOcclusion: () => false,
    dispose: () => {}
  } as unknown as LabelOverlay
  const box = new Box3(new Vector3(-2, -2, -1), new Vector3(14, 10, 8))
  const host: AnnotationHost = {
    overlay,
    materials: {} as unknown as AnnotationHost['materials'],
    bbox: box,
    scale: () => 1,
    frame: box,
    frameScale: () => 1,
    plan: () => 0,
    groundZ: () => 0,
    camera: () => {
      throw new Error('not used')
    },
    view: () => ({ theta: -Math.PI / 2, phi: 0.0001 }),
    size: () => ({ w: 1280, h: 820 }),
    grids: () => grids,
    storeys: () => storeys,
    elementBox: () => null,
    isVisible: () => true,
    ray: () => null,
    offset: () => [0, 0, 0],
    invalidate: () => {},
    on: {}
  }
  const ann = createAnnotations(host)
  ann.setLevels(true)
  ann.rebuild()
  return labels
}

describe('a grid bubble prints its grid’s tag as text', () => {
  const grids: { name: string; p0: [number, number]; p1: [number, number] }[] = [
    { name: 'A', p0: [0, -1], p1: [0, 9] },
    { name: HOSTILE, p0: [6, -1], p1: [6, 9] },
    { name: '1', p0: [-1, 0], p1: [13, 0] },
    { name: '2', p0: [-1, 8], p1: [13, 8] }
  ]
  const labels = labelsFor(grids, [{ name: HOSTILE, elev: 0, authored: 0 }])
  const bubbles = (name: string) => labels.filter((l) => l.el.title === `Show plane of grid ${name}`)

  it('escapes a hostile tag in both of its bubbles', () => {
    const two = bubbles(HOSTILE)
    expect(two).toHaveLength(2)
    for (const b of two) {
      expect(inertText(b.el.innerHTML)).toBe(true)
      expect(unesc(b.el.innerHTML)).toBe(HOSTILE)
    }
  })

  it('draws an ordinary tag as it always did', () => {
    for (const name of ['A', '1', '2']) for (const b of bubbles(name)) expect(b.el.innerHTML).toBe(name)
  })

  it('escapes a hostile storey name in the level tag', () => {
    const tags = labels.filter((l) => l.el.innerHTML.startsWith('<b style="font-weight:500;color:var(--ink)">'))
    expect(tags).toHaveLength(1)
    expect(tags[0].el.innerHTML).not.toContain('<img')
    expect(tags[0].el.innerHTML).toBe(levelTagHtml(HOSTILE, 0))
  })
})
