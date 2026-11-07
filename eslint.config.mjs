// ESLint (2026-11-07, lint hardening steps 2–3). Flat config, type-aware parsing, and one rule a
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

// Step 3: the project's known traps, banned by syntax. Each entry is one trap; its message
// names it in one sentence and says where it is written up. They are one list so that a file's
// override (below) can take one entry out without restating the others — a second
// `no-restricted-syntax` setting replaces the first, it does not add to it.
const TRAP = 'docs/TRAPS.md'
const TRAPS = {
  batchedMesh: {
    // Every mention: an import, `new`, a type, `three.BatchedMesh`, a destructure.
    selector: "Identifier[name='BatchedMesh']:not(ImportSpecifier > Identifier.local)",
    message: `BatchedMesh is one driver draw per visible instance on both backends and kernel-panicked this Mac three times; use the merged geometry per slot in viewer/batches.ts. See ${TRAP} (three.js 0.186).`
  },
  getLineFlatten: {
    // web-ifc 0.0.77: GetLine(modelID, expressID, flatten?, inverse?, …) — `flatten` is the
    // third argument; TRAPS.md writes the call without its modelID.
    selector: "CallExpression[callee.property.name='GetLine'][arguments.2.type='Literal'][arguments.2.value=true]",
    message: `GetLine with flatten = true throws on real Revit exports (its batched GetRawLinesData); use shallow GetLine and resolve references by hand. See ${TRAP} (properties).`
  },
  getSpatialStructure: {
    selector: "Identifier[name='getSpatialStructure']",
    message: `getSpatialStructure dumps every element under each storey; walk IfcRelAggregates for the tree and IfcRelContainedInSpatialStructure for contents. See ${TRAP} (properties).`
  },
  coordinateToOrigin: {
    selector: "Property[key.name='COORDINATE_TO_ORIGIN'][value.type='Literal'][value.value=true], Property[key.value='COORDINATE_TO_ORIGIN'][value.type='Literal'][value.value=true], AssignmentExpression[left.property.name='COORDINATE_TO_ORIGIN'][right.type='Literal'][right.value=true]",
    message: `COORDINATE_TO_ORIGIN: true recentres each model on its own and loses the offsets between the models of a federation; keep it false and subtract a shared origin in Float64. See ${TRAP} (geometry and units).`
  },
  raycast: {
    selector: "CallExpression[callee.property.name='raycast']",
    message: `Mesh.raycast is brute force over every triangle (222 ms a hover on a real model); pick through viewer/picking.ts, which filters by element box first and cuts inside the walk. See ${TRAP} (rendering at real sizes).`
  },
  intersectObjects: {
    // `Raycaster#intersectObject(s)` runs `Mesh.raycast` on every object it is given. A
    // Raycaster itself is fine — picking.ts and input.ts use one for `setFromCamera` and
    // `ray.intersectPlane` only.
    selector: "CallExpression[callee.property.name=/^intersectObjects?$/]",
    message: `Raycaster#intersectObject(s) runs Mesh.raycast, brute force over every triangle; pick the model through viewer/picking.ts. See ${TRAP} (rendering at real sizes).`
  },
  clipboard: {
    selector: "MemberExpression[property.name='clipboard'][object.name='navigator'], MemberExpression[property.name='clipboard'][object.property.name='navigator'], VariableDeclarator[init.name='navigator'] > ObjectPattern > Property[key.name='clipboard']",
    message: 'navigator.clipboard is refused in this app, always (no clipboard permission is granted); copy through copyText in src/renderer/clipboard.ts, the one sanctioned copier. See docs/DECISIONS.md (2026-10-02, the clipboard).'
  }
}
const trapsBut = (...keep) =>
  ['error', ...Object.entries(TRAPS).filter(([k]) => !keep.includes(k)).map(([, v]) => v)]

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
      'react-hooks/rules-of-hooks': 'error',
      'no-restricted-syntax': trapsBut()
    }
  },
  {
    // The view cube hit-tests its own 26 zone meshes, compass ring and north kite — a few
    // hundred triangles of its own scene, never the model — so `intersectObjects` is the right
    // tool there. `.raycast(` stays banned in it.
    files: ['src/renderer/viewer/cube.ts'],
    rules: { 'no-restricted-syntax': trapsBut('intersectObjects') }
  },
  {
    // The one sanctioned copier: it tries the async API, and falls back to execCommand.
    files: ['src/renderer/clipboard.ts'],
    rules: { 'no-restricted-syntax': trapsBut('clipboard') }
  }
]
