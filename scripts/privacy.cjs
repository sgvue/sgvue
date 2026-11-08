#!/usr/bin/env node
/**
 * The privacy scan (2026-11-07, core protection #12) — `npm run privacy`.
 *
 * The public repository is the source of truth and every push is public at once (CLAUDE.md,
 * Rules), so before every push the **privacy search** runs over what is pushed: no personal
 * account, e-mail address, home path or real project may appear, and the owner appears only as
 * Yong Yen (docs/DECISIONS.md, 2026-10-05; the searches recorded in PROGRESS.md looked for the
 * owner's account, profile and real names, home paths, e-mail addresses, and coordinates). This
 * is that search as a script, run in CI on every push and before every release build, and by
 * hand before a push:
 *
 *   npm run privacy                          every file git tracks (what CI runs)
 *   npm run privacy -- --commits <range>     also those commits' messages and identities,
 *                                            e.g. `--commits origin/main..HEAD` before a push
 *   npm run privacy -- --show                print what was found in full (local use only:
 *                                            CI logs of a public repository are public, so by
 *                                            default a finding is named by file:line and masked)
 *   node scripts/privacy.cjs --hash "<text>" print the entry that adds <text> to HASHED below
 *
 * Four rules. A finding prints `file:line  rule  detail` and the run exits 1.
 *
 * 1. **E-mail addresses** — any address except those in ALLOWED_EMAILS (each with its reason)
 *    and addresses at the domains reserved for examples (RFC 2606 / 6761: `example.com|net|org`,
 *    `.example`, `.invalid`, `.test`, `.localhost`).
 * 2. **Home paths** — `/Users/<name>`, `/home/<name>`, `C:\Users\<name>` (also `C:/Users/` and a
 *    string's `C:\\Users\\`), unless `<name>` is a placeholder (HOME_PLACEHOLDERS, or one that
 *    starts with `<`, `$`, `%`, `{` or `*`).
 * 3. **Private names and accounts, by hash only.** The repository is public, so the names the
 *    scan looks for cannot be written in it. HASHED holds SHA-256 hashes (with a fixed prefix)
 *    of normalised tokens — NFKC, lower case, words of letters and digits — and of runs of two
 *    or three consecutive words; the scan hashes the tree's words and runs and compares. An entry
 *    with `scope: 'path'` counts only as a path segment (right after `/` or `\`). To add one,
 *    run `--hash` and paste its line: the text itself never enters a tracked file. A real
 *    project's name or a real model's file name goes in the same way.
 * 4. **Real coordinates.** The only coordinates allowed are the synthetic set (CLAUDE.md, Rules:
 *    site 12345.457 / 23456.766) and the design's own mock base point (28500 / 30200,
 *    `SGVue.dc.html`). A real site cannot be listed here, even hashed — a coordinate is a
 *    number in a small range, and its hash is reversed by trying them all — so this is a band
 *    check instead, which names no site: a decimal number in the band of Singapore's SVY21 map
 *    coordinates (2 000 – 200 000, in metres, international or US survey feet, or millimetres
 *    with a decimal part) more than 500 from every allowed value, and a longitude in decimal
 *    degrees (4+ decimals) or as an IFC compound angle `(103, …` within Singapore's band (103.55°
 *    – 104.15°) other than the public centre of Singapore used in tests (103.8198). A number in
 *    that band that is not a coordinate is moved, or added to ALLOWED_NUMBERS with its reason.
 *
 * Binary files (a NUL byte in the first 8 000 bytes, git's own test) are read as Latin-1 for
 * rules 1–3 — an image's metadata can carry a home path or an author's address — but not for
 * rule 4, which in compressed data would only find noise.
 *
 * Not covered: anything not yet in HASHED — a name nobody has hashed is not found; and what is
 * pushed but not tracked (tags, branch names). Read the diff as well.
 */
'use strict'

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const PEPPER = 'sgvue-privacy/1\0'

/** Private names and accounts, as `sha256(PEPPER + normalised text)`; `n` is its word count. */
const HASHED = [
  // The owner's own name (git `user.name` on the maintainer's machine), both word orders.
  { h: '1e6e9b17a7825497152e4e4720e9dd1913f42c74d0fe3c7b6bc2bcda2f008e2e', n: 3, what: 'a private name' },
  { h: 'c849cf388aa1e53863192ccddfa1b39b4ebc8ac2674f0c70291f56205977b7c3', n: 3, what: 'a private name' },
  { h: 'd2e78cce08e649dddfd3d6bd8bdae722460693ab15356eacfb7baa8b91a9b5f0', n: 2, what: 'a private name' },
  // …and written as one word, both orders.
  { h: '1c01a36e0f85c9c15a491da02f4d19ecc947ee68f2d1444bdebf3eaad5f0dea6', n: 1, what: 'a private name' },
  { h: 'fc60089cf88669955c70e8f24be8759c5ff0bf2566f3bff68f69e8b30e6ba9d2', n: 1, what: 'a private name' },
  { h: '81fe892053e0c237b57dca6679b065ca67a6c49503d44cccd743f48afea057d8', n: 1, what: 'a private name' },
  // The local part of the owner's private e-mail address (also an account name).
  { h: '0f126c945e40f4feae5eb44fd2cac99dc37d7fafe7fd2e1dd07968a1cf497dd8', n: 1, what: 'a private account' },
  // The maintainer's macOS account, as a path segment (rule 2 finds it under /Users/ as well).
  { h: '6c290be26a745a0eae7a67a03d3edc700e129098a7aef89b5504bfd8c6a93595', n: 1, scope: 'path', what: 'a private account' }
]

/** E-mail addresses that may appear, each with the reason it is public. */
const ALLOWED_EMAILS = {
  // The project's public commit identity (CLAUDE.md, Rules).
  'releases@sgvue.invalid': 'the public commit identity',
  // The co-author trailer the AI coding assistant adds to commit messages.
  'noreply@anthropic.com': 'co-author trailer',
  // Third parties' own addresses inside licence texts the installers must carry verbatim
  // (THIRD_PARTY_NOTICES.md and its recorded data, scripts/third-party-notices.json).
  'chalkerx@gmail.com': 'licence text: safe-buffer-style MIT notice (Nikita Skovoroda)',
  'nathan@tootallnate.net': 'licence text: MIT notice (Nathan Rajlich)',
  'solar@openwall.com': 'licence text: web-ifc.wasm C++ library authors (Alexander Peslyak)',
  'rhash.admin@gmail.com': 'licence text: web-ifc.wasm C++ library authors (Aleksey Kravchenko)',
  'create@stephan-brumme.com': 'licence text: web-ifc.wasm C++ library authors (Stephan Brumme)',
  'steve@edmweb.com': 'licence text: web-ifc.wasm C++ library authors (Steve Reid)',
  'sneves@dei.uc.pt': 'licence text: web-ifc.wasm C++ library authors (Samuel Neves)',
  'dreamfly281@gmail.com': 'licence text: web-ifc.wasm C++ library authors (Yanbo Li)',
  'goldboar@163.com': 'licence text: web-ifc.wasm C++ library authors (Yanbo Li)',
  'shtylman@gmail.com': 'licence text: MIT notice (Roman Shtylman)',
  'jryans@gmail.com': 'licence text: timers-browserify MIT notice (J. Ryan Stinnett)',
  // npm's own deprecation message for old `glob` versions, inside package-lock.json.
  'i@izs.me': 'package-lock.json: npm deprecation message (glob)'
}

/** Reserved example domains (RFC 2606, RFC 6761). */
const RESERVED_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|example|invalid|test|localhost)$/i

/** Home-folder names that are placeholders, not people (lower case). */
const HOME_PLACEHOLDERS = new Set([
  'me', 'you', 'user', 'username', 'name', 'someone', 'somebody', 'example', 'runner',
  'shared', 'public', 'default', 'jane', 'janedo~1', 'john', 'doe'
])

/** Coordinate values that may appear (metres): the synthetic set and the design's mock. */
const ANCHORS_M = [12345.457, 23456.766, 28500, 30200]
/** …and the same in international and US survey feet. */
const ANCHORS = [...ANCHORS_M, ...ANCHORS_M.map((m) => m / 0.3048), ...ANCHORS_M.map((m) => (m * 3937) / 1200)]
const ANCHOR_RADIUS = 500
/** Numbers in the coordinate band that are not coordinates: `value: reason`. */
const DOOR_COST = "a door's synthetic cost in the schedule golden master (1250 + i × 333.33, tests/unit/schedule/support/fixture.ts)"
const MOCK_MM = 'a length in millimetres of the design\'s mock federation, in the schedule golden master (tests/unit/schedule/golden/federation-*.json)'
const ALLOWED_NUMBERS = {
  '2249.99': DOOR_COST,
  '2583.32': DOOR_COST,
  '2666.65': DOOR_COST,
  '2916.65': DOOR_COST,
  '3249.98': DOOR_COST,
  '3583.31': DOOR_COST,
  '3916.64': DOOR_COST,
  '2100.00': MOCK_MM,
  '2400.00': MOCK_MM,
  '3500.00': MOCK_MM,
  '5250.00': MOCK_MM,
  '5600.00': MOCK_MM,
  '8550.00': MOCK_MM,
  '18200.00': MOCK_MM,
  '24600.00': MOCK_MM
}
/** The public centre of Singapore (1.3521° N, 103.8198° E), used by tests as a site. */
const LONGITUDE_ANCHORS = [103.8198]

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:[a-z]{2,}|[A-Z]{2,})/g
const HOME =
  /(?:\/Users\/|\/home\/|[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/))([^/\\\s"'`()<>[\]{},;:|]*)/gi
const WORD = /[\p{L}\p{N}]+/gu
// Metres or feet: 4–6 digits and at least two decimals; millimetres: 7–9 digits and a decimal.
const DECIMAL = /(?<![\w.\\])-?(?:\d{4,6}\.\d{2,}|(\d{7,9})\.\d+)(?!\d)/g
const LONGITUDE = /(?<![\w.])(10[34]\.\d{4,})(?!\d)/g
const COMPOUND_LONGITUDE = /\(\s*10[34]\s*,\s*-?\d{1,2}\s*,\s*-?\d{1,2}\s*[,)]/g

const sha = (text) => createHash('sha256').update(PEPPER + text).digest('hex')
const normalise = (text) => text.normalize('NFKC').toLowerCase()

/** What a finding shows: in full with --show, else its first character and its length. */
let SHOW = false
const masked = (s) => (SHOW ? s : `${s[0]}… (${s.length} characters)`)

const BY_HASH = new Map(HASHED.map((e) => [e.h, e]))
const MAX_N = Math.max(...HASHED.map((e) => e.n))
const gramCache = new Map()
function hashedEntry(gram) {
  let hit = gramCache.get(gram)
  if (hit === undefined) {
    hit = BY_HASH.get(sha(gram)) ?? null
    gramCache.set(gram, hit)
  }
  return hit
}

function emailAllowed(address) {
  const a = address.toLowerCase()
  return Object.hasOwn(ALLOWED_EMAILS, a) || RESERVED_DOMAIN.test(a.slice(a.indexOf('@') + 1))
}

function homeAllowed(segment) {
  const s = segment.toLowerCase()
  return s === '' || /^[<$%{*]/.test(segment) || HOME_PLACEHOLDERS.has(s)
}

const nearAny = (v, anchors, r) => anchors.some((a) => Math.abs(Math.abs(v) - a) <= r)

/**
 * Every finding in one text: `{ index, rule, detail }`. `coordinates` is false for binary data.
 */
function scanText(text, { coordinates = true } = {}) {
  const found = []
  for (const m of text.matchAll(EMAIL)) {
    if (!emailAllowed(m[0])) found.push({ index: m.index, rule: 'e-mail', detail: masked(m[0]) })
  }
  for (const m of text.matchAll(HOME)) {
    // A folder name with a space ("Jane Doe") is read to its first word, which decides.
    if (!homeAllowed(m[1])) found.push({ index: m.index, rule: 'home path', detail: SHOW ? m[0] : `home folder ${masked(m[1])}` })
  }
  const lower = normalise(text)
  const words = [...lower.matchAll(WORD)]
  for (let k = 0; k < words.length; k++) {
    let gram = ''
    for (let n = 1; n <= MAX_N && k + n <= words.length; n++) {
      gram = n === 1 ? words[k][0] : `${gram} ${words[k + n - 1][0]}`
      const e = hashedEntry(gram)
      if (!e || e.n !== n) continue
      const before = lower[words[k].index - 1]
      if (e.scope === 'path' && before !== '/' && before !== '\\') continue
      found.push({ index: words[k].index, rule: 'private name', detail: SHOW ? gram : `${e.what} (HASHED)` })
    }
  }
  if (coordinates) {
    for (const m of text.matchAll(DECIMAL)) {
      const raw = Number(m[0])
      const mm = m[1] !== undefined
      const v = mm ? raw / 1000 : raw
      if (Math.abs(v) < 2000 || Math.abs(v) > 200000) continue
      if (nearAny(v, ANCHORS, ANCHOR_RADIUS) || Object.hasOwn(ALLOWED_NUMBERS, m[0].replace(/^-/, ''))) continue
      found.push({
        index: m.index,
        rule: 'coordinate',
        detail: SHOW ? m[0] : `a number in the map-coordinate band${mm ? ' (as millimetres)' : ''}, not the synthetic set`
      })
    }
    for (const m of text.matchAll(LONGITUDE)) {
      const v = Number(m[1])
      if (v < 103.55 || v > 104.15 || nearAny(v, LONGITUDE_ANCHORS, 0.0005)) continue
      found.push({ index: m.index, rule: 'coordinate', detail: SHOW ? m[0] : 'a longitude in the band of a real site' })
    }
    for (const m of text.matchAll(COMPOUND_LONGITUDE)) {
      found.push({ index: m.index, rule: 'coordinate', detail: SHOW ? m[0] : 'an IFC compound longitude in the band of a real site' })
    }
  }
  return found
}

/** 1-based line of each index, by binary search over the line starts. */
function lineOf(text) {
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return (index) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0)
}

/** Findings over every tracked file: `{ where, rule, detail }`, and how many were binary. */
function scanTree(root = ROOT) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const out = []
  let binary = 0
  let scanned = 0
  for (const f of files) {
    let buf
    try {
      buf = readFileSync(join(root, f))
    } catch {
      continue // tracked, deleted in the working copy: nothing on disk to push
    }
    scanned++
    const bin = isBinary(buf)
    if (bin) binary++
    const text = buf.toString(bin ? 'latin1' : 'utf8')
    const line = lineOf(text)
    for (const x of scanText(text, { coordinates: !bin })) out.push({ where: `${f}:${line(x.index)}`, ...x })
  }
  return { findings: out, scanned, binary }
}

/** Findings over the messages, authors and committers of the commits in `range`. */
function scanCommits(range, root = ROOT) {
  const log = execFileSync('git', ['log', '--format=%H%x00%an <%ae>%n%cn <%ce>%n%B%x1e', range], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  })
  const out = []
  let count = 0
  for (const entry of log.split('\x1e')) {
    const at = entry.indexOf('\0')
    if (at === -1) continue
    count++
    const sha1 = entry.slice(0, at).trim().slice(0, 12)
    const text = entry.slice(at + 1)
    const line = lineOf(text)
    for (const x of scanText(text)) {
      // GitHub's no-reply addresses belong to bots and accounts that chose to hide theirs.
      if (x.rule === 'e-mail' && /@users\.noreply\.github\.com$/i.test(text.slice(x.index).split(/[\s>]/)[0])) continue
      out.push({ where: `commit ${sha1} line ${line(x.index)}`, ...x })
    }
  }
  return { findings: out, count }
}

module.exports = { scanText, scanTree, scanCommits, sha, normalise, HASHED }

if (require.main === module) {
  const args = process.argv.slice(2)
  SHOW = args.includes('--show')
  const hashAt = args.indexOf('--hash')
  if (hashAt !== -1) {
    const text = args[hashAt + 1]
    if (!text) {
      console.error('usage: node scripts/privacy.cjs --hash "<text>"')
      process.exit(2)
    }
    const norm = normalise(text)
    const n = [...norm.matchAll(WORD)].length
    const words = [...norm.matchAll(WORD)].map((m) => m[0]).join(' ')
    if (n > 3) console.error(`warning: ${n} words; the scan compares runs of at most 3 — hash a shorter part`)
    console.log(`  { h: '${sha(words)}', n: ${n}, what: 'a private name' },`)
    process.exit(0)
  }
  const tree = scanTree()
  const findings = [...tree.findings]
  let commitNote = ''
  const commitsAt = args.indexOf('--commits')
  if (commitsAt !== -1) {
    const c = scanCommits(args[commitsAt + 1])
    findings.push(...c.findings)
    commitNote = `, ${c.count} commit(s)`
  }
  for (const f of findings) console.log(`${f.where}  ${f.rule}  ${f.detail}`)
  const summary = `privacy: ${tree.scanned} tracked files (${tree.binary} binary)${commitNote}, ${findings.length} finding(s)`
  if (findings.length) {
    console.error(
      `${summary}. Nothing personal may reach the public repository: take it out (the synthetic ` +
        'set for coordinates; Jane Doe or a placeholder for a person or a path), or, for a public ' +
        "third party's address or a number that is not a coordinate, add it to the allow-list in " +
        'scripts/privacy.cjs with its reason.'
    )
    process.exit(1)
  }
  console.log(`${summary} — PASS`)
}
