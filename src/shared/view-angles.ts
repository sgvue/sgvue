/**
 * Where the camera looks, in the two languages it is spoken in — 2026-10-02 (parity with the
 * user, phase 2: the owner, *"assistant should possess everything user can do on the app"*).
 *
 * The camera rig (`renderer/viewer/camera.ts`, ported from `viewer-core.js` L258–327) keeps a
 * direction as two spherical angles about the point it looks at, Z-up: the unit vector **from
 * the target to the camera** is `(sin φ cos θ, sin φ sin θ, cos φ)`. That is the right form for
 * easing and for the session's saved camera, and the wrong one to say out loud: θ = −π/2 is a
 * camera standing *south* of the building.
 *
 * The assistant, and what it reads back, speak of the camera the way a person does:
 *
 *   · **azimuth** — the compass bearing the camera **looks towards**, in degrees clockwise from
 *     project north: 0 looks north, 90 east, 180 south, 270 west.
 *   · **elevation** — how far it looks **down** from horizontal: 0 level, 90 straight down,
 *     −90 straight up.
 *
 * Both are in the **project frame** — the scene's own axes, +Y north and +X east, which is the
 * frame the six named views and the view cube's faces are in (`viewer/cube.ts`, `FACE_DEFS`).
 * It is *project* north, not true north: the compass ring under the cube is turned by the base
 * point's angle, and nothing here is.
 *
 * So the named views read: `south` 0 / 0 (it stands south and looks north), `west` 90 / 0,
 * `north` 180 / 0, `east` 270 / 0, `top` 0 / 90 with north up the screen, and `iso` 315 / 29.8.
 * `tests/unit/view-angles.test.ts` holds the table below to those numbers and the rig to both.
 *
 * Pure, and in `shared/` because the tool catalogue's description quotes it and the main
 * process loads the catalogue.
 */

/**
 * `viewer-core.js` L309 — θ, φ per named view. Moved here from `viewer/camera.ts`, which
 * re-exports it, so that what a direction is *called* can be decided without the renderer.
 */
export const VIEWS: Readonly<Record<string, readonly [number, number]>> = {
  iso: [-Math.PI / 4, 1.05],
  top: [-Math.PI / 2, 0.0001],
  bottom: [-Math.PI / 2, Math.PI - 0.0001],
  north: [Math.PI / 2, Math.PI / 2],
  south: [-Math.PI / 2, Math.PI / 2],
  east: [0, Math.PI / 2],
  west: [Math.PI, Math.PI / 2]
}

/**
 * How close to a pole φ may come — the rig's own clamp for a direction that was asked for
 * (`viewDir`, L253) and the value `top` and `bottom` stand at. Straight down is this far off
 * vertical, which is what keeps the camera's up vector defined.
 */
export const POLE_PHI = 0.0001

/** A direction as the rig holds it. */
export interface Spherical {
  theta: number
  phi: number
}

/** The same direction as it is said: degrees, in the project frame. */
export interface ViewAngles {
  azimuthDeg: number
  elevationDeg: number
}

const DEG = Math.PI / 180
const TURN = 2 * Math.PI

/** An angle brought into (−π, π], which is the range the named views are written in. */
export function wrapPi(a: number): number {
  let x = a % TURN
  if (x > Math.PI) x -= TURN
  if (x <= -Math.PI) x += TURN
  return x
}

/**
 * Azimuth and elevation → the rig's θ and φ. The camera stands opposite to where it looks, so
 * θ = −π/2 − azimuth; φ is measured from straight up, so φ = π/2 − elevation, kept `POLE_PHI`
 * clear of both poles. At a pole the azimuth is what is up the screen: 0 / 90 is the plan view
 * with north up.
 */
export function sphericalOf(azimuthDeg: number, elevationDeg: number): Spherical {
  return {
    theta: wrapPi(-Math.PI / 2 - azimuthDeg * DEG),
    phi: Math.min(Math.PI - POLE_PHI, Math.max(POLE_PHI, Math.PI / 2 - elevationDeg * DEG))
  }
}

/** The rig's θ and φ → azimuth in [0, 360) and elevation in [−90, 90]. Not rounded. */
export function anglesOf(theta: number, phi: number): ViewAngles {
  const az = ((-Math.PI / 2 - theta) / DEG) % 360
  return { azimuthDeg: az < 0 ? az + 360 : az, elevationDeg: 90 - phi / DEG }
}

/**
 * The same, as it is reported: one decimal, which is finer than a person can orbit to and short
 * enough to ride in a tool result. An azimuth that rounds up to a whole turn is 0.
 */
export function roundedAngles(theta: number, phi: number): ViewAngles {
  const a = anglesOf(theta, phi)
  const r = (v: number): number => Math.round(v * 10) / 10 + 0
  const az = r(a.azimuthDeg)
  return { azimuthDeg: az >= 360 ? 0 : az, elevationDeg: r(a.elevationDeg) }
}

/** How far a direction may be from a named view's and still be on it: about 0.06°. */
export const ON_VIEW_TOLERANCE = 1e-3

/**
 * The named view a direction stands on, or `null`. Both angles have to agree: straight down
 * with east up the screen is not `top`. An orbit by hand cannot reach a pole (the rig stops it
 * 0.03 rad short), so `top` is only ever read back for a camera that was put there.
 */
export function viewOn(theta: number, phi: number): string | null {
  for (const [name, [t, p]] of Object.entries(VIEWS)) {
    if (Math.abs(wrapPi(theta - t)) < ON_VIEW_TOLERANCE && Math.abs(phi - p) < ON_VIEW_TOLERANCE) {
      return name
    }
  }
  return null
}
