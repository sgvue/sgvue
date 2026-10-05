// Ask SGVue — thinking-process animation. Panel recreated from img/ask.webp over the
// same screenshot (screenshot px = app px × 1.2). Tokens from site.css (dark theme).

const C = {
  ground: '#0F1516', panel: '#181F21', bubble: '#1F2827', line: '#282F31', footLine: '#2B3335',
  chipLine: '#262F30', inputLine: '#2C3535', borderStrong: '#354544',
  ink: '#E4ECEA', muted: '#94A7A4', faint: '#798C8A', title: '#A9B5B5', chipInk: '#A3B1B0', placeholder: '#8A9493',
  accent: '#35C4B6', accentInk: '#4FD3C4', selBg: '#12302D', sendLine: '#3FA399',
};
const SANS = '"IBM Plex Sans","Segoe UI",system-ui,sans-serif';
const MONO = '"IBM Plex Mono","Cascadia Mono",Consolas,monospace';

// The three motion curves. Everything below moves through p() with one of these.
const MOTION = { enter: Easing.easeOutQuart, glide: Easing.easeInOutCubic, pop: Easing.easeOutBack };
const p = (T, s, d, ease) => (T <= s ? 0 : T >= s + d ? 1 : ease((T - s) / d));
const lin = (T, s, d) => clamp((T - s) / d, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); t = clamp(t, 0, 1); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }

// ── data: 412 elements in 4 models (ARC 140 · STR 244 · SIT 20 · MEP 8 → 4 rows of 103 cols)
const MODEL_COLS = [35, 61, 5, 2];
const MW = 429, GAP_G = 4, PITCH_A = (MW - GAP_G * 3) / 103, SIZE_A = 3.2;
const PITCH_B = MW / 43, SIZE_B = 7;
const WALLS = (() => { const r = rng(11); const a = [...Array(140).keys()]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, 86).sort((x, y) => x - y); })();
const WALL_OF = new Map(WALLS.map((i, k) => [i, k]));
const FLAGGED = [6, 15, 23, 34, 41, 55, 63, 72, 81];
const FLAG_OF = new Map(FLAGGED.map((k, f) => [k, f]));
const FLAG_LEVEL = [0, 0, 0, 1, 1, 2, 2, 3, 3], FLAG_SLOT = [0, 1, 2, 0, 1, 0, 1, 0, 1];
const LEVELS = [['L1', 3], ['L2', 2], ['L3', 2], ['L4', 2]];
const CELLS = [...Array(412).keys()].map((i) => {
  const col = Math.floor(i / 4), row = i % 4;
  let g = 0, acc = 0; while (col >= acc + MODEL_COLS[g]) { acc += MODEL_COLS[g]; g++; }
  const c = { i, col, xA: col * PITCH_A + g * GAP_G + (PITCH_A - SIZE_A) / 2, yA: 1 + row * 5.2 };
  if (WALL_OF.has(i)) {
    const k = WALL_OF.get(i);
    c.k = k; c.xB = Math.floor(k / 2) * PITCH_B + (PITCH_B - SIZE_B) / 2; c.yB = 1.5 + (k % 2) * 10;
    if (FLAG_OF.has(k)) c.f = FLAG_OF.get(k);
  }
  return c;
});
const MX = 17, MY = 45, ROW_Y0 = 81, ROW_H = 26, H_ANSWER = ROW_Y0 + ROW_H * 4 + 10;
const beamAt = (CUES, xc) => CUES.Check + 0.3 + ((xc + 6) / (MW + 12)) * 1.7;

const QUESTION = 'Which walls have no fire rating?';
const TYPE_TIMES = (() => { const r = rng(5); const d = [...QUESTION].map(() => 0.6 + r()); const sum = d.reduce((a, b) => a + b, 0); let acc = 0; return d.map((v) => (acc += (v / sum) * 1.55)); })();
const ANSWER = [['9', 'b'], ['of', 'b'], ['86', 'b'], ['walls', 'b'], ['have'], ['no'], ['Fire'], ['Rating.'], ['All'], ['9'], ['are'], ['in'], ['SB_ARC_R25.', 'm']];


// ── Hex, the pixel mascot (16×16; same sprite as Ask SGVue Mascot.dc.html 1a)
const HPAL = { o: '#35C4B6', h: '#8AF0E4', b: '#1E2827', t: '#2B3B3A', s: '#354544', e: '#E4ECEA', k: '#0F1516' };
const HEX_ROWS = ['....oooo....','..oottttoo..','.otttttttto.','obttttttttbo','obbbttttbbbo','obbbbttbbbbo','obbbbbbbbbbo','obbbbbbbbbbo','obbbbbbbbbbo','.obbbbbbbbo.','..oobbbboo..','....oooo....'];
const HEX_PERIM = (() => { const pts = []; HEX_ROWS.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'o') pts.push([x, y]); })); return pts.sort((a, b) => Math.atan2(a[1] - 5.5, a[0] - 5.5) - Math.atan2(b[1] - 5.5, b[0] - 5.5)); })();
const PING = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1], HOP = [0, 1, 2, 1, 0, 0, 0, 0], BOB = [0, 0, 1, 1, 0, 0, 0, 0];
function hexGrid(s, f) {
  const g = Array.from({ length: 16 }, () => Array(16).fill('.'));
  const put = (x, y, c) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c; };
  const ox = 2, oy = 3 - (s === 'found' ? HOP[f % 8] : s === 'done' ? BOB[f % 8] : 0);
  (s === 'done' ? HEX_ROWS.map((r) => r.replace(/t/g, 'o')) : HEX_ROWS).forEach((r, y) => [...r].forEach((c, x) => { if (c !== '.') put(ox + x, oy + y, c); }));
  const P = (x, y, c) => put(ox + x, oy + y, c);
  const box = (x, y, w, h, c) => { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) P(x + i, y + j, c); };
  const eyes = (dx, dy, c) => { box(2 + dx, 6 + dy, 2, 2, c); box(8 + dx, 6 + dy, 2, 2, c); };
  if (s === 'idle') { if (f % 28 < 2) { box(2, 7, 2, 1, 'e'); box(8, 7, 2, 1, 'e'); } else eyes(0, 0, 'e'); }
  if (s === 'thinking') { eyes(f % 12 < 6 ? -1 : 1, -1, 'e'); for (let i = 0; i < 3; i++) { const [x, y] = HEX_PERIM[(f * 2 + i) % HEX_PERIM.length]; P(x, y, 'h'); } }
  if (s === 'reading') { box(2, 6, 8, 2, 'k'); const x = 2 + PING[f % 14]; box(x - 1, 6, 3, 2, 's'); box(x, 6, 1, 2, 'h'); }
  if (s === 'found') { eyes(0, 0, 'h'); if (f % 8 < 6) [0, 1, 2, 4].forEach((y) => put(14, y, 'e')); }
  if (s === 'done') [[2, 7], [3, 6], [4, 7], [7, 7], [8, 6], [9, 7]].forEach(([x, y]) => P(x, y, 'e'));
  return g;
}
function HexSprite({ state, f, px, style }) {
  const sh = [];
  hexGrid(state, f).forEach((row, y) => row.forEach((c, x) => { if (c !== '.') sh.push(`${(x + 1) * px}px ${(y + 1) * px}px 0 ${HPAL[c]}`); }));
  return (
    <span style={{ position: 'relative', display: 'block', width: 16 * px, height: 16 * px, flex: 'none', ...style }}>
      <span style={{ position: 'absolute', left: -px, top: -px, width: px, height: px, boxShadow: sh.join(',') }} />
    </span>
  );
}
// Hex's state is a pure function of T: thinking → reading → found (on each hit) → done.
function hexState(T, CUES) {
  if (T >= CUES.Answer + 0.3) return 'done';
  if (T >= CUES.Check) {
    const hit = FLAGGED.some((k) => { const tb = beamAt(CUES, CELLS[WALLS[k]].xB + SIZE_B / 2); return T >= tb && T < tb + 0.5; });
    return hit ? 'found' : 'reading';
  }
  if (T >= CUES.Read) return 'reading';
  return 'thinking';
}

function useDataUrl(src) {
  const [u, setU] = React.useState(src);
  React.useEffect(() => {
    let live = true;
    fetch(src).then((r) => r.blob()).then((b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); })).then((d) => live && setU(d)).catch(() => {});
    return () => { live = false; };
  }, [src]);
  return u;
}

// ── icons (sparkle / close / reply / send from the screenshot; mark from index.html)
const Sparkle = ({ size, color, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" style={style}>
    <path d="M11 3.5C11.6 8 13.5 9.9 18 10.5 13.5 11.1 11.6 13 11 17.5 10.4 13 8.5 11.1 4 10.5 8.5 9.9 10.4 8 11 3.5Z" />
    <path d="M18.5 16.2C18.7 17.6 19.4 18.3 20.8 18.5 19.4 18.7 18.7 19.4 18.5 20.8 18.3 19.4 17.6 18.7 16.2 18.5 17.6 18.3 18.3 17.6 18.5 16.2Z" />
  </svg>
);
const HEX = 'M12 2.6 20.2 7.3v9.4L12 21.4 3.8 16.7V7.3z';

function Mark({ T, CUES }) {
  const show = p(T, CUES.Think, 0.5, MOTION.pop);
  const turn = ((T - CUES.Think) * 0.85) % 1;
  const grow = p(T, CUES.Answer, 0.55, MOTION.glide);
  const len = lerp(26, 100, grow);
  const settle = p(T, CUES.Answer + 0.5, 0.45, MOTION.enter);
  const v = p(T, CUES.Answer + 0.35, 0.6, MOTION.glide);
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ flex: 'none', display: 'block', opacity: clamp(show, 0, 1), transform: `scale(${show})` }}>
      <path d={HEX} stroke={C.borderStrong} strokeWidth="1.7" strokeLinejoin="round" />
      <path d={HEX} pathLength="100" stroke={mix(C.accent, C.muted, settle)} strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={`${len} ${100.01 - len}`} strokeDashoffset={-turn * 100} />
      <path d="M12 3.4v8.2" pathLength="100" stroke={C.muted} strokeWidth="1.7" strokeLinecap="round" strokeDasharray="100 100" strokeDashoffset={100 * (1 - v)} />
      <path d="M3.8 7.3 12 21.4 20.2 7.3" pathLength="100" stroke={C.accent} strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="100 100" strokeDashoffset={100 * (1 - v)} />
    </svg>
  );
}

// A line of text that rolls in from below and out upward.
function Roll({ T, tin, tout, h, children, style }) {
  const a = p(T, tin, 0.42, MOTION.enter);
  const b = tout == null ? 0 : p(T, tout, 0.32, MOTION.enter);
  if (a <= 0 || b >= 1) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', transform: `translateY(${(1 - a) * h - b * h}px)`, opacity: a * (1 - b), ...style }}>
      {children}
    </div>
  );
}

function Header({ hexF }) {
  return (
    <React.Fragment>
      <div style={{ position: 'absolute', left: 15, top: 16, width: 26, height: 24, borderTop: `2.4px solid ${C.borderStrong}`, borderLeft: `2.4px solid ${C.borderStrong}`, borderTopLeftRadius: 9 }} />
      <HexSprite state="idle" f={hexF + 5} px={2} style={{ position: 'absolute', left: 16, top: 17.5 }} />
      <div style={{ position: 'absolute', left: 55, top: 27, font: `600 15.6px/18px ${SANS}`, letterSpacing: '.08em', color: C.title }}>ASK VEE</div>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8B9496" strokeWidth="2.2" strokeLinecap="round" style={{ position: 'absolute', left: 457, top: 29 }}><path d="M5 5l14 14M19 5 5 19" /></svg>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 71, height: 1.2, background: C.line }} />
    </React.Fragment>
  );
}

function Label({ top, children, style }) {
  return <div style={{ position: 'absolute', left: 24, top, height: 20, display: 'flex', alignItems: 'center', gap: 10, font: `400 15px/20px ${SANS}`, color: C.muted, ...style }}>{children}</div>;
}

function Reply({ T, CUES, full }) {
  const hThink = full ? 78 : 48;
  const bIn = p(T, CUES.Read, 0.45, MOTION.enter);
  const bGrow = p(T, CUES.Answer + 0.15, 0.7, MOTION.glide);
  const H = lerp(lerp(0, hThink, bIn), H_ANSWER, bGrow);
  const tickFade = 1 - p(T, CUES.Answer, 0.28, MOTION.enter);
  const n1 = Math.round(412 * lin(T, CUES.Read + 0.35, 1.1));
  const n2 = Math.round(lerp(412, 86, p(T, CUES.Filter + 0.15, 0.9, MOTION.enter)));
  let missing = 0;
  FLAGGED.forEach((k) => { const c = CELLS[WALLS[k]]; if (T >= beamAt(CUES, c.xB + SIZE_B / 2)) missing++; });
  const matVis = full ? 1 : 0;
  const beamX = lerp(-6, MW + 6, lin(T, CUES.Check + 0.3, 1.7));
  const beamOp = full ? p(T, CUES.Check + 0.2, 0.2, MOTION.enter) * (1 - p(T, CUES.Check + 1.9, 0.25, MOTION.enter)) : 0;
  const count = (n, unit, accent) => (
    <span style={{ marginLeft: 'auto', font: `400 15px/1 ${MONO}`, color: C.faint, whiteSpace: 'nowrap' }}>
      <span style={{ color: accent ? C.accentInk : C.ink }}>{n}</span> {unit}
    </span>
  );
  const mono = (t) => <span style={{ font: `400 15px/1 ${MONO}`, color: C.ink }}>{t}</span>;

  return (
    <div style={{ position: 'absolute', left: 20, top: 340, width: 463, height: H, borderRadius: 12, background: C.bubble, overflow: 'hidden', opacity: clamp(bIn * 1.6, 0, 1) }}>
      {/* ticker */}
      <div style={{ position: 'absolute', left: 17, right: 17, top: 13, height: 22, overflow: 'hidden', opacity: tickFade, font: `400 15.6px/22px ${SANS}`, color: C.muted }}>
        <Roll T={T} tin={CUES.Read + 0.1} tout={CUES.Filter} h={22} style={{ gap: 6 }}>Reading 4 models{count(n1, 'elements')}</Roll>
        <Roll T={T} tin={CUES.Filter} tout={CUES.Check} h={22} style={{ gap: 6 }}>Filtering {mono('IfcWall')}{count(n2, 'walls')}</Roll>
        <Roll T={T} tin={CUES.Check} h={22} style={{ gap: 6 }}>Checking Fire Rating{count(missing, 'missing', missing > 0)}</Roll>
      </div>
      {/* scan beam */}
      <div style={{ position: 'absolute', left: MX + beamX - 46, top: MY - 4, width: 46, height: 28, opacity: beamOp * 0.9, background: 'linear-gradient(90deg, rgba(53,196,182,0), rgba(53,196,182,.16))' }} />
      <div style={{ position: 'absolute', left: MX + beamX - 1, top: MY - 6, width: 2, height: 32, borderRadius: 1, opacity: beamOp, background: C.accent, boxShadow: '0 0 10px 2px rgba(53,196,182,.55)' }} />
      {/* cells */}
      {CELLS.map((c) => {
        const ta = CUES.Read + 0.35 + (c.col / 103) * 1.0;
        const sp = p(T, ta, 0.3, MOTION.pop);
        let x = c.xA + MX, y = c.yA + MY, size = SIZE_A, scale = sp, op = clamp(sp, 0, 1) * matVis;
        let color = mix('#7E9693', C.borderStrong, lin(T, ta + 0.08, 0.45));
        if (c.k == null) {
          const d = p(T, CUES.Filter + 0.1 + (c.col / 103) * 0.45, 0.3, MOTION.enter);
          scale *= 1 - d; op *= 1 - d;
          if (op <= 0.001) return null;
        } else {
          const m = p(T, CUES.Filter + 0.35 + (c.k / 86) * 0.35, 0.7, MOTION.glide);
          x = lerp(x, c.xB + MX, m); y = lerp(y, c.yB + MY, m); size = lerp(SIZE_A, SIZE_B, m);
          const tb = beamAt(CUES, c.xB + SIZE_B / 2);
          let ring = null;
          if (c.f == null) {
            const hit = 1 - lin(T, tb, 0.4);
            color = T < tb ? mix(C.borderStrong, '#405351', m) : mix('#2D3B3A', '#7E9693', hit);
            const d = p(T, CUES.Answer + 0.05 + (c.k / 86) * 0.25, 0.28, MOTION.enter);
            scale *= 1 - d; op *= 1 - d;
            if (op <= 0.001) return null;
          } else {
            const lit = T >= tb;
            if (lit) {
              color = C.accent;
              scale = lerp(0.45, 1, p(T, tb, 0.45, MOTION.pop));
              const rr = p(T, tb, 0.6, MOTION.enter);
              if (rr < 1 && full) ring = <div style={{ position: 'absolute', left: x - 1.5, top: y - 1.5, width: size + 3, height: size + 3, borderRadius: 3, border: `1.4px solid ${C.accent}`, opacity: 0.8 * (1 - rr), transform: `scale(${1 + rr * 1.6})` }} />;
            } else color = mix(C.borderStrong, '#405351', m);
            // fly into the answer rows
            const sx = 61 + FLAG_SLOT[c.f] * 14, sy = ROW_Y0 + FLAG_LEVEL[c.f] * ROW_H + 8;
            if (full) {
              const tf = CUES.Answer + 0.5 + c.f * 0.05;
              const fx = p(T, tf, 0.75, MOTION.glide), fy = p(T, tf, 0.75, MOTION.enter);
              x = lerp(x, sx, fx); y = lerp(y, sy, fy); size = lerp(size, 10, fx);
            } else {
              x = sx; y = sy; size = 10; color = C.accent;
              scale = p(T, CUES.Answer + 0.85 + c.f * 0.05, 0.45, MOTION.pop); op = clamp(scale, 0, 1);
            }
          }
          if (ring) return (
            <React.Fragment key={c.i}>
              {ring}
              <div style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size * 0.24, background: color, opacity: op, transform: `scale(${scale})`, boxShadow: '0 0 8px rgba(53,196,182,.6)' }} />
            </React.Fragment>
          );
        }
        return <div key={c.i} style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size * 0.24, background: color, opacity: op, transform: `scale(${scale})` }} />;
      })}
      {/* answer */}
      <div style={{ position: 'absolute', left: 17, top: 13, width: 429, font: `400 18px/28px ${SANS}`, color: C.ink, textWrap: 'pretty' }}>
        {ANSWER.map(([w, s], j) => {
          const a = p(T, CUES.Answer + 0.35 + j * 0.065, 0.36, MOTION.enter);
          return (
            <React.Fragment key={j}>
              <span style={{ display: 'inline-block', opacity: a, transform: `translateY(${(1 - a) * 7}px)`, fontWeight: s === 'b' ? 600 : 400, ...(s === 'm' ? { font: `400 16.5px/28px ${MONO}`, color: C.ink } : null) }}>{w}</span>
              {j < ANSWER.length - 1 ? ' ' : ''}
            </React.Fragment>
          );
        })}
      </div>
      {LEVELS.map(([lv, n], L) => {
        const a = p(T, CUES.Answer + 0.95 + L * 0.08, 0.4, MOTION.enter);
        return (
          <div key={lv} style={{ position: 'absolute', left: 17, right: 17, top: ROW_Y0 + L * ROW_H, height: ROW_H, display: 'flex', alignItems: 'center', font: `400 15px/1 ${MONO}`, opacity: a, transform: `translateX(${(1 - a) * -8}px)` }}>
            <span style={{ color: C.muted }}>{lv}</span>
            <span style={{ marginLeft: 'auto', color: C.faint }}><span style={{ color: C.ink }}>{n}</span> walls</span>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 17, right: 17, top: ROW_Y0 - 6, height: 1, background: C.line, opacity: p(T, CUES.Answer + 0.9, 0.4, MOTION.enter) }} />
    </div>
  );
}

function Piece({ tw }) {
  const { T, CUES, time, authoredTotal } = useComposition();
  const bg = useDataUrl('img/ask.webp');
  const full = tw.trace !== 'Minimal';

  // camera (screenshot coords; 1.5 = 1280 → 1920)
  const kt = [0, CUES.Send - 0.2, CUES.Send + 0.9, CUES.Think + 0.9, CUES.Answer + 0.1, CUES.Answer + 1.4, CUES.Hold + 0.3, CUES.Hold + 1.9];
  const wide = tw.camera === 'Wide';
  const z = interpolate(kt, wide ? [1, 1.03, 1.1, 1.14, 1.16, 1.12, 1.12, 1] : [1, 1.06, 1.55, 2.0, 2.08, 1.7, 1.77, 1], MOTION.glide)(T);
  const k = 1.5 * z;
  const cx0 = interpolate(kt, wide ? [640, 660, 700, 720, 720, 720, 720, 640] : [640, 690, 867, 960, 960, 904, 904, 640], MOTION.glide)(T);
  const cy0 = interpolate(kt, wide ? [400, 405, 420, 420, 420, 420, 420, 400] : [400, 420, 501, 426, 432, 453, 446, 400], MOTION.glide)(T);
  const cx = clamp(cx0, 960 / k, 1280 - 960 / k), cy = clamp(cy0, 540 / k, 800 - 540 / k);
  const dim = clamp((z - 1) / 1, 0, 1) * 0.42;
  const fade = Math.max(1 - lin(T, 0, 0.5), lin(T, authoredTotal - 0.6, 0.6));

  // typing → lift
  const typed = T < CUES.Open + 0.7 ? 0 : TYPE_TIMES.filter((t) => T >= CUES.Open + 0.7 + t).length;
  const typing = typed > 0 && typed < QUESTION.length;
  const focus = p(T, CUES.Open + 0.3, 0.3, MOTION.enter) * (1 - p(T, CUES.Send + 0.1, 0.3, MOTION.enter));
  const caretOn = T >= CUES.Open + 0.3 && T < CUES.Send && (typing || (T * 1.9) % 1 < 0.55);
  const lift = p(T, CUES.Send + 0.05, 0.7, MOTION.glide);
  const press = p(T, CUES.Send, 0.32, MOTION.pop);
  const scroll = 56 * p(T, CUES.Answer + 0.2, 0.8, MOTION.glide);
  const youIn = p(T, CUES.Send + 0.4, 0.4, MOTION.enter);
  const youLbl = p(T, CUES.Send + 0.55, 0.35, MOTION.enter);
  const phIn = typed === 0 ? 1 : p(T, CUES.Send + 0.5, 0.4, MOTION.enter);
  const busy = p(T, CUES.Send + 0.25, 0.3, MOTION.enter) * (1 - p(T, CUES.Answer + 0.1, 0.3, MOTION.enter));
  const lblIn = p(T, CUES.Think, 0.4, MOTION.enter);
  const shimmer = ((T - CUES.Think) / 1.6) % 1;
  const hexF = Math.max(0, Math.floor(T * 8));
  const hexIn = p(T, CUES.Think, 0.5, MOTION.pop);

  const qRef = React.useRef(null);
  const [qw, setQw] = React.useState(276);
  React.useLayoutEffect(() => {
    const m = () => { if (qRef.current) setQw(qRef.current.offsetWidth); };
    m(); document.fonts && document.fonts.ready.then(m);
  }, []);

  return (
    <div data-screen-label={`${Math.floor(time)}s`} style={{ position: 'absolute', inset: 0, background: C.ground, overflow: 'hidden', fontFamily: SANS }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1280, height: 800, transformOrigin: '0 0', transform: `translate(${960 - cx * k}px, ${540 - cy * k}px) scale(${k})` }}>
        <img src={bg} alt="" style={{ position: 'absolute', left: 0, top: 0, width: 1280, height: 800, display: 'block' }} />
        <div style={{ position: 'absolute', inset: 0, background: '#090D0E', opacity: dim }} />

        {/* panel */}
        <div style={{ position: 'absolute', left: 758.5, top: 80.5, width: 503.5, height: 640, boxSizing: 'border-box', borderRadius: 14, border: '1.2px solid #3C4646', background: C.panel, overflow: 'hidden' }}>
          <Header hexF={hexF} />

          {/* thread */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 72.2, height: 430, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: -72.2 - scroll, height: 900 }}>
              <Label top={88} style={{ gap: 9 }}>
                <span style={{ display: 'flex', margin: '-6px -5px -3px -8px' }}><HexSprite state="idle" f={hexF + 11} px={1.75} /></span>
                <span>Vee</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6 4 11l5 5" /><path d="M4 11h10a6 6 0 0 1 6 6v1" /></svg>
                <span style={{ marginLeft: -3 }}>reply</span>
              </Label>
              <div style={{ position: 'absolute', left: 20, top: 113, width: 463, boxSizing: 'border-box', padding: '14px 17px 13px', borderRadius: 12, background: C.bubble, font: `400 18px/28px ${SANS}`, color: C.ink }}>
                4 models, 412 elements, 6 storeys. No data-completeness issues found.
              </div>

              <Label top={215} style={{ opacity: youLbl, transform: `translateY(${(1 - youLbl) * 6}px)` }}><span>You</span></Label>
              <div style={{ position: 'absolute', left: 20, top: 240, width: qw + 34, height: 56, borderRadius: 12, background: C.selBg, opacity: youIn, transformOrigin: '0 50%', transform: `scale(${lerp(0.94, 1, youIn)})` }} />

              <Label top={315} style={{ opacity: lblIn, transform: `translateY(${(1 - lblIn) * 6}px)`, gap: 9 }}>
                <span style={{ display: 'flex', margin: '-6px -5px -3px -8px', opacity: clamp(hexIn, 0, 1), transform: `scale(${hexIn})`, transformOrigin: '50% 60%' }}><HexSprite state={hexState(T, CUES)} f={hexF} px={1.75} /></span>
                <span>Vee</span>
                <span style={{ position: 'relative', width: 300, height: 20, overflow: 'hidden' }}>
                  <Roll T={T} tin={CUES.Think + 0.15} tout={CUES.Answer} h={20}>
                    <span style={{ backgroundImage: `linear-gradient(90deg, ${C.faint} 0%, ${C.faint} 36%, ${C.ink} 50%, ${C.faint} 64%, ${C.faint} 100%)`, backgroundSize: '300% 100%', backgroundPosition: `${100 - shimmer * 100}% 0`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Thinking</span>
                  </Roll>
                  <Roll T={T} tin={CUES.Answer + 0.26} h={20} style={{ color: C.faint }}>checked 86 walls · 7s</Roll>
                </span>
              </Label>
              <Reply T={T} CUES={CUES} full={full} />
            </div>
          </div>

          {/* footer */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 502.5, height: 1.2, background: C.footLine }} />
          <div style={{ position: 'absolute', left: 20, top: 520, width: 464, height: 34, display: 'flex', gap: 9, overflow: 'hidden', WebkitMaskImage: 'linear-gradient(90deg,#000 calc(100% - 46px),transparent)', maskImage: 'linear-gradient(90deg,#000 calc(100% - 46px),transparent)' }}>
            {['Check ARC against STR', 'How many trees, by species?'].map((c) => (
              <div key={c} style={{ flex: 'none', height: 34, boxSizing: 'border-box', padding: '0 13px', border: `1.2px solid ${C.chipLine}`, borderRadius: 999, display: 'flex', alignItems: 'center', font: `400 15.6px/1 ${MONO}`, color: C.chipInk, whiteSpace: 'nowrap' }}>{c}</div>
            ))}
          </div>
          <div style={{ position: 'absolute', left: 20, top: 567, width: 401, height: 53, boxSizing: 'border-box', borderRadius: 10, background: C.bubble, border: `1.2px solid ${mix(C.inputLine, '#2F6F68', focus)}` }}>
            <div style={{ position: 'absolute', left: 16, top: 11.3, font: `400 18px/28px ${SANS}`, color: C.placeholder, opacity: phIn }}>How many doors on L2?</div>
          </div>
          <div style={{ position: 'absolute', left: 434, top: 571, width: 48, height: 48, boxSizing: 'border-box', borderRadius: 10, background: mix('#1B4A45', C.selBg, press), border: `1.2px solid ${C.sendLine}`, transform: `scale(${lerp(0.9, 1, press)})` }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.accentInk} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 12, top: 12, opacity: 1 - busy, transform: `scale(${lerp(1, 0.5, busy)})` }}><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
            <div style={{ position: 'absolute', left: 17, top: 17, width: 12, height: 12, borderRadius: 3, background: C.accentInk, opacity: busy, transform: `scale(${lerp(0.4, 1, busy)})` }} />
          </div>

          {/* the question: typed in the input, then lifted into the thread */}
          <div style={{ position: 'absolute', left: 37, top: lerp(579.5, 254, lift) - scroll, height: 28, display: 'flex', alignItems: 'center', font: `400 18px/28px ${SANS}`, color: C.ink, whiteSpace: 'nowrap' }}>
            <span ref={qRef} style={{ position: 'absolute', visibility: 'hidden' }}>{QUESTION}</span>
            <span>{QUESTION.slice(0, typed)}</span>
            <span style={{ width: 1.8, height: 22, marginLeft: 1, background: C.ink, opacity: caretOn ? 1 : 0 }} />
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1280, height: 800, transformOrigin: '0 0', transform: `translate(${960 - cx * k}px, ${540 - cy * k}px) scale(${k})`, pointerEvents: 'none' }}>
        {/* Ask button, renamed — covers the screenshot's original */}
        <div style={{ position: 'absolute', right: 1280 - 1262.5, top: 729, height: 50, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 6, padding: '0 21px 0 13px', borderRadius: 999, border: `1.5px solid ${C.accent}`, background: '#171F20', font: `600 18px/1 ${SANS}`, color: '#56D2C4', whiteSpace: 'nowrap' }}>
          <span style={{ display: 'flex', margin: '-4px -2px -2px -2px' }}><HexSprite state="idle" f={hexF + 17} px={1.5} /></span>
          Ask Vee
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: C.ground, opacity: fade, pointerEvents: 'none' }} />
    </div>
  );
}

function AskThinkingVideo() {
  const [tw, setTweak] = useTweaks(window.TWEAK_DEFAULTS || { motionEditor: true, camera: 'Follow', trace: 'Matrix' });
  return (
    <React.Fragment>
      <CompositionStage width={1920} height={1080} scenes={window.OM_SCENES} playback={window.OM_PLAYBACK} bg={C.ground}>
        <Piece tw={tw} />
      </CompositionStage>
      <TweaksPanel>
        <TweakSection label="Playback" />
        <TweakToggle label="Motion editor" value={tw.motionEditor} onChange={(v) => setTweak('motionEditor', v)} />
        <TweakSection label="Thinking" />
        <TweakRadio label="Trace" value={tw.trace} options={['Matrix', 'Minimal']} onChange={(v) => setTweak('trace', v)} />
        <TweakRadio label="Camera" value={tw.camera} options={['Follow', 'Wide']} onChange={(v) => setTweak('camera', v)} />
      </TweaksPanel>
    </React.Fragment>
  );
}

window.AskThinkingHexVideo = AskThinkingVideo;
