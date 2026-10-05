/**
 * The geometry contract, as checkable assertions.
 *
 * Not a test on its own: it is imported by `mock-adapter.test.ts` and by
 * `geometry-streamer.fixture.test.ts` so the design-parity mock and the real worker are held
 * to **one** definition of a valid chunk. If the two ever drift, every parity screenshot
 * from then on is comparing different things.
 *
 * Returns a list of problems rather than throwing, so a failing test names all of them at
 * once instead of the first.
 */
import type { GeometryChunk } from '../../src/shared/geometry-contract.types'

const finite = (values: readonly number[]): boolean => values.every((v) => Number.isFinite(v))

/** Everything that must be true of one chunk. An empty result means it is well-formed. */
export function checkGeometryChunk(chunk: GeometryChunk): string[] {
  const problems: string[] = []
  const say = (message: string): number => problems.push(`chunk ${chunk.header.index}: ${message}`)

  const { header, positions, normals, indices, edges, geoms, parts } = chunk

  if (!header.modelKey) say('header has no modelKey')
  if (!(header.total >= 1)) say(`header.total ${header.total} < 1`)
  if (header.index < 0 || header.index > header.total) {
    say(`header.index ${header.index} outside 0..${header.total}`)
  }

  const vertexCount = positions.length / 3
  if (positions.length % 3 !== 0) say(`positions ${positions.length} is not a multiple of 3`)
  if (normals.length !== positions.length) {
    say(`normals ${normals.length} ≠ positions ${positions.length}`)
  }
  // Two vertices, six floats, per line segment.
  if (edges.length % 6 !== 0) say(`edges ${edges.length} is not a multiple of 6`)

  if (!geoms.length) say('no geometries')
  if (!parts.length) say('no parts')

  const seen = new Set<number>()
  let vertexCursor = 0
  let indexCursor = 0
  let edgeCursor = 0
  for (const geom of geoms) {
    if (seen.has(geom.geometryExpressId)) {
      say(`geometry ${geom.geometryExpressId} appears twice — dedupe is per chunk`)
    }
    seen.add(geom.geometryExpressId)
    // Geometries are laid down back to back, which is what lets the renderer slice the
    // buffers without a copy.
    if (geom.vertexOffset !== vertexCursor) {
      say(`geometry ${geom.geometryExpressId} vertexOffset ${geom.vertexOffset} ≠ ${vertexCursor}`)
    }
    if (geom.indexOffset !== indexCursor) {
      say(`geometry ${geom.geometryExpressId} indexOffset ${geom.indexOffset} ≠ ${indexCursor}`)
    }
    if (geom.edgeCount > 0 && geom.edgeOffset !== edgeCursor) {
      say(`geometry ${geom.geometryExpressId} edgeOffset ${geom.edgeOffset} ≠ ${edgeCursor}`)
    }
    if (geom.edgeCount === 0 && geom.edgeOffset !== -1) {
      say(`geometry ${geom.geometryExpressId} has no edges but edgeOffset ${geom.edgeOffset}`)
    }
    if (geom.vertexCount <= 0) say(`geometry ${geom.geometryExpressId} has no vertices`)
    if (geom.indexCount % 3 !== 0) {
      say(`geometry ${geom.geometryExpressId} indexCount ${geom.indexCount} is not triangles`)
    }
    if (geom.edgeCount % 2 !== 0) {
      say(`geometry ${geom.geometryExpressId} edgeCount ${geom.edgeCount} is not vertex pairs`)
    }
    vertexCursor += geom.vertexCount
    indexCursor += geom.indexCount
    edgeCursor += geom.edgeCount

    // Indices are chunk-relative and must stay inside their own geometry's vertices.
    for (let i = geom.indexOffset; i < geom.indexOffset + geom.indexCount; i++) {
      const index = indices[i]
      if (index < geom.vertexOffset || index >= geom.vertexOffset + geom.vertexCount) {
        say(`geometry ${geom.geometryExpressId} index ${index} outside its own vertices`)
        break
      }
    }
  }
  if (vertexCursor !== vertexCount) say(`geoms cover ${vertexCursor} of ${vertexCount} vertices`)
  if (indexCursor !== indices.length) {
    say(`geoms cover ${indexCursor} of ${indices.length} indices`)
  }
  if (edgeCursor !== edges.length / 3) {
    say(`geoms cover ${edgeCursor} of ${edges.length / 3} edge vertices`)
  }

  for (const part of parts) {
    if (!Number.isInteger(part.elementId) || part.elementId <= 0) {
      say(`part elementId ${part.elementId} is not an expressId`)
    }
    if (part.geomIdx < 0 || part.geomIdx >= geoms.length) {
      say(`part geomIdx ${part.geomIdx} outside 0..${geoms.length - 1}`)
    }
    if (part.matrix16.length !== 16 || !finite(part.matrix16)) {
      say(`part ${part.elementId} matrix16 is not 16 finite numbers`)
    }
    if (part.rgba.length !== 4 || part.rgba.some((c) => !(c >= 0 && c <= 1))) {
      say(`part ${part.elementId} rgba ${part.rgba.join(',')} is outside 0..1`)
    }
    const b = part.bbox6
    if (b.length !== 6 || !finite(b)) {
      say(`part ${part.elementId} bbox6 is not 6 finite numbers`)
    } else if (b[0] > b[3] || b[1] > b[4] || b[2] > b[5]) {
      say(`part ${part.elementId} bbox6 min > max`)
    }
  }

  return problems
}

/** The same, across a model's whole stream. */
export function checkGeometryChunks(chunks: readonly GeometryChunk[]): string[] {
  const problems = chunks.flatMap(checkGeometryChunk)
  const keys = new Set(chunks.map((c) => c.header.modelKey))
  if (keys.size > 1) problems.push(`chunks span ${keys.size} models: ${[...keys].join(', ')}`)
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].header.index < chunks[i - 1].header.index) {
      problems.push(`header.index went backwards at chunk ${i} — progress must be monotonic`)
    }
  }
  return problems
}
