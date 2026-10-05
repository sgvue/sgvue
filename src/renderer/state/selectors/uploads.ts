/**
 * `renderVals()`'s upload block — `SGVue.dc.html:1926–1931`, as a pure function.
 *
 * The same row object feeds the landing page's list (`:775`) and the sidebar's (`:126`); the
 * two markups differ, the derived values do not.
 */
import { barColor, isBusy, pctLabel, sizeLabel, stageColor } from '../../../shared/upload'
import type { UploadRow } from '../shell'

export interface UploadView extends UploadRow {
  busy: boolean
  pctLabel: string
  size: string
  barColor: string
  stageColor: string
}

export function uploadRows(uploads: readonly UploadRow[]): UploadView[] {
  return uploads.map((u) => ({
    ...u,
    busy: isBusy(u),
    pctLabel: pctLabel(u),
    size: sizeLabel(u.kb),
    barColor: barColor(u.done),
    stageColor: stageColor(u)
  }))
}
