/**
 * Every inline style string the port writes is one the design writes (2026-11-07, core
 * protection #3).
 *
 * The fidelity contract (`CLAUDE.md`, "Port, don't redesign"): markup is translated one element at
 * a time, and `s('…')` (`src/renderer/app/css.ts`) exists so that each declaration string stays
 * **byte-identical to `SGVue.dc.html`**. Nothing checked that it still was. This reads every
 * `s(…)` call in `src/renderer/app/` and `src/renderer/App.tsx` with the TypeScript parser and
 * holds its string to the design's `style="…"` attributes.
 *
 * **How a call's argument is read** (`pieces`) — every string it can be, each where it is written:
 *  - a string literal as written;
 *  - a template literal span by span: a span this can read (below) is inlined, any other is a
 *    **hole**;
 *  - a name, by scope as the language does, to its `const` — in the same file, or imported from
 *    another (`state/selectors/sidebar.ts`'s columns) — and a parameter to every string the file's
 *    own calls pass for it (`Toolbar`'s `view(…, radius)`); `a + b` joined; `c ? a : b` both
 *    branches; `NAME[key]` on a const object every value; `X.replace('%tok%', …)` with `%tok%` a
 *    hole; a call of a one-expression arrow function its body (`Trace`'s `bubbleStyle`);
 *  - an operand of `+` this cannot read is a hole, like `${…}`; a whole argument it cannot read is
 *    **computed** — not checked, and listed in `COMPUTED` with its reason (none today), so a new
 *    one is a decision too, not a way round this test.
 *
 * **How it is matched**: a string with no hole must equal one of the design's `style="…"` values,
 * whole — not a fragment, which would let a port drop half a declaration list. Where the design
 * has a `{{ … }}` (its template syntax, which the port's interpolation replaced — rule 1) the port
 * may have a hole or any one value (its own constant inlined, `var(--accent)`); everywhere else the
 * text is the design's byte for byte, and a hole where the design wrote a literal is a mismatch.
 * HTML entities in the design are decoded first.
 *
 * **The allow-list** (`DEVIATIONS`): a string the design does not have, keyed by file and string,
 * each naming the entry that changed it — an allowed desktop deviation in `docs/DEVIATIONS.md` by
 * date and title, or a recorded decision in `docs/DECISIONS-INDEX.md`. An entry marked `UNRECORDED — reported 2026-11-07` names
 * none: it was found when this test was written, it is the owner's to decide, and it is a
 * possible defect until then. The test fails for a string in no list, and for a listed one that
 * is no longer in the code.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import nodePath, { join, type PlatformPath } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const DESIGN = 'design-reference/design/SGVue.dc.html'
const SOURCES = [
  ...readdirSync(join(ROOT, 'src/renderer/app'))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `src/renderer/app/${f}`),
  'src/renderer/App.tsx'
].sort()

// ── The design's strings ──────────────────────────────────────────────────────────────────────

const decode = (v: string): string =>
  v
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** Every `style="…"` value of the design's markup, decoded. */
function designStyles(): string[] {
  const html = readFileSync(join(ROOT, DESIGN), 'utf8').replace(/\r\n/g, '\n')
  const out: string[] = []
  for (const m of html.matchAll(/\sstyle="([^"]*)"/g)) out.push(decode(m[1]))
  return out
}

// ── The port's strings ───────────────────────────────────────────────────────────────────────

/** A hole: an interpolation, which must stand where the design has a `{{ … }}`. */
const HOLE = Symbol('hole')
type Piece = string | typeof HOLE

/** One style string a call can pass: its pieces, and the line it is written on. */
interface Found {
  file: string
  line: number
  pieces: Piece[]
}

/** A call whose argument could not be read as a string. */
interface Computed {
  file: string
  line: number
  text: string
}

/** Adjacent text pieces joined, empty ones dropped: `['a', 'b', HOLE, '']` → `['ab', HOLE]`. */
function joinText(p: readonly Piece[]): Piece[] {
  const out: Piece[] = []
  for (const x of p) {
    if (x === '') continue
    const last = out.at(-1)
    if (typeof x === 'string' && typeof last === 'string') out[out.length - 1] = last + x
    else out.push(x)
  }
  return out
}

const textOf = (pieces: readonly Piece[]): string => pieces.map((p) => (p === HOLE ? '${…}' : p)).join('')

/** Where a string is written: the file and line of its literal, not of the call that uses it. */
interface At {
  file: string
  line: number
}
type Alt = { at: At; pieces: Piece[] }

/** At most this many strings a call can pass (a cross product of conditionals); past it, a hole. */
const MAX_ALTS = 64

/** A parsed source file and what `pieces` needs from it, read once. */
interface Parsed {
  file: string
  src: ts.SourceFile
  /** Imported names → [module file, exported name]. */
  imports: Map<string, [string, string]>
}

const parsed = new Map<string, Parsed | null>()

/**
 * A module specifier, relative to `from`, as a repository path — `/`-separated on every host, as
 * DEVIATIONS spells it — or null for a package. `path` is the host's; the test below runs it under
 * `path.win32` too, which joins with a backslash (the Windows CI failure of 2026-11-07).
 */
function resolveModule(from: string, spec: string, path: PlatformPath = nodePath): string | null {
  if (!spec.startsWith('.')) return null
  const base = path.join(path.dirname(from), spec).split(path.sep).join('/')
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) if (existsSync(join(ROOT, base + ext))) return base + ext
  return null
}

function parse(file: string): Parsed | null {
  if (parsed.has(file)) return parsed.get(file) ?? null
  if (!existsSync(join(ROOT, file))) {
    parsed.set(file, null)
    return null
  }
  const src = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const imports = new Map<string, [string, string]>()
  for (const n of src.statements) {
    if (!ts.isImportDeclaration(n) || !ts.isStringLiteral(n.moduleSpecifier)) continue
    const mod = resolveModule(file, n.moduleSpecifier.text)
    const named = n.importClause?.namedBindings
    if (mod && named && ts.isNamedImports(named)) {
      for (const el of named.elements) imports.set(el.name.text, [mod, (el.propertyName ?? el.name).text])
    }
  }
  const p = { file, src, imports }
  parsed.set(file, p)
  return p
}

const unwrap = (e: ts.Expression): ts.Expression => {
  let x = e
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression
  return x
}

/** The `const` named `name` declared directly in a list of statements, its initialiser — or null. */
function constIn(statements: ts.NodeArray<ts.Statement>, name: string): ts.Expression | null {
  for (const st of statements) {
    if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue
    for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) return d.initializer
  }
  return null
}

/**
 * What `id` names, by scope, as the language does: the nearest enclosing block, function or file
 * that declares it — a `const` there, or a parameter of the function on the way out.
 */
function lookup(id: ts.Identifier): { init: ts.Expression } | { param: true } | null {
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if (ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n)) {
      const init = constIn(n.statements, id.text)
      if (init) return { init }
    }
    if (ts.isFunctionLike(n) && n.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === id.text)) return { param: true }
  }
  return null
}

/** The `const` `id` names — in its own scope, else imported from another file — and that file. */
function definition(p: Parsed, id: ts.Identifier): { in: Parsed; init: ts.Expression } | null {
  const found = lookup(id)
  if (found) return 'init' in found ? { in: p, init: found.init } : null
  const imp = p.imports.get(id.text)
  const q = imp ? parse(imp[0]) : null
  const init = q && imp ? constIn(q.src.statements, imp[1]) : null
  return q && init ? { in: q, init } : null
}

/** The function `id` is a parameter of, its name and the parameter's index — or null. */
function paramOf(id: ts.Identifier): { name: string; index: number } | null {
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if (!ts.isArrowFunction(n) && !ts.isFunctionDeclaration(n) && !ts.isFunctionExpression(n)) continue
    const index = n.parameters.findIndex((q) => ts.isIdentifier(q.name) && q.name.text === id.text)
    if (index < 0) continue
    const name = ts.isFunctionDeclaration(n)
      ? n.name?.text
      : ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)
        ? n.parent.name.text
        : undefined
    return name ? { name, index } : null
  }
  return null
}

/**
 * Every string `expr` can be, as pieces, each with where it is written — or null when it is not
 * a string this test can read.
 */
function pieces(p: Parsed, expr: ts.Expression, depth = 0): Alt[] | null {
  if (depth > 20) return null
  const e = unwrap(expr)
  const at = (n: ts.Node): At => ({ file: p.file, line: p.src.getLineAndCharacterOfPosition(n.getStart(p.src)).line + 1 })
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [{ at: at(e), pieces: [e.text] }]
  if (ts.isTemplateExpression(e)) {
    // A span this can read is inlined (every string it can be); anything else is a hole.
    let alts: Piece[][] = [[e.head.text]]
    for (const span of e.templateSpans) {
      const inner = pieces(p, span.expression, depth + 1)
      const options: Piece[][] = inner && alts.length * inner.length <= MAX_ALTS ? inner.map((x) => x.pieces) : [[HOLE]]
      alts = alts.flatMap((a) => options.map((o) => [...a, ...o, span.literal.text]))
    }
    return alts.map((a) => ({ at: at(e), pieces: joinText(a) }))
  }
  if (ts.isIdentifier(e)) {
    const found = lookup(e)
    if (!found || 'init' in found) {
      const def = definition(p, e)
      return def ? pieces(def.in, def.init, depth + 1) : null
    }
    // A parameter: every string the file's own calls of that function pass for it.
    const param = paramOf(e)
    if (!param) return null
    const out: Alt[] = []
    let calls = 0
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === param.name) {
        calls++
        const arg = n.arguments[param.index]
        const got = arg ? pieces(p, arg, depth + 1) : null
        if (got) out.push(...got)
        else calls = Infinity
      }
      ts.forEachChild(n, visit)
    }
    visit(p.src)
    return calls > 0 && calls !== Infinity && out.length <= MAX_ALTS ? out : null
  }
  if (ts.isConditionalExpression(e)) {
    const a = pieces(p, e.whenTrue, depth + 1)
    const b = pieces(p, e.whenFalse, depth + 1)
    return a && b ? [...a, ...b] : null
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    // An operand this cannot read is a hole, exactly as `${…}` is.
    const hole = (n: ts.Node): Alt[] => [{ at: at(n), pieces: [HOLE] }]
    const a = pieces(p, e.left, depth + 1) ?? hole(e.left)
    const b0 = pieces(p, e.right, depth + 1)
    const b = b0 && a.length * b0.length <= MAX_ALTS ? b0 : hole(e.right)
    return a.flatMap((x) => b.map((y) => ({ at: x.at, pieces: joinText([...x.pieces, ...y.pieces]) })))
  }
  if (ts.isElementAccessExpression(e) && ts.isIdentifier(unwrap(e.expression))) {
    const def = definition(p, unwrap(e.expression) as ts.Identifier)
    const o = def ? unwrap(def.init) : null
    if (!o || !ts.isObjectLiteralExpression(o)) return null
    const all: Alt[] = []
    for (const prop of o.properties) {
      if (!ts.isPropertyAssignment(prop)) return null
      const v = pieces(def!.in, prop.initializer, depth + 1)
      if (!v) return null
      all.push(...v)
    }
    return all
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    // A call of a style-building function: the string its body returns, its parameters holes.
    const fn = definition(p, e.expression)
    if (!fn) return null
    const f = unwrap(fn.init)
    if (ts.isArrowFunction(f) && !ts.isBlock(f.body)) return pieces(fn.in, f.body, depth + 1)
    return null
  }
  if (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    e.expression.name.text === 'replace' &&
    e.arguments.length === 2 &&
    ts.isStringLiteral(e.arguments[0])
  ) {
    const token = e.arguments[0].text
    const base = pieces(p, e.expression.expression, depth + 1)
    if (!base) return null
    // `.replace` with a string replaces the first occurrence only.
    return base.map((b) => {
      let done = false
      const out: Piece[] = []
      for (const x of b.pieces) {
        if (done || x === HOLE || !x.includes(token)) {
          out.push(x)
          continue
        }
        const i = x.indexOf(token)
        out.push(x.slice(0, i), HOLE, x.slice(i + token.length))
        done = true
      }
      return { at: b.at, pieces: joinText(out) }
    })
  }
  return null
}

/** Every `s(…)` call in `file`: the strings it can pass, or the call's text when they cannot be read. */
function scan(file: string): { found: Found[]; computed: Computed[] } {
  const p = parse(file)
  if (!p) throw new Error(`${file} is not there`)
  const found: Found[] = []
  const computed: Computed[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 's' && n.arguments.length === 1) {
      const arg = n.arguments[0]
      const got = pieces(p, arg)
      if (got) for (const g of got) found.push({ ...g.at, pieces: g.pieces })
      else computed.push({ file, line: p.src.getLineAndCharacterOfPosition(arg.getStart(p.src)).line + 1, text: arg.getText(p.src) })
    }
    ts.forEachChild(n, visit)
  }
  visit(p.src)
  return { found, computed }
}

// ── Matching ─────────────────────────────────────────────────────────────────────────────────

const escapeRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A hole, written into the port's string for matching; no design text holds it. */
const SENTINEL = '\u0000'

/**
 * The design, ready to match: its plain values as a set, and each value with a `{{ … }}` as a
 * pattern in which every `{{ … }}` stands for one value — any text without a `;` (the design
 * interpolates values only, never a whole declaration; the test below holds it to that).
 */
interface Design {
  plain: Set<string>
  patterns: RegExp[]
}

function designOf(values: readonly string[]): Design {
  const plain = new Set<string>()
  const patterns: RegExp[] = []
  for (const v of values) {
    if (!v.includes('{{')) plain.add(v)
    else patterns.push(new RegExp('^' + v.split(/\{\{[^}]*\}\}/).map(escapeRe).join('[^;]*') + '$'))
  }
  return { plain, patterns }
}

/**
 * Whether the pieces are one of the design's values: the text byte for byte, and each of the
 * port's holes inside one of the design's `{{ … }}` (where the port may also have inlined the
 * value its own constant holds).
 */
function inDesign(p: readonly Piece[], d: Design): boolean {
  if (!p.includes(HOLE) && d.plain.has(p.join(''))) return true
  const text = p.map((x) => (x === HOLE ? SENTINEL : x)).join('')
  return d.patterns.some((re) => re.test(text))
}

// ── The allow-lists ──────────────────────────────────────────────────────────────────────────

/**
 * The recorded entries the port's own strings stand on, by the date and opening words they are
 * recorded under (`docs/DEVIATIONS.md`, or `docs/DECISIONS-INDEX.md` where it says "Decisions").
 */
const E = {
  preferences:
    '2026-09-18 — Preferences (⌘,) is the one allowed new surface (Decisions; Allowed desktop deviations: “Settings the design has no surface for … a small dialog built from the design tokens”)',
  caption: '2026-09-20 — the Coordinate-system card’s caption names the detected georeferencing method (the row gains flex-wrap:wrap)',
  empty: '2026-09-20 — the Filter card’s operator control gains exactly one entry, `empty` (the value field at the step row’s opacity:.45)',
  storeysTail:
    '2026-09-20 — above six storeys the element tree keeps 40 % of the sidebar’s height; 2026-09-24 — the sidebar’s MODELS, STOREYS and element-tree sections can be resized in height (the STOREYS rows’ tail)',
  treeFloor:
    '2026-09-20 — above six storeys the element tree keeps 40 % of the sidebar’s height (min-height); 2026-11-07 — the sidebar’s MODELS section folds behind its header (the tight tree)',
  footerVersion:
    '2026-09-21 — the landing page’s footer strip is not in the port; its theme toggle is; 2026-09-24 — the landing page shows the app version (justify-content:space-between)',
  fade: '2026-09-24 — the landing page loses its Resume card, its pills read “Recent”, it fades out into the viewer',
  resize: '2026-09-24 — the sidebar’s MODELS, STOREYS and element-tree sections can be resized in height (the drag handle)',
  suggestions: '2026-09-24 — the Ask SGVue suggestions take one line, and fold once the conversation starts',
  rename: '2026-09-24 — a double-click renames a saved viewpoint (the field in the name’s own font, colour and box)',
  actionBar: '2026-10-01 — undo, redo and the markup counts are an action bar above the status bar (the declared lane, --abar)',
  bottomRow:
    '2026-10-01 — undo, redo and the markup counts are an action bar above the status bar, and the stage’s bottom edge is one row (each piece less position:absolute, plus pointer-events:auto)',
  toolbar: '2026-10-01 — the toolbar is five groups with a divider between each two, and Schedules stands alone, last',
  updateNotice: '2026-10-01 — the landing page says when a newer version is out, with a link (the warning banner’s box in the accent tokens)',
  eyeFirst: '2026-10-01 — the element tree is eye-first, like STOREYS and MODELS',
  twoSections: '2026-10-01 — the Section card cuts along a gridline and at a level at the same time',
  vee: '2026-10-01 — the assistant is Vee, and its mascot is a 16 × 16 pixel sprite',
  brow: '2026-10-01 — the assistant is Vee (the bottom row declares its height as a lane, --brow)',
  trace: '2026-10-01 — Vee’s reply is drawn while its turn runs — a thinking trace — the send button stops the turn, and `You` stands on the left',
  blocks: '2026-10-08 — Vee’s replies are laid out in paragraphs, lists and tables',
  traceBlocks:
    '2026-10-01 — Vee’s reply is drawn while its turn runs — a thinking trace; 2026-10-08 — Vee’s replies are laid out in paragraphs, lists and tables (a table makes its bubble full width)',
  coordsNote: '2026-10-08 — the Coordinate-system card says, in one line, which model could not be lined up (the caption’s string plus an ellipsis)',
  laserSides: '2026-10-08 — a laser measurement reads each side of its point (a two-sided row wraps between axes)',
  veeWindow: '2026-11-07 — Ask Vee is a window of its own, above the SGVue window (the panel fills the window)',
  veeMessages: '2026-11-08 — the Ask Vee window is a messaging conversation (a user’s bubble’s type, for the line lifting into it)',
  modelsFold: '2026-11-07 — the sidebar’s MODELS section folds behind its header, and expanded it is always its full height',
  clip: '2026-11-07 — the stage and its label overlay are overflow:clip, where the design has overflow:hidden (Decisions)',
  clipAbarBrow:
    '2026-11-07 — the stage and its label overlay are overflow:clip (Decisions); 2026-10-01 — the action bar’s lane, --abar; 2026-10-01 — the assistant is Vee (--brow)',
  /**
   * The 3D and W view buttons write the design's declarations in another order: the design puts
   * `border-radius` last (`SGVue.dc.html:241`, `:246`), the port before `color` (`Toolbar.tsx`,
   * `view`'s `radius` argument). The computed style is the same; the string is not.
   */
  fedTrace:
    '2026-11-12 — a model picked after boot shows a federating indicator: a line along the stage’s top edge and a caption in the bottom row (the owner’s pick “B”)',
  unrecordedViewOrder: 'UNRECORDED — reported 2026-11-07: the 3D and W view buttons’ border-radius is written before color, not last'
} as const

/**
 * Strings the design does not have, by `file` and the string (`${…}` for a hole), each with the
 * recorded entry (`docs/DEVIATIONS.md` or `docs/DECISIONS-INDEX.md`) that changed it.
 */
const DEVIATIONS: readonly { file: string; css: string; entry: string }[] = [
  { file: 'src/renderer/App.tsx', css: 'flex:1;position:relative;min-width:0;overflow:clip;background:var(--ground);--rlane:${…}px;--abar:${…}px;--brow:${…}px', entry: E.clipAbarBrow },
  { file: 'src/renderer/App.tsx', css: 'flex:1;position:relative;min-width:0;overflow:clip;background:var(--ground);--rlane:${…}px;--abar:0px;--brow:${…}px', entry: E.clipAbarBrow },
  { file: 'src/renderer/App.tsx', css: 'flex:1;position:relative;min-width:0;overflow:clip;background:var(--ground);--rlane:0px;--abar:${…}px;--brow:${…}px', entry: E.clipAbarBrow },
  { file: 'src/renderer/App.tsx', css: 'flex:1;position:relative;min-width:0;overflow:clip;background:var(--ground);--rlane:0px;--abar:0px;--brow:${…}px', entry: E.clipAbarBrow },
  { file: 'src/renderer/App.tsx', css: 'position:absolute;inset:0;pointer-events:none;overflow:clip', entry: E.clip },
  { file: 'src/renderer/app/BottomRow.tsx', css: 'position:absolute;left:12px;right:12px;bottom:12px;display:grid;grid-template-columns:1fr minmax(0,auto) 1fr;column-gap:${…}px;row-gap:6px;align-items:end;pointer-events:none', entry: E.bottomRow },
  { file: 'src/renderer/app/BottomRow.tsx', css: 'justify-self:start;display:flex;flex-direction:column;align-items:flex-start;gap:3px;grid-row:2;grid-column:1', entry: E.bottomRow },
  { file: 'src/renderer/app/BottomRow.tsx', css: 'justify-self:start;display:flex;flex-direction:column;align-items:flex-start;gap:3px', entry: E.bottomRow },
  { file: 'src/renderer/app/BottomRow.tsx', css: 'display:flex;flex-direction:column-reverse;gap:6px;min-width:0;align-items:center;grid-row:1;grid-column:1 / -1;justify-self:center;max-width:100%', entry: E.bottomRow },
  { file: 'src/renderer/app/BottomRow.tsx', css: 'display:flex;flex-direction:column-reverse;gap:6px;min-width:0;align-items:flex-start;margin-bottom:2px', entry: E.bottomRow },
  { file: 'src/renderer/app/BottomRow.tsx', css: 'justify-self:end;display:flex;margin-bottom:2px;grid-row:2;grid-column:3', entry: E.bottomRow },
  { file: 'src/renderer/app/BottomRow.tsx', css: 'justify-self:end;display:flex;margin-bottom:2px', entry: E.bottomRow },
  { file: 'src/renderer/app/ChatPanel.tsx', css: 'display:flex;align-items:center;gap:5px;min-width:0', entry: E.suggestions },
  { file: 'src/renderer/app/ChatPanel.tsx', css: 'font:400 10.5px/1 var(--mono);color:var(--muted);padding:5px 8px;border:1px solid var(--border);border-radius:999px;flex:none', entry: E.suggestions },
  { file: 'src/renderer/app/ChatPanel.tsx', css: 'flex:1;min-width:0;display:flex;flex-wrap:nowrap;gap:5px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-mask-image:linear-gradient(to right, #000 calc(100% - 28px), transparent);mask-image:linear-gradient(to right, #000 calc(100% - 28px), transparent)', entry: E.suggestions },
  { file: 'src/renderer/app/ChatPanel.tsx', css: 'flex:1;min-width:0;display:flex;flex-wrap:nowrap;gap:5px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none', entry: E.suggestions },
  { file: 'src/renderer/app/ChatPanel.tsx', css: 'display:flex', entry: E.trace },
  { file: 'src/renderer/app/ChatPanel.tsx', css: 'position:absolute;left:50%;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:2px;background:var(--accent-ink);opacity:0;transform:scale(.4);pointer-events:none', entry: E.trace },
  { file: 'src/renderer/app/ChatPanel.tsx', css: 'position:absolute;inset:0;overflow:hidden;border-radius:11px;pointer-events:none;z-index:3', entry: E.trace },
  { file: 'src/renderer/app/ChatPanel.tsx', css: 'position:absolute;display:none;font:400 13px/1.42 var(--sans);color:var(--ink);text-wrap:pretty', entry: E.veeMessages },
  { file: 'src/renderer/app/ChatPill.tsx', css: 'z-index:12;display:flex;align-items:center;gap:7px;height:32px;padding:0 12px;background:var(--card);border:1px solid var(--accent);border-radius:999px;box-shadow:var(--shadow);color:var(--sel-ink);pointer-events:auto', entry: E.bottomRow },
  { file: 'src/renderer/app/ChatPill.tsx', css: 'z-index:12;display:flex;align-items:center;gap:7px;height:32px;padding:0 12px;background:var(--card);border:1px solid var(--accent);border-radius:999px;box-shadow:var(--shadow);color:var(--muted);pointer-events:auto', entry: E.bottomRow },
  { file: 'src/renderer/app/ChatPill.tsx', css: 'z-index:12;display:flex;align-items:center;gap:7px;height:32px;padding:0 12px;background:var(--card);border:1px solid var(--border);border-radius:999px;box-shadow:var(--shadow);color:var(--sel-ink);pointer-events:auto', entry: E.bottomRow },
  { file: 'src/renderer/app/ChatPill.tsx', css: 'z-index:12;display:flex;align-items:center;gap:7px;height:32px;padding:0 12px;background:var(--card);border:1px solid var(--border);border-radius:999px;box-shadow:var(--shadow);color:var(--muted);pointer-events:auto', entry: E.bottomRow },
  { file: 'src/renderer/app/ColorLegend.tsx', css: 'position:absolute;left:12px;bottom:calc(42px + var(--abar, 0px));z-index:11;width:230px;max-height:calc(100% - ${…}px - 60px - var(--abar, 0px));display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out', entry: E.actionBar },
  { file: 'src/renderer/app/CoordsCard.tsx', css: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap', entry: E.caption },
  { file: 'src/renderer/app/CoordsCard.tsx', css: 'font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis', entry: E.coordsNote },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'position:absolute;top:5px;left:5px;right:5px;height:2px;display:flex;gap:2px;pointer-events:none;z-index:14;animation:fedfade .22s linear', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'position:absolute;top:5px;left:5px;right:5px;height:2px;display:flex;gap:2px;pointer-events:none;z-index:14;animation:fedfade .22s linear;opacity:0;transition:opacity .22s linear', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'flex:1;position:relative;overflow:hidden;border-radius:1px;background:var(--border)', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'flex:1;position:relative;overflow:hidden;border-radius:1px;background:var(--border-strong)', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'position:absolute;inset:0;width:0;background:var(--accent);transition:width .26s cubic-bezier(.2,.7,.2,1),background-color .22s ease-out', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'position:absolute;inset:0;width:100%;background:var(--accent);transition:width .26s cubic-bezier(.2,.7,.2,1),background-color .22s ease-out', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'position:absolute;inset:0;width:100%;background:var(--ok-ink);transition:width .26s cubic-bezier(.2,.7,.2,1),background-color .22s ease-out', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'position:absolute;inset:0;width:100%;background:var(--warn-ink)', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'position:absolute;top:0;left:0;height:100%;width:25%;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:ifcsweep 1.3s linear infinite', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'display:flex;align-items:center;gap:8px;font:400 11px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:7px 10px;box-shadow:var(--shadow);white-space:nowrap;max-width:100%;pointer-events:none;animation:fadein .22s cubic-bezier(.2,.7,.2,1)', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'display:flex;align-items:center;gap:8px;font:400 11px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:7px 10px;box-shadow:var(--shadow);white-space:nowrap;max-width:100%;pointer-events:none;animation:fadein .22s cubic-bezier(.2,.7,.2,1);opacity:0;transition:opacity .22s linear', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'color:var(--ink);min-width:0;max-width:22ch;overflow:hidden;text-overflow:ellipsis', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'color:var(--faint)', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'color:var(--ok-ink)', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'color:var(--warn-ink)', entry: E.fedTrace },
  { file: 'src/renderer/app/FedTrace.tsx', css: 'width:14px;height:14px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--ok-bg);color:var(--ok-ink);margin:-2px 0;animation:ifcpop .3s ease-out', entry: E.fedTrace },
  { file: 'src/renderer/app/FilterCard.tsx', css: 'width:100%;font:400 12px/1.3 var(--mono);color:var(--ink);background:var(--card);border:1px solid var(--border-strong);border-radius:8px;padding:6px 8px;min-width:0;opacity:.45', entry: E.empty },
  { file: 'src/renderer/app/HintBar.tsx', css: 'font:400 12px/1.4 var(--sans);color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:7px 12px;box-shadow:var(--shadow);white-space:normal;text-align:center;text-wrap:balance;max-width:100%;pointer-events:auto', entry: E.bottomRow },
  { file: 'src/renderer/app/Landing.tsx', css: 'position:fixed;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;padding:32px;background:var(--ground);overflow:auto;opacity:0;transition:opacity ${…}s linear;pointer-events:none', entry: E.fade },
  { file: 'src/renderer/app/Landing.tsx', css: 'display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--sel-bg);border:1px solid var(--accent);border-radius:10px', entry: E.updateNotice },
  { file: 'src/renderer/app/Landing.tsx', css: 'flex:1;min-width:0;font:400 12.5px/1.5 var(--sans);color:var(--sel-ink);text-wrap:pretty', entry: E.updateNotice },
  { file: 'src/renderer/app/Landing.tsx', css: 'font:500 12px/1 var(--sans);color:var(--accent-ink);padding:2px 0;flex:none;white-space:nowrap', entry: E.updateNotice },
  { file: 'src/renderer/app/Landing.tsx', css: 'position:relative;width:100%;max-width:1080px;display:flex;align-items:center;justify-content:space-between;padding:18px 0 6px', entry: E.footerVersion },
  { file: 'src/renderer/app/MarkupsCard.tsx', css: 'font:400 11.5px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--ink);${…};overflow:hidden;text-overflow:ellipsis', entry: E.laserSides },
  { file: 'src/renderer/app/MarkupsCard.tsx', css: 'white-space:nowrap', entry: E.laserSides },
  { file: 'src/renderer/app/MarkupsCard.tsx', css: 'position:absolute;z-index:14;top:${…}px;left:12px;width:330px;max-width:calc(100% - 24px - var(--rlane, 0px));max-height:calc(100% - 110px - var(--abar, 0px));overflow:auto;display:flex;flex-direction:column;gap:12px;padding:14px;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out', entry: E.actionBar },
  { file: 'src/renderer/app/Preferences.tsx', css: 'position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.34)', entry: E.preferences },
  { file: 'src/renderer/app/Preferences.tsx', css: 'width:420px;max-width:calc(100% - 32px);max-height:calc(100% - 48px);overflow:auto;display:flex;flex-direction:column;gap:12px;padding:14px;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out', entry: E.preferences },
  { file: 'src/renderer/app/Preferences.tsx', css: 'display:flex;gap:8px', entry: E.preferences },
  { file: 'src/renderer/app/Preferences.tsx', css: 'font:600 12px/1 var(--sans);padding:0 12px;border-radius:8px;border:1px solid var(--border-strong);color:var(--ink);background:var(--ground)', entry: E.preferences },
  { file: 'src/renderer/app/Preferences.tsx', css: 'font:600 12px/1 var(--sans);color:var(--muted);margin-left:auto', entry: E.preferences },
  { file: 'src/renderer/app/Preferences.tsx', css: 'display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink);cursor:pointer', entry: E.preferences },
  { file: 'src/renderer/app/Preferences.tsx', css: 'margin:0;accent-color:var(--accent)', entry: E.preferences },
  { file: 'src/renderer/app/Preferences.tsx', css: 'align-self:flex-start;font:600 12px/1 var(--sans);color:var(--muted);padding:6px 0', entry: E.preferences },
  { file: 'src/renderer/app/Preferences.tsx', css: 'margin:0;max-height:220px;overflow:auto;font:400 11px/1.5 var(--mono);color:var(--muted);background:var(--ground);border:1px solid var(--border);border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-word', entry: E.preferences },
  { file: 'src/renderer/app/ProjectCard.tsx', css: 'position:absolute;z-index:14;top:${…}px;left:12px;width:340px;max-width:calc(100% - 24px - var(--rlane, 0px));max-height:calc(100% - 110px - var(--abar, 0px));overflow:auto;display:flex;flex-direction:column;gap:14px;padding:14px;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out', entry: E.actionBar },
  { file: 'src/renderer/app/PropertyCard.tsx', css: 'position:absolute;z-index:14;top:184px;right:12px;width:320px;max-height:calc(100% - 240px - var(--brow, 0px));display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out', entry: E.brow },
  { file: 'src/renderer/app/SectionCard.tsx', css: 'display:flex;justify-content:flex-end;gap:6px', entry: E.twoSections },
  { file: 'src/renderer/app/SectionCard.tsx', css: 'position:absolute;z-index:14;top:${…}px;left:12px;width:300px;max-width:calc(100% - 24px - var(--rlane, 0px));max-height:calc(100% - 110px - var(--abar, 0px));overflow:auto;display:flex;flex-direction:column;gap:12px;padding:14px;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out', entry: E.twoSections },
  { file: 'src/renderer/app/SectionCard.tsx', css: 'flex:none;height:1px;background:var(--border)', entry: E.twoSections },
  { file: 'src/renderer/app/Sidebar.tsx', css: 'position:relative;height:0;flex:none;z-index:1', entry: E.resize },
  { file: 'src/renderer/app/Sidebar.tsx', css: 'position:absolute;left:0;right:0;top:-3px;height:6px;display:flex;align-items:center;cursor:row-resize', entry: E.resize },
  { file: 'src/renderer/app/Sidebar.tsx', css: 'flex:1;height:1px;background:transparent', entry: E.resize },
  { file: 'src/renderer/app/Sidebar.tsx', css: 'display:flex;align-items:center;gap:6px;letter-spacing:inherit;text-transform:inherit', entry: E.modelsFold },
  { file: 'src/renderer/state/selectors/sidebar.ts', css: 'display:contents', entry: E.modelsFold },
  { file: 'src/renderer/state/selectors/sidebar.ts', css: 'flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto', entry: E.modelsFold },
  { file: 'src/renderer/app/Sidebar.tsx', css: 'display:flex;flex-direction:column;padding:2px 12px 8px 10px;flex:0 1 ${…}px;min-height:${…}px;overflow:auto', entry: E.storeysTail },
  { file: 'src/renderer/app/Sidebar.tsx', css: 'display:flex;flex-direction:column;padding:2px 12px 8px 10px;flex:0 ${…} auto;min-height:${…}${…}px;overflow:auto', entry: E.storeysTail },
  { file: 'src/renderer/app/Sidebar.tsx', css: 'flex:1;min-height:${…};overflow:auto;padding:2px 12px 12px 10px;display:flex;flex-direction:column;gap:1px', entry: E.treeFloor },
  { file: 'src/renderer/app/Sidebar.tsx', css: 'flex:1 1 ${…}px;min-height:${…}${…}px;overflow:auto;padding:2px 12px 12px 10px;display:flex;flex-direction:column;gap:1px', entry: E.treeFloor },
  { file: 'src/renderer/app/Sidebar.tsx', css: 'display:grid;grid-template-columns:24px minmax(0,1fr) auto 14px;align-items:center;gap:6px;padding:5px 4px 5px 6px;border-radius:6px;cursor:pointer;opacity:${…}', entry: E.eyeFirst },
  { file: 'src/renderer/app/Sidebar.tsx', css: 'display:grid;grid-template-columns:24px minmax(0,1fr);align-items:center;gap:6px;padding:3px 8px 3px 2px;border-left:2px solid ${…};background:${…};border-radius:0 6px 6px 0;cursor:pointer;opacity:${…}', entry: E.eyeFirst },
  { file: 'src/renderer/app/StatusBar.tsx', css: 'display:flex;align-items:center;gap:10px;font:400 11px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:7px 10px;box-shadow:var(--shadow);white-space:nowrap;pointer-events:auto', entry: E.bottomRow },
  { file: 'src/renderer/app/Toolbar.tsx', css: 'width:1px;height:18px;flex:none;background:var(--border-strong)', entry: E.toolbar },
  { file: 'src/renderer/app/Toolbar.tsx', css: 'font:500 12px/1 var(--mono);height:100%;padding:0 8px;display:flex;align-items:center;justify-content:center;border-right:1px solid var(--border);border-radius:6px 0 0 6px;color:${…};background:${…}', entry: E.unrecordedViewOrder },
  { file: 'src/renderer/app/Toolbar.tsx', css: 'font:500 12px/1 var(--mono);height:100%;padding:0 8px;display:flex;align-items:center;justify-content:center;border-radius:0 6px 6px 0;color:${…};background:${…}', entry: E.unrecordedViewOrder },
  { file: 'src/renderer/app/Toolbar.tsx', css: 'position:absolute;top:12px;left:12px;right:12px;width:fit-content;max-width:calc(100% - 24px);margin:0 auto;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;column-gap:4px;row-gap:5px;padding:5px 6px;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow)', entry: E.toolbar },
  { file: 'src/renderer/app/Toolbar.tsx', css: 'width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:transparent;color:var(--accent-ink);border:1px solid var(--accent)', entry: E.toolbar },
  { file: 'src/renderer/app/Trace.tsx', css: '', entry: E.trace },
  { file: 'src/renderer/app/Trace.tsx', css: 'font-weight:600', entry: E.trace },
  { file: 'src/renderer/app/Trace.tsx', css: 'font:400 11px/1 var(--mono)', entry: E.trace },
  { file: 'src/renderer/app/Trace.tsx', css: 'position:relative;overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--card)', entry: E.blocks },
  { file: 'src/renderer/app/Trace.tsx', css: 'border-collapse:collapse;width:100%', entry: E.blocks },
  { file: 'src/renderer/app/Trace.tsx', css: 'padding:${…}px ${…}px ${…}px ${…}px;background:var(--step-bg);font:500 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);vertical-align:bottom;text-align:${…}', entry: E.blocks },
  { file: 'src/renderer/app/Trace.tsx', css: 'padding:${…}px ${…}px ${…}px ${…}px;border-top:1px solid var(--border);vertical-align:baseline;font:400 11px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--ink);white-space:nowrap;text-align:${…}', entry: E.blocks },
  { file: 'src/renderer/app/Trace.tsx', css: 'padding:${…}px ${…}px ${…}px ${…}px;border-top:1px solid var(--border);vertical-align:baseline;font:400 11.5px/1.4 var(--sans);color:var(--ink);text-align:${…}', entry: E.blocks },
  { file: 'src/renderer/app/Trace.tsx', css: 'margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:${…}px', entry: E.blocks },
  { file: 'src/renderer/app/Trace.tsx', css: 'display:flex;align-items:baseline;gap:${…}px', entry: E.blocks },
  { file: 'src/renderer/app/Trace.tsx', css: 'position:relative;flex:none;text-align:right;font:400 11px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);min-width:${…}ch', entry: E.blocks },
  { file: 'src/renderer/app/Trace.tsx', css: 'position:relative;flex:none;width:8px;color:var(--faint)', entry: E.blocks },
  { file: 'src/renderer/app/Trace.tsx', css: 'flex:1;min-width:0', entry: E.blocks },
  { file: 'src/renderer/app/Vee.tsx', css: 'position:relative;flex:none;width:${…}px;height:${…}px;margin:${…}', entry: E.vee },
  { file: 'src/renderer/app/Vee.tsx', css: 'position:absolute;display:block;image-rendering:pixelated;pointer-events:none', entry: E.vee },
  { file: 'src/renderer/app/ViewsCard.tsx', css: 'font:500 13px/1.3 var(--sans);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;width:100%;min-width:0;height:1.3em;box-sizing:content-box;padding:0;margin:0;border:0;border-radius:0;outline:none;background:transparent', entry: E.rename },
  { file: 'src/renderer/app/VisibilityFrame.tsx', css: 'z-index:6;display:flex;align-items:center;gap:9px;padding:6px 8px 6px 12px;background:${…};border:1px solid ${…};border-radius:999px;box-shadow:var(--shadow);pointer-events:auto', entry: E.bottomRow },
]

/** Calls whose argument is computed (not read here), by file and source text, with the reason. */
const COMPUTED: readonly { file: string; text: string; reason: string }[] = []

// ── The test ─────────────────────────────────────────────────────────────────────────────────

describe('inline style strings are the design’s', () => {
  const designList = designStyles()
  const design = designOf(designList)
  const scans = SOURCES.map(scan)
  // A string written once and used in several places is one string to check.
  const found = [...new Map(scans.flatMap((x) => x.found).map((f) => [`${f.file}:${f.line}:${textOf(f.pieces)}`, f])).values()]
  const computed = scans.flatMap((x) => x.computed)

  it('a relative import is a /-separated repository path under either platform’s path rules', () => {
    for (const path of [nodePath.posix, nodePath.win32]) {
      expect(resolveModule('src/renderer/app/Sidebar.tsx', '../state/selectors/sidebar', path)).toBe(
        'src/renderer/state/selectors/sidebar.ts'
      )
    }
    expect(found.filter((f) => f.file.includes('\\')).map((f) => f.file)).toEqual([])
  })

  it('reads the design and the port, not two empty lists', () => {
    // A broken extraction would otherwise pass vacuously.
    expect(designList.length).toBeGreaterThan(300)
    expect(found.length).toBeGreaterThan(300)
  })

  it('the design interpolates values only, never a whole declaration (what a {{ … }} may stand for)', () => {
    const whole = designList.filter((v) => /(^|;)\s*\{\{/.test(v))
    expect(whole, 'a design style starts a declaration with {{ … }}; the matching rule above assumes it cannot').toEqual([])
  })

  const key = (file: string, css: string): string => `${file}\n${css}`
  const allowed = new Set(DEVIATIONS.map((d) => key(d.file, d.css)))

  it('every s(…) string is a style="…" of SGVue.dc.html, or a recorded deviation', () => {
    const bad = found
      .filter((f) => !inDesign(f.pieces, design) && !allowed.has(key(f.file, textOf(f.pieces))))
      .map((f) => `${f.file}:${f.line}  s('${textOf(f.pieces)}')`)
    expect(
      bad,
      `${bad.length} inline style string(s) are not in ${DESIGN} and not in DEVIATIONS:\n  ${bad.join('\n  ')}\n` +
        'Restore the design’s string, or record the deviation in docs/DEVIATIONS.md and list it in DEVIATIONS with that entry.'
    ).toEqual([])
  })

  it('every DEVIATIONS entry names its recorded entry and is still in the code', () => {
    const live = new Set(found.filter((f) => !inDesign(f.pieces, design)).map((f) => key(f.file, textOf(f.pieces))))
    const stale = DEVIATIONS.filter((d) => !live.has(key(d.file, d.css))).map((d) => `${d.file}  '${d.css}'`)
    expect(stale, `DEVIATIONS lists strings no longer in the code (or now the design’s) — remove them:\n  ${stale.join('\n  ')}`).toEqual([])
    const unnamed = DEVIATIONS.filter((d) => !/^\d{4}-\d{2}-\d{2} — \S/.test(d.entry) && !d.entry.startsWith('UNRECORDED — reported ')).map(
      (d) => `${d.file}  '${d.css}'`
    )
    expect(unnamed, `DEVIATIONS entries must name a dated entry of docs/DEVIATIONS.md or docs/DECISIONS-INDEX.md:\n  ${unnamed.join('\n  ')}`).toEqual([])
  })

  it('every computed s(…) argument is listed with its reason, and every listed one still exists', () => {
    const listed = new Set(COMPUTED.map((c) => key(c.file, c.text)))
    const unlisted = computed.filter((c) => !listed.has(key(c.file, c.text))).map((c) => `${c.file}:${c.line}  s(${c.text})`)
    expect(
      unlisted,
      `${unlisted.length} s(…) call(s) pass a style this test cannot read — write it as a literal or a const, or list it in COMPUTED with its reason:\n  ${unlisted.join('\n  ')}`
    ).toEqual([])
    const there = new Set(computed.map((c) => key(c.file, c.text)))
    const stale = COMPUTED.filter((c) => !there.has(key(c.file, c.text))).map((c) => `${c.file}  s(${c.text})`)
    expect(stale, `COMPUTED lists calls no longer in the code — remove them:\n  ${stale.join('\n  ')}`).toEqual([])
  })
})

