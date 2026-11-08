import type { ModelStore } from '../../../schedule/ifc/store';
import type { AppState } from '../state';
import type { Coverage } from '../coverage';
import { calcOverlay } from './calcOverlay';
import { formulaHelp } from './formulaHelp';
import { renderLibrary } from './library';

export function renderOverlay(state: AppState, store: ModelStore, _cov: Coverage): string {
  if (state.overlay === 'calc') return calcOverlay(state, store);
  if (state.overlay === 'library') return renderLibrary(state, store);
  if (state.overlay === 'formula') return formulaHelp();
  return '';
}
