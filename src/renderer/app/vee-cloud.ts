/**
 * The revision cloud around the selected storey row — 2026-11-08 ("Vee Messages", stage 1b),
 * from the approved prototype (`prototypes/vee-messages/full/index.html`, `cloudPath`): the
 * drawing office's mark for "this is what changed", here "this is what the 3D view selects".
 *
 * Pure: an SVG path of small arcs along the four sides of a `w` × `h` box, each side cut into as
 * many arcs of about `2r` as fit, bulging outwards. Measured from its row, and drawn again when
 * the row's box changes (`app/ChatPanel.tsx`, `Cloud`).
 */
export function cloudPath(w: number, h: number, r: number): string {
  if (!(w > 0) || !(h > 0) || !(r > 0)) return ''
  let d = 'M0 0'
  const sides: readonly (readonly [number, number, number, number])[] = [
    [0, 0, w, 0],
    [w, 0, w, h],
    [w, h, 0, h],
    [0, h, 0, 0]
  ]
  for (const [x1, y1, x2, y2] of sides) {
    const len = Math.hypot(x2 - x1, y2 - y1)
    const n = Math.max(1, Math.round(len / (r * 2)))
    const rr = (len / n / 2 + 0.01).toFixed(2)
    for (let i = 1; i <= n; i++) {
      d += ` A${rr} ${rr} 0 0 1 ${(x1 + ((x2 - x1) * i) / n).toFixed(2)} ${(y1 + ((y2 - y1) * i) / n).toFixed(2)}`
    }
  }
  return d
}
