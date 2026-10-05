/**
 * Every channel the renderer may reach, and the zod schema main checks it with (plan §3.1).
 *
 * The renderer is sandboxed and has no Node. Everything it needs from the outside world —
 * a file chooser, a read-only stream token, the stored session, the recents list, a share
 * link the OS handed us — crosses one of these channels, and **main validates every payload
 * with the schema here**, because a compromised renderer is the threat model the sandbox
 * exists for. The preload imports only the channel names and these schemas' *types* — never
 * zod itself (`ipc-channels.ts` says why).
 *
 * Channel names are `domain:verb`. Main registers exactly `IPC_CHANNELS`; anything not on it
 * has no handler at all (`tests/readonly-guard.test.ts` holds the two to each other).
 */
import { z } from 'zod'

// The channel names live in their own module so the sandboxed preload can import them without
// pulling zod in with them — see `ipc-channels.ts` for what happens when it does.
export * from './ipc-channels'

/* ────────────────────────────── files ────────────────────────────── */

/** An absolute path the user chose. Never constructed in the renderer. */
export const PickedFile = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative()
})
export type PickedFile = z.infer<typeof PickedFile>

/**
 * `file:admit` — "these paths came from a drop, the recents list, a session or a share link;
 * they are legitimate, tell me what they are".
 *
 * Admitting a path is what makes it mintable later (`main/file-protocol.ts`). A path the
 * renderer simply made up is admitted only if it survives the same `realpath` + extension +
 * size checks the protocol handler applies, so this is not a way around them.
 */
export const AdmitRequest = z.object({ paths: z.array(z.string().min(1)).max(32) })
export type AdmitRequest = z.infer<typeof AdmitRequest>

/**
 * `file:token` — mint a **single-use** `sgvue-file://` URL for one admitted path. The worker
 * fetches it once; the token is spent on the first request and 403s afterwards.
 */
export const TokenRequest = z.object({ path: z.string().min(1) })

/**
 * `file:confirmReplace` — the file name the native "Replace model?" box quotes. A name, never
 * a path: the box says which model, and main needs nothing else to ask.
 */
export const ConfirmReplaceRequest = z.object({ name: z.string().min(1).max(260) })

/* ────────────────────────────── session ────────────────────────────── */

/**
 * The session payload crosses IPC as **opaque JSON**: it is the design's own ~20 keys plus
 * `files`, it is written by the renderer and read back by the renderer, and main neither
 * inspects it nor acts on it. Validating its shape here would mean a second copy of the
 * design's state list that has to be kept in step for no gain — what main does validate is
 * that it is a JSON object of a bounded size, which is the property that protects the disk.
 */
export const SessionEnvelope = z.object({
  payload: z.record(z.string(), z.unknown()),
  savedAt: z.number().int().nonnegative()
})
export type SessionEnvelope = z.infer<typeof SessionEnvelope>


/* ────────────────────────────── recents ────────────────────────────── */

/**
 * One file the user has opened. This list is what the fidelity contract's "the sample library
 * is backed by real IFC files the user provides" resolves to on the desktop: the landing
 * page's pills and the sidebar's library popover render it, with the design's own markup and
 * the design's own "open all N" copy, and nothing at all when it is empty.
 */
export const RecentFile = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string(),
  openedAt: z.number().int().nonnegative()
})
export type RecentFile = z.infer<typeof RecentFile>

/**
 * Six, because `SGVue.dc.html:1938`'s "open all N" spells out counts up to six and falls back
 * to the digit above that. A seventh pill would read "open all 7 as a federation" — legal, and
 * a sentence the design never writes.
 */
export const RECENTS_MAX = 6

export const RecentAdd = RecentFile.omit({ openedAt: true })
export type RecentAdd = z.infer<typeof RecentAdd>

/* ────────────────────────────── share links ────────────────────────────── */

/**
 * `link:open` — main → renderer, one way. macOS delivers a `sgvue://` link through `open-url`,
 * Windows through the `second-instance` argv; both end here.
 */
export const LinkOpen = z.object({ url: z.string().min(1) })
export type LinkOpen = z.infer<typeof LinkOpen>

/* ────────────────────────────── the assistant ────────────────────────────── */

/**
 * The JSON a tool hands back. It is `unknown` on purpose: the executors own the shapes and
 * each one is validated where it is produced, in the renderer. Re-declaring twenty-five
 * result shapes here would be a second copy to keep in step for no gain — what main does
 * check is that a result is JSON of a bounded size, which is the property that protects the
 * transcript.
 */
const Json = z.unknown()

/**
 * `ai:turn:start`. `schema` is sent only when the federation has changed since the last
 * turn: it is a cache breakpoint, so main keeps the last one and re-sends it byte for byte.
 */
export const AiTurnStart = z.object({
  turnId: z.string().min(1).max(64),
  userText: z.string().min(1).max(20_000),
  /** `SGVue.dc.html:1596` — a reply carries its target inline. */
  quote: z.object({ who: z.string().max(32), text: z.string().max(400) }).nullish(),
  viewState: z.record(z.string(), Json),
  schema: z.record(z.string(), Json).nullish()
})
export type AiTurnStart = z.infer<typeof AiTurnStart>

/** `ai:turn:abort` — stop **this** turn. A late abort for a finished turn stops nothing newer. */
export const AiTurnAbort = z.object({ turnId: z.string().min(1).max(64) })

/**
 * The most JSON main takes from the renderer for one assistant value — a tool's `result`, a
 * turn's `viewState`, a turn's `schema` — measured as `JSON.stringify(value).length`, the way
 * `main/sessions.ts` measures a session. The zod schemas above say only *that* these are JSON;
 * this says how much.
 *
 * One million characters is ~250 000 tokens, far above anything legitimate: every tool result
 * is bounded at the source (2026-09-20, "every assistant result is bounded") — 200 SQL rows,
 * 50 colour groups, 40 valid values, 25 clash rows, 10-element samples, 2 000 ids — and the
 * schema lists at most 150 values per category. A result over the cap reaches the model as a
 * short `is_error` message instead; a turn whose view state or schema is over it is refused.
 */
export const AI_JSON_MAX_CHARS = 1_000_000

/** What the renderer learns while a turn runs. */
export const AiEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), turnId: z.string(), text: z.string() }),
  z.object({ type: z.literal('tool_start'), turnId: z.string(), name: z.string() }),
  z.object({
    type: z.literal('tool_done'),
    turnId: z.string(),
    name: z.string(),
    ms: z.number(),
    ok: z.boolean()
  }),
  z.object({
    type: z.literal('usage'),
    turnId: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreateTokens: z.number(),
    /**
     * The model that actually **served** this round, from the response — which is not always
     * the one the request asked for (`fallbacks: 'default'` is on). Optional because a round
     * the API answered without naming a model must not fail the schema. 2026-09-20.
     */
    model: z.string().optional()
  }),
  z.object({ type: z.literal('request_snapshot'), turnId: z.string(), json: z.string() }),
  z.object({ type: z.literal('done'), turnId: z.string(), text: z.string(), rounds: z.number() }),
  z.object({ type: z.literal('aborted'), turnId: z.string() }),
  z.object({
    type: z.literal('error'),
    turnId: z.string(),
    kind: z.enum([
      'no_key',
      'auth',
      'rate_limit',
      'bad_request',
      'connection',
      'overloaded',
      'refusal',
      'max_tokens',
      'round_cap',
      'timeout',
      'unknown'
    ]),
    message: z.string()
  })
])
export type AiEvent = z.infer<typeof AiEvent>
export type AiErrorKind = Extract<AiEvent, { type: 'error' }>['kind']

/** Main → renderer: run this tool call. */
export const AiToolExec = z.object({
  turnId: z.string(),
  callId: z.string(),
  name: z.string(),
  input: z.record(z.string(), Json)
})
export type AiToolExec = z.infer<typeof AiToolExec>

/** Renderer → main: the result, or the failure that becomes `is_error: true`. */
export const AiToolResult = z.object({
  turnId: z.string(),
  callId: z.string(),
  ok: z.boolean(),
  /** The JSON the model sees. Present when `ok`. */
  result: Json.optional(),
  /** The message the model sees instead. Present when not `ok`. */
  message: z.string().optional()
})
export type AiToolResult = z.infer<typeof AiToolResult>

/* ────────────────────────────── settings ────────────────────────────── */

/**
 * `backend` mirrors the design's own `backend` prop (`SGVue.dc.html:2123`). `webgpu` is not
 * offered: it leaked ~168 GB in the GPU process on the 137.9 MB model (`main/gpu-guard.ts`).
 */
export const RendererBackend = z.enum(['auto', 'webgl'])
export type RendererBackend = z.infer<typeof RendererBackend>

export const AiEffort = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])
export type AiEffort = z.infer<typeof AiEffort>

/** What the renderer is allowed to know. Note what is **not** here: the API key. */
export const SettingsView = z.object({
  model: z.string().min(1),
  effort: AiEffort,
  /** One hour of prompt cache instead of five minutes. Off by default. */
  cacheOneHour: z.boolean(),
  backend: RendererBackend,
  /**
   * Windows only (`main/gpu-choice.ts`): run on an NVIDIA adapter when there is one, else an AMD
   * one; off, Windows decides. On by default; read once, at launch.
   */
  preferNvidia: z.boolean(),
  hasKey: z.boolean(),
  /** False when the OS refuses to encrypt, so the dialog can say why the field is disabled. */
  keyStorageAvailable: z.boolean()
})
export type SettingsView = z.infer<typeof SettingsView>

/** A model id is a short slug; this only stops a renderer writing megabytes into settings. */
export const MODEL_ID_MAX = 200

export const SettingsPatch = SettingsView.pick({
  effort: true,
  cacheOneHour: true,
  backend: true,
  preferNvidia: true
})
  .extend({ model: z.string().min(1).max(MODEL_ID_MAX) })
  .partial()
export type SettingsPatch = z.infer<typeof SettingsPatch>

export const ApiKeyPayload = z.object({ key: z.string().min(1).max(512) })
export type ApiKeyPayload = z.infer<typeof ApiKeyPayload>


/* ────────────────────────────── the Schedules window (2026-09-25) ────────────────────────────── */

/** `schedules:open` carries nothing: the toolbar button asks for the window, and that is all. */
export const SchedulesOpenRequest = z.undefined()

/* ────────────────────────────── Schedules files (2026-09-25, phase 4) ────────────────────────────── */

/**
 * The largest export main will write: **50 MB**. Measured (`docs/DECISIONS.md`, phase 4): the
 * largest category of the 134 MB reference model, `IfcMember` at 4 082 rows in its default
 * columns, is a 0.13 MB workbook and a 0.33 MB CSV — about 32 and 82 bytes a row — so all
 * 15 889 of its elements in one schedule would be ~0.5 MB and ~1.3 MB, and a workbook of the
 * 100 saved setups My templates can hold, each that largest category, ~13 MB. 50 MB is about
 * four times that worst case, and still a small copy across the process boundary. It
 * exists so a renderer that has gone wrong cannot fill the user's disk, or main's memory,
 * through this channel; the page refuses sooner, with a message, before it asks.
 */
export const EXPORT_MAX_BYTES = 50 * 1024 * 1024

/** The largest `.schedule.json` main will read. A real one is a few kilobytes. */
export const SCHEDULE_FILE_MAX_BYTES = 1024 * 1024

/** What an export is: an Excel workbook, a CSV, or a schedule definition. Fixes the extension. */
export const ExportKind = z.enum(['xlsx', 'csv', 'schedule'])
export type ExportKind = z.infer<typeof ExportKind>

/**
 * `export:save`. `suggestedName` is only the Save dialog's default — main puts it in a folder
 * of its own choosing and writes wherever the user then points; the renderer never names a
 * path. No character Windows refuses in a name, no control character, no leading dot.
 */
export const ExportSaveRequest = z.object({
  kind: ExportKind,
  suggestedName: z
    .string()
    .min(1)
    .max(200)
    .regex(/^(?!\.)[^<>:"/\\|?*\u0000-\u001f]+$/),
  bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength <= EXPORT_MAX_BYTES, 'export too large')
})
export type ExportSaveRequest = z.infer<typeof ExportSaveRequest>

/** `scheduleFile:open` carries nothing: the user picks the file in the native Open dialog. */
export const ScheduleFileOpenRequest = z.undefined()

/* ────────────────────────────── the update notice (2026-10-01) ────────────────────────────── */

/** `update:check` carries nothing: main knows this build's version and where to ask. */
export const UpdateCheckRequest = z.undefined()

/** `update:open` carries nothing — in particular no URL: main builds the one it opens. */
export const UpdateOpenRequest = z.undefined()

/** What `update:check` answers when a newer version is out: its number, without a leading `v`. */
export interface UpdateInfo {
  latest: string
}
