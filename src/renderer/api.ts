/**
 * The preload's bridge (`window.sgvue`), or `undefined` outside Electron — the unit tests and
 * a bare browser have no preload. Read at call time, so a test that installs a stub later is
 * seen.
 */
export const api = (): Window['sgvue'] | undefined =>
  typeof window === 'undefined' ? undefined : window.sgvue
