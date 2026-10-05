import { defineConfig } from '@playwright/test'

/**
 * The Electron smoke test (plan §4 Phase 8 "Accept").
 *
 * **Never run this with `npx playwright test` directly.** Every Electron start in this
 * repository goes through a guard — three kernel panics on 2026-09-17, recorded in
 * `CLAUDE.md` — and `scripts/safe-e2e.cjs` is the one that covers this suite: it refuses a
 * second run, watches the `phys_footprint` of every Electron the test starts, and kills any
 * survivor. `npm run test:e2e` calls it.
 *
 * One worker, serial, no retries: the tests launch real windows and a second one running
 * beside them is exactly what the guard exists to prevent.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']]
})
