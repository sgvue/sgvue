/**
 * What one element's geometry amounts to — its box and how many parts it is made of — from
 * the chunks the worker already streamed.
 *
 * `IfcElement.bbox` is declared in the **project frame**, metres, Z-up, with the federation
 * offset *not* subtracted (`shared/model-index.types.ts`). The geometry stream already
 * computes exactly that box per **part** — `PartRecord.bbox6`, the AABB of the transformed
 * local AABB — in the same frame minus the offset. So the box half of this file is: union the
 * parts of one element, and add the offset back. `IfcElement.solidCount` is the other half and
 * falls out of the same walk: it is the number of parts, which is what
 * `viewer.solidCount(id)` counts (`viewer/batches.ts` does `rec.solidCount++` once per part,
 * across both families and every chunk) and therefore what the property card already shows.
 *
 * Why here and not in the worker: the chunks are in the renderer's hand already
 * (`FederationController.prepare` holds them for `addBatch`), so this costs one pass over the
 * parts and no transfer, no new field on the geometry contract and no second producer of a
 * frame. It is also pure — chunks and an offset in, a map out — so it is checked on numbers
 * with no worker, no store and no GPU.
 *
 * **The box is an approximation, and a conservative one.** A part's `bbox6` is the AABB of its
 * *transformed local* AABB rather than of its transformed vertices, so a part whose placement
 * rotates it about anything but `+Z` reports a box at least as large as the exact one. That is
 * the same box the picker filters with and the same one the property card's "Box volume" row
 * reports; every consumer says it is box arithmetic.
 */
import type { FederationOffset, GeometryChunk } from '../../shared/geometry-contract.types'

/** `[minX, minY, minZ, maxX, maxY, maxZ]`, project-frame metres, Z-up. */
export type Box6 = [number, number, number, number, number, number]

/** One element's geometry, as the index records it. */
export interface ElementGeometry {
  box: Box6
  /**
   * Tessellated parts the stream produced for this element, **both families** — a window's
   * opaque frame and its glass pane are two parts and count two, exactly as `batches.ts`
   * counts them, because the two are split only by the file's own alpha after this point.
   * It is not a count of IFC representation items.
   */
  parts: number
}

/**
 * Summarise every element of one model's chunks: the union of its part boxes, and how many
 * parts it has.
 *
 * The key is `PartRecord.elementId`, which is the element's **model-local** id — exactly
 * `IfcElement.id` before the federation offsets it, which is what makes the result assignable
 * straight onto the index. An element with no part is simply absent: no geometry, no box and
 * no count, never a placeholder.
 */
export function elementBoxes(
  chunks: readonly GeometryChunk[],
  offset: FederationOffset
): Map<number, ElementGeometry> {
  const [ox, oy, oz] = offset
  const out = new Map<number, ElementGeometry>()
  for (const chunk of chunks) {
    for (const part of chunk.parts) {
      const b = part.bbox6
      const known = out.get(part.elementId)
      if (!known) {
        out.set(part.elementId, {
          box: [b[0] + ox, b[1] + oy, b[2] + oz, b[3] + ox, b[4] + oy, b[5] + oz],
          parts: 1
        })
        continue
      }
      const grown = known.box
      if (b[0] + ox < grown[0]) grown[0] = b[0] + ox
      if (b[1] + oy < grown[1]) grown[1] = b[1] + oy
      if (b[2] + oz < grown[2]) grown[2] = b[2] + oz
      if (b[3] + ox > grown[3]) grown[3] = b[3] + ox
      if (b[4] + oy > grown[4]) grown[4] = b[4] + oy
      if (b[5] + oz > grown[5]) grown[5] = b[5] + oz
      known.parts++
    }
  }
  return out
}
