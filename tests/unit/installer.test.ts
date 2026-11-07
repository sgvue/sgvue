/**
 * The Windows installer's configuration, read from the files electron-builder reads.
 *
 * The setup .exe is also the updater (the owner publishes a new one and the user runs it over
 * the installed app), so it is an assisted wizard - Welcome, progress, Finish - whose pages say
 * whether it is installing, updating or repairing (`build/installer.nsh`). What that rests on is
 * configuration a later edit could quietly undo: `oneClick` back to its default brings the
 * one-click box back, `createDesktopShortcut: always` recreates a shortcut the user deleted on
 * every update, a licence file dropped into `build/` adds a licence page, and a bitmap of the
 * wrong size or depth is stretched or refused by NSIS. None of it needs Windows or a build.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

/** The `nsis:` block's own `key: value` lines - enough YAML for a flat block. */
function nsisOptions(): Record<string, string> {
  const lines = read('electron-builder.yml').split(/\r?\n/)
  const start = lines.findIndex((l) => /^nsis:\s*$/.test(l))
  expect(start, 'electron-builder.yml has an nsis: block').toBeGreaterThan(-1)
  const out: Record<string, string> = {}
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const m = /^ {2}([A-Za-z]+):\s*(.*?)\s*$/.exec(line)
    if (m) out[m[1]] = m[2]
  }
  return out
}

/** Width, height, bits per pixel and compression, out of a BMP's own headers. */
function bmp(rel: string): { width: number; height: number; bpp: number; compression: number } {
  const b = readFileSync(join(ROOT, rel))
  expect(b.toString('latin1', 0, 2), `${rel} is a BMP`).toBe('BM')
  return { width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)), bpp: b.readUInt16LE(28), compression: b.readUInt32LE(30) }
}

describe('Windows installer', () => {
  const nsis = nsisOptions()

  it('is the assisted wizard, per-user, with no folder page', () => {
    expect(nsis.oneClick).toBe('false')
    expect(nsis.perMachine ?? 'false').toBe('false')
    expect(nsis.allowToChangeInstallationDirectory ?? 'false').toBe('false')
    // English only, like every text the pages show.
    expect(nsis.multiLanguageInstaller).toBe('false')
  })

  it('lets the Finish page decide the desktop shortcut rather than recreating it on every update', () => {
    expect(nsis.createDesktopShortcut).toBe('true')
  })

  it('still includes build/installer.nsh, with the GPU-preference macros guarded on an update', () => {
    expect(nsis.include).toBe('build/installer.nsh')
    const nsh = read('build/installer.nsh')
    expect(nsh).toMatch(/!macro customInstall\b/)
    expect(nsh).toMatch(/!macro customUnInstall\s+\$\{ifNot\} \$\{isUpdated\}/)
    // The "Only for me / Anyone" page is skipped by forcing the per-user mode.
    expect(nsh).toMatch(/!macro customInstallMode\s+StrCpy \$isForceCurrentInstall "1"/)
  })

  it('has no licence file in build/, which electron-builder would turn into a licence page', () => {
    const licences = readdirSync(join(ROOT, 'build')).filter((f) => /^(license|eula)([._]|$)/i.test(f))
    expect(licences).toEqual([])
  })

  it.each([
    ['installerSidebar', 164, 314],
    ['uninstallerSidebar', 164, 314],
    ['installerHeader', 150, 57]
  ])('%s is a 24-bit uncompressed BMP of %i x %i', (key, width, height) => {
    const file = nsis[key]
    expect(file, `electron-builder.yml sets nsis.${key}`).toMatch(/^build\/.+\.bmp$/)
    expect(existsSync(join(ROOT, file))).toBe(true)
    expect(bmp(file)).toEqual({ width, height, bpp: 24, compression: 0 })
  })
})

/**
 * 2026-11-08 — the `.sgvue` project file, phase 5 (plan D10): both installers register the file
 * type. electron-builder writes it from `fileAssociations` — macOS `CFBundleDocumentTypes`, NSIS
 * APP_ASSOCIATE under SHELL_CONTEXT (HKCU for this per-user installer) and APP_UNASSOCIATE in the
 * uninstaller — so the block is the whole of it, and `build/installer.nsh` is not touched.
 */
describe('the .sgvue file association', () => {
  function associations(): Record<string, string>[] {
    const lines = read('electron-builder.yml').split(/\r?\n/)
    const start = lines.findIndex((l) => /^fileAssociations:\s*$/.test(l))
    expect(start, 'electron-builder.yml has a fileAssociations: block').toBeGreaterThan(-1)
    const out: Record<string, string>[] = []
    for (const line of lines.slice(start + 1)) {
      if (/^\S/.test(line)) break
      const item = /^ {2}- ([A-Za-z]+):\s*(.*?)\s*$/.exec(line)
      const more = /^ {4}([A-Za-z]+):\s*(.*?)\s*$/.exec(line)
      if (item) out.push({ [item[1]]: item[2] })
      else if (more && out.length) out[out.length - 1][more[1]] = more[2]
    }
    return out
  }

  it('declares .sgvue once, as "SGVue Project", an Editor on macOS, with the app icon', () => {
    expect(associations()).toEqual([{ ext: 'sgvue', name: 'SGVue Project', description: 'SGVue Project', role: 'Editor' }])
    // No `icon:` and no build/sgvue.icns or .ico: both platforms fall back to the app's own icon.
    expect(existsSync(join(ROOT, 'build/sgvue.icns'))).toBe(false)
    expect(existsSync(join(ROOT, 'build/sgvue.ico'))).toBe(false)
  })

  it('is registered per-user, the install mode, and not by our own NSIS', () => {
    expect(nsisOptions().perMachine ?? 'false').toBe('false')
    expect(read('build/installer.nsh')).not.toMatch(/APP_ASSOCIATE|Software\\Classes|"\.?sgvue"/i)
  })
})
