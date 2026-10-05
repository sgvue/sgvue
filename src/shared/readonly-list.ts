/**
 * The read-only contract, in one place (plan §3.2).
 *
 * This file is the single permitted mention of the forbidden names: `ifc-source.ts` will
 * import FORBIDDEN_IFC_WRITE_API to overwrite those methods on the web-ifc `IfcAPI`
 * instance with throwing stubs, and `tests/readonly-guard.test.ts` fails the build if any
 * of them appears anywhere else under `src/`.
 */

/** web-ifc APIs that create, mutate or export IFC data. SGVue never calls one. */
export const FORBIDDEN_IFC_WRITE_API = [
  'WriteLine',
  'WriteLines',
  'DeleteLine',
  'SaveModel',
  'SaveModelToCallback',
  'CreateModel',
  'CreateIfcEntity',
  'setPropertySets',
  'setMaterialsProperties',
  'ExportFileAsIFC'
] as const

/**
 * The only modules allowed to write to disk — settings; sessions with recents; and, since
 * 2026-09-25 (phase 4 of the Schedules port, owner-approved), exports, which writes only to a
 * path the user picked in the native Save dialog in the same call (`CLAUDE.md` rules). A fourth
 * is a design change, not a convenience.
 */
export const FS_WRITER_ALLOW_LIST = [
  'src/main/settings.ts',
  'src/main/sessions.ts',
  'src/main/exports.ts'
] as const
