/**
 * The MODELS list and the `library` popover — `SGVue.dc.html:1796–1815`, as pure functions.
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
  /** Each loaded model's file, by model key — `federation-store.ts`'s `sessionFiles()`. */
  files: readonly { key: string; path: string }[]
  library: readonly LibraryFile[]
  modelVis: Record<string, boolean>
  modelColors: Record<string, string>
  nativeMats: boolean
  uploadNames: Record<string, string>
  active: string | null
  palette: string | null
  confirmRemove: string | null
}

/** The swatch a model shows before any override: its library colour, else `MC[slot]`. */
export function baseSwatch(
  key: string,
  slot: number,
  library: readonly LibraryFile[]
): string {
  return library.find((f) => f.key === key)?.swatch ?? MC[slot % MC.length]
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
  const { federation, files, library, modelVis, modelColors, nativeMats, uploadNames } = input
  const counts = new Map<string, number>()
  for (const e of federation.elements) counts.set(e.model, (counts.get(e.model) ?? 0) + 1)
  const loaded = federation.models.length

  return federation.models.map((m) => {
    const key = m.meta.modelKey
    const ov = modelColors[key] || null
    const live = !!ov && !nativeMats
    const act = input.active === key
    const up = uploadNames[key]
    return {
      key,
      name: modelLabel(key, m.meta.fileName, library, up),
      file: modelFile(key, m.meta.fileName, library, up),
      path: files.find((f) => f.key === key)?.path ?? '',
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
      swatch: ov || baseSwatch(key, m.slot, library),
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

/** What the `library` popover offers: every library file that is not already loaded. `:1815`. */
export function addableRows(
  library: readonly LibraryFile[],
  loaded: readonly string[]
): LibraryFile[] {
  return library.filter((f) => !loaded.includes(f.key))
}

/**
 * Activate mode's pick rule: only the active model's elements can be picked, and with no
 * model active, everything (`null`). One definition for every `viewer.setPickable` call.
 */
export const pickableFor = (
  active: string | null | undefined
): ((e: { model: string }) => boolean) | null => (active ? (e) => e.model === active : null)
