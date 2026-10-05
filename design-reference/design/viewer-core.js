import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.webgpu.js';
import { COLORS } from './sample-model.js';

const THEMES = {
  dark: { bg: 0x0f1516, ground: 0x171f20, grid1: 0x263332, grid2: 0x1d2726, edge: 0x0f1516, gridline: 0x798c8a, level: 0x94a7a4, accent: 0x35c4b6, cut: 0x3b494c, card: '#171F20', cardHover: '#12302D', ink: '#E4ECEA', muted: '#94A7A4', border: '#354544', accentCss: '#35C4B6' },
  light: { bg: 0xf4f7f6, ground: 0xffffff, grid1: 0xdce4e2, grid2: 0xe9efee, edge: 0x1b2a2c, gridline: 0x7c8f8e, level: 0x54696b, accent: 0x0e8a80, cut: 0x55666a, card: '#FFFFFF', cardHover: '#E2F0EE', ink: '#1B2A2C', muted: '#54696B', border: '#BFCFCC', accentCss: '#0E8A80' },
};
const Z = new THREE.Vector3(0, 0, 1);
const fmtMM = (m) => Math.round(m * 1000).toLocaleString('en-US').replace(/,/g, '\u2009') + ' mm';

function mergeBoxes(boxes) {
  const geos = boxes.map((b) => { const g = new THREE.BoxGeometry(b.s[0], b.s[1], b.s[2]); g.translate(b.p[0], b.p[1], b.p[2]); return g; });
  let nv = 0, ni = 0; geos.forEach((g) => { nv += g.attributes.position.count; ni += g.index.count; });
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  geos.forEach((g) => {
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); uv.set(g.attributes.uv.array, vo * 2);
    const ia = g.index.array; for (let k = 0; k < ia.length; k++) idx[io + k] = ia[k] + vo;
    vo += g.attributes.position.count; io += ia.length; g.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

export async function createViewer(o) {
  const { canvas, cubeCanvas, overlay, model, on = {} } = o;
  let theme = o.theme || 'dark', T = THEMES[theme];
  const forceWebGL = o.backend === 'webgl';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
  await renderer.init();
  const backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // Shadow toggle never touches shader state (that recompiles every node material and stalls the tab): the map stays
  // enabled and we simply drop all casters, which leaves the shadow map empty.
  let shadowsOn = o.shadows !== false;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(T.bg);

  // cameras
  const persp = new THREE.PerspectiveCamera(50, 1, 0.1, 3000); persp.up.copy(Z);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 3000); ortho.up.copy(Z);
  let camera = persp, projection = 'persp';

  // lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa5a0, 1.4); hemi.position.set(0, 0, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.95); sun.position.set(-6, -16, 66); sun.target.position.set(12, 9, 4); scene.add(sun, sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 5, far: 200 }); sun.shadow.camera.updateProjectionMatrix();

  // ground
  const groundMat = new THREE.MeshStandardMaterial({ color: T.ground, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), groundMat); ground.position.z = -0.02; ground.receiveShadow = true; scene.add(ground);
  let gridHelper = null;
  const buildGridHelper = () => { if (gridHelper) { scene.remove(gridHelper); gridHelper.geometry.dispose(); } gridHelper = new THREE.GridHelper(240, 120, T.grid1, T.grid2); gridHelper.rotation.x = Math.PI / 2; gridHelper.position.z = -0.005; scene.add(gridHelper); };
  buildGridHelper();

  // materials
  // Section clipping is done in-shader (TSL) against a world-space plane uniform: dot(p, n) + c >= 0 is kept.
  // (r170's WebGPU ClippingContext caches projected planes and goes camera-locked / stale on update.)
  const TSL = THREE.TSL || THREE, sel = TSL.select || TSL.cond, NO_CLIP = { n: new THREE.Vector3(0, 0, 1), c: 1e5 };
  const clipN = TSL.uniform(NO_CLIP.n.clone()), clipC = TSL.uniform(NO_CLIP.c);
  const clipKeep = () => TSL.positionWorld.dot(clipN).add(clipC).greaterThanEqual(0);
  const clipify = (m, op = 1) => { m.opacityNode = sel(clipKeep(), TSL.float(op), TSL.float(0)); m.alphaTest = 0.001; return m; };
  const cutCol = TSL.uniform(new THREE.Color(T.cut)), hoverEmis = TSL.uniform(new THREE.Color(T.accent).multiplyScalar(0.22));
  const capify = (m, emis) => { m.colorNode = sel(TSL.frontFacing, TSL.materialColor, TSL.vec3(0)); m.emissiveNode = sel(TSL.frontFacing, emis ? emis : TSL.vec3(0), cutCol); return m; };
  const mats = {}, hoverMats = {};
  const matFor = (key) => {
    if (mats[key]) return mats[key];
    const c = COLORS[key] || { color: 0x999999 }, op = c.opacity ?? 1;
    const m = clipify(new THREE.MeshStandardNodeMaterial({ color: c.color, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, transparent: op < 1, opacity: op, depthWrite: op >= 1 }), op);
    if (op >= 1) capify(m);
    mats[key] = m; return m;
  };
  const hoverFor = (key) => { if (!hoverMats[key]) { const m = matFor(key).clone(); clipify(m, m.opacity); if (m.opacity >= 1) capify(m, hoverEmis); else { m.emissive = new THREE.Color(T.accent); m.emissiveIntensity = 0.22; } hoverMats[key] = m; } return hoverMats[key]; };
  // per-model colour override: same build as matFor, but the part colour is replaced while the source
  // material's opacity (glass, railings) is kept so overridden models still read correctly.
  const ovMats = {}, ovHover = {};
  let modelColors = {}, nativeMats = true, elColors = {};
  const ovFor = (hex, key, hover) => {
    const bank = hover ? ovHover : ovMats, id = hex + '|' + key;
    if (bank[id]) return bank[id];
    const c = COLORS[key] || {}, op = c.opacity ?? 1;
    const m = clipify(new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, transparent: op < 1, opacity: op, depthWrite: op >= 1 }), op);
    if (op >= 1) capify(m, hover ? hoverEmis : null);
    else if (hover) { m.emissive = new THREE.Color(T.accent); m.emissiveIntensity = 0.3; }
    bank[id] = m; return m;
  };
  const baseFor = (rec, i, hover) => {
    const ec = elColors[rec.el.id];
    if (ec) return ovFor(ec, rec.keys[i], hover);
    const c = nativeMats ? null : modelColors[rec.el.model];
    return c ? ovFor(c, rec.keys[i], hover) : hover ? hoverFor(rec.keys[i]) : matFor(rec.keys[i]);
  };
  const selMat = clipify(new THREE.MeshStandardNodeMaterial({ color: T.accent, emissive: T.accent, emissiveIntensity: 0.35, roughness: 0.6, side: THREE.DoubleSide }));
  const ghostMat = clipify(new THREE.MeshStandardNodeMaterial({ color: 0x8a9492, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }), 0.1);
  // models outside activate mode: visible but faded right back and inert
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const inertMat = clipify(new THREE.MeshStandardNodeMaterial({ color: 0x8a9492, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }), 0.08);
  // one shared pair of materials crossfades a whole isolate/hide batch: no per-element material churn
  const fadeOutMat = clipify(new THREE.MeshStandardNodeMaterial({ color: 0x8a9492, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }), 0.3);
  const fadeInMat = clipify(new THREE.MeshStandardNodeMaterial({ color: 0x8a9492, transparent: true, opacity: 0.02, depthWrite: false, side: THREE.DoubleSide }), 0.02);
  const hlMat = clipify(new THREE.MeshStandardNodeMaterial({ color: T.accent, emissive: T.accent, emissiveIntensity: 0.15, roughness: 0.8, side: THREE.DoubleSide }));
  let hlColor = null; // user-picked highlight colour; null = theme accent
  const edgeMat = clipify(new THREE.LineBasicNodeMaterial({ color: T.edge, transparent: true, opacity: 0.45 }), 0.45);
  const selEdgeMat = clipify(new THREE.LineBasicNodeMaterial({ color: T.accent }));
  const allMats = () => [...Object.values(mats), ...Object.values(hoverMats), ...Object.values(ovMats), ...Object.values(ovHover), inertMat, fadeOutMat, fadeInMat, selMat, ghostMat, hlMat, edgeMat, selEdgeMat];

  // elements
  const group = new THREE.Group(); scene.add(group);
  const recs = new Map(), byMesh = new Map(); const bbox = new THREE.Box3();
  for (const el of model.elements) {
    const parts = el.parts || [{ boxes: el.boxes, color: el.color }];
    const rec = { el, meshes: [], edges: [], keys: [], bbox: new THREE.Box3(), verts: [], segs: [], visible: true, hl: false };
    const vset = new Set();
    for (const p of parts) {
      const geo = mergeBoxes(p.boxes), mat = matFor(p.color);
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = shadowsOn && !mat.transparent; mesh.receiveShadow = true; mesh.userData.id = el.id;
      const eg = new THREE.EdgesGeometry(geo, 20), line = new THREE.LineSegments(eg, edgeMat); line.renderOrder = 1;
      group.add(mesh, line); rec.meshes.push(mesh); rec.edges.push(line); rec.keys.push(p.color); byMesh.set(mesh, rec); rec.bbox.union(geo.boundingBox);
      const a = eg.attributes.position.array;
      for (let i = 0; i < a.length; i += 6) {
        rec.segs.push([new THREE.Vector3(a[i], a[i + 1], a[i + 2]), new THREE.Vector3(a[i + 3], a[i + 4], a[i + 5])]);
        for (let k = 0; k < 6; k += 3) { const key = a[i + k].toFixed(4) + ',' + a[i + k + 1].toFixed(4) + ',' + a[i + k + 2].toFixed(4); if (!vset.has(key)) { vset.add(key); rec.verts.push(new THREE.Vector3(a[i + k], a[i + k + 1], a[i + k + 2])); } }
      }
    }
    recs.set(el.id, rec); bbox.union(rec.bbox);
  }
  const center = bbox.getCenter(new THREE.Vector3());
  let pickList = [], pickOk = null;
  const rebuildPick = () => { pickList = []; recs.forEach((r) => { if (r.visible && (!pickOk || pickOk(r.el))) pickList.push(...r.meshes); }); };
  rebuildPick();

  // labels
  const labels = [];
  const mkLabel = (pos, html, style = {}, dx = 0, dy = 0) => {
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'absolute', left: 0, top: 0, pointerEvents: 'none', whiteSpace: 'nowrap', willChange: 'transform', display: 'none' }, style);
    el.innerHTML = html; overlay.appendChild(el);
    const L = { el, pos: pos.clone(), dx, dy, on: true, remove() { el.remove(); const i = labels.indexOf(L); if (i >= 0) labels.splice(i, 1); } };
    labels.push(L); return L;
  };
  const labelBase = () => ({ font: '400 11px/1 "IBM Plex Mono", Consolas, monospace', color: 'var(--muted)', background: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: '5px', padding: '4px 6px', boxShadow: 'var(--shadow)' });
  const v3 = new THREE.Vector3();
  const updateLabels = (w, h) => {
    let lastStack = Infinity;
    for (const L of labels) {
      if (!L.on || L.occluded) { L.el.style.display = 'none'; continue; }
      v3.copy(L.pos).project(camera);
      const off = v3.z > 1 || v3.x < -1.3 || v3.x > 1.3 || v3.y < -1.3 || v3.y > 1.3;
      if (off && !L.clamp) { L.el.style.display = 'none'; continue; }
      if (v3.z > 1) { L.el.style.display = 'none'; continue; }
      L.el.style.display = '';
      let x = (v3.x + 1) / 2 * w + L.dx, y = (1 - v3.y) / 2 * h + L.dy;
      if (L.clamp) {
        // the camera frames the model, not the annotation: keep tags on screen and unstacked
        const hw = (L.el.offsetWidth || 80) / 2, hh = (L.el.offsetHeight || 20) / 2;
        x = Math.min(Math.max(x, hw + 6), w - hw - 6);
        y = Math.min(Math.max(y, hh + 6), h - hh - 6);
        if (L.stack) { const gap = 2 * hh + 3; if (y > lastStack - gap) y = lastStack - gap; lastStack = y; }
      }
      L.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    }
  };

  // grids + levels
  const gridGroup = new THREE.Group(), levelGroup = new THREE.Group(); scene.add(gridGroup, levelGroup);
  const gridLineMat = new THREE.LineBasicMaterial({ color: T.gridline, transparent: true, opacity: 0.7 });
  const levelLineMat = new THREE.LineBasicMaterial({ color: T.level, transparent: true, opacity: 0.45 });
  const gridLabels = [], levelLabels = [];
  const mn = bbox.min, mx = bbox.max;
  // keep annotation off the geometry: at least 2.5 m, more on big footprints
  const pad = Math.max(2.5, Math.max(mx.x - mn.x, mx.y - mn.y) * 0.06);
  const bubbleStyle = () => ({ ...labelBase(), width: '26px', height: '26px', padding: 0, boxSizing: 'border-box', borderRadius: '50%', lineHeight: '24px', textAlign: 'center', fontWeight: '500', fontSize: '11.5px', color: 'var(--ink)', pointerEvents: 'auto', cursor: 'pointer', userSelect: 'none' });
  const gridRecs = [];
  for (const g of model.grids) {
    const pts = g.axis === 'x' ? [new THREE.Vector3(g.v, mn.y - pad, 0.01), new THREE.Vector3(g.v, mx.y + pad, 0.01)] : [new THREE.Vector3(mn.x - pad, g.v, 0.01), new THREE.Vector3(mx.x + pad, g.v, 0.01)];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridLineMat); gridGroup.add(line);
    const rec = { axis: g.axis, line, ends: [] };
    for (const [p, sign] of [[pts[0].clone().add(g.axis === 'x' ? new THREE.Vector3(0, -1.1, 0) : new THREE.Vector3(-1.1, 0, 0)), -1], [pts[1].clone().add(g.axis === 'x' ? new THREE.Vector3(0, 1.1, 0) : new THREE.Vector3(1.1, 0, 0)), 1]]) {
      const L = mkLabel(p, g.name, bubbleStyle()); L.el.title = `Show plane of grid ${g.name}`; L.occlude = true;
      // elevation-view stem: a vertical line from the ground up to the lifted bubble, so the grid reads
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.x, p.y, 0.01), new THREE.Vector3(p.x, p.y, mx.z + pad - 0.7)]), gridLineMat);
      stem.visible = false; gridGroup.add(stem);
      L.el.addEventListener('click', (e) => { e.stopPropagation(); on.gridClick && on.gridClick(g.name); });
      L.el.addEventListener('pointerenter', () => { L.el.style.borderColor = 'var(--accent)'; L.el.style.color = 'var(--accent-ink)'; });
      L.el.addEventListener('pointerleave', () => { L.el.style.borderColor = 'var(--border-strong)'; L.el.style.color = 'var(--ink)'; });
      gridLabels.push(L); rec.ends.push({ L, stem, sign });
    }
    gridRecs.push(rec);
  }
  // In an elevation only the grid family that spreads across the screen is meaningful: the other family
  // collapses into the view direction. Bubbles lift over the roof and only the near-side one is kept.
  let gridsOn = true, gridKey = '';
  const updateGridView = (force) => {
    const up = Math.abs(cur.phi - Math.PI / 2) < 0.25;
    const alongX = Math.abs(Math.cos(cur.theta)) > Math.abs(Math.sin(cur.theta));
    const nearSign = (alongX ? Math.cos(cur.theta) : Math.sin(cur.theta)) > 0 ? 1 : -1;
    const key = `${gridsOn}|${up}|${up ? (alongX ? 'x' : 'y') + nearSign : ''}`;
    if (key === gridKey && !force) return;
    gridKey = key;
    const keepAxis = up ? (alongX ? 'y' : 'x') : null, z = up ? mx.z + pad : 0.01;
    for (const r of gridRecs) {
      const keep = gridsOn && (!keepAxis || r.axis === keepAxis);
      r.line.visible = keep;
      for (const e of r.ends) {
        const show = keep && (!up || e.sign === nearSign);
        e.L.on = show; e.L.pos.z = z; e.stem.visible = show && up;
      }
    }
  };
  for (const s of model.storeys) {
    const z = s.elev, a = mn.x - pad, b = mx.x + pad, c = mn.y - pad, d = mx.y + pad;
    const pts = [a, c, b, c, b, d, a, d, a, c].reduce((acc, _, i, arr) => (i % 2 ? acc : [...acc, new THREE.Vector3(arr[i], arr[i + 1], z)]), []);
    levelGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), levelLineMat));
    const mm = Math.round(z * 1000);
    const tag = mkLabel(new THREE.Vector3(a, d, z), `<b style="font-weight:500;color:var(--ink)">${s.name}</b>&nbsp; ${mm >= 0 ? '+' : '\u2212'}${Math.abs(mm).toLocaleString('en-US').replace(/,/g, '\u2009')}`, labelBase(), -30, 0);
    tag.clamp = true; tag.stack = true; levelLabels.push(tag);
  }
  levelGroup.visible = false; levelLabels.forEach((L) => (L.on = false));

  // section outline
  const secMat = new THREE.LineBasicMaterial({ color: T.accent, transparent: true, opacity: 0.8 });
  const secLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([0, 1, 2, 3, 4].map(() => new THREE.Vector3())), secMat); secLine.visible = false; scene.add(secLine);
  // translucent sheet shown when the plane is only being previewed (cut off)
  const sheetMat = new THREE.MeshBasicMaterial({ color: T.accent, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const secSheet = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([0, 1, 2, 0, 2, 3].map(() => new THREE.Vector3())), sheetMat); secSheet.visible = false; secSheet.renderOrder = 3; scene.add(secSheet);
  let section = null;
  function setSection(cfg) {
    const prev = section; section = cfg;
    clipN.value.copy(NO_CLIP.n); clipC.value = NO_CLIP.c; secLine.visible = false; secSheet.visible = false;
    if (cfg && cfg.kind) {
      const m = 1.5; let n, c, q;
      if (cfg.kind === 'grid') {
        const g = model.grids.find((x) => x.name === cfg.name); if (!g) return;
        const v = g.v + (cfg.offset || 0);
        const toward = (g.axis === 'x' ? center.x : center.y) >= v ? 1 : -1, sgn = cfg.flip ? -toward : toward; // keep the side holding the model
        if (g.axis === 'x') { n = new THREE.Vector3(sgn, 0, 0); q = [[v, mn.y - m, mn.z - m], [v, mx.y + m, mn.z - m], [v, mx.y + m, mx.z + m], [v, mn.y - m, mx.z + m]]; }
        else { n = new THREE.Vector3(0, sgn, 0); q = [[mn.x - m, v, mn.z - m], [mx.x + m, v, mn.z - m], [mx.x + m, v, mx.z + m], [mn.x - m, v, mx.z + m]]; }
        c = -sgn * v;
      } else {
        const s = model.storeys.find((x) => x.name === cfg.name); if (!s) return;
        const v = s.elev + (cfg.offset || 0);
        n = new THREE.Vector3(0, 0, cfg.flip ? 1 : -1); c = cfg.flip ? -v : v;
        q = [[mn.x - m, mn.y - m, v], [mx.x + m, mn.y - m, v], [mx.x + m, mx.y + m, v], [mn.x - m, mx.y + m, v]];
      }
      const cut = cfg.cut !== false;
      if (cut) { clipN.value.copy(n); clipC.value = c; }
      const pa = secLine.geometry.attributes.position; q.forEach((p, i) => pa.setXYZ(i, p[0], p[1], p[2])); pa.setXYZ(4, q[0][0], q[0][1], q[0][2]); pa.needsUpdate = true; secLine.visible = true;
      const sp = secSheet.geometry.attributes.position; [0, 1, 2, 0, 2, 3].forEach((k, i) => sp.setXYZ(i, q[k][0], q[k][1], q[k][2])); sp.needsUpdate = true; secSheet.visible = !cut;
      const moved = cut && (!prev || !prev.kind || prev.cut === false || prev.kind !== cfg.kind || prev.name !== cfg.name || !!prev.flip !== !!cfg.flip);
      if (moved) { viewDir(n.clone().negate()); fitBox(bbox); on.cubeView && on.cubeView(); }
    }
  }

  // camera controller
  const goal = { theta: -Math.PI / 4, phi: 1.05, dist: 60, target: center.clone(), half: 12 };
  const cur = { theta: goal.theta, phi: goal.phi, dist: goal.dist, target: center.clone(), half: 12 };
  const dirOf = (th, ph, out) => out.set(Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph));
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpM = new THREE.Matrix4();
  function placeCamera(c) {
    dirOf(c.theta, c.phi, tmpA);
    camera.position.copy(c.target).addScaledVector(tmpA, projection === 'persp' ? c.dist : 400);
    const f = tmpA.negate();
    let r = tmpB.crossVectors(f, Z);
    if (r.lengthSq() < 1e-6) r = tmpB.crossVectors(f, new THREE.Vector3(0, 1, 0));
    r.normalize(); const u = tmpC.crossVectors(r, f).normalize();
    tmpM.makeBasis(r, u, f.clone().negate()); camera.quaternion.setFromRotationMatrix(tmpM);
    if (projection === 'ortho') { const a = camera.aspect || 1; ortho.left = -c.half * a; ortho.right = c.half * a; ortho.top = c.half; ortho.bottom = -c.half; ortho.updateProjectionMatrix(); }
  }
  const setFromPosTarget = (g, pos, target) => { g.target.copy(target); tmpA.subVectors(pos, target); g.dist = Math.max(0.5, tmpA.length()); tmpA.normalize(); g.phi = Math.acos(Math.min(1, Math.max(-1, tmpA.z))); g.theta = Math.atan2(tmpA.y, tmpA.x); };
  const goalPos = () => dirOf(goal.theta, goal.phi, new THREE.Vector3()).multiplyScalar(goal.dist).add(goal.target);
  function orbit(dx, dy, pivot) {
    const pos = goalPos(), t = goal.target.clone(), pv = pivot || t;
    const qz = new THREE.Quaternion().setFromAxisAngle(Z, -dx * 0.006);
    pos.sub(pv).applyQuaternion(qz).add(pv); t.sub(pv).applyQuaternion(qz).add(pv);
    const f = t.clone().sub(pos).normalize(), right = new THREE.Vector3().crossVectors(f, Z);
    if (right.lengthSq() > 1e-6) {
      right.normalize();
      const phiNow = Math.acos(Math.min(1, Math.max(-1, -f.z))), ang = -dy * 0.006, phiNew = phiNow + ang;
      if (phiNew > 0.03 && phiNew < Math.PI - 0.03) { const q = new THREE.Quaternion().setFromAxisAngle(right, ang); pos.sub(pv).applyQuaternion(q).add(pv); t.sub(pv).applyQuaternion(q).add(pv); }
    }
    setFromPosTarget(goal, pos, t); goal.phi = Math.min(Math.PI - 0.03, Math.max(0.03, goal.phi));
    syncCur();
  }
  const syncCur = () => { cur.theta = goal.theta; cur.phi = goal.phi; cur.dist = goal.dist; cur.half = goal.half; cur.target.copy(goal.target); };
  function wrapNear(a, ref) { while (a - ref > Math.PI) a -= 2 * Math.PI; while (ref - a > Math.PI) a += 2 * Math.PI; return a; }
  function pan(dx, dy, h) {
    const wpp = projection === 'persp' ? 2 * goal.dist * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2)) / h : 2 * goal.half / h;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    goal.target.addScaledVector(right, -dx * wpp).addScaledVector(up, dy * wpp); syncCur();
  }
  function dolly(k, hit) {
    const pos = goalPos(), t = goal.target.clone(), p = hit || t;
    if (projection === 'persp') { const nd = goal.dist * k; if (nd < 0.4 || nd > 900) return; pos.sub(p).multiplyScalar(k).add(p); t.sub(p).multiplyScalar(k).add(p); setFromPosTarget(goal, pos, t); }
    else { const nh = goal.half * k; if (nh < 0.15 || nh > 400) return; goal.half = nh; t.sub(p).multiplyScalar(k).add(p); goal.target.copy(t); }
    syncCur();
  }
  function fitBox(b) {
    const c = b.getCenter(new THREE.Vector3()), r = Math.max(0.5, b.getSize(new THREE.Vector3()).length() / 2);
    goal.target.copy(c); goal.dist = Math.max(1, r / Math.sin(THREE.MathUtils.degToRad(persp.fov / 2)) * 1.08);
    goal.half = Math.max(0.3, r * 1.08 / Math.min(1, camera.aspect || 1));
  }
  let flyUntil = 0;
  const fly = (ms) => { if (!reduceMotion) flyUntil = performance.now() + (ms || 620); };
  function setView(name) {
    const views = { iso: [-Math.PI / 4, 1.05], top: [-Math.PI / 2, 0.0001], bottom: [-Math.PI / 2, Math.PI - 0.0001], north: [Math.PI / 2, Math.PI / 2], south: [-Math.PI / 2, Math.PI / 2], east: [0, Math.PI / 2], west: [Math.PI, Math.PI / 2] };
    const v = views[name]; if (!v) return;
    goal.theta = v[0]; goal.phi = v[1]; cur.theta = wrapNear(cur.theta, goal.theta); fly();
    fitBox(bbox);
    if (name !== 'iso' && projection !== 'ortho') setProjection('ortho', true);
    if (name === 'iso' && projection !== 'persp') setProjection('persp', true);
  }
  function viewDir(d) {
    const dd = d.clone().normalize(); goal.phi = Math.acos(Math.min(1, Math.max(-1, dd.z)));
    if (Math.abs(dd.x) < 1e-6 && Math.abs(dd.y) < 1e-6) goal.theta = -Math.PI / 2; else goal.theta = Math.atan2(dd.y, dd.x);
    goal.phi = Math.min(Math.PI - 0.0001, Math.max(0.0001, goal.phi)); cur.theta = wrapNear(cur.theta, goal.theta);
  }
  function setProjection(p, quiet) {
    if (p === projection) return;
    const hh = goal.dist * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
    if (p === 'ortho') { goal.half = hh; cur.half = cur.dist * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2)); camera = ortho; }
    else { goal.dist = goal.half / Math.tan(THREE.MathUtils.degToRad(persp.fov / 2)); cur.dist = goal.dist; camera = persp; }
    projection = p; camera.aspect = persp.aspect; resize(); if (!quiet && on.projection) on.projection(p); if (quiet && on.projection) on.projection(p);
  }

  // picking & snapping
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  let W = 1, H = 1;
  const toNdc = (e) => { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); return { px: e.clientX - r.left, py: e.clientY - r.top }; };
  // shader clipping is invisible to raycasts: drop hits on the cut-away side
  const kept = (p) => p.dot(clipN.value) + clipC.value >= 0;
  const pick = () => { ray.setFromCamera(ndc, camera); const h = ray.intersectObjects(pickList, false).find((x) => kept(x.point)); return h || null; };
  const toPx = (p, out) => { v3.copy(p).project(camera); out.x = (v3.x + 1) / 2 * W; out.y = (1 - v3.y) / 2 * H; return out; };
  const s2a = new THREE.Vector2(), s2b = new THREE.Vector2();
  let snapOn = true;
  function snap(hit, px, py, from) {
    const rec = byMesh.get(hit.object); let best = { type: 'face', p: hit.point.clone(), d: 1e9 };
    if (!snapOn) return best;
    for (const v of rec.verts) { toPx(v, s2a); const d = Math.hypot(s2a.x - px, s2a.y - py); if (d < 16 && d < best.d) best = { type: 'corner', p: v.clone(), d }; }
    if (best.type === 'face') for (const [a, b] of rec.segs) {
      toPx(a, s2a); toPx(b, s2b); const ex = s2b.x - s2a.x, ey = s2b.y - s2a.y, L2 = ex * ex + ey * ey; if (L2 < 1) continue;
      let t = ((px - s2a.x) * ex + (py - s2a.y) * ey) / L2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(s2a.x + ex * t - px, s2a.y + ey * t - py);
      if (d < 11 && d < best.d) best = { type: 'edge', p: a.clone().lerp(b, t), d };
    }
    if (from) {
      const d = best.p.clone().sub(from), ax = ['x', 'y', 'z'].reduce((m, k) => (Math.abs(d[k]) > Math.abs(d[m]) ? k : m), 'x');
      const q = from.clone(); q[ax] += d[ax]; toPx(q, s2a);
      if (Math.hypot(s2a.x - px, s2a.y - py) < 10 && best.type !== 'corner') best = { type: 'axis ' + ax.toUpperCase(), p: q, d: 0 };
      else if (best.type === 'face' && hit.face) {
        const n = hit.face.normal.clone(), proj = from.clone().sub(n.clone().multiplyScalar(from.clone().sub(hit.point).dot(n)));
        toPx(proj, s2a); if (Math.hypot(s2a.x - px, s2a.y - py) < 10) best = { type: 'perpendicular', p: proj, d: 0 };
      }
    }
    return best;
  }

  // measurement + spot visuals
  const measGroup = new THREE.Group(); scene.add(measGroup);
  const laserMat = new THREE.LineBasicMaterial({ color: T.accent, transparent: true, opacity: 0.95 });
  const laserPrevMat = new THREE.LineBasicMaterial({ color: T.accent, transparent: true, opacity: 0.5 });
  // live laser preview: 3 segments (X, Y, Z), degenerate when an axis has no reading
  const laser = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 6 }, () => new THREE.Vector3())), laserPrevMat); laser.visible = false; laser.renderOrder = 5; laser.frustumCulled = false; scene.add(laser);
  const AXES = [['X', new THREE.Vector3(1, 0, 0)], ['Y', new THREE.Vector3(0, 1, 0)], ['Z', new THREE.Vector3(0, 0, 1)]];
  const lRay = new THREE.Raycaster(); lRay.far = 1000;
  // Laser meter: from a surface point fire ±X, ±Y, ±Z to the nearest visible faces. A ray pointing into the surface
  // it sits on is not fired; a direction with no hit ends at the point itself.
  function laserFrom(p, n, self) {
    const out = []; const origin = p.clone().addScaledVector(n || Z, 0.003);
    for (const [axis, ax] of AXES) {
      const ends = [null, null];
      [1, -1].forEach((sgn, i) => {
        const d = ax.clone().multiplyScalar(sgn); if (n && d.dot(n) < -0.5) return;
        lRay.set(origin, d);
        const h = lRay.intersectObjects(pickList, false).find((x) => x.distance > 0.01 && !(x.object === self && x.distance < 0.05) && kept(x.point));
        if (h) ends[i] = h.point.clone();
      });
      if (!ends[0] && !ends[1]) continue;
      const a = ends[1] || p.clone(), b = ends[0] || p.clone();
      out.push({ axis, a, b, len: a.distanceTo(b) });
    }
    return out;
  }
  function fillLaser(rays, p) { const pa = laser.geometry.attributes.position; AXES.forEach(([axis], i) => { const r = rays.find((x) => x.axis === axis); const a = r ? r.a : p, b = r ? r.b : p; pa.setXYZ(i * 2, a.x, a.y, a.z); pa.setXYZ(i * 2 + 1, b.x, b.y, b.z); }); pa.needsUpdate = true; laser.visible = rays.length > 0; }
  const snapEl = document.createElement('div'); Object.assign(snapEl.style, { position: 'absolute', left: 0, top: 0, pointerEvents: 'none', display: 'none' });
  snapEl.innerHTML = '<div data-m style="width:10px;height:10px;border:2px solid var(--accent);border-radius:2px;transform:translate(-50%,-50%);box-shadow:0 0 0 2px var(--card)"></div><div data-t style="position:absolute;left:12px;top:8px;font:400 11px/1 \'IBM Plex Mono\',monospace;color:var(--accent-ink);background:var(--card);border:1px solid var(--border);border-radius:5px;padding:4px 6px;white-space:nowrap"></div>';
  overlay.appendChild(snapEl);
  const liveLabel = mkLabel(new THREE.Vector3(), '', { ...labelBase(), color: 'var(--ink)', borderColor: 'var(--accent)' }, 0, -22); liveLabel.on = false;
  const measures = [], spots = [];
  const dotStyle = () => ({ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--card)' });
  const originStyle = () => ({ width: '9px', height: '9px', borderRadius: '2px', background: 'var(--card)', border: '2px solid var(--accent)' });
  const rayHtml = (r) => `<span style="color:var(--faint)">${r.axis}</span>&nbsp;<b style="font-weight:500;color:var(--ink)">${fmtMM(r.len)}</b>`;
  let mid = 0;
  const measureList = () => measures.map((x) => ({ id: x.id, p: x.p.toArray(), ...Object.fromEntries(x.rays.map((r) => [r.axis.toLowerCase(), r.len])) }));
  function addLaser(p, n, self) {
    const rays = laserFrom(p, n, self); if (!rays.length) return;
    const m = { id: ++mid, p: p.clone(), rays, lines: [], labels: [mkLabel(p, '', originStyle())] };
    for (const r of rays) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([r.a, r.b]), laserMat); line.renderOrder = 5; measGroup.add(line); m.lines.push(line);
      m.labels.push(mkLabel(r.a.clone().lerp(r.b, 0.5), rayHtml(r), { ...labelBase(), borderColor: 'var(--accent)' }, r.axis === 'Z' ? 46 : 0, r.axis === 'Z' ? 0 : -16), mkLabel(r.a, '', dotStyle()), mkLabel(r.b, '', dotStyle()));
    }
    measures.push(m); on.measure && on.measure(measureList());
  }
  function clearMeasures() { for (const m of measures) { m.lines.forEach((l) => { measGroup.remove(l); l.geometry.dispose(); }); m.labels.forEach((l) => l.remove()); } measures.length = 0; laser.visible = false; liveLabel.on = false; on.measure && on.measure([]); }
  let coords = { E: 28500, N: 30200, Z: 102.5, angle: 12.5 };
  const toMap = (p) => { const a = THREE.MathUtils.degToRad(coords.angle), c = Math.cos(a), s = Math.sin(a); return { E: coords.E + p.x * c - p.y * s, N: coords.N + p.x * s + p.y * c, Z: coords.Z + p.z }; };
  const f3 = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).replace(/,/g, '\u2009');
  const spotHtml = (p) => { const m = toMap(p); return `<div style="display:grid;grid-template-columns:auto auto;gap:2px 10px;text-align:right"><span style="color:var(--faint)">E</span><span style="color:var(--ink)">${f3(m.E)}</span><span style="color:var(--faint)">N</span><span style="color:var(--ink)">${f3(m.N)}</span><span style="color:var(--faint)">Z</span><span style="color:var(--ink)">${f3(m.Z)}</span><span style="color:var(--faint);border-top:1px solid var(--border);padding-top:3px;margin-top:1px">xyz</span><span style="border-top:1px solid var(--border);padding-top:3px;margin-top:1px">${Math.round(p.x * 1000)}, ${Math.round(p.y * 1000)}, ${Math.round(p.z * 1000)}</span></div>`; };
  const spotList = () => spots.map((x) => ({ id: x.id, p: x.p.toArray(), ...toMap(x.p), x: x.p.x, y: x.p.y, z: x.p.z }));
  function addSpot(p) {
    const s = { id: ++mid, p: p.clone(), labels: [mkLabel(p, spotHtml(p), { ...labelBase(), lineHeight: '1.3', padding: '6px 8px' }, 70, -34), mkLabel(p, '', dotStyle())] };
    spots.push(s); on.spot && on.spot(spotList());
  }
  const dropMeasure = (id) => {
    const i = measures.findIndex((m) => m.id === id); if (i < 0) return;
    const m = measures[i]; m.lines.forEach((l) => { measGroup.remove(l); l.geometry.dispose(); }); m.labels.forEach((l) => l.remove());
    measures.splice(i, 1); on.measure && on.measure(measureList());
  };
  const dropSpot = (id) => {
    const i = spots.findIndex((s) => s.id === id); if (i < 0) return;
    spots[i].labels.forEach((l) => l.remove()); spots.splice(i, 1); on.spot && on.spot(spotList());
  };
  const focusPoint = (arr) => { const p = new THREE.Vector3().fromArray(arr); fitBox(new THREE.Box3().setFromCenterAndSize(p, new THREE.Vector3(6, 6, 6))); fly(); };
  function clearSpots() { spots.forEach((s) => s.labels.forEach((l) => l.remove())); spots.length = 0; on.spot && on.spot([]); }
  function setCoords(c) { coords = { ...coords, ...c }; spots.forEach((s) => (s.labels[0].el.innerHTML = spotHtml(s.p))); updateCompass(); on.spot && on.spot(spotList()); }

  // ---- selection dimensions: bbox extents of the selected element(s), dimensioned in mm
  const dimGroup = new THREE.Group(); scene.add(dimGroup);
  const dimMat = new THREE.LineBasicMaterial({ color: T.accent, transparent: true, opacity: 0.95 });
  const dimBoxMat = new THREE.LineBasicMaterial({ color: T.accent, transparent: true, opacity: 0.35 });
  let dimLabels = [], dimOn = false, dimIds = [], dimAvoid = [];
  const mmTxt = (v) => Math.round(v * 1000).toLocaleString('en-US').replace(/,/g, '\u2009') + '\u2009mm';
  const clearDims = () => {
    while (dimGroup.children.length) { const c = dimGroup.children.pop(); if (c.geometry) c.geometry.dispose(); }
    dimLabels.forEach((l) => l.remove()); dimLabels = [];
  };
  const drawDims = () => {
    clearDims();
    if (!dimOn || !dimIds.length) return;
    const b = new THREE.Box3();
    dimIds.forEach((id) => { const r = recs.get(id); if (r && r.visible) b.union(r.bbox); });
    if (b.isEmpty()) return;
    const mn = b.min, mx = b.max, size = b.getSize(new THREE.Vector3());
    const box = new THREE.Box3Helper(b, new THREE.Color(T.accent)); box.material = dimBoxMat; dimGroup.add(box);
    const off = Math.max(0.12, Math.max(size.x, size.y, size.z) * 0.07), t = off * 0.3;
    // Labels are placed in SCREEN space: each run keeps its own face (so thin elements can't stack
    // labels), then the anchor slides along the run and the push direction is tried until the label
    // rect clears the measured obstructions (properties card, view cube). If every candidate is
    // covered, the label is translated out to the left of the blocking rect.
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const LW = 44, LH = 13; // half label box
    const at = (r, c) => { toPx(r.a.clone().lerp(r.b, c.t), s2a); return { x: s2a.x + c.dx, y: s2a.y + c.dy }; };
    // obstacles grow as labels are placed, so a later run never lands on an earlier label
    const taken = (dimAvoid || []).slice();
    const blocker = (q) => taken.find((r) => q.x + LW > r.x && q.x - LW < r.x + r.w && q.y + LH > r.y && q.y - LH < r.y + r.h);
    const place = (r) => {
      const cands = [];
      for (const t of [0.5, 0.72, 0.28, 0.9, 0.1]) for (const d of r.dirs) cands.push({ t, dx: d[0], dy: d[1] });
      for (const k of [0, 1, -1, 2, -2, 3, -3]) for (const c of cands) {
        const cand = { t: c.t, dx: c.dx, dy: c.dy + k * 2 * LH };
        if (!blocker(at(r, cand))) return cand;
      }
      return cands[0];
    };
    const runs = [
      { a: V(mn.x, mn.y - off, mn.z), b: V(mx.x, mn.y - off, mn.z), v: size.x, tick: V(0, t, 0), dirs: [[0, 15], [0, -16]] },
      { a: V(mx.x + off, mn.y, mn.z), b: V(mx.x + off, mx.y, mn.z), v: size.y, tick: V(t, 0, 0), dirs: [[42, 0], [-42, 0], [0, -20]] },
      { a: V(mn.x - off, mn.y - off, mn.z), b: V(mn.x - off, mn.y - off, mx.z), v: size.z, tick: V(t, 0, 0), dirs: [[-42, 0], [42, 0], [0, -20]] },
    ];
    const pts = [];
    for (const r of runs) {
      if (r.v < 1e-4) continue;
      pts.push(r.a, r.b);
      pts.push(r.a.clone().sub(r.tick), r.a.clone().add(r.tick), r.b.clone().sub(r.tick), r.b.clone().add(r.tick));
      const c = place(r), q = at(r, c);
      taken.push({ x: q.x - LW, y: q.y - LH, w: LW * 2, h: LH * 2 });
      dimLabels.push(mkLabel(r.a.clone().lerp(r.b, c.t), mmTxt(r.v), { ...labelBase(), color: 'var(--ink)', borderColor: 'var(--accent)', fontWeight: '500' }, c.dx, c.dy));
    }
    if (pts.length) dimGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), dimMat));
  };

  // interaction state
  let tool = 'select', selected = new Set(), hovered = null, highlight = null;
  const applyMat = (rec) => {
    if (rec.fading) return;
    const sel = selected.has(rec.el.id), hov = rec.el.id === hovered, inert = !!pickOk && !pickOk(rec.el);
    rec.meshes.forEach((m, i) => {
      const hlOwn = highlight && rec.hl && elColors[rec.el.id] ? elColors[rec.el.id] : null;
      m.material = inert ? inertMat : sel ? selMat : hov ? baseFor(rec, i, true)
        : hlOwn ? ovFor(hlOwn, rec.keys[i], false)
        : highlight ? (rec.hl ? hlMat : ghostMat) : baseFor(rec, i, false);
      m.castShadow = shadowsOn && !m.material.transparent;
    });
    rec.edges.forEach((e) => { e.material = sel ? selEdgeMat : edgeMat; e.visible = rec.visible && !inert && !(highlight && !rec.hl); });
  };
  // selection is a set; accepts an id, an array of ids, or null
  function setSelected(ids) { const next = new Set(ids == null ? [] : Array.isArray(ids) ? ids : [ids]); const touched = [...selected, ...next]; selected = next; touched.forEach((id) => { if (recs.get(id)) applyMat(recs.get(id)); }); }
  function setHovered(id) { if (id === hovered) return; const prev = hovered; hovered = id; if (prev != null && recs.get(prev)) applyMat(recs.get(prev)); if (id != null && recs.get(id)) applyMat(recs.get(id)); canvas.style.cursor = id != null && tool === 'select' ? 'pointer' : tool === 'select' ? '' : 'crosshair'; }
  function setHighlight(ids) { highlight = ids ? new Set(ids) : null; recs.forEach((r) => { r.hl = !!(highlight && highlight.has(r.el.id)); applyMat(r); }); }
  let fadeOut = [], fadeIn = [], fadeT = 0, fadingBatch = false;
  function finishFades() {
    fadingBatch = false; fadeT = 0;
    for (const r of fadeOut) { r.fading = false; r.meshes.forEach((m) => (m.visible = false)); applyMat(r); }
    for (const r of fadeIn) { r.fading = false; applyMat(r); }
    fadeOut = []; fadeIn = [];
    rebuildPick(); drawDims();
  }
  function setVisibility(fn) {
    if (fadingBatch) finishFades();
    const want = new Map(); recs.forEach((r) => want.set(r.el.id, !!fn(r.el)));
    if (reduceMotion) {
      recs.forEach((r) => { r.visible = want.get(r.el.id); r.meshes.forEach((m) => (m.visible = r.visible)); applyMat(r); });
    } else {
      recs.forEach((r) => {
        const w = want.get(r.el.id);
        if (w === r.visible) { applyMat(r); return; }
        r.visible = w; r.fading = true;
        r.meshes.forEach((m) => { m.visible = true; m.material = w ? fadeInMat : fadeOutMat; m.castShadow = false; });
        r.edges.forEach((e) => (e.visible = false));
        (w ? fadeIn : fadeOut).push(r);
      });
      fadingBatch = fadeOut.length > 0 || fadeIn.length > 0;
    }
    if (!fadingBatch) { rebuildPick(); drawDims(); }
    const keep = [...selected].filter((id) => recs.get(id) && recs.get(id).visible);
    if (keep.length !== selected.size) { setSelected(keep); on.select && on.select(keep, 'replace'); }
  }
  function setTool(t) { tool = t; laser.visible = false; liveLabel.on = false; snapEl.style.display = 'none'; canvas.style.cursor = t === 'select' ? '' : 'crosshair'; on.hint && on.hint(hintFor()); }
  const hintFor = () => tool === 'measure' ? (snapOn ? 'Click a surface — the laser reads X, Y and Z to the nearest faces. Snaps to corners and edges.' : 'Click a surface — the laser reads X, Y and Z. Snapping off: reads the exact point clicked.') : tool === 'spot' ? (snapOn ? 'Click to pin coordinates — snaps to the nearest corner or edge.' : 'Click to pin the exact coordinates of that point.') : '';

  canvas.style.touchAction = 'none';
  // touch: one finger orbits, two fingers pinch-zoom and pan; mouse behaviour is untouched
  const touches = new Map();
  let pinch = 0, pinchMid = null;
  const twoFinger = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { const t = twoFinger(); pinch = t.d; pinchMid = { x: t.x, y: t.y }; down.on = false; }
  }, true);
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size !== 2) return;
    e.stopPropagation();
    const t = twoFinger();
    if (pinch > 0 && Math.abs(t.d - pinch) > 0.5) dolly(Math.max(0.5, Math.min(2, pinch / t.d)), null);
    if (pinchMid) pan(t.x - pinchMid.x, t.y - pinchMid.y, H);
    pinch = t.d; pinchMid = { x: t.x, y: t.y };
  }, true);
  const dropTouch = (e) => { if (e.pointerType !== 'touch') return; touches.delete(e.pointerId); if (touches.size < 2) { pinch = 0; pinchMid = null; } };
  canvas.addEventListener('pointerup', dropTouch, true);
  canvas.addEventListener('pointercancel', dropTouch, true);

  const down = { on: false, x: 0, y: 0, btn: 0, moved: false, pivot: null };
  let needHover = false, lastEvt = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button > 2) return; canvas.setPointerCapture(e.pointerId);
    down.on = true; down.x = e.clientX; down.y = e.clientY; down.btn = e.button; down.moved = false;
    toNdc(e); const h = pick(); down.pivot = h ? h.point.clone() : null;
    if (!h) { ray.setFromCamera(ndc, camera); const g = new THREE.Plane(Z, 0), p = new THREE.Vector3(); if (ray.ray.intersectPlane(g, p) && p.distanceTo(goal.target) < 400) down.pivot = p; }
    on.context && on.context(null);
  });
  canvas.addEventListener('pointermove', (e) => {
    lastEvt = e;
    if (down.on) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 3) down.moved = true;
      if (!down.moved) return;
      if (touches.size > 1) return;
      if ((down.btn === 0 && e.shiftKey) || e.pointerType === 'touch') orbit(dx, dy, down.pivot); else pan(dx, dy, H);
      down.x = e.clientX; down.y = e.clientY; return;
    }
    needHover = true;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down.on) return; down.on = false; canvas.releasePointerCapture(e.pointerId);
    if (down.moved) return;
    const { px, py } = toNdc(e); const h = pick(); const id = h ? byMesh.get(h.object).el.id : null;
    if (e.button === 2) { on.context && on.context({ x: e.clientX, y: e.clientY, id }); return; }
    if (e.button !== 0) return;
    if (tool === 'select') { on.select && on.select(id, e.ctrlKey || e.metaKey ? 'toggle' : 'replace'); return; }
    if (!h) return;
    const s = snap(h, px, py, null);
    if (tool === 'spot') { addSpot(s.p); return; }
    if (tool === 'measure') addLaser(s.p, h.face ? h.face.normal.clone() : null, h.object);
  });
  canvas.addEventListener('pointerleave', () => { setHovered(null); snapEl.style.display = 'none'; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); toNdc(e); const h = pick(); let p = h ? h.point : null; if (!p) { ray.setFromCamera(ndc, camera); const q = new THREE.Vector3(); if (ray.ray.intersectPlane(new THREE.Plane(Z, 0), q) && q.distanceTo(goal.target) < 300) p = q; } dolly(Math.exp(e.deltaY * 0.0011), p); }, { passive: false });
  // double-click frames what you clicked (and selects it); on empty space it frames the whole model
  canvas.addEventListener('dblclick', (e) => {
    toNdc(e); const h = pick();
    if (!h) { fitBox(bbox); fly(); return; }
    const rec = byMesh.get(h.object);
    fitBox(rec.bbox.clone().expandByScalar(0.6)); fly();
    if (tool === 'select') on.select && on.select(rec.el.id, 'replace');
  });

  function doHover() {
    if (!lastEvt) return; const { px, py } = toNdc(lastEvt); const h = pick();
    const id = h ? byMesh.get(h.object).el.id : null; setHovered(tool === 'select' ? id : null); on.hover && on.hover(id);
    if (tool === 'measure' || tool === 'spot') {
      if (h) {
        const s = snap(h, px, py, null); snapEl.style.display = '';
        // the marker sits on the snapped point, not the cursor, so a corner/edge catch is visible
        toPx(s.p, s2a); snapEl.style.transform = `translate(${s2a.x.toFixed(1)}px,${s2a.y.toFixed(1)}px)`;
        const mk = snapEl.firstChild; mk.style.borderRadius = s.type === 'corner' ? '2px' : '50%'; mk.style.width = mk.style.height = s.type === 'face' ? '7px' : '11px';
        mk.style.borderWidth = s.type === 'face' ? '2px' : '2.5px';
        snapEl.lastChild.textContent = snapOn ? s.type : 'free';
        if (tool === 'measure') {
          const rays = laserFrom(s.p, h.face ? h.face.normal : null, h.object); fillLaser(rays, s.p);
          liveLabel.on = rays.length > 0; liveLabel.pos.copy(s.p);
          liveLabel.el.innerHTML = rays.map((r) => `<span style="color:var(--faint)">${r.axis}</span> <b style="font-weight:500">${Math.round(r.len * 1000).toLocaleString('en-US').replace(/,/g, '\u2009')}</b>`).join('<span style="color:var(--border-strong)"> · </span>') + '<span style="color:var(--faint)"> mm</span>';
        }
      } else { snapEl.style.display = 'none'; laser.visible = false; liveLabel.on = false; }
    }
  }

  // view cube (own tiny renderer) — 26 hit zones: 6 faces, 12 edges, 8 corners
  const CUBE_PX = 148;
  const cubeR = new THREE.WebGPURenderer({ canvas: cubeCanvas, antialias: true, alpha: true, forceWebGL }); await cubeR.init();
  cubeR.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); cubeR.setSize(CUBE_PX, CUBE_PX, false); cubeR.setClearColor(0x000000, 0);
  const cubeScene = new THREE.Scene(), cubeCam = new THREE.PerspectiveCamera(30, 1, 0.1, 20); cubeCam.up.copy(Z);
  const cubeGroup = new THREE.Group(); cubeScene.add(cubeGroup);
  const EW = 0.2, FW = 1 - 2 * EW, zones = [];
  for (let sx = -1; sx <= 1; sx++) for (let sy = -1; sy <= 1; sy++) for (let sz = -1; sz <= 1; sz++) {
    if (!sx && !sy && !sz) continue;
    const size = [sx, sy, sz].map((s) => (s ? EW : FW)), off = (1 - EW) / 2;
    const zm = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.card) }));
    zm.position.set(sx * off, sy * off, sz * off); zm.userData.dir = new THREE.Vector3(sx, sy, sz); cubeGroup.add(zm); zones.push(zm);
  }
  const cubeEdgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(T.border) });
  cubeGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), cubeEdgeMat));
  const zoneLineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(T.border), transparent: true, opacity: 0.4 });
  const seams = [], hh = 0.5, kk = 0.5 - EW;
  for (const a of [-kk, kk]) for (const s of [-hh, hh]) {
    seams.push(new THREE.Vector3(a, -hh, s), new THREE.Vector3(a, hh, s), new THREE.Vector3(-hh, a, s), new THREE.Vector3(hh, a, s));
    seams.push(new THREE.Vector3(a, s, -hh), new THREE.Vector3(a, s, hh), new THREE.Vector3(-hh, s, a), new THREE.Vector3(hh, s, a));
    seams.push(new THREE.Vector3(s, a, -hh), new THREE.Vector3(s, a, hh), new THREE.Vector3(s, -hh, a), new THREE.Vector3(s, hh, a));
  }
  cubeGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seams), zoneLineMat));
  const faceTex = (txt, hover) => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    x.fillStyle = hover ? T.accentCss : T.muted; x.font = `600 ${txt.length > 1 ? 26 : 50}px "IBM Plex Sans", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, 64, 66);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const faceDefs = [['E', [1, 0, 0]], ['W', [-1, 0, 0]], ['N', [0, 1, 0]], ['S', [0, -1, 0]], ['TOP', [0, 0, 1]], ['BOTTOM', [0, 0, -1]]];
  let faceLabels = [];
  const buildFaceLabels = () => {
    faceLabels.forEach((f) => { cubeGroup.remove(f.mesh); f.tex.forEach((t) => t.dispose()); f.mesh.material.dispose(); });
    faceLabels = faceDefs.map(([txt, n]) => {
      const tex = [faceTex(txt, false), faceTex(txt, true)];
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FW, FW), new THREE.MeshBasicMaterial({ map: tex[0], transparent: true, depthWrite: false }));
      if (n[2] === 0) mesh.up.set(0, 0, 1);
      mesh.position.set(n[0] * 0.506, n[1] * 0.506, n[2] * 0.506); mesh.lookAt(n[0] * 2, n[1] * 2, n[2] * 2);
      cubeGroup.add(mesh); return { mesh, tex, dir: new THREE.Vector3(n[0], n[1], n[2]) };
    });
  };
  buildFaceLabels();
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(T.border), side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.935, 64), ringMat); ring.position.z = -0.62; cubeScene.add(ring);
  // north arrow on the compass ring: a flat kite pointing along true north, labelled N just outside the ring
  const tnTex = () => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d'); x.fillStyle = T.accentCss; x.font = '600 34px "IBM Plex Sans", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('N', 32, 34); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const tnSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tnTex(), depthTest: false })); tnSprite.scale.set(0.26, 0.26, 1); cubeScene.add(tnSprite);
  const arrowShape = new THREE.Shape(); arrowShape.moveTo(0, 0.2); arrowShape.lineTo(0.085, -0.06); arrowShape.lineTo(0, -0.02); arrowShape.lineTo(-0.085, -0.06); arrowShape.closePath();
  const tnTick = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: T.accent, side: THREE.DoubleSide })); cubeScene.add(tnTick);
  function updateCompass() { const a = THREE.MathUtils.degToRad(coords.angle), nx = Math.sin(a), ny = Math.cos(a); tnTick.position.set(nx * 0.9, ny * 0.9, -0.61); tnTick.rotation.z = -a; tnSprite.position.set(nx * 1.22, ny * 1.22, -0.62); }
  updateCompass();
  const cubeRay = new THREE.Raycaster(); let cubeHover = null;
  const cubeNdc = (e) => { const r = cubeCanvas.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
  const hoverCol = () => new THREE.Color(T.card).lerp(new THREE.Color(T.accent), 0.5);
  const setCubeHover = (z) => {
    if (z === cubeHover) return;
    if (cubeHover) cubeHover.material.color.set(T.card);
    cubeHover = z; if (z) z.material.color.copy(hoverCol());
    faceLabels.forEach((f) => { const onF = !!z && z.userData.dir.equals(f.dir); if (f.mesh.material.map !== f.tex[onF ? 1 : 0]) { f.mesh.material.map = f.tex[onF ? 1 : 0]; f.mesh.material.needsUpdate = true; } });
  };
  const pickZone = (e) => { cubeRay.setFromCamera(cubeNdc(e), cubeCam); const h = cubeRay.intersectObjects(zones, false)[0]; return h ? h.object : null; };
  cubeCanvas.addEventListener('pointermove', (e) => { const z = pickZone(e); setCubeHover(z); cubeCanvas.style.cursor = z ? 'pointer' : ''; });
  cubeCanvas.addEventListener('pointerleave', () => setCubeHover(null));
  cubeCanvas.addEventListener('click', (e) => { const z = pickZone(e); if (!z) return; viewDir(z.userData.dir); fitBox(bbox); on.cubeView && on.cubeView(); });

  // theme
  function setTheme(t) {
    theme = t; T = THEMES[t];
    scene.background.set(T.bg); groundMat.color.set(T.ground); buildGridHelper();
    edgeMat.color.set(T.edge); gridLineMat.color.set(T.gridline); levelLineMat.color.set(T.level);
    [selMat, hlMat].forEach((m) => { m.color.set(T.accent); m.emissive.set(T.accent); }); if (hlColor) { hlMat.color.set(hlColor); hlMat.emissive.set(hlColor); } Object.values(hoverMats).forEach((m) => m.emissive.set(T.accent)); cutCol.value.set(T.cut); hoverEmis.value.set(T.accent).multiplyScalar(0.22);
    selEdgeMat.color.set(T.accent); laserMat.color.set(T.accent); laserPrevMat.color.set(T.accent); secMat.color.set(T.accent); sheetMat.color.set(T.accent);
    dimMat.color.set(T.accent); dimBoxMat.color.set(T.accent);
    cubeEdgeMat.color.set(T.border); zoneLineMat.color.set(T.border); ringMat.color.set(T.border); tnTick.material.color.set(T.accent); tnSprite.material.map.dispose(); tnSprite.material.map = tnTex();
    zones.forEach((z) => z.material.color.set(T.card)); cubeHover = null; buildFaceLabels();
  }

  // resize + loop
  function resize() {
    const p = canvas.parentElement; const w = Math.max(1, p.clientWidth), h = Math.max(1, p.clientHeight);
    if (w !== W || h !== H) { W = w; H = h; renderer.setSize(w, h, false); }
    persp.aspect = w / h; ortho.aspect = w / h; persp.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas.parentElement); resize();
  // grid bubbles are DOM, so they have no depth test of their own: raycast each anchor and hide the
  // ones the building is in front of. Throttled — occlusion only changes when the camera moves.
  const occDir = new THREE.Vector3(), occOrigin = new THREE.Vector3();
  let occTick = 0;
  function updateOcclusion() {
    if (++occTick % 4) return;
    const span = bbox.getSize(tmpB).length() * 1.5 + 10;
    camera.getWorldDirection(occDir);
    const far0 = ray.far;
    for (const L of labels) {
      if (!L.occlude) continue;
      if (!L.on) { L.occluded = false; continue; }
      occOrigin.copy(L.pos).addScaledVector(occDir, -span);
      ray.set(occOrigin, occDir); ray.far = span - 0.25;
      L.occluded = ray.intersectObjects(pickList, false).length > 0;
    }
    ray.far = far0;
  }
  let last = performance.now(), frames = 0, fpsT = last, running = true;
  const lerp = (a, b, k) => a + (b - a) * k;
  function frame(now) {
    if (!running) return; requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    // deliberate jumps (view buttons, zoom-to, restore) ease slowly; direct manipulation stays snappy
    const k = 1 - Math.exp(-dt * (now < flyUntil ? 5 : 14));
    if (fadingBatch) { fadeT += dt / 0.22; if (fadeT >= 1) finishFades(); else { fadeOutMat.opacity = 0.3 * (1 - fadeT); fadeInMat.opacity = 0.02 + 0.28 * fadeT; } }
    cur.theta = lerp(cur.theta, goal.theta, k); cur.phi = lerp(cur.phi, goal.phi, k); cur.dist = lerp(cur.dist, goal.dist, k); cur.half = lerp(cur.half, goal.half, k); cur.target.lerp(goal.target, k);
    placeCamera(cur);
    if (needHover) { needHover = false; doHover(); }
    if (on.camera) on.camera(camera);
    renderer.render(scene, camera);
    updateGridView();
    updateOcclusion();
    updateLabels(W, H);
    dirOf(cur.theta, cur.phi, tmpA); cubeCam.position.copy(tmpA).multiplyScalar(4.7); cubeCam.quaternion.copy(camera.quaternion); cubeR.render(cubeScene, cubeCam);
    frames++; if (now - fpsT > 1000) { on.stats && on.stats({ fps: Math.round(frames * 1000 / (now - fpsT)), backend, calls: renderer.info.render.drawCalls }); frames = 0; fpsT = now; }
  }
  requestAnimationFrame(frame);
  fitBox(bbox); Object.assign(cur, { dist: goal.dist * 1.6, half: goal.half }); cur.target.copy(goal.target);

  return {
    backend, recs, bbox, snapshot: () => { renderer.render(scene, camera); return canvas.toDataURL('image/jpeg', 0.7); }, debug: () => ({ cam: camera.position.toArray().map((v) => +v.toFixed(2)), target: goal.target.toArray().map((v) => +v.toFixed(2)), dist: +goal.dist.toFixed(2), half: +goal.half.toFixed(2), proj: projection, plane: [...clipN.value.toArray(), clipC.value], section, visible: [...recs.values()].filter((r) => r.visible).length }),
    setTheme, setVisibility, setSelected, setHighlight, setTool, setSection, setCoords, clearMeasures, clearSpots,
    dropMeasure, dropSpot, focusPoint,
    setHighlightColor: (c) => { hlColor = c; hlMat.color.set(c); hlMat.emissive.set(c); },
    setDims: (ids, on, avoid) => { dimIds = ids || []; if (on != null) dimOn = !!on; if (avoid !== undefined) dimAvoid = avoid; drawDims(); },
    // non-pickable elements stay rendered but drop out of hit-testing (hover + click + context menu)
    setPickable: (fn) => { pickOk = fn || null; rebuildPick(); recs.forEach((r) => applyMat(r)); if (hovered != null && pickOk && recs.get(hovered) && !pickOk(recs.get(hovered).el)) setHovered(null); },
    setSnap: (b) => { snapOn = !!b; on.hint && on.hint(hintFor()); },
    setModelColors: (map, native) => { modelColors = map || {}; if (native != null) nativeMats = !!native; recs.forEach((r) => applyMat(r)); },
    // explicit per-element colours (colour-by-property schemes); outrank model overrides and native materials
    setElementColors: (map) => { elColors = map || {}; recs.forEach((r) => applyMat(r)); },
    setShadows: (b) => { shadowsOn = b; recs.forEach((r) => r.meshes.forEach((m) => (m.castShadow = b && !m.material.transparent))); },
    getCamera: () => ({ theta: goal.theta, phi: goal.phi, dist: goal.dist, half: goal.half, target: goal.target.toArray(), proj: projection }),
    setCamera: (c) => { if (c.proj && c.proj !== projection) setProjection(c.proj); goal.theta = c.theta; goal.phi = c.phi; goal.dist = c.dist; goal.half = c.half; goal.target.fromArray(c.target); cur.theta = wrapNear(cur.theta, goal.theta); fly(); },
    setView: (n) => setView(n), setProjection: (p) => setProjection(p), getProjection: () => projection,
    zoomExtents: () => { fitBox(bbox); fly(); }, zoomTo: (id) => { const ids = Array.isArray(id) ? id : [id]; const b = new THREE.Box3(); ids.forEach((i) => { const r = recs.get(i); if (r) b.union(r.bbox); }); if (!b.isEmpty()) { fitBox(b.expandByScalar(0.6)); fly(); } },
    setGrids: (b) => { gridGroup.visible = b; gridsOn = b; updateGridView(true); }, setLevels: (b) => { levelGroup.visible = b; levelLabels.forEach((L) => (L.on = b)); },
    cancel: () => { laser.visible = false; liveLabel.on = false; on.hint && on.hint(hintFor()); },
    dispose: () => { running = false; renderer.dispose(); cubeR.dispose(); },
  };
}
