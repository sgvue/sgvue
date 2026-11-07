// ESLint (2026-11-07, lint hardening steps 2–5). Flat config, type-aware parsing, and one rule a
// step: nothing from a recommended set is on, so each rule is added — and measured — on its own.
//
// What is linted: the app's own TypeScript, `src/**/*.{ts,tsx}`. Not linted:
//  - `tests/` — the rules planned are about traps in app code; tests are still type-checked by
//    `tsconfig.node.json`, so a later step can add them with no new parser setup.
//  - `scripts/` — CommonJS dev utilities in no tsconfig, so a type-aware rule cannot run there.
//  - `design-reference/` (the read-only specification), build output, and
//    `src/renderer/dev/sample-model.js`, the design's own mock copied verbatim.
import noUnsanitized from 'eslint-plugin-no-unsanitized'
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
  },
  // Step 4: markup. no-unsanitized (below) covers the DOM's own HTML sinks; React's is this.
  dangerouslySetInnerHTML: {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML'], Property[key.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML parses its string as markup, and text from an IFC file is untrusted; render text as JSX children, which React escapes. See docs/DECISIONS.md (2026-11-07, untrusted text and markup).'
  },
  escName: {
    // no-unsanitized trusts a call to `esc` as escaped (ESCAPERS), so the name is the one in
    // src/shared/html.ts and nothing else. Every way to bind or rebind it is refused: a
    // declaration, a destructure (with or without a default), a parameter of any function, an
    // import or a re-export of another function under it, and an assignment to it.
    selector: [
      "FunctionDeclaration[id.name='esc']",
      "VariableDeclarator[id.name='esc']",
      "ObjectPattern > Property[value.name='esc']",
      "ObjectPattern > Property[value.left.name='esc']",
      "ArrayPattern > Identifier[name='esc']",
      "ArrayPattern > AssignmentPattern[left.name='esc']",
      ":function > Identifier.params[name='esc']",
      ":function > AssignmentPattern.params[left.name='esc']",
      ":function > RestElement.params[argument.name='esc']",
      "TSParameterProperty[parameter.name='esc']",
      "ImportSpecifier[local.name='esc'][imported.name!='esc']",
      "ImportDefaultSpecifier[local.name='esc']",
      "ImportNamespaceSpecifier[local.name='esc']",
      "ExportSpecifier[exported.name='esc'][local.name!='esc']",
      "AssignmentExpression[left.name='esc']"
    ].join(', '),
    message: "`esc` is the app's one HTML escape (src/shared/html.ts), and the linter trusts a call by that name as escaped; give this function another name. See docs/DECISIONS.md (2026-11-07, untrusted text and markup)."
  }
}
// Step 4: untrusted text and markup. Text authored inside an IFC file reaches labels, tags and
// the Schedules window, so every write of a string into markup — innerHTML / outerHTML,
// insertAdjacentHTML, document.write, createContextualFragment, setHTMLUnsafe — must be a
// literal, a template whose every `${…}` is `esc(…)`, or carry a disable directive saying why
// it is safe. `esc` (src/shared/html.ts) is the one escape the plugin is told to trust.
// `taggedTemplates: []`: left out, the plugin would also trust `escapeHTML` and
// `Sanitizer.escapeHTML` tagged templates — names nothing here reserves.
const ESCAPERS = { escape: { methods: ['esc'], taggedTemplates: [] } }
// The 3D view's label overlay writes its `html` argument into innerHTML (viewer/overlay.ts), so
// its two factories are sinks too: their callers are checked here, as a sink's own are, instead
// of one directive inside them hiding every caller.
const OVERLAY_SINKS = {
  mkLabel: { properties: [1] },
  mkElement: { properties: [0] }
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
      // Registered for two reasons: two ported lines carry a directive naming one of its rules
      // (`src/schedule/export/xlsx.ts`, `src/shared/model-index.types.ts`), and a directive for
      // a rule ESLint does not know is an error; and its rules are turned on one a step — step 5
      // turned on `switch-exhaustiveness-check`, below.
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
      'no-unsanitized': noUnsanitized
    },
    linterOptions: {
      // Off while those two directives name rules that are not on, which would report them as
      // unused. Turn it on once every rule a directive names is enabled.
      reportUnusedDisableDirectives: 'off'
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'no-unsanitized/method': ['error', ESCAPERS, OVERLAY_SINKS],
      'no-unsanitized/property': ['error', ESCAPERS],
      'no-restricted-syntax': trapsBut(),
      // Step 5: a switch over a union names every member, so a member added to the union — a
      // `PendingAction` kind, a tool name, a display unit, a section kind — fails lint at every
      // switch that forgot it.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        {
          // A `default:` does not count as handling the members it would catch: otherwise a
          // forgotten member is swallowed by it in silence, which is the case this rule is for.
          considerDefaultExhaustiveForUnions: false,
          // A `default:` beside every member listed is kept: it then catches only a value that
          // is outside the type at run time (one read off a port, a file, a cast), and with the
          // option above it can no longer hide a member.
          allowDefaultCaseForExhaustiveSwitch: true,
          // A switch over an open set (`string`, `number`) has no member to forget, and its
          // fall-through is often the point (`attr`'s property lookup after its seven names).
          requireDefaultForNonUnion: false
        }
      ]
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
  },
  {
    // Where `esc` is declared.
    files: ['src/shared/html.ts'],
    rules: { 'no-restricted-syntax': trapsBut('escName') }
  }
]
