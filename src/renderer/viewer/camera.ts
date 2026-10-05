/**
 * The camera controller, ported from `design-reference/design/viewer-core.js` L258–327.
 *
 * The numbers are the design's and are kept exactly: spherical `goal` / `cur` with the
 * easing `k = 1 − exp(−dt · rate)`, rate 14 normally and 5 during a 620 ms flight, the 1.08
 * fit margin, the φ clamps at 0.03 rad, the seven-view table, and the dist ↔ half conversion
 * that keeps the framing when the projection changes.
 *
 * One thing had to become a function rather than a constant. The reference's zoom limits,
 * clip planes and ortho stand-off distance were authored for its own mock federation, whose
 * bounding sphere is 27.5 m; a literal 40 m clip constant once sliced the roof off a 56 m
 * warehouse (`CLAUDE.md`, rendering traps). Every one of them is therefore expressed as the
 * reference's value times `scale = radius / REFERENCE_RADIUS`, so the mock renders with the
 * reference's exact numbers and a 425 m model gets proportional ones.
 *
 * No three.js renderer, canvas or DOM is touched here, so the maths is unit-testable under
 * Node (`tests/unit/camera.test.ts`).
 *
 * 2026-10-02 — two things the design's rig did not need and the assistant's camera does
 * (the owner: *"assistant should possess everything user can do on the app"*): `setAngles`, a
 * direction by its two angles — any of the cube's 26 and anything between, which `viewDir`
 * cannot give at a pole — and a `zoom` factor on `fitBox`, held to the wheel's own limits.
 * The table of named views moved to `shared/view-angles.ts`, where a direction is also put
 * into words (azimuth and elevation); it is re-exported here unchanged.
 */
import { Box3, MathUtils, Matrix4, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three/webgpu'
import { POLE_PHI, VIEWS } from '../../shared/view-angles'

/** `+z` is up: the contract's frame, and `viewer-core.js` L8. */
export const Z_AXIS = new Vector3(0, 0, 1)

/** The bounding-sphere radius the design's scene constants were authored against. */
export const REFERENCE_RADIUS = 27.5

/** Field of view, `viewer-core.js` L43. */
export const FOV = 50

/** Easing rates: direct manipulation, and a deliberate flight (L730). */
export const EASE_RATE = 14
export const FLY_RATE = 5
/** A flight lasts this long (L307). */
export const FLY_MS = 620
/** `fitBox` margin (L303–304). */
export const FIT_MARGIN = 1.08

/** `viewer-core.js` L309. θ, φ per named view — the table itself is `shared/view-angles.ts`. */
export { VIEWS }
export type ViewName = keyof typeof VIEWS
export type Projection = 'persp' | 'ortho'

export interface CameraState {
  theta: number
  phi: number
  dist: number
  half: number
  target: number[]
  proj: Projection
}

/** The frame-rate-independent step of `viewer-core.js` L730: `1 − exp(−dt · rate)`. */
export const easeK = (dt: number, rate: number): number => 1 - Math.exp(-dt * rate)

/**
 * How close to its goal the ease has to get before `cur` is snapped onto it and the camera is
 * declared at rest.
 *
 * `1 − exp(−dt·rate)` never *arrives*, so without this the camera is always moving by a
 * fraction of nothing and a viewer that only draws when something changed would draw for ever.
 * A microradian is about a **thousandth of a pixel** across a 1 000 px viewport at this 50°
 * field of view, and a micrometre is a millionth of the metre this scene is measured in — both
 * several orders below anything a pixel can show. The ease reaches them roughly a second after
 * the last input, so the frame that snaps is one the design would have settled on anyway.
 * Lengths are multiplied by the rig's own `scale` (`radius / REFERENCE_RADIUS`), as every
 * scene constant here is.
 */
export const REST_ANGLE = 1e-6
export const REST_LENGTH = 1e-6

/** L289. Bring `a` within half a turn of `ref` so the ease takes the short way round. */
export function wrapNear(a: number, ref: number): number {
  while (a - ref > Math.PI) a -= 2 * Math.PI
  while (ref - a > Math.PI) a += 2 * Math.PI
  return a
}

/** L261. The unit vector from target to camera for a spherical (θ, φ), Z-up. */
export const dirOf = (theta: number, phi: number, out: Vector3): Vector3 =>
  out.set(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi))

interface Spherical {
  theta: number
  phi: number
  dist: number
  half: number
  target: Vector3
}

export interface CameraRigOptions {
  /** `radius / REFERENCE_RADIUS`; every scene-scale constant is multiplied by it. */
  scale: number
  /**
   * What `setView` frames and where the camera starts. Since 2026-09-24 the viewer passes the
   * **building** box (`shared/site.ts`), live, so a view preset frames the building, not the site.
   */
  bbox: Box3
  /**
   * `scale` for that box (2026-09-24): how close the camera may come and the smallest box
   * `fitBox` frames. Defaults to `scale`, and is never taken below `scale / 4`: the near clip
   * plane is `0.1 × scale` and the nearest a dolly may come is `0.4 ×` this, so the clamp keeps
   * the camera from ever reaching inside its own near plane however small the building is
   * against its site. The clip planes, the far zoom limit and the ortho stand-off stay on
   * `scale`, which is the whole model's, so nothing drawn is ever clipped.
   */
  nearScale?: () => number
  /** True under `prefers-reduced-motion`: flights are instant, as in the reference (L307). */
  reduceMotion?: boolean
  /** Called after the projection swaps, as `on.projection` in the reference. */
  onProjection?: (p: Projection) => void
}

export interface CameraRig {
  readonly camera: PerspectiveCamera | OrthographicCamera
  readonly persp: PerspectiveCamera
  readonly ortho: OrthographicCamera
  readonly projection: Projection
  readonly goal: Spherical
  readonly cur: Spherical
  setAspect(aspect: number): void
  /**
   * Advance `cur` towards `goal` by one frame and place the camera. Returns whether the camera
   * this produced differs from the one the previous tick produced — which is the whole of
   * "the camera is not at rest": an ease still running, a flight, a drag, a wheel, a
   * projection swap. `viewer-core.ts` renders a frame when it is true.
   */
  tick(dt: number, now: number): boolean
  place(): void
  orbit(dx: number, dy: number, pivot: Vector3 | null): void
  pan(dx: number, dy: number, height: number): void
  dolly(k: number, hit: Vector3 | null): void
  /**
   * Frame a box from where the camera looks. `zoom` (2026-10-02) is a factor on that fit — 2 is
   * twice as close, 0.5 half — held to the limits the wheel is held to; omitted, it is the fit.
   */
  fitBox(b: Box3, zoom?: number): void
  fly(ms?: number): void
  setView(name: string): void
  viewDir(d: Vector3): void
  /**
   * Any direction, by the rig's own two angles (2026-10-02). `viewDir` takes a vector and so
   * has to choose θ itself at a pole; this keeps the one it is given, which is what makes
   * "straight down with east up the screen" sayable. φ is kept `POLE_PHI` clear of both poles.
   */
  setAngles(theta: number, phi: number): void
  setProjection(p: Projection, quiet?: boolean): void
  getCamera(): CameraState
  setCamera(c: CameraState): void
  /** The reference's `Object.assign(cur, { dist: goal.dist * 1.6 })` ease-in (L744). */
  easeIn(): void
}

export function createCameraRig(options: CameraRigOptions): CameraRig {
  const { scale, bbox, reduceMotion = false, onProjection } = options
  const s = scale
  const ns = (): number => Math.max(options.nearScale?.() ?? scale, scale / 4)

  const persp = new PerspectiveCamera(FOV, 1, 0.1 * s, 3000 * s)
  persp.up.copy(Z_AXIS)
  const ortho = new OrthographicCamera(-1, 1, 1, -1, -1000 * s, 3000 * s)
  ortho.up.copy(Z_AXIS)
  let camera: PerspectiveCamera | OrthographicCamera = persp
  let projection: Projection = 'persp'

  const centre = bbox.getCenter(new Vector3())
  const goal: Spherical = { theta: -Math.PI / 4, phi: 1.05, dist: 60 * s, half: 12 * s, target: centre.clone() }
  const cur: Spherical = { theta: goal.theta, phi: goal.phi, dist: goal.dist, half: goal.half, target: centre.clone() }

  const tmpA = new Vector3()
  const tmpB = new Vector3()
  const tmpC = new Vector3()
  const tmpM = new Matrix4()
  const halfFovTan = Math.tan(MathUtils.degToRad(FOV / 2))
  // `fitBox` uses **sin**, not tan: the reference fits the model's bounding *sphere* to the
  // cone of vision, so the distance is r / sin(fov/2) (L303). Using tan pulls the camera in
  // by ~10 % — 63.7 m instead of 70.3 m on the design's own mock, which is visible.
  const halfFovSin = Math.sin(MathUtils.degToRad(FOV / 2))

  function place(): void {
    dirOf(cur.theta, cur.phi, tmpA)
    camera.position.copy(cur.target).addScaledVector(tmpA, projection === 'persp' ? cur.dist : 400 * s)
    const f = tmpA.negate()
    let r = tmpB.crossVectors(f, Z_AXIS)
    if (r.lengthSq() < 1e-6) r = tmpB.crossVectors(f, new Vector3(0, 1, 0))
    r.normalize()
    const u = tmpC.crossVectors(r, f).normalize()
    tmpM.makeBasis(r, u, f.clone().negate())
    camera.quaternion.setFromRotationMatrix(tmpM)
    if (projection === 'ortho') {
      const a = persp.aspect || 1
      ortho.left = -cur.half * a
      ortho.right = cur.half * a
      ortho.top = cur.half
      ortho.bottom = -cur.half
      ortho.updateProjectionMatrix()
    }
  }

  const setFromPosTarget = (g: Spherical, pos: Vector3, target: Vector3): void => {
    g.target.copy(target)
    tmpA.subVectors(pos, target)
    g.dist = Math.max(0.5 * ns(), tmpA.length())
    tmpA.normalize()
    g.phi = Math.acos(Math.min(1, Math.max(-1, tmpA.z)))
    g.theta = Math.atan2(tmpA.y, tmpA.x)
  }
  const goalPos = (): Vector3 => dirOf(goal.theta, goal.phi, new Vector3()).multiplyScalar(goal.dist).add(goal.target)
  const syncCur = (): void => {
    cur.theta = goal.theta
    cur.phi = goal.phi
    cur.dist = goal.dist
    cur.half = goal.half
    cur.target.copy(goal.target)
  }

  let flyUntil = 0
  const fly = (ms?: number): void => {
    if (!reduceMotion) flyUntil = performance.now() + (ms ?? FLY_MS)
  }

  function fitBox(b: Box3, zoom = 1): void {
    const c = b.getCenter(new Vector3())
    const n = ns()
    const r = Math.max(0.5 * n, b.getSize(new Vector3()).length() / 2)
    goal.target.copy(c)
    goal.dist = Math.max(1 * n, (r / halfFovSin) * FIT_MARGIN)
    goal.half = Math.max(0.3 * n, (r * FIT_MARGIN) / Math.min(1, persp.aspect || 1))
    // A zoom on the fit stops where a dolly stops (`dolly` below): never inside the near plane,
    // never past the far zoom limit. Both are scaled, so a projection swap keeps the framing.
    if (zoom !== 1 && zoom > 0) {
      goal.dist = Math.min(900 * s, Math.max(0.4 * n, goal.dist / zoom))
      goal.half = Math.min(400 * s, Math.max(0.15 * n, goal.half / zoom))
    }
  }

  function setProjection(p: Projection, quiet?: boolean): void {
    if (p === projection) return
    const hh = goal.dist * halfFovTan
    if (p === 'ortho') {
      goal.half = hh
      cur.half = cur.dist * halfFovTan
      camera = ortho
    } else {
      goal.dist = goal.half / halfFovTan
      cur.dist = goal.dist
      camera = persp
    }
    projection = p
    place()
    // The reference calls `on.projection` whether or not the swap was quiet (L326) — `quiet`
    // only says the caller already knows. Kept, so a listener never misses a change.
    void quiet
    onProjection?.(p)
  }

  function viewDir(d: Vector3): void {
    const dd = d.clone().normalize()
    goal.phi = Math.acos(Math.min(1, Math.max(-1, dd.z)))
    if (Math.abs(dd.x) < 1e-6 && Math.abs(dd.y) < 1e-6) goal.theta = -Math.PI / 2
    else goal.theta = Math.atan2(dd.y, dd.x)
    goal.phi = Math.min(Math.PI - 0.0001, Math.max(0.0001, goal.phi))
    cur.theta = wrapNear(cur.theta, goal.theta)
  }

  function setAngles(theta: number, phi: number): void {
    goal.theta = theta
    goal.phi = Math.min(Math.PI - POLE_PHI, Math.max(POLE_PHI, phi))
    cur.theta = wrapNear(cur.theta, goal.theta)
  }

  function setView(name: string): void {
    const v = VIEWS[name]
    if (!v) return
    goal.theta = v[0]
    goal.phi = v[1]
    cur.theta = wrapNear(cur.theta, goal.theta)
    fly()
    fitBox(bbox)
    if (name !== 'iso' && projection !== 'ortho') setProjection('ortho', true)
    if (name === 'iso' && projection !== 'persp') setProjection('persp', true)
  }

  function orbit(dx: number, dy: number, pivot: Vector3 | null): void {
    const pos = goalPos()
    const t = goal.target.clone()
    // The reference writes `pivot || t` and then mutates `t` in place against it
    // (`viewer-core.js` L276–278); with no pivot the two alias and the target collapses to
    // the world origin. Its own callers almost always pass a pick or a ground-plane point,
    // so the path is rarely reached — but "orbit and the model jumps to (0,0,0)" is a defect,
    // not a look, so the fallback is a copy. Same in `dolly` below (L296).
    const pv = pivot ?? t.clone()
    const qz = new Quaternion().setFromAxisAngle(Z_AXIS, -dx * 0.006)
    pos.sub(pv).applyQuaternion(qz).add(pv)
    t.sub(pv).applyQuaternion(qz).add(pv)
    const f = t.clone().sub(pos).normalize()
    const right = new Vector3().crossVectors(f, Z_AXIS)
    if (right.lengthSq() > 1e-6) {
      right.normalize()
      const phiNow = Math.acos(Math.min(1, Math.max(-1, -f.z)))
      const ang = -dy * 0.006
      const phiNew = phiNow + ang
      if (phiNew > 0.03 && phiNew < Math.PI - 0.03) {
        const q = new Quaternion().setFromAxisAngle(right, ang)
        pos.sub(pv).applyQuaternion(q).add(pv)
        t.sub(pv).applyQuaternion(q).add(pv)
      }
    }
    setFromPosTarget(goal, pos, t)
    goal.phi = Math.min(Math.PI - 0.03, Math.max(0.03, goal.phi))
    syncCur()
  }

  function pan(dx: number, dy: number, height: number): void {
    const wpp =
      projection === 'persp' ? (2 * goal.dist * halfFovTan) / height : (2 * goal.half) / height
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    goal.target.addScaledVector(right, -dx * wpp).addScaledVector(up, dy * wpp)
    syncCur()
  }

  function dolly(k: number, hit: Vector3 | null): void {
    const pos = goalPos()
    const t = goal.target.clone()
    const p = hit ?? t.clone()
    if (projection === 'persp') {
      const nd = goal.dist * k
      if (nd < 0.4 * ns() || nd > 900 * s) return
      pos.sub(p).multiplyScalar(k).add(p)
      t.sub(p).multiplyScalar(k).add(p)
      setFromPosTarget(goal, pos, t)
    } else {
      const nh = goal.half * k
      if (nh < 0.15 * ns() || nh > 400 * s) return
      goal.half = nh
      t.sub(p).multiplyScalar(k).add(p)
      goal.target.copy(t)
    }
    syncCur()
  }

  const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

  /** Is the ease close enough to its goal to call it arrived? See `REST_ANGLE`. */
  const arrived = (): boolean =>
    Math.abs(cur.theta - goal.theta) < REST_ANGLE &&
    Math.abs(cur.phi - goal.phi) < REST_ANGLE &&
    Math.abs(cur.dist - goal.dist) < REST_LENGTH * s &&
    Math.abs(cur.half - goal.half) < REST_LENGTH * s &&
    cur.target.distanceToSquared(goal.target) < (REST_LENGTH * s) ** 2

  /** What the last `tick` placed, so the next one can say whether anything moved. */
  const placed = { theta: NaN, phi: NaN, dist: NaN, half: NaN, x: NaN, y: NaN, z: NaN, proj: '' }

  return {
    get camera() {
      return camera
    },
    persp,
    ortho,
    get projection() {
      return projection
    },
    goal,
    cur,
    setAspect: (aspect) => {
      // Only the perspective camera has one; `place()` and `fitBox` read it for both, which
      // is what the reference's `camera.aspect` amounts to after its own `setProjection`.
      persp.aspect = aspect
      persp.updateProjectionMatrix()
    },
    tick: (dt, now) => {
      const k = easeK(dt, now < flyUntil ? FLY_RATE : EASE_RATE)
      cur.theta = lerp(cur.theta, goal.theta, k)
      cur.phi = lerp(cur.phi, goal.phi, k)
      cur.dist = lerp(cur.dist, goal.dist, k)
      cur.half = lerp(cur.half, goal.half, k)
      cur.target.lerp(goal.target, k)
      if (arrived()) syncCur()
      place()
      const moved =
        placed.theta !== cur.theta ||
        placed.phi !== cur.phi ||
        placed.dist !== cur.dist ||
        placed.half !== cur.half ||
        placed.x !== cur.target.x ||
        placed.y !== cur.target.y ||
        placed.z !== cur.target.z ||
        placed.proj !== projection
      placed.theta = cur.theta
      placed.phi = cur.phi
      placed.dist = cur.dist
      placed.half = cur.half
      placed.x = cur.target.x
      placed.y = cur.target.y
      placed.z = cur.target.z
      placed.proj = projection
      return moved
    },
    place,
    orbit,
    pan,
    dolly,
    fitBox,
    fly,
    setView,
    viewDir,
    setAngles,
    setProjection,
    getCamera: () => ({
      theta: goal.theta,
      phi: goal.phi,
      dist: goal.dist,
      half: goal.half,
      target: goal.target.toArray(),
      proj: projection
    }),
    setCamera: (c) => {
      if (c.proj && c.proj !== projection) setProjection(c.proj)
      goal.theta = c.theta
      goal.phi = c.phi
      goal.dist = c.dist
      goal.half = c.half
      goal.target.fromArray(c.target)
      cur.theta = wrapNear(cur.theta, goal.theta)
      fly()
    },
    easeIn: () => {
      cur.dist = goal.dist * 1.6
      cur.half = goal.half
      cur.target.copy(goal.target)
    }
  }
}
