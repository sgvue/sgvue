/**
 * Renderer, lights, ground and grid — `design-reference/design/viewer-core.js` L27–58.
 *
 * Everything here is the reference's, with one change that the fidelity contract requires
 * rather than forbids: the reference's scene constants (a ±48 m shadow frustum, a 600 m
 * ground disc, a 240 m grid helper, a sun at (−6, −16, 66) aimed at (12, 9, 4)) were authored
 * for its own mock federation, which is 40 × 34 × 16.5 m with a 27.5 m bounding sphere. A
 * literal constant of that kind once sliced the roof off a 56 m warehouse (`CLAUDE.md`,
 * rendering traps). Each one is therefore kept as *the reference's value × scale*, where
 * `scale = radius / REFERENCE_RADIUS`, so the mock renders with the reference's exact numbers
 * — the sun direction is identical to the last digit — and a 425 m model gets proportional
 * ones. Shadow `normalBias` scales with them because it is a world-space offset against a
 * shadow texel; `bias` is in depth units and does not.
 */
import {
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGPURenderer
} from 'three/webgpu'
import { REFERENCE_RADIUS } from './camera'
import type { Materials, ThemeName } from './materials'
import { THEMES } from './materials'
import { DEVTOOLS } from '../dev/flags'

export type Backend = 'WebGPU' | 'WebGL2'

/**
 * What a caller may ask for. `'auto'` is what the app passes, and since 2026-09-17 it means
 * **WebGL2** — see `forceWebGLFor` below.
 */
export type BackendPreference = 'auto' | 'webgl' | 'webgpu'

/**
 * Whether to force the WebGL2 path, decided before any adapter is consulted.
 *
 * `'auto'` resolved to WebGPU-first until 2026-09-17, when it was found to be unsafe on a
 * real model. three 0.186 has no multi-draw on WebGPU, so a `BatchedMesh` costs one
 * `drawIndexed` per visible instance — ~134 745 a frame on the 137.9 MB reference model — and
 * under that load the Electron **GPU helper process** grows by roughly 1 GB/s. It reached
 * ~168 GB and kernel-panicked this machine twice in one day (`CLAUDE.md`, three.js traps).
 * The WebGL2 backend issues one `WEBGL_multi_draw` per batch (~44 a frame), is about twice as
 * fast on that model, uses about a quarter of the renderer memory, and is flat.
 *
 * So WebGPU is now **opt-in only**: nothing reaches it without asking for it by name. The
 * status readout still reports whichever backend actually initialised, exactly as the design
 * does. Pure, so `tests/unit/scene-backend.test.ts` can check it.
 */
export function forceWebGLFor(preference: BackendPreference): boolean {
  return preference !== 'webgpu'
}

/** Just enough of the WebGPU API to refuse a software adapter; `@webgpu/types` is not a dep. */
type GpuNavigator = Navigator & {
  gpu?: { requestAdapter(): Promise<{ isFallbackAdapter?: boolean } | null> }
}

/**
 * Opaque-list order around the see-through ground (2026-09-24). The batches are at 0.
 *
 * · The grid helper first, and the opaque ground straight after it, depth-tested against it:
 *   that is the order the two had before (the opaque sort put the helper, 0.015 × scale nearer,
 *   first), so wherever the ground wins the depth fight on a far, grazing line it still does.
 * · The veil after every batch. It is the ground's own plane, so it wins and loses that fight
 *   on exactly the samples the ground did, and over them it blends ground over ground.
 *
 * Drawn the other way round — helper after the veil, or the ground before the helper — the far
 * gridlines change by up to 21 levels over ~60 000 pixels of the mock's plain ground.
 */
export const GRID_HELPER_ORDER = -2
export const GROUND_ORDER = -1
export const GROUND_VEIL_ORDER = 10

/** The sun's offset from its target in the reference, before scaling (L49). */
const SUN_OFFSET = new Vector3(-18, -25, 62)

/** `radius / REFERENCE_RADIUS`, clamped so a single wall or a city block stays sane. */
export const sceneScale = (bbox: Box3): number => {
  const r = bbox.isEmpty() ? REFERENCE_RADIUS : bbox.getSize(new Vector3()).length() / 2
  return Math.min(60, Math.max(0.2, r / REFERENCE_RADIUS))
}

/**
 * Where the ground stands (2026-10-01): at the **project frame's own zero** — `datumZ`, in scene
 * coordinates — whenever the model's z range spans it, and otherwise at the **bottom** of that
 * range. Never at the top of it.
 *
 * Scene z = 0 is *not* that zero. The scene is the project frame less the whole-metre federation
 * offset, and the offset's Z is the height of the first placement web-ifc happens to stream
 * (`worker/geometry-streamer.ts`) — near the file's zero in most exports, a member high in the
 * structure in a Tekla steel one. The ground stood at scene 0 until this rule, so such a file,
 * opened alone, had its grid up near its top and the structure hanging under it. The caller
 * passes `0 − offset z`.
 *
 * An empty range (min +∞, max −∞) reads −∞, exactly as the clamp this replaces did: nothing is
 * loaded, and a ground at −∞ is not drawn.
 */
export const groundLevel = (datumZ: number, minZ: number, maxZ: number): number =>
  minZ <= datumZ && datumZ <= maxZ ? datumZ : Math.min(minZ, maxZ)

export interface RendererHandle {
  renderer: WebGPURenderer
  backend: Backend
}

/**
 * `viewer-core.js` L30–39, plus the plan's fallback-adapter check: a software WebGPU adapter
 * is slower than the real WebGL2 path and misreports itself as WebGPU, so it is refused
 * before `init()` rather than discovered at 4 fps. It only ever runs for an explicit
 * `'webgpu'`, since every other preference has already forced WebGL2.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  backendPreference: BackendPreference = 'auto'
): Promise<RendererHandle> {
  let forceWebGL = forceWebGLFor(backendPreference)
  const gpu = (navigator as GpuNavigator).gpu
  if (!forceWebGL && gpu) {
    try {
      const adapter = await gpu.requestAdapter()
      if (!adapter || adapter.isFallbackAdapter) forceWebGL = true
    } catch {
      forceWebGL = true
    }
  }
  // `#aa=0`, dev-only (`DEVTOOLS` is statically `false` in a production build, where this
  // folds back to the constant `true` it has always been). Antialiasing is fixed at
  // construction — there is no runtime switch for it on either backend — so
  // `scripts/profile-frame.cjs` cannot measure what MSAA costs without re-creating the
  // renderer; this launch flag is how, and it reaches nothing else.
  const antialias = DEVTOOLS ? !/(^|[#&?])aa=0\b/.test(location.hash + location.search) : true
  const renderer = new WebGPURenderer({ canvas, antialias, forceWebGL })
  await renderer.init()
  const backend: Backend =
    renderer.backend && (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
      ? 'WebGPU'
      : 'WebGL2'
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  // The shadow toggle never touches shader state — that recompiles every node material and
  // stalls the tab. The map stays enabled and casters are dropped instead (L35–38).
  renderer.shadowMap.enabled = true
  // The reference asks for `PCFSoftShadowMap`; three 0.186 removed it (both backends warn and
  // fall back), so this is the closest the version we pin still offers — a five-tap Vogel
  // disk scaled by `light.shadow.radius`, which is soft, just not the r170 filter.
  renderer.shadowMap.type = PCFShadowMap
  // The reference also sets `localClippingEnabled`; three 0.186's node renderer has no such
  // flag, and it would do nothing here anyway — the section cut is a TSL plane test on the
  // material (`materials.ts`), which is the reference's own choice for exactly that reason.
  return { renderer, backend }
}

/**
 * The adapter ANGLE draws on, as WebGL names it (`UNMASKED_RENDERER_WEBGL`) — `debug().gpu`,
 * for the harnesses (2026-09-25, `main/gpu-choice.ts`). `null` on WebGPU, which has no `gl`.
 */
export function glRendererName(renderer: WebGPURenderer): string | null {
  const gl = (renderer.backend as { gl?: WebGL2RenderingContext | null }).gl
  if (!gl) return null
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
}

export interface SceneRig {
  scene: Scene
  sun: DirectionalLight
  ground: Mesh
  /** Z of the ground plane, in scene coordinates: `groundLevel` of the datum and the model's z range. */
  groundZ: number
  scale: number
  setTheme(name: ThemeName): void
  /**
   * Show or hide the fine ground grid (2026-09-24, owner-requested) and, with it, the ground veil
   * (2026-10-08, owner-requested). The helper is rebuilt on every theme change and the rig on
   * every rescale; both keep the flag, so it survives either.
   */
  setGroundGrid(on: boolean): void
  /** Re-render the shadow map on the next frame. See `sun.shadow.autoUpdate` below. */
  invalidateShadows(): void
  dispose(): void
}

/**
 * `datumZ` is the project frame's own zero in scene coordinates — `0 − offset z`, which the
 * viewer holds — and is where the ground goes (`groundLevel`). It is 0 on the design's mock.
 */
export function buildScene(
  bbox: Box3,
  materials: Materials,
  themeName: ThemeName,
  groundGrid = true,
  datumZ = 0
): SceneRig {
  const T = THEMES[themeName]
  const s = sceneScale(bbox)
  const size = bbox.isEmpty() ? new Vector3(40, 34, 16.5) : bbox.getSize(new Vector3())
  const centre = bbox.isEmpty() ? new Vector3(12, 9, 7.25) : bbox.getCenter(new Vector3())

  const scene = new Scene()
  scene.background = new Color(T.bg)

  const hemi = new HemisphereLight(0xffffff, 0x9aa5a0, 1.4)
  hemi.position.set(0, 0, 1)
  scene.add(hemi)

  const sun = new DirectionalLight(0xffffff, 0.95)
  // The reference aims a little below the model's middle; on its own mock that is (12, 9, 4).
  sun.target.position.set(centre.x, centre.y, bbox.min.z + size.z * 0.3)
  sun.position.copy(sun.target.position).addScaledVector(SUN_OFFSET, s)
  scene.add(sun, sun.target)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.03 * s
  Object.assign(sun.shadow.camera, {
    left: -48 * s,
    right: 48 * s,
    top: 48 * s,
    bottom: -48 * s,
    near: 5 * s,
    far: 200 * s
  })
  sun.shadow.camera.updateProjectionMatrix()
  /*
   * The shadow map is re-rendered only when the scene changes — `invalidateShadows()` below,
   * and `viewer-core.ts` for the five things that call it.
   *
   * It is sound because the sun does not move with the camera: its target is the model's own
   * centre and its position is that plus a fixed offset, so the shadow camera sees exactly the
   * same scene from exactly the same place however the view camera orbits. What is inside that
   * frustum *can* change — geometry arriving or leaving, a part hidden, ghosted or coloured
   * (the family materials discard by alpha in the shadow pass too), the section plane — and
   * every one of those already goes through a call site. The reference re-renders it every
   * frame because `LightShadow.autoUpdate` defaults to `true` and it never thought about it;
   * the map it produces is identical either way.
   *
   * `ShadowNode.updateBefore` (three 0.186, `src/nodes/lighting/ShadowNode.js:800`) is what
   * reads these two: `shadow.needsUpdate || shadow.autoUpdate`.
   */
  sun.shadow.autoUpdate = false
  sun.shadow.needsUpdate = true

  // The reference's mock puts grade at its own z = 0, which is its file's zero: that is what
  // `datumZ` is here, and scene z = 0 is not (`groundLevel`). A model that sits entirely above
  // or below its datum gets the floor under it instead.
  const groundZ = groundLevel(datumZ, bbox.min.z, bbox.max.z)

  const ground = new Mesh(new PlaneGeometry(600 * s, 600 * s), materials.ground)
  ground.position.z = groundZ - 0.02 * s
  ground.receiveShadow = true
  // See-through ground (2026-09-24): the opaque layer goes before the batches and writes no
  // depth, and the veil — same plane, same geometry — is blended over it after them
  // (`materials.ts`, `groundVeil`; the orders are `GROUND_ORDER` above). All of it is inside
  // the opaque list, which draws entirely before the transparent one.
  ground.renderOrder = GROUND_ORDER
  const veil = new Mesh(ground.geometry, materials.groundVeil)
  veil.position.z = ground.position.z
  veil.receiveShadow = true
  veil.renderOrder = GROUND_VEIL_ORDER
  // 2026-10-08 (owner-requested): the veil is drawn only while the canvas grid is on. Off, the
  // opaque layer is the whole ground — it still takes the shadow — and, the veil's depth gone
  // with it, nothing below grade is dimmed or hidden. `setGroundGrid` below moves it with the
  // helper.
  veil.visible = groundGrid
  scene.add(ground, veil)

  let gridHelper: GridHelper | null = null
  let gridOn = groundGrid
  const buildGridHelper = (name: ThemeName): void => {
    if (gridHelper) {
      scene.remove(gridHelper)
      gridHelper.geometry.dispose()
      ;(gridHelper.material as { dispose(): void }).dispose()
    }
    const t = THEMES[name]
    gridHelper = new GridHelper(240 * s, 120, t.grid1, t.grid2)
    gridHelper.rotation.x = Math.PI / 2
    gridHelper.position.z = groundZ - 0.005 * s
    gridHelper.renderOrder = GRID_HELPER_ORDER
    gridHelper.visible = gridOn
    scene.add(gridHelper)
  }
  buildGridHelper(themeName)

  return {
    scene,
    sun,
    ground,
    groundZ,
    scale: s,
    setTheme: (name) => {
      ;(scene.background as Color).set(THEMES[name].bg)
      buildGridHelper(name)
      sun.shadow.needsUpdate = true
    },
    setGroundGrid: (on) => {
      gridOn = on
      if (gridHelper) gridHelper.visible = on
      veil.visible = on
    },
    invalidateShadows: () => {
      sun.shadow.needsUpdate = true
    },
    dispose: () => {
      if (gridHelper) {
        scene.remove(gridHelper)
        gridHelper.geometry.dispose()
        ;(gridHelper.material as { dispose(): void }).dispose()
        gridHelper = null
      }
      scene.remove(ground, veil)
      ground.geometry.dispose()
      scene.remove(hemi, sun, sun.target)
      sun.dispose()
      hemi.dispose()
    }
  }
}
