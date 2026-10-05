/**
 * The renderer's view of the preload bridge, as a global.
 *
 * It is `api.d.ts` and not `index.d.ts` (the plan's own layout, §3.8) for a mechanical reason:
 * TypeScript treats a `foo.d.ts` sitting beside a `foo.ts` as that file's *declaration output*
 * and drops it from the program, so the `declare global` below was silently absent from every
 * project that compiles `src/preload/index.ts` — which is the Node project the tests run in.
 */
import type { SGVueApi } from './index'

declare global {
  interface Window {
    sgvue: SGVueApi
  }
}
