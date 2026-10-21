// torus.js: the "Amiga Torus" shooter (assets/3d-torus-shooter/index.html) as a scene: a raymarched faceted torus with
// a 24×12 red/white checker, the ten flying shapes (meshes) that stick to it or bore holes through it, and a Pacman.
// Everything is a pure function of song time: shapes are scheduled on beats, kills on onset peaks.
// Modes:
//   torus    the checkered torus tumbling, shapes fly in on the beat and stick to it, camera drifting
//   shooter  shapes fired at the torus on the beat bore holes through it (it gets more perforated over the shot),
//            some stick, some bounce off; a Pacman walks the surface now and then
//   shapes   the ten shapes alone in a formation that changes every bar, spinning and pulsing on the beat
//   tunnel   the camera flies inside the tube along the major circle, shapes streaming past
//   swarm    hundreds of small shapes streaming around the torus on torus-knot paths; onsets kill some
//            (they burst), more appear ("kill one process, ten survive")
// variant: v % 4 = colour scheme (0 classic red/white, 1 inverted, 2 black/white, 3 blue/gold);
//          floor(v / 4) % 11 = shape mix (0 all ten, 1..10 only that shape: cube, cylinder, dodeca, sphere, tetra,
//          stella octangula, cross, great icosa, icosidodeca, small stellated dodeca).
import * as THREE from 'three';
import { shapeGeometries, makePacman, makeMouthStrip, makeSphere, toGeometry } from './torus/geom.js';
import { MS, MC, RM_VS, RM_FS, MESH_VS, MESH_FS } from './torus/shaders.js';
import { BEAT, BEAT0, RMS, ONSET, FPS_DATA } from '../audio.js';

export const meta = { modes: ['torus', 'shooter', 'shapes', 'tunnel', 'swarm'], variants: 44 };

const TAU = Math.PI * 2, CAP = 1400;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const easeOut = x => 1 - Math.pow(1 - clamp(x), 3);
const hash = (a, b = 0, c = 0) => {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x632be5ab, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

// ── audio helpers (pure functions of song time) ──
const sample = (arr, t) => { const f = t * FPS_DATA, i = Math.max(0, Math.min(arr.length - 2, Math.floor(f))), k = clamp(f - i); return arr[i] * (1 - k) + arr[i + 1] * k; };
const energyAt = t => { let s = 0; for (let k = -4; k <= 4; k++) s += sample(RMS, Math.max(0, t + k * 0.0625)); return s / 9; };
const EVENTS = (() => {   // onset peaks: [time, strength]
  const ev = []; let last = -1;
  for (let i = 1; i < ONSET.length - 1; i++) {
    const o = ONSET[i];
    if (o > 0.45 && o >= ONSET[i - 1] && o > ONSET[i + 1] && i / FPS_DATA - last > 0.11) { ev.push([i / FPS_DATA, o]); last = i / FPS_DATA; }
  }
  return ev;
})();
const evCount = t => { let a = 0, b = EVENTS.length; while (a < b) { const m = (a + b) >> 1; if (EVENTS[m][0] <= t) a = m + 1; else b = m; } return a; };
const CUM = (() => { const c = new Float32Array(RMS.length + 1); for (let i = 0; i < RMS.length; i++) c[i + 1] = c[i] + RMS[i] / FPS_DATA; return c; })();
const cumAt = t => { const f = clamp(t * FPS_DATA, 0, RMS.length - 1), i = Math.floor(f); return CUM[i] + (CUM[i + 1] - CUM[i]) * (f - i); };
const beatX = t => (t - BEAT0) / BEAT;   // beats since the first beat (fractional)
const beatKick = t => { const x = beatX(t), i = Math.floor(x); return i + easeOut((x - i) * 2.5); };   // steps forward on every beat

// ── colour schemes: c = full colour, d = tuned for the 1-bit dither (luma is what counts) ──
const g = v => [v, v, v];
const PALS = [
  { // 0 classic Amiga red/white on blue
    c: { A: [.85, .05, .05], B: [1, 1, 1], carve: [.28, .05, .04], stuck: [.9, .15, .1], fly: [[.9, .15, .1], [.2, .4, 1], [.15, .8, .2]],
      shapes: [[.9, .15, .1], [.95, .95, .95], [.2, .4, 1]], bgTop: [0, .2, .4], bgBot: [0, .03, .1], grid: [.6, .2, .8],
      amb: .15, diff: .75, spec: .35, rim: .3, rimCol: [.5, .7, 1], pac: [1, .85, 0] },
    d: { A: g(.07), B: g(.85), carve: g(0), stuck: g(1), stkEm: .45, fill: .35, fly: [g(1), g(.8), g(.62)], shapes: [g(.62), g(1), g(.8)], bgTop: g(0), bgBot: g(0), grid: g(.55),
      amb: .04, diff: 1.3, spec: .9, rim: .55, rimCol: g(1), pac: g(1) },
  },
  { // 1 inverted: dark torus on white
    c: { A: [.04, .04, .06], B: [.88, .08, .06], carve: [.9, .9, .9], stuck: [1, 1, 1], fly: [[.05, .05, .07], [.9, .1, .08], [.2, .4, 1]],
      shapes: [[.05, .05, .07], [.9, .1, .08], [.95, .95, .95]], bgTop: [.97, .97, 1], bgBot: [.78, .8, .88], grid: [.2, .2, .45],
      amb: .3, diff: .7, spec: .6, rim: 0, rimCol: [0, 0, 0], pac: [1, .8, 0] },
    d: { A: g(0), B: g(.4), carve: g(1), stuck: g(1), fly: [g(0), g(.35), g(.65)], shapes: [g(0), g(.35), g(.6)], bgTop: g(1), bgBot: g(1), grid: g(0),
      amb: .25, diff: .8, spec: .9, rim: 0, rimCol: g(0), pac: g(.35) },
  },
  { // 2 black/white
    c: { A: [.05, .05, .05], B: [.95, .95, .95], carve: [.02, .02, .02], stuck: [.55, .55, .55], fly: [[1, 1, 1], [.55, .55, .55], [.8, .8, .8]],
      shapes: [[.95, .95, .95], [.5, .5, .5], [.12, .12, .12]], bgTop: [.14, .14, .14], bgBot: [0, 0, 0], grid: [.5, .5, .5],
      amb: .12, diff: .85, spec: .6, rim: .45, rimCol: [1, 1, 1], pac: [1, 1, 1] },
    d: { A: g(.06), B: g(1), carve: g(0), stuck: g(.6), stkEm: .2, fill: .3, fly: [g(1), g(.6), g(.8)], shapes: [g(1), g(.55), g(.3)], bgTop: g(0), bgBot: g(0), grid: g(.5),
      amb: .04, diff: 1.0, spec: .9, rim: .6, rimCol: g(1), pac: g(1) },
  },
  { // 3 blue/gold copper
    c: { A: [.08, .2, .8], B: [1, .82, .2], carve: [.25, .03, .3], stuck: [.95, .25, .7], fly: [[.95, .25, .7], [.2, .9, 1], [1, 1, 1]],
      shapes: [[1, .82, .2], [.95, .25, .7], [.2, .9, 1]], bgTop: [.22, 0, .3], bgBot: [0, 0, .05], grid: [1, .45, 0],
      amb: .15, diff: .8, spec: .45, rim: .35, rimCol: [1, .5, .9], pac: [1, .9, .1] },
    d: { A: g(.85), B: g(.07), carve: g(0), stuck: g(1), stkEm: .45, fill: .35, fly: [g(.85), g(1), g(.7)], shapes: [g(1), g(.62), g(.85)], bgTop: g(0), bgBot: g(0), grid: g(.55),
      amb: .04, diff: 1.3, spec: .9, rim: .55, rimCol: g(1), pac: g(1) },
  },
];

const V3 = () => new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = V3(), _v2 = V3(), _v3 = V3();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const randAxis = (a, b, out) => { const z = hash(a, b, 91) * 2 - 1, th = hash(a, b, 92) * TAU, r = Math.sqrt(1 - z * z); return out.set(r * Math.cos(th), r * Math.sin(th), z); };

// smooth torus SDF (R = 1, r = 0.4) for CPU-side aiming / occlusion
const torusSDF = (x, y, z) => { const q = Math.hypot(x, y) - 1; return Math.hypot(q, z) - 0.4; };
const surf = (th, ph, out, nOut, lift = 0) => {
  const c = Math.cos(ph), s = Math.sin(ph);
  nOut.set(c * Math.cos(th), c * Math.sin(th), s);
  return out.set(Math.cos(th), Math.sin(th), 0).addScaledVector(nOut, 0.4 + lift);
};

// torus placement per mode as a pure function of (song time, shot start)
function torusXf(mode, t, t0, seed, xf) {
  const lt = t - t0;
  xf.p.set(0, 0, 0); xf.s = 1;
  if (mode === 'tunnel') { xf.q.identity(); return xf; }
  let ax, ay;
  if (mode === 'shooter') {   // a target wheel: mostly facing the gun, wobbling, spinning about its own axis
    xf.p.set(0, 0.2, 0);
    xf.q.setFromAxisAngle(AX, 0.55 + 0.35 * Math.sin(0.23 * lt + seed)).multiply(_q2.setFromAxisAngle(AY, 0.45 * Math.sin(0.17 * lt + 2 * seed)))
      .multiply(_q2.setFromAxisAngle(AZ, 0.3 * lt + 0.06 * beatKick(t)));
    return xf;
  }
  else if (mode === 'swarm') { ax = 0.21 * lt + 0.9 + seed; ay = 0.33 * lt + 0.08 * beatKick(t); xf.s = 0.85; }
  else { ax = 0.32 * lt + 0.25 * Math.sin(lt * 0.37) + seed; ay = 0.45 * lt + 0.12 * beatKick(t); xf.p.set(0, 0.15, 0); }
  xf.q.setFromAxisAngle(AX, ax).multiply(_q2.setFromAxisAngle(AY, ay));
  return xf;
}
const toWorld = (xf, lp, out) => out.copy(lp).multiplyScalar(xf.s).applyQuaternion(xf.q).add(xf.p);
const toLocal = (xf, wp, out) => out.copy(wp).sub(xf.p).applyQuaternion(_q.copy(xf.q).invert()).multiplyScalar(1 / xf.s);

export async function create({ width, height }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.02, 80);

  // ── raymarched torus + background (one fullscreen pass, writes depth) ──
  const arr = (n, f) => Array.from({ length: n }, f);
  const RU = {
    uCamPos: { value: V3() }, uCamRot: { value: new THREE.Matrix3() }, uTanFov: { value: Math.tan(Math.PI / 8) }, uAsp: { value: width / height },
    uTR: { value: new THREE.Matrix3() }, uTRi: { value: new THREE.Matrix3() }, uTP: { value: V3() }, uTS: { value: 1 }, uViewProj: { value: new THREE.Matrix4() },
    uShow: { value: 1 }, uInside: { value: 0 },
    uColA: { value: V3() }, uColB: { value: V3() }, uCarveCol: { value: V3() }, uSpecCol: { value: V3() }, uRimCol: { value: V3() }, uFogCol: { value: V3() },
    uBgTop: { value: V3() }, uBgBot: { value: V3() }, uGridCol: { value: V3() }, uGrid: { value: 0 }, uGridY: { value: -2 },
    uLightL: { value: V3() }, uAmb: { value: .15 }, uDiff: { value: .75 }, uSpec: { value: .35 }, uRim: { value: 0 }, uFog: { value: 0 }, uHeadK: { value: 1 }, uHeadI: { value: 1 }, uStkEm: { value: 0 }, uFill: { value: 0 }, uChkSub: { value: 1 },
    uStk: { value: arr(MS, () => new THREE.Vector4()) }, uStkB: { value: arr(MS, () => new THREE.Vector4()) }, uStkC: { value: arr(MS, V3) }, uNStk: { value: 0 },
    uCrA: { value: arr(MC, () => new THREE.Vector4()) }, uCrB: { value: arr(MC, () => new THREE.Vector4()) }, uCrC: { value: arr(MC, () => new THREE.Vector2()) },
    uCrR: { value: arr(MC, () => new THREE.Matrix3()) }, uNCrv: { value: 0 },
  };
  const rmMat = new THREE.ShaderMaterial({ vertexShader: RM_VS, fragmentShader: RM_FS, uniforms: RU, depthTest: true, depthWrite: true });
  rmMat.extensions = { derivatives: true, fragDepth: true };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), rmMat);
  quad.frustumCulled = false; quad.renderOrder = -10; scene.add(quad);

  // ── lit mesh material (shared uniforms) ──
  const MU = {
    uLight: { value: V3() }, uSpecCol: RU.uSpecCol, uRimCol: RU.uRimCol, uFogCol: RU.uFogCol, uCamPos: RU.uCamPos, uChkA: RU.uColA, uChkB: RU.uColB,
    uAmb: RU.uAmb, uFill: RU.uFill, uDiff: RU.uDiff, uSpec: RU.uSpec, uRim: RU.uRim, uFog: RU.uFog, uHead: { value: 0 }, uHeadK: RU.uHeadK, uHeadI: RU.uHeadI,
  };
  const meshMat = (tint, flat = 0) => new THREE.ShaderMaterial({
    vertexShader: MESH_VS, fragmentShader: MESH_FS, side: THREE.DoubleSide,
    uniforms: { ...MU, uTint: { value: new THREE.Vector3(...tint) }, uFlat: { value: flat } },
  });
  const shapeMat = meshMat([1, 1, 1]);
  const geoms = shapeGeometries(THREE);
  const inst = geoms.map(g0 => {
    const gi = g0.clone();
    gi.setAttribute('iCheck', new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1));
    const m = new THREE.InstancedMesh(gi, shapeMat, CAP);
    m.frustumCulled = false; m.count = 0;
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(m); return m;
  });
  const cnt = new Array(10).fill(0);
  const _M = new THREE.Matrix4(), _S = V3();
  function put(type, pos, quat, scale, col, chk = 0) {
    const m = inst[type], i = cnt[type];
    if (i >= CAP || scale <= 0.0005) return;
    _M.compose(pos, quat, _S.set(scale, scale, scale));
    m.setMatrixAt(i, _M); m.instanceColor.setXYZ(i, col[0], col[1], col[2]);
    m.geometry.attributes.iCheck.array[i] = chk;
    cnt[type]++;
  }
  function flush() {
    inst.forEach((m, k) => {
      m.count = cnt[k];
      if (cnt[k]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; m.geometry.attributes.iCheck.needsUpdate = true; }
    });
  }

  // ── Pacman (body with three mouth openings for chomping, eyes, expression mouths) ──
  const withChk = g0 => { g0.setAttribute('iCheck', new THREE.Float32BufferAttribute(new Float32Array(g0.attributes.position.count), 1)); return g0; };
  const pacMats = { body: meshMat([1, .85, 0], 0.75), eye: meshMat([1, 1, 1], 0.6), mouth: meshMat([0, 0, 0], 1) };
  const pac = new THREE.Group(); pac.matrixAutoUpdate = false; scene.add(pac);
  const pacBodies = [Math.PI / 7, Math.PI / 4.5, Math.PI / 3.2].map(a => { const m = new THREE.Mesh(withChk(toGeometry(THREE, makePacman(0.2, 16, 24, a))), pacMats.body); pac.add(m); return m; });
  const eyeG = withChk(toGeometry(THREE, makeSphere(0.035, 8, 10)));
  for (const z of [-0.08, 0.08]) { const e = new THREE.Mesh(eyeG, pacMats.eye); e.position.set(0.15, 0.09, z); pac.add(e); }
  const pacMouths = [0, 0.04, -0.04].map(c => { const m = new THREE.Mesh(withChk(toGeometry(THREE, makeMouthStrip(0.2, 12, 0.07, c))), pacMats.mouth); pac.add(m); return m; });
  pac.traverse(o => { o.frustumCulled = false; });

  // ── per-frame helpers ──
  let nS = 0, nC = 0;
  const SDF_K = [1, 1, 1, 1, 0.62, 0.62, 1, 1, 1, 1];   // tetra-based SDFs are 3× their size parameter; match the meshes
  function addStuck(lp, type, size, flash, col) {
    if (nS >= MS) return;
    size *= SDF_K[type];
    RU.uStk.value[nS].set(lp.x, lp.y, lp.z, type); RU.uStkB.value[nS].set(size, flash, 0, 0); RU.uStkC.value[nS].set(col[0], col[1], col[2]); nS++;
  }
  const _a = V3(), _b = V3();
  function addCarve(lc, ldir, type, size, s0, s1, roll) {
    if (nC >= MC) return;
    size *= SDF_K[type];
    RU.uCrA.value[nC].set(lc.x, lc.y, lc.z, type); RU.uCrB.value[nC].set(ldir.x, ldir.y, ldir.z, size); RU.uCrC.value[nC].set(s0, s1);
    _a.copy(Math.abs(ldir.y) < 0.9 ? AY : AX).cross(ldir).normalize(); _b.copy(ldir).cross(_a);
    const c = Math.cos(roll), s = Math.sin(roll);
    const ax = _a.x * c + _b.x * s, ay = _a.y * c + _b.y * s, az = _a.z * c + _b.z * s, bx = -_a.x * s + _b.x * c, by = -_a.y * s + _b.y * c, bz = -_a.z * s + _b.z * c;
    RU.uCrR.value[nC].set(ax, ay, az, ldir.x, ldir.y, ldir.z, bx, by, bz);   // shape y axis along the bore
    nC++;
  }
  const setV = (u, c) => u.value.set(c[0], c[1], c[2]);
  function applyPalette(P) {
    setV(RU.uColA, P.A); setV(RU.uColB, P.B); setV(RU.uCarveCol, P.carve); setV(RU.uBgTop, P.bgTop); setV(RU.uBgBot, P.bgBot); setV(RU.uGridCol, P.grid);
    setV(RU.uRimCol, P.rimCol); RU.uSpecCol.value.set(1, 1, 1); setV(RU.uFogCol, P.bgBot);
    RU.uAmb.value = P.amb; RU.uDiff.value = P.diff; RU.uSpec.value = P.spec; RU.uRim.value = P.rim; RU.uFog.value = 0; RU.uGrid.value = 0;
    RU.uHeadK.value = 1; RU.uHeadI.value = 1; MU.uHead.value = 0; shapeMat.uniforms.uFlat.value = 0; RU.uStkEm.value = P.stkEm ?? 0; RU.uFill.value = P.fill ?? 0.12; RU.uChkSub.value = 1;
    pacMats.body.uniforms.uTint.value.set(...P.pac);
  }

  const xf = { q: new THREE.Quaternion(), p: V3(), s: 1 }, xf2 = { q: new THREE.Quaternion(), p: V3(), s: 1 };
  const camPos = V3(), camTgt = V3(), camUp = V3();
  const lp = V3(), ln = V3(), wp = V3(), wp2 = V3(), dir = V3(), gun = V3();
  const qa = new THREE.Quaternion();

  // ───────────────────────── modes ─────────────────────────
  // Common beat bookkeeping from the shot: beat k happens at song time beatT(k).
  function beats(t, shot) {
    const P = shot.beat.period, bx = shot.beat.index + shot.beat.phase;
    return { P, bx, beatT: k => t - (bx - k) * P, k0: Math.ceil(bx - shot.lt / P - 1e-6), kNow: shot.beat.index };
  }

  function modeTorus(t, shot, ctx) {
    const { pal, seed, shapeOf } = ctx, lt = shot.lt, t0 = t - lt;
    // camera drifting on a slow orbit
    const a = 0.11 * lt + seed * 2.1, d = 5.3 - 0.5 * Math.sin(lt * 0.07);
    camPos.set(Math.sin(a) * d, 0.35 + 0.7 * Math.sin(lt * 0.13 + seed), Math.cos(a) * d); camTgt.set(0, 0.02, 0); camUp.set(0, 1, 0);
    torusXf('torus', t, t0, seed, xf); xf.s = 1 + 0.035 * shot.beat.pulse;
    const B = beats(t, shot), D = 2;   // shapes fly for two beats and land on the beat
    const landed = [];
    for (let k = B.k0 - 14; k <= B.kNow + D; k++) {
      const tl = B.beatT(k), tf = tl - D * B.P;
      if (t < tf) continue;
      const n = 1 + (energyAt(tl) > 0.26 ? 1 : 0) + (((k % 4) + 4) % 4 === 0 ? 1 : 0);
      for (let j = 0; j < n; j++) {
        const type = shapeOf(Math.floor(hash(k, j, 7 + seed) * 10));
        surf(hash(k, j, 1 + seed) * TAU, hash(k, j, 2 + seed) * TAU, lp, ln, 0.05);
        if (t < tl) {   // in flight: from around the camera to the moving landing point
          if (k < B.k0) continue;
          const u = (t - tf) / (tl - tf);
          torusXf('torus', tf, t0, seed, xf2);
          // spawn just outside the frame edges, a little nearer the camera than the torus
          const ang = hash(k, j, 41 + seed) * TAU, fw = _v.copy(camTgt).sub(camPos).normalize(), rt = _v3.crossVectors(fw, AY).normalize();
          _v2.copy(xf2.p).addScaledVector(rt, Math.cos(ang) * 5.2).addScaledVector(AY, Math.sin(ang) * 3.2).addScaledVector(fw, -1.5 - hash(k, j, 42) * 1.5);
          toWorld(xf, lp, wp);
          wp2.lerpVectors(_v2, wp, Math.pow(u, 1.6));
          wp2.y += Math.sin(Math.PI * u) * 0.6 * (hash(k, j, 5) - 0.5);
          qa.setFromAxisAngle(randAxis(k, j, _v3), 7 * (tl - t)); qa.premultiply(xf.q);
          put(type, wp2, qa, xf.s * (1 + 0.6 * (1 - u)), pal.stuck);
        } else landed.push({ k, j, tl, type, lp: lp.clone() });
      }
    }
    // the newest MS stay stuck; the oldest get absorbed (shrink) as new ones land
    const nL = landed.length;
    for (let i = Math.max(0, nL - MS); i < nL; i++) {
      const L = landed[i], r = nL - 1 - i, age = t - L.tl;
      const absorb = clamp((MS - r) / 6), pop = 1 + 0.7 * Math.exp(-age * 9);
      addStuck(L.lp, L.type, 0.125 * absorb * pop, Math.exp(-age * 5), pal.stuck);
    }
  }

  function gunAt(k, tf, seed) {   // projectiles come from the lower screen corners (just outside the frame)
    const side = hash(k, 3, seed) < 0.5 ? -1 : 1;
    shooterCam(tf - ctxT0, seed); // sets camPos
    return gun.set(camPos.x + side * (0.9 + 0.6 * hash(k, 4, seed)), camPos.y - 0.9 - 0.3 * hash(k, 5, seed), camPos.z - 0.6);
  }
  let ctxT0 = 0;
  function shooterCam(lt, seed) {
    camPos.set(0.7 * Math.sin(lt * 0.11 + seed), 0.4 + 0.25 * Math.sin(lt * 0.17), 6.1 + 0.3 * Math.sin(lt * 0.05)); camTgt.set(0, 0.05, 0); camUp.set(0, 1, 0);
  }
  function pickTarget(k, ti, t0, seed, gunP, outLp, outLn, outW) {
    torusXf('shooter', ti, t0, seed, xf2);
    let best = -9;
    const cl = V3(), cn = V3(), cw = V3(), loc = V3(), gl = toLocal(xf2, gunP, V3());
    for (let c = 0; c < 10; c++) {
      surf(hash(k, c, 11 + seed) * TAU, hash(k, c, 12 + seed) * TAU, cl, cn, 0);
      toWorld(xf2, cl, cw);
      const nw = _v.copy(cn).applyQuaternion(xf2.q), tg = _v2.copy(gunP).sub(cw).normalize();
      let score = nw.dot(tg);
      if (score < 0.6) continue;
      let occ = false;
      for (let s = 1; s < 24 && !occ; s++) { loc.lerpVectors(gl, cl, s / 24 * 0.96); if (torusSDF(loc.x, loc.y, loc.z) < 0) occ = true; }
      if (occ) continue;
      score -= 0.08 * Math.abs(cw.x) + 0.1 * Math.max(0, -cw.y);   // prefer the middle / upper part of the frame
      if (score > best) { best = score; outLp.copy(cl); outLn.copy(cn); outW.copy(cw); }
    }
    if (best === -9) { surf(0, 0, outLp, outLn, 0); toWorld(xf2, outLp, outW); }
  }

  function modeShooter(t, shot, ctx) {
    const { pal, seed, shapeOf } = ctx, lt = shot.lt, t0 = t - lt; ctxT0 = t0;
    torusXf('shooter', t, t0, seed, xf);
    const B = beats(t, shot), D = 1.5, stuck = [], carves = [];
    let lastEvt = null;
    for (let k = B.k0 - 1; k <= B.kNow + 2; k++) {
      const ti = B.beatT(k), tf = ti - D * B.P;
      if (t < tf || ti < t0 - 0.2) continue;
      const km = ((k % 4) + 4) % 4, kind = km === 2 ? 'stick' : (hash(k, 9, seed) < 0.16 ? 'bounce' : 'carve');
      const type = shapeOf(Math.floor(hash(k, 8, seed) * 10));
      const G = gunAt(k, tf, seed).clone();
      const tl = V3(), tn = V3(), tw = V3(); pickTarget(k, ti, t0, seed, G, tl, tn, tw);
      dir.copy(tw).sub(G); const dist = dir.length(); dir.multiplyScalar(1 / dist);
      const speed = dist / (ti - tf), col = pal.fly[kind === 'stick' ? 0 : kind === 'carve' ? 1 : 2];
      qa.setFromAxisAngle(randAxis(k, 1, _v3), 5 * (t - tf) + hash(k, 2) * 6);
      if (t < ti) { put(type, wp.copy(G).addScaledVector(dir, speed * (t - tf)), qa, 1, col); continue; }
      const age = t - ti;
      if (kind === 'carve') {
        torusXf('shooter', ti, t0, seed, xf2);
        const lc = toLocal(xf2, tw, V3()), ldir = V3().copy(dir).applyQuaternion(_q.copy(xf2.q).invert());
        const size = (0.13 + 0.07 * hash(k, 6, seed)) * (0.85 + 0.45 * shot.p);
        carves.push({ ti, lc, ldir, type, size, s1: Math.min(1.3, -0.05 + age * speed), roll: hash(k, 7, seed) * TAU });
        if (age < 1.6) put(type, wp.copy(tw).addScaledVector(dir, speed * age), qa, 1, col);   // flies on through the hole
      } else if (kind === 'stick') {
        stuck.push({ ti, lp: tl.clone().addScaledVector(tn, 0.05), type, age });
      } else if (age < 2.2) {   // bounce off with half the speed and fall
        torusXf('shooter', ti, t0, seed, xf2);
        const nw = _v.copy(tn).applyQuaternion(xf2.q), vv = _v2.copy(dir).multiplyScalar(speed);
        vv.addScaledVector(nw, -2 * vv.dot(nw)).multiplyScalar(0.5);
        wp.copy(tw).addScaledVector(nw, 0.15).addScaledVector(vv, age); wp.y -= 2.5 * age * age;
        qa.setFromAxisAngle(randAxis(k, 1, _v3), 14 * age + 5 * D * B.P);
        put(type, wp, qa, 1, col);
      }
      if (age < 1.5) lastEvt = kind;
    }
    // heal the oldest holes when over capacity, carves eat nearby stuck shapes
    const c0 = Math.max(0, carves.length - MC);
    for (let i = c0; i < carves.length; i++) { const C = carves[i]; addCarve(C.lc, C.ldir, C.type, C.size, -0.3, C.s1, C.roll); }
    for (const S of stuck) {
      if (carves.some(C => C.ti > S.ti && t > C.ti && C.lc.distanceTo(S.lp) < 0.28)) continue;
      addStuck(S.lp, S.type, 0.125 * (1 + 0.4 * Math.exp(-S.age * 9)), Math.exp(-S.age * 5), pal.stuck);
    }
    // Pacman: now and then crosses the frame in front of the torus, chomping on the beat
    const win = 8 * B.P, w = Math.floor(lt / win), wl = lt - w * win;
    if (w % 2 === 1 && hash(w, 77, seed) < 0.75) {
      const u = wl / win, dirX = hash(w, 79, seed) < 0.5 ? 1 : -1;
      const pacS = 2.3;
      wp.set(dirX * (-4.2 + 8.4 * u), 0.2 + 0.9 * (hash(w, 78, seed) - 0.5) + 0.12 * Math.abs(Math.sin(Math.PI * shot.beat.phase)), 1.6);
      qa.setFromAxisAngle(AY, dirX > 0 ? 0 : Math.PI);
      pac.matrix.compose(wp, qa, _S.set(pacS, pacS, pacS)); pac.matrixWorldNeedsUpdate = true; pac.visible = true;
      const ph2 = shot.beat.phase, open = ph2 < 0.15 ? 2 : ph2 < 0.35 ? 1 : ph2 < 0.6 ? 0 : ph2 < 0.8 ? 1 : 2;
      pacBodies.forEach((m, i) => { m.visible = i === open; });
      const expr = lastEvt === 'carve' ? 1 : lastEvt === 'stick' ? 2 : 0;
      pacMouths.forEach((m, i) => { m.visible = i === expr; });
    }
    shooterCam(lt, seed);
    camPos.x += (hash(Math.floor(t * 30), 1) - 0.5) * 0.03 * shot.onset; camPos.y += (hash(Math.floor(t * 30), 2) - 0.5) * 0.03 * shot.onset;
  }

  const FORMS = 7;
  function formation(f, i, lt, out) {
    const a = i / 10 * TAU, rot = lt * 0.25;
    switch (f) {
      case 0: return out.set(3.0 * Math.cos(a + rot), 3.0 * Math.sin(a + rot) * 0.82, 0);              // ring facing the camera
      case 1: return out.set(((i % 5) - 2) * 2.25, (Math.floor(i / 5) - 0.5) * -2.3, 0);                // 5×2 grid
      case 2: return out.set(3.6 * Math.cos(a + rot), -0.2 + 0.3 * Math.sin(a * 2 + lt), 3.6 * Math.sin(a + rot));   // carousel
      case 3: return out.set((i - 4.5) * 1.3, 1.0 * Math.sin(i * 0.9 + lt * 3), 0);                    // wave
      case 4: { const r = i % 2 ? 1.35 : 3.2, b = a + rot * 0.6; return out.set(r * Math.cos(b), r * Math.sin(b) * 0.85, 0); }   // star
      case 5: { const b = i * 0.75 + rot * 2; return out.set(2.4 * Math.cos(b), (i - 4.5) * 0.5, 2.4 * Math.sin(b)); }        // helix
      default: { const y = 1 - (i + 0.5) / 5, r = Math.sqrt(Math.max(0, 1 - y * y)), b = i * 2.39996 + rot; return out.set(2.6 * r * Math.cos(b), 2.4 * y, 2.6 * r * Math.sin(b)); }   // sphere
    }
  }
  function modeShapes(t, shot, ctx) {
    const { pal, seed, shapeOf, dith } = ctx, lt = shot.lt;
    RU.uShow.value = 0; RU.uGrid.value = 1; RU.uGridY.value = -2.7;
    if (dith) setV(RU.uGridCol, pal.bgBot[0] < 0.5 ? [1, 1, 1] : [0, 0, 0]);
    camPos.set(1.6 * Math.sin(lt * 0.1 + seed), 0.9 + 0.35 * Math.sin(lt * 0.13), 9.6 - 0.4 * Math.sin(lt * 0.07)); camTgt.set(0, 0.25, 0); camUp.set(0, 1, 0);
    const bar = shot.beat.bar, form = b => { let f = Math.floor(hash(b, 5, seed) * FORMS); if (b > 0 && f === Math.floor(hash(b - 1, 5, seed) * FORMS)) f = (f + 1) % FORMS; return f; };
    const fA = form(bar - 1), fB = form(bar), k = easeOut(shot.beat.barPhase / 0.3);
    const B = beats(t, shot), kick = (B.kNow - B.k0) + easeOut(shot.beat.phase * 2.5);
    for (let i = 0; i < 10; i++) {
      formation(fA, i, lt, _v); formation(fB, i, lt, _v2); wp.lerpVectors(_v, _v2, k); wp.y += 0.25;
      wp.y += 0.35 * Math.sin(Math.PI * k) * (i % 2 ? 1 : -1);   // hop during the change
      const type = shapeOf(i), feat = ((B.kNow % 10) + 10) % 10 === i;
      const s = 3.3 * (1 + 0.16 * shot.beat.pulse + (feat ? 0.35 * shot.beat.pulse : 0));
      qa.setFromAxisAngle(randAxis(i, seed, _v3), 0.5 * lt + 0.55 * kick + i);
      const chk = i % 3 === 0 ? 1 : 0, col = feat && shot.beat.pulse > 0.5 ? [1.25, 1.25, 1.25] : chk ? [1, 1, 1] : pal.shapes[i % 3];
      put(type, wp, qa, s * (type === 3 ? 1.5 : 1), col, chk);
    }
    if (dith) RU.uGrid.value = 0.9;
  }

  function modeTunnel(t, shot, ctx) {
    const { pal, seed, shapeOf, dith } = ctx, lt = shot.lt, t0 = t - lt;
    torusXf('tunnel', t, t0, seed, xf);
    RU.uInside.value = 1; RU.uRim.value = 0; RU.uFog.value = 0.35; RU.uHeadK.value = 4; RU.uHeadI.value = (dith ? 2.6 : 1.9) * (1 + 0.35 * shot.beat.pulse);
    RU.uAmb.value = 0; RU.uDiff.value = 1; RU.uSpec.value = 0.8; RU.uFill.value = 0; RU.uChkSub.value = 2; setV(RU.uFogCol, [0, 0, 0]);
    if (dith) { RU.uColA.value.multiplyScalar(0.25); RU.uColB.value.set(1, 1, 1); }
    MU.uHead.value = 1; if (dith) shapeMat.uniforms.uFlat.value = 0.8;
    // forward motion: steady + extra with loudness + a lurch on every beat
    const th = seed * 1.3 + 0.32 * lt + 0.9 * (cumAt(t) - cumAt(t0)) + 0.05 * (beatKick(t) - beatKick(t0));
    const sw = 0.05, dr = sw * Math.sin(lt * 0.7), dz = sw * Math.cos(lt * 0.53);
    camPos.set(Math.cos(th) * (1 + dr), Math.sin(th) * (1 + dr), dz);
    const ah = th + 0.32; camTgt.set(Math.cos(ah) * (1 - 0.05), Math.sin(ah) * (1 - 0.05), -dz * 0.5);
    const roll = 0.18 * lt + 0.5 * Math.sin(lt * 0.29) + 0.25 * beatKick(t) * (seed % 2 ? 1 : -1);
    const fwd = _v.set(-Math.sin(th), Math.cos(th), 0), radial = _v2.set(Math.cos(th), Math.sin(th), 0);
    camUp.set(0, 0, 1).multiplyScalar(Math.cos(roll)).addScaledVector(radial, Math.sin(roll));
    // shapes streaming toward the camera along the ring
    const N = 56;
    for (let i = 0; i < N; i++) {
      const thi = hash(i, 1, seed) * TAU - 0.55 * lt;
      let rel = ((thi - th) % TAU + TAU) % TAU;
      if (rel > 2.2) continue;
      const a = thi, rr = 0.2 + 0.08 * hash(i, 2, seed), b = hash(i, 3, seed) * TAU + lt * (hash(i, 4) - 0.5) * 2;
      const cr = Math.cos(b) * rr, cz = Math.sin(b) * rr;
      wp.set(Math.cos(a) * (1 + cr), Math.sin(a) * (1 + cr), cz);
      qa.setFromAxisAngle(randAxis(i, 7, _v3), lt * (1.5 + 2 * hash(i, 5)) + i);
      const s = 0.42 * (1 + 0.3 * shot.beat.pulse) * sstep(0.1, 0.3, rel);
      put(shapeOf(i), wp, qa, s, pal.fly[i % 3], 0);
    }
  }

  function knot(f, u, out) {   // torus-knot paths wound around the ring (torus-local)
    const p = [2, 3, 1, 3, 2, 1][f], q = [3, 2, 4, 5, 5, 3][f], rk = [0.8, 0.95, 0.85, 1.05, 0.9, 1.2][f];
    const c = Math.cos(q * u), s = Math.sin(q * u);
    return out.set((1 + rk * c) * Math.cos(p * u), (1 + rk * c) * Math.sin(p * u), rk * s);
  }
  function modeSwarm(t, shot, ctx) {
    const { pal, seed, shapeOf, dith } = ctx, lt = shot.lt, t0 = t - lt;
    torusXf('swarm', t, t0, seed, xf);
    const a = 0.09 * lt + seed * 1.9, d = 5.4 + 0.4 * Math.sin(lt * 0.08);
    camPos.set(Math.sin(a) * d, 0.9 + 0.8 * Math.sin(lt * 0.11 + seed), Math.cos(a) * d); camTgt.set(0, -0.3, 0); camUp.set(0, 1, 0);
    RU.uGrid.value = 0;
    const e0 = evCount(t0), e1 = evCount(t), N0 = dith ? 120 : 150, NMAX = dith ? 560 : 900, PER = dith ? 4 : 5;
    const nVis = Math.min(NMAX, N0 + PER * (e1 - e0));
    // recent kill events (window 1.4 s) and their strength
    const recent = []; for (let e = Math.max(e0, evCount(t - 1.4)); e < e1; e++) recent.push(e);
    const F = 6, pulse = shot.beat.pulse, sc0 = 0.52 * (1 + 0.25 * pulse);
    if (dith) RU.uColB.value.multiplyScalar(0.5);
    const white = dith ? [1, 1, 1] : [1, 1, 1];
    for (let i = 0; i < nVis; i++) {
      const f = i % F, j = Math.floor(i / F);
      const sp = (0.16 + 0.05 * hash(f, 1, seed)) * (f % 2 ? 1 : -1);
      const u = hash(f, 2, seed) * TAU + sp * lt + 0.02 * (f % 2 ? 1 : -1) * beatKick(t) - j * 0.034;
      knot(f, u, lp);
      const ji = hash(i, 3, seed);
      lp.x += 0.08 * Math.sin(lt * (1.3 + ji) + i); lp.y += 0.08 * Math.cos(lt * (1.1 + ji) + i * 1.7); lp.z += 0.07 * Math.sin(lt * (0.9 + ji) + i * 2.3);
      toWorld(xf, lp, wp);
      // appearance (new processes) and kills
      let scale = sc0, col = dith ? white : pal.shapes[i % 3];
      if (i >= N0) { const born = EVENTS[e0 + Math.floor((i - N0) / PER)][0], age = t - born; scale *= easeOut(age / 0.35); if (age < 0.25) col = white; }
      let killed = -1;
      for (const e of recent) if (hash(i, e, 31 + seed) < 0.07 * Math.min(1.5, EVENTS[e][1])) killed = e;
      if (killed >= 0) {
        const age = t - EVENTS[killed][0];
        if (age < 0.12) { scale *= 1 + 4 * age; col = white; }
        else if (age < 1.0) {   // burst into tetrahedral debris
          scale = 0;
          for (let s = 0; s < 4; s++) {
            randAxis(i, s + 13 * killed, _v); const ag = age - 0.12;
            _v2.copy(wp).addScaledVector(_v, 1.6 * ag * (1 - 0.45 * ag));
            qa.setFromAxisAngle(randAxis(i, s + 3, _v3), 12 * ag);
            put(4, _v2, qa, 0.5 * (1 - ag / 0.88), pal.fly[0]);
          }
        } else scale *= easeOut((age - 1.0) / 0.4);   // a new copy takes its place
      }
      qa.setFromAxisAngle(randAxis(i, 5, _v3), lt * (1 + 2 * hash(i, 6)) + i);
      put(shapeOf(i), wp, qa, scale, col);
    }
  }

  // ───────────────────────── update ─────────────────────────
  const lightV = new THREE.Vector3(0.5, 1, 0.8).normalize(), _m3 = new THREE.Matrix3(), _m4 = new THREE.Matrix4();
  function update(t, shot) {
    const v = Math.max(0, shot.variant | 0), dith = shot.dither !== false, seed = (shot.seed ?? 1) | 0;
    const P = PALS[v % 4][dith ? 'd' : 'c'], mix = Math.floor(v / 4) % 11;
    const shapeOf = i => (mix === 0 ? ((i % 10) + 10) % 10 : mix - 1);
    applyPalette(P);
    cnt.fill(0); nS = 0; nC = 0; pac.visible = false;
    RU.uShow.value = 1; RU.uInside.value = 0; RU.uGrid.value = 0; camera.near = 0.02;
    xf.q.identity(); xf.p.set(0, 0, 0); xf.s = 1;
    const ctx = { pal: P, seed, shapeOf, dith };
    const mode = meta.modes.includes(shot.mode) ? shot.mode : 'torus';
    if (mode === 'shooter') modeShooter(t, shot, ctx);
    else if (mode === 'shapes') modeShapes(t, shot, ctx);
    else if (mode === 'tunnel') { camera.near = 0.01; modeTunnel(t, shot, ctx); }
    else if (mode === 'swarm') modeSwarm(t, shot, ctx);
    else modeTorus(t, shot, ctx);
    RU.uNStk.value = nS; RU.uNCrv.value = nC;
    flush();

    camera.position.copy(camPos); camera.up.copy(camUp); camera.lookAt(camTgt);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    RU.uCamPos.value.copy(camera.position);
    RU.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    RU.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    RU.uTR.value.setFromMatrix4(_m4.makeRotationFromQuaternion(xf.q)); RU.uTRi.value.copy(RU.uTR.value).transpose();
    RU.uTP.value.copy(xf.p); RU.uTS.value = xf.s;
    const Lw = _v.copy(lightV).applyQuaternion(camera.quaternion);
    MU.uLight.value.copy(Lw);
    RU.uLightL.value.copy(Lw).applyMatrix3(RU.uTRi.value);
  }

  return { scene, camera, update };
}
