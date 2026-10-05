/**
 * Help › About — 2026-09-24, asked for by the owner: *"Under Help> About also add some short
 * story about us creating this."*
 *
 * No `electron` import here, so the text and the two option builders are unit-testable.
 * `menu.ts` shows them: macOS through the native About panel (`credits`), Windows and Linux
 * through a native message box attached to the window — OS chrome, not a designed surface.
 */

/** The story, in one place, so it stays a one-line edit. The owner's words, 2026-09-24. */
export const ABOUT_STORY =
  'SGVue was made by Yong Yen, an architectural professional who wanted a faster way to look inside IFC models — to open a federation, walk its storeys and grids, and get straight answers about what is in it, without risking a single change to the files. Claude, by Anthropic, was the builder: together they turned a finished design into a desktop app, one careful step at a time. Everything stays on this machine; the model is only ever read, never written.'

/**
 * The app's display name. `package.json` has no `productName` and nothing calls
 * `app.setName`, so `app.name` reads `sgvue` in dev; the About box names it itself instead of
 * renaming the app (which would also move the dev `userData` folder).
 */
export const ABOUT_NAME = 'SGVue'

/** `app.setAboutPanelOptions` — the macOS panel shows `credits` under the name and version. */
export function aboutPanelOptions(version: string): {
  applicationName: string
  applicationVersion: string
  version: string
  credits: string
} {
  return { applicationName: ABOUT_NAME, applicationVersion: version, version, credits: ABOUT_STORY }
}

/**
 * 2026-09-25 — the line naming the adapter that draws (`gpu-choice.ts`), under the story in the
 * Windows / Linux box. The macOS panel is unchanged.
 */
export const graphicsLine = (name: string): string => `Graphics: ${name}`

/** `dialog.showMessageBox` — the About box on Windows and Linux. */
export function aboutBoxOptions(
  version: string,
  graphics: string | null = null
): {
  type: 'info'
  title: string
  message: string
  detail: string
  buttons: string[]
  noLink: boolean
} {
  return {
    type: 'info',
    title: `About ${ABOUT_NAME}`,
    message: `${ABOUT_NAME} ${version}`,
    detail: graphics ? `${ABOUT_STORY}\n\n${graphicsLine(graphics)}` : ABOUT_STORY,
    buttons: ['OK'],
    noLink: true
  }
}

/**
 * Help › Check for updates… — 2026-09-25, asked for by the owner: *"add the check for updates
 * menu item."* 2026-09-28 — it opens the product site instead of the GitHub releases list
 * (*"From the next version, should Help › Check for updates open the new page instead of the
 * GitHub releases list?" → "Yes, open the page"*). The site reads `?v=` and says whether this
 * version is the latest. The page opens in the user's browser; there is no auto-updater and
 * this item makes no network call. (Since 2026-10-01 the app makes one at launch, in
 * `updates.ts`, and the landing page's notice opens this same page.)
 */
export const SITE_URL = 'https://sgvue.github.io/'

/** The page Check for updates… opens: the site, told this app's exact version. */
export const updatesUrl = (version: string): string => `${SITE_URL}?v=${encodeURIComponent(version)}`
