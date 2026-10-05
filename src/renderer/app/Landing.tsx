/**
 * The landing page — `SGVue.dc.html:721–831`, ported element for element.
 *
 * Shown while `!booted` (`:1933`'s `showLanding`), at z-index 30, over whatever the stage
 * holds. Nothing loads by itself: the landing state owns the first model choice, exactly as
 * the design's comment at `:1095` says.
 *
 * The allowed desktop deviations, and nothing else (fidelity contract):
 *
 * · the drop-zone `<label>` keeps its copy, its dashed border and its two states, but behind
 *   it is Electron's native Open dialog rather than the design's hidden `<input type="file">`
 *   — a browser file input in a sandboxed renderer opens Chromium's own chooser, which is not
 *   the OS one, and the plan replaces it (§0 item 5);
 * · the sample pills are backed by the recents list (`main/sessions.ts`) rather than by a
 *   fixed table, rendered only when it is non-empty — the design's own `hasSamples`;
 * · 2026-09-21 — the design's footer strip (`:817–829`) is not in the port: no © line, no
 *   "Parsed locally, never uploaded", no `#privacy` / `#terms` / `#support` links and no
 *   divider rule. A desktop app has no site-level legal links. Its **theme toggle is kept
 *   unchanged**, in the same place — the strip is now a plain `<div>` holding only that button,
 *   right-aligned in the same 1080 px container at the same vertical position;
 * · 2026-09-24 — the app's version (`v1.0.0`, from `package.json` at build time) sits on the
 *   left of that same strip, which becomes `justify-content:space-between`; the toggle does
 *   not move;
 * · 2026-09-24 — the design's "Resume last session" card (`:756–764`) is not in the port,
 *   and the pills' heading (`:801`) reads "Recent" rather than "Sample federation" (same
 *   element, same style string — the CSS uppercases it). When the viewer is revealed the
 *   page fades out over the renderer's own 220 ms crossfade (`FADE_SECONDS`, linear) instead
 *   of vanishing, with the finished rows held as they were; under `prefers-reduced-motion`
 *   it goes at once;
 * · 2026-09-24 — "try the demo building →" loads the design's own four-model federation
 *   (`model/demo.ts`). A text button in the exact style of "open all N as a federation →", it
 *   is always offered: after the "or" divider — which is therefore always drawn — and under
 *   the Recent section when there is one;
 * · 2026-10-01 — each Recent pill carries its file's full path as a native `title`, so two
 *   files of one name can be told apart on hover. Nothing drawn changes;
 * · 2026-10-01 — when a newer version is out, a notice says so above the drop zone, with a
 *   button that opens the download page: the designed warning banner's own box, in the accent
 *   tokens. Main asks GitHub once per run (`main/updates.ts`); with no newer version, no
 *   answer or no network, nothing is drawn and the page is exactly what it was.
 *
 * The backdrop parallax is written **straight to CSS custom properties on the elements**
 * (`:1116–1125`) and never through state: a pointer move that re-rendered the page would
 * re-run the 26 s drift animation on every frame.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdateInfo } from '../../shared/ipc-contract'
import { openAllLabel } from '../../shared/upload'
import { FADE_SECONDS } from '../viewer/materials'
import * as pipeline from '../model/upload-pipeline'
import { pick, useShell, type LibraryFile } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { uploadRows } from '../state/selectors/uploads'
import { api } from '../api'
import { el } from '../dom'
import { s } from './css'
import { Logo } from './icons'

/** `SGVue.dc.html:1117`. Read once, as the design reads it once. */
let reduceMotion: boolean | undefined

const prefersReducedMotion = (): boolean => {
  if (reduceMotion === undefined) {
    reduceMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  return reduceMotion
}

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick(
  'booted', 'dragging', 'dropUpload', 'initErr', 'library', 'setDragging', 'setInitErr',
  'setTheme', 'theme', 'uploads'
)

export default function Landing(): React.JSX.Element | null {
  const st = useShell(useShallow(KEYS))
  const host = useRef<HTMLDivElement>(null)

  // 2026-09-24 — the reveal. When `booted` turns true the page stays mounted for one fade,
  // decided during render so there is never a frame without it, and then unmounts.
  const [leaving, setLeaving] = useState(false)
  const [wasBooted, setWasBooted] = useState(st.booted)
  if (st.booted !== wasBooted) {
    setWasBooted(st.booted)
    setLeaving(st.booted && !prefersReducedMotion())
  }
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setLeaving(false), FADE_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [leaving])

  // 2026-10-01 — is a newer version out? Asked once, when the page mounts. No bridge, no
  // answer, a refusal or `null` all leave this `null`, and then nothing is drawn for it.
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  useEffect(() => {
    let mounted = true
    api()
      ?.checkUpdate()
      .then((info) => {
        if (mounted) setUpdate(info)
      })
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [])

  // The rows are dropped at the reveal; the fading page keeps showing them as they were.
  const live = uploadRows(st.uploads)
  const held = useRef(live)
  if (!leaving) held.current = live
  const rows = leaving ? held.current : live

  /** `SGVue.dc.html:1116`. */
  const onBgMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion()) return
    const root = host.current
    if (!root) return
    const plane = el('bgplane', root)
    const glow = el('bgglow', root)
    const r = root.getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width - 0.5
    const ny = (e.clientY - r.top) / r.height - 0.5
    if (plane) {
      plane.style.setProperty('--bgx', (-nx * 90).toFixed(1) + 'px')
      plane.style.setProperty('--bgy', (-ny * 70).toFixed(1) + 'px')
      plane.style.setProperty('--bgz', (-24 + nx * 7).toFixed(2) + 'deg')
    }
    if (glow) {
      glow.style.setProperty('--gx', (e.clientX - r.left).toFixed(0) + 'px')
      glow.style.setProperty('--gy', (e.clientY - r.top).toFixed(0) + 'px')
    }
  }, [])

  /** `SGVue.dc.html:1139`. */
  const onBgLeave = useCallback(() => {
    const root = host.current
    const plane = root && el('bgplane', root)
    if (!plane) return
    plane.style.setProperty('--bgx', '0px')
    plane.style.setProperty('--bgy', '0px')
    plane.style.setProperty('--bgz', '-24deg')
  }, [])

  if (st.booted && !leaving) return null

  const drop = {
    title: st.dragging ? 'Release to load' : 'Drop IFC files here, or click to choose',
    line: st.dragging ? 'var(--accent)' : 'var(--border-strong)',
    bg: st.dragging ? 'var(--sel-bg)' : 'var(--card)'
  }
  const samples = st.library
  const isDark = st.theme === 'dark'

  return (
    <div
      data-role="landing"
      ref={host}
      onPointerMove={onBgMove}
      onPointerLeave={onBgLeave}
      style={s(
        'position:fixed;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;padding:32px;background:var(--ground);overflow:auto' +
          (leaving ? `;opacity:0;transition:opacity ${FADE_SECONDS}s linear;pointer-events:none` : '')
      )}
    >
      <div
        data-role="bg"
        aria-hidden="true"
        style={s('position:absolute;inset:0;overflow:hidden;pointer-events:none')}
      >
        <div
          data-role="bgplane"
          style={s(
            'position:absolute;left:-30%;top:-10%;width:160%;height:150%;transform-origin:50% 40%;transform:perspective(1100px) rotateX(66deg) rotateZ(var(--bgz,-24deg)) translate3d(var(--bgx,0px),var(--bgy,0px),0);transition:transform .5s cubic-bezier(.2,.7,.2,1);opacity:.5'
          )}
        >
          <div
            style={s(
              'position:absolute;inset:0;background:repeating-linear-gradient(0deg,var(--border) 0 1px,transparent 1px 88px),repeating-linear-gradient(90deg,var(--border) 0 1px,transparent 1px 88px);animation:ifcdrift 26s linear infinite'
            )}
          ></div>
          <div
            style={s(
              'position:absolute;inset:0;background:repeating-linear-gradient(0deg,var(--border-strong) 0 1px,transparent 1px 440px),repeating-linear-gradient(90deg,var(--border-strong) 0 1px,transparent 1px 440px)'
            )}
          ></div>
        </div>
        <div
          data-role="bgglow"
          style={s(
            'position:absolute;width:620px;height:620px;left:0;top:0;margin:-310px 0 0 -310px;border-radius:50%;background:radial-gradient(circle,var(--sel-bg) 0%,transparent 62%);opacity:.85;transform:translate3d(var(--gx,50vw),var(--gy,45vh),0);transition:transform .18s ease-out'
          )}
        ></div>
        <div
          style={s(
            'position:absolute;inset:0;background:linear-gradient(180deg,transparent 30%,var(--ground) 92%)'
          )}
        ></div>
      </div>

      <div
        style={s(
          'flex:1;display:flex;align-items:center;justify-content:center;width:100%;padding:24px 0 40px;position:relative'
        )}
      >
        <div
          style={s(
            'width:100%;max-width:620px;display:flex;flex-direction:column;gap:22px;animation:ifcrise .3s ease-out'
          )}
        >
          <div style={s('display:flex;flex-direction:column;gap:8px')}>
            <span style={s('display:flex;align-items:center;gap:10px')}>
              <Logo size={34} outline={1.3} vee={2.3} />
              <span style={s('display:flex;flex-direction:column;gap:3px')}>
                <span
                  style={s('font:600 19px/1 var(--sans);letter-spacing:-.01em;color:var(--ink)')}
                >
                  SGVue
                </span>
                <span
                  style={s(
                    'font:400 10.5px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--faint)'
                  )}
                >
                  IFC model review
                </span>
              </span>
            </span>
            <h1
              style={s(
                'margin:0;font:600 27px/1.2 var(--serif);letter-spacing:-.005em;color:var(--ink)'
              )}
            >
              Open a model to begin
            </h1>
            <p
              style={s(
                'margin:0;max-width:54ch;font:400 14px/1.55 var(--sans);color:var(--muted);text-wrap:pretty'
              )}
            >
              Load one IFC file or several — each becomes a model in the federation, with its own
              storeys, grids and colour. Files stay on this machine; parsing happens here in the
              browser.
            </p>
          </div>

          {/* 2026-10-01 — a newer version is out. The warning banner's box below, in the accent
              tokens; the button is the page's own text button. Drawn only with an answer. */}
          {update && (
            <div
              data-role="update-notice"
              style={s(
                'display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--sel-bg);border:1px solid var(--accent);border-radius:10px'
              )}
            >
              <span
                style={s(
                  'flex:1;min-width:0;font:400 12.5px/1.5 var(--sans);color:var(--sel-ink);text-wrap:pretty'
                )}
              >
                SGVue {update.latest} is available — you have {__APP_VERSION__}.
              </span>
              <button
                onClick={() => void api()?.openUpdatePage()}
                style={s(
                  'font:500 12px/1 var(--sans);color:var(--accent-ink);padding:2px 0;flex:none;white-space:nowrap'
                )}
              >
                get the update →
              </button>
            </div>
          )}

          {!!st.initErr && (
            <div
              style={s(
                'display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:10px'
              )}
            >
              <span style={s('flex:none;margin-top:1px;color:var(--warn-ink)')}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M12 3l9.5 17H2.5z" />
                  <path d="M12 9.5v5M12 17.2v.1" />
                </svg>
              </span>
              <span
                style={s(
                  'flex:1;min-width:0;font:400 12.5px/1.5 var(--sans);color:var(--warn-ink);text-wrap:pretty'
                )}
              >
                {st.initErr}
              </span>
              <button
                onClick={() => st.setInitErr('')}
                style={s('flex:none;font:500 11.5px/1 var(--sans);color:var(--warn-ink)')}
              >
                dismiss
              </button>
            </div>
          )}

          {/* The designed drop zone. The hidden `<input type="file">` is the one element the
              desktop replaces: the label opens Electron's native Open dialog instead. */}
          <label
            onClick={() => void pipeline.openDialog()}
            onDragOver={(e) => {
              e.preventDefault()
              st.setDragging(true)
            }}
            onDragLeave={() => st.setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              st.setDragging(false)
              void pipeline.dropFiles([...(e.dataTransfer?.files ?? [])])
            }}
            style={s(
              `display:flex;flex-direction:column;align-items:center;gap:13px;padding:34px 28px;border:1.5px dashed ${drop.line};border-radius:12px;background:${drop.bg};cursor:pointer;transition:background .15s ease,border-color .15s ease`
            )}
          >
            <span
              style={s(
                'width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:var(--step-bg);color:var(--accent-ink)'
              )}
            >
              <svg
                width="21"
                height="21"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 16V4" />
                <path d="M7.5 8.5L12 4l4.5 4.5" />
                <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
              </svg>
            </span>
            <span style={s('display:flex;flex-direction:column;align-items:center;gap:4px')}>
              <span style={s('font:500 15px/1.3 var(--sans);color:var(--ink)')}>{drop.title}</span>
              <span style={s('font:400 12px/1.4 var(--mono);color:var(--faint)')}>
                .ifc · .ifcxml · .ifczip
              </span>
            </span>
          </label>

          {rows.length > 0 && (
            <div
              style={s(
                'display:flex;flex-direction:column;gap:2px;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow)'
              )}
            >
              {rows.map((u) => (
                <div
                  key={u.id}
                  style={s(
                    'display:grid;grid-template-columns:22px minmax(0,1fr) auto auto;align-items:center;gap:11px;padding:7px 0'
                  )}
                >
                  <span
                    style={s(
                      'width:22px;height:22px;display:flex;align-items:center;justify-content:center'
                    )}
                  >
                    {u.done && (
                      <span
                        style={s(
                          'width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--ok-bg);color:var(--ok-ink);animation:ifcpop .3s ease-out'
                        )}
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 13l4.5 4.5L19 7" />
                        </svg>
                      </span>
                    )}
                    {u.busy && (
                      <span
                        style={s(
                          'width:13px;height:13px;border-radius:50%;border:2px solid var(--border-strong);border-top-color:var(--accent);animation:ifcspin .7s linear infinite'
                        )}
                      ></span>
                    )}
                  </span>
                  <span style={s('display:flex;flex-direction:column;gap:5px;min-width:0')}>
                    <span style={s('display:flex;align-items:baseline;gap:8px;min-width:0')}>
                      <span
                        style={s(
                          'font:500 13px/1.3 var(--sans);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
                        )}
                      >
                        {u.name}
                      </span>
                      <span
                        style={s(
                          'font:400 11px/1.3 var(--mono);color:var(--faint);white-space:nowrap'
                        )}
                      >
                        {u.size}
                      </span>
                    </span>
                    <span
                      style={s(
                        'position:relative;height:4px;border-radius:2px;background:var(--step-bg);overflow:hidden'
                      )}
                    >
                      <span
                        style={s(
                          `display:block;height:4px;border-radius:2px;background:${u.barColor};width:${u.pct}%;transition:width .35s ease`
                        )}
                      ></span>
                      {u.busy && (
                        <span
                          style={s(
                            'position:absolute;inset:0;width:22%;background:linear-gradient(90deg,transparent,var(--sel-ink),transparent);animation:ifcsweep 1.3s linear infinite'
                          )}
                        ></span>
                      )}
                    </span>
                    <span style={s(`font:400 11px/1.3 var(--mono);color:${u.stageColor}`)}>
                      {u.stage}
                    </span>
                  </span>
                  <span
                    style={s(
                      'font:400 11px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted)'
                    )}
                  >
                    {u.pctLabel}
                  </span>
                  {u.dismiss && (
                    <button
                      onClick={() => st.dropUpload(u.id)}
                      title="Dismiss"
                      className="hv-warn"
                      style={s(
                        'width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:5px;color:var(--warn-ink)'
                      )}
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Always drawn since 2026-09-24: the demo button below is always offered. */}
          <div style={s('display:flex;align-items:center;gap:10px')}>
            <span style={s('flex:1;height:1px;background:var(--border)')}></span>
            <span style={s('font:400 11px/1 var(--mono);color:var(--faint)')}>or</span>
            <span style={s('flex:1;height:1px;background:var(--border)')}></span>
          </div>

          {samples.length > 0 && (
            <div style={s('display:flex;flex-direction:column;gap:10px')}>
              <span
                style={s(
                  'font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)'
                )}
              >
                Recent
              </span>
              <div style={s('display:flex;flex-wrap:wrap;gap:8px')}>
                {samples.map((sp: LibraryFile) => (
                  <button
                    key={sp.key}
                    onClick={() => void pipeline.openLibrary([sp])}
                    title={sp.path || undefined}
                    className="hv-accent-step"
                    style={s(
                      'display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--card);border:1px solid var(--border);border-radius:999px;box-shadow:var(--shadow)'
                    )}
                  >
                    <span
                      style={s(`width:9px;height:9px;border-radius:2px;background:${sp.swatch}`)}
                    ></span>
                    <span style={s('font:500 12.5px/1 var(--sans);color:var(--ink)')}>
                      {sp.name}
                    </span>
                    <span style={s('font:400 11px/1 var(--mono);color:var(--faint)')}>
                      {sp.file}
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => void pipeline.openLibrary(samples)}
                style={s(
                  'align-self:flex-start;font:500 12px/1 var(--sans);color:var(--accent-ink);padding:2px 0'
                )}
              >
                {openAllLabel(samples.length)}
              </button>
            </div>
          )}

          {/* 2026-09-24 — the design's own demo building, on a fresh install too. The style
              string is "open all N as a federation →"'s, verbatim. */}
          <button
            onClick={() => void pipeline.openDemo()}
            style={s(
              'align-self:flex-start;font:500 12px/1 var(--sans);color:var(--accent-ink);padding:2px 0'
            )}
          >
            try the demo building →
          </button>
        </div>
      </div>

      <div
        style={s(
          'position:relative;width:100%;max-width:1080px;display:flex;align-items:center;justify-content:space-between;padding:18px 0 6px'
        )}
      >
        {/* 2026-09-24 — the app's version, on the left of the toggle's strip. */}
        <span style={s('font:400 11px/1 var(--mono);color:var(--faint)')}>v{__APP_VERSION__}</span>
        <button
          onClick={() => st.setTheme(isDark ? 'light' : 'dark')}
          data-tip={isDark ? 'switch to light' : 'switch to dark'}
          className="hv-accent-both"
          style={s(
            'width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid var(--border);color:var(--muted)'
          )}
        >
          {isDark ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
