/**
 * What a tool is doing, in words — `SGVue.dc.html`'s own `stage()` calls (`:1364`, `:1379`,
 * `:1391`, `:1406`, …), reduced to the part that does not need the arguments.
 *
 * The design showed these in its busy row. Since 2026-10-01 that row is the assistant's live
 * reply (the owner's "Ask Vee" handoff, `ai/trace.ts`), and a phrase is what the reply's ticker
 * says — capitalised, with no count — for an executed tool whose input carries no rule: a
 * **note** step (`noteFor`, `ai/trace-facts.ts`). A tool with rules says what it filters and
 * what it checks instead.
 *
 * Every tool in the catalogue has a phrase (`tests/unit/trace-facts.test.ts` keeps it so): the
 * fallback, `running <tool name>`, would put an internal name in front of the user.
 *
 * 2026-10-02 — two tools now do things their one phrase would misstate: `select_elements` can
 * clear the selection, and `apply_visibility` can undo. `toolPhrase` reads the call's input for
 * those two, and for every other call is the table below.
 *
 * The same day, phase 2: `manage_views` and `manage_markups` each have a phrase, and each of
 * their operations its own — listing, saving, restoring and renaming a viewpoint are not one
 * thing, nor are listing markups and zooming to one — as has `manage_filters`' `update`, which
 * rearranges nothing.
 *
 * Phase 3, the consent gate: a call that only **asks** says that it is asking — the ticker must
 * not read "deleting a viewpoint" over a request the user has yet to answer. `request_user_action`
 * has a phrase for each thing it asks, and so have the three gated operations.
 *
 * Phase 4: `manage_schedules` says which of the Schedules window's controls it is working — and,
 * for the three that only ask, that it is asking — and `manage_markups` says when it is placing
 * a markup rather than reading the list.
 */
export const TOOL_STAGE: Record<string, string> = {
  summarize_elements: 'totalling quantities',
  audit_model: 'auditing model data',
  clash_check: 'testing for interference',
  set_filter_stack: 'building filter steps',
  manage_filters: 'rearranging filter steps',
  query_elements: 'querying elements',
  apply_visibility: 'updating the view',
  select_elements: 'selecting elements',
  set_storeys: 'setting storey visibility',
  activate_model: 'switching active model',
  set_view: 'moving the camera',
  set_section: 'cutting the section',
  toggle_display: 'toggling display',
  color_by_property: 'colouring the model',
  color_models: 'applying model colours',
  get_element: 'reading the element record',
  get_entity_raw: 'reading the STEP line',
  list_values: 'listing values',
  find_properties: 'searching property names',
  search: 'searching the model',
  get_spatial_tree: 'reading the spatial structure',
  get_relationships: 'reading relationships',
  get_model_info: 'reading the file header',
  get_view_state: 'reading the current view',
  measure_between: 'measuring',
  find_nearby: 'finding what is nearby',
  query_sql: 'querying the model database',
  set_models: 'showing and hiding models',
  set_interface: 'adjusting the interface',
  manage_views: 'reading the saved viewpoints',
  manage_markups: 'reading the markups',
  request_user_action: 'asking you to decide',
  manage_schedules: 'working in the Schedules window',
  make_schedule: 'building the schedule',
  get_schedule: 'reading the schedule',
  export_schedule: 'opening the Save dialog',
  color_by_schedule_column: 'colouring the model by the column'
}

/** `request_user_action`, action by action: what is being asked of the user. */
const REQUEST_PHRASE: Record<string, string> = {
  open_files: 'opening the Open dialog',
  open_recent: 'asking to open a recent file',
  unload_model: 'asking to unload a model',
  copy_link: 'asking to copy the link',
  copy_guids: 'asking to copy GlobalIds'
}

/** `manage_schedules`, operation by operation. The three that only ask say so. */
const SCHEDULES_PHRASE: Record<string, string> = {
  open: 'opening the Schedules window',
  undo: 'undoing in the Schedules window',
  redo: 'redoing in the Schedules window',
  templates: 'reading the schedule templates',
  apply_template: 'applying a schedule template',
  saved_list: 'reading the saved schedules',
  load: 'loading a saved schedule',
  save: 'saving the schedule setup',
  rename: 'renaming a saved schedule',
  duplicate: 'copying a saved schedule',
  delete: 'asking to delete a saved schedule',
  // (It asks in that window first: the print dialog opens only on the user's click there.)
  print: 'asking to open the print dialog',
  open_file: 'opening the Open dialog'
}

/**
 * The phrase for one call — the tool's own, unless what the call asks for is something that
 * phrase would misstate. `input` is whatever the executor was handed; it is only ever compared
 * with a string, so nothing it holds can make this throw. `undefined` when the tool has no
 * phrase at all.
 */
export function toolPhrase(
  name: string,
  input?: Readonly<Record<string, unknown>> | null
): string | undefined {
  if (name === 'select_elements') {
    if (input?.mode === 'clear') return 'clearing the selection'
    if (input?.mode === 'add' || input?.mode === 'remove') return 'changing the selection'
  }
  if (name === 'apply_visibility') {
    if (input?.action === 'undo') return 'undoing the last change'
    if (input?.action === 'redo') return 'redoing the last change'
  }
  if (name === 'manage_filters' && input?.op === 'update') return 'changing a filter step'
  if (name === 'manage_filters' && input?.op === 'delete_set') return 'asking to forget a filter set'
  if (name === 'manage_views') {
    if (input?.op === 'save') return 'saving a viewpoint'
    if (input?.op === 'restore') return 'restoring a viewpoint'
    if (input?.op === 'rename') return 'renaming a viewpoint'
    if (input?.op === 'delete') return 'asking to delete a viewpoint'
  }
  if (name === 'manage_markups') {
    if (input?.op === 'focus') return 'zooming to a markup'
    if (input?.op === 'place_spot') return 'placing a spot coordinate'
    if (input?.op === 'place_measure') return 'placing a measurement'
    if (input?.op === 'show') return 'changing a spot tag'
    if (input?.op === 'delete') return 'asking to delete a markup'
    if (input?.op === 'clear') return 'asking to clear the markups'
  }
  if (name === 'manage_schedules') {
    const op = input?.op
    if (typeof op === 'string' && Object.prototype.hasOwnProperty.call(SCHEDULES_PHRASE, op)) {
      return SCHEDULES_PHRASE[op]
    }
  }
  if (name === 'request_user_action') {
    const action = input?.action
    if (typeof action === 'string' && Object.prototype.hasOwnProperty.call(REQUEST_PHRASE, action)) {
      return REQUEST_PHRASE[action]
    }
  }
  // An own entry only: `TOOL_STAGE['constructor']` is not a phrase.
  return Object.prototype.hasOwnProperty.call(TOOL_STAGE, name) ? TOOL_STAGE[name] : undefined
}
