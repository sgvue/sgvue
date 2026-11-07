#!/usr/bin/env node
/**
 * The design-reference hash pin (2026-11-07, core protection #2).
 *
 * `design-reference/` is the specification of record and is read-only (CLAUDE.md, Rules): the
 * code is ported to match it, never the other way round. This pins it. Every file under it has
 * its SHA-256 in `tests/design-reference.sha256`, and `tests/unit/design-reference-pin.test.ts`
 * (in `npm test`, so in CI) fails, naming the file, when one is changed, added or removed.
 *
 *   node scripts/design-reference-pin.cjs           check, as the test does; exit 1 on a difference
 *   node scripts/design-reference-pin.cjs --write   rewrite the list from the files as they are
 *
 * `--write` is the only way to update the list, and it is meant to be a deliberate act: a new
 * design handoff from the owner, recorded as an allowed deviation or a decision, with the
 * rewritten list in the same commit, where the reviewer sees exactly which files of the
 * specification moved.
 *
 * What "every file" means: what git tracks under `design-reference/`, plus any untracked file
 * there that `.gitignore` does not exclude — so a new file fails the test before it is ever
 * committed, and the design tool's runtime files a maintainer may keep in place (`.gitignore`,
 * 2026-10-05) are not part of the specification. A tracked file deleted from the disk is
 * reported as removed.
 *
 * The bytes hashed are the working copy's. `.gitattributes` gives every checkout LF line
 * endings (`* text=auto eol=lf`) and marks the binary types the folder holds (`.woff2`,
 * `.webp`, `.jpg`) `binary`, so a Windows checkout has the same bytes, and the same hashes.
 */
'use strict'

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const DIR = 'design-reference'
const LIST = join(ROOT, 'tests', 'design-reference.sha256')

/** The files the pin covers, repository-relative with `/`, in byte order. */
function pinnedFiles(root = ROOT) {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', DIR],
    { cwd: root, encoding: 'utf8' }
  )
  const files = new Set(out.split('\0').filter((f) => f && existsSync(join(root, f))))
  return [...files].sort()
}

/** path → SHA-256 (hex) of the file's bytes on disk. */
function currentHashes(root = ROOT) {
  const map = new Map()
  for (const f of pinnedFiles(root)) {
    map.set(f, createHash('sha256').update(readFileSync(join(root, f))).digest('hex'))
  }
  return map
}

/** The list's own format: `sha256sum`'s, `<hex>  <path>`, one line a file, in byte order. */
function formatList(map) {
  return [...map.keys()].sort().map((f) => `${map.get(f)}  ${f}`).join('\n') + '\n'
}

/** path → hash, read from the committed list. */
function parseList(text) {
  const map = new Map()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line)
    if (!m) throw new Error(`tests/design-reference.sha256: not a "<sha256>  <path>" line: ${line}`)
    map.set(m[2], m[1])
  }
  return map
}

/** One sentence per file that differs: changed, added (not in the list) or removed. */
function differences(pinned, current) {
  const out = []
  for (const [f, h] of current) {
    if (!pinned.has(f)) out.push(`added: ${f}`)
    else if (pinned.get(f) !== h) out.push(`changed: ${f}`)
  }
  for (const f of pinned.keys()) if (!current.has(f)) out.push(`removed: ${f}`)
  return out.sort()
}

module.exports = { LIST, pinnedFiles, currentHashes, formatList, parseList, differences }

if (require.main === module) {
  const current = currentHashes()
  if (process.argv.includes('--write')) {
    writeFileSync(LIST, formatList(current))
    console.log(`wrote ${current.size} hashes to tests/design-reference.sha256`)
  } else {
    const diff = differences(parseList(readFileSync(LIST, 'utf8')), current)
    if (diff.length) {
      console.error(diff.join('\n'))
      process.exit(1)
    }
    console.log(`design-reference: ${current.size} files match tests/design-reference.sha256`)
  }
}
