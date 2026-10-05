/**
 * The CORENET X / IFC-SG georeferencing readout, ported from `check_corenet_sg()` in a copy of
 * ifcgref's `app.py` (https://github.com/tudelft3d/ifcgref, MIT — credited in `NOTICE`).
 *
 * Singapore's submission gateway expects a model's real-world position on
 * **`IfcSite.ObjectPlacement`**, in SVY21 (EPSG:3414) metres — *not* on `IfcMapConversion`,
 * which is what the rest of the world uses and what most authoring tools write. A file can be
 * perfectly well georeferenced by IFC's own rules and still fail CORENET X, so the two are
 * reported separately and neither is called wrong.
 *
 * This is **read-only reporting**: it says what the file declares and where. It reaches the
 * user only through the assistant's `get_model_info` tool and the exports — never as new UI
 * (the fidelity contract's "no visible additions").
 *
 * The thresholds are ifcgref's own, unchanged: eastings 0–56 000 m, northings 15 000–60 000 m,
 * latitude 1.10–1.55°, longitude 103.5–104.1°.
 */
import type { Georeference } from './model-index.types'
import { isSvy21 } from './georef'

/** SVY21 easting bounds for Singapore, metres. `app.py:258`. */
export const SG_E_MIN = 0
export const SG_E_MAX = 56_000
/** SVY21 northing bounds, metres. `app.py:259`. */
export const SG_N_MIN = 15_000
export const SG_N_MAX = 60_000

export interface CorenetCheck {
  label: string
  pass: boolean
  value: string
}

export interface CorenetReadout {
  /** `pass` when every check passes, `fail` when one does not, `na` for a non-SG model. */
  status: 'pass' | 'fail' | 'na'
  /** Whether the file looks like a Singapore model at all. */
  isSg: boolean
  checks: CorenetCheck[]
  /** Why `na`, in one sentence, so a reader is never left guessing. */
  note: string
}

const m3 = (n: number): string => `${n.toFixed(3)} m`

/**
 * `check_corenet_sg()`, over the `Georeference` the index builder already read.
 *
 * Two inputs the Python reads straight off the entity graph are already resolved for us:
 * `georef.site.placement` is `IfcSite.ObjectPlacement` in world coordinates (metres), and
 * `georef.site.latitude/longitude` are the DMS compound angles converted to decimal degrees.
 *
 * That site is the **spatial-root** one — the `IfcSite` the `IfcProject` aggregates. A Revit
 * export can carry a dozen more (the reference model has 16, the extras being road-marking
 * families exported as sites) and only the root's placement is the model's position, so
 * reading "the first `IfcSite`" is a check that passes or fails on which entity happened to be
 * written first.
 */
export function corenetReadout(g: Georeference | null | undefined): CorenetReadout {
  if (!g) return { status: 'na', isSg: false, checks: [], note: 'No georeferencing was read.' }

  const site = g.site
  const placement = site?.placement
  const siteX = placement ? placement[0] : undefined
  const siteY = placement ? placement[1] : undefined
  const siteZ = placement ? placement[2] : undefined
  const refLat = site?.latitude
  const refLon = site?.longitude
  const crsIsSvy21 = isSvy21(g)

  const latInSg = refLat !== undefined && refLat >= 1.1 && refLat <= 1.55
  const lonInSg = refLon !== undefined && refLon >= 103.5 && refLon <= 104.1
  const siteInSvy21Sg =
    siteX !== undefined &&
    siteY !== undefined &&
    siteX >= SG_E_MIN &&
    siteX <= SG_E_MAX &&
    siteY >= SG_N_MIN &&
    siteY <= SG_N_MAX
  const isSg = (latInSg && lonInSg) || siteInSvy21Sg || crsIsSvy21

  if (!isSg) {
    return {
      status: 'na',
      isSg: false,
      checks: [],
      note: 'Not a Singapore model: no SVY21 CRS, and neither the site placement nor the reference latitude and longitude fall inside Singapore. CORENET X does not apply.'
    }
  }

  const eastSet = siteX !== undefined && siteY !== undefined && (siteX !== 0 || siteY !== 0)
  const eastInRange = siteX !== undefined && siteX >= SG_E_MIN && siteX <= SG_E_MAX
  const northInRange = siteY !== undefined && siteY >= SG_N_MIN && siteY <= SG_N_MAX
  const elevValue = site?.elevation ?? siteZ
  const elevSet = site?.elevation !== undefined || (siteZ !== undefined && siteZ !== 0)

  const checks: CorenetCheck[] = [
    {
      label: 'IfcSite placed at Eastings / Northings (not origin)',
      pass: eastSet,
      value: eastSet ? `E ${siteX!.toFixed(3)}, N ${siteY!.toFixed(3)}` : 'Site at origin'
    },
    {
      label: 'Eastings within SVY21 Singapore range',
      pass: eastInRange,
      value: siteX !== undefined ? m3(siteX) : '—'
    },
    {
      label: 'Northings within SVY21 Singapore range',
      pass: northInRange,
      value: siteY !== undefined ? m3(siteY) : '—'
    },
    {
      label: 'Elevation defined',
      pass: elevSet,
      value: elevValue !== undefined ? m3(elevValue) : '—'
    },
    {
      label: 'CRS declared as SVY21 (EPSG:3414)',
      pass: crsIsSvy21,
      value: crsIsSvy21 ? 'SVY21' : '—'
    }
  ]

  const status = checks.every((c) => c.pass) ? 'pass' : 'fail'
  return {
    status,
    isSg: true,
    checks,
    note:
      status === 'pass'
        ? 'The file carries its real-world position on IfcSite.ObjectPlacement in SVY21, which is what CORENET X reads.'
        : 'CORENET X reads IfcSite.ObjectPlacement, not IfcMapConversion. The failing checks below are what a submission would be missing.'
  }
}
