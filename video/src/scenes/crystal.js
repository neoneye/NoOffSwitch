// crystal.js: a ray-traced Iceland spar (calcite) crystal lying on printed paper; everything under it shows up twice.
// Ported from assets/3d-birefringent-crystal (physics core in crystal/bf.js, ray tracer in crystal/shader.js).
// Full colour (not dithered). Own WebGL2 canvas (contract option C), rendered at an internal resolution and
// upscaled by the engine.
// Modes:
//   'one'  one crystal on the paper, sliding/rotating across the printed words; the optic axis tilt breathes so
//          the two images separate and merge; oblique camera drift.
//   'two'  two crystals stacked: the top one turns relative to the bottom one, so the words split into up to 4.
//   'top'  straight-down view of one rotating crystal: a graphic, nearly 2D look of the doubled words.
// variant: printed pattern / paper / ink (see VARIANTS). shot.text: the printed words ('|' or '\n' = line break),
// default 'NO OFF SWITCH'. For development, &text=... in the page URL is used when the shot has no text.
import BF from './crystal/bf.js';
import { VS, FS } from './crystal/shader.js';
import { LYRICS } from '../lyrics.js';

const deg = Math.PI / 180, V = BF.v;
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const BLACK = '"Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"IBM Plex Mono", Menlo, monospace';

// Printed patterns. Text variants first (they matter most).
const VARIANTS = [
  { pattern: 'text', font: BLACK, weight: 900, ink: '#141414', paper: '#f3efe6' },
  { pattern: 'text', font: MONO, weight: 700, ink: '#101010', paper: '#e9e7e1' },
  { pattern: 'label', font: SANS, weight: 700, ink: '#151515', paper: '#f2efe7' },
  { pattern: 'text', font: BLACK, weight: 900, ink: '#f1eee6', paper: '#121212' },   // white on black
  { pattern: 'text', font: BLACK, weight: 900, ink: '#b0141c', paper: '#eee6d6' },   // red stamp
  { pattern: 'news', font: SANS, weight: 800, ink: '#161616', paper: '#ebe5d6' },
  { pattern: 'grid', font: SANS, weight: 700, ink: '#1c3640', paper: '#eef0ea' },
  { pattern: 'lines', font: SANS, weight: 600, ink: '#141414', paper: '#f0ede6' },
  { pattern: 'dots', font: SANS, weight: 600, ink: '#141414', paper: '#f0ede6' },
  { pattern: 'dot', font: SANS, weight: 600, ink: '#141414', paper: '#f0ede6' },
  { pattern: 'target', font: SANS, weight: 600, ink: '#141414', paper: '#f0ede6' },
  { pattern: 'checker', font: SANS, weight: 600, ink: '#151515', paper: '#ede9df' },
];
export const meta = { modes: ['one', 'two', 'top'], variants: VARIANTS.length };

const BODY = LYRICS.filter(L => L.kind !== 'sys').map(L => L.words.map(w => w[0]).join(' ')).join(' ') + ' ';
const devText = (() => { try { return new URLSearchParams(location.search).get('text'); } catch (e) { return null; } })();

// Break the words into lines: explicit '|' / '\n', else 1-3 balanced lines (longest line as short as possible).
function textLines(txt) {
  const parts = txt.split(/\||\n/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  const words = txt.trim().split(/\s+/);
  const n = Math.min(3, words.length, Math.ceil(txt.length / 14));
  let best = [txt.trim()], bestLen = Infinity;
  const rec = (i, k, acc) => {
    if (k === 1) {
      const lines = [...acc, words.slice(i).join(' ')], m = Math.max(...lines.map(l => l.length));
      if (m < bestLen) { bestLen = m; best = lines; }
      return;
    }
    for (let j = i + 1; j <= words.length - k + 1; j++) rec(j, k - 1, [...acc, words.slice(i, j).join(' ')]);
  };
  if (n > 1) rec(0, n, []);
  return best;
}

// ---------------------------------------------------------------- paper (drawPattern from the experiment)
const PAPER_W = 190;
function drawPattern(cv, P) {
  const Wmm = PAPER_W, Hmm = PAPER_W * 0.75;
  const pxW = 4096, pxH = Math.round(pxW * Hmm / Wmm);
  cv.width = pxW; cv.height = pxH;
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = P.paper; g.fillRect(0, 0, pxW, pxH);
  g.scale(pxW / Wmm, pxW / Wmm);
  const W = Wmm, H = Hmm, ink = P.ink, cx = W / 2, cy = H / 2;
  const font = (px, w = P.weight) => `${w} ${px}px ${P.font}`;
  g.fillStyle = ink; g.strokeStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  const fitText = (txt, maxW, size, w) => { g.font = font(size, w); const m = g.measureText(txt).width; return m > maxW ? size * maxW / m : size; };
  const text = P.text;
  switch (P.pattern) {
    case 'label': {
      const s = fitText(text, W * 0.82, 26);
      g.font = font(s); g.fillText(text, cx, cy - 4);
      g.fillRect(0, cy + s * 0.55, W, 1.4);
      g.fillRect(0, cy + s * 0.55 + 3.6, W, 0.6);
      break;
    }
    case 'text': {
      const lines = textLines(text);
      const lh = 1.08;
      let s = Math.min(30, H * 0.78 / (lines.length * lh));
      for (const L of lines) s = Math.min(s, fitText(L, W * 0.88, s));
      g.font = font(s);
      lines.forEach((L, i) => g.fillText(L, cx, cy + (i - (lines.length - 1) / 2) * s * lh));
      break;
    }
    case 'news': {
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      const head = text.toUpperCase();
      const hs = fitText(head, W - 16, 14, 900);
      g.font = font(hs, 900); g.fillText(head, 8, 8 + hs * 0.8);
      const y0 = 12 + hs;
      g.fillRect(8, y0, W - 16, 0.8);
      const cols = 3, gap = 6, colW = (W - 16 - gap * (cols - 1)) / cols, lh = 5.2;
      g.font = font(4.0, 500);
      const words = (BODY + BODY + BODY).split(' ');
      let col = 0, y = y0 + 8, line = '';
      for (const wd of words) {
        const t = line ? line + ' ' + wd : wd;
        if (g.measureText(t).width > colW) {
          g.fillText(line, 8 + col * (colW + gap), y); line = wd; y += lh;
          if (y > H - 6) { col++; y = y0 + 8; if (col >= cols) break; }
        } else line = t;
      }
      break;
    }
    case 'grid': {
      g.strokeStyle = 'rgba(40,140,160,.55)'; g.lineWidth = 0.25;
      for (let x = 0; x <= W; x += 2.5) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = 0; y <= H; y += 2.5) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.strokeStyle = ink; g.lineWidth = 0.9;
      for (let x = 0; x <= W; x += 12.5) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = 0; y <= H; y += 12.5) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      break;
    }
    case 'lines': {
      g.lineWidth = 1.3;
      const quad = [[W * 0.27, H * 0.27, 0], [W * 0.73, H * 0.27, 45], [W * 0.27, H * 0.73, 90], [W * 0.73, H * 0.73, 135]];
      for (const [qx, qy, a] of quad) {
        g.save(); g.translate(qx, qy); g.rotate(-a * deg);
        for (let i = -4; i <= 4; i++) { g.beginPath(); g.moveTo(-30, i * 6); g.lineTo(30, i * 6); g.stroke(); }
        g.restore();
      }
      break;
    }
    case 'dot': {
      g.beginPath(); g.arc(cx, cy, 3.2, 0, 7); g.fill();
      g.lineWidth = 0.8; g.beginPath(); g.arc(cx, cy, 25, 0, 7); g.stroke();
      g.lineWidth = 0.5; g.beginPath(); g.arc(cx, cy, 45, 0, 7); g.stroke();
      break;
    }
    case 'dots': {
      for (let y = 5; y < H; y += 10) for (let x = 5; x < W; x += 10) { g.beginPath(); g.arc(x, y, 1.8, 0, 7); g.fill(); }
      break;
    }
    case 'checker': {
      const s = 10;
      for (let y = 0; y < H / s; y++) for (let x = 0; x < W / s; x++) if ((x + y) % 2) g.fillRect(x * s, y * s, s, s);
      break;
    }
    case 'target': {
      g.lineWidth = 1.2;
      for (let r = 5; r < 70; r += 5) { g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); }
      const n = 36;
      for (const sx of [0.13, 0.87]) for (let i = 0; i < n; i += 2) {
        g.beginPath(); g.moveTo(W * sx, H * 0.5);
        g.arc(W * sx, H * 0.5, 22, i / n * 2 * Math.PI, (i + 1) / n * 2 * Math.PI); g.fill();
      }
      break;
    }
  }
  // faint paper tone: a little warmth and unevenness so it does not read as a flat card
  g.setTransform(1, 0, 0, 1, 0, 0);
  const gr = g.createRadialGradient(pxW * 0.45, pxH * 0.45, pxW * 0.1, pxW * 0.5, pxH * 0.5, pxW * 0.75);
  gr.addColorStop(0, 'rgba(255,250,240,0)'); gr.addColorStop(1, 'rgba(90,70,40,0.10)');
  g.fillStyle = gr; g.fillRect(0, 0, pxW, pxH);
  return { Wmm, Hmm };
}

// smooth deterministic wobble
const wob = (t, a, b, c) => Math.sin(t * a + c) * 0.6 + Math.sin(t * b + c * 1.7) * 0.4;
const smooth = x => x * x * (3 - 2 * x);

export async function create({ width, height }) {
  // internal resolution; the engine upscales the canvas (linear filter)
  const RW = width, RH = Math.round(RW * height / width);
  const canvas = document.createElement('canvas'); canvas.width = RW; canvas.height = RH;
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('crystal: WebGL2 unavailable');

  // ---------------------------------------------------------------- GL setup (initGL from the experiment)
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  const nU = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nU; i++) {
    const info = gl.getActiveUniform(prog, i);
    U[info.name.replace('[0]', '')] = gl.getUniformLocation(prog, info.name);
  }
  gl.uniform1i(U.uPaper, 0);
  const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');

  // paper textures, cached per (variant, text)
  const papers = new Map(), patternCanvas = document.createElement('canvas');
  function paperFor(variant, text) {
    const key = variant + '|' + text;
    let p = papers.get(key);
    if (p) return p;
    const P = Object.assign({ text }, VARIANTS[variant % VARIANTS.length]);
    const info = drawPattern(patternCanvas, P);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (anisoExt) gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, patternCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    p = { tex, info, pxPerMm: patternCanvas.width / info.Wmm };
    if (papers.size >= 8) { const [k, old] = papers.entries().next().value; gl.deleteTexture(old.tex); papers.delete(k); }
    papers.set(key, p);
    return p;
  }

  const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const MAT = BF.MATERIALS.calcite;
  const NATURAL = BF.anglesFromAxis(BF.rhombFrame().axis);   // 44.6° tilt, 51° turn

  // ---------------------------------------------------------------- one frame (render() from the experiment)
  function draw(S, cam, paper) {
    gl.viewport(0, 0, RW, RH);
    const st = BF.buildStack(S), cr = st.c1, c2 = st.c2 || cr;
    const stackH = S.thickness + (S.stack ? S.thickness2 : 0);
    // camera: orbit around a target, aimed slightly low so the subject sits above the lyric band
    const tgt = cam.target;
    const y = cam.yaw * deg, pch = cam.pitch * deg;
    const pos = V.add(tgt, V.mul([Math.cos(pch) * Math.cos(y), Math.cos(pch) * Math.sin(y), Math.sin(pch)], cam.dist));
    let F = V.norm(V.sub(tgt, pos));
    const R = V.norm(V.cross(F, [0, 0, 1]));
    let Up = V.cross(R, F);
    const tanHalf = Math.tan(cam.fov * deg / 2);
    F = V.norm(V.sub(F, V.mul(Up, tanHalf * cam.lift)));   // lens tilt: look a little lower
    Up = V.cross(R, F);
    const no = BF.channelIndices(S.no, MAT.dNo, S.dispersion), ne = BF.channelIndices(S.ne, MAT.dNe, S.dispersion);
    gl.uniform2f(U.uRes, RW, RH);
    gl.uniform3fv(U.uCamPos, pos); gl.uniform3fv(U.uCamF, F); gl.uniform3fv(U.uCamR, R); gl.uniform3fv(U.uCamU, Up);
    gl.uniform1f(U.uTanHalf, tanHalf);
    gl.uniform3fv(U.uPN, cr.planes.concat(c2.planes).flatMap(p => p.N));
    gl.uniform1fv(U.uPD, cr.planes.concat(c2.planes).map(p => p.D));
    gl.uniform3fv(U.uAxis, cr.axis.concat(c2.axis));
    gl.uniform1i(U.uStack, st.c2 ? 1 : 0);
    gl.uniform1i(U.uPlate, 0);
    gl.uniform2f(U.uPlateCS, 1, 0);
    gl.uniform3fv(U.uNo, no); gl.uniform3fv(U.uNe, ne);
    gl.uniform1i(U.uDisp, S.dispersion > 0.001 ? 1 : 0);
    gl.uniform1i(U.uShow, 0);
    gl.uniform1i(U.uCode, 0);
    gl.uniform1i(U.uPol, 0);
    gl.uniform1i(U.uSamples, S.samples);
    gl.uniform3fv(U.uPolAxis, R);
    gl.uniform2f(U.uPaperC, S.bgX, S.bgY);
    gl.uniform2f(U.uPaperHalf, paper.info.Wmm / 2, paper.info.Hmm / 2);
    gl.uniform2f(U.uPaperRot, Math.cos(S.bgRot * deg), Math.sin(S.bgRot * deg));
    gl.uniform1f(U.uTexPxPerMm, paper.pxPerMm);
    gl.uniform2fv(U.uFoot, cr.foot.concat(c2.foot).flat());
    gl.uniform2f(U.uShadowOff, 0.25 * stackH, -0.22 * stackH);
    gl.uniform1f(U.uFrost, S.frost); gl.uniform1f(U.uAmber, S.amber); gl.uniform1f(U.uRefl, S.refl); gl.uniform1f(U.uLight, S.light);
    gl.uniform3fv(U.uTable, hexToRgb(S.table));
    gl.uniform2f(U.uSpotC, S.spot[0], S.spot[1]); gl.uniform1f(U.uSpotR, S.spotR); gl.uniform1f(U.uSpotAmb, S.spotAmb);
    gl.uniform1f(U.uEnvDim, S.envDim); gl.uniform1f(U.uVig, S.vig);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, paper.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---------------------------------------------------------------- choreography
  function update(t, shot) {
    const mode = shot.mode || 'one', variant = Math.max(0, shot.variant | 0) % VARIANTS.length;
    const lt = shot.lt ?? t, seed = (shot.seed ?? 1) * 1.37 + (shot.variant | 0) * 0.71;
    const text = (shot.text ?? devText ?? 'NO OFF SWITCH').toString().toUpperCase() || 'NO OFF SWITCH';
    const paper = paperFor(variant, text);
    const beat = shot.beat || { pulse: 0, phase: 0 }, pulse = beat.pulse || 0, energy = shot.energy ?? 0.3;
    const dark = VARIANTS[variant].paper === '#121212';

    const S = {
      shape: 'rhomb', length: 74, width: 52, thickness: 40, rotation: 18, x: 0, y: 0,
      tilt: NATURAL.tilt, azimuth: NATURAL.az, no: MAT.no, ne: MAT.ne, dispersion: 1.6, amber: 0.12, frost: 0.05, refl: 1.0,
      bgRot: -3 + 2 * Math.sin(seed), bgX: 0, bgY: 0, table: '#16140f', light: 1.3,
      stack: false, rotation2: 0, thickness2: 32,
      spot: [0, 0], spotR: 100, spotAmb: 0.02, envDim: 0.45, vig: 0.4, samples: 4,
    };
    if (dark) { S.light = 1.7; S.envDim = 0.55; S.spotAmb = 0.03; }
    const cam = { yaw: -78, pitch: 52, dist: 230, fov: 30, lift: 0.1, target: [0, 0, 8] };

    if (mode === 'two') {
      // stacked crystals: the top one turns slowly relative to the bottom one (2 → 4 → 1 → 4 → 2 images)
      S.stack = true; S.thickness = 30; S.thickness2 = 30; S.length = 80; S.width = 58;
      S.rotation = 12 + 10 * wob(lt, 0.07, 0.11, seed);
      S.rotation2 = 90 - 88 * Math.cos(lt * 0.22 + seed) + 3 * pulse;
      S.x = 22 * wob(lt, 0.05, 0.083, seed + 1); S.y = 2 * Math.sin(lt * 0.1);
      S.dispersion = 1.0;
      cam.yaw = -84 + 14 * wob(lt, 0.045, 0.07, seed + 2);
      cam.pitch = 70 + 5 * wob(lt, 0.06, 0.09, seed + 3);
      cam.dist = 470 - 25 * Math.sin(lt * 0.05 + seed) - 4 * pulse; cam.fov = 19; cam.lift = 0.02;
      cam.target = [S.x * 0.55, 0, 16];
      S.spot = [S.x * 0.6, 0];
    } else if (mode === 'top') {
      // straight down; the crystal turns continuously and drifts over the words
      S.rotation = 18 + lt * 7.5 + 4 * pulse;
      S.x = 30 * wob(lt, 0.06, 0.097, seed); S.y = 4 * Math.sin(lt * 0.13 + seed);
      S.tilt = NATURAL.tilt;
      cam.pitch = 89.9; cam.yaw = -90 + 3 * Math.sin(lt * 0.05);
      cam.dist = 560 - 30 * Math.sin(lt * 0.07 + seed) - 5 * pulse; cam.fov = 14; cam.lift = 0.06;
      S.length = 92; S.width = 66; S.thickness = 32;
      cam.target = [S.x * 0.35, 0, 0];
      S.spot = [S.x * 0.4, 0]; S.spotR = 115;
    } else {
      // 'one': the crystal slides across the words while its grain breathes: the copies separate and merge
      S.rotation = 18 + 26 * wob(lt, 0.09, 0.13, seed);
      S.x = 46 * wob(lt, 0.11, 0.07, seed + 0.5); S.y = 3 * Math.sin(lt * 0.17 + seed);
      const breathe = 0.5 + 0.5 * Math.sin(lt * 0.42 + seed);       // 0 = merged, 1 = full split
      S.tilt = 6 + 40 * smooth(breathe) + 5 * pulse;
      cam.yaw = -80 + 12 * wob(lt, 0.05, 0.08, seed + 2);
      cam.pitch = 48 + 7 * wob(lt, 0.07, 0.04, seed + 3);
      cam.dist = 330 - 30 * Math.sin(lt * 0.06 + seed) - 4 * pulse; cam.fov = 22;
      cam.target = [S.x * 0.6, 0, 10];
      S.spot = [S.x * 0.7, 0];
    }
    if (!S.stack) {
      // a rhomb leans: centre its top face (what the camera looks through) on (x, y) instead of its middle
      const c = BF.buildCrystal(S);
      S.x -= c.e3[0] * 0.5; S.y -= c.e3[1] * 0.5;
    }
    S.light *= 0.97 + 0.06 * energy + 0.03 * pulse;
    draw(S, cam, paper);
  }

  return { canvas, update };
}
