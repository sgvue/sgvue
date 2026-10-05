/**
 * Dev utility — NOT application code. The backend policy every script in `scripts/` obeys.
 *
 * Since 2026-09-17 the app itself defaults to WebGL2 (`src/renderer/viewer/scene.ts`), and
 * these scripts default to it too. WebGPU is reachable only when **both** are true:
 *
 *   * `SGVUE_BACKEND=webgpu` **and** `SGVUE_ALLOW_WEBGPU=1` — two separate deliberate acts;
 *   * the content is the **mock federation** (`#mock`), which is 590 parts.
 *
 * The second condition is the important one. The unbounded GPU-process growth that panicked
 * this machine twice is driven by draw calls per frame, and on WebGPU three 0.186 issues one
 * per visible `BatchedMesh` instance: ~2 071 a frame on the mock, ~134 745 on the 137.9 MB
 * reference model. A real model on WebGPU is simply not something a script may start.
 *
 * A refusal is loud and falls back to WebGL2 rather than exiting, so a stale environment
 * variable cannot silently skip a capture run.
 */

/** The app's own dev entry for the design's mock federation (`src/renderer/App.tsx`). */
const MOCK_HASH = /(^|[#&?])mock(=1)?\b/

/**
 * @param {string} baseHash the hash the script would load anyway (e.g. `'mock'`, or `''`)
 * @returns {{ backend: 'webgl'|'webgpu', hash: string }}
 */
function resolveBackend(baseHash = '') {
  const asked = (process.env.SGVUE_BACKEND || 'webgl').toLowerCase()
  if (asked !== 'webgpu') {
    if (asked !== 'webgl' && asked !== 'auto') {
      console.log(`[backend] unknown SGVUE_BACKEND="${asked}" — using WebGL2`)
    }
    return { backend: 'webgl', hash: baseHash }
  }
  if (process.env.SGVUE_ALLOW_WEBGPU !== '1') {
    console.log('[backend] REFUSED WebGPU: set SGVUE_ALLOW_WEBGPU=1 as well — using WebGL2')
    return { backend: 'webgl', hash: baseHash }
  }
  if (!MOCK_HASH.test(baseHash)) {
    console.log('[backend] REFUSED WebGPU: only the mock federation (#mock) may run it — using WebGL2')
    return { backend: 'webgl', hash: baseHash }
  }
  console.log('[backend] WebGPU on the mock federation, explicitly allowed')
  return { backend: 'webgpu', hash: baseHash ? `${baseHash}&backend=webgpu` : 'backend=webgpu' }
}

module.exports = { resolveBackend, MOCK_HASH }
