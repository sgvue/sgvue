/**
 * The IFC-SG Code of Practice property lists, bundled (2026-11-22) — what `ifcsg_columns` reads.
 *
 * `ifcsg-cop.json` is a pinned, trimmed copy of the corpus at https://ifcsg-md.pages.dev/
 * (corpus v4 rev 3, the CORENET X CoP 4th Edition), written by `scripts/ifcsg-corpus.cjs` and
 * committed; the app never fetches it. CC BY 4.0, credited in NOTICE. It is an independent
 * compilation, **not an official BCA publication**, and every result that quotes it says so.
 *
 * One record per classification — an IFC entity and one sub-type, `IfcDoor.DOOR` — or an entity
 * alone where the CoP names no sub-type (`IfcWall`). Each lists its properties once, in the CoP's
 * order, with type and unit. `tests/unit/ifcsg-cop.test.ts` holds the copy to its recorded hashes.
 */
import corpus from './ifcsg-cop.json'

export interface CopProperty {
  name: string
  type: string
  unit?: string
}

export interface CopClassification {
  /** `Entity.SUBTYPE`, or the entity alone. */
  key: string
  entity: string
  subtype: string | null
  /** The CoP component(s) that list it, with their page range in the CoP PDF. */
  sources: { component: string; pages: [number, number] | null }[]
  noPropertiesRequired: boolean
  properties: CopProperty[]
}

export interface CopCorpus {
  source: {
    title: string
    site: string
    url: string
    cop: string
    corpusVersion: string
    revision: number
    generated: string
    retrieved: string
    license: string
    note: string
    /** SHA-256 of the source file the copy was trimmed from. */
    sha256: string
  }
  /** SHA-256 of `JSON.stringify(classifications)`, as the generator wrote them. */
  contentSha256: string
  classifications: CopClassification[]
}

export const IFCSG_COP = corpus as CopCorpus

const BY_KEY: ReadonlyMap<string, CopClassification> = new Map(IFCSG_COP.classifications.map((c) => [c.key, c]))

/** The classification for an entity and sub-type, or for the entity alone when `subtype` is null. */
export const copClassification = (entity: string, subtype: string | null): CopClassification | undefined =>
  BY_KEY.get(subtype ? `${entity}.${subtype}` : entity)

/** The one sentence every result quoting the corpus carries. */
export const COP_SOURCE = `${IFCSG_COP.source.cop}, as listed by the IFC-SG corpus v${IFCSG_COP.source.corpusVersion} rev ${IFCSG_COP.source.revision} (${IFCSG_COP.source.site}, ${IFCSG_COP.source.license}) — an independent compilation, not an official BCA publication.`
