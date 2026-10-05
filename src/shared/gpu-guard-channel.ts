/**
 * The one IPC channel the GPU guard owns, and the shape of what it carries.
 *
 * It lives in `shared/` rather than in `src/main/gpu-guard.ts` because the **preload** needs
 * it too, and the preload is sandboxed: it may not pull in `node:child_process`, which the
 * main-process half of the guard needs to read `phys_footprint`. Importing the guard itself
 * from the preload bundles that import and the preload fails to load with
 * `module not found: node:child_process` — measured, 2026-09-17.
 *
 * One-way, main → renderer. Nothing is sent back, and the renderer cannot raise, lower or
 * silence the limit.
 */
export const GPU_GUARD_CHANNEL = 'gpu:guard-tripped'

/** What the renderer is told when the GPU helper process blows its budget. */
export interface GpuGuardTrip {
  gpuMB: number
  limitMB: number
}
