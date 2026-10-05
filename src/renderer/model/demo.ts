/**
 * The design's built-in demo building on the landing page — 2026-09-24, owner-requested:
 * *"Also keep our sample model on the home page for demo."*
 *
 * It is the design's own synthetic federation (`design-reference/design/sample-model.js`,
 * copied byte for byte to `dev/sample-model.js`), turned into the app's contract by the same
 * adapter the parity harnesses use (`dev/mock-adapter.ts`). This module is that adapter's one
 * production importer, and `upload-pipeline.ts` imports it lazily, so the demo is its own
 * chunk and costs nothing until "try the demo building →" is clicked.
 *
 * The demo has no file behind it. So it is never a recent (nothing calls `addRecent`), it is
 * never in the sidebar library, and a session or share link cut from it names no files
 * (`federation-store.ts`'s `sessionFiles` keeps only real ones): opening such a link says
 * "That session had no models in it", the designed banner.
 */
import type { MockOptions } from '../dev/mock-adapter'
import { SAMPLE_FILES, mockGeometryChunks, mockModelIndex } from '../dev/mock-adapter'
import type { BatchItem } from './federation-store'

/** The design's four discipline models, in its own order: one boot batch, framed once. */
export const DEMO_KEYS: readonly string[] = SAMPLE_FILES.map((f) => f.key)

/**
 * How a demo key becomes a loaded model. `options` is dev-only (`App.tsx`'s `#mock&hostile`);
 * the landing page's button passes nothing.
 */
export const demoLoader =
  (options?: MockOptions) =>
  async (key: string): Promise<BatchItem> => ({
    index: mockModelIndex(key, options),
    chunks: mockGeometryChunks(key),
    offset: [0, 0, 0],
    // Authored at the origin with no site placement: the project frame is the identity.
    frame: null
  })
