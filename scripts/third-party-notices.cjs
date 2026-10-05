/**
 * Dev utility — NOT application code. Writes `THIRD_PARTY_NOTICES.md`: every third-party
 * component SGVue's installers ship, with its version, licence, copyright lines and licence text
 * (each distinct text once).
 *
 *   node scripts/third-party-notices.cjs           write THIRD_PARTY_NOTICES.md
 *   node scripts/third-party-notices.cjs --check   exit 1 when the file is not what this writes
 *
 * `npm test` makes the same comparison (`tests/unit/third-party-notices.test.ts`), so the file
 * cannot go stale in silence: adding, upgrading or removing anything that ships changes what
 * this writes, and the test fails until the file is written again.
 *
 * What ships, and where this reads it:
 *  1. **app.asar › node_modules** — `package.json`'s `dependencies` and everything they depend
 *     on, resolved the way Node resolves them. electron-builder packs exactly that tree.
 *  2. **app.asar › out** — what Vite bundles: every package the app's own code under `src/`
 *     imports (value imports and CSS `@import`s, read with TypeScript's parser) and what each of
 *     those depends on, plus the helper code Vite writes into the bundle. `src/main` and
 *     `src/preload` leave their `dependencies` to node_modules (electron-vite externalises them).
 *  3. **Inside exceljs's browser build** — the packages its source map lists. Those npm installs
 *     here are read from node_modules; the rest from `scripts/third-party-notices.json`, which
 *     records each text and the registry tarball it was read from.
 *  4. **Inside web-ifc.wasm** — the C++ libraries web-ifc compiles in (recorded data).
 *  5. Electron and Chromium; `elevate.exe` on Windows; source adapted into SGVue's own files.
 *
 * Nothing here touches the network, and nothing but the one output file is written.
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { builtinModules } = require('node:module')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'THIRD_PARTY_NOTICES.md')
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'third-party-notices.json'), 'utf8'))

/** `electron.vite.config.ts`'s `resolve.alias` — an import path, not a package. */
const ALIASES = ['@renderer']

const WHERE = {
  asar: 'app.asar: node_modules',
  bundle: 'app.asar: out (bundled JavaScript)',
  fonts: 'app.asar: out (font files)',
  helper: 'app.asar: out (bundler helper code)',
  exceljs: "exceljs's browser build",
  wasm: 'web-ifc.wasm',
  electron: 'the Electron runtime',
  windows: 'Windows build: resources',
  adapted: "SGVue's own source"
}

/**
 * The SPDX texts of the two licences a shipped package declares without carrying a licence file
 * (`standardwebhooks`, MIT; `saxes`, ISC): the standard text, with the holder from the package's
 * own `author`, and the table says so.
 */
const STANDARD_TEXT = {
  MIT: `MIT License

Copyright (c) <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`,
  ISC: `ISC License

Copyright (c) <copyright holders>

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
`
}

const LICENCE_FILE = /^(licen[sc]e|copying)([-._].*)?$/i

/* ────────────────────────────── reading the tree ────────────────────────────── */

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const readText = (file) => fs.readFileSync(file, 'utf8')
const byName = (a, b) => {
  const x = `${a.name.toLowerCase()}\u0000${a.version}`
  const y = `${b.name.toLowerCase()}\u0000${b.version}`
  return x < y ? -1 : x > y ? 1 : 0
}

/** The directory of package `name` as Node would find it from `from`, or null. */
function pkgDir(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'))
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    if (dir === ROOT || path.dirname(dir) === dir) return null
  }
}

/** A package's SPDX expression, from `license` or the old `licenses` array. */
function spdxOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license.replace(/^\((.*)\)$/, '$1')
  if (pkg.license && pkg.license.type) return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type || l).join(' OR ')
  return 'UNKNOWN'
}

/** The licence files at a package's root, `LICENSE` first. */
function rootLicenceFiles(dir) {
  const rank = (f) => ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE'].indexOf(f) + 1 || 9
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && LICENCE_FILE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
}

/** Licence files below a package's root, outside its own node_modules: vendored code. */
function nestedLicenceFiles(dir) {
  const found = []
  ;(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (d !== dir && LICENCE_FILE.test(e.name)) found.push(full)
    }
  })(dir)
  const posix = (p) => p.split(path.sep).join('/')
  return found.sort((a, b) => (posix(a) < posix(b) ? -1 : posix(a) > posix(b) ? 1 : 0))
}

/** One installed package as a component. */
function installed(dir, where, note) {
  const pkg = readJson(path.join(dir, 'package.json'))
  const files = rootLicenceFiles(dir)
  let text = files.map((f) => readText(path.join(dir, f))).join('\n\n')
  let source = files.length ? files.join(', ') : ''
  if (!files.length) {
    const standard = STANDARD_TEXT[spdxOf(pkg)]
    const author = typeof pkg.author === 'string' ? pkg.author : pkg.author && pkg.author.name
    const holder = author && author.replace(/\s*[<(].*$/, '').trim()
    if (!standard || !holder) throw new Error(`${pkg.name}@${pkg.version} ships no licence file, and none can be stated for it`)
    text = standard.replace('<copyright holders>', holder)
    source = `no licence file in the package: the standard ${spdxOf(pkg)} text, with the holder from its package.json "author"`
    note = [note, `no licence file in the package: the standard ${spdxOf(pkg)} text is given`].filter(Boolean).join('; ')
  }
  return { name: pkg.name, version: pkg.version, license: spdxOf(pkg), where: [where], note, text, source, dir }
}

/** What the table says beside a bundled package whose shipping needs a word more. */
const BUNDLE_NOTES = {
  'web-ifc': () => `used unmodified; web-ifc.wasm ships unpacked beside the archive; source: ${DATA.webIfcSource}`,
  'sql.js': () => 'sql-wasm.wasm ships unpacked beside the archive; it contains SQLite (public domain, see above)',
  exceljs: () => "its browser build, loaded only for an Excel export; what that build contains is listed as \"exceljs's browser build\""
}

/** `roots` and everything they depend on, from `from`; a package in `leaves` is not walked. */
function tree(roots, from, leaves = new Set()) {
  const seen = new Map()
  const queue = roots.map((name) => ({ name, base: from, optional: false }))
  while (queue.length) {
    const { name, base, optional } = queue.shift()
    const dir = pkgDir(name, base)
    if (!dir) {
      if (optional) continue
      throw new Error(`${name} is not installed (wanted from ${path.relative(ROOT, base) || 'the project'}) — run npm ci`)
    }
    if (seen.has(dir)) continue
    const pkg = readJson(path.join(dir, 'package.json'))
    seen.set(dir, pkg)
    if (leaves.has(pkg.name)) continue
    for (const dep of Object.keys(pkg.dependencies || {})) queue.push({ name: dep, base: dir, optional: false })
    for (const dep of Object.keys(pkg.optionalDependencies || {})) queue.push({ name: dep, base: dir, optional: true })
  }
  return [...seen.keys()]
}

/* ────────────────────────────── what the app's code imports ────────────────────────────── */

function sourceFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx|js|mjs|cjs|css)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(full)
  }
  return out.sort()
}

/** Module specifiers a JS/TS file imports for their value — type-only imports are left out. */
function jsImports(ts, file, text) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind)
  const out = []
  const typeOnly = (clause) =>
    clause.isTypeOnly ||
    (!clause.name &&
      clause.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every((e) => e.isTypeOnly))
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause || !typeOnly(node.importClause)) out.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && !node.isTypeOnly) out.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      out.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** `@import '…'` in a stylesheet, comments removed first. */
function cssImports(text) {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...bare.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g)].map((m) => m[1])
}

/** The package a module specifier names, or null for a path, an alias, a built-in or Electron. */
function packageOf(spec) {
  const s = spec.split('?')[0]
  if (s.startsWith('.') || s.startsWith('/') || s.startsWith('node:')) return null
  const parts = s.split('/')
  const name = s.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  if (ALIASES.includes(parts[0]) || builtinModules.includes(name) || name === 'electron') return null
  return name
}

/** The packages Vite bundles into `out/`: imported by the app's code, outside main's externals. */
function bundledRoots() {
  const ts = require('typescript')
  const deps = new Set(Object.keys(readJson(path.join(ROOT, 'package.json')).dependencies || {}))
  const roots = new Set()
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    const text = readText(file)
    const specs = file.endsWith('.css') ? cssImports(text) : jsImports(ts, file, text)
    const externalised = /[\\/]src[\\/](main|preload)[\\/]/.test(file)
    for (const spec of specs) {
      const name = packageOf(spec)
      if (name && !(externalised && deps.has(name))) roots.add(name)
    }
  }
  return [...roots].sort()
}

/* ────────────────────────────── the components ────────────────────────────── */

function guessLicence(text) {
  if (/BSD 3-Clause|Neither the name of/i.test(text)) return 'BSD-3-Clause'
  if (/Permission is hereby granted, free of charge/i.test(text)) return 'MIT'
  if (/Permission to use, copy, modify, and\/or distribute/i.test(text)) return 'ISC'
  throw new Error('a vendored licence file this does not recognise:\n' + text.slice(0, 200))
}

function viteHelpers() {
  const dir = pkgDir('vite', ROOT)
  const pkg = readJson(path.join(dir, 'package.json'))
  const all = readText(path.join(dir, 'LICENSE.md')).replace(/\r\n/g, '\n')
  const core = /# Vite core license\n([\s\S]*?)\n# Licenses of bundled dependencies/.exec(all)
  const cjs = /\n## [^\n]*@rollup\/plugin-commonjs[^\n]*\n([\s\S]*?)\n-{20,}/.exec(all)
  if (!core || !cjs) throw new Error("vite's LICENSE.md no longer has the sections this reads")
  const quoted = cjs[1]
    .split('\n')
    .filter((l) => l.startsWith('>'))
    .map((l) => l.replace(/^> ?/, ''))
    .join('\n')
  return [
    {
      name: 'vite',
      version: pkg.version,
      license: 'MIT',
      where: [WHERE.helper],
      note: 'the module-preload helper Vite writes into the bundle',
      text: core[1].replace(/^Vite is released under the MIT license:\n/, ''),
      source: 'LICENSE.md, its "Vite core license" section'
    },
    {
      name: '@rollup/plugin-commonjs',
      version: `bundled in vite ${pkg.version}`,
      license: 'MIT',
      where: [WHERE.helper],
      note: 'the CommonJS interop helpers (the `_commonjsHelpers` chunk)',
      text: quoted,
      source: "vite's LICENSE.md, the section for the @rollup plugins it bundles"
    }
  ]
}

function exceljsEmbedded(exceljsDir) {
  const pkg = readJson(path.join(exceljsDir, 'package.json'))
  if (typeof pkg.browser !== 'string') throw new Error('exceljs no longer names a browser build')
  const map = readJson(path.join(exceljsDir, pkg.browser + '.map'))
  const names = new Set()
  for (const source of map.sources) {
    const hits = [...source.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)]
    if (hits.length) names.add(hits[hits.length - 1][1])
  }
  const recorded = new Map(DATA.exceljsEmbedded.map((r) => [r.name, r]))
  const out = []
  for (const name of [...names].sort()) {
    const dir = pkgDir(name, exceljsDir)
    if (dir) {
      out.push(installed(dir, WHERE.exceljs, 'the copy installed here; the one in the build may be another version'))
      continue
    }
    const r = recorded.get(name)
    if (!r) throw new Error(`${name} is in exceljs's browser build but neither installed nor recorded in scripts/third-party-notices.json`)
    out.push({
      name,
      version: r.version,
      license: r.license,
      where: [WHERE.exceljs],
      note:
        r.read === 'exact'
          ? 'the version the build itself records'
          : "the registry's latest on 2026-10-05; the build records no version",
      text: r.text,
      source: `${r.file} in ${r.tarball}`
    })
  }
  return out
}

function collect() {
  const project = readJson(path.join(ROOT, 'package.json'))
  for (const [name, version] of Object.entries(DATA.recordedFor)) {
    const dir = pkgDir(name, ROOT)
    const have = dir && readJson(path.join(dir, 'package.json')).version
    if (have !== version) {
      throw new Error(
        `scripts/third-party-notices.json was recorded for ${name} ${version}, and ${have || 'none'} is installed: ` +
          'read what that version embeds again and update the data file first'
      )
    }
  }
  const components = new Map()
  const add = (c) => {
    const key = c.dir || `${c.name}\u0000${c.version}`
    const have = components.get(key)
    if (have) have.where = [...new Set([...have.where, ...c.where])]
    else components.set(key, c)
  }

  // 1. app.asar's node_modules, and the code vendored inside those packages.
  for (const dir of tree(Object.keys(project.dependencies || {}), ROOT)) {
    const c = installed(dir, WHERE.asar)
    add(c)
    for (const file of nestedLicenceFiles(dir)) {
      const text = readText(file)
      const rel = path.relative(dir, path.dirname(file)).split(path.sep).join('/')
      add({
        name: `${c.name} › ${rel}`,
        version: `vendored in ${c.version}`,
        license: guessLicence(text),
        where: [WHERE.asar],
        note: `code vendored inside ${c.name}, with its own licence`,
        text,
        source: path.relative(dir, file).split(path.sep).join('/')
      })
    }
  }

  // 2. What Vite bundles; exceljs's browser build is a leaf whose contents come from its map.
  const roots = bundledRoots()
  for (const dir of tree(roots, ROOT, new Set(['exceljs']))) {
    const name = readJson(path.join(dir, 'package.json')).name
    const note = BUNDLE_NOTES[name] && BUNDLE_NOTES[name]()
    add(installed(dir, name.startsWith('@fontsource/') ? WHERE.fonts : WHERE.bundle, note))
  }
  if (roots.includes('exceljs')) for (const c of exceljsEmbedded(pkgDir('exceljs', ROOT))) add(c)
  for (const c of viteHelpers()) add(c)

  // 3. Recorded: web-ifc's C++ libraries, the Windows helper, adapted source.
  for (const r of DATA.webIfcNative) {
    add({
      name: r.name,
      version: r.commit.slice(0, 12),
      license: r.license,
      where: [WHERE.wasm],
      note: `${r.repository} at that commit${r.choice ? `; ${r.choice}` : ''}`,
      text: r.text,
      source: r.file
    })
  }
  for (const r of DATA.windowsOnly) {
    add({
      name: r.name,
      version: '—',
      license: r.license,
      where: [WHERE.windows],
      note: `${r.what}; licence read from ${r.repository} at ${r.commit.slice(0, 12)}`,
      text: r.text,
      copyright: r.copyright,
      source: r.file
    })
  }
  for (const r of DATA.adapted) {
    add({ name: r.name, version: '—', license: r.license, where: [WHERE.adapted], note: `${r.what} (${r.usedIn}); ${r.repository}`, text: r.text, source: r.file })
  }

  // 4. Electron itself.
  const electron = installed(pkgDir('electron', ROOT), WHERE.electron)
  electron.note = "its licence; Chromium's are in LICENSES.chromium.html (see above)"
  add(electron)

  return [...components.values()].sort(byName)
}

/* ────────────────────────────── licence texts ────────────────────────────── */

/**
 * A copyright notice: `Copyright …`, `(c) 2007 …`, `© …`, at the start of a line (a Markdown
 * heading's `#` allowed). Capitalised on purpose — the GPL's "copyright on the Program" and the
 * MPL's "(c) under Patent Claims" are licence wording, not notices.
 */
const COPYRIGHT_LINE = /^[\s#]*(Copyright\b|COPYRIGHT\b|\([cC]\)\s+[\dA-Z]|©)/
/** Licence wording that does start with a capitalised "Copyright" (the OFL's, lodash's). */
const NOT_A_NOTICE = /^[\s#]*copyright\s+(holder|statement|notice|owner|and related rights)s?\b/i
const RESERVED_LINE = /^\s*all rights reserved\.?\s*$/i

const tidy = (lines) => lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')

/** A text's copyright lines; the text without them; and the whole text, tidied. */
function split(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''))
  const copyright = []
  const body = []
  let after = false
  for (const line of lines) {
    if ((COPYRIGHT_LINE.test(line) && !NOT_A_NOTICE.test(line)) || (after && RESERVED_LINE.test(line))) {
      copyright.push(line.trim())
      after = true
    } else {
      body.push(line)
      after = false
    }
  }
  return { copyright, body: tidy(body), full: tidy(lines) }
}

/** Two bodies that differ only in their title line or in white space are one text. */
const TITLE = /^[(#\s]*(the\s+)?(mit|isc|bsd|apache|mozilla|sil)[^\n]{0,60}licen[cs]e[^\n]{0,30}\n(=+\n|-+\n)?/i
const keyOf = (body) => body.replace(TITLE, '').replace(/\s+/g, ' ').trim()

function groupTexts(components) {
  const groups = new Map()
  for (const c of components) {
    const { copyright, body, full } = split(c.text)
    c.copyrightLines = c.copyright || copyright
    const key = keyOf(body)
    if (!groups.has(key)) groups.set(key, { body, full, members: [] })
    groups.get(key).members.push(c)
  }
  const list = [...groups.values()]
  for (const g of list) {
    g.license = [...new Set(g.members.map((m) => m.license))].join(', ')
    // Members that share their copyright lines too share the whole text: print it as it is.
    // Otherwise the text is printed without them, and each member's own are listed above it.
    const lines = (m) => m.copyrightLines.join('\n')
    g.text = g.members.every((m) => lines(m) === lines(g.members[0])) ? g.full : g.body
  }
  list.sort((a, b) => {
    const x = `${a.license}\u0000${a.members[0].name}`
    const y = `${b.license}\u0000${b.members[0].name}`
    return x < y ? -1 : x > y ? 1 : 0
  })
  list.forEach((g, i) => {
    g.n = i + 1
    for (const m of g.members) m.textNo = g.n
  })
  return list
}

/* ────────────────────────────── the file ────────────────────────────── */

function fence(text) {
  let f = '```'
  while (text.includes(f)) f += '`'
  return f
}

function render() {
  const components = collect()
  const groups = groupTexts(components)
  const version = (name) => components.find((c) => c.name === name).version
  const sqlJs = components.find((c) => c.name === 'sql.js')
  const sqlite = /\b3\.\d{2}\.\d{1,2}\b/.exec(
    fs.readFileSync(path.join(sqlJs.dir, 'dist', 'sql-wasm.wasm')).toString('latin1')
  )
  const counts = new Map()
  for (const c of components) counts.set(c.license, (counts.get(c.license) || 0) + 1)
  const countLine = [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([l, n]) => `${l} ${n}`)
    .join(' · ')
  const cell = (s) => String(s).replace(/\|/g, '\\|')

  const out = []
  out.push(
    '# Third-party notices',
    '',
    "SGVue is licensed under the Apache License 2.0 (`LICENSE`); its own notices are in `NOTICE`. This file lists the third-party software SGVue's installers ship, with each component's licence. Every installer carries all three files in its resources folder.",
    '',
    'This file is generated by `node scripts/third-party-notices.cjs` from the installed dependency tree and the recorded data in `scripts/third-party-notices.json`. Do not edit it by hand: `npm test` fails when it no longer matches what the generator writes.',
    '',
    '## Notices that come with particular components',
    '',
    `### Electron ${version('electron')} and Chromium`,
    '',
    `SGVue runs on Electron ${version('electron')} (MIT; its licence is text ${components.find((c) => c.name === 'electron').textNo} below), which contains Chromium and the components Chromium includes, among them FFmpeg (LGPL-2.1). Their licences are in \`LICENSES.chromium.html\`, which Electron publishes with every release.`,
    '',
    '- **Windows:** the installation folder carries `LICENSES.chromium.html` and Electron\'s own licence, `LICENSE.electron.txt`, beside `SGVue.exe`.',
    `- **macOS:** the application bundle carries both files in \`SGVue.app/Contents/Resources/\`. The same \`LICENSES.chromium.html\` is in every archive of the Electron release, https://github.com/electron/electron/releases/tag/v${version('electron')}.`,
    '',
    `### web-ifc ${DATA.recordedFor['web-ifc']} — Mozilla Public License 2.0`,
    '',
    `The IFC parser (\`web-ifc-api.js\` in the parse worker, and \`web-ifc.wasm\`) is web-ifc ${DATA.recordedFor['web-ifc']}, used unmodified under the Mozilla Public License 2.0, whose full text is below. Its source code is at ${DATA.webIfcSource} — the tag of the release published to npm as web-ifc ${DATA.recordedFor['web-ifc']} — and the package as published is at https://www.npmjs.com/package/web-ifc/v/${DATA.recordedFor['web-ifc']}. \`web-ifc.wasm\` is compiled from that source together with the C++ libraries listed as "web-ifc.wasm" below, at the commits named; one of them, CDT, is also MPL-2.0, and its source is at https://github.com/artem-ogre/CDT.`,
    '',
    `### SQLite — public domain`,
    '',
    `The query worker's \`sql-wasm.wasm\` (sql.js ${sqlJs.version}, MIT) is compiled from SQLite${sqlite ? ` ${sqlite[0]}` : ''}, which is in the public domain: https://www.sqlite.org/copyright.html.`,
    '',
    '### IBM Plex',
    '',
    'The IBM Plex Sans, Mono and Serif fonts (`@fontsource` packages) are licensed under the SIL Open Font License 1.1; its full text, with IBM\'s copyright notices, is below.',
    '',
    "### Code adapted into SGVue's own files",
    '',
    `- \`src/shared/corenet.ts\` adapts the CORENET X georeferencing bounds check from a copy of ifcgref (${DATA.adapted.find((a) => a.name === 'ifcgref').repository}), MIT; its licence is below.`,
    `- \`src/renderer/viewer/section.ts\` writes out the instanced line-segment template of three.js's \`LineSegmentsGeometry\` (\`examples/jsm/lines/LineSegmentsGeometry.js\`), under three.js's MIT licence below.`,
    '',
    '## What ships, and under which licence',
    '',
    `${components.length} components. By licence: ${countLine}.`,
    '',
    '| Component | Version | Licence | Ships in | Text | Notes |',
    '|---|---|---|---|---|---|'
  )
  for (const c of components) {
    out.push(`| ${cell(c.name)} | ${cell(c.version)} | ${cell(c.license)} | ${cell(c.where.join('; '))} | ${c.textNo} | ${cell(c.note || '')} |`)
  }
  out.push('', '## Licence texts', '', 'Each distinct text once, after the components it applies to and their copyright lines as their licence files give them.')
  for (const g of groups) {
    out.push('', `### Text ${g.n} (${g.license})`, '')
    const who = []
    for (const m of g.members) {
      who.push(`${m.name}${m.version === '—' ? '' : ` ${m.version}`}${m.source ? ` — ${m.source}` : ''}`)
      for (const line of m.copyrightLines) who.push(`    ${line}`)
    }
    const a = fence(who.join('\n'))
    const b = fence(g.text)
    out.push('Applies to:', '', a + 'text', ...who, a, '', b + 'text', g.text, b)
  }
  return out.join('\n') + '\n'
}

module.exports = { render, collect, bundledRoots, OUT }

if (require.main === module) {
  const text = render()
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(OUT) ? readText(OUT).replace(/\r\n/g, '\n') : ''
    if (have !== text) {
      console.error('THIRD_PARTY_NOTICES.md is out of date: run `node scripts/third-party-notices.cjs`')
      process.exit(1)
    }
    console.log('THIRD_PARTY_NOTICES.md is up to date')
  } else {
    fs.writeFileSync(OUT, text)
    console.log(`wrote ${path.relative(ROOT, OUT)} (${Buffer.byteLength(text)} bytes)`)
  }
}
