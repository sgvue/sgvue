/**
 * Types for `sample-model.js`, which is a **byte-identical copy** of
 * `design-reference/design/sample-model.js` (`tests/unit/mock-adapter.test.ts` fails the
 * build if the two ever differ). The copy exists only because the design bundle is the
 * read-only specification and cannot carry a `.d.ts` of its own.
 */

/** A box in metres, Z up: size `s` and centre `p`. */
export interface SampleBox {
  s: [number, number, number]
  p: [number, number, number]
}

/** One colour group of an element's geometry. */
export interface SamplePart {
  color: string
  boxes: SampleBox[]
}

export interface SampleElement {
  id: number
  guid: string
  tag: string
  type: string
  predefinedType: string
  objectType: string
  name: string
  storey: string
  material: string
  /** Present when the whole element is one colour. */
  color?: string
  boxes?: SampleBox[]
  /** Present when the element has several colour groups (windows, doors, trees). */
  parts?: SamplePart[]
  psets: Record<string, Record<string, string | number | boolean>>
  qto: Record<string, Record<string, number>>
}

export interface SampleStorey {
  name: string
  elev: number
  h: number
}

export interface SampleGrid {
  name: string
  axis: 'x' | 'y'
  v: number
}

export interface SampleProject {
  name: string
  file: string
  schema: string
  site: string
  building: string
  discipline?: string
}

export interface SampleModel {
  project: SampleProject
  storeys: SampleStorey[]
  grids: SampleGrid[]
  elements: SampleElement[]
}

export interface SampleFile {
  key: string
  name: string
  file: string
  discipline: string
  swatch: string
}

/** What `federate` adds to every element: the offset id, the file-local id, the model key. */
export interface FederatedSampleElement extends SampleElement {
  localId: number
  model: string
}

export interface FederatedSampleModel extends Omit<SampleModel, 'elements'> {
  elements: FederatedSampleElement[]
  files: SampleProject[]
}

export const COLORS: Record<string, { color: number; opacity?: number }>
export const SAMPLE_FILES: SampleFile[]
export function buildModel(): SampleModel
export function buildDisciplineModel(key: string): SampleModel
export function federate(models: SampleModel[]): FederatedSampleModel
