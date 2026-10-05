import './styles/fonts.css'
import './styles/design.css'
import './styles/hover.css'
import './styles/a11y.css'
import './styles/vee.css'

import { createRoot } from 'react-dom/client'
import App from './App'
import { installScheduleLink } from './model/schedule-link'

// 2026-09-25 — the Schedules window's private port, taken whenever main hands one over.
installScheduleLink()

// Not wrapped in <StrictMode>: from Phase 2 the viewer allocates a GPU context and a rAF
// loop on mount, and StrictMode double-invokes mount in development.
createRoot(document.getElementById('root')!).render(<App />)
