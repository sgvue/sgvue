/**
 * Shared test helper — not a test on its own (the name does not end in `.test.ts`).
 *
 * A tiny IFC4 file of box-shaped parts on the repository's synthetic site (`CLAUDE.md`, Rules:
 * `12345.457 / 23456.766 / 5.05`, −43.4103° — `tests/fixtures/reference.ifc` `#12` / `#14`, and
 * `tests/unit/float64-far-origin.test.ts`), and where each box's corners are in the file's own
 * world coordinates, worked out in Float64 from the file's numbers alone — never from what
 * web-ifc or the streamer made of them. Used by `project-reopen-positions.test.ts` and
 * `selection-dims-plan-frame.test.ts`.
 *
 * Every box is axis-aligned in the **site's** frame, so in world axes it stands turned by the
 * site's −43.4103°. Every number written here is the synthetic site's or a few metres from it,
 * below the privacy scan's coordinate band (`scripts/privacy.cjs`, rule 4).
 */

/** The synthetic site (mm), and its x axis — `reference.ifc` `#12` and `#14`, verbatim. */
export const SITE_MM = [12345457, 23456766, 5050] as const
export const SITE_X = [0.726451142256412, -0.687218115240245] as const
/** The site's turn in the world, degrees anticlockwise: atan2 of its x axis, −43.4103°. */
export const SITE_TURN_DEG = (Math.atan2(SITE_X[1], SITE_X[0]) * 180) / Math.PI

/** One box: its corner nearest the storey's origin and its size, both mm, in the site's frame. */
export interface BoxSpec {
  name: string
  at: readonly [number, number, number]
  size: readonly [number, number, number]
}

export interface ModelSpec {
  /** The project's name, and what makes its GlobalIds its own. */
  name: string
  /** A digit 1–9 that every GlobalId of this file starts with, so two files never share one. */
  guidPrefix: string
  boxes: readonly BoxSpec[]
}

/** The text of the file: the site, a building, a storey and one proxy per box. */
export function boxModel(spec: ModelSpec): string {
  const lines: string[] = []
  let n = 0
  const add = (entity: string): number => {
    lines.push(`#${++n}=${entity};`)
    return n
  }
  const f = (v: number): string => (Number.isInteger(v) ? `${v}.` : String(v))
  const point = (p: readonly number[]): number => add(`IFCCARTESIANPOINT((${p.map(f).join(',')}))`)
  const gid = (i: number): string => `'${spec.guidPrefix}${String(i).padStart(21, '0')}'`

  const mm = add('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)')
  const units = add(`IFCUNITASSIGNMENT((#${mm}))`)
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${add(`IFCAXIS2PLACEMENT3D(#${point([0, 0, 0])},$,$)`)},$)`)
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${ctx},$,.MODEL_VIEW.,$)`)
  const project = add(`IFCPROJECT(${gid(1)},$,'${spec.name}',$,$,$,$,(#${ctx}),#${units})`)
  const up = add('IFCDIRECTION((0.,0.,1.))')
  const siteX = add(`IFCDIRECTION((${SITE_X.map(f).join(',')},0.))`)
  const sitePlace = add(`IFCLOCALPLACEMENT($,#${add(`IFCAXIS2PLACEMENT3D(#${point(SITE_MM)},#${up},#${siteX})`)})`)
  const site = add(`IFCSITE(${gid(2)},$,'Site',$,$,#${sitePlace},$,$,.ELEMENT.,$,$,$,$,$)`)
  const at = (parent: number, p: readonly number[]): number =>
    add(`IFCLOCALPLACEMENT(#${parent},#${add(`IFCAXIS2PLACEMENT3D(#${point(p)},$,$)`)})`)
  const buildingPlace = at(sitePlace, [0, 0, 0])
  const building = add(`IFCBUILDING(${gid(3)},$,'Building',$,$,#${buildingPlace},$,$,.ELEMENT.,$,$,$)`)
  const storeyPlace = at(buildingPlace, [0, 0, 0])
  const storey = add(`IFCBUILDINGSTOREY(${gid(4)},$,'Level 1',$,$,#${storeyPlace},$,$,.ELEMENT.,0.)`)
  add(`IFCRELAGGREGATES(${gid(5)},$,$,$,#${project},(#${site}))`)
  add(`IFCRELAGGREGATES(${gid(6)},$,$,$,#${site},(#${building}))`)
  add(`IFCRELAGGREGATES(${gid(7)},$,$,$,#${building},(#${storey}))`)
  const proxies: number[] = []
  for (const [i, b] of spec.boxes.entries()) {
    const [dx, dy, dz] = b.size
    const profile = add(
      `IFCRECTANGLEPROFILEDEF(.AREA.,$,#${add(`IFCAXIS2PLACEMENT2D(#${add(`IFCCARTESIANPOINT((${f(dx / 2)},${f(dy / 2)}))`)},$)`)},${f(dx)},${f(dy)})`
    )
    const solid = add(`IFCEXTRUDEDAREASOLID(#${profile},#${add(`IFCAXIS2PLACEMENT3D(#${point([0, 0, 0])},$,$)`)},#${up},${f(dz)})`)
    const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${add(`IFCSHAPEREPRESENTATION(#${body},'Body','SweptSolid',(#${solid}))`)}))`)
    proxies.push(add(`IFCBUILDINGELEMENTPROXY(${gid(10 + i)},$,'${b.name}',$,$,#${at(storeyPlace, b.at)},#${shape},$,.NOTDEFINED.)`))
  }
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${gid(8)},$,$,$,(${proxies.map((id) => `#${id}`).join(',')}),#${storey})`)
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    `FILE_NAME('${spec.name}.ifc','2026-11-11T00:00:00',('SGVue test fixture'),('SGVue'),'tests/unit/synthetic-boxes.ts','none','none');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    ''
  ].join('\n')
}

/** A point in the site's frame (mm) in world metres, IFC Z-up: the site's point plus its turn of it. */
export function worldOf(p: readonly number[]): [number, number, number] {
  const len = Math.hypot(SITE_X[0], SITE_X[1])
  const [cx, sx] = [SITE_X[0] / len, SITE_X[1] / len]
  return [
    (SITE_MM[0] + cx * p[0] - sx * p[1]) / 1000,
    (SITE_MM[1] + sx * p[0] + cx * p[1]) / 1000,
    (SITE_MM[2] + p[2]) / 1000
  ]
}

/** A box's eight corners in world metres, from the file's numbers. Corner i takes max on axis k when bit k is set. */
export function boxCorners(b: BoxSpec): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let i = 0; i < 8; i++) {
    out.push(worldOf([0, 1, 2].map((k) => b.at[k] + (i & (1 << k) ? b.size[k] : 0))))
  }
  return out
}

/** A box's centre in world metres, from the file's numbers. */
export const boxCentre = (b: BoxSpec): [number, number, number] =>
  worldOf([0, 1, 2].map((k) => b.at[k] + b.size[k] / 2))

/** The site's own axes in the world (unit vectors, Z-up): x, y, z. */
export function siteAxes(): [[number, number, number], [number, number, number], [number, number, number]] {
  const len = Math.hypot(SITE_X[0], SITE_X[1])
  const [cx, sx] = [SITE_X[0] / len, SITE_X[1] / len]
  return [
    [cx, sx, 0],
    [-sx, cx, 0],
    [0, 0, 1]
  ]
}
