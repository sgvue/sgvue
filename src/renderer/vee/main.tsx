// The Ask Vee window's composition root — 2026-11-07. The chat panel (`app/ChatPanel.tsx`), in
// a window of its own: the design's styles, the port to the main window, and the panel.
import '../styles/fonts.css'
import '../styles/design.css'
import '../styles/hover.css'
import '../styles/a11y.css'
import '../styles/vee.css'

import { createRoot } from 'react-dom/client'
import ChatPanel from '../app/ChatPanel'
import { installVeeWindow, themeFromHash } from './link'

// The main window's theme at open (`main/vee-window.ts`); the snapshot carries later switches.
document.documentElement.dataset.theme = themeFromHash(location.hash)
installVeeWindow()

createRoot(document.getElementById('root')!).render(<ChatPanel />)
