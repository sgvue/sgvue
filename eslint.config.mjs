// ESLint (2026-11-07, lint hardening step 2). Flat config, type-aware parsing, and one rule a
// step: nothing from a recommended set is on, so each rule is added — and measured — on its own.
//
// What is linted: the app's own TypeScript, `src/**/*.{ts,tsx}`. Not linted:
//  - `tests/` — the rules planned are about traps in app code; tests are still type-checked by
//    `tsconfig.node.json`, so a later step can add them with no new parser setup.
//  - `scripts/` — CommonJS dev utilities in no tsconfig, so a type-aware rule cannot run there.
//  - `design-reference/` (the read-only specification), build output, and
//    `src/renderer/dev/sample-model.js`, the design's own mock copied verbatim.
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      'out/',
      'out-baseline/',
      'dist/',
      'tmp/',
      'design-reference/',
      'samples/',
      'test-results/',
      'playwright-report/',
      '.claude/',
      'tests/',
      'scripts/',
      'src/renderer/dev/sample-model.js'
    ]
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // The root tsconfig is solution-style; the project service finds which of
        // tsconfig.node.json / tsconfig.web.json holds each file, as the editor does.
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      // Registered with none of its rules on: two ported lines carry a directive naming one
      // (`src/schedule/export/xlsx.ts`, `src/shared/model-index.types.ts`), and a directive for
      // a rule ESLint does not know is an error. Later steps turn its rules on one at a time.
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks
    },
    linterOptions: {
      // Off while those two directives name rules that are not on, which would report them as
      // unused. Turn it on once every rule a directive names is enabled.
      reportUnusedDisableDirectives: 'off'
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error'
    }
  }
]
