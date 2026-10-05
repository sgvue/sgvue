/**
 * The view cube — `design-reference/design/viewer-core.js` L624–685, ported as written.
 *
 * A 148 px canvas in the top-right of the viewport holding a 1 × 1 × 1 cube split into the
 * **26 zones** of a 3 × 3 × 3 lattice minus its centre: six faces, twelve edges, eight
 * corners. A face zone is 0.6 across and an edge or corner zone 0.2, so the six face labels
 * (E, W, N, S, TOP, BOTTOM) sit on the 0.6 squares and the seams between them are drawn as
 * faint lines. Hovering a zone tints it half way from the card colour to the accent and, if
 * it is a face, swaps that face's label to an accent one; clicking looks from that direction
 * and refits. Below the cube is the compass ring with the true-north kite and its `N`,
 * rotated by the project's north angle.
 *
 * **Its own renderer**, as the reference has it, rather than a scissor viewport on the main
 * canvas. The design's markup already carries `[data-role="cube"]` as a separate 148 px
 * canvas with its own tooltip; giving it its own transparent-clear renderer keeps the cube's
 * pointer handling, hit testing and clear colour entirely separate from the viewport's — a
 * scissor viewport would have to re-route the viewport's own pointer handlers around a
 * rectangle and clear a region of a scene that has a background. The cost is one extra
 * renderer drawing 34 tiny objects a frame.
 */
import type { Quaternion } from 'three/webgpu'
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGPURenderer
} from 'three/webgpu'
import { Z_AXIS } from './camera'
import type { Theme, ThemeName } from './materials'
import { THEMES } from './materials'

/** `viewer-core.js` L623, L628–635, L685. */
export const CUBE_PX = 148
/** Edge-zone width; a face zone is what is left. */
export const EW = 0.2
export const FW = 1 - 2 * EW
/** L684. The cube camera's stand-off along the main camera's direction. */
export const CUBE_DIST = 4.7

export interface CubeZone {
  /** The direction to look **from**, as a lattice sign triple. */
  dir: Vector3
  mesh: Mesh
}

/**
 * L629–634. The 3 × 3 × 3 lattice minus its centre, in the reference's own iteration order.
 * Pure, so `tests/unit/cube.test.ts` can check the count, the sizes and the offsets.
 */
export function cubeZones(): { sign: [number, number, number]; size: [number, number, number]; position: [number, number, number] }[] {
  const out: {
    sign: [number, number, number]
    size: [number, number, number]
    position: [number, number, number]
  }[] = []
  const off = (1 - EW) / 2
  for (let sx = -1; sx <= 1; sx++) {
    for (let sy = -1; sy <= 1; sy++) {
      for (let sz = -1; sz <= 1; sz++) {
        if (!sx && !sy && !sz) continue
        out.push({
          sign: [sx, sy, sz],
          size: [sx ? EW : FW, sy ? EW : FW, sz ? EW : FW],
          position: [sx * off, sy * off, sz * off]
        })
      }
    }
  }
  return out
}

/** L652. The six labelled faces, with the direction each looks from. */
export const FACE_DEFS: readonly [string, [number, number, number]][] = [
  ['E', [1, 0, 0]],
  ['W', [-1, 0, 0]],
  ['N', [0, 1, 0]],
  ['S', [0, -1, 0]],
  ['TOP', [0, 0, 1]],
  ['BOTTOM', [0, 0, -1]]
]

export interface ViewCube {
  /** Draw one frame: the main camera's direction and orientation (L684). */
  render(dir: Vector3, quaternion: Quaternion): void
  setTheme(name: ThemeName): void
  /** `setCoords({ angle })`: true north, clockwise from project north, in degrees (L672). */
  setCompass(angleDeg: number): void
  dispose(): void
}

export interface ViewCubeOptions {
  canvas: HTMLCanvasElement
  /** Match the main renderer's backend, so both live on the same graphics path. */
  forceWebGL: boolean
  theme: ThemeName
  /** L679: the zone that was clicked. The viewer turns it into `viewDir` + `fitBox` + `on.cubeView`. */
  onView: (dir: Vector3) => void
}

const _ndc = new Vector2()

export async function createViewCube(options: ViewCubeOptions): Promise<ViewCube> {
  const { canvas, onView } = options
  let T: Theme = THEMES[options.theme]
  let angle = 0

  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    alpha: true,
    forceWebGL: options.forceWebGL
  })
  await renderer.init()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(CUBE_PX, CUBE_PX, false)
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  const camera = new PerspectiveCamera(30, 1, 0.1, 20)
  camera.up.copy(Z_AXIS)
  const group = new Group()
  scene.add(group)

  /* ── the 26 zones (L628–635) ────────────────────────────────────────────── */
  const zones: CubeZone[] = []
  for (const z of cubeZones()) {
    const mesh = new Mesh(
      new BoxGeometry(z.size[0], z.size[1], z.size[2]),
      new MeshBasicMaterial({ color: new Color(T.card) })
    )
    mesh.position.set(z.position[0], z.position[1], z.position[2])
    group.add(mesh)
    zones.push({ dir: new Vector3(z.sign[0], z.sign[1], z.sign[2]), mesh })
  }
  const zoneMeshes = zones.map((z) => z.mesh)

  /* ── outline and seams (L636–646) ───────────────────────────────────────── */
  const edgeMat = new LineBasicMaterial({ color: new Color(T.border) })
  const outlineGeom = new EdgesGeometry(new BoxGeometry(1, 1, 1))
  group.add(new LineSegments(outlineGeom, edgeMat))

  const seamMat = new LineBasicMaterial({ color: new Color(T.border), transparent: true, opacity: 0.4 })
  const seams: Vector3[] = []
  const hh = 0.5
  const kk = 0.5 - EW
  for (const a of [-kk, kk]) {
    for (const s of [-hh, hh]) {
      seams.push(new Vector3(a, -hh, s), new Vector3(a, hh, s), new Vector3(-hh, a, s), new Vector3(hh, a, s))
      seams.push(new Vector3(a, s, -hh), new Vector3(a, s, hh), new Vector3(-hh, s, a), new Vector3(hh, s, a))
      seams.push(new Vector3(s, a, -hh), new Vector3(s, a, hh), new Vector3(s, -hh, a), new Vector3(s, hh, a))
    }
  }
  const seamGeom = new BufferGeometry().setFromPoints(seams)
  group.add(new LineSegments(seamGeom, seamMat))

  /* ── face labels (L647–665) ─────────────────────────────────────────────── */
  const faceTex = (txt: string, hover: boolean): CanvasTexture => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const x = c.getContext('2d')!
    x.fillStyle = hover ? T.accentCss : T.muted
    x.font = `600 ${txt.length > 1 ? 26 : 50}px "IBM Plex Sans", sans-serif`
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.fillText(txt, 64, 66)
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    return t
  }

  interface FaceLabel {
    mesh: Mesh
    tex: [CanvasTexture, CanvasTexture]
    dir: Vector3
  }
  let faceLabels: FaceLabel[] = []
  const buildFaceLabels = (): void => {
    for (const f of faceLabels) {
      group.remove(f.mesh)
      for (const t of f.tex) t.dispose()
      f.mesh.geometry.dispose()
      ;(f.mesh.material as MeshBasicMaterial).dispose()
    }
    faceLabels = FACE_DEFS.map(([txt, n]) => {
      const tex: [CanvasTexture, CanvasTexture] = [faceTex(txt, false), faceTex(txt, true)]
      const mesh = new Mesh(
        new PlaneGeometry(FW, FW),
        new MeshBasicMaterial({ map: tex[0], transparent: true, depthWrite: false })
      )
      if (n[2] === 0) mesh.up.set(0, 0, 1)
      mesh.position.set(n[0] * 0.506, n[1] * 0.506, n[2] * 0.506)
      mesh.lookAt(n[0] * 2, n[1] * 2, n[2] * 2)
      group.add(mesh)
      return { mesh, tex, dir: new Vector3(n[0], n[1], n[2]) }
    })
  }
  buildFaceLabels()

  /* ── compass ring, north kite and N (L666–672) ──────────────────────────── */
  const ringMat = new MeshBasicMaterial({
    color: new Color(T.border),
    side: DoubleSide,
    transparent: true,
    opacity: 0.9
  })
  const ring = new Mesh(new RingGeometry(0.9, 0.935, 64), ringMat)
  ring.position.z = -0.62
  scene.add(ring)

  const tnTex = (): CanvasTexture => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const x = c.getContext('2d')!
    x.fillStyle = T.accentCss
    x.font = '600 34px "IBM Plex Sans", sans-serif'
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.fillText('N', 32, 34)
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    return t
  }
  const tnSprite = new Sprite(new SpriteMaterial({ map: tnTex(), depthTest: false }))
  tnSprite.scale.set(0.26, 0.26, 1)
  scene.add(tnSprite)

  const arrowShape = new Shape()
  arrowShape.moveTo(0, 0.2)
  arrowShape.lineTo(0.085, -0.06)
  arrowShape.lineTo(0, -0.02)
  arrowShape.lineTo(-0.085, -0.06)
  arrowShape.closePath()
  const tnTickMat = new MeshBasicMaterial({ color: T.accent, side: DoubleSide })
  const tnTick = new Mesh(new ShapeGeometry(arrowShape), tnTickMat)
  scene.add(tnTick)

  const updateCompass = (): void => {
    const a = (angle * Math.PI) / 180
    const nx = Math.sin(a)
    const ny = Math.cos(a)
    tnTick.position.set(nx * 0.9, ny * 0.9, -0.61)
    tnTick.rotation.z = -a
    tnSprite.position.set(nx * 1.22, ny * 1.22, -0.62)
  }
  updateCompass()

  /* ── hover and click (L673–679) ─────────────────────────────────────────── */
  const ray = new Raycaster()
  let hovered: CubeZone | null = null
  const hoverCol = (): Color => new Color(T.card).lerp(new Color(T.accent), 0.5)

  const setCubeHover = (z: CubeZone | null): void => {
    if (z === hovered) return
    if (hovered) (hovered.mesh.material as MeshBasicMaterial).color.set(T.card)
    hovered = z
    if (z) (z.mesh.material as MeshBasicMaterial).color.copy(hoverCol())
    for (const f of faceLabels) {
      const on = !!z && z.dir.equals(f.dir)
      const material = f.mesh.material as MeshBasicMaterial
      const want = f.tex[on ? 1 : 0]
      if (material.map !== want) {
        material.map = want
        material.needsUpdate = true
      }
    }
  }

  const pickZone = (e: PointerEvent | MouseEvent): CubeZone | null => {
    const r = canvas.getBoundingClientRect()
    _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(_ndc, camera)
    const hit = ray.intersectObjects(zoneMeshes, false)[0]
    return hit ? (zones.find((z) => z.mesh === hit.object) ?? null) : null
  }

  const onMove = (e: PointerEvent): void => {
    const z = pickZone(e)
    setCubeHover(z)
    canvas.style.cursor = z ? 'pointer' : ''
  }
  const onLeave = (): void => setCubeHover(null)
  const onClick = (e: MouseEvent): void => {
    const z = pickZone(e)
    if (!z) return
    onView(z.dir)
  }
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('click', onClick)

  /*
   * Clicks pass through where nothing is drawn (2026-09-24). The canvas is a 148 px square
   * above the toolbar, and its empty corners used to swallow clicks meant for the toolbar's
   * last button — at the default window the theme button's centre was under one once the
   * canvas-grid button widened the toolbar. So every pointer move over the canvas's square is
   * hit-tested against what the cube draws — its 26 zones, the compass ring, the true-north
   * kite and its `N` — and the canvas takes pointer events only over those. The browser picks
   * each event's target before this capture listener runs, so the switch holds from the next
   * event on: a mouse always moves before it clicks. Until the first move, and for touch, the
   * whole square takes events as before. The cube's own hover and click are untouched, and
   * nothing drawn changes.
   */
  const drawn = [...zoneMeshes, ring, tnTick, tnSprite]
  const drawnAt = (e: PointerEvent, r: DOMRect): boolean => {
    _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(_ndc, camera)
    return ray.intersectObjects(drawn, false).length > 0
  }
  const onAnyMove = (e: PointerEvent): void => {
    // A tap has no move before it, so a touch never switches the canvas off: a tap on the
    // cube must always reach it.
    if (e.pointerType === 'touch') {
      canvas.style.pointerEvents = ''
      return
    }
    const r = canvas.getBoundingClientRect()
    const inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom
    const want = inside && !drawnAt(e, r) ? 'none' : ''
    if (canvas.style.pointerEvents !== want) canvas.style.pointerEvents = want
  }
  window.addEventListener('pointermove', onAnyMove, true)

  const dir = new Vector3()

  return {
    render: (worldDir, quaternion) => {
      dir.copy(worldDir).multiplyScalar(CUBE_DIST)
      camera.position.copy(dir)
      camera.quaternion.copy(quaternion)
      renderer.render(scene, camera)
    },

    // L694–695.
    setTheme: (name) => {
      T = THEMES[name]
      edgeMat.color.set(T.border)
      seamMat.color.set(T.border)
      ringMat.color.set(T.border)
      tnTickMat.color.set(T.accent)
      tnSprite.material.map?.dispose()
      tnSprite.material.map = tnTex()
      tnSprite.material.needsUpdate = true
      for (const z of zones) (z.mesh.material as MeshBasicMaterial).color.set(T.card)
      hovered = null
      buildFaceLabels()
    },

    setCompass: (angleDeg) => {
      angle = angleDeg || 0
      updateCompass()
    },

    dispose: () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('click', onClick)
      window.removeEventListener('pointermove', onAnyMove, true)
      for (const z of zones) {
        z.mesh.geometry.dispose()
        ;(z.mesh.material as MeshBasicMaterial).dispose()
      }
      for (const f of faceLabels) {
        for (const t of f.tex) t.dispose()
        f.mesh.geometry.dispose()
        ;(f.mesh.material as MeshBasicMaterial).dispose()
      }
      faceLabels = []
      outlineGeom.dispose()
      seamGeom.dispose()
      edgeMat.dispose()
      seamMat.dispose()
      ring.geometry.dispose()
      ringMat.dispose()
      tnTick.geometry.dispose()
      tnTickMat.dispose()
      tnSprite.material.map?.dispose()
      tnSprite.material.dispose()
      renderer.dispose()
    }
  }
}
