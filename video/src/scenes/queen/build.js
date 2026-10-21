// build.js: three.js mesh building for one queen, ported from assets/3d-queen-clothing/index.html (textures, materials,
// body, hair, crown, gown core, details, cloth shader). Changes from the experiment:
//   * parts are split into a lower (skirt, cloth-shaded), an upper (torso, bodice, collars; pivots at the waist) and a
//     head group (head, hair, crown, mouth; pivots at the neck), so the rig can sway the body and tilt/nod the head;
//   * arms, sleeves, engageantes, hands and held regalia are rebuilt in place every frame from a posed arm curve;
//   * no underpinnings / x-ray, no legs or pelvis (hidden under the skirt), no UI; the cloth shader has an extra flare term.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { QC } from './qc.js';

const TAU = Math.PI * 2, lerp = QC.lerp;
let MAX_ANISO = 8;
export function setRenderer(renderer) { MAX_ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy()); }

// ------------------------------------------------------------------ textures (procedural, cached, cloned per use)
const texCache = new Map();
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAX_ANISO;
  return t;
}
function useTex(key, make, rx = 1, ry = 1) {
  if (!texCache.has(key)) {
    texCache.set(key, make());
    if (texCache.size > 160) { const k0 = texCache.keys().next().value; texCache.get(k0).dispose(); texCache.delete(k0); }
  } else { const v = texCache.get(key); texCache.delete(key); texCache.set(key, v); }   // LRU touch
  const t = texCache.get(key).clone(); t.repeat.set(rx, ry); return t;
}
function wrap9(S, x, y, fn) { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(x + dx, y + dy); }
function weave(g, S) {
  const rnd = QC.mulberry32(3); g.globalAlpha = 0.05;
  for (let i = 0; i < S; i += 2) { g.fillStyle = rnd() < 0.5 ? '#000' : '#fff'; g.fillRect(0, i, S, 1); g.fillRect(i, 0, 1, S); }
  g.globalAlpha = 1;
}
function drawDamask(g, x, y, s) {
  g.save(); g.translate(x, y);
  for (const m of [1, -1]) {
    g.save(); g.scale(m, 1);
    g.beginPath(); g.moveTo(0, -s * 0.46); g.bezierCurveTo(s * 0.38, -s * 0.3, s * 0.3, s * 0.15, 0, s * 0.46); g.bezierCurveTo(s * 0.1, s * 0.1, s * 0.14, -s * 0.2, 0, -s * 0.46); g.fill();
    g.beginPath(); g.ellipse(s * 0.24, -s * 0.06, s * 0.05, s * 0.13, 0.5, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(s * 0.2, s * 0.24, s * 0.04, s * 0.1, -0.6, 0, TAU); g.fill();
    g.restore();
  }
  g.beginPath(); g.arc(0, -s * 0.05, s * 0.07, 0, TAU); g.fill();
  g.restore();
}
function drawRose(g, x, y, r, col) {
  g.fillStyle = col;
  for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; g.beginPath(); g.arc(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.55, 0, TAU); g.fill(); }
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.arc(x, y, r * 0.35, 0, TAU); g.fill();
}
function fabricDrawer(pattern, base, accent) {
  return (g, S) => {
    g.fillStyle = base; g.fillRect(0, 0, S, S); weave(g, S);
    g.fillStyle = accent; g.strokeStyle = accent;
    if (pattern === 'damask') {
      g.globalAlpha = 0.5;
      for (const [x, y] of [[S * 0.25, S * 0.25], [S * 0.75, S * 0.75]]) wrap9(S, x, y, (a, b) => drawDamask(g, a, b, S * 0.46));
      g.globalAlpha = 1;
    } else if (pattern === 'trellis') {
      g.lineWidth = S * 0.012; g.globalAlpha = 0.85;
      for (let k = -4; k <= 4; k++) {
        g.beginPath(); g.moveTo((k * S) / 2, 0); g.lineTo((k * S) / 2 + S, S); g.stroke();
        g.beginPath(); g.moveTo((k * S) / 2 + S, 0); g.lineTo((k * S) / 2, S); g.stroke();
      }
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        wrap9(S, (i * S) / 2, (j * S) / 2, (a, b) => { g.beginPath(); g.arc(a, b, S * 0.025, 0, TAU); g.fill(); });
        wrap9(S, (i * S) / 2 + S / 4, (j * S) / 2 + S / 4, (a, b) => { g.beginPath(); g.arc(a, b, S * 0.012, 0, TAU); g.fill(); });
      }
      g.globalAlpha = 1;
    } else if (pattern === 'floral') {
      for (const x0 of [S * 0.25, S * 0.75]) {
        const xs = y => x0 + Math.sin((y / S) * TAU * 2) * S * 0.06;
        g.strokeStyle = '#5f7f4a'; g.lineWidth = S * 0.008; g.beginPath();
        for (let y = 0; y <= S; y += 4) (y ? g.lineTo(xs(y), y) : g.moveTo(xs(y), y));
        g.stroke();
        for (let k = 0; k < 4; k++) {
          const y = ((k + 0.5) * S) / 4, x = xs(y);
          g.fillStyle = '#6f9a58';
          g.beginPath(); g.ellipse(x - S * 0.04, y + S * 0.03, S * 0.03, S * 0.012, 0.6, 0, TAU); g.fill();
          g.beginPath(); g.ellipse(x + S * 0.04, y - S * 0.03, S * 0.03, S * 0.012, 0.6, 0, TAU); g.fill();
          drawRose(g, x, y, S * 0.035, accent);
        }
      }
    } else if (pattern === 'brocade') {
      g.lineWidth = S * 0.014; g.globalAlpha = 0.9;
      for (const x0 of [0, S / 2, S]) for (const sg of [1, -1]) {
        g.beginPath();
        for (let y = 0; y <= S; y += 4) { const x = x0 + sg * Math.sin((y / S) * TAU) * S * 0.2; y ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
      for (const [x, y] of [[S * 0.25, S * 0.5], [S * 0.75, 0]]) wrap9(S, x, y, (a, b) => drawDamask(g, a, b, S * 0.22));
      g.globalAlpha = 1;
    } else if (pattern === 'stripes') {
      g.globalAlpha = 0.75; for (let k = 0; k < 4; k++) g.fillRect((k * S) / 4, 0, S / 10, S);
      g.globalAlpha = 0.5; for (let k = 0; k < 4; k++) g.fillRect((k * S) / 4 + S / 6, 0, S * 0.01, S);
      g.globalAlpha = 1;
    } else if (pattern === 'jewelgrid') {
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
      for (let k = -2; k <= 2; k++) {
        g.beginPath(); g.moveTo((k * S) / 2, 0); g.lineTo((k * S) / 2 + S, S); g.stroke();
        g.beginPath(); g.moveTo((k * S) / 2 + S, 0); g.lineTo((k * S) / 2, S); g.stroke();
      }
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) wrap9(S, ((i + 0.5) * S) / 2 + (j % 2) * (S / 4), ((j + 0.5) * S) / 2, (a, b) => {
        g.fillStyle = '#d4af37';
        for (let k = 0; k < 8; k++) { const t = (k / 8) * TAU; g.beginPath(); g.arc(a + Math.cos(t) * S * 0.045, b + Math.sin(t) * S * 0.045, S * 0.018, 0, TAU); g.fill(); }
        g.fillStyle = accent; g.beginPath(); g.arc(a, b, S * 0.03, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(a - S * 0.008, b - S * 0.008, S * 0.008, 0, TAU); g.fill();
      });
    }
  };
}
function laceDrawer(g, W, H) {
  g.clearRect(0, 0, W, H); g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  g.fillRect(0, 0, W, H * 0.3);
  g.lineWidth = 1.5;
  for (let x = -H; x < W + H; x += 10) {
    g.beginPath(); g.moveTo(x, H * 0.28); g.lineTo(x + H * 0.6, H * 0.88); g.stroke();
    g.beginPath(); g.moveTo(x + H * 0.6, H * 0.28); g.lineTo(x, H * 0.88); g.stroke();
  }
  for (let k = 0; k < 4; k++) {
    const x = ((k + 0.5) * W) / 4, y = H * 0.55;
    g.lineWidth = 4; g.beginPath(); g.arc(x, y, H * 0.13, 0, TAU); g.stroke();
    for (let j = 0; j < 6; j++) { const a = (j / 6) * TAU; g.beginPath(); g.arc(x + Math.cos(a) * H * 0.09, y + Math.sin(a) * H * 0.09, H * 0.045, 0, TAU); g.fill(); }
  }
  g.fillRect(0, H * 0.82, W, H * 0.04);
  for (let k = 0; k < 8; k++) {
    const x = ((k + 0.5) * W) / 8;
    g.beginPath(); g.arc(x, H * 0.84, W / 16, 0, Math.PI); g.fill();
    g.lineWidth = 3; g.beginPath(); g.arc(x, H * 0.84, W / 16 + 4, 0, Math.PI); g.stroke();
  }
}
const laceTex = (rx, ry) => useTex('lace', () => canvasTex(256, 128, laceDrawer), rx, ry);
const ermineTex = (rx, ry) => useTex('ermine', () => canvasTex(256, 256, (g, S) => {
  g.fillStyle = '#f7f4ee'; g.fillRect(0, 0, S, S);
  const rnd = QC.mulberry32(11); g.globalAlpha = 0.08;
  for (let i = 0; i < 1500; i++) { g.fillStyle = rnd() < 0.5 ? '#c8c0b4' : '#fff'; g.fillRect(rnd() * S, rnd() * S, 1, 6); }
  g.globalAlpha = 1; g.fillStyle = '#111';
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) wrap9(S, ((i + 0.5 + (j % 2) * 0.5) * S) / 4, ((j + 0.5) * S) / 4, (x, y) => {
    g.beginPath(); g.moveTo(x, y - 14); g.quadraticCurveTo(x + 7, y + 6, x, y + 12); g.quadraticCurveTo(x - 7, y + 6, x, y - 14); g.fill();
  });
}), rx, ry);
const braidTex = (rx, ry) => useTex('braid', () => canvasTex(64, 64, (g, S) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S); g.strokeStyle = '#8a7a50'; g.lineWidth = 3;
  for (let k = -2; k <= 2; k++) {
    g.beginPath(); g.moveTo((k * S) / 2, 0); g.lineTo((k * S) / 2 + S, S); g.stroke();
    g.beginPath(); g.moveTo((k * S) / 2 + S, 0); g.lineTo((k * S) / 2, S); g.stroke();
  }
  g.fillStyle = '#8a7a50'; wrap9(S, S / 2, S / 2, (x, y) => { g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); });
}), rx, ry);
function faceTex(skin, makeup) {
  return useTex(`face|${skin}|${makeup}`, () => {
    const t = canvasTex(1024, 512, (g, W, H) => {
      const base = new THREE.Color(skin).lerp(new THREE.Color('#f7f2ec'), makeup * 0.6);
      g.fillStyle = '#' + base.getHexString(); g.fillRect(0, 0, W, H);
      const cx = W * 0.25, ey = H * 0.5;
      for (const sx of [-1, 1]) {
        const gr = g.createRadialGradient(cx + sx * 70, ey + 45, 2, cx + sx * 70, ey + 45, 46);
        gr.addColorStop(0, `rgba(220,90,100,${0.22 + 0.25 * makeup})`); gr.addColorStop(1, 'rgba(220,90,100,0)');
        g.fillStyle = gr; g.fillRect(cx + sx * 70 - 50, ey - 5, 100, 100);
        const ex = cx + sx * 56;
        g.fillStyle = 'rgba(120,80,90,0.18)'; g.beginPath(); g.ellipse(ex, ey - 6, 26, 15, 0, 0, TAU); g.fill();
        g.fillStyle = '#fbf8f2'; g.beginPath(); g.ellipse(ex, ey, 22, 10, 0, 0, TAU); g.fill();
        g.fillStyle = '#3a2a20'; g.beginPath(); g.arc(ex + sx, ey, 9, 0, TAU); g.fill();
        g.fillStyle = '#0a0605'; g.beginPath(); g.arc(ex + sx, ey, 4.2, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(ex + sx + 3, ey - 3, 2, 0, TAU); g.fill();
        g.strokeStyle = '#1e120c'; g.lineWidth = 4.5; g.beginPath(); g.ellipse(ex, ey + 1, 23, 11.5, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
        g.strokeStyle = `rgba(70,45,30,${0.95 - 0.45 * makeup})`; g.lineWidth = 5.5 - 2.5 * makeup;
        g.beginPath(); g.ellipse(ex, ey - 26 - 6 * makeup, 27, 9, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      }
      const ly = H * 0.61;
      g.fillStyle = makeup > 0.5 ? '#a80f26' : '#b2404c';
      g.beginPath(); g.moveTo(cx - 30, ly); g.quadraticCurveTo(cx - 14, ly - 14, cx, ly - 6); g.quadraticCurveTo(cx + 14, ly - 14, cx + 30, ly); g.quadraticCurveTo(cx, ly + 19, cx - 30, ly); g.fill();
      g.strokeStyle = 'rgba(70,15,20,0.75)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx - 28, ly); g.quadraticCurveTo(cx, ly + 3, cx + 28, ly); g.stroke();
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}

// ------------------------------------------------------------------ materials & geometry helpers
function sharedGeo(g) { g.userData.shared = true; return g; }
const SPHERE = sharedGeo(new THREE.SphereGeometry(1, 32, 20));
const TILE = p => 0.22 * p.patternScale;
function fabricMat(p, pattern, base, accent, rx, ry) {
  const m = new THREE.MeshPhysicalMaterial({ map: useTex(`f|${pattern}|${base}|${accent}`, () => canvasTex(512, 512, fabricDrawer(pattern, base, accent)), rx, ry), side: THREE.DoubleSide });
  const s = p.sheen;
  m.sheenColor.set(base).lerp(new THREE.Color('#ffffff'), 0.55);
  if (p.material === 'velvet') { m.roughness = 0.85; m.sheen = 0.6 + 0.4 * s; m.sheenRoughness = 0.35; }
  else if (p.material === 'satin') { m.roughness = 0.4 - 0.2 * s; m.sheen = 0.25 + 0.5 * s; m.sheenRoughness = 0.25; m.clearcoat = 0.1 * s; m.clearcoatRoughness = 0.4; }
  else if (p.material === 'brocade') { m.roughness = 0.5; m.metalness = 0.18; m.sheen = 0.3 * s; m.sheenRoughness = 0.5; }
  else { m.roughness = 0.45; m.sheen = 0.25 + 0.3 * s; m.sheenRoughness = 0.3; m.iridescence = 0.3 * s; m.iridescenceIOR = 1.6; }
  return m;
}
const skinMat = p => new THREE.MeshPhysicalMaterial({ color: p.skinTone, roughness: 0.5, sheen: 0.4, sheenColor: new THREE.Color('#ffd0c0'), sheenRoughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.6 });
const goldMat = () => new THREE.MeshStandardMaterial({ color: '#d9b54a', metalness: 1, roughness: 0.28 });
const laceMat = (rx, ry, color = '#f7f2e8') => new THREE.MeshStandardMaterial({ color, map: laceTex(rx, ry), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.75 });
const pearlMat = () => new THREE.MeshPhysicalMaterial({ color: '#f4efe6', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.15, sheen: 0.6, sheenColor: new THREE.Color('#ffe8f0') });
const satin = c => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.3, sheen: 0.6, sheenRoughness: 0.3, sheenColor: new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.5), side: THREE.DoubleSide });
function toGeom(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  if (m.uv) g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  g.setIndex(new THREE.BufferAttribute(m.idx, 1));
  for (const gr of m.groups || []) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.computeVertexNormals();
  if (m.seam) fixSeam(g, m.cols, m.rows);
  return g;
}
function fixSeam(g, cols, rows) {
  const n = g.attributes.normal, v = new THREE.Vector3();
  for (let j = 0; j <= rows; j++) {
    const a = j * (cols + 1), b = a + cols;
    v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z);
  }
}
// Variable-radius tube along a curve (the experiment's tubeGeom), rebuilt in place every frame for posed arms.
// The first frame's normal comes from a fixed reference that an arm never points along (into the back of the torso).
class Tube {
  constructor(ls, rs, colFn) {
    this.ls = ls; this.rs = rs;
    const nv = (ls + 1) * (rs + 1), idx = [];
    for (let i = 0; i < ls; i++) for (let k = 0; k < rs; k++) { const a = i * (rs + 1) + k, b = a + rs + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(nv * 2);
    for (let i = 0; i <= ls; i++) for (let k = 0; k <= rs; k++) { const j = i * (rs + 1) + k; uv[2 * j] = k / rs; uv[2 * j + 1] = i / ls; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (colFn) {
      const col = new Float32Array(nv * 3);
      for (let i = 0; i <= ls; i++) { const c = colFn(i / ls); for (let k = 0; k <= rs; k++) { const j = 3 * (i * (rs + 1) + k); col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b; } }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    g.setIndex(idx);
    this.geometry = g;
    this.P = new THREE.Vector3(); this.T = new THREE.Vector3(); this.B = new THREE.Vector3(); this.N = new THREE.Vector3();
  }
  update(curve, t0, t1, rFn, side, vScale = 1, dropFn = null) {
    const { ls, rs, P, T, B, N } = this, pos = this.geometry.attributes.position.array, uv = this.geometry.attributes.uv.array, len = curve.getLength();
    for (let i = 0; i <= ls; i++) {
      const t = lerp(t0, t1, i / ls);
      curve.getPointAt(t, P); curve.getTangentAt(t, T);
      if (i === 0) N.set(-0.55 * side, -0.35, -0.75);
      N.addScaledVector(T, -T.dot(N)).normalize(); B.crossVectors(T, N);
      const r = rFn(t);
      if (dropFn) P.y -= dropFn(t);   // heavy trumpet cuffs hang down
      for (let k = 0; k <= rs; k++) {
        const a = (k / rs) * TAU, ca = Math.cos(a), sa = Math.sin(a), j = i * (rs + 1) + k;
        pos[3 * j] = P.x + (N.x * ca + B.x * sa) * r; pos[3 * j + 1] = P.y + (N.y * ca + B.y * sa) * r; pos[3 * j + 2] = P.z + (N.z * ca + B.z * sa) * r;
        uv[2 * j + 1] = t * len * vScale;
      }
    }
    this.geometry.attributes.position.needsUpdate = true; this.geometry.attributes.uv.needsUpdate = true;
    this.geometry.computeVertexNormals(); fixSeam(this.geometry, rs, ls);
  }
}
function blob(mat, sx, sy, sz, x, y, z) { const m = new THREE.Mesh(SPHERE, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); return m; }

// ------------------------------------------------------------------ queen: body, hair, crown
function buildBody(Q, p, f) {
  const skin = skinMat(p);
  Q.add(new THREE.Mesh(toGeom(QC.buildTorsoBand(p, 64, 40, () => f.waistY - 0.02, () => f.neckY, 0)), skin), { part: 'upper' });
  const nh = f.headY - f.neckY + 0.02;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.06, nh, 24, 1, true), skin);
  neck.position.set(0, f.neckY - 0.02 + nh / 2, -0.004); Q.add(neck, { part: 'upper' });
  const headMat = new THREE.MeshPhysicalMaterial({ map: faceTex(p.skinTone, p.faceMakeup), roughness: 0.5, sheen: 0.4, sheenColor: new THREE.Color('#ffd0c0'), clearcoat: 0.15 });
  Q.add(blob(headMat, QC.HEAD[0], QC.HEAD[1], QC.HEAD[2], 0, f.headY, 0), { part: 'head' });
  Q.add(blob(skin, 0.011, 0.02, 0.014, 0, f.headY - 0.012, 0.088), { part: 'head' });
  // mouth: a dark ellipsoid on the lip line of the face texture, opened by the rig while she sings
  Q.mouth = blob(new THREE.MeshBasicMaterial({ color: '#0a0204' }), 0.015, 0.002, 0.012, 0, f.headY - 0.038, 0.08);
  Q.add(Q.mouth, { part: 'head', shadow: false });
  const glove = new THREE.Color('#f6f2ea'), sk = new THREE.Color(p.skinTone);
  const gloved = t => (p.gloves === 'opera' && t > 0.42) || (p.gloves === 'wrist' && t > 0.86);
  const armMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, sheen: 0.3, sheenColor: new THREE.Color('#ffd0c0') });
  const handMat = p.gloves !== 'none' ? new THREE.MeshStandardMaterial({ color: '#f6f2ea', roughness: 0.6 }) : skin;
  Q.arms = [1, -1].map(s => {
    const tube = new Tube(40, 14, t => (gloved(t) ? glove : sk));
    const mesh = new THREE.Mesh(tube.geometry, armMat); mesh.frustumCulled = false;
    Q.add(mesh, { part: 'upper' });
    const hand = blob(handMat, 0.024, 0.017, 0.05, 0, 0, 0); Q.add(hand, { part: 'upper' });
    return { side: s, tube, hand, held: [] };
  });
  buildHair(Q, p, f);
  buildCrown(Q, p, f);
}
function hairTopY(p, f) {
  const y = f.headY;
  switch (p.hairStyle) {
    case 'pouf': return y + 0.09 + 0.12 * (0.4 + p.poufHeight) * 0.95;
    case 'curls': return y + 0.135;
    case 'upswept': return y + 0.15;
    case 'gable': return y + 0.14;
    default: return y + 0.12;
  }
}
function buildHair(Q, p, f) {
  const H = QC.HEAD, y = f.headY, o = { part: 'head' };
  const hm = new THREE.MeshStandardMaterial({ color: p.hairColor, roughness: 0.55 });
  const add = (sx, sy, sz, x, yy, z, m = hm) => Q.add(blob(m, sx, sy, sz, x, y + yy, z), o);
  if (p.hairStyle === 'gable') {
    const velvet = new THREE.MeshPhysicalMaterial({ color: '#1a1214', roughness: 0.8, sheen: 1, sheenColor: new THREE.Color('#5a4a50') });
    add(H[0] * 1.13, H[1] * 1.08, H[2] * 1.1, 0, 0.012, -0.022, velvet);
    const shape = new THREE.Shape([[-0.105, -0.11], [-0.105, 0.07], [0, 0.15], [0.105, 0.07], [0.105, -0.11]].map(a => new THREE.Vector2(a[0], a[1])));
    shape.holes.push(new THREE.Path([[-0.078, -0.11], [0.078, -0.11], [0.078, 0.06], [0, 0.12], [-0.078, 0.06]].map(a => new THREE.Vector2(a[0], a[1]))));
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: '#d4af37', metalness: 0.8, roughness: 0.35 }));
    frame.position.set(0, y, 0.035); Q.add(frame, o);
    const veil = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.025), velvet);
    veil.position.set(0, y - 0.07, -0.11); veil.rotation.x = 0.18; Q.add(veil, o);
    return;
  }
  add(H[0] * 1.07, H[1] * 1.03, H[2] * 1.05, 0, 0.018, -0.014);
  if (p.hairStyle === 'curls') {
    for (let k = 0; k < 15; k++) { const a = lerp(-1.35, 1.35, k / 14); add(0.024, 0.022, 0.022, 0.082 * Math.sin(a), 0.06 + 0.035 * Math.cos(a), 0.06 * Math.cos(a) - 0.005); }
    add(0.085, 0.06, 0.085, 0, 0.085, -0.01);
  } else if (p.hairStyle === 'pouf') {
    const hgt = 0.12 * (0.4 + p.poufHeight);
    add(0.092, hgt, 0.098, 0, 0.09, -0.012);
    for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
      const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.05, 4, 10), hm);
      c.rotation.x = Math.PI / 2; c.position.set(s * (0.088 + 0.004 * k), y + 0.01 - 0.033 * k, -0.02); Q.add(c, o);
    }
    const feather = new THREE.MeshStandardMaterial({ color: '#fbf8f2', roughness: 0.9 });
    const accentFeather = new THREE.MeshStandardMaterial({ color: p.gownAccent, roughness: 0.9 });
    for (const [rz, rx, len, m] of [[-0.3, -0.5, 0.095, feather], [-0.75, -0.3, 0.08, accentFeather], [-1.1, -0.65, 0.065, feather]]) {
      const fe = blob(m, 0.012, len, 0.006, 0, 0, 0); fe.rotation.set(rx, 0, rz);
      fe.position.set(0.045, y + 0.06 + hgt, -0.045).addScaledVector(new THREE.Vector3(0, 1, 0).applyEuler(fe.rotation), len * 0.85); Q.add(fe, o);
    }
  } else if (p.hairStyle === 'chignon') {
    const bun = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.02, 10, 24), hm); bun.position.set(0, y - 0.03, -0.1); Q.add(bun, o);
    for (const s of [1, -1]) for (let k = 0; k < 3; k++) add(0.016, 0.022, 0.016, s * 0.08, -0.04 - 0.035 * k, -0.01);
  } else if (p.hairStyle === 'upswept') {
    add(0.098, 0.075, 0.1, 0, 0.065, 0); add(0.04, 0.03, 0.04, 0, 0.13, -0.015);
  } else {
    add(0.093, 0.085, 0.1, 0, 0.035, -0.008);
    for (const s of [1, -1]) add(0.03, 0.05, 0.06, s * 0.085, -0.02, -0.01);
  }
}
function buildCrown(Q, p, f) {
  if (p.crown === 'none') return;
  const g = new THREE.Group(), gold = goldMat(), GEMS = ['#b3122b', '#1f4fa8', '#138a52'];
  const gem = c => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.1, clearcoat: 1, emissive: c, emissiveIntensity: 0.15 });
  const arcPts = (R, a0, a1, y, n = 32) => Array.from({ length: n + 1 }, (_, k) => { const a = lerp(a0, a1, k / n); return new THREE.Vector3(R * Math.sin(a), y, R * Math.cos(a)); });
  const tube = (pts, r, closed = false, mat = gold) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), pts.length * 3, r, 8, closed), mat);
  const ball = (mat, r, x, y, z) => { const m = new THREE.Mesh(SPHERE, mat); m.scale.setScalar(r); m.position.set(x, y, z); return m; };
  if (p.crown === 'tiara') {
    const R = 0.088; g.add(tube(arcPts(R, -1.35, 1.35, 0), 0.004));
    for (let k = 0; k <= 12; k++) {
      const a = lerp(-1.3, 1.3, k / 12), h = 0.018 + 0.035 * Math.cos(a) ** 4;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.0045, h, 6), gold); sp.position.set(R * Math.sin(a), h / 2, R * Math.cos(a)); g.add(sp);
      g.add(ball(gem(k % 3 ? '#e6eeff' : GEMS[(k / 3) % 3]), 0.0055, R * Math.sin(a), h, R * Math.cos(a)));
    }
    g.position.set(0, f.headY + 0.072, 0.012); g.rotation.x = -0.3;
  } else if (p.crown === 'diadem') {
    const R = 0.072, pm = pearlMat(); g.add(tube(arcPts(R, 0, TAU, 0), 0.004, true));
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU, h = 0.012 + 0.012 * (k % 2);
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.004, h, 6), gold); sp.position.set(R * Math.sin(a), h / 2, R * Math.cos(a)); g.add(sp);
      g.add(ball(pm, 0.0045, R * Math.sin(a), h + 0.002, R * Math.cos(a)));
    }
    g.position.set(0, hairTopY(p, f) - 0.03, -0.008);
  } else {
    const R = 0.074;
    g.add(tube(arcPts(R, 0, TAU, 0), 0.006, true), tube(arcPts(R, 0, TAU, 0.03), 0.004, true));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.03, 40, 1, true), gold); band.position.y = 0.015; g.add(band);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(R * 0.95, 24, 12, 0, TAU, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: p.crown === 'coronation' ? '#4a1a5e' : '#8a1020', roughness: 0.8, sheen: 1, sheenColor: new THREE.Color('#ff9090') }));
    cap.scale.y = 0.85; cap.position.y = 0.02; g.add(cap);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU, x = R * Math.sin(a), z = R * Math.cos(a);
      if (k % 2 === 0) {
        const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.034, 0.004), gold), c2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.004), gold);
        c1.position.set(x, 0.047, z); c2.position.set(x, 0.05, z); c1.rotation.y = c2.rotation.y = a; g.add(c1, c2);
      } else { const fl = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.03, 6), gold); fl.position.set(x, 0.045, z); g.add(fl); }
      g.add(ball(gem(GEMS[k % 3]), 0.0065, x * 1.06, 0.015, z * 1.06));
    }
    for (const a of [0, Math.PI / 2]) {
      const pts = Array.from({ length: 25 }, (_, k) => { const t = lerp(-Math.PI / 2, Math.PI / 2, k / 24), r = R * Math.sin(t); return new THREE.Vector3(r * Math.sin(a), 0.03 + 0.075 * Math.cos(t) - 0.018 * Math.cos(t) ** 8, r * Math.cos(a)); });
      g.add(tube(pts, 0.0045));
    }
    g.add(ball(gold, 0.014, 0, 0.1, 0));
    const x1 = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.03, 0.006), gold); x1.position.y = 0.125;
    const x2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.006, 0.006), gold); x2.position.y = 0.128; g.add(x1, x2);
    if (p.crown === 'coronation') g.add(tube(arcPts(R * 1.05, 0, TAU, -0.002), 0.012, true, new THREE.MeshStandardMaterial({ map: ermineTex(8, 1), roughness: 0.95 })));
    g.position.set(0, hairTopY(p, f) - 0.03, -0.008);
  }
  g.scale.setScalar(p.crownScale); Q.add(g, { part: 'head' });
}

// ------------------------------------------------------------------ queen: gown core
function buildGown(Q, p, f) {
  const tile = TILE(p), U = Math.max(4, Math.round(14 / p.patternScale));
  const gown = fabricMat(p, p.pattern, p.gownColor, p.gownAccent, U, 1 / tile);
  Q.add(new THREE.Mesh(toGeom(QC.buildSkirtGrid(p, 160, 64, { gap: true })), gown), { cloth: true });
  if (p.frontOpen > 0.01) {
    const fore = fabricMat(p, p.forePattern, p.foreColor, p.foreAccent, U, 1 / tile);
    Q.add(new THREE.Mesh(toGeom(QC.buildSkirtGrid(p, 96, 48, { inset: 0.985, noTrain: true, folds: false })), fore), { cloth: true });
  }
  const bu = Math.max(2, Math.round(0.8 / tile));
  const bod = fabricMat(p, p.pattern, p.bodiceColor, p.bodiceAccent, bu, 1 / tile);
  const sto = fabricMat(p, p.forePattern, p.foreColor, p.foreAccent, bu, 1 / tile);
  Q.add(new THREE.Mesh(toGeom(QC.buildBodiceGrid(p)), [bod, sto]), { part: 'upper' });
  Q.mats = { gown, bod, tile, U };
}

// ------------------------------------------------------------------ queen: details
const PEARL = sharedGeo(new THREE.SphereGeometry(1, 12, 8));
const JEWEL = sharedGeo(new THREE.OctahedronGeometry(1));
let BOW = null;
function bowGeo() {
  if (BOW) return BOW;
  const parts = [];
  for (const s of [1, -1]) {
    const loop = new THREE.TorusGeometry(0.28, 0.1, 8, 20); loop.scale(1, 0.6, 0.5); loop.rotateZ(s * 0.25); loop.translate(s * 0.3, 0, 0); parts.push(loop);
    const tail = new THREE.BoxGeometry(0.12, 0.45, 0.04); tail.rotateZ(s * 0.35); tail.translate(s * 0.12, -0.3, 0); parts.push(tail);
  }
  parts.push(new THREE.SphereGeometry(0.12, 12, 8));
  BOW = sharedGeo(mergeGeometries(parts.map(g => (g.index ? g.toNonIndexed() : g))));
  return BOW;
}
const at = (x, y, z, s = 1, ry = 0, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), new THREE.Vector3(s, s, s));
function instanced(geo, mat, mats) { const m = new THREE.InstancedMesh(geo, mat, mats.length); mats.forEach((M, i) => m.setMatrixAt(i, M)); m.instanceMatrix.needsUpdate = true; return m; }
const outward = (q, d) => { const r = Math.hypot(q[0], q[2]) || 1, k = (r + d) / r; return [q[0] * k, q[1], q[2] * k]; };

function buildDetails(Q, p, f) {
  const { gown, tile } = Q.mats, gap = p.frontOpen > 0.01, R = QC.mulberry32(17);
  const braidM = (rx, ry) => new THREE.MeshStandardMaterial({ color: p.braidColor, map: braidTex(rx, ry), metalness: 0.6, roughness: 0.38, side: THREE.DoubleSide });
  const UP = { part: 'upper' };

  // ---- sleeves + engageantes (posed per frame, see Queen.pose)
  const sleeveMat = fabricMat(p, p.pattern, p.bodiceColor, p.bodiceAccent, 2, 1 / tile);
  for (const A of Q.arms) {
    A.sleeve = new Tube(48, 24); A.sleeveL = p.sleeveLength * 0.9;
    const L = A.sleeveL; A.drop = p.cuffFlare > 0.05 ? t => 0.75 * p.cuffFlare * 0.13 * Math.pow(QC.smoothstep(L - 0.32, L, t), 1.6) : null;
    const m = new THREE.Mesh(A.sleeve.geometry, sleeveMat); m.frustumCulled = false; Q.add(m, UP);
    A.cones = [];
    if (p.engageantes > 0.01) {
      const r0 = QC.sleeveRadius(A.sleeveL, p) * 0.92;
      for (let k = 0; k < 3; k++) {
        const r1 = r0 + (0.03 + 0.05 * p.engageantes) * (1 + 0.3 * k), len = (0.05 + 0.09 * p.engageantes) * (1 + 0.25 * k);
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, 36, 1, true), laceMat(4 + k, 1));
        Q.add(cone, { part: 'upper', shadow: false });
        A.cones.push({ mesh: cone, len, k });
      }
    }
  }

  // ---- collars
  if (p.ruff > 0.01) for (let k = 0; k < p.ruffLayers; k++) {
    const rm = new THREE.MeshPhysicalMaterial({ color: '#fbf8f1', map: laceTex(1, 1), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7, sheen: 0.3 });
    const ring = QC.buildRuffRing(p, k); ring.seam = true;
    Q.add(new THREE.Mesh(toGeom(ring), rm), UP);
  }
  if (p.fanCollar > 0.01) {
    const Rf = 0.12 + 0.3 * p.fanCollar, tilt = 0.35;
    const pt = (s, t) => { const a = lerp(-1.9, 1.9, s), rho = Rf * (0.12 + 0.88 * t), u = rho * Math.sin(a), w = rho * Math.cos(a);
      return [u, f.shoulderY + 0.03 + w * Math.cos(tilt), -0.06 - w * Math.sin(tilt) + 0.45 * u * u]; };
    Q.add(new THREE.Mesh(toGeom(QC.gridMesh(64, 10, (s, t) => [...pt(s, t), s * 8, 1 - t])), laceMat(1, 1)), { part: 'upper', shadow: false });
    const rimPts = Array.from({ length: 65 }, (_, k) => new THREE.Vector3(...pt(k / 64, 1)));
    Q.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts), 128, 0.0018, 5), goldMat()), UP);
  }
  if (p.bertha > 0.01) {
    const depth = 0.03 + 0.11 * p.bertha, rs = QC.sleeveRadius(0.06, p);
    const m = QC.gridMesh(120, 6, (s, t) => {
      const phi = Math.PI + s * TAU, y = QC.necklineTop(phi, p) + 0.008 - t * depth;
      const side = Math.abs(Math.sin(phi)) ** 3;
      const q = QC.torsoPoint(phi, Math.max(y, f.waistY), p, 0.012 + 0.035 * t * t + side * (rs + 0.01) + 0.006 * t * Math.sin(phi * 60));
      return [q[0], q[1], q[2], s * 24, 1 - t];
    });
    m.seam = true;
    Q.add(new THREE.Mesh(toGeom(m), laceMat(1, 1)), { part: 'upper', shadow: false });
  }
  if (p.highCollar > 0.01) {
    const h = 0.02 + 0.045 * p.highCollar, tex = laceTex(10, -1); tex.offset.y = 1;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.062, h, 40, 1, true), new THREE.MeshStandardMaterial({ color: '#f7f2e8', map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.75 }));
    c.position.set(0, f.neckY - 0.012 + h / 2, -0.004);
    Q.add(c, { part: 'upper', shadow: false });
  }

  // ---- mantle of estate with ermine
  if (p.mantle > 0.01) {
    const MC = 48, MR = 72;
    const mm = new THREE.MeshPhysicalMaterial({ color: p.mantleColor, roughness: 0.8, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color(p.mantleColor).lerp(new THREE.Color('#ffffff'), 0.5), side: THREE.DoubleSide });
    Q.add(new THREE.Mesh(toGeom(QC.gridMesh(MC, MR, (s, t) => [...QC.mantlePoint(s, t, p), s, t])), mm), { cloth: true });
    if (p.ermine > 0.005) {
      const lift = (q, d) => { const o = outward(q, d); if (o[1] < 0.05) o[1] += 0.004; return o; };
      const pathLen = f.shoulderY - QC.HEM_Y + p.mantle;
      for (const edge of [0, 1]) {
        const m = QC.gridMesh(4, MR, (a, t) => {
          const c = QC.mantlePoint(0.5, t, p), width = Math.hypot(c[0], c[2]) * QC.mantleHalfSpan(t, p) * 2;
          const ds = Math.min(0.5, p.ermine / Math.max(width, 0.05)), s = edge ? 1 - ds * a : ds * a;
          return [...lift(QC.mantlePoint(s, t, p), 0.004), (a * p.ermine) / 0.25, (t * pathLen) / 0.25];
        });
        Q.add(new THREE.Mesh(toGeom(m), new THREE.MeshStandardMaterial({ map: ermineTex(1, 1), roughness: 0.95, side: THREE.DoubleSide })), { cloth: true });
      }
      const tb = 1 - Math.min(0.5, p.ermine / pathLen);
      const hem = QC.gridMesh(MC, 3, (s, a) => [...lift(QC.mantlePoint(s, lerp(tb, 1, a), p), 0.005), s * 12, (a * p.ermine) / 0.25]);
      Q.add(new THREE.Mesh(toGeom(hem), new THREE.MeshStandardMaterial({ map: ermineTex(1, 1), roughness: 0.95, side: THREE.DoubleSide })), { cloth: true });
    }
  }

  // ---- flounces + fringe
  for (let k = 0; k < p.flounces; k++) {
    const d = p.flounceDepth, v0 = p.flounces === 1 ? 0.97 - d : lerp(0.32, 0.97 - d, k / (p.flounces - 1));
    const m = QC.buildSkirtGrid(p, 200, 10, { gap: true, v0, v1: v0 + d, offset: 0.008 + 0.004 * k, flare: 0.03, ruffle: true, lift: 0.003 * (k + 1) });
    Q.add(new THREE.Mesh(toGeom(m), gown), { cloth: true });
    if (p.fringe > 0.01) {
      const C = m.cols + 1, j = m.rows, len = 0.015 + 0.06 * p.fringe, pts = [];
      for (let i = 0; i < C - 1; i++) for (let s = 0; s < 3; s++) {
        const a = (j * C + i) * 3, b = a + 3, t = s / 3;
        const x = lerp(m.pos[a], m.pos[b], t), y = lerp(m.pos[a + 1], m.pos[b + 1], t), z = lerp(m.pos[a + 2], m.pos[b + 2], t);
        pts.push(x, y, z, x * 1.01, Math.max(0.004, y - len), z * 1.01);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      Q.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: p.braidColor })), { cloth: true });
    }
  }

  // ---- braid: hem bands and the edges of the opening (or a centre-front band)
  for (let k = 0; k < p.braidBands; k++) {
    const vc = 0.985 - k * 0.06;
    Q.add(new THREE.Mesh(toGeom(QC.buildSkirtGrid(p, 200, 2, { gap: true, v0: vc - 0.014, v1: vc, offset: 0.004, uvBand: true, uScale: 200 })), braidM(1, 1)), { cloth: true });
  }
  if (p.frontTrim > 0.001) {
    const w = p.frontTrim, rAt = (v, th) => Math.max(0.08, QC.skirtRadius(v, th, p));
    const spans = gap
      ? [v => { const g = QC.halfGap(v, p); return [g, g + w / rAt(v, g)]; }, v => { const g = QC.halfGap(v, p); return [QC.TAU - g - w / rAt(v, -g), QC.TAU - g]; }]
      : [v => { const h = w / 2 / rAt(v, 0); return [-h, h]; }];
    for (const span of spans) Q.add(new THREE.Mesh(toGeom(QC.buildSkirtGrid(p, 3, 80, { span, offset: 0.004, uScale: 60 })), braidM(1, 1 / Math.max(w, 0.01))), { cloth: true });
  }

  // ---- pearls: opening rows (skirt), neckline and necklaces (upper body)
  const pearls = [], neckPearls = [], ps = 0.0055;
  if (p.pearlRows > 0) {
    for (let row = 0; row < p.pearlRows; row++) {
      const off = 0.012 + 0.016 * row;
      for (let v = 0.02; v <= 1; v += 0.012) {
        let ths = [];
        if (gap) { const g = QC.halfGap(v, p), r = QC.skirtRadius(v, g, p); ths = [g + off / r, QC.TAU - g - off / r]; }
        else if (p.frontTrim > 0.001) ths = [((row % 2 ? 1 : -1) * (p.frontTrim / 2 + off * 0.5)) / QC.skirtRadius(v, 0, p)];
        for (const th of ths) { const q = outward(QC.skirtPoint(v, th, p), 0.006 + QC.foldAt(v, th, p)); pearls.push(at(q[0], q[1] + 0.003, q[2], ps)); }
      }
    }
    for (let s = 0; s < 1; s += 1 / 140) {
      const phi = Math.PI + s * TAU, q = QC.torsoPoint(phi, QC.necklineTop(phi, p) - 0.006, p, 0.012);
      neckPearls.push(at(q[0], q[1], q[2], ps * 0.9));
    }
  }
  for (let i = 0; i < p.necklaces; i++) {
    const depth = 0.02 + ((0.04 + 0.3 * p.pearlLength) * (i + 1)) / p.necklaces, w = 0.062 + 0.012 * i;
    const n = Math.max(12, Math.round((2 * w + 2 * depth) / 0.011));
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = w * Math.cos(Math.PI * t), y = Math.max(f.waistY + 0.03, f.neckY - 0.02 - depth * Math.sin(Math.PI * t));
      const sec = QC.torsoSection(y, p), rx = sec.rx + 0.012, rz = sec.rz + 0.012;
      const z = sec.cz + rz * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)) + (p.ruff > 0.01 && y > f.neckY - 0.03 ? 0.03 : 0);
      neckPearls.push(at(x, y, z, ps * 1.1));
    }
  }
  if (pearls.length) Q.add(instanced(PEARL, pearlMat(), pearls), { cloth: true });
  if (neckPearls.length) Q.add(instanced(PEARL, pearlMat(), neckPearls), UP);

  // ---- jewels scattered over the skirt (lower) and bodice (upper)
  const jewels = [], jcol = [], bj = [], bjcol = [], GEMC = ['#b3122b', '#1f4fa8', '#138a52', '#d4af37', '#f4efe6'].map(c => new THREE.Color(c));
  const nj = Math.round(p.jewelDensity * 700);
  if (nj > 0) {
    const rows = Math.max(3, Math.round(Math.sqrt(nj / 3))), per = Math.ceil(nj / rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < per; c++) {
      const v = (r + 0.5 + (R() - 0.5) * 0.5) / rows, th = ((c + 0.5 * (r % 2) + (R() - 0.5) * 0.4) / per) * TAU;
      if (gap && Math.abs(Math.atan2(Math.sin(th), Math.cos(th))) < QC.halfGap(v, p) + 0.05) continue;
      const q = outward(QC.skirtPoint(v, th, p), 0.007 + QC.foldAt(v, th, p));
      jewels.push(at(q[0], q[1] + 0.002, q[2], 0.0075 + 0.004 * R(), th, R())); jcol.push(GEMC[(r + c) % GEMC.length]);
    }
    for (let k = 0; k < Math.round(nj * 0.15); k++) {
      const phi = Math.PI + R() * TAU, y0 = QC.bodiceBottom(phi, p), y1 = QC.necklineTop(phi, p);
      if (y1 <= y0) continue;
      const q = QC.torsoPoint(phi, lerp(y0, y1, R()), p, 0.01); QC.pushOutsideSkirt(q, p, 0.012);
      bj.push(at(q[0], q[1], q[2], 0.006, phi)); bjcol.push(GEMC[k % GEMC.length]);
    }
  }
  const jewelMesh = (list, cols) => {
    const jm = instanced(JEWEL, new THREE.MeshPhysicalMaterial({ roughness: 0.12, metalness: 0.2, clearcoat: 1, emissive: '#331111', emissiveIntensity: 0.2 }), list);
    cols.forEach((c, i) => jm.setColorAt(i, c)); jm.instanceColor.needsUpdate = true; return jm;
  };
  if (jewels.length) Q.add(jewelMesh(jewels, jcol), { cloth: true });
  if (bj.length) Q.add(jewelMesh(bj, bjcol), UP);

  // ---- bows: échelle down the stomacher, and round the skirt
  if (p.stomacherBows > 0) {
    const yb = QC.bodiceBottom(0, p) + 0.035, yt = QC.necklineTop(0, p) - 0.025, n = p.stomacherBows, bows = [];
    for (let k = 0; k < n; k++) { const t = n === 1 ? 0.5 : k / (n - 1), q = QC.torsoPoint(0, lerp(yt, yb, t), p, 0.016); QC.pushOutsideSkirt(q, p, 0.016); bows.push(at(q[0], q[1], q[2], lerp(0.075, 0.04, t))); }
    Q.add(instanced(bowGeo(), satin(p.foreAccent), bows), UP);
  }
  if (p.bowsOnSkirt > 0) {
    const sb = [];
    for (let k = 0; k < p.bowsOnSkirt; k++) {
      const v = 0.45, g = gap ? QC.halfGap(v, p) + 0.15 : 0, th = gap ? lerp(g, QC.TAU - g, (k + 0.5) / p.bowsOnSkirt) : ((k + 0.5) / p.bowsOnSkirt) * TAU;
      const q = outward(QC.skirtPoint(v, th, p), 0.012 + QC.foldAt(v, th, p));
      sb.push(at(q[0], q[1], q[2], 0.08, th));
    }
    Q.add(instanced(bowGeo(), satin(p.gownAccent), sb), { cloth: true });
  }

  // ---- order sash: right shoulder to left hip, with a star on the hip
  if (p.sash > 0.01) {
    const yc = (f.shoulderY + f.waistY) / 2 - 0.03, A = (f.shoulderY - f.waistY) / 2 - 0.02, wd = 0.03 + 0.05 * p.sash;
    const m = QC.gridMesh(96, 3, (s, t) => {
      const phi = Math.PI + s * TAU, q = QC.torsoPoint(phi, yc - A * Math.sin(phi) + (t - 0.5) * wd, p, 0.013 + 0.02 * Math.abs(Math.sin(phi)) ** 6);
      QC.pushOutsideSkirt(q, p, 0.01); return [q[0], q[1], q[2], s * 8, t];
    });
    m.seam = true; Q.add(new THREE.Mesh(toGeom(m), satin(p.sashColor)), UP);
    const phi = 0.42 * Math.PI / 2, q = QC.torsoPoint(phi, yc - A * Math.sin(phi) - 0.01, p, 0.03); QC.pushOutsideSkirt(q, p, 0.03);
    const starShape = new THREE.Shape(Array.from({ length: 16 }, (_, k) => { const a = (k / 16) * TAU, r = k % 2 ? 0.016 : 0.04; return new THREE.Vector2(r * Math.sin(a), r * Math.cos(a)); }));
    const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.002, bevelSegments: 1 }),
      new THREE.MeshStandardMaterial({ color: '#eef1f6', metalness: 0.55, roughness: 0.25, emissive: '#3a3e46', emissiveIntensity: 0.6 }));
    star.position.set(...q); star.rotation.y = phi * 0.6;
    Q.add(star, UP);
  }

  // ---- regalia and the hand fan: built at the origin, carried by the hands (Queen.pose)
  const gm = goldMat(), [left, right] = Q.arms;   // arms[0] is side +1, arms[1] side -1, as hands[0]/hands[1] in the experiment
  if (p.sceptreOrb === 'sceptre' || p.sceptreOrb === 'both') {
    const g = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.78, 12), gm); rod.position.y = 0.24; g.add(rod);
    const knob = new THREE.Mesh(SPHERE, gm); knob.scale.setScalar(0.022); knob.position.y = 0.64; g.add(knob);
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.012), gm); c1.position.y = 0.68;
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.012), gm); c2.position.y = 0.69; g.add(c1, c2);
    const ruby = new THREE.Mesh(SPHERE, new THREE.MeshPhysicalMaterial({ color: '#b3122b', roughness: 0.1, clearcoat: 1 })); ruby.scale.setScalar(0.014); ruby.position.set(0, 0.64, 0.018); g.add(ruby);
    g.rotation.set(0.25, 0, 0.35); Q.add(g, UP); right.held.push({ obj: g, off: new THREE.Vector3(0, 0, 0) });
  }
  if (p.sceptreOrb === 'orb' || p.sceptreOrb === 'both') {
    const g = new THREE.Group(), ball = new THREE.Mesh(SPHERE, gm); ball.scale.setScalar(0.05); g.add(ball);
    const b1 = new THREE.Mesh(new THREE.TorusGeometry(0.051, 0.004, 6, 32), gm); b1.rotation.x = Math.PI / 2;
    const b2 = new THREE.Mesh(new THREE.TorusGeometry(0.051, 0.004, 6, 32, Math.PI), gm); b2.rotation.y = Math.PI / 2; g.add(b1, b2);
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.04, 0.008), gm); c1.position.y = 0.07;
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.008, 0.008), gm); c2.position.y = 0.075; g.add(c1, c2);
    Q.add(g, UP); left.held.push({ obj: g, off: new THREE.Vector3(0, 0.055, 0.01) });
  }
  if (p.handFan === 'on' && p.sceptreOrb !== 'both') {
    const A = p.sceptreOrb === 'orb' ? right : left;
    const ft = useTex(`fan|${p.gownAccent}`, () => canvasTex(256, 256, (g, W, H) => {
      g.fillStyle = '#f3ead8'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(80,60,40,0.45)'; g.lineWidth = 2;
      for (let a = 0; a < Math.PI; a += Math.PI / 16) { g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.cos(a) * W, H / 2 - Math.sin(a) * W); g.stroke(); }
      drawRose(g, W * 0.35, H * 0.3, 12, p.gownAccent); drawRose(g, W * 0.62, H * 0.27, 10, p.gownAccent);
    }));
    const fan = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.17, 24, 1, 0.15 * Math.PI, 0.7 * Math.PI), new THREE.MeshStandardMaterial({ map: ft, side: THREE.DoubleSide, roughness: 0.7 }));
    fan.rotation.set(-0.5, 0, Math.PI); Q.add(fan, UP); A.held.push({ obj: fan, off: new THREE.Vector3(0, -0.02, 0.03), fan: true });
  }
}

// ------------------------------------------------------------------ cloth motion
// The experiment's hem-lag shader (yaw + offset growing with the square of the drop below the waist, wind ripples,
// floor train drag) plus uFlare, a beat bounce that swells the skirt outwards.
const CLOTH_GLSL = /* glsl */`
uniform float uSwYaw; uniform vec2 uSwOff; uniform float uWaistY; uniform float uDrop; uniform float uTime; uniform float uWind; uniform vec2 uTrail; uniform float uFlare;
vec3 clothDisp(vec3 p) {
  float w = clamp((uWaistY - p.y) / uDrop, 0.0, 1.0); w *= w;
  float rr = length(p.xz);
  p.xz *= 1.0 + uFlare * w * smoothstep(0.0, 0.12, p.y);
  float a = uSwYaw * w, c = cos(a), s = sin(a);
  p.xz = vec2(c * p.x + s * p.z, -s * p.x + c * p.z);
  p.xz += uSwOff * w;
  float ph = atan(p.x, p.z);
  p.xz += uWind * w * vec2(0.035 * sin(uTime * 1.9 + ph * 3.0 + p.y * 6.0), 0.025 * cos(uTime * 1.4 + ph * 2.0 - p.y * 5.0) + 0.03);
  float tr = smoothstep(0.25, 1.2, rr) * (1.0 - smoothstep(0.0, 0.08, p.y));
  p.xz += uTrail * tr * rr;
  return p;
}`;
function clothify(mat, U) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + CLOTH_GLSL)
      .replace('#include <project_vertex>', `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition.xyz = clothDisp( mvPosition.xyz );
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'qcloth';
  mat.needsUpdate = true;
}

// ------------------------------------------------------------------ the Queen
const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, -1, 0), _z = new THREE.Vector3(0, 0, 1);
export class Queen {
  constructor(p) {
    const t0 = performance.now();
    this.p = p; const f = this.f = QC.figure(p);
    this.root = new THREE.Group();
    this.lower = new THREE.Group();
    this.upperPivot = new THREE.Group(); this.upperPivot.position.y = f.waistY;
    this.upper = new THREE.Group(); this.upper.position.y = -f.waistY; this.upperPivot.add(this.upper);
    this.headPivot = new THREE.Group(); this.headPivot.position.y = f.neckY + 0.01;
    this.head = new THREE.Group(); this.head.position.y = -(f.neckY + 0.01); this.headPivot.add(this.head);
    this.upper.add(this.headPivot);
    this.root.add(this.lower, this.upperPivot);
    this.U = { uSwYaw: { value: 0 }, uSwOff: { value: new THREE.Vector2() }, uWaistY: { value: f.waistY }, uDrop: { value: f.waistY - QC.HEM_Y }, uTime: { value: 0 }, uWind: { value: 0.15 }, uTrail: { value: new THREE.Vector2() }, uFlare: { value: 0 } };
    this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    clothify(this.depthMat, this.U);
    buildBody(this, p, f); buildGown(this, p, f); buildDetails(this, p, f);
    this.buildMs = performance.now() - t0;
  }
  add(obj, o = {}) {
    obj.traverse(m => { if (m.isMesh) { m.castShadow = o.shadow !== false; m.receiveShadow = true; } });
    if (o.cloth) obj.traverse(m => { if (m.material) { for (const mt of [].concat(m.material)) clothify(mt, this.U); if (m.isMesh) m.customDepthMaterial = this.depthMat; } });
    (o.part === 'head' ? this.head : o.part === 'upper' ? this.upper : this.lower).add(obj);
    return obj;
  }
  dispose() {
    const seen = new Set();
    this.root.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !o.geometry.userData.shared && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      for (const m of [].concat(o.material || [])) { if (seen.has(m)) continue; seen.add(m); if (m.map) m.map.dispose(); m.dispose(); }
    });
    this.depthMat.dispose();
    this.root.removeFromParent();
  }
  // pose: { arms: [{ pts: [5 x [x,y,z]] } x2], head: {pitch, roll, yaw}, upper: {roll, pitch, dip}, mouth, cloth: {...} }
  pose(P) {
    const p = this.p;
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i], pts = P.arms[i].map(a => new THREE.Vector3(a[0], a[1], a[2]));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      A.tube.update(curve, 0, 1, QC.armRadius, A.side);
      A.sleeve.update(curve, 0, A.sleeveL, t => QC.sleeveRadius(t, p), A.side, 1 / this.mats.tile, A.drop);
      const end = curve.getPointAt(1), tan = curve.getTangentAt(1);
      const hp = end.clone().addScaledVector(tan, 0.03);
      A.hand.position.copy(hp); A.hand.quaternion.setFromUnitVectors(_z, tan);   // the hand blob's long axis (z) along the forearm
      if (A.cones.length) {
        const Pc = curve.getPointAt(A.sleeveL), T = curve.getTangentAt(A.sleeveL);
        if (A.drop) Pc.y -= A.drop(A.sleeveL);
        _d.copy(T).multiplyScalar(0.35).add(_t.set(0, -1, -0.25)).normalize();
        for (const c of A.cones) {
          c.mesh.quaternion.setFromUnitVectors(_up, _d);
          c.mesh.position.copy(Pc).addScaledVector(_d, c.len / 2 - 0.01 + 0.012 * c.k);
        }
      }
      for (const h of A.held) h.obj.position.copy(hp).add(h.off);
    }
    const H = P.head, Up = P.upper;
    this.headPivot.rotation.set(H.pitch, H.yaw, H.roll, 'YXZ');
    this.upperPivot.rotation.set(Up.pitch, Up.yaw || 0, Up.roll, 'YXZ');
    this.upperPivot.position.y = this.f.waistY + (Up.dip || 0);
    this.mouth.scale.y = 0.002 + 0.009 * P.mouth;
    const U = this.U, C = P.cloth;
    U.uSwYaw.value = C.yaw; U.uSwOff.value.set(C.ox, C.oz); U.uTime.value = C.time; U.uWind.value = C.wind; U.uTrail.value.set(C.tx, C.tz); U.uFlare.value = C.flare;
  }
}
