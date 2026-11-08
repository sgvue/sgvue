/**
 * The Ask Vee window's own icons — 2026-11-08, "Vee Messages", drawn from the approved prototype
 * (`prototypes/vee-messages/full/index.html`). Each is decorative (`aria-hidden`): the text or
 * the control's own label beside it says what it means.
 */

const line = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

/** A user's message was sent: one tick. */
export const TickOne = (): React.JSX.Element => (
  <svg width="11" height="8" viewBox="0 0 11 8" strokeWidth="1.5" aria-hidden="true" {...line}>
    <path d="M1 4.2 3.6 6.8 10 1" />
  </svg>
)

/** …and Vee picked it up: two. */
export const TickTwo = (): React.JSX.Element => (
  <svg width="15" height="8" viewBox="0 0 15 8" strokeWidth="1.5" aria-hidden="true" {...line}>
    <path d="M1 4.2 3.6 6.8 10 1" />
    <path d="M7.6 6.6 14 1" />
  </svg>
)

/** A storey row selects in 3D. */
export const Crosshair = (): React.JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true" {...line}>
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </svg>
)

/** A reply: the hover bar's one action. */
export const ReplyHook = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 24 24" strokeWidth="2.2" aria-hidden="true" {...line}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 6 6v4" />
  </svg>
)

/** Revert, on a stamp or at a reply's foot. */
export const RevertHook = (): React.JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true" {...line}>
    <path d="M4 8h10.5a5.5 5.5 0 0 1 0 11H8" />
    <path d="M8 4 4 8l4 4" />
  </svg>
)

/** A stopped turn. */
export const StopCross = (): React.JSX.Element => (
  <svg width="8" height="8" viewBox="0 0 24 24" strokeWidth="3" aria-hidden="true" {...line}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

/** A turn that never reached Vee. */
export const NoSignal = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true" {...line}>
    <path d="M2 8.8a15 15 0 0 1 20 0M5.5 12.4a10 10 0 0 1 9-2.6M8.9 16a5 5 0 0 1 4.6-1.2M12 19.5h.01M3 3l18 18" />
  </svg>
)

/** The new-message pill: down to the foot. */
export const DownArrow = (): React.JSX.Element => (
  <svg width="11" height="11" viewBox="0 0 24 24" strokeWidth="2.4" aria-hidden="true" {...line}>
    <path d="M12 5v14M5.5 12.5 12 19l6.5-6.5" />
  </svg>
)

/** The board: everything shown. */
export const BoardEye = (): React.JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true" {...line}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

/** The board: not everything shown — isolated. */
export const BoardEyeOff = (): React.JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true" {...line}>
    <path d="M2 12s3.6-7 10-7c2 0 3.7.7 5.1 1.6M22 12s-3.6 7-10 7c-2 0-3.7-.7-5.1-1.6" />
    <path d="M3 3l18 18" />
  </svg>
)

/** The composer's send key. */
export const SendUp = (): React.JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth="2.2" aria-hidden="true" {...line}>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </svg>
)

/** 2026-11-08 (stage 1b) — the folded diary opens: its chevron turns a quarter. */
export const Chevron = (): React.JSX.Element => (
  <svg className="vm-cv" width="9" height="9" viewBox="0 0 24 24" strokeWidth="2.6" aria-hidden="true" {...line}>
    <path d="M9 5l7 7-7 7" />
  </svg>
)

/** 2026-11-08, stage 2 — the heads-up line's 12 px outline warning sign, in the line's own amber. */
export const WarnSign = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 24 24" strokeWidth="2.2" aria-hidden="true" {...line}>
    <path d="M12 3 2 20h20L12 3z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </svg>
)
