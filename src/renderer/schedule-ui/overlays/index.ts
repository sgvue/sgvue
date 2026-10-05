import type { ModelStore } from '../../../schedule/ifc/store';
import type { AppState } from '../state';
import type { Coverage } from '../coverage';
import { fieldBrowser } from './fieldBrowser';
import { formulaHelp } from './formulaHelp';
import { savedPanel } from './savedPanel';
import { templateGallery } from './templateGallery';

export function renderOverlay(state: AppState, store: ModelStore, cov: Coverage): string {
  if (state.overlay === 'fields') return fieldBrowser(state, store, cov);
  if (state.overlay === 'templates') return templateGallery(state, store);
  if (state.overlay === 'saved') return savedPanel(state, store);
  if (state.overlay === 'formula') return formulaHelp();
  return '';
}
