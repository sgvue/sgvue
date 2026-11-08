/**
 * The MODELS list — `SGVue.dc.html:1796–1815`, as pure functions. (The design's `library`
 * popover, `:1815`, is not in the port since 2026-11-08.)
 *
 * One thing the design gets for free and the port does not: its rows come from a fixed
 * `SAMPLE_FILES` table, so every model already has a `swatch`. A real IFC file declares no
 * such colour. The row still needs one — it is the button that opens the override palette —
 * so a model with no library entry takes `MC[slot]`, the design's own model-override palette,
 * by its federation slot. The slot is stable for as long as the model is loaded, so the
 * colour does not move when another model is unloaded.
 */
import { MC } from '../../../shared/colors'
import type { Federation } from '../../../shared/federate'
import type { LibraryFile } from '../shell'

export interface ModelRow {
  key: string
  name: string
  file: string
  /**
   * The file's full path, for the name block's hover `title` (2026-10-01, owner-requested) —
   * the path the federation holds for this model. `''` for a model with no file behind it (the
   * demo building, the `#mock` federation), and then there is no `title`: never a placeholder.
   */
  path: string
  count: number
  vis: boolean
  hid: boolean
  opacity: number
  canRemove: boolean
  edge: string
  bg: string
  actFg: string
  actDot: string
  active: boolean
  swatch: string
  swatchRing: string
  paletteOpen: boolean
  confirmOpen: boolean
  colors: { c: string; ring: string }[]
}

export interface ModelInput {
  federation: Federation
  /**
   * 2026-11-07 (plan D12) — colours given to models added to an open project (the store's
   * `assignedColors`). Absent or empty — no project open — and every row is what it was.
   */
  assigned?: Record<string, string>
  /** Each loaded model's file, by model key — `federation-store.ts`'s `sessionFiles()`. */
  files: ModelFiles
  library: readonly LibraryFile[]
  modelVis: Record<string, boolean>
  modelColors: Record<string, string>
  nativeMats: boolean
  uploadNames: Record<string, string>
  active: string | null
  palette: string | null
  confirmRemove: string | null
}

/** Each loaded model's file, by model key — `federation-store.ts`'s `sessionFiles()`. */
export type ModelFiles = readonly { key: string; path: string }[]

/**
 * The library entry a loaded model came from. A real entry is a recent (`upload-pipeline.ts`
 * `libraryOf`), keyed by the file's **path**, while the model is keyed by `modelKeyOf(name)` —
 * so a model with a file behind it is matched by the path the federation holds for it
 * (`sessionFiles()`), as `modelRows`' `path` is, and never by its name. The design's own
 * entries (`#mock`'s `SAMPLE_FILES`) have no path and their key is the model key.
 */
export function libraryEntry(
  key: string,
  path: string | undefined,
  library: readonly LibraryFile[]
): LibraryFile | undefined {
  return (path ? library.find((f) => f.path === path) : undefined) ?? library.find((f) => f.key === key)
}

/** The path the federation holds for a model, `undefined` for one with no file behind it. */
export const pathOf = (key: string, files: ModelFiles): string | undefined =>
  files.find((f) => f.key === key)?.path

/**
 * The swatch a model shows before any override: the colour an open project gave it (D12), else
 * its library colour, else `MC[slot]`.
 *
 * 2026-11-07 — where the assigned colour sits: **under the user's override and over the
 * library's**. Under the override, because an override is the user's own pick and always wins.
 * Over the library swatch and the slot's, because those are colours by position — the Recent
 * list's order, the federation slot — which move when the recents or the load order do, and an
 * assigned colour exists to stay put. A model that was never assigned one has no entry here, so
 * it falls through exactly as before — to the grey `MC[0]` too, which keeps its cut in the accent.
 */
export function baseSwatch(
  key: string,
  slot: number,
  library: readonly LibraryFile[],
  path?: string,
  assigned: Record<string, string> = {}
): string {
  return (Object.hasOwn(assigned, key) ? assigned[key] : undefined) ?? libraryEntry(key, path, library)?.swatch ?? MC[slot % MC.length]
}

/**
 * The swatch a model's row shows: the user's override, else `baseSwatch`. The one rule for that
 * colour — the row reads it, and so does the section cut (`modelSwatches`). It does not depend
 * on "Original materials": the row shows the colour either way.
 */
export function rowSwatch(
  key: string,
  slot: number,
  library: readonly LibraryFile[],
  modelColors: Record<string, string>,
  path?: string,
  assigned: Record<string, string> = {}
): string {
  return modelColors[key] || baseSwatch(key, slot, library, path, assigned)
}

/**
 * The colour a model's section-cut outline is drawn in (2026-11-07): its row's swatch when that
 * is a colour of its own — the user's override, a library swatch, or a palette colour other than
 * the design's neutral grey `MC[0]` — else `null`, and the viewer draws that model's outline in
 * the theme's accent. The owner, of a single real model whose row shows the grey: *"Yes, keep
 * accent"*. Decided by where the colour came from, never by comparing hex: a grey the user
 * picked is their own and stays grey.
 */
export function cutSwatch(
  key: string,
  slot: number,
  library: readonly LibraryFile[],
  modelColors: Record<string, string>,
  path?: string,
  assigned: Record<string, string> = {}
): string | null {
  if (modelColors[key]) return modelColors[key]
  // An assigned colour (D12) is one the model was given, so it is its own — never the grey,
  // which the project's palette leaves out (`model/project.ts`, `ASSIGN_PALETTE`).
  if (Object.hasOwn(assigned, key)) return assigned[key]
  const lib = libraryEntry(key, path, library)?.swatch
  if (lib) return lib
  const i = slot % MC.length
  return i === 0 ? null : MC[i]
}

/**
 * Every loaded model's cut colour, by model key (2026-11-07, owner-requested): what the viewer
 * draws each model's section-cut outline in (`viewer.setCutColors`). A model whose row shows
 * the neutral grey — no colour of its own (`cutSwatch`) — is left out, so the viewer draws it
 * in the accent, re-read at each theme change.
 */
export function modelSwatches(
  federation: Pick<Federation, 'models'>,
  library: readonly LibraryFile[],
  modelColors: Record<string, string>,
  files: ModelFiles = [],
  assigned: Record<string, string> = {}
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of federation.models) {
    const key = m.meta.modelKey
    const c = cutSwatch(key, m.slot, library, modelColors, pathOf(key, files), assigned)
    if (c) out[key] = c
  }
  return out
}

const stem = (file: string): string => file.replace(/\.[^.]+$/, '')

/**
 * The name on a model row: the upload's own file name without its extension, else the library
 * entry's label, else the loaded file's name without its extension. `SGVue.dc.html:1802` does
 * the first two; the third is the same rule applied to a file that came from neither, and is
 * deliberately **not** the `IfcProject` name — that is already the header two rows above, and
 * on a real export it is the project number, which says nothing about which file this is.
 */
export function modelLabel(
  key: string,
  fileName: string,
  library: readonly LibraryFile[],
  uploadName?: string
): string {
  if (uploadName) return stem(uploadName)
  return library.find((f) => f.key === key)?.name ?? stem(fileName) ?? key
}

/**
 * The file line under a model row's name — `SGVue.dc.html:1802`'s `file`: the upload's own file
 * name, else the library entry's, else the loaded file's. (2026-10-08: the Coordinate-system
 * card's note names a model by it too.)
 */
export function modelFile(
  key: string,
  fileName: string,
  library: readonly LibraryFile[],
  uploadName?: string
): string {
  return uploadName || (library.find((f) => f.key === key)?.file ?? fileName)
}

export function modelRows(input: ModelInput): ModelRow[] {
  const { federation, files, library, modelVis, modelColors, nativeMats, uploadNames, assigned = {} } = input
  const counts = new Map<string, number>()
  for (const e of federation.elements) counts.set(e.model, (counts.get(e.model) ?? 0) + 1)
  const loaded = federation.models.length

  return federation.models.map((m) => {
    const key = m.meta.modelKey
    const ov = modelColors[key] || null
    const live = !!ov && !nativeMats
    const act = input.active === key
    const up = uploadNames[key]
    const path = pathOf(key, files)
    return {
      key,
      name: modelLabel(key, m.meta.fileName, library, up),
      file: modelFile(key, m.meta.fileName, library, up),
      path: path ?? '',
      count: counts.get(key) ?? 0,
      vis: modelVis[key] !== false,
      hid: modelVis[key] === false,
      opacity: modelVis[key] !== false ? 1 : 0.5,
      canRemove: loaded > 1,
      edge: act ? 'var(--accent)' : 'transparent',
      bg: act ? 'var(--sel-bg)' : 'transparent',
      actFg: act ? 'var(--sel-ink)' : 'var(--faint)',
      actDot: act ? 'currentColor' : 'none',
      active: act,
      swatch: rowSwatch(key, m.slot, library, modelColors, path, assigned),
      swatchRing: live ? '0 0 0 1.5px var(--accent)' : 'none',
      paletteOpen: input.palette === key,
      confirmOpen: input.confirmRemove === key,
      colors: MC.map((c) => ({
        c,
        ring: c === ov ? '0 0 0 2px var(--card),0 0 0 3.5px var(--accent)' : 'none'
      }))
    }
  })
}

/**
 * Activate mode's pick rule: only the active model's elements can be picked, and with no
 * model active, everything (`null`). One definition for every `viewer.setPickable` call.
 */
export const pickableFor = (
  active: string | null | undefined
): ((e: { model: string }) => boolean) | null => (active ? (e) => e.model === active : null)
