/**
 * The project frame, the project base point, and what the CRS chip says.
 *
 * `design-reference/design/viewer-core.js` L408–409 keeps a `coords` object and a `toMap`
 * that turns a model point into an E/N/Z map coordinate. Its default is a literal base point
 * (`{ E: 28500, N: 30200, Z: 102.5, angle: 12.5 }`), which the fidelity contract's "never a
 * placeholder" forbids: a value is read from the file, or typed by the user, or absent.
 *
 * So this module is the design's `toMap` plus the readings the prototype had no data for.
 *
 * **The design assumes the scene *is* the project frame** — `toMap` rotates a scene point by
 * `angle` and adds the base point, the compass tick sits at `(sin a, cos a)` (`:671`), and the
 * card's own note says "True north is measured clockwise from project north". A real Revit
 * export does not oblige: the CORENET X convention puts the position **and the rotation** on
 * `IfcSite.ObjectPlacement`, so the file's world coordinates are already map-aligned and the
 * building stands at 43° to them. Rendering those world coordinates leaves every axis-aligned
 * thing the app draws — level rings, grid-bubble clipping, laser axes, dimension lines, the
 * bounding box's Length and Width, the N/S/E/W views — rotated off the building.
 *
 * `projectFrame()` below is what puts that right: the site placement, read as the
 * **project → world** transform, so the geometry pipeline can undo it once
 * (`worker/geometry-streamer.ts`, the one place the frames meet) and everything downstream is
 * back in the frame the design assumes. The angle the design wants is then the *total*
 * rotation from project north to true north, which is what `coordsFromGeoref` composes.
 *
 * **Since 2026-10-08 the federation is assembled in map space.** One exporter writes a model's
 * map position on its site placement, another in an `IfcMapConversion` over a site at the
 * file's zero — both compliant, and kilometres apart when drawn by world coordinates. So each
 * model gets its own world → map operation from its own declaration (`mapPlacement`), the
 * federation's frame is the boot model's project frame expressed in map coordinates
 * (`federationFrame`, P = M_boot ∘ Site_boot), and each model is streamed through
 * `modelFrame` — M_i⁻¹ ∘ P, project → that model's world — which keeps `ProjectFrame`'s shape,
 * so the streamer, `worldToProjectMatrix` and `toProject` are unchanged. `coordsFromGeoref` is
 * P read as a base point, so every map readout and the geometry come from the same numbers.
 *
 * Everything here is arithmetic on plain objects, so `tests/unit/georef.test.ts` can check it
 * against hand-computed literals with no file, no worker and no GPU.
 */
import { DASH } from './fmt'
import type { Georeference, GeorefMethod } from './model-index.types'

/**
 * The design's `coords` (`SGVue.dc.html:849`), with every field nullable. `angle` is degrees
 * **clockwise from project north to true north**, which is the same number as the
 * counter-clockwise-positive rotation that takes project axes onto map axes: turn the project
 * frame by `+angle` and its `+Y` lands on map north.
 */
export interface BasePoint {
  E: number | null
  N: number | null
  Z: number | null
  angle: number | null
}

/** A base point can be mapped only when all three coordinates are there. */
export const isLocated = (c: BasePoint): boolean => c.E != null && c.N != null && c.Z != null

/** Two base points, field for field — "is the card still showing what the file said?". */
export const sameBasePoint = (a: BasePoint, b: BasePoint): boolean =>
  a.E === b.E && a.N === b.N && a.Z === b.Z && a.angle === b.angle

/**
 * `viewer-core.js` L409. A point in the **project** frame → map coordinates.
 * `null` when the file states no base point, which is what makes every readout show `DASH`
 * instead of a number nobody authored.
 */
export function toMap(
  c: BasePoint,
  x: number,
  y: number,
  z: number
): { E: number; N: number; Z: number } | null {
  if (!isLocated(c)) return null
  const a = ((c.angle ?? 0) * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return { E: c.E! + x * cos - y * sin, N: c.N! + x * sin + y * cos, Z: c.Z! + z }
}

/* ────────────────────────────── the project frame ────────────────────────────── */

/**
 * The spatial-root `IfcSite.ObjectPlacement`, read as **project → world**: turn a project
 * point by `rotationDeg` about `+Z` and add `origin`, and you have the file's own world
 * coordinates. `null` means the two frames already coincide, which is every file that leaves
 * its site at the origin — and the design's own mock federation.
 */
export interface ProjectFrame {
  /** World coordinates of the project origin, metres, Z-up. */
  origin: readonly [number, number, number]
  /** Degrees about `+Z`, counter-clockwise positive. 0 for a placement that only translates. */
  rotationDeg: number
}

/** Below this a rotation is no rotation; a hair over a float64 round trip of `atan2`. */
const ANGLE_EPSILON_DEG = 1e-9
/** Below this a translation is no translation — a nanometre. */
const LENGTH_EPSILON_M = 1e-9

const num = (v: number | undefined): number | null => (typeof v === 'number' ? v : null)

/** Degrees in `(−180, 180]`. */
export function normaliseDeg(d: number): number {
  const x = (((d + 180) % 360) + 360) % 360 - 180
  return x === -180 ? 180 : x
}

/**
 * The rotation `IfcMapConversion` states, or `null` when it states none.
 *
 * `XAxisAbscissa` / `XAxisOrdinate` are optional and are the map-frame direction of the
 * engineering `+X`, so the rotation is `atan2(ordinate, abscissa)`.
 */
export function mapRotationDeg(g: Georeference | null | undefined): number | null {
  if (!g) return null
  const abscissa = num(g.xAxisAbscissa)
  const ordinate = num(g.xAxisOrdinate)
  if (abscissa !== null && ordinate !== null) {
    return normaliseDeg((Math.atan2(ordinate, abscissa) * 180) / Math.PI)
  }
  const stated = num(g.rotationDeg)
  return stated === null ? null : normaliseDeg(stated)
}

/**
 * True when the map conversion moves nothing: E, N and H zero or absent, and the X axis
 * `(1, 0)` or absent. The reference model's own is exactly this —
 * `IFCMAPCONVERSION(#24,#30,0.,0.,0.,1.,6.12e-17,0.001)` — which is why taking it in
 * preference to the site placement left the Coordinate-system card reading 0 / 0 / 0 / 0.
 */
export function isIdentityMapConversion(g: Georeference | null | undefined): boolean {
  if (!g) return true
  const e = num(g.eastings) ?? 0
  const n = num(g.northings) ?? 0
  const h = num(g.orthogonalHeight) ?? 0
  const rot = mapRotationDeg(g) ?? 0
  return (
    Math.abs(e) < LENGTH_EPSILON_M &&
    Math.abs(n) < LENGTH_EPSILON_M &&
    Math.abs(h) < LENGTH_EPSILON_M &&
    Math.abs(rot) < ANGLE_EPSILON_DEG
  )
}

/** True when the site placement moves nothing: no translation and no rotation. */
export function isIdentitySitePlacement(g: Georeference | null | undefined): boolean {
  const p = g?.site?.placement
  const rot = num(g?.site?.rotationDeg) ?? 0
  const moved = p ? p.some((v) => Math.abs(v) >= LENGTH_EPSILON_M) : false
  return !moved && Math.abs(rot) < ANGLE_EPSILON_DEG
}

/**
 * Which declaration actually carries the model's position — the thing the Coordinate-system
 * card names beside the CRS chip, and the thing `get_model_info` reports.
 *
 * `source` / `sources` on the record say what was *found*; this says what is *in force*. A
 * file can declare an `IfcMapConversion` that converts nothing (the reference model does) and
 * still be perfectly well placed by its site.
 *
 * IFC2X3 has no `IfcMapConversion`, so its `ePset_MapConversion` is reported under its own
 * name; a 2X3 file that also places its site reports the pset, because that is the declaration
 * and the design's caption has no fifth label to spell the pair with.
 */
export function detectMethod(g: Georeference | null | undefined): GeorefMethod {
  if (!g) return 'none'
  const conversion = !isIdentityMapConversion(g)
  const site = !isIdentitySitePlacement(g)
  const epset = g.sources.includes('ePset')
  if (conversion && epset) return 'ePset_MapConversion'
  if (conversion && site) return 'IfcMapConversion + IfcSite placement'
  if (conversion) return 'IfcMapConversion'
  if (site) return 'IfcSite placement'
  return 'none'
}

/**
 * The project → world transform, or `null` when the file leaves the two frames the same.
 *
 * A site placement that is **not** a pure rotation about `+Z` keeps its translation and is
 * read as no rotation: one angle cannot express a tilt, and inventing one would be worse than
 * leaving the model where the file put it. `site.pureZRotation` records which it was.
 */
export function projectFrame(g: Georeference | null | undefined): ProjectFrame | null {
  const site = g?.site
  if (!site || isIdentitySitePlacement(g)) return null
  const p = site.placement
  const rotation = site.pureZRotation === false ? 0 : normaliseDeg(num(site.rotationDeg) ?? 0)
  return {
    origin: p ? [p[0], p[1], p[2]] : [0, 0, 0],
    rotationDeg: rotation
  }
}

/* ────────────────────────────── map space (2026-10-08) ────────────────────────────── */

/**
 * How one model was put into map coordinates — `get_model_info`'s `placedBy`:
 *
 *  · `IfcMapConversion` / `ePset_MapConversion` — its map conversion moves it (IFC4's entity,
 *    or IFC2X3's property set), composed over its site placement;
 *  · `site placement` — no conversion moves it and its site placement does, so its world
 *    coordinates are its map coordinates (Revit's "Shared Coordinates");
 *  · `none` — nothing moves it, and its world coordinates are taken as map coordinates too.
 */
export type PlacedBy = 'IfcMapConversion' | 'ePset_MapConversion' | 'site placement' | 'none'

/** One model's world → map operation, and how it was read off the file. */
export interface MapPlacement {
  /**
   * World → map in metres, `map = T(E·u, N·u, H·u) · Rz(θ) · world` with
   * θ = atan2(XAxisOrdinate, XAxisAbscissa), anticlockwise about `+Z` (only the axis's
   * direction counts, so it need not be a unit vector) — a `ProjectFrame`'s shape: turn by
   * `rotationDeg`, then add `origin`. `null` is the identity: no conversion, or one that moves
   * nothing (`isIdentityMapConversion`, which takes Revit's `(1, 6.12e-17)` X axis for what it
   * is).
   */
  operation: ProjectFrame | null
  placedBy: PlacedBy
  /** u — metres per map unit, which E, N and H were multiplied by. 1 when the file names none. */
  metresPerMapUnit: number
  /** The map unit as the file names it, or `null` when it names none (u is then the metre). */
  mapUnit: string | null
  /** False when the file names a map unit this cannot read as a length — read as metres. */
  mapUnitKnown: boolean
  /** `Scale` as written, or `null`. Reported, **never applied**: see `mapPlacement`. */
  scale: number | null
}

/**
 * **The one function that says where a model is in map space** (2026-10-08) — the geometry
 * (`modelFrame`), the grids and storeys (`federation-store.ts`'s `metaOf`, through the same
 * frame), the base point (`coordsFromGeoref`) and `get_model_info` all read it.
 *
 * Four rules, each the owner's:
 *
 *  1. Each model's operation comes from its **own** declaration: the `IfcMapConversion` on its
 *     3D `Model` context (`worker/index-builder.ts` picks it), or IFC2X3's
 *     `ePset_MapConversion`. Identity when it has none, or one that moves nothing.
 *  2. **`Scale` is never applied.** web-ifc has already put the geometry in metres, and in 2026
 *     exporters write `Scale` as absent, 0.001 and 1000 for the same millimetre model in a
 *     metre CRS — it cannot be read as an instruction.
 *  3. **u comes from the map unit**: `IfcProjectedCRS.MapUnit` (IFC2X3: `ePset_ProjectedCRS`),
 *     an SI unit by its prefix, a conversion-based one through its factor. When the file names
 *     none, the metre — which is what Revit writes, and the IFC4.3 Annex E examples.
 *  5. **TrueNorth is never stacked on a conversion**; in this part it places nothing at all.
 *
 * (Rule 4, the context's `WorldCoordinateSystem`, is a later part.)
 */
export function mapPlacement(g: Georeference | null | undefined): MapPlacement {
  const unit = g?.mapUnit
  const u = unit?.metres ?? 1
  const read = {
    metresPerMapUnit: u,
    mapUnit: unit?.name ?? null,
    mapUnitKnown: !unit || unit.metres != null,
    scale: num(g?.scale)
  }
  if (!g || isIdentityMapConversion(g)) {
    const placedBy = isIdentitySitePlacement(g) ? 'none' : 'site placement'
    return { ...read, operation: null, placedBy }
  }
  return {
    ...read,
    operation: {
      origin: [
        (num(g.eastings) ?? 0) * u,
        (num(g.northings) ?? 0) * u,
        (num(g.orthogonalHeight) ?? 0) * u
      ],
      rotationDeg: mapRotationDeg(g) ?? 0
    },
    placedBy: g.sources.includes('ePset') ? 'ePset_MapConversion' : 'IfcMapConversion'
  }
}

/**
 * `a ∘ b`: apply `b`, then `a`. Both are rotations about `+Z` and translations, so the result
 * is one too. A `null` side is the identity and hands the other back **unchanged** — not
 * recomputed — which is what keeps every identity case byte for byte what it was.
 */
export function composeFrames(a: ProjectFrame | null, b: ProjectFrame | null): ProjectFrame | null {
  if (!a) return b
  if (!b) return a
  return {
    origin: toWorld(a, ...b.origin),
    rotationDeg: normaliseDeg(a.rotationDeg + b.rotationDeg)
  }
}

/** The inverse transform: `invertFrame(f) ∘ f` is the identity. */
export function invertFrame(f: ProjectFrame | null): ProjectFrame | null {
  if (!f) return null
  return { origin: toProject(f, 0, 0, 0), rotationDeg: normaliseDeg(-f.rotationDeg) }
}

const sameFrame = (a: ProjectFrame | null, b: ProjectFrame | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.rotationDeg === b.rotationDeg &&
    a.origin[0] === b.origin[0] &&
    a.origin[1] === b.origin[1] &&
    a.origin[2] === b.origin[2])

/**
 * **P** — the federation's frame: the boot model's project frame expressed in map coordinates,
 * `M_boot ∘ Site_boot`, project → map. It is what the scene stands square with, what
 * `frameKey` marks a camera with, and what the base point describes.
 *
 * For a boot model whose map operation is the identity — every Revit "Shared Coordinates"
 * export, the reference model, the design's mock — it **is** the site frame, not recomputed,
 * so its `frameKey` is exactly what it was before 2026-10-08. A boot model placed by a map
 * conversion gets a new one, and a camera saved against it restores as any other camera from
 * another frame does: everything but the camera.
 */
export function federationFrame(boot: Georeference | null | undefined): ProjectFrame | null {
  return composeFrames(mapPlacement(boot).operation, projectFrame(boot))
}

/**
 * **frame_i** — project → model i's own world, `M_i⁻¹ ∘ P`: what `geometry-streamer.ts`
 * composes the inverse of on the left of every placement of model i, and what its grids and
 * storeys go through. World → project is then `P⁻¹ ∘ M_i`, so every model lands where its own
 * declaration puts it on the map, read in the boot model's project frame.
 *
 * When model i's operation is the boot model's own, number for number — the identity with the
 * identity included — `M_i⁻¹ ∘ M_boot` is the identity and is not computed: the frame is the
 * boot model's site frame itself. So the boot model, and every model placed the way it is,
 * streams exactly as it did when the federation was assembled by world coordinates.
 */
export function modelFrame(
  boot: Georeference | null | undefined,
  g: Georeference | null | undefined
): ProjectFrame | null {
  const own = mapPlacement(g).operation
  if (sameFrame(own, mapPlacement(boot).operation)) return projectFrame(boot)
  return composeFrames(invertFrame(own), federationFrame(boot))
}

/** `identity` for no frame, else a stable string — the session's "same frame?" marker. */
export const IDENTITY_FRAME_KEY = 'identity'

/**
 * What a session, a share link and a saved viewpoint record beside their camera — since
 * 2026-10-08 the key of P, `federationFrame` (unchanged for a boot model whose map operation is
 * the identity).
 *
 * The camera is stored in **scene** coordinates, and the scene is the project frame minus the
 * federation offset — so a payload written before this frame existed, or against a different
 * boot model, points the camera somewhere else entirely. Three decimals is a millimetre on the
 * origin and 1e-4° on the angle, which is the precision the base point itself is kept to.
 */
export function frameKey(f: ProjectFrame | null | undefined): string {
  if (!f) return IDENTITY_FRAME_KEY
  const [x, y, z] = f.origin
  return `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}@${f.rotationDeg.toFixed(4)}`
}

/** World → project: subtract the origin, then turn back by `−rotationDeg`. */
export function toProject(
  f: ProjectFrame | null | undefined,
  x: number,
  y: number,
  z: number
): [number, number, number] {
  if (!f) return [x, y, z]
  const a = (-f.rotationDeg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const dx = x - f.origin[0]
  const dy = y - f.origin[1]
  return [dx * cos - dy * sin, dx * sin + dy * cos, z - f.origin[2]]
}

/** Project → world: turn by `+rotationDeg`, then add the origin. */
export function toWorld(
  f: ProjectFrame | null | undefined,
  x: number,
  y: number,
  z: number
): [number, number, number] {
  if (!f) return [x, y, z]
  const a = (f.rotationDeg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return [f.origin[0] + x * cos - y * sin, f.origin[1] + x * sin + y * cos, f.origin[2] + z]
}

/**
 * The same world → project transform as a column-major 4×4, for `geometry-streamer.ts` to
 * compose on the left of every placement. `null` keeps the streamer's old code path exactly.
 */
export function worldToProjectMatrix(f: ProjectFrame | null | undefined): Float64Array | null {
  if (!f) return null
  const a = (-f.rotationDeg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const [ox, oy, oz] = f.origin
  // R(−a) × T(−origin): the rotation columns, then the rotated negative origin.
  return new Float64Array([
    cos, sin, 0, 0,
    -sin, cos, 0, 0,
    0, 0, 1, 0,
    -ox * cos + oy * sin, -ox * sin - oy * cos, -oz, 1
  ])
}

/* ────────────────────────────── the project base point ────────────────────────────── */

/** Coordinates are kept to a millimetre and the angle to 1e-4°, which is 0.2 mm over 100 m. */
const mm = (v: number): number => Math.round(v * 1e3) / 1e3
const deg4 = (v: number): number => Math.round(v * 1e4) / 1e4

/**
 * The base point the Coordinate-system card opens with: **the map coordinates of the project
 * frame's origin**, and the total rotation from project north to true north.
 *
 * The map conversion is composed **over** the site placement, because that is the order the
 * file states them in — the site placement puts the project frame into the file's world, and
 * `IfcMapConversion` puts that world onto the map. Either may be identity; both usually are
 * not the whole story on their own, which is the defect this replaces: the old reading took a
 * present-but-zero map conversion first and handed the card 0 / 0 / 0 / 0 for a file whose
 * position and 43° rotation were sitting on its site.
 *
 * Since 2026-10-08 the numbers **are** `federationFrame(g)` — P, the frame the geometry is
 * placed with — read as a base point: the same map operation (`mapPlacement`), so E, N and Z
 * carry the same map unit u the geometry does, and `IfcMapConversion.Scale` is not applied
 * here either. The base point a federation shows is its boot model's
 * (`renderer/model/federation-store.ts`), so it describes the frame the whole scene is in.
 * What stays this function's own is the reading of what a file *states*: a field nothing
 * states stays blank, as before.
 *
 * When nothing states a rotation but the Model context declares a `TrueNorth` that is not
 * `(0, 1)`, that direction is the angle — it is stated in the project frame once neither
 * transform rotates. It is only ever a readout: it never moves geometry, and a map conversion
 * and a `TrueNorth` that disagree are resolved in the map conversion's favour, because it is
 * what the E / N readouts and the geometry are computed with.
 *
 * `null` means "leave every field blank" — the card renders empty inputs, never a default.
 */
export function coordsFromGeoref(g: Georeference | null | undefined): BasePoint | null {
  if (!g) return null

  const frame = projectFrame(g)
  const p = federationFrame(g)
  const [pE, pN, pZ] = p ? p.origin : [0, 0, 0]
  const mapRot = mapRotationDeg(g)
  // `frame.rotationDeg` is always a number, because the geometry transform needs one; here the
  // question is whether the file *states* a rotation, so the record is read directly. A site
  // that only translates leaves `angle` absent rather than claiming north.
  const siteRot = g.site?.pureZRotation === false ? null : num(g.site?.rotationDeg)

  // The project origin on the map: P's own origin.
  const hasPlan = num(g.eastings) != null || num(g.northings) != null || frame != null
  const E = hasPlan ? mm(pE) : null
  const N = hasPlan ? mm(pN) : null
  let Z = num(g.orthogonalHeight) != null || frame != null ? mm(pZ) : null
  // `IfcSite.RefElevation` is the last thing that states a height, and it is a height alone.
  if (Z == null && g.site?.elevation != null) Z = mm(g.site.elevation)

  let angle: number | null = null
  if (mapRot != null || siteRot != null) {
    angle = deg4(p ? p.rotationDeg : 0)
  } else if (g.trueNorth) {
    const [tx, ty] = g.trueNorth
    // `(0, 1)` is "true north is project north", which states no rotation at all.
    if (Math.hypot(tx, ty) > 0 && Math.abs(Math.atan2(tx, ty)) * (180 / Math.PI) >= 1e-6) {
      angle = deg4(normaliseDeg((Math.atan2(tx, ty) * 180) / Math.PI))
    }
  }

  if (E == null && N == null && Z == null && angle == null) return null
  return { E, N, Z, angle }
}

/* ────────────────────────────── the CRS chip ────────────────────────────── */

/** SVY21 / EPSG:3414, however the file spells it. */
const SVY21 = /svy\s*-?\s*21|\b3414\b/i

/** Every place an `IfcProjectedCRS` can name itself. */
const crsNames = (g: Georeference | null | undefined): string[] =>
  g?.crs
    ? [g.crs.name, g.crs.description, g.crs.geodeticDatum, g.crs.mapProjection].filter(
        (s): s is string => !!s
      )
    : []

export const isSvy21 = (g: Georeference | null | undefined): boolean =>
  crsNames(g).some((s) => SVY21.test(s))

/**
 * What the two CRS chips say. The design writes a literal `SVY21` in the status bar
 * (`SGVue.dc.html:710`) and a literal `SVY21 · EPSG:3414` in the Coordinate-system card
 * (`:690`) — true of its own Singapore subject, and a placeholder for any other file.
 *
 * The data rule:
 * · the file's projected CRS is SVY21 / EPSG:3414 → the design's own two chips, verbatim;
 * · it names something else → that name (the card shows the same name; nothing is invented to
 *   fill the card's second half);
 * · no projected CRS, but the user has typed a base point this session → the design's chip in
 *   the status bar, because a session with coordinates in it is the state the design drew;
 *   the card still names no CRS, because typing a base point does not name one;
 * · nothing at all → the design's em dash, as everywhere else a value is absent.
 */
export function crsChip(
  g: Georeference | null | undefined,
  manualCoords: boolean
): { short: string; long: string } {
  if (isSvy21(g)) return { short: 'SVY21', long: 'SVY21 · EPSG:3414' }
  const named = crsNames(g)[0]
  if (named) return { short: named, long: named }
  if (manualCoords) return { short: 'SVY21', long: DASH }
  return { short: DASH, long: DASH }
}
