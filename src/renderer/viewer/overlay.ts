/**
 * The DOM annotation overlay — `design-reference/design/viewer-core.js` L137–166 and
 * L706–723, ported as written.
 *
 * Every label the design draws over the viewport (grid bubbles, level tags, dimension
 * readings, the live laser reading) is an absolutely positioned `<div>` in
 * `[data-role="overlay"]`, moved each frame by a CSS transform rather than drawn in WebGL.
 * That is what gives them the shell's own type, borders and shadows for free, and it is why
 * they need the two corrections below.
 *
 * **Clamping**, because the camera frames the model and not the annotation: a tag whose
 * anchor has left the frame is pinned 6 px inside the edge instead of vanishing, and
 * `stack` keeps a column of pinned tags from piling on one another (`2 × half-height + 3`).
 *
 * **Occlusion**, because a DOM element has no depth test of its own: a grid bubble behind
 * the building would otherwise read as being in front of it. The reference fires a ray from
 * far behind the anchor *towards the camera* and hides the label if anything is in the way.
 * It is throttled to every fourth frame — occlusion only changes when the camera moves.
 *
 * Phase 2b builds the mechanism; the grid bubbles, level tags and dimension labels that use
 * it are Phase 6. The only label 2b creates is the snap marker's companion (`snap.ts`).
 */
import type { Box3, OrthographicCamera, PerspectiveCamera, Vector2 } from 'three/webgpu'
import { Vector3 } from 'three/webgpu'
import { declutterBubbles, type BubbleItem } from '../../shared/annotate'

/** `viewer-core.js` L152. Outside this NDC box a label is off screen. */
export const NDC_CULL = 1.3
/** L160–161. A clamped label keeps this much space from the viewport edge. */
export const CLAMP_MARGIN = 6
/** L162. Vertical gap between two stacked labels, on top of their own height. */
export const STACK_GAP = 3
/** L160. What `offsetWidth` / `offsetHeight` fall back to before a label has been laid out. */
export const DEFAULT_LABEL_W = 80
export const DEFAULT_LABEL_H = 20
/** L711. The occlusion test runs on one frame in four. */
export const OCCLUSION_EVERY = 4

export type ViewerCamera = PerspectiveCamera | OrthographicCamera

/** The reference's `L` object, L142. */
export interface Label {
  el: HTMLDivElement
  pos: Vector3
  dx: number
  dy: number
  /** Drawn at all. The design toggles whole families of labels with this. */
  on: boolean
  /** Pin inside the viewport rather than letting it leave the frame. */
  clamp?: boolean
  /** With `clamp`: keep clear of the label pinned above it. */
  stack?: boolean
  /** Take part in the occlusion test. */
  occlude?: boolean
  /** Written by the occlusion test; read by `update`. */
  occluded?: boolean
  /**
   * Take part in the grid-bubble declutter sweep: which row this label belongs to and its
   * place in that row's axis order (`shared/annotate.ts`). Absent for every other label.
   */
  declutter?: { row: string; order: number; after?: boolean }
  /** Written by the declutter sweep; the label is hidden exactly as an occluded one is. */
  crowded?: boolean
  remove(): void
}

/** Where a label's anchor lands on screen, and whether it should be drawn there. */
export interface Projected {
  x: number
  y: number
  /** Behind the camera (`v.z > 1`): never drawn, clamped or not. */
  behind: boolean
  /** Outside the ±1.3 NDC box: drawn only if the label clamps. */
  off: boolean
}

const _v = new Vector3()

/**
 * `viewer-core.js` L152–157. Project a world point to viewport pixels, with the reference's
 * two rejections. Pure, so `tests/unit/overlay.test.ts` can check it under Node.
 */
export function projectLabel(
  pos: Vector3,
  camera: ViewerCamera,
  w: number,
  h: number,
  dx = 0,
  dy = 0
): Projected {
  _v.copy(pos).project(camera)
  const behind = _v.z > 1
  const off = behind || _v.x < -NDC_CULL || _v.x > NDC_CULL || _v.y < -NDC_CULL || _v.y > NDC_CULL
  return { x: ((_v.x + 1) / 2) * w + dx, y: ((1 - _v.y) / 2) * h + dy, behind, off }
}

/** `viewer-core.js` L160–161. Keep a label's whole box inside the viewport. */
export function clampLabel(
  x: number,
  y: number,
  hw: number,
  hh: number,
  w: number,
  h: number
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, hw + CLAMP_MARGIN), w - hw - CLAMP_MARGIN),
    y: Math.min(Math.max(y, hh + CLAMP_MARGIN), h - hh - CLAMP_MARGIN)
  }
}

/**
 * `viewer-core.js` L162. Labels are visited in creation order and pushed *upwards* off the
 * one below: `lastStack` starts at `Infinity`, so the first is never moved.
 */
export function stackLabel(y: number, hh: number, lastStack: number): number {
  const gap = 2 * hh + STACK_GAP
  return y > lastStack - gap ? lastStack - gap : y
}

/** `viewer-core.js` L611 and L168 — the reference's own screen-space projection helper. */
export function toPixels(
  p: Vector3,
  camera: ViewerCamera,
  w: number,
  h: number,
  out: Vector2
): Vector2 {
  _v.copy(p).project(camera)
  out.x = ((_v.x + 1) / 2) * w
  out.y = ((1 - _v.y) / 2) * h
  return out
}

/** Does anything block the straight line from `origin` along `dir` within `far`? */
export type Blocked = (origin: Vector3, dir: Vector3, far: number) => boolean

export interface LabelOverlay {
  /** Live labels, in creation order — which is also the stacking order. */
  labels: Label[]
  /** `viewer-core.js` L138–145. */
  mkLabel(
    pos: Vector3,
    html: string,
    style?: Partial<CSSStyleDeclaration>,
    dx?: number,
    dy?: number
  ): Label
  /** `viewer-core.js` L146 — the shared look every designed label starts from. */
  labelBase(): Partial<CSSStyleDeclaration>
  /** A bare positioned element in the overlay, for things that are not labels (the marker). */
  mkElement(html: string, style?: Partial<CSSStyleDeclaration>): HTMLDivElement
  /** `updateLabels`, L147–165. Called every frame. */
  update(camera: ViewerCamera, w: number, h: number): void
  /**
   * `updateOcclusion`, L706–723 — called when its answer may have changed, with the
   * reference's one-frame-in-four throttle kept for `moving`.
   *
   * The reference calls this every frame and acts on one in four whatever is happening, which
   * on a real model is 78 rays through 26 539 elements over and over with the camera standing
   * still (measured: 83.8 ms a sweep). The answer can only change when the camera pose, the
   * occluders or the label set change, so `viewer-core.ts` calls this then and not otherwise;
   * `moving` keeps the design's cadence for the one case it was written for. Returns whether
   * the sweep actually ran, so the caller knows when its answer is current.
   */
  updateOcclusion(camera: ViewerCamera, bbox: Box3, blocked: Blocked, moving?: boolean): boolean
  dispose(): void
}

const _size = new Vector3()
const _dir = new Vector3()
const _origin = new Vector3()

export function createLabelOverlay(host: HTMLElement | null): LabelOverlay {
  const labels: Label[] = []
  const owned: HTMLElement[] = []

  const mkElement = (html: string, style?: Partial<CSSStyleDeclaration>): HTMLDivElement => {
    const el = document.createElement('div')
    Object.assign(
      el.style,
      { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', display: 'none' },
      style
    )
    el.innerHTML = html
    host?.appendChild(el)
    owned.push(el)
    return el
  }

  let occTick = 0

  return {
    labels,

    labelBase: () => ({
      font: '400 11px/1 "IBM Plex Mono", Consolas, monospace',
      color: 'var(--muted)',
      background: 'var(--card)',
      border: '1px solid var(--border-strong)',
      borderRadius: '5px',
      padding: '4px 6px',
      boxShadow: 'var(--shadow)'
    }),

    mkElement,

    mkLabel: (pos, html, style = {}, dx = 0, dy = 0) => {
      const el = document.createElement('div')
      Object.assign(
        el.style,
        {
          position: 'absolute',
          left: '0',
          top: '0',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          willChange: 'transform',
          display: 'none'
        },
        style
      )
      el.innerHTML = html
      host?.appendChild(el)
      const label: Label = {
        el,
        pos: pos.clone(),
        dx,
        dy,
        on: true,
        remove() {
          el.remove()
          const i = labels.indexOf(label)
          if (i >= 0) labels.splice(i, 1)
        }
      }
      labels.push(label)
      return label
    },

    update: (camera, w, h) => {
      let lastStack = Infinity
      /**
       * The bubbles that survived everything else this frame, with where they landed. A label
       * that is off, occluded, behind the camera or off screen never reaches this list, so it
       * reserves no space — the declutter sweep only arbitrates between bubbles that would
       * otherwise be drawn.
       */
      const crowd: { label: Label; x: number; y: number }[] = []
      for (const L of labels) {
        // `crowded` means "hidden by the declutter sweep **this frame**", so a label hidden
        // for any other reason clears it rather than carrying the last answer forward.
        if (!L.on || L.occluded) {
          L.el.style.display = 'none'
          L.crowded = false
          continue
        }
        const p = projectLabel(L.pos, camera, w, h, L.dx, L.dy)
        if ((p.off && !L.clamp) || p.behind) {
          L.el.style.display = 'none'
          L.crowded = false
          continue
        }
        L.el.style.display = ''
        let { x, y } = p
        if (L.clamp) {
          const hw = (L.el.offsetWidth || DEFAULT_LABEL_W) / 2
          const hh = (L.el.offsetHeight || DEFAULT_LABEL_H) / 2
          ;({ x, y } = clampLabel(x, y, hw, hh, w, h))
          if (L.stack) {
            y = stackLabel(y, hh, lastStack)
            lastStack = y
          }
        }
        L.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`
        if (L.declutter) crowd.push({ label: L, x, y })
      }
      if (!crowd.length) return
      /*
       * Measured in one pass, with no writes in between: `offsetWidth` flushes pending layout,
       * so reading it per label between two `style` writes forces one synchronous layout each
       * — measured on the reference model's 78 bubbles, 2.3 ms of main thread a frame. Reading
       * them together costs one flush. It is still each label's **own** box: `BUBBLE_STYLE`
       * sizes them but a theme, a font or a two-digit tag could not be assumed away, and
       * `transform` does not change a layout box, so this is the rect the viewer will see.
       */
      const items: BubbleItem[] = crowd.map(({ label: L, x, y }) => {
        const hw = (L.el.offsetWidth || DEFAULT_LABEL_W) / 2
        const hh = (L.el.offsetHeight || DEFAULT_LABEL_H) / 2
        return {
          key: `${L.declutter!.row}#${L.declutter!.order}`,
          row: L.declutter!.row,
          order: L.declutter!.order,
          after: L.declutter!.after,
          rect: { left: x - hw, top: y - hh, right: x + hw, bottom: y + hh }
        }
      })
      // Hidden the same way an occluded label is hidden — same `display`, no class, no DOM.
      // A hidden bubble cannot be clicked either, which is what makes it behave like one
      // behind the building.
      const shown = declutterBubbles(items)
      crowd.forEach(({ label }, i) => {
        label.crowded = !shown.has(items[i].key)
        if (label.crowded) label.el.style.display = 'none'
      })
    },

    updateOcclusion: (camera, bbox, blocked, moving = false) => {
      if (moving) {
        if (++occTick % OCCLUSION_EVERY) return false
      } else {
        occTick = 0
      }
      let any = false
      for (const L of labels) if (L.occlude) any = true
      if (!any) return true
      const span = (bbox.isEmpty() ? 0 : bbox.getSize(_size).length()) * 1.5 + 10
      camera.getWorldDirection(_dir)
      for (const L of labels) {
        if (!L.occlude) continue
        if (!L.on) {
          L.occluded = false
          continue
        }
        _origin.copy(L.pos).addScaledVector(_dir, -span)
        L.occluded = blocked(_origin, _dir, span - 0.25)
      }
      return true
    },

    dispose: () => {
      for (const L of [...labels]) L.remove()
      labels.length = 0
      for (const el of owned) el.remove()
      owned.length = 0
    }
  }
}
