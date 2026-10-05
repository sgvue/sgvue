/**
 * The freeze on model data.
 *
 * Guarantee 3 (SYSTEM_SPEC §6): index types are `readonly` behind a deep-readonly boundary,
 * and the renderer re-applies the freeze on receipt because a structured clone strips it.
 * `federation-store.ts` freezes every index it receives here, before it joins the federation;
 * nothing that arrives is ever mutated afterwards.
 *
 * Until refactor pass 2 this file also held a `ModelStore` class — a second, keyed copy of
 * every index that nothing in the app ever read back. The freeze was the only part that did
 * anything, so it is the only part left.
 */

/**
 * Freeze an object graph in place. Already-frozen subtrees are skipped, which matters: a
 * property set shared by two hundred elements is walked once, not two hundred times.
 * Typed arrays and buffers are left alone — freezing one does nothing useful and geometry
 * chunks (Phase 1b) are full of them.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}
