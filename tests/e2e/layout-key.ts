/**
 * 2026-11-08 — the owner: *"Compare layout, not pixels."* What the trace's matrix shows, as a
 * key that says **which cells are drawn, where, and in which colour role** — and nothing about
 * how a rasteriser covered their corners.
 *
 * Under reduced motion the same Filter frame was read back twice with 160 solid pixels between
 * them: the anti-aliased corners of 80 rounded cells, covered differently by the GPU and the CPU
 * rasteriser (`docs/DECISIONS.md`). That is not a state anyone can see. So a picture is keyed by
 * its cells: each connected run of solid pixels (alpha ≥ 128) is one cell, known by its bounding
 * box — whose straight edges are fully covered whatever happens at its corners, so a corner pixel
 * that falls under or over the threshold never moves it — and by the colour of its **centre**
 * pixel, never an edge or a corner one. Under reduced motion no beam, ring or glow is drawn, and
 * cells stand at least one device pixel apart, so no two cells join.
 *
 * **Self-contained on purpose**: no import and no outside name, because it is also sent to the
 * page as source (`layoutKey.toString()`) and run there, on the canvas's own pixels. The unit test
 * `tests/unit/layout-key.test.ts` holds it to its promise: corners alone change nothing; a cell
 * moved, added or changed in colour role changes the key.
 */
export const layoutKey = (width: number, height: number, rgba: ArrayLike<number>): { key: string; cells: number; colours: string } => {
  const seen = new Uint8Array(width * height)
  const solid = (i: number): boolean => rgba[i * 4 + 3] >= 128
  const cells: string[] = []
  const byColour: Record<string, number> = {}
  const stack: number[] = []
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || !solid(start)) continue
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()!
      const x = i % width
      const y = (i - x) / width
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      const next = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]
      for (const j of next) {
        if (j >= 0 && !seen[j] && solid(j)) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    // The centre pixel's colour, to a sixteenth a channel: the cell's colour role.
    const c = (Math.floor((y0 + y1) / 2) * width + Math.floor((x0 + x1) / 2)) * 4
    const colour = (rgba[c] >> 4) + '.' + (rgba[c + 1] >> 4) + '.' + (rgba[c + 2] >> 4)
    byColour[colour] = (byColour[colour] || 0) + 1
    cells.push(x0 + ',' + y0 + ',' + (x1 - x0 + 1) + 'x' + (y1 - y0 + 1) + ',' + colour)
  }
  cells.sort()
  const colours = Object.keys(byColour)
    .sort()
    .map((k) => k + '×' + byColour[k])
    .join(' ')
  // Not the canvas's own size: a backing store reallocated for the same cells is no new state.
  return { key: cells.join(';'), cells: cells.length, colours }
}
