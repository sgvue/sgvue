import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FORBIDDEN_IFC_WRITE_API, FS_WRITER_ALLOW_LIST } from '../src/shared/readonly-list'
import { GATED_CALLS, TOOLS, gateOf, type JsonSchema } from '../src/shared/tool-schemas'
import { PENDING_PATCH_KEYS, pendingPatch } from '../src/shared/undo'
import * as channels from '../src/shared/ipc-channels'
import { missingExecutors, strayExecutors } from '../src/renderer/ai/executors'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

const FILES = sourceFiles(SRC).map((full) => ({
  path: relative(ROOT, full).split(sep).join('/'),
  text: readFileSync(full, 'utf8')
}))

/**
 * Source with its comments taken out — block comments, whole-line `//` comments and a trailing
 * `// …` after code — so that a check on what the code *does* is not answered by what a comment
 * *says*. (The headers here name the very actions the gate keeps away from the tools.)
 */
const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '')

/** The files under `src/renderer/ai/` — where every tool runs — whose code matches. */
const aiFilesNaming = (pattern: RegExp): string[] =>
  FILES.filter(({ path, text }) => path.startsWith('src/renderer/ai/') && pattern.test(stripComments(text)))
    .map(({ path }) => path)
    .sort()

describe('read-only guard', () => {
  it('finds source files to check', () => {
    expect(FILES.length).toBeGreaterThan(0)
  })

  it('never names a web-ifc write API outside readonly-list.ts', () => {
    const hits: string[] = []
    for (const { path, text } of FILES) {
      if (path === 'src/shared/readonly-list.ts') continue
      for (const name of FORBIDDEN_IFC_WRITE_API) {
        if (new RegExp(`\\b${name}\\b`).test(text)) hits.push(`${path}: ${name}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('writes to disk only from the enumerated writers', () => {
    // `…Sync` variants must match, and so must `fs.writeFile`. The trailing `(` is what
    // keeps the guard on *calls*: the assistant's system prompt contains the sentence
    // "If asked to edit, rename, reclassify, fix or write anything into the model", and a
    // bare-word match turned that copy into a disk-writer report. A writer is always called.
    const writer =
      /\bfs\.write|\bwriteFile(?:Sync)?\s*\(|\bappendFile(?:Sync)?\s*\(|\bcreateWriteStream\s*\(|\bfs\.rm\b|\bunlink(?:Sync)?\s*\(|\brename(?:Sync)?\s*\(|\bmkdir(?:Sync)?\s*\(|\bcopyFile(?:Sync)?\s*\(/
    const hits = FILES.filter(
      ({ path, text }) =>
        !(FS_WRITER_ALLOW_LIST as readonly string[]).includes(path) && writer.test(text)
    ).map(({ path }) => path)
    expect(hits).toEqual([])

    // …and the regex still has teeth: each permitted writer that exists must match it.
    const writers = FILES.filter(({ path }) =>
      (FS_WRITER_ALLOW_LIST as readonly string[]).includes(path)
    )
    expect(writers.length).toBeGreaterThan(0)
    for (const { path, text } of writers) expect([path, writer.test(text)]).toEqual([path, true])
  })

  it('never weakens the renderer sandbox', () => {
    const unsafe = [/nodeIntegration:\s*true/, /sandbox:\s*false/, /webSecurity:\s*false/, /@electron\/remote/]
    const hits: string[] = []
    for (const { path, text } of FILES) {
      for (const pattern of unsafe) if (pattern.test(text)) hits.push(`${path}: ${pattern}`)
    }
    expect(hits).toEqual([])
  })

  it('exposes exactly the pinned preload API keys', () => {
    const text = readFileSync(join(SRC, 'preload/index.ts'), 'utf8')
    const body = /const api = \{([\s\S]*?)\n\}/.exec(text)
    expect(body, 'preload no longer declares `const api = { … }`').not.toBeNull()
    const keys = [...body![1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
    // `onGpuGuardTripped` is one-way, main → renderer, and carries no capability: see
    // `src/main/gpu-guard.ts` for the kernel panics that put it there.
    //
    // Phase 8 adds the desktop file path the fidelity contract's allowed deviations call for.
    // Every one of them is narrow on purpose: `openDialog` shows the OS chooser and returns
    // only what the user picked; `admitPaths` and `fileUrl` cannot reach a path the user never
    // chose (`main/file-protocol.ts`); the session and recents calls read and write two files
    // under `userData` through `main/sessions.ts`, which is one of the two permitted
    // writers; `onDeepLink` is one-way, main → renderer, like the guard above.
    expect(keys).toEqual([
      'platform',
      'versions',
      'onGpuGuardTripped',
      'openDialog',
      'admitPaths',
      'pathForFile',
      'fileUrl',
      // 2026-09-24 — the native "Replace model?" box: a file name in, yes or no out.
      'confirmReplace',
      'saveSession',
      'clearSession',
      'listRecents',
      'addRecent',
      'onDeepLink',
      // Phase 9a. Every one of these is narrow on purpose. `aiTurn` / `aiAbort` / `onAiEvent`
      // carry a question and its events — the Anthropic SDK and the API key stay in main and
      // nothing here can read either. `onAiToolExec` / `aiToolResult` are the reverse
      // direction: main holds no model data, so it asks this side to run a tool and receives
      // JSON back. The settings calls read everything **except** the key (`hasKey` is all the
      // renderer ever learns) and `setApiKey` is write-only — there is no getter, here or in
      // main's IPC table. `onOpenSettings` is one-way, main → renderer, like the two above it.
      'aiTurn',
      'aiAbort',
      'onAiEvent',
      'onAiToolExec',
      'aiToolResult',
      'getSettings',
      'setSettings',
      'setApiKey',
      'clearApiKey',
      'onOpenSettings',
      // 2026-09-25 — the toolbar's Schedules button. No payload in, nothing out: it opens the
      // Schedules window or brings it forward. The two windows then talk over a private
      // MessagePort main hands them, which is not a bridge key (`preload/schedule.ts`).
      'openSchedules',
      // 2026-10-01 — the landing page's update notice (owner-chosen: "Check at every start").
      // Neither takes an argument. `checkUpdate` answers `{ latest }` or `null`: main asks
      // GitHub for a version number at most once per run, and never in a development build
      // (`main/updates.ts`). `openUpdatePage` opens the product site in the browser — main
      // builds that URL from its own constant, so the renderer cannot name one.
      'checkUpdate',
      'openUpdatePage'
    ])
  })

  it('lets the update bridge carry nothing in: no argument, and no URL from the renderer', () => {
    const preload = readFileSync(join(SRC, 'preload/index.ts'), 'utf8')
    expect(preload).toMatch(/checkUpdate: \(\): Promise<UpdateInfo \| null> => ipcRenderer\.invoke\(CH_UPDATE_CHECK\)/)
    expect(preload).toMatch(/openUpdatePage: \(\): Promise<void> => ipcRenderer\.invoke\(CH_UPDATE_OPEN\)/)
    // The Schedules window has neither.
    expect(readFileSync(join(SRC, 'preload/schedule.ts'), 'utf8')).not.toMatch(/update:|CH_UPDATE/)
    // Main is the only place the address to ask is spelled, and it is the one constant.
    const naming = FILES.filter(({ text }) => /api\.github\.com/.test(text)).map(({ path }) => path)
    expect(naming).toEqual(['src/main/updates.ts'])
    // The page the button opens is built in main from `updatesUrl`, as the Help menu's is.
    const main = readFileSync(join(SRC, 'main/index.ts'), 'utf8')
    const open = /ipcMain\.handle\(CH_UPDATE_OPEN,[\s\S]*?\n {2}\}\)/.exec(main)
    expect(open, 'main no longer registers CH_UPDATE_OPEN').not.toBeNull()
    expect(open![0]).toMatch(/UpdateOpenRequest\.parse\(raw\)/)
    expect(open![0]).toMatch(/event\.sender !== mainWindow\(\)\?\.webContents/)
    expect(open![0]).toMatch(/shell\.openExternal\(updatesUrl\(__APP_VERSION__\)\)/)
    const check = /ipcMain\.handle\(CH_UPDATE_CHECK,[\s\S]*?\n {2}\}\)/.exec(main)
    expect(check, 'main no longer registers CH_UPDATE_CHECK').not.toBeNull()
    expect(check![0]).toMatch(/UpdateCheckRequest\.parse\(raw\)/)
    expect(check![0]).toMatch(/event\.sender !== mainWindow\(\)\?\.webContents/)
  })

  it('names exactly three writers, the third being exports', () => {
    // 2026-09-25, phase 4: the owner-approved third writer. Changing this list is a decision
    // recorded in CLAUDE.md and docs/DECISIONS.md, never a convenience.
    expect([...FS_WRITER_ALLOW_LIST]).toEqual([
      'src/main/settings.ts',
      'src/main/sessions.ts',
      'src/main/exports.ts'
    ])
  })

  it('exposes exactly the pinned Schedules preload API keys, and the main preload has neither', () => {
    // Phase 4 (2026-09-25). `saveExport` hands main a kind, a suggested name and the bytes —
    // never a path — and main writes only where the user points its Save dialog
    // (`main/exports.ts`); `openScheduleFile` returns the text of the file picked in its Open
    // dialog, or null. Main answers both for the Schedules window's webContents only.
    const text = readFileSync(join(SRC, 'preload/schedule.ts'), 'utf8')
    const body = /const api = \{([\s\S]*?)\n\}/.exec(text)
    expect(body, 'the Schedules preload no longer declares `const api = { … }`').not.toBeNull()
    const keys = [...body![1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
    expect(keys).toEqual(['saveExport', 'openScheduleFile'])
    // The main window's bridge cannot reach them: its preload names neither channel.
    const main = readFileSync(join(SRC, 'preload/index.ts'), 'utf8')
    expect(main).not.toMatch(/CH_EXPORT_SAVE|CH_SCHEDULE_FILE_OPEN|export:save|scheduleFile:open/)
  })

  it('keeps zod out of the preload: channel names from ipc-channels, only types from ipc-contract', () => {
    // A sandboxed preload that pulls zod in fails to load silently and takes `window.sgvue`
    // with it (`shared/ipc-channels.ts`). `import type` is erased, so it is the one safe form.
    const text = readFileSync(join(SRC, 'preload/index.ts'), 'utf8')
    const imports = [...text.matchAll(/^import\s+(type\s+)?[\s\S]*?from\s+'([^']+)'/gm)].map((m) => ({
      typeOnly: !!m[1],
      from: m[2]
    }))
    expect(imports.filter((i) => /zod/.test(i.from))).toEqual([])
    const contract = imports.filter((i) => /ipc-contract/.test(i.from))
    expect(contract.length).toBeGreaterThan(0)
    expect(contract.every((i) => i.typeOnly)).toBe(true)
    expect(imports.some((i) => /shared\/ipc-channels$/.test(i.from) && !i.typeOnly)).toBe(true)
  })

  it('registers a handler for exactly the channels IPC_CHANNELS lists', () => {
    // Every `ipcMain.handle(CH_X` / `ipcMain.on(CH_X` under src/main, by constant name.
    const byName = channels as unknown as Record<string, string>
    const registered = new Set<string>()
    for (const { path, text } of FILES) {
      if (!path.startsWith('src/main/')) continue
      for (const m of text.matchAll(/ipcMain\.(?:handle|on|once)\(\s*(CH_[A-Z_]+)/g)) {
        expect(byName[m[1]], `${path}: ${m[1]} is not a channel name`).toBeDefined()
        registered.add(byName[m[1]])
      }
    }
    expect([...registered].sort()).toEqual([...channels.IPC_CHANNELS].sort())
  })

  /* ────────────────────────────── guard (e), plan §3.2 ────────────────────────────── */

  it('declares every AI tool as read or view, and nothing else', () => {
    const kinds = new Set(TOOLS.map((t) => t.kind))
    expect([...kinds].sort()).toEqual(['read', 'view'])
    for (const tool of TOOLS) expect(tool.kind === 'read' || tool.kind === 'view').toBe(true)
  })

  /**
   * 2026-09-28 — the one owner-approved exception to "no tool exports": `export_schedule` may
   * OPEN the native Save dialog, through the Schedules window's own Export menu action; only the
   * user's click on Save writes, through `main/exports.ts`. It is named here, exactly; every
   * other tool is still held to the whole list.
   */
  const SAVE_DIALOG_TOOL = 'export_schedule'

  it('names no AI tool after an operation that would change model data', () => {
    // Substrings, not whole words: `update_element` and `elementUpdate` are both forbidden.
    const mutating = /write|edit|delete|remove|save|rename|create|update|insert|set_property|modify|patch|import|export/i
    const hits = TOOLS.filter((t) => t.name !== SAVE_DIALOG_TOOL && mutating.test(t.name)).map((t) => t.name)
    expect(hits).toEqual([])
    // The exception is the exact name, not a pattern: `export_model` would still be refused.
    expect(mutating.test(SAVE_DIALOG_TOOL)).toBe(true)
    expect(TOOLS.filter((t) => /export/i.test(t.name)).map((t) => t.name)).toEqual([SAVE_DIALOG_TOOL])
  })

  /** Every property key of a schema, at any depth — nested objects and array items too. */
  const keysOf = (node: JsonSchema | undefined, at: string): string[] => {
    if (!node) return []
    const own = Object.entries(node.properties ?? {}).flatMap(([k, v]) => [`${at}.${k}`, ...keysOf(v, `${at}.${k}`)])
    return [...own, ...keysOf(node.items, `${at}[]`)]
  }
  const fsInputs = (tools: readonly { name: string; input_schema: JsonSchema }[]): string[] => {
    // The original list, plus file content (2026-09-28): a tool may carry neither where a file
    // goes nor what goes in it.
    const fsish = /(^|_)(file|path|dir|directory|folder|filename|url|uri|content|contents|bytes|blob|data)($|_)/i
    return tools.flatMap((t) => keysOf(t.input_schema, t.name).filter((k) => fsish.test(k.split('.').pop()!.replace('[]', ''))))
  }

  it('gives no AI tool a file-system input — a path, a file name or file content — at any depth', () => {
    expect(fsInputs(TOOLS)).toEqual([])
    // …and the check has teeth: the Save-dialog tool with a path, a name or bytes beside its
    // format, or one nested in an item, is caught.
    const exp = TOOLS.find((t) => t.name === SAVE_DIALOG_TOOL)!
    for (const extra of ['path', 'fileName', 'file_name', 'folder', 'content', 'bytes']) {
      const bad = { ...exp, input_schema: { ...exp.input_schema, properties: { ...exp.input_schema.properties, [extra]: { type: 'string' } } } }
      expect([extra, fsInputs([bad])]).toEqual([extra, [`${SAVE_DIALOG_TOOL}.${extra}`]])
    }
    expect(fsInputs([{ name: 'x', input_schema: { type: 'object', properties: { a: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' } } } } } } }]))
      .toEqual(['x.a[].path'])
  })

  it('lets the Save-dialog tool take a format and nothing else', () => {
    const exp = TOOLS.find((t) => t.name === SAVE_DIALOG_TOOL)!
    expect(exp.kind).toBe('view')
    expect(exp.strict).toBe(true)
    expect(exp.input_schema.additionalProperties).toBe(false)
    expect(exp.input_schema.required).toEqual(['format'])
    expect(Object.keys(exp.input_schema.properties)).toEqual(['format'])
    expect(exp.input_schema.properties.format.enum).toEqual(['xlsx', 'csv', 'all_saved', 'schedule_file'])
    // And what it runs never names a path either: the page sends a kind, a suggested name and
    // bytes to main, and main writes only where its own Save dialog returned.
    const executor = readFileSync(join(SRC, 'renderer/ai/executors/schedule.ts'), 'utf8')
    expect(executor).not.toMatch(/saveExport|showSaveDialog|export:save|writeFile/)
  })

  /* ────────────────────── the consent gate (2026-10-02, parity phase 3) ────────────────────── */

  /**
   * What reaches outside the view or cannot be undone is never done by the assistant: it asks,
   * and the user's own click does it. The reason is prompt injection — text authored in an IFC
   * file reaches the model through tool results — so these pins are the point of the phase:
   *
   *   · exactly which calls only ask, and through which surface (`apply` — the chat's pending
   *     row; `dialog` — a native dialog; `confirm` — the sidebar's inline "Unload …?" and,
   *     since phase 4, the Schedules window's own confirmation: before a saved setup is deleted
   *     and before its print dialog is opened);
   *   · exactly which may open a native dialog;
   *   · that nothing under `src/renderer/ai/` — where every tool runs — performs any of the
   *     gated actions: the one place they are performed is the store's `applyPending`, and the
   *     only callers of that are the pending row's Apply button and a dev-only harness.
   *
   * Changing any list here is a decision recorded in CLAUDE.md and docs/DECISIONS.md.
   */
  it('pins every call that only asks the user, and the surface it asks through', () => {
    expect(GATED_CALLS.map((g) => `${g.tool}${g.by ? `.${g.by}=${g.value}` : ''} → ${g.surface}`)).toEqual([
      'manage_filters.op=delete_set → apply',
      'manage_views.op=delete → apply',
      'manage_markups.op=delete → apply',
      'manage_markups.op=clear → apply',
      'request_user_action.action=open_files → dialog',
      'request_user_action.action=open_recent → apply',
      'request_user_action.action=unload_model → confirm',
      'request_user_action.action=copy_link → apply',
      'request_user_action.action=copy_guids → apply',
      // (`set_base_point → apply` until 2026-10-08, when the owner made the Coordinate-system
      // card read-only: what nobody can change, the assistant cannot ask to change.)
      // Phase 4 — the Schedules window's own confirmation and its Open dialog. (`print` raised
      // the print dialog itself until the same day's follow-up: that dialog's default button
      // prints, so printing is asked in the window's own confirm, as a deletion is.)
      'manage_schedules.op=delete → confirm',
      'manage_schedules.op=print → confirm',
      'manage_schedules.op=open_file → dialog',
      'export_schedule → dialog'
    ])
    for (const g of GATED_CALLS) {
      const tool = TOOLS.find((t) => t.name === g.tool)!
      // A gated call changes what is on screen or asks to; it is never a read.
      expect([g.tool, tool.kind]).toEqual([g.tool, 'view'])
      if (g.by === null) {
        // Every call of the tool asks: the one key is the wildcard.
        expect([g.tool, g.value]).toEqual([g.tool, '*'])
        continue
      }
      // The marker names a real input and one of its own values — never an operation that is
      // not in the schema, which would mark nothing.
      const values = (tool.input_schema.properties[g.by]?.enum ?? []) as readonly unknown[]
      expect([g.tool, g.value, values.includes(g.value)]).toEqual([g.tool, g.value, true])
      expect(gateOf(g.tool, { [g.by]: g.value })).toBe(g.surface)
    }
    // …and `request_user_action` has no action that acts: every one of its values is gated.
    const ask = TOOLS.find((t) => t.name === 'request_user_action')!
    expect(ask.input_schema.properties.action.enum).toEqual(
      GATED_CALLS.filter((g) => g.tool === 'request_user_action').map((g) => g.value)
    )
  })

  it('lets exactly three calls open a native dialog: Open, and in Schedules Save and Open', () => {
    expect(GATED_CALLS.filter((g) => g.surface === 'dialog').map((g) => `${g.tool}:${g.value}`)).toEqual([
      'request_user_action:open_files',
      // Phase 4 (2026-10-02): the Schedules window's own "Open schedule file…". Not its Print:
      // no tool call raises the print dialog — only the user's click in that window does.
      'manage_schedules:open_file',
      `${SAVE_DIALOG_TOOL}:*`
    ])
    // …and exactly three raise a confirmation that is not the chat's own row: the sidebar's
    // "Unload …?", and the Schedules window's question before a saved setup is deleted and
    // before its print dialog is opened.
    expect(GATED_CALLS.filter((g) => g.surface === 'confirm').map((g) => `${g.tool}:${g.value}`)).toEqual([
      'request_user_action:unload_model',
      'manage_schedules:delete',
      'manage_schedules:print'
    ])
    // In the source: the Open dialog is asked for in one file, the Save dialog in one other —
    // and no tool reaches Electron's dialogs, or the "Replace model?" box, by any other route.
    expect(aiFilesNaming(/\bopenDialog\b/)).toEqual(['src/renderer/ai/executors/request.ts'])
    expect(aiFilesNaming(/\brequestExport\b/)).toEqual(['src/renderer/ai/executors/schedule.ts'])
    expect(aiFilesNaming(/showOpenDialog|showSaveDialog|showMessageBox|confirmReplace|openScheduleFile|saveExport/)).toEqual([])
    // The sidebar's unload confirmation is raised in one file too, and nothing there unloads.
    expect(aiFilesNaming(/\baskRemove\b/)).toEqual(['src/renderer/ai/executors/request.ts'])
  })

  /**
   * Phase 4 (2026-10-02). The Schedules window's own controls are asked for over the private
   * port, by name, from one file — and the things that window deletes, prints or opens stay in
   * that window, behind its own dialogs:
   *
   *   · nothing a tool runs names what performs them — they live in another renderer process,
   *     and this pins that no one imports them into this one;
   *   · the request side of the port posts `manage`, and never the row menu's `act`, which has
   *     no scope guard: a schedule's rows are resolved to ids here and acted on through the
   *     store (`ai/executors/targets.ts`);
   *   · in the Schedules window, the file that answers the assistant (`manage.ts`) deletes
   *     nothing and prints nothing itself: a deletion is `actions.ts`'s, inside the answer to
   *     that window's own confirm dialog, and the print dialog is the header button's own
   *     function — called, for the assistant, only inside the answer to that same confirm;
   *   · every question that file raises is asked as one for the assistant (`FOR_ASSISTANT`):
   *     under its name, and with no default button — the focus goes to the dialog's card, so a
   *     key press already under way cannot answer it (`schedule-ui/dialog.ts`).
   */
  it('reaches the Schedules window’s controls by name, over the port — never its row menu’s `act`', () => {
    expect(aiFilesNaming(/\brequestManage\b/)).toEqual(['src/renderer/ai/executors/schedule.ts'])
    expect(
      aiFilesNaming(
        /\b(deleteSchedule|renameSchedule|duplicateSchedule|saveSchedule|askDeleteSaved|printSchedule|manageFromChat|loadSaved|saveCurrent)\b|window\s*\.\s*print|localStorage/
      )
    ).toEqual([])
    // No message a tool can cause is the row menu's.
    expect(aiFilesNaming(/type:\s*'act'|kind:\s*'(isolate|hide|show|showAll)'/)).toEqual([])
    const code = (path: string): string => stripComments(FILES.find((f) => f.path === path)!.text)
    const link = code('src/renderer/model/schedule-link.ts')
    // What the main window posts to the Schedules window, by type — and `act` is not among them.
    const typedPosts = (text: string): string[] =>
      [...text.matchAll(/postMessage\(\{\s*type: '([a-zA-Z]+)'/g)].map((m) => m[1])
    const posted = [...new Set(typedPosts(link))].sort()
    expect(posted).toEqual(['colours', 'define', 'export', 'manage', 'selection', 'store', 'theme', 'vis'])
    // The review's leftover of phase 4: that list is read off the calls whose message is a
    // literal with its `type` spelled first, so a `port.postMessage(msg)` with a variable would
    // post a type this pin never saw. Every `postMessage(` call in that file is one of the
    // literal-typed ones.
    const allPosts = (text: string): number => (text.match(/\bpostMessage\s*\(/g) ?? []).length
    expect(allPosts(link)).toBeGreaterThan(0)
    expect(typedPosts(link).length, 'a postMessage( call in schedule-link.ts is not a literal with its type first').toBe(
      allPosts(link)
    )
    // …with teeth: a message handed over as a variable, or as a literal whose type is not
    // spelled first, is a call the list cannot read — and is counted as one.
    for (const [sample, all, typed] of [
      ["port.postMessage({ type: 'vis', hidden })", 1, 1],
      ["port?.postMessage({\n    type: 'colours',\n    groups\n  })", 1, 1],
      ['port.postMessage(msg)', 1, 0],
      ["port.postMessage({ ...msg, type: 'act' })", 1, 0],
      ["const msg = { type: 'act', kind: 'hide' }\nport.postMessage(msg)", 1, 0]
    ] as const) {
      expect([sample, allPosts(sample), typedPosts(sample).length]).toEqual([sample, all, typed])
    }

    // The Schedules window's side: the answering file performs none of the three itself.
    const manage = code('src/renderer/schedule-ui/manage.ts')
    expect(manage).not.toMatch(/\bdeleteSchedule\b|window\s*\.\s*print|\bsaveExport\b|\bpostMessage\b|localStorage/)
    // Each is reached once, and only inside the `then` that runs after the answer has gone.
    expect(manage.match(/\baskDeleteSaved\(/g)).toHaveLength(1)
    expect(manage).toMatch(/then: \(\) => askDeleteSaved\(entry\.name, FOR_ASSISTANT\)/)
    // Printing: the import, and one call — in the answer to this window's own confirm, on yes.
    expect(manage.match(/\bprintSchedule\b/g)).toHaveLength(2)
    expect(manage).toMatch(
      /then: \(\) => void confirmDialog\('Open the print dialog for this schedule\?', 'Print…', false, FOR_ASSISTANT\)\s*\.then\(\(ok\) => \{ if \(ok\) printSchedule\(\); \}\)/
    )
    expect(manage).not.toMatch(/setTimeout/)
    expect(manage.match(/\bopenScheduleFile\b/g)).toHaveLength(2)
    expect(manage).toMatch(/then: \(\) => void openScheduleFile\(\)/)
    // No question is raised there any other way: each confirm is asked as one for the assistant.
    expect(manage.match(/\bconfirmDialog\(/g)).toHaveLength(2)
    expect(manage.match(/\bconfirmDialog\([^;]*?, FOR_ASSISTANT\)/g)).toHaveLength(2)
    expect(manage).toMatch(/export const FOR_ASSISTANT: ConfirmHow = \{ title: ASKER, forAssistant: true \}/)
    // …and what that flag does is in one place: the card takes the focus, and no button does.
    const dialog = code('src/renderer/schedule-ui/dialog.ts')
    expect(dialog).toMatch(/if \(o\.forAssistant\) card\.focus\(\);/)
    expect(dialog).toMatch(/\$\{o\.forAssistant \? ' tabindex="-1"' : ''\}/)
    // The deletion itself is in one file, in the answer to that window's own confirm dialog.
    const deleting = FILES.filter(
      ({ path, text }) => path.startsWith('src/renderer/schedule-ui/') && /\bdeleteSchedule\(/.test(stripComments(text))
    ).map(({ path }) => path)
    expect(deleting.sort()).toEqual(['src/renderer/schedule-ui/actions.ts', 'src/renderer/schedule-ui/schedules.ts'])
    const actions = code('src/renderer/schedule-ui/actions.ts')
    expect(actions.match(/\bdeleteSchedule\(/g)).toHaveLength(1)
    expect(actions).toMatch(/void confirmDialog\([\s\S]{0,160}\.then\(\(ok\) => \{\s*if \(!ok\) return\s*;?\s*deleteSchedule\(name\)/)
    // And `window.print()` is called in one place in that window: the Print control's function.
    const printing = FILES.filter(({ text }) => /window\s*\.\s*print\s*\(/.test(stripComments(text))).map(({ path }) => path)
    expect(printing).toEqual(['src/renderer/schedule-ui/actions.ts'])
  })

  /**
   * Phase 4. A markup is placed by the viewer's own commit for a click (`viewer-core.ts`), which
   * the store's two actions call; one executor calls those, and nothing under `ai/` reaches the
   * viewer's annotation layer to make a record of its own.
   *
   * The follow-up of the same day: the reply's `revert` takes a markup that reply placed away
   * again. **The executor only reports what it placed** — the new record's own id — and the
   * removing is the store's, in `revertTurn`, through the Markups card's own ×: nothing under
   * `ai/` names a removal (the gate's list of performers, below, has all four).
   */
  it('places a markup through the store’s own actions, from one file — and only the store takes one away', () => {
    expect(aiFilesNaming(/\b(placeSpot|placeMeasure|showSpot)\b/)).toEqual(['src/renderer/ai/executors/saved.ts'])
    expect(aiFilesNaming(/\b(addSpot|addLaser|createAnnotations|setSpots|setMeasures)\b/)).toEqual([])
    expect(aiFilesNaming(/\b(dropMeasure|dropSpot|clearMeasures|clearSpots|revertTurn)\b/)).toEqual([])
    const code = (path: string): string => stripComments(FILES.find((f) => f.path === path)!.text)
    // What it placed, by the id of the record the viewer made — read off the list it grew.
    const saved = code('src/renderer/ai/executors/saved.ts')
    expect(saved).toMatch(/ui: \{ placed: \{ kind: laser \? 'measure' : 'spot', id: list\[at\]\.id \} \}/)
    // The removal: in the store's revert, each only while that very record is still there.
    const revert = /\n {2}revertTurn: \(index\) => \{[\s\S]*?\n {2}\},\n/.exec(code('src/renderer/state/shell.ts'))
    expect(revert, 'the store no longer declares `revertTurn: (index) => { … }`').not.toBeNull()
    expect(revert![0]).toMatch(/if \(get\(\)\.measures\.some\(\(m\) => m\.id === mark\.id\)\) get\(\)\.dropMeasure\(mark\.id\)/)
    expect(revert![0]).toMatch(/if \(get\(\)\.spots\.some\(\(p\) => p\.id === mark\.id\)\) get\(\)\.dropSpot\(mark\.id\)/)
    // Never a whole list: a markup the user placed, or another reply did, is not this reply's.
    expect(revert![0]).not.toMatch(/clearMeasures|clearSpots/)
    // The click and the tool run one function each: the commit is defined once, and called by
    // the click's handler and by the method the store reaches.
    const core = code('src/renderer/viewer/viewer-core.ts')
    expect(core.match(/annotations\.addSpot\(/g)).toHaveLength(1)
    expect(core.match(/annotations\.addLaser\(/g)).toHaveLength(1)
    expect(core.match(/\bcommitSpot\(/g)).toHaveLength(2)
    expect(core.match(/\bcommitLaser\(/g)).toHaveLength(2)
  })

  it('performs no gated action anywhere a tool runs: only the user’s click on Apply does', () => {
    // Every action behind the gate, by the name of what performs it: the store's actions, the
    // model layer's, the clipboard, and the bridge calls that turn a path into a file.
    const performers =
      /\b(dropView|dropMeasure|dropSpot|clearMeasures|clearSpots|forgetFilterSet|setCoord|copyGuid|copyLink|copyTable|copyText|openLibrary|openPaths|openRecent|openDemo|dropFiles|admitPaths|fileUrl|pathForFile|addRecent|removeModel|applyPending|performGated|setOutsideActions)\b|navigator\s*\.\s*clipboard|execCommand/
    expect(aiFilesNaming(performers)).toEqual([])
    // …and the check has teeth: the same pattern finds each of them where it does live.
    const code = (path: string): string => stripComments(FILES.find((f) => f.path === path)!.text)
    expect(performers.test(code('src/renderer/state/shell.ts'))).toBe(true)
    expect(performers.test(code('src/renderer/model/upload-pipeline.ts'))).toBe(true)
    expect(performers.test(code('src/renderer/clipboard.ts'))).toBe(true)

    // After review — the general doors, which would get past a list of named actions: the
    // session restore (it writes every key of the review state), the store's raw `setState`,
    // the settings and the API key, and the stored session. No tool has a use for any of them.
    const doors = /\b(applySession|setState|setSettings|setApiKey|clearApiKey|saveSession|clearSession)\b/
    expect(aiFilesNaming(doors)).toEqual([])
    for (const [name, path] of [
      ['applySession', 'src/renderer/state/shell.ts'],
      ['setState', 'src/renderer/model/upload-pipeline.ts'],
      ['setSettings', 'src/renderer/app/Preferences.tsx'],
      ['setApiKey', 'src/renderer/app/Preferences.tsx'],
      ['clearApiKey', 'src/renderer/app/Preferences.tsx'],
      ['saveSession', 'src/renderer/model/session.ts'],
      // (Nothing in the renderer calls this one; the bridge is where the name lives.)
      ['clearSession', 'src/preload/index.ts']
    ] as const) {
      expect([name, new RegExp(`\\b${name}\\b`).test(code(path))]).toEqual([name, true])
    }
    expect(/\bdropView\b/.test(stripComments('s.dropView(1) // a comment'))).toBe(true)
    expect(/\bdropView\b/.test(stripComments('/* dropView */ const a = 1 // dropView'))).toBe(false)

    // `applyPending` is the one door, and exactly two things call it: the pending row's Apply
    // button, and the dev harness's `chat.apply` (dropped from a production bundle).
    const callers = FILES.filter(({ text }) => /\.applyPending\(/.test(stripComments(text))).map(({ path }) => path)
    expect(callers.sort()).toEqual(['src/renderer/App.tsx', 'src/renderer/app/ChatPanel.tsx'])
    const panel = code('src/renderer/app/ChatPanel.tsx')
    expect(panel.match(/\.applyPending\(/g)).toHaveLength(1)
    expect(panel).toMatch(/onClick=\{\(\) => st\.applyPending\(i\)\}/)
    // The harness's is behind the dev-tools block, which a production build drops.
    const app = code('src/renderer/App.tsx')
    expect(app.match(/\.applyPending\(/g)).toHaveLength(1)
    expect(app.indexOf('.applyPending(')).toBeGreaterThan(app.indexOf('async function installDevTools('))
    expect(app.indexOf('.applyPending(')).toBeLessThan(app.indexOf('export default function App('))
    // And what it runs is performed in one place: defined once, called once, in the store.
    const performing = FILES.filter(({ text }) => /\bperformGated\b/.test(stripComments(text))).map(({ path }) => path)
    expect(performing).toEqual(['src/renderer/state/shell.ts'])
    expect(code('src/renderer/state/shell.ts').match(/\bperformGated\(/g)).toHaveLength(2)
  })

  /**
   * After review. `up(patch)` sets whatever keys it is handed, so the store's one general
   * mutation is a door too: `up({ views: [] })` from an executor would delete every viewpoint,
   * and no list of forbidden names would see it. So every call a tool makes to it is a flat
   * object literal, written where it is called, naming only the keys a held change may write —
   * the same list the pending row's patch is cut down to when the user applies it.
   */
  it('lets a tool write only visibility through the store’s `up`: a flat literal of the pending-patch keys', () => {
    const allowed = new Set<string>(PENDING_PATCH_KEYS)
    const calls: { path: string; keys: string[] }[] = []
    for (const { path, text } of FILES) {
      if (!path.startsWith('src/renderer/ai/')) continue
      const code = stripComments(text)
      const every = code.match(/\.up\(/g) ?? []
      const literal = [...code.matchAll(/\.up\(\s*\{([^{}]*)\}\s*\)/g)]
      // A patch built somewhere else — a variable, a spread, a nested object — cannot be read
      // here, so it is not allowed here: every call is one of the literals.
      expect([path, literal.length]).toEqual([path, every.length])
      for (const m of literal) {
        const keys = m[1]
          .split(',')
          .map((part) => part.trim().split(':')[0].trim())
          .filter(Boolean)
        calls.push({ path, keys })
        expect([path, keys, keys.every((k) => /^[A-Za-z]+$/.test(k) && allowed.has(k))]).toEqual([path, keys, true])
      }
    }
    // Phase 4, the review's leftover: and no **bare** `up(` — the action taken off the store by
    // destructuring (`const { up } = s`), which the `.up(` pattern above cannot see.
    const bare = /(?<![.\w$])up\s*\(/
    expect(aiFilesNaming(bare)).toEqual([])
    expect(aiFilesNaming(/\{[^{}]*\bup\b[^{}]*\}\s*=/)).toEqual([])
    // …and the pattern has teeth, without tripping on a name that merely ends in "up".
    expect(bare.test('const { up } = s\nup({ views: [] })')).toBe(true)
    expect(bare.test('s.up({ stack })')).toBe(false)
    expect(bare.test('setup({ stack }); lookup(1); gate.setUp()')).toBe(false)
    // The review's leftover of phase 4: nor an **alias**. `const u = s.up` (or `s.up.bind(s)`)
    // followed by `u({ views: [] })` is no `.up(`, no bare `up(` and no destructuring, so it
    // passed all three rules above. Under `renderer/ai/`, `.up` is named only as the direct call
    // `.up(` — written exactly so, because that is the one form the count above can read: a call
    // through `.up (`, `.up?.(` or `.up.call(` would be as unseen as an alias.
    const aliased = /\.up\b(?!\()/
    expect(aiFilesNaming(aliased)).toEqual([])
    // …with teeth: the alias, the bound form and a call the count cannot read are found; the
    // direct call is not, and neither is a member whose name merely starts with "up".
    expect(aliased.test('const u = s.up\nu({ views: [] })')).toBe(true)
    expect(aliased.test('const u = s.up.bind(s); u({ views: [] })')).toBe(true)
    expect(aliased.test('s.up ({ views: [] })')).toBe(true)
    expect(aliased.test('s.up?.({ views: [] })')).toBe(true)
    expect(aliased.test('s.up({ stack })')).toBe(false)
    expect(aliased.test('get().up({ storeyVis })')).toBe(false)
    expect(aliased.test('s.uploadNames; row.updated; s.upload(files)')).toBe(false)
    // After review, one more spelling: a **computed member**. `s['up']({ views: [] })` holds no
    // `.up`, no bare `up(` and no destructuring, so it passed every rule above — and the count,
    // which reads `.up(` alone, never saw the call. Under `renderer/ai/` the store's `up` is not
    // reached through a quoted key at all, whichever quote.
    const computed = /\[\s*(['"`])up\1\s*\]/
    expect(aiFilesNaming(computed)).toEqual([])
    // …with teeth: each quote is found, with or without `?.` or spaces; the direct call is not,
    // and neither is a key that merely starts with "up".
    expect(computed.test("s['up']({ views: [] })")).toBe(true)
    expect(computed.test('s["up"]({ views: [] })')).toBe(true)
    expect(computed.test('s[`up`]({ views: [] })')).toBe(true)
    expect(computed.test("const u = s?.[ 'up' ]")).toBe(true)
    expect(computed.test('s.up({ stack })')).toBe(false)
    expect(computed.test("s['upload'](files); row['updated']; s['uploadNames']")).toBe(false)
    // It found the calls there are: the filter stack, the storeys and the models' eyes.
    expect(calls.map((c) => c.keys.join('+')).sort()).toEqual([
      'modelVis',
      'stack+stepSel',
      'stack+stepSel',
      'stack+stepSel',
      'storeyVis'
    ])
    expect([...new Set(calls.map((c) => c.path))]).toEqual(['src/renderer/ai/executors/view.ts'])
    // And the list itself is pinned: widening it is a decision.
    expect([...PENDING_PATCH_KEYS]).toEqual(['hidden', 'storeyVis', 'modelVis', 'stack', 'stepSel', 'ctx'])
    // The pending row's patch goes to `up()` only through `pendingPatch`, which keeps those keys.
    const shell = stripComments(FILES.find((f) => f.path === 'src/renderer/state/shell.ts')!.text)
    expect(shell).toMatch(/else if \(pending\.patch\) get\(\)\.up\(pendingPatch\(pending\.patch\)\)/)
    expect(shell.match(/pending\.patch/g)).toHaveLength(2)
    // …its own keys only: nothing else it carries, and nothing it inherits.
    const smuggled = Object.assign(Object.create({ hidden: { 1: true } }), {
      stack: [],
      views: [],
      filterSets: [],
      coords: { E: 1 },
      chatMsgs: []
    })
    expect(pendingPatch(smuggled)).toEqual({ stack: [] })
    expect(Object.keys(pendingPatch(smuggled))).toEqual(['stack'])
  })

  it('gives the new tool no way to name a file: a recent file is a name on the app’s own list', () => {
    const ask = TOOLS.find((t) => t.name === 'request_user_action')!
    expect(Object.keys(ask.input_schema.properties)).toEqual([
      'action',
      'recent',
      'model',
      'ids',
      'selection',
      // Phase 4: `copy_guids` for what the open schedule lists — a flag, like `selection`.
      // (E, N, Z and angle went with `set_base_point` on 2026-10-08: the card is read-only.)
      'schedule'
    ])
    expect(ask.strict).toBe(true)
    expect(ask.input_schema.additionalProperties).toBe(false)
    expect(fsInputs([ask])).toEqual([])
    // The one input that names a file is refused when it holds a path separator, before any
    // executor sees it (`inputs.ts`) — so even a path that happened to be on the list is not one.
    const inputs = readFileSync(join(SRC, 'renderer/ai/executors/inputs.ts'), 'utf8')
    expect(inputs).toMatch(/recent: z\s*\.string\(\)[\s\S]{0,160}never a path/)
    // And no preload key or IPC channel was added for any of this: both lists are pinned above.
  })

  /**
   * 2026-10-08 — the owner: *"Maybe just make the coordinates system toggle a read only, dont let
   * user change anything."* The base point is the boot file's: the store writes `coords` in one
   * place, `setOffset`, with the federation's frame, and the one module that calls that is the
   * federation controller. No tool can reach it, and no other store write names the key.
   */
  it('keeps the base point read-only: `coords` is written by the store’s setOffset alone', () => {
    /** Every call of `callee` in `code`, with its whole argument list. */
    const callsOf = (code: string, callee: RegExp): string[] =>
      [...code.matchAll(callee)].map((m) => {
        let depth = 0
        let i = m.index! + m[0].length - 1
        const start = i
        for (; i < code.length; i++) {
          if (code[i] === '(') depth++
          else if (code[i] === ')' && --depth === 0) break
        }
        return code.slice(start, i + 1)
      })
    const writes = FILES.filter(({ path }) => path.startsWith('src/renderer/')).flatMap(({ path, text }) =>
      callsOf(stripComments(text), /\b(?:set|setState)\(/g)
        .filter((args) => /\bcoords\b\s*[:,}]/.test(args))
        .map((args) => `${path} ${args.replace(/\s+/g, ' ')}`)
    )
    expect(writes).toEqual(['src/renderer/state/shell.ts ({ offset, frame, bootGeoref, coords })'])
    // …and that is the store's `setOffset`, which the federation controller alone calls.
    const callers = FILES.filter(({ text }) => /\bsetOffset\(/.test(stripComments(text))).map(({ path }) => path)
    expect(callers.sort()).toEqual(['src/renderer/model/federation-store.ts'])
    expect(aiFilesNaming(/\bsetOffset\b|\bsetCoords?\b/)).toEqual([])
    // The design's `setCoord` is gone from the store, and the card's fields are `readOnly`.
    const shell = stripComments(FILES.find((f) => f.path === 'src/renderer/state/shell.ts')!.text)
    expect(shell).not.toMatch(/\bsetCoord\b/)
    const card = stripComments(FILES.find((f) => f.path === 'src/renderer/app/CoordsCard.tsx')!.text)
    expect(card).toMatch(/<input[^>]*\breadOnly\b/)
    expect(card).not.toMatch(/onChange/)
  })

  it('has exactly one executor per tool, and no executor without a tool', () => {
    expect(missingExecutors()).toEqual([])
    expect(strayExecutors()).toEqual([])
  })

  it('keeps the Anthropic SDK out of the renderer and the preload', () => {
    const hits = FILES.filter(
      ({ path, text }) =>
        (path.startsWith('src/renderer/') || path.startsWith('src/preload/')) &&
        /@anthropic-ai\/sdk/.test(text)
    ).map(({ path }) => path)
    expect(hits).toEqual([])
  })

  it('never reads the stored API key outside main/settings.ts and the gateway', () => {
    const allowed = ['src/main/settings.ts', 'src/main/ai/session.ts']
    const hits = FILES.filter(
      ({ path, text }) => !allowed.includes(path) && /\bapiKey\(\)/.test(text)
    ).map(({ path }) => path)
    expect(hits).toEqual([])
  })
})
