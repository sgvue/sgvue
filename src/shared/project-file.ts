/**
 * The `.sgvue` project file — format v1, its reader, its writer and its restore planner
 * (`docs/plans/project-file.md`, phase 1: "Format and codec, headless").
 *
 * A project names the IFC files of a coordination review and everything done on top of them —
 * colours, viewpoints, filter sets, schedules, sections, markups, what is hidden. It never holds
 * model data. Everything here is arithmetic on plain objects: no DOM, no Electron, no store.
 * Phase 2 wires it to the File menu.
 *
 * **Every element is named by `[modelId, GlobalId]`** (plan D2) — never by a federation id,
 * which is `slot × ID_STRIDE + expressId` and changes when a model is re-exported or opened in
 * another order. `modelId` (`m1`, `m2` …) is stable inside the file and is never a slot.
 *
 * **Coordinates are world coordinates** — the files' own, metres, Z up: the camera's target and
 * every markup's point are written as scene + offset and read back as world − offset, so a
 * project opened with another federation offset still points where it pointed.
 *
 * **What is saved** is the plan's D5 table, read off the same state `sessionSource` reads
 * (`ProjectSource` is `SessionSource`'s keys plus what a session does not carry). The theme
 * (D7), the base point, `hlColor` and `uploadNames` are not; nor is the selection, the chat, or
 * anything of Preferences.
 *
 * **A `Model` rule names a model by its id in the file.** A rule's `Model` value is a model key
 * (`attr(el, 'Model')` is `el.model`), and a key is the file's stem, deduplicated with ` (2)` in
 * the order the files were opened — so a `Model = <key>` rule of a loaded model is written with
 * the tagged value `{ "model": "m1" }` and read back as whatever key `m1` is open under, or, when
 * `m1` is not open, as the key its file name gives (`modelKeyOf`). Any other value is a literal,
 * kept as it was written — a model whose key reads `m1` is never taken for the file's `m1`.
 *
 * **Model ids are exactly what the writer gives** (`m1` … `m999999`), and every map the planner
 * builds from file text has no prototype, so no id or key can reach `Object.prototype`.
 *
 * The reader never throws and refuses with a message: anything over `PROJECT_MAX_BYTES`, text
 * that is not JSON, a `__proto__` key anywhere, another `format`, a `version` above
 * `PROJECT_VERSION` ("made by a newer SGVue — update the app", `parseScheduleDef`'s rule), and
 * anything the schema does not accept. Unknown keys are ignored. Every list and string is
 * bounded, and the writer keeps inside the same bounds, so whatever it writes reads back.
 */
import { z } from 'zod'
import { parseScheduleDef, type ScheduleDef } from '../schedule/schedule/def'
import type { LaserSides } from './annotate'
import { MC } from './colors'
import { ID_STRIDE, modelKeyOf } from './federate'
import type { FilterSet } from './filter-stack'
import { IDENTITY_FRAME_KEY } from './georef'
import type { FilterStep, Rule } from './rules'
import { NO_SECTIONS, type Sections } from './sections'
import {
  idNumbering,
  legacySection,
  sectionsOf,
  type SessionCamera,
  type SessionSection,
  type SessionSource
} from './session-codec'
import { DISPLAY_UNITS } from './units'

/* ────────────────────────────── bounds ────────────────────────────── */

export const PROJECT_FORMAT = 'sgvue-project'
export const PROJECT_VERSION = 1
/** The largest project file read or written (plan D11): 16 MiB of UTF-8. */
export const PROJECT_MAX_BYTES = 16 * 1024 * 1024

/** Models in one project. */
export const MAX_MODELS = 200
/** A path, absolute or relative. */
export const MAX_PATH = 4096
/** Any free text: a file name, a label, a viewpoint's name, a storey's name, a rule's value. */
export const MAX_TEXT = 1000
/** A model id or a filter step's id. */
export const MAX_ID = 64
/** A GlobalId: 22 characters when valid; a broken export's can be a UUID or longer. */
export const MAX_GUID = 64
/** Element references in one list — `hidden`, or one viewpoint's. */
export const MAX_REFS = 1_000_000
export const MAX_VIEWPOINTS = 1000
export const MAX_FILTER_SETS = 100
export const MAX_STEPS = 100
export const MAX_RULES = 100
/** Saved schedule setups — the Schedules window keeps a hundred (`schedule-ui/schedules.ts`). */
export const MAX_SCHEDULES = 100
export const MAX_MARKUPS = 10_000
/** Entries of a storey-eye map. */
export const MAX_STOREYS = 10_000

/* ────────────────────────────── paths ────────────────────────────── */

/** How an absolute path is spelled: POSIX (`/a/b`) or Windows (`C:\a\b`, `\\server\share\a`). */
export type PathStyle = 'posix' | 'win32'

interface AbsPath {
  style: PathStyle
  /** `''` (POSIX `/`), `C:` (a drive, upper case) or `\\server\share`. */
  root: string
  /** Normalised segments: no `''`, no `.`, no `..` (a `..` at the root stays at the root). */
  parts: string[]
}

/** `.` and empty segments dropped, `..` applied — or `null` where a `..` would climb past the root. */
function applySegments(base: readonly string[], segs: readonly string[]): string[] | null {
  const out = [...base]
  for (const s of segs) {
    if (s === '' || s === '.') continue
    if (s === '..') {
      if (!out.length) return null
      out.pop()
    } else out.push(s)
  }
  return out
}

/**
 * An absolute path in either style, normalised — or `null` for a relative one or one with a NUL.
 * A `..` past the root stays at the root, as both operating systems resolve it.
 */
function parseAbsolute(p: string): AbsPath | null {
  if (!p || p.includes('\0')) return null
  const clamp = (segs: string[]): string[] => {
    const out: string[] = []
    for (const s of segs) {
      if (s === '' || s === '.') continue
      if (s === '..') out.pop()
      else out.push(s)
    }
    return out
  }
  const drive = /^([A-Za-z]):[\\/]/.exec(p)
  if (drive) {
    return { style: 'win32', root: drive[1].toUpperCase() + ':', parts: clamp(p.slice(3).split(/[\\/]/)) }
  }
  const unc = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)(?:[\\/]|$)/.exec(p)
  if (unc) {
    return {
      style: 'win32',
      root: `\\\\${unc[1]}\\${unc[2]}`,
      parts: clamp(p.slice(unc[0].length).split(/[\\/]/))
    }
  }
  if (p.startsWith('/')) return { style: 'posix', root: '', parts: clamp(p.split('/')) }
  return null
}

function formatAbsolute(a: AbsPath): string {
  if (a.style === 'posix') return '/' + a.parts.join('/')
  return a.root + '\\' + a.parts.join('\\')
}

/** True for a POSIX absolute path, a Windows drive path or a UNC path. */
export const isAbsolutePath = (p: string): boolean => parseAbsolute(p) !== null

/** Which style an absolute path is spelled in, or `null` when it is not one. */
export const pathStyleOf = (p: string): PathStyle | null => parseAbsolute(p)?.style ?? null

/** An absolute path, normalised in its own style (`/a/./b/../c` → `/a/c`), or `null`. */
export function normaliseAbsolute(p: string): string | null {
  const a = parseAbsolute(p)
  return a ? formatAbsolute(a) : null
}

export type RelPathCheck =
  | { ok: true; path: string; climbs: number }
  | { ok: false; reason: string }

/**
 * A model's `relPath`, checked: relative, with no NUL, no drive letter (`C:`, `C:foo`) and no
 * colon at all (a Windows stream name), not starting at a root (`/`, `\`, `\\server`). `\` is read
 * as a separator, so a hand-edited Windows path reads. `..` is allowed — models often sit beside
 * the project's folder — and `climbs` says how many folders above it the path starts. `path` is
 * the normalised, `/`-separated spelling.
 */
export function checkRelPath(rel: string): RelPathCheck {
  if (!rel) return { ok: false, reason: 'is empty' }
  if (rel.includes('\0')) return { ok: false, reason: 'holds a NUL character' }
  if (/^[\\/]/.test(rel)) return { ok: false, reason: 'is not relative' }
  if (rel.includes(':')) return { ok: false, reason: 'names a drive' }
  const out: string[] = []
  let climbs = 0
  for (const s of rel.split(/[\\/]/)) {
    if (s === '' || s === '.') continue
    if (s === '..') {
      if (out.length) out.pop()
      else climbs++
    } else out.push(s)
  }
  if (!out.length) return { ok: false, reason: 'names no file' }
  return { ok: true, path: [...Array<string>(climbs).fill('..'), ...out].join('/'), climbs }
}

const sameSegment = (style: PathStyle, a: string, b: string): boolean =>
  style === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/**
 * `modelPath` relative to the folder `projectFile` is in, `/`-separated — what a model's
 * `relPath` is written as. `null` when there is none: either path is not absolute, they are in
 * different styles or on different drives or shares, or a segment holds what a `relPath` cannot
 * (a `\` in a POSIX name, a `:`). Windows segments compare without case.
 */
export function relPathOf(projectFile: string, modelPath: string): string | null {
  const from = parseAbsolute(projectFile)
  const to = parseAbsolute(modelPath)
  if (!from || !to || from.style !== to.style || !to.parts.length) return null
  if (!sameSegment(from.style, from.root, to.root)) return null
  const dir = from.parts.slice(0, -1)
  let common = 0
  while (
    common < dir.length &&
    common < to.parts.length - 1 &&
    sameSegment(from.style, dir[common], to.parts[common])
  ) {
    common++
  }
  const rest = to.parts.slice(common)
  if (rest.some((s) => s.includes(':') || (from.style === 'posix' && s.includes('\\')))) return null
  const rel = [...Array<string>(dir.length - common).fill('..'), ...rest].join('/')
  return rel.length <= MAX_PATH ? rel : null
}

/**
 * A `relPath` resolved against the project file's folder, in the project path's own style —
 * phase 2 tries it first and the model's `absPath` after. `null` when the project path is not
 * absolute, the `relPath` does not pass `checkRelPath`, or its `..` climb past the root.
 */
export function resolveRelPath(projectFile: string, relPath: string): string | null {
  const from = parseAbsolute(projectFile)
  const rel = checkRelPath(relPath)
  if (!from || !rel.ok) return null
  const parts = applySegments(from.parts.slice(0, -1), rel.path.split('/'))
  return parts ? formatAbsolute({ ...from, parts }) : null
}

/* ────────────────────────────── colour (D12) ────────────────────────────── */

/**
 * The colour a model added to a project for the first time takes (plan D12): the palette colour
 * the loaded models use least, ties to the earlier one in the palette. Colours compare without
 * case; a used colour that is not in the palette counts for nothing. `null` for an empty palette.
 */
export function leastUsedColour(
  palette: readonly string[],
  usedColours: readonly string[]
): string | null {
  const count = new Map<string, number>()
  for (const c of usedColours) {
    const k = c.toUpperCase()
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  let best: string | null = null
  let fewest = Infinity
  for (const c of palette) {
    const n = count.get(c.toUpperCase()) ?? 0
    if (n < fewest) {
      best = c
      fewest = n
    }
  }
  return best
}

/* ────────────────────────────── the schema ────────────────────────────── */

const text = (max = MAX_TEXT): z.ZodString => z.string().max(max)
const finite = z.number().refine(Number.isFinite, 'must be a finite number')
const xyz = z.tuple([finite, finite, finite])
/**
 * Exactly what the writer gives a model: `m1`, `m2` … — so no id can ever be `__proto__`,
 * `constructor` or any other name an object already answers to.
 */
const ModelId = z.string().regex(/^m[1-9][0-9]{0,5}$/, 'is not a model id')
const Guid = z.string().min(1).max(MAX_GUID)
/** `[modelId, GlobalId]` — the one way the file names an element. */
const Ref = z.tuple([ModelId, Guid])
const Refs = z.array(Ref).max(MAX_REFS)
const Colour = z.string().regex(/^#(?:[0-9A-Fa-f]{3}){1,2}$/, 'is not a colour')

/** A record whose keys and number of entries are bounded. */
const boundedRecord = <V extends z.ZodType>(value: V, maxEntries: number, maxKey = MAX_TEXT) =>
  z
    .record(z.string().max(maxKey), value)
    .refine((o) => Object.keys(o).length <= maxEntries, `has more than ${maxEntries} entries`)

/**
 * A `Model` rule's value that names one of the file's models: `{ "model": "m2" }`. Any other value
 * — of any rule — is a literal, so a model whose key happens to read `m2` is never confused with one.
 */
const ModelValue = z.object({ model: ModelId })
const RuleSchema = z
  .object({
    prop: text(),
    op: z.enum(['=', '!=', '~', '>', '<', 'absent']),
    val: z.union([text(), finite, z.null(), ModelValue]),
    join: z.enum(['and', 'or']).optional()
  })
  .refine((r) => r.prop === 'Model' || typeof r.val !== 'object' || r.val === null, {
    message: 'names a model on a rule that is not a Model rule',
    path: ['val']
  })
const Action = z.enum(['isolate', 'hide', 'highlight'])
const StepSchema = z.object({
  id: text(MAX_ID),
  on: z.boolean(),
  action: Action,
  color: text(32).optional(),
  rules: z.array(RuleSchema).max(MAX_RULES)
})
const Stack = z.array(StepSchema).max(MAX_STEPS)

/** Both planes, through the session's own normaliser (`sectionsOf`): coerced, never trusted. */
const SectionsSchema = z.unknown().transform((v): Sections => sectionsOf({ sections: v }) ?? NO_SECTIONS)

/** The camera, its target in world coordinates. */
const CameraSchema = z.object({
  theta: finite,
  phi: finite,
  dist: finite,
  half: finite,
  target: xyz,
  proj: z.enum(['persp', 'ortho'])
})

/** A schedule definition, through the importer's own validator (`parseScheduleDef`). */
const ScheduleSchema = z.unknown().transform((v, ctx): ScheduleDef => {
  try {
    return parseScheduleDef(v)
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : 'is not a schedule' })
    return z.NEVER
  }
})

const RelPath = z
  .string()
  .max(MAX_PATH)
  .transform((v, ctx): string => {
    const r = checkRelPath(v)
    if (r.ok) return r.path
    ctx.addIssue({ code: 'custom', message: `relPath ${r.reason}` })
    return z.NEVER
  })

const ModelSchema = z.object({
  id: ModelId,
  name: text(),
  relPath: RelPath.nullable(),
  absPath: text(MAX_PATH).refine(isAbsolutePath, 'is not an absolute path'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'is not a SHA-256'),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  label: text(),
  /** The colour the MODELS row showed when the project was saved. */
  colour: Colour,
  /**
   * Whether `colour` is the user's own pick (`modelColors[key]`). Only an own colour is applied on
   * restore; any other is a record of what the row showed and is not applied, so the model takes
   * what the app gives it — its library swatch, else its slot's colour — and a model on the grey
   * `MC[0]` keeps the accent for its section cut (`cutSwatch`). Decided by this flag, never by hex.
   */
  own: z.boolean(),
  /**
   * 2026-11-07 (phase 2, plan D12) — `colour` is the one the project gave a model when it was
   * added to an open project: the palette colour its neighbours used least. Restored as that
   * again (the store's `assignedColors`), never as the user's own pick. Absent means `false`, so a
   * file written before it reads as it did. Never `true` beside `own: true`.
   */
  assigned: z.boolean().optional(),
  visible: z.boolean()
}).refine((m) => !(m.own && m.assigned), {
  message: 'is both the user’s own colour and an assigned one',
  path: ['assigned']
})

const Sides = z.object({ minus: finite.nullable(), plus: finite.nullable() })

/** How far from 1 a stored normal's length may be: room for a hand-edited file's rounded digits. */
export const NORMAL_TOLERANCE = 1e-3
/** Three finite numbers of unit length (within `NORMAL_TOLERANCE`). */
export const isUnitNormal = (n: unknown): n is [number, number, number] =>
  Array.isArray(n) &&
  n.length === 3 &&
  n.every((x) => typeof x === 'number' && Number.isFinite(x)) &&
  Math.abs(Math.hypot(n[0] as number, n[1] as number, n[2] as number) - 1) <= NORMAL_TOLERANCE
const UnitNormal = xyz.refine((n) => isUnitNormal(n), 'is not a unit vector')

const ProjectSchemaShape = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_VERSION),
  savedBy: text(200),
  savedAt: text(64),
  models: z
    .array(ModelSchema)
    .max(MAX_MODELS)
    .refine((ms) => new Set(ms.map((m) => m.id)).size === ms.length, 'has two models with one id'),
  view: z.object({
    camera: CameraSchema.nullable(),
    /** The lit view button (`SessionSource.view`): `iso`, `top`, … or none. */
    preset: text(32).nullable(),
    sections: SectionsSchema,
    grids: z.boolean(),
    levels: z.boolean(),
    groundGrid: z.boolean(),
    shadows: z.boolean(),
    dims: z.boolean(),
    snap: z.boolean(),
    units: z.enum(DISPLAY_UNITS),
    treeMode: z.enum(['entity', 'type']),
    storeyVis: boundedRecord(z.boolean(), MAX_STOREYS),
    /** "Original materials". */
    nativeMats: z.boolean()
  }),
  visibility: z.object({
    hidden: Refs,
    active: ModelId.nullable(),
    stack: Stack
  }),
  viewpoints: z
    .array(
      z.object({
        id: finite,
        name: text(),
        sub: text(),
        camera: CameraSchema.nullable(),
        sections: SectionsSchema,
        hidden: Refs,
        storeyVis: boundedRecord(z.boolean(), MAX_STOREYS),
        modelVis: z
          .record(ModelId, z.boolean())
          .refine((o) => Object.keys(o).length <= MAX_MODELS, `has more than ${MAX_MODELS} entries`),
        stack: Stack,
        active: ModelId.nullable(),
        grids: z.boolean(),
        levels: z.boolean()
      })
    )
    .max(MAX_VIEWPOINTS),
  filterSets: z
    .array(
      z.object({
        id: finite,
        label: text(),
        stack: Stack,
        mode: Action.optional(),
        rules: z.array(RuleSchema).max(MAX_RULES).optional()
      })
    )
    .max(MAX_FILTER_SETS),
  schedules: z.object({
    saved: z
      .array(z.object({ name: text(200), def: ScheduleSchema, savedAt: text(64) }))
      .max(MAX_SCHEDULES),
    open: ScheduleSchema.nullable()
  }),
  markups: z.object({
    spots: z.array(z.object({ at: xyz })).max(MAX_MARKUPS),
    measures: z
      .array(
        z.object({
          at: xyz,
          x: finite.optional(),
          y: finite.optional(),
          z: finite.optional(),
          sides: z.object({ x: Sides.optional(), y: Sides.optional(), z: Sides.optional() }),
          /**
           * 2026-11-07 (phase 3) — the face the laser was fired from, unit length, world frame
           * (the scene's, which differs from it by a translation only). Optional: a file written
           * before it, or a measurement fired with no face, has none, and an older reader ignores it.
           */
          normal: UnitNormal.optional()
        })
      )
      .max(MAX_MARKUPS)
  })
})

type ParsedProject = z.output<typeof ProjectSchemaShape>
type FileRule = ParsedProject['visibility']['stack'][number]['rules'][number]

/** Every rule in the file: the live stack's, each viewpoint's, each filter set's. */
const rulesOfProject = (p: ParsedProject): FileRule[] => [
  ...[p.visibility.stack, ...p.viewpoints.map((v) => v.stack), ...p.filterSets.map((f) => f.stack)]
    .flat()
    .flatMap((x) => x.rules),
  ...p.filterSets.flatMap((f) => f.rules ?? [])
]

/** A `Model` rule may name only a model the file lists. */
const ProjectSchema = ProjectSchemaShape.superRefine((p, ctx) => {
  const ids = new Set(p.models.map((m) => m.id))
  for (const r of rulesOfProject(p)) {
    if (r.val !== null && typeof r.val === 'object' && !ids.has(r.val.model)) {
      ctx.addIssue({ code: 'custom', message: `a Model rule names ${r.val.model}, which the file does not list` })
      return
    }
  }
})

/** A project file, as `readProject` returns it and `projectOf` builds it. */
export type ProjectFile = z.output<typeof ProjectSchema>
export type ProjectModel = ProjectFile['models'][number]
export type ProjectRef = [modelId: string, guid: string]
type ProjectStep = ProjectFile['visibility']['stack'][number]
type ProjectRule = ProjectStep['rules'][number]

/* ────────────────────────────── the reader ────────────────────────────── */

export type ProjectRead =
  | {
      ok: true
      project: ProjectFile
      /** Models whose `relPath` starts above the project's folder (`..`), by id — reported, allowed. */
      outside: string[]
    }
  | { ok: false; message: string }

const refuse = (message: string): ProjectRead => ({ ok: false, message })

/** UTF-8 bytes of a string, counted only as far as `limit` (a lone surrogate counts as 3). */
function utf8Over(s: string, limit: number): boolean {
  if (s.length > limit) return true
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4
        i++
      } else n += 3
    } else n += 3
    if (n > limit) return true
  }
  return false
}

class ProtoKey extends Error {}

const issueText = (issue: { path: readonly PropertyKey[]; message: string }): string =>
  (issue.path.length ? issue.path.map(String).join('.') + ': ' : '') + issue.message

/**
 * A project file's text, read — or refused with a message. Never throws.
 */
export function readProject(textIn: string): ProjectRead {
  try {
    if (typeof textIn !== 'string') return refuse('This is not an SGVue project file.')
    if (utf8Over(textIn, PROJECT_MAX_BYTES)) {
      return refuse('This project file is larger than 16 MB, which no SGVue project is.')
    }
    let raw: unknown
    try {
      raw = JSON.parse(textIn.replace(/^\uFEFF/, ''), (k, v: unknown) => {
        if (k === '__proto__') throw new ProtoKey()
        return v
      })
    } catch (e) {
      return refuse(
        e instanceof ProtoKey
          ? 'This project file holds a "__proto__" key, which no SGVue project has.'
          : e instanceof SyntaxError
            ? 'This project file is damaged: it is not valid JSON.'
            : // A RangeError: nested deeper than the reader walks. No project is.
              'This project file is nested too deeply to be an SGVue project.'
      )
    }
    if (!raw || typeof raw !== 'object') return refuse('This is not an SGVue project file.')
    // An array has no `format`, so it is refused just below.
    const o = raw as Record<string, unknown>
    if (o.format !== PROJECT_FORMAT) return refuse('This is not an SGVue project file.')
    if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1) {
      return refuse('This project file has no valid "version".')
    }
    if (o.version > PROJECT_VERSION) {
      return refuse(
        `This project was made by a newer SGVue (format v${o.version}) — update the app to open it.`
      )
    }
    const parsed = ProjectSchema.safeParse(raw)
    if (!parsed.success) {
      return refuse(`This project file could not be read (${issueText(parsed.error.issues[0])}).`)
    }
    const project = parsed.data
    const outside = project.models
      .filter((m) => m.relPath !== null && m.relPath.startsWith('../'))
      .map((m) => m.id)
    return { ok: true, project, outside }
  } catch {
    // Nothing above is known to throw: the schema's transforms catch their own. This is the
    // contract's last line — a file someone sent is never a crash.
    return refuse('This project file could not be read.')
  }
}

/** The text a project is saved as: compact JSON, one line. */
export const projectText = (p: ProjectFile): string => JSON.stringify(p)

/* ────────────────────────────── the writer ────────────────────────────── */

/**
 * One saved viewpoint, as the renderer's `Viewpoint` (`state/selectors/views.ts`) holds it — the
 * fields the project reads and writes, stated here because `shared/` does not import the
 * renderer. A test holds the two types to each other in both directions.
 */
export interface ProjectViewpoint {
  id: number
  name: string
  sub: string
  cam: SessionCamera | null
  section?: SessionSection
  sections?: Sections
  hidden: Record<number | string, boolean>
  storeyVis: Record<string, boolean>
  modelVis: Record<string, boolean>
  stack: readonly FilterStep[]
  active: string | null
  grids: boolean
  levels: boolean
  frame?: string
  idStride?: number
}

/** One saved schedule setup, as the Schedules window's list (`SavedEntry`) holds it. */
export interface ProjectSavedSchedule {
  name: string
  def: ScheduleDef
  savedAt: string
}

/** A laser measurement as the viewer records it (`MeasureRecord`), less its session id. */
export interface ProjectMeasure {
  /** The origin, in **scene** coordinates. */
  p: readonly number[]
  x?: number
  y?: number
  z?: number
  sides: Partial<Record<'x' | 'y' | 'z', LaserSides>>
  /** 2026-11-07 (phase 3) — the face the laser was fired from, unit length; absent for none. */
  normal?: readonly number[]
}

/**
 * What a project saves, read off the state — `sessionSource`'s keys that D5 marks saved, plus what
 * a session does not carry. Cameras and markups are in scene coordinates here; the file holds
 * them in world coordinates.
 */
export type ProjectSource = Pick<
  SessionSource,
  | 'hidden'
  | 'storeyVis'
  | 'modelVis'
  | 'active'
  | 'modelColors'
  | 'nativeMats'
  | 'treeMode'
  | 'grids'
  | 'levels'
  | 'shadows'
  | 'snap'
  | 'dims'
  | 'sections'
  | 'stack'
  | 'view'
  | 'units'
> & {
  groundGrid: boolean
  /** `viewer.getCamera()`, scene coordinates, the live frame. */
  cam: SessionCamera | null
  views: readonly ProjectViewpoint[]
  filterSets: readonly FilterSet[]
  /** The Schedules window's saved setups, and the schedule it has open. */
  schedules: readonly ProjectSavedSchedule[]
  openSchedule: ScheduleDef | null
  /** Scene points. A spot's other fields are worked out again from its point. */
  spots: readonly { p: readonly number[] }[]
  measures: readonly ProjectMeasure[]
}

/** One loaded model's file, as phase 2 hands it to the writer. */
export interface ProjectModelInfo {
  /** The federation's model key. */
  key: string
  /** The file's absolute path, as `admit()` gave it. */
  path: string
  name: string
  sha256: string
  size: number
  /** The MODELS row's label. */
  label: string
  /** The colour the MODELS row shows — written, not applied, when the user picked none. */
  colour: string
  /**
   * 2026-11-07 (D12) — `colour` is the one the open project assigned the model, not a colour by
   * position: written as `assigned: true`, and restored. Ignored when the user picked a colour.
   */
  assigned?: boolean
}

export interface ProjectContext {
  /** Where the project file is, or is about to be saved: what `relPath` is relative to. */
  projectPath: string
  /** `SGVue <version>`. */
  savedBy: string
  /** An ISO time. */
  savedAt: string
  /** The loaded models that have a file, in order; `m1`, `m2` … are given in this order. */
  models: readonly ProjectModelInfo[]
  /** The whole metres the scene stands off the files' own coordinates: world = scene + offset. */
  offset: readonly [number, number, number]
  /** A federation id's model key and GlobalId, or `null` when no loaded element has that id. */
  elementRef(id: number): { model: string; guid: string } | null
  /**
   * 2026-11-07 (phase 2) — the opened project's models that are **not** loaded (missing, refused,
   * changed), by their id in that file and the model key a restore gave them (`modelKeyOf` of the
   * file's name). Their ids are kept free, so `carryForward` can put their entries back under the
   * same id, and a rule, an eye or `active` that names one of those keys is written as that id —
   * the tag the file had. A key that is now loaded is the loaded model's.
   */
  carried?: readonly { id: string; key: string }[]
}

export interface ProjectWrite {
  project: ProjectFile
  /** What could not be written, by count — never in silence. */
  dropped: {
    /** Element references with no element, no GlobalId or no model with a file in the project. */
    elements: number
    /** Viewpoint cameras recorded in another frame, which point nowhere in this one. */
    cameras: number
    /** List entries and map keys past a bound. */
    items: number
  }
}

const clip = (s: string, max = MAX_TEXT): string => (s.length > max ? s.slice(0, max) : s)

/** The one order of element references: by model id, then by GlobalId. */
const byRef = (a: ProjectRef, b: ProjectRef): number =>
  a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1

/**
 * An empty map with no prototype, for every map keyed by text from a file — a storey's name, a
 * model key (a file's stem): a key `__proto__` is then an ordinary entry, never the prototype.
 */
const dict = <V>(): Record<string, V> => Object.create(null) as Record<string, V>
const isColour = (c: unknown): c is string => typeof c === 'string' && /^#(?:[0-9A-Fa-f]{3}){1,2}$/.test(c)


/**
 * Build the project file from a snapshot of the state (`ProjectSource`) and what only the live
 * app knows (`ProjectContext`). Pure; the result always passes `readProject`'s schema.
 */
export function projectOf(s: ProjectSource, ctx: ProjectContext): ProjectWrite {
  const dropped = { elements: 0, cameras: 0, items: 0 }
  const cap = <T>(xs: readonly T[], max: number): T[] => {
    if (xs.length > max) dropped.items += xs.length - max
    return xs.slice(0, max)
  }

  const idOf = new Map<string, string>()
  const models: ProjectModel[] = []
  // The carried models' ids stay theirs: a loaded model takes the next id that is free.
  const reserved = new Set((ctx.carried ?? []).map((c) => c.id))
  let nextId = 1
  const freeId = (): string => {
    while (reserved.has(`m${nextId}`)) nextId++
    return `m${nextId++}`
  }
  for (const m of ctx.models) {
    if (idOf.has(m.key)) continue
    const absPath = normaliseAbsolute(m.path)
    const usable =
      absPath !== null &&
      absPath.length <= MAX_PATH &&
      /^[0-9a-f]{64}$/.test(m.sha256) &&
      Number.isSafeInteger(m.size) &&
      m.size >= 0
    // A model the file cannot name — no absolute path, no digest — is left out, and so are its
    // elements' references; it is counted.
    if (!usable || models.length + reserved.size >= MAX_MODELS) {
      dropped.items++
      continue
    }
    const id = freeId()
    idOf.set(m.key, id)
    const own = s.modelColors[m.key]
    const assigned = !isColour(own) && m.assigned === true && isColour(m.colour)
    models.push({
      id,
      name: clip(m.name),
      relPath: relPathOf(ctx.projectPath, m.path),
      absPath,
      sha256: m.sha256,
      size: m.size,
      label: clip(m.label),
      colour: isColour(own) ? own : isColour(m.colour) ? m.colour : MC[0],
      own: isColour(own),
      ...(assigned ? { assigned: true } : {}),
      visible: s.modelVis[m.key] !== false
    })
  }
  for (const c of ctx.carried ?? []) if (!idOf.has(c.key)) idOf.set(c.key, c.id)

  const refsOf = (hidden: Record<number | string, boolean>): ProjectRef[] => {
    const seen = new Set<string>()
    const out: ProjectRef[] = []
    for (const [id, on] of Object.entries(hidden)) {
      if (!on) continue
      const ref = ctx.elementRef(Number(id))
      const m = ref ? idOf.get(ref.model) : undefined
      if (!ref || !m || !ref.guid || ref.guid.length > MAX_GUID) {
        dropped.elements++
        continue
      }
      const k = m + '\n' + ref.guid
      if (seen.has(k)) continue
      seen.add(k)
      out.push([m, ref.guid])
    }
    // Order-free: the same view writes the same file whatever order the ids came in.
    out.sort(byRef)
    return cap(out, MAX_REFS)
  }

  const rule = (r: Rule): ProjectRule => {
    // A `Model` rule on a model the file lists names it by id, tagged; any other value is literal.
    const named = r.prop === 'Model' && typeof r.val === 'string' ? idOf.get(r.val) : undefined
    return {
      prop: clip(r.prop),
      op: r.op,
      val:
        named !== undefined
          ? { model: named }
          : typeof r.val === 'string'
            ? clip(r.val)
            : typeof r.val === 'number' && !Number.isFinite(r.val)
              ? null
              : r.val,
      ...(r.join ? { join: r.join } : {})
    }
  }
  const stackOf = (st: readonly FilterStep[]): ProjectStep[] =>
    cap(st, MAX_STEPS).map((x) => ({
      id: clip(x.id, MAX_ID),
      on: x.on,
      action: x.action,
      ...(x.color !== undefined ? { color: clip(x.color, 32) } : {}),
      rules: cap(x.rules, MAX_RULES).map(rule)
    }))

  const storeys = (sv: Record<string, boolean>): Record<string, boolean> => {
    const out = dict<boolean>()
    let n = 0
    for (const [k, v] of Object.entries(sv)) {
      if (k.length > MAX_TEXT || n >= MAX_STOREYS) {
        dropped.items++
        continue
      }
      out[k] = v
      n++
    }
    return out
  }

  const o = ctx.offset
  const cameraOf = (c: SessionCamera | null): ProjectFile['view']['camera'] => {
    if (!c) return null
    const t = c.target
    const nums = [c.theta, c.phi, c.dist, c.half, t[0], t[1], t[2]]
    if (t.length !== 3 || !nums.every(Number.isFinite)) return null
    return {
      theta: c.theta,
      phi: c.phi,
      dist: c.dist,
      half: c.half,
      target: [t[0] + o[0], t[1] + o[1], t[2] + o[2]],
      proj: c.proj
    }
  }
  const world = (p: readonly number[]): [number, number, number] | null =>
    p.length === 3 && p.every(Number.isFinite) ? [p[0] + o[0], p[1] + o[1], p[2] + o[2]] : null

  const viewpoints = cap(s.views, MAX_VIEWPOINTS).map((v) => {
    const sameFrame = (v.frame ?? null) === IDENTITY_FRAME_KEY
    if (v.cam && !sameFrame) dropped.cameras++
    // A viewpoint's ids are read only in this build's own numbering (`ID_STRIDE`). Any other —
    // saved before 2026-10-09, or by a later build — is dropped and counted: a caller with such a
    // list renumbers it first, through the renderer's `viewpointHidden`.
    const current = idNumbering(v.idStride) === 'current'
    if (!current) dropped.elements += Object.values(v.hidden).filter(Boolean).length
    const modelVis = dict<boolean>()
    for (const [k, on] of Object.entries(v.modelVis)) {
      const m = idOf.get(k)
      if (m) modelVis[m] = on
    }
    return {
      id: Number.isFinite(v.id) ? v.id : 0,
      name: clip(v.name),
      sub: clip(v.sub),
      camera: sameFrame ? cameraOf(v.cam) : null,
      sections: sectionsOf(v) ?? NO_SECTIONS,
      hidden: current ? refsOf(v.hidden) : [],
      storeyVis: storeys(v.storeyVis),
      modelVis,
      stack: stackOf(v.stack),
      active: v.active !== null ? (idOf.get(v.active) ?? null) : null,
      grids: v.grids,
      levels: v.levels
    }
  })

  const measures = cap(s.measures, MAX_MARKUPS).flatMap((m) => {
    const at = world(m.p)
    if (!at) {
      dropped.items++
      return []
    }
    return [
      {
        at,
        ...(m.x !== undefined ? { x: m.x } : {}),
        ...(m.y !== undefined ? { y: m.y } : {}),
        ...(m.z !== undefined ? { z: m.z } : {}),
        sides: { ...m.sides },
        // Written only when it is one: a normal that is not a unit vector of finite numbers is
        // left out, and the measurement is restored as one with no face.
        ...(isUnitNormal(m.normal) ? { normal: [m.normal[0], m.normal[1], m.normal[2]] as [number, number, number] } : {})
      }
    ]
  })
  const spots = cap(s.spots, MAX_MARKUPS).flatMap((sp) => {
    const at = world(sp.p)
    if (!at) dropped.items++
    return at ? [{ at }] : []
  })

  const project: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedBy: clip(ctx.savedBy, 200),
    savedAt: clip(ctx.savedAt, 64),
    models,
    view: {
      camera: cameraOf(s.cam),
      preset: s.view !== null ? clip(s.view, 32) : null,
      sections: sectionsOf(s) ?? NO_SECTIONS,
      grids: s.grids,
      levels: s.levels,
      groundGrid: s.groundGrid,
      shadows: s.shadows,
      dims: s.dims,
      snap: s.snap,
      units: s.units,
      treeMode: s.treeMode,
      storeyVis: storeys(s.storeyVis),
      nativeMats: s.nativeMats
    },
    visibility: {
      hidden: refsOf(s.hidden),
      active: s.active !== null ? (idOf.get(s.active) ?? null) : null,
      stack: stackOf(s.stack)
    },
    viewpoints,
    filterSets: cap(s.filterSets, MAX_FILTER_SETS).map((f) => ({
      id: Number.isFinite(f.id) ? f.id : 0,
      label: clip(f.label),
      stack: stackOf(f.stack),
      ...(f.mode ? { mode: f.mode } : {}),
      ...(f.rules ? { rules: cap(f.rules, MAX_RULES).map(rule) } : {})
    })),
    schedules: {
      saved: cap(s.schedules, MAX_SCHEDULES).map((e) => ({
        name: clip(e.name, 200),
        def: e.def,
        savedAt: clip(e.savedAt, 64)
      })),
      open: s.openSchedule
    },
    markups: { spots, measures }
  }
  return { project, dropped }
}

/**
 * 2026-11-07 (phase 2) — **a project opened with models missing keeps them**: the entries of the
 * opened file's models named by `ids` that are not open now (missing, refused, changed — the
 * `carried` of `projectOf`'s context) are put back into a project just written, **exactly as the
 * opened file had them** — the entry (path, digest, size, label, colour and its flags, eye) and
 * every reference to one of their elements: in `hidden`, and in each viewpoint of the written
 * file that **is** one of the opened file's, with that viewpoint's eyes for them. The model stays
 * missing; its data survives the save. A model the written file already has (its id taken, or
 * loaded again) is not carried. Pure, and bounded as the writer is.
 *
 * Which written viewpoint is which opened one is `viewpointPairs`: written viewpoint id → index in
 * `opened.viewpoints` (2026-11-07, phase 3 — the project's viewpoints are its own list, and only
 * the caller knows which of them came from the file and are still that viewpoint; one deleted
 * and another saved under the same id is not). Omitted, a written viewpoint is paired with the
 * opened one of the same id — right only where ids are known to name one viewpoint each.
 */
export function carryForward(
  written: ProjectFile,
  opened: ProjectFile,
  ids: readonly string[],
  viewpointPairs?: ReadonlyMap<number, number>
): ProjectFile {
  const taken = new Set(written.models.map((m) => m.id))
  const want = new Set(ids)
  const room = Math.max(0, MAX_MODELS - written.models.length)
  const carried = opened.models.filter((m) => want.has(m.id) && !taken.has(m.id)).slice(0, room)
  if (!carried.length) return written
  const kept = new Set(carried.map((m) => m.id))
  const merge = (mine: readonly ProjectRef[], theirs: readonly ProjectRef[]): ProjectRef[] => {
    const out = [...mine, ...theirs.filter(([m]) => kept.has(m))] as ProjectRef[]
    out.sort(byRef)
    return out.slice(0, MAX_REFS)
  }
  const byId = new Map(opened.viewpoints.map((v) => [v.id, v]))
  const originOf = (id: number): ProjectFile['viewpoints'][number] | undefined => {
    if (!viewpointPairs) return byId.get(id)
    const at = viewpointPairs.get(id)
    return at !== undefined ? opened.viewpoints[at] : undefined
  }
  return {
    ...written,
    models: [...written.models, ...carried],
    visibility: { ...written.visibility, hidden: merge(written.visibility.hidden, opened.visibility.hidden) },
    viewpoints: written.viewpoints.map((v) => {
      const o = originOf(v.id)
      if (!o) return v
      const modelVis = dict<boolean>()
      for (const [m, on] of Object.entries(v.modelVis)) modelVis[m] = on
      for (const [m, on] of Object.entries(o.modelVis)) if (kept.has(m)) modelVis[m] = on
      return { ...v, hidden: merge(v.hidden, o.hidden), modelVis }
    })
  }
}

/* ────────────────────────────── the restore planner ────────────────────────────── */

/** What the planner needs of the live federation — `Federation` has it. */
export interface ProjectFederation {
  models: readonly { meta: { modelKey: string; sha256: string } }[]
  elements: readonly { id: number; guid: string; model: string }[]
}

export interface RestoreOptions {
  /**
   * Which live model each of the project's models was opened as: model id → model key. Phase 2
   * knows, because it opened the files. Without it a model is bound to the one live model with
   * its SHA-256, each live model to one project model at most.
   */
  bind?: ReadonlyMap<string, string>
  /** The live federation offset: scene = world − offset. `[0, 0, 0]` when omitted. */
  offset?: readonly [number, number, number]
}

/** A viewpoint as the renderer stores it, ids and keys the live federation's. */
export type RestoredViewpoint = Required<ProjectViewpoint>

/** The restored state: `ProjectSource`'s shape, every id, key and point the live federation's. */
export interface ProjectRestore extends Omit<ProjectSource, 'views' | 'spots' | 'measures'> {
  hidden: Record<string, boolean>
  /** 2026-11-07 (D12) — the colours the project assigned, by live key: `assigned: true` models. */
  assignedColors: Record<string, string>
  views: RestoredViewpoint[]
  spots: { p: [number, number, number] }[]
  measures: (ProjectMeasure & { p: [number, number, number] })[]
}

export interface RestorePlan {
  /** Model id → the live model key it is open under, for every model that is. */
  models: Record<string, string>
  /** The project's models that are not open, by id, in the file's order. */
  missing: string[]
  state: ProjectRestore
  /**
   * Per model id, the element references that named nothing live — the GlobalId is not in the
   * model that is open, or the model is not open at all: in `hidden`, and in the viewpoints'.
   * Only models with something unmatched are listed.
   */
  unmatched: Record<string, { hidden: number; viewpoints: number }>
}

/**
 * Map a project onto the live federation: every `[modelId, GlobalId]` to the ids the live
 * elements have, every model id to its live key, every world point to the scene. By GlobalId
 * alone — the plan is the same whatever order the models were opened in and whatever express ids
 * their elements have. A GlobalId two live elements share (a broken export) names both.
 */
export function restorePlanOf(
  project: ProjectFile,
  federation: ProjectFederation,
  opts: RestoreOptions = {}
): RestorePlan {
  const liveKeys = new Set(federation.models.map((m) => m.meta.modelKey))
  const keyOf = new Map<string, string>()
  if (opts.bind) {
    for (const m of project.models) {
      const k = opts.bind.get(m.id)
      if (k !== undefined && liveKeys.has(k)) keyOf.set(m.id, k)
    }
  } else {
    const taken = new Set<string>()
    for (const m of project.models) {
      const live = federation.models.find(
        (x) => x.meta.sha256 === m.sha256 && !taken.has(x.meta.modelKey)
      )
      if (!live) continue
      taken.add(live.meta.modelKey)
      keyOf.set(m.id, live.meta.modelKey)
    }
  }

  const boundKeys = new Set(keyOf.values())
  const byGuid = new Map<string, Map<string, number[]>>()
  for (const el of federation.elements) {
    if (!boundKeys.has(el.model) || !el.guid) continue
    let g = byGuid.get(el.model)
    if (!g) byGuid.set(el.model, (g = new Map()))
    const ids = g.get(el.guid)
    if (ids) ids.push(el.id)
    else g.set(el.guid, [el.id])
  }

  const unmatched = dict<{ hidden: number; viewpoints: number }>()
  const miss = (id: string, where: 'hidden' | 'viewpoints'): void => {
    const u = (unmatched[id] ??= { hidden: 0, viewpoints: 0 })
    u[where]++
  }
  const idsOf = (refs: readonly ProjectRef[], where: 'hidden' | 'viewpoints'): Record<string, boolean> => {
    const out = dict<boolean>()
    for (const [m, guid] of refs) {
      const key = keyOf.get(m)
      const ids = key !== undefined ? byGuid.get(key)?.get(guid) : undefined
      if (!ids) {
        miss(m, where)
        continue
      }
      for (const id of ids) out[id] = true
    }
    return out
  }

  // A tagged `Model` value becomes the key its model is open under — or, for a model that is not
  // open, the key its file will get (`modelKeyOf`, the app's own rule), so a model found later
  // with Locate… is the one the rule names.
  const nameOf = new Map(project.models.map((m) => [m.id, m.name]))
  const ruleOf = (r: FileRule): Rule => {
    if (r.val === null || typeof r.val !== 'object') return r as Rule
    const id = r.val.model
    return { ...r, val: keyOf.get(id) ?? modelKeyOf(nameOf.get(id) ?? id) }
  }
  const stackOf = (st: ParsedProject['visibility']['stack']): FilterStep[] =>
    st.map((x) => ({ ...x, rules: x.rules.map(ruleOf) }))
  const o = opts.offset ?? [0, 0, 0]
  const scene = (p: readonly [number, number, number]): [number, number, number] => [
    p[0] - o[0],
    p[1] - o[1],
    p[2] - o[2]
  ]
  const cameraOf = (c: ProjectFile['view']['camera']): SessionCamera | null =>
    c ? { ...c, target: scene(c.target) } : null
  const activeOf = (m: string | null): string | null => (m !== null ? (keyOf.get(m) ?? null) : null)

  const modelVis = dict<boolean>()
  const modelColors = dict<string>()
  const assignedColors = dict<string>()
  for (const m of project.models) {
    const k = keyOf.get(m.id)
    if (k === undefined) continue
    if (m.own) modelColors[k] = m.colour
    else if (m.assigned) assignedColors[k] = m.colour
    if (!m.visible) modelVis[k] = false
  }

  const v = project.view
  const views = project.viewpoints.map((vp): RestoredViewpoint => {
    const mv = dict<boolean>()
    for (const [m, on] of Object.entries(vp.modelVis)) {
      const k = keyOf.get(m)
      if (k !== undefined) mv[k] = on
    }
    return {
      id: vp.id,
      name: vp.name,
      sub: vp.sub,
      cam: cameraOf(vp.camera),
      section: legacySection(vp.sections),
      sections: vp.sections,
      hidden: idsOf(vp.hidden, 'viewpoints'),
      storeyVis: vp.storeyVis,
      modelVis: mv,
      stack: stackOf(vp.stack),
      active: activeOf(vp.active),
      grids: vp.grids,
      levels: vp.levels,
      frame: IDENTITY_FRAME_KEY,
      idStride: ID_STRIDE
    }
  })

  const state: ProjectRestore = {
    hidden: idsOf(project.visibility.hidden, 'hidden'),
    storeyVis: v.storeyVis,
    modelVis,
    active: activeOf(project.visibility.active),
    modelColors,
    assignedColors,
    nativeMats: v.nativeMats,
    treeMode: v.treeMode,
    grids: v.grids,
    levels: v.levels,
    groundGrid: v.groundGrid,
    shadows: v.shadows,
    snap: v.snap,
    dims: v.dims,
    sections: v.sections,
    stack: stackOf(project.visibility.stack),
    view: v.preset,
    units: v.units,
    cam: cameraOf(v.camera),
    views,
    filterSets: project.filterSets.map((f) => ({
      id: f.id,
      label: f.label,
      stack: stackOf(f.stack),
      ...(f.mode ? { mode: f.mode } : {}),
      ...(f.rules ? { rules: f.rules.map(ruleOf) } : {})
    })),
    schedules: project.schedules.saved.map((e) => ({ ...e, def: { ...e.def, name: e.name } })),
    openSchedule: project.schedules.open,
    spots: project.markups.spots.map((sp) => ({ p: scene(sp.at) })),
    measures: project.markups.measures.map(({ at, ...m }) => ({ ...m, p: scene(at) }))
  }

  return {
    models: Object.fromEntries(keyOf),
    missing: project.models.filter((m) => !keyOf.has(m.id)).map((m) => m.id),
    state,
    unmatched
  }
}
