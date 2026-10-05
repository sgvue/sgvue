/**
 * Dev utility — NOT application code. What *this build* of the assistant can do.
 *
 * `docs/AI_REVIEW.md` §9 ranks nine capability gaps. Five of them have cases written already
 * (`cases.cjs`), because a suite that only measures today's build cannot tell you the day a
 * gap closes. Those cases carry `requires: [...]` and must report **n/a** until the build has
 * the capability — never a failure, which would read as a regression for ever.
 *
 * So the tags are **derived from the catalogue**, never listed by hand. `window.__sgvueDev
 * .capabilities()` hands back the raw facts — every tool's name, kind and input property
 * names, and the rule grammar's `op` enum — and the pure function below turns them into tags.
 * The day `select_elements` gains an `ids` input, `ids-input` becomes available and the two
 * cases that need it start being scored, with no edit here.
 *
 * Pure. `tests/unit/ai-eval-graders.test.ts` is its unit test.
 */

/** Every tag this suite knows about, with what it means and how it is detected. */
const CAPABILITY_TAGS = {
  base: 'Always available. The catalogue answered at all.',
  'ids-input': 'A view tool accepts a list of element ids, so a found set can be acted on.',
  'selection-target': 'A tool can act on, or rule against, the current selection.',
  'op-absent': 'The rule grammar can say "this property has no value".',
  'filter-sets': 'A tool can save the current stack under a name and recall it.',
  proximity: 'A tool answers "what is within N metres of this" without hand-written SQL.'
}

/** The view tools an id list would have to reach to be worth anything. */
const ID_TARGETS = ['select_elements', 'apply_visibility', 'color_by_property', 'set_filter_stack']

/**
 * Raw catalogue facts → the tags above.
 *
 * @param {{tools: {name:string, kind:string, inputs:string[], enums?: Record<string,string[]>}[], ruleOps: string[]}} snapshot
 * @returns {string[]} sorted tags this build has
 */
function capabilityTags(snapshot) {
  const tools = Array.isArray(snapshot && snapshot.tools) ? snapshot.tools : []
  const ops = Array.isArray(snapshot && snapshot.ruleOps) ? snapshot.ruleOps.map(String) : []
  const names = tools.map((t) => String(t.name))
  const inputsOf = (name) => {
    const t = tools.find((x) => String(x.name) === name)
    return t && Array.isArray(t.inputs) ? t.inputs.map(String) : []
  }
  /** One input's enum on one tool, as strings. `[]` when the build does not declare one. */
  const enumOf = (name, input) => {
    const t = tools.find((x) => String(x.name) === name)
    const e = t && t.enums ? t.enums[input] : null
    return Array.isArray(e) ? e.map(String) : []
  }
  const tags = new Set(['base'])

  if (ID_TARGETS.some((n) => inputsOf(n).some((p) => /^(ids|elementIds)$/.test(p)))) {
    tags.add('ids-input')
  }
  // The selection is reachable either as a tool input of its own or as a rule property.
  const selectionInput = tools.some(
    (t) =>
      t.kind === 'view' &&
      (Array.isArray(t.inputs) ? t.inputs : []).some((p) => /^(selection|useSelection|fromSelection)$/.test(String(p)))
  )
  if (selectionInput || tags.has('ids-input')) tags.add('selection-target')

  if (ops.some((op) => /absent|empty|exists|blank|missing/i.test(op))) tags.add('op-absent')
  /**
   * Filter sets can arrive as a tool of their own, or — as they did on 2026-09-20 — as four
   * operations on `manage_filters`, which is the tool the designed card's own controls map
   * onto. Both are the capability; only one of them is a tool name.
   */
  const setOps = enumOf('manage_filters', 'op')
  if (
    names.some((n) => /filter_set|filterset/i.test(n)) ||
    (setOps.some((op) => /_sets?$/.test(op)) && inputsOf('manage_filters').includes('name'))
  ) {
    tags.add('filter-sets')
  }
  if (names.some((n) => /near|nearby|proximity|within/i.test(n))) tags.add('proximity')

  return [...tags].sort()
}

/** The `requires` of one case against a build's tags. `null` when the case can be scored. */
function missingCapabilities(requires, have) {
  const need = Array.isArray(requires) ? requires : []
  const missing = need.filter((tag) => !have.includes(tag))
  return missing.length ? missing : null
}

module.exports = { CAPABILITY_TAGS, ID_TARGETS, capabilityTags, missingCapabilities }
