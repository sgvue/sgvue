/**
 * Which elements are the **site** rather than the building (2026-09-24, owner-requested:
 * *"frame the camera on the building, not the site."*).
 *
 * The viewer frames the camera, sizes the grid bubbles and draws the level rings from the
 * *building box* — every element's box except these — and keeps the whole box for everything
 * that must still cover what is drawn (clip planes, fog, the shadow frustum, the ground).
 *
 * Read off the three real models this was built against: the 137.9 MB reference model's whole
 * box is 454 × 429 m because of one `IfcGeographicElement` (`SITEBOUNDARY`), while its walls
 * span 330 × 154 m; the external-works model is roads and footpaths as `IfcCivilElement`,
 * planting as `IfcGeographicElement`, landscape areas as `IfcSpace`. An `IfcSpace` never
 * widens a building — the walls around it do that — and a site-sized one (`AREA_LANDSCAPE`,
 * `ROADBUFFER`, `BUILDINGSETBACK`) widens it to the site, so every space is left out.
 *
 * A proxy is site only when its name or type says so: Revit exports a topography or a
 * toposolid, and the CORENET X site-coverage and site families, as `IfcBuildingElementProxy`.
 */
export const SITE_CLASSES: ReadonlySet<string> = new Set([
  'IfcSite',
  'IfcGeographicElement',
  'IfcCivilElement',
  'IfcExternalSpatialElement',
  'IfcSpace'
])

/**
 * Proxy names that mean the ground: `Topography`, `Toposolid:…`, `SITE COVERAGE 2`, `Site 2:Site 1`.
 * The word `site` also takes a proxy named e.g. "Site Office" — weighed and accepted: that only
 * leaves it out of the box the camera frames and lets it not hide a grid bubble; it is drawn,
 * picked, selected and hidden exactly as before.
 */
export const SITE_PROXY_NAME = /topograph|toposolid|\bsite\b/i

export function isSiteLike(e: { type: string; name?: string; objectType?: string }): boolean {
  if (SITE_CLASSES.has(e.type)) return true
  return e.type === 'IfcBuildingElementProxy' && SITE_PROXY_NAME.test(`${e.name ?? ''} ${e.objectType ?? ''}`)
}
