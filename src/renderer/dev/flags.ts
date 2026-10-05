/**
 * Dev-only surfaces — `window.__sgvueDev`, `#mock`, `#backend=webgpu`, `#aa=0`, `#rows=<n>`,
 * the assistant's turn recorder and `viewer.dev`. `import.meta.env` is replaced at build time,
 * so this is the constant `false` in a production build and Rollup drops every branch it
 * guards; `VITE_SGVUE_DEVTOOLS=1` keeps them in a built bundle for the dev harnesses.
 */
export const DEVTOOLS: boolean =
  import.meta.env.DEV || import.meta.env.VITE_SGVUE_DEVTOOLS === '1'
