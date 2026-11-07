import './styles/fonts.css'
import './styles/design.css'
import './styles/hover.css'
import './styles/a11y.css'
import './styles/vee.css'

import { createRoot } from 'react-dom/client'
import App from './App'
import { installScheduleLink } from './model/schedule-link'
import { installVeeLink } from './model/vee-link'

// 2026-09-25 — the Schedules window's private port, taken whenever main hands one over.
installScheduleLink()
// 2026-11-07 — and the Ask Vee window's: the chat panel, in a window of its own.
installVeeLink()

// Not wrapped in <StrictMode>: from Phase 2 the viewer allocates a GPU context and a rAF
// loop on mount, and StrictMode double-invokes mount in development.
createRoot(document.getElementById('root')!).render(<App />)
