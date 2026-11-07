/**
 * The upload pipeline's arithmetic — `SGVue.dc.html:1152–1200`, as pure functions.
 *
 * The design's rows are driven by a timer: five stages, each `420 + random×360` ms apart, then
 * a 420 ms pause and a 1 100 ms "ready" hold. Ours are driven by a **real** worker whose stages
 * take whatever they take — 5.2 s of parsing on a 138 MB file, 40 ms on a small one. Two rules
 * reconcile the two, and `stageStep` below is both of them:
 *
 * · a stage may never be shown **ahead of** real progress — the row would claim work that has
 *   not happened;
 * · a stage may never be shown **for less than** the design's minimum — five stages flashing
 *   past in 90 ms is not the animation that was designed.
 *
 * Everything else here is copy and labels, kept verbatim so the reviewer can diff them.
 */

/** `SGVue.dc.html:1155`. 600 MB, in bytes, as the design writes it. */
export const MAX_FILE_BYTES = 600 * 1024 * 1024

/**
 * 2026-10-09 — the design's `larger than 600 MB`, and then what to do about it. The owner: *"add
 * consider splitting into multiple models message for files over 600mb."* One string, so every
 * route that refuses a file for its size says the same — the drop, the Open dialog, a Recent
 * pill, a share link — and `.ifczip`'s own refusal ends with it too (`worker/ifczip.ts`).
 */
export const TOO_LARGE = 'larger than 600 MB — consider splitting it into several models'

/**
 * `SGVue.dc.html:1155`, verbatim — including the extensions the drop zone advertises — but for
 * the size reason, which carries the advice above (2026-10-09).
 *
 * `.ifcxml` is accepted by the extension test and then refused with its own reason: the design
 * offers it, and a silent "not an IFC file" for a file whose extension the zone lists would be
 * a worse answer than saying what is actually true.
 */
export type RejectReason =
  | 'not an IFC file'
  | 'file is empty'
  | typeof TOO_LARGE
  | 'ifcXML is not supported'

export function validate(name: string, size: number): RejectReason | null {
  if (!/\.(ifc|ifcxml|ifczip)$/i.test(name)) return 'not an IFC file'
  if (size === 0) return 'file is empty'
  if (size > MAX_FILE_BYTES) return TOO_LARGE
  if (/\.ifcxml$/i.test(name)) return 'ifcXML is not supported'
  return null
}

/** `SGVue.dc.html:1158`. One upload starts every 500 ms, in the order they were chosen. */
export const STAGGER_MS = 500

/** `SGVue.dc.html:1177`. The first stage row appears a beat after the upload is queued. */
export const FIRST_TICK_MS = 240

/**
 * `SGVue.dc.html:1173` — the five stages and their percentages, in order.
 *
 * The copy is the design's. What it maps onto is the real pipeline: `reading file` is the
 * worker reading the Blob, `parsing entities` web-ifc's open, `building geometry` the geometry
 * stream, `indexing properties` the index build, `federating` the batch join.
 */
export const STAGES: readonly (readonly [number, string])[] = [
  [16, 'reading file'],
  [38, 'parsing entities'],
  [64, 'building geometry'],
  [86, 'indexing properties'],
  [100, 'federating']
]

/**
 * `SGVue.dc.html:1177` — `420 + Math.random() * 360`. The **minimum** of that range is the
 * floor a real stage may not beat; the design's own upper end is not reproduced, because a
 * real stage that takes longer already takes longer.
 */
export const MIN_STAGE_MS = 420

/** `SGVue.dc.html:1192`. The green tick holds before the model joins the federation. */
export const READY_HOLD_MS = 1100

/** `SGVue.dc.html:1179`. The row starts at 5 %, on `reading file`, before the first tick. */
export const START_PCT = 5

export interface StageStepInput {
  /** The stage index currently on screen, 0-based. */
  shown: number
  /** The furthest stage the **real** pipeline has reached, 0-based. */
  real: number
  /** Milliseconds the shown stage has been on screen. */
  elapsedMs: number
}

/**
 * Which stage index to display now: at most one step forward, never past real progress, never
 * before the shown stage has had its minimum. Pure, so both rules are one assertion each.
 */
export function stageStep(input: StageStepInput): number {
  const { shown, real, elapsedMs } = input
  if (shown >= STAGES.length - 1) return shown
  if (shown >= real) return shown
  if (elapsedMs < MIN_STAGE_MS) return shown
  return shown + 1
}

/**
 * How long to wait before the next stage may be shown, given how long the current one has been
 * up. Zero when it is already due. The pipeline uses this as its timer delay, so a real stage
 * that finishes early still holds for `MIN_STAGE_MS`.
 */
export const stageWait = (elapsedMs: number): number => Math.max(0, MIN_STAGE_MS - elapsedMs)

/* ────────────────────────────── labels ────────────────────────────── */

/** `SGVue.dc.html:1179`. Kilobytes, rounded, at least 1 — `null` for a size of 0. */
export const kbOf = (bytes: number): number | null =>
  bytes ? Math.max(1, Math.round(bytes / 1024)) : null

/** `SGVue.dc.html:1927`. `1 234 KB` under a megabyte, `1.2 MB` over it. */
export const sizeLabel = (kb: number | null | undefined): string =>
  kb ? (kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB') : ''

/** `SGVue.dc.html:1938`. Counts up to six are words; anything larger is the number. */
export const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'] as const

export const countWord = (n: number): string => COUNT_WORDS[n] ?? String(n)

/** `SGVue.dc.html:1938`, verbatim, including the trailing arrow. */
export const openAllLabel = (n: number): string =>
  `open all ${countWord(n)} as a federation →`

/** `SGVue.dc.html:1928`. Anything not finished and not rejected is busy. */
export const isBusy = (u: { done?: boolean; error?: boolean }): boolean => !u.done && !u.error

/** `SGVue.dc.html:1929–1931`. The three colours a row takes. */
export const barColor = (done?: boolean): string => (done ? 'var(--ok-ink)' : 'var(--accent)')

export const stageColor = (u: { done?: boolean; error?: boolean }): string =>
  u.error ? 'var(--warn-ink)' : u.done ? 'var(--ok-ink)' : 'var(--faint)'

/** `SGVue.dc.html:1928`. A rejected row prints no percentage. */
export const pctLabel = (u: { error?: boolean; pct: number }): string =>
  u.error ? '' : u.pct + '%'

/**
 * `SGVue.dc.html:1166`. `'u'`/`'e'` plus a timestamp and three random characters — the
 * design's own id shape, which is what keeps two rows queued in the same millisecond apart.
 */
export const uploadId = (prefix: 'u' | 'e'): string =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
