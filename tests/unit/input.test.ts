/**
 * The pointer model — `design-reference/design/viewer-core.js` L533–603.
 *
 * The decisions the reference makes on every event — one finger or two, orbit or pan, toggle
 * or replace, how far the wheel dollies — are exported as plain functions so they can be
 * checked here. The event wiring around them is as thin as the reference's and is exercised
 * by the parity captures instead.
 */
import { describe, expect, it } from 'vitest'
import {
  DOLLY_RATE,
  DRAG_THRESHOLD,
  PINCH_DEADZONE,
  PINCH_MAX,
  PINCH_MIN,
  createTouchTracker,
  dollyFactor,
  dragMode,
  pinchFactor,
  selectMode
} from '../../src/renderer/viewer/input'

const pt = (pointerId: number, clientX: number, clientY: number): { pointerId: number; clientX: number; clientY: number } => ({
  pointerId,
  clientX,
  clientY
})

describe('the touch tracker — one finger vs two (L536–548)', () => {
  it('reports no pinch with one finger down', () => {
    const t = createTouchTracker()
    t.add(pt(1, 100, 100))
    expect(t.size).toBe(1)
    expect(t.two()).toBeNull()
  })

  it('reports the span and midpoint with exactly two fingers', () => {
    const t = createTouchTracker()
    t.add(pt(1, 100, 100))
    t.add(pt(2, 100, 200))
    expect(t.two()).toEqual({ d: 100, x: 100, y: 150 })
  })

  it('reports no pinch again with three fingers down', () => {
    const t = createTouchTracker()
    t.add(pt(1, 0, 0))
    t.add(pt(2, 0, 100))
    t.add(pt(3, 100, 0))
    expect(t.size).toBe(3)
    expect(t.two()).toBeNull()
  })

  it('tracks a finger by its id, so moving one updates rather than adds', () => {
    const t = createTouchTracker()
    t.add(pt(1, 0, 0))
    t.add(pt(2, 0, 100))
    t.add(pt(1, 0, -100))
    expect(t.size).toBe(2)
    expect(t.two()!.d).toBe(200)
  })

  it('only knows the fingers that went down on the canvas (L544)', () => {
    const t = createTouchTracker()
    t.add(pt(1, 0, 0))
    expect(t.has(pt(1, 0, 0))).toBe(true)
    expect(t.has(pt(9, 0, 0))).toBe(false)
    t.remove(pt(1, 0, 0))
    expect(t.has(pt(1, 0, 0))).toBe(false)
  })

  it('forgets a lifted finger and clears every one at once', () => {
    const t = createTouchTracker()
    t.add(pt(1, 0, 0))
    t.add(pt(2, 0, 100))
    t.remove(pt(2, 0, 100))
    expect(t.size).toBe(1)
    expect(t.two()).toBeNull()
    t.clear()
    expect(t.size).toBe(0)
  })
})

describe('dragMode (L583)', () => {
  it('pans on a plain left drag', () => {
    expect(dragMode(0, false, 'mouse')).toBe('pan')
  })

  it('orbits on Shift + left', () => {
    expect(dragMode(0, true, 'mouse')).toBe('orbit')
  })

  it('orbits on any touch drag, Shift or not', () => {
    expect(dragMode(0, false, 'touch')).toBe('orbit')
    expect(dragMode(2, false, 'touch')).toBe('orbit')
  })

  it('pans on Shift + a button other than the left one', () => {
    // The reference tests `down.btn === 0 && e.shiftKey`, so Shift + right still pans.
    expect(dragMode(2, true, 'mouse')).toBe('pan')
    expect(dragMode(1, true, 'mouse')).toBe('pan')
  })
})

describe('selectMode (L588)', () => {
  it('replaces with no modifier and toggles with Ctrl or ⌘', () => {
    expect(selectMode(false, false)).toBe('replace')
    expect(selectMode(true, false)).toBe('toggle')
    expect(selectMode(false, true)).toBe('toggle')
    expect(selectMode(true, true)).toBe('toggle')
  })
})

describe('dollyFactor (L594)', () => {
  it('is exp(deltaY × 0.0011), so a still wheel changes nothing', () => {
    expect(dollyFactor(0)).toBe(1)
    expect(dollyFactor(100)).toBeCloseTo(Math.exp(100 * DOLLY_RATE), 12)
    expect(DOLLY_RATE).toBe(0.0011)
  })

  it('is symmetric: scrolling back undoes scrolling forward', () => {
    expect(dollyFactor(120) * dollyFactor(-120)).toBeCloseTo(1, 12)
  })

  it('pushes the camera out scrolling down and pulls it in scrolling up', () => {
    expect(dollyFactor(120)).toBeGreaterThan(1)
    expect(dollyFactor(-120)).toBeLessThan(1)
  })
})

describe('pinchFactor (L551)', () => {
  it('dollies in when the fingers move apart', () => {
    // previous / now: a larger span now gives a factor below 1.
    expect(pinchFactor(100, 200)).toBeCloseTo(0.5, 12)
    expect(pinchFactor(200, 100)).toBeCloseTo(2, 12)
  })

  it('clamps a wild jump to [0.5, 2]', () => {
    expect(pinchFactor(100, 1000)).toBe(PINCH_MIN)
    expect(pinchFactor(1000, 100)).toBe(PINCH_MAX)
    expect([PINCH_MIN, PINCH_MAX]).toEqual([0.5, 2])
  })
})

describe('the thresholds', () => {
  it('are the reference\'s 3 px drag and 0.5 px pinch deadzone', () => {
    expect(DRAG_THRESHOLD).toBe(3)
    expect(PINCH_DEADZONE).toBe(0.5)
  })
})
