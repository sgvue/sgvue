// The app's one HTML escape (2026-11-07, lint hardening step 4). Text authored inside an IFC
// file — a grid's tag, a storey's name, a property value — is untrusted, and every piece of it
// that is written into markup (`innerHTML`) goes through `esc` first. It was ifcTable's
// `ui/dom.ts` escape, ported for the Schedules window (2026-09-25), and moved here unchanged so
// the 3D view's labels use the same one; `schedule-ui/dom.ts` re-exports it.
//
// `eslint.config.mjs` trusts a call to a function named `esc` as escaped (no-unsanitized's
// `escape.methods`), so the name is reserved: declaring or importing any other `esc` is a lint
// error.

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
