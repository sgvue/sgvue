/**
 * Every inline SVG the Phase 3 surfaces use, copied path for path from `SGVue.dc.html`.
 *
 * The design repeats the same glyph at two sizes and, occasionally, at two stroke weights
 * (the brand mark is 1.4/2.6 at 22 px and 1.3/2.3 at 34 px — BUILD_PLAN §5 "Logo"), so size
 * and weight are props and nothing else is.
 */
import { s } from './css'

interface SizeProps {
  size?: number
}

/**
 * The brand mark: cube outline, spoke, V. `SGVue.dc.html:66` at 22 px, `:738` at 34 px.
 * `flex:none` is mandatory — pitfall 5: without it a 22 px mark renders at 15 px, letterboxed.
 */
export function Logo({
  size = 22,
  outline = 1.4,
  vee = 2.6
}: {
  size?: number
  outline?: number
  vee?: number
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={s('flex:none')}
    >
      <path
        d="M12 2.6 20.2 7.3v9.4L12 21.4 3.8 16.7V7.3z"
        stroke="var(--muted)"
        strokeWidth={outline}
        strokeLinejoin="round"
      />
      <path d="M12 3.4v8.2" stroke="var(--muted)" strokeWidth={outline} strokeLinecap="round" />
      <path
        d="M3.8 7.3 12 21.4 20.2 7.3"
        stroke="var(--accent)"
        strokeWidth={vee}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** `SGVue.dc.html:78` — collapse the panel. */
export const ChevronLeft = ({ size = 16 }: SizeProps): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M15 6l-6 6 6 6" />
  </svg>
)

/** `SGVue.dc.html:212` — open the panel. */
export const ChevronRight = ({ size = 16 }: SizeProps): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
)

/** `SGVue.dc.html:96` (15 px) and `:197` (14 px). */
export const Eye = ({ size = 15 }: SizeProps): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

/** `SGVue.dc.html:97` (15 px) and `:198` (14 px). */
export const EyeOff = ({ size = 15 }: SizeProps): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 3l18 18M10.6 10.6A3 3 0 0 0 13.4 13.4M6.5 6.7C3.7 8.6 2 12 2 12s4 7 10 7c1.8 0 3.4-.4 4.8-1.1M9.9 5.2C10.6 5.1 11.3 5 12 5c6 0 10 7 10 7s-.9 1.6-2.5 3.2" />
  </svg>
)

/**
 * The × used at four sizes and three weights: `:90` (9 px / 2.6), `:106` (12 px / 2),
 * `:259` (13 px / 1.8), `:282` (14 px / 1.8).
 */
export const Cross = ({
  size = 12,
  weight = 2
}: {
  size?: number
  weight?: number
}): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={weight}
    strokeLinecap="round"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

/** `SGVue.dc.html:105` — the activate target; the inner disc fills only when active. */
export const Target = ({ dot }: { dot: string }): React.JSX.Element => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="2.6" fill={dot} stroke="none" />
  </svg>
)

/**
 * `SGVue.dc.html:620` — the filter step's own eye. Not `Eye`: its lid is drawn with different
 * control points (`3.8-6.5` against `4-7`) and its pupil is 2.6, not 3.
 */
export const StepEye = (): React.JSX.Element => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
)

/** `SGVue.dc.html:624` / `:625` — move a filter step earlier or later. */
export const MoveArrow = ({ up }: { up: boolean }): React.JSX.Element => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={up ? 'M6 14l6-6 6 6' : 'M6 10l6 6 6-6'} />
  </svg>
)

/** `SGVue.dc.html:297` — "Save current view". */
export const Plus = (): React.JSX.Element => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
)

/** `SGVue.dc.html:298` — the share-link chain. */
export const Link = (): React.JSX.Element => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
  >
    <path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.3" />
    <path d="M14 10.5a4 4 0 0 0-5.7 0L5.5 13.3a4 4 0 0 0 5.7 5.7l1.3-1.3" />
  </svg>
)

/** `SGVue.dc.html:180` — the group disclosure chevron, rotated by its parent. */
export const GroupChevron = (): React.JSX.Element => (
  <svg width="10" height="10" viewBox="0 0 10 10">
    <path
      d="M3 1l4 4-4 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** `SGVue.dc.html:129` — the upload row's "ready" tick. */
export const Tick = ({ size = 10 }: SizeProps): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 13l4.5 4.5L19 7" />
  </svg>
)

/** `SGVue.dc.html:129` — the upload row's error bang. */
export const Bang = ({ size = 10 }: SizeProps): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
  >
    <path d="M12 7v6M12 16.4v.2" />
  </svg>
)

/* ────────────────────────────── toolbar (`:224–253`) ────────────────────────────── */

const Tool = ({
  children,
  cap,
  join
}: {
  children: React.ReactNode
  cap?: boolean
  join?: boolean
}): React.JSX.Element => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    {...(cap ? { strokeLinecap: 'round' as const } : {})}
    {...(join ? { strokeLinejoin: 'round' as const } : {})}
  >
    {children}
  </svg>
)

/** `:224` Select. */
export const IconSelect = (): React.JSX.Element => (
  <Tool join>
    <path d="M5 3l7 17 2.4-6.6L21 11z" />
  </Tool>
)

/** `:225` Laser meter. */
export const IconMeasure = (): React.JSX.Element => (
  <Tool cap join>
    <path d="M3 21l10.5-10.5" />
    <circle cx="16.5" cy="7.5" r="3" />
    <path d="M16.5 2v1.8M16.5 11.2V13M11 7.5h1.8M20.2 7.5H22" />
    <path d="M3 21h3M3 21v-3" />
  </Tool>
)

/** `:226` Spot coordinate. */
export const IconSpot = (): React.JSX.Element => (
  <Tool cap>
    <circle cx="12" cy="12" r="6" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </Tool>
)

/** `:227` Snap. */
export const IconSnap = (): React.JSX.Element => (
  <Tool cap join>
    <path d="M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3z" />
    <path d="M6 7h4M14 7h4" />
  </Tool>
)

/** `:230` Section. */
export const IconSection = (): React.JSX.Element => (
  <Tool cap join>
    <path d="M4 4h16v16H4zM4 20L20 4" />
  </Tool>
)

/** `:231` Filter. */
export const IconFilter = (): React.JSX.Element => (
  <Tool join>
    <path d="M3 5h18l-7 8v6l-4 2v-8z" />
  </Tool>
)

/** `:232` Coordinate system. */
export const IconCoords = (): React.JSX.Element => (
  <Tool cap>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
  </Tool>
)

/**
 * 2026-09-25 — not in the design: the Schedules window's button. A table — header rule, two
 * row rules, one column rule — in the toolbar's own 16 px, 1.7-stroke `Tool` style.
 */
export const IconSchedules = (): React.JSX.Element => (
  <Tool cap join>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
  </Tool>
)

/** `:235` Gridlines. */
export const IconGrids = (): React.JSX.Element => (
  <Tool cap>
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
  </Tool>
)

/** `:236` Levels. */
export const IconLevels = (): React.JSX.Element => (
  <Tool join>
    <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />
  </Tool>
)

/**
 * The canvas (ground) grid toggle — not in the design (2026-09-24, owner-requested). A framed
 * 3 × 3 grid, so it reads apart from the IFC gridlines' open `#` beside it.
 */
export const IconGroundGrid = (): React.JSX.Element => (
  <Tool cap join>
    <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
    <path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" />
  </Tool>
)

/** `:239` Saved viewpoints. */
export const IconViews = (): React.JSX.Element => (
  <Tool cap join>
    <path d="M3 7.5h3.5l2-3h7l2 3H21V19H3z" />
    <circle cx="12" cy="13" r="3.2" />
  </Tool>
)

/** `:248` Shadows. */
export const IconShadows = (): React.JSX.Element => (
  <Tool cap join>
    <rect x="3.5" y="3.5" width="11" height="11" rx="1.5" />
    <path d="M8 19.5h12.5V7" />
    <path d="M11 17.5h7v-7" />
  </Tool>
)

/** `:251` Sun (shown while the theme is dark). */
export const IconSun = (): React.JSX.Element => (
  <Tool cap>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Tool>
)

/** `:252` Moon (shown while the theme is light). */
export const IconMoon = (): React.JSX.Element => (
  <Tool join>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </Tool>
)

/* ────────────────────────────── the assistant (`:430–540`) ──────────────────────────────
 * The design's sparkle (`:435` beside the title, `:537` on the pill) is not here: since
 * 2026-10-01 both places carry Vee, the assistant's pixel mascot (`app/Vee.tsx`). Nor is the
 * busy row's brand mark (`:502`, a cube outline breathing while its V traces itself): the same
 * day the busy row became the assistant's live reply (`app/Trace.tsx`), and Vee is what moves. */

/** `:447` — reply to this message. */
export const ReplyArrow = (): React.JSX.Element => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 7L4 12l5 5" />
    <path d="M4 12h9a7 7 0 0 1 7 7v1" />
  </svg>
)

/** `:448` — undo just this turn. */
export const Revert = (): React.JSX.Element => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 4.5V10H9" />
  </svg>
)

/** `:530` — send. */
export const SendArrow = (): React.JSX.Element => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 12h15" />
    <path d="M13 6l6 6-6 6" />
  </svg>
)
