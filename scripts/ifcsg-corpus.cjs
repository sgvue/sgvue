#!/usr/bin/env node
/**
 * Dev utility — NOT application code. Writes `src/shared/ifcsg-cop.json`, the pinned and trimmed
 * copy of the IFC-SG corpus that the assistant's `ifcsg_columns` tool reads (2026-11-22).
 *
 * The source is the corpus published at https://ifcsg-md.pages.dev/ — one record per IFC+SG
 * classification (entity + sub-type) with every property the CORENET X Code of Practice's tables
 * list for it. CC BY 4.0; an independent compilation, not an official BCA publication (NOTICE).
 *
 * The app never fetches it: this script is run by hand when the corpus has a new revision, and
 * its output is committed. It keeps only what the tool needs — the key, the entity and sub-type,
 * the component and CoP pages, whether no property is required, and per property its name, type
 * and unit, each name once (a classification several tables list carries a name more than once).
 * Allowed values, examples and footnotes are left out. It records the source file's SHA-256, the
 * corpus version and revision, the date it was retrieved, and a hash of what it wrote, which
 * `tests/unit/ifcsg-cop.test.ts` recomputes.
 *
 *   node scripts/ifcsg-corpus.cjs                       # fetch both files from the site
 *   node scripts/ifcsg-corpus.cjs --source <classifications.json> --manifest <manifest.json> \
 *                                 [--retrieved YYYY-MM-DD]
 */
'use strict'
const { createHash } = require('node:crypto')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SITE = 'https://ifcsg-md.pages.dev/'
const SOURCE_URL = `${SITE}corpus/_reference/classifications.json`
const MANIFEST_URL = `${SITE}corpus/_meta/manifest.json`
const OUT = join(__dirname, '..', 'src', 'shared', 'ifcsg-cop.json')

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function bytesOf(path, url) {
  if (path) return readFileSync(path)
  const res = await fetch(url, { headers: { 'User-Agent': 'sgvue-corpus-script' } })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** The corpus, trimmed to what `ifcsg_columns` reads. Pure: the test can run it too. */
function trim(source) {
  return source.classifications.map((c) => {
    const sources = []
    for (const s of c.sources || []) {
      const pages = Array.isArray(s.page_range) ? [s.page_range[0], s.page_range[1]] : null
      if (!sources.some((x) => x.component === s.component && JSON.stringify(x.pages) === JSON.stringify(pages))) {
        sources.push({ component: s.component, pages })
      }
    }
    const properties = []
    for (const p of c.parameters || []) {
      if (properties.some((x) => x.name === p.property)) continue
      properties.push({ name: p.property, type: p.type, ...(p.unit ? { unit: p.unit } : {}) })
    }
    return {
      key: c.key,
      entity: c.ifc_entity,
      subtype: c.ifc_subtype || null,
      sources,
      noPropertiesRequired: !!c.no_properties_required,
      properties
    }
  })
}

/** One classification a line, so a new revision reads as a diff of the records that changed. */
function render(doc) {
  const head = JSON.stringify({ ...doc, classifications: [] }, null, 2).replace(/"classifications": \[\]\n}$/, '"classifications": [\n')
  return head + doc.classifications.map((c) => `    ${JSON.stringify(c)}`).join(',\n') + '\n  ]\n}\n'
}

async function main() {
  const raw = await bytesOf(arg('source'), SOURCE_URL)
  const manifest = JSON.parse((await bytesOf(arg('manifest'), MANIFEST_URL)).toString('utf8'))
  const source = JSON.parse(raw.toString('utf8'))
  const classifications = trim(source)
  const doc = {
    source: {
      title: 'IFC-SG corpus — reference classifications',
      site: SITE,
      url: SOURCE_URL,
      cop: 'CORENET X Code of Practice, 4th Edition',
      corpusVersion: String(manifest.corpus_version),
      revision: manifest.revision,
      generated: manifest.generated,
      retrieved: arg('retrieved') || new Date().toISOString().slice(0, 10),
      license: 'CC BY 4.0',
      note: 'An independent compilation, not an official BCA publication.',
      sha256: createHash('sha256').update(raw).digest('hex')
    },
    contentSha256: createHash('sha256').update(JSON.stringify(classifications)).digest('hex'),
    classifications
  }
  writeFileSync(OUT, render(doc))
  const props = classifications.reduce((n, c) => n + c.properties.length, 0)
  console.log(`wrote ${OUT}: ${classifications.length} classifications, ${props} properties; source sha256 ${doc.source.sha256}`)
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e)
    process.exit(1)
  })
}

module.exports = { trim, render }
