import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Production CSP. Must stay byte-identical to the meta tag in every page —
 * src/renderer/index.html, since 2026-09-25 src/renderer/schedule.html, and since 2026-11-07
 * src/renderer/vee.html.
 */
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self' sgvue-file: blob:; object-src 'none'; base-uri 'none'"

/**
 * In dev the renderer is served from http://localhost:5173, so `'self'` is that origin.
 * Two additions are still needed: `'unsafe-inline'` for the react-refresh preamble Vite
 * injects into the HTML, and the HMR websocket. Neither reaches the production build.
 */
const CSP_DEV = CSP.replace(
  "script-src 'self' 'wasm-unsafe-eval'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'"
).replace("connect-src 'self' sgvue-file: blob:", "connect-src 'self' sgvue-file: blob: ws://localhost:5173")

/** 2026-09-24 — the landing page shows the app's version; read once, at build time. */
const APP_VERSION: string = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version

export default defineConfig({
  // The same build-time version as the renderer, so About and the landing page agree even
  // when a dev or e2e launch makes `app.getVersion()` report Electron's own.
  main: { define: { __APP_VERSION__: JSON.stringify(APP_VERSION) } },
  // Three preloads: the main window's, the Schedules window's (2026-09-25), which hands its page
  // the private port (`src/preload/schedule.ts`), and the Ask Vee window's (2026-11-07), which
  // does only that (`src/preload/vee.ts`).
  // Each must build to ONE standalone file: a module two import would be hoisted into
  // `preload/chunks/`, which a **sandboxed** preload cannot `require`, and the windows would
  // lose their bridge silently. So the Schedules and Vee preloads import nothing but `electron`
  // (`tests/unit/schedule/preload.test.ts` and `tests/unit/vee-window.test.ts` hold them there). electron-vite's `isolatedEntries`
  // would lift the restriction, but in 5.0.0 it throws whenever stdout is not a TTY.
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          schedule: resolve('src/preload/schedule.ts'),
          // 2026-11-07 — the Ask Vee window's: re-posts its port, imports only `electron`.
          vee: resolve('src/preload/vee.ts')
        }
      }
    }
  },
  renderer: {
    base: './',
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
    worker: { format: 'es' },
    /**
     * Phase 10. electron-vite leaves the renderer unminified; a shipped app has no reason to.
     * esbuild takes the bundle from 3.79 MB to 1.53 MB and the parse worker from 5.98 MB to
     * 2.59 MB, which is 5.6 MB less to read off disk before the first frame.
     *
     * Nothing in this renderer depends on a name surviving: the parity harness and the e2e
     * suite find every element by `data-role`, `title`, `data-tip` or its designed copy, all
     * of which are strings; the viewer is wired by object literals; and `window.__sgvueDev`
     * is removed by the `DEVTOOLS` constant before minification ever sees it — which
     * `tests/e2e/packaged.spec.ts` asserts against the packaged bundle.
     */
    build: {
      minify: 'esbuild',
      // Three pages: the viewer, the Schedules window (2026-09-25) and the Ask Vee window
      // (2026-11-07).
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          schedule: resolve('src/renderer/schedule.html'),
          vee: resolve('src/renderer/vee.html')
        }
      }
    },
    optimizeDeps: { exclude: ['web-ifc', 'sql.js'] },
    assetsInclude: ['**/*.wasm'],
    resolve: {
      alias: { '@renderer': resolve('src/renderer') }
    },
    plugins: [
      react(),
      {
        name: 'sgvue-dev-csp',
        apply: 'serve',
        // Every page the dev server serves — index.html, schedule.html, vee.html — must carry the
        // constant, or it would load without the dev relaxation and fail on HMR.
        transformIndexHtml(html: string, ctx: { path: string }) {
          if (!html.includes(CSP)) {
            throw new Error(
              `sgvue-dev-csp: ${ctx.path} no longer contains the CSP constant from electron.vite.config.ts. ` +
                'Without the dev relaxation the renderer will fail on Vite inline scripts and HMR — keep the two in sync.'
            )
          }
          return html.replace(CSP, CSP_DEV)
        }
      }
    ]
  }
})
