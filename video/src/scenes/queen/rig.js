// rig.js: the queen's choreography. Everything is an analytic function of song time t (beat grid, energy, onsets,
// vocal activity), so any frame can be rendered on its own.
//   arms   per-beat gestures from a pose library (two-bone IK to a wrist target, pole vector for the elbow), bigger
//          with energy, kicked by onsets, a reaching / pleading arm while she sings, both arms up on shouted lines
//   body   side-to-side sway on the beat, slow turns, twirls (wide), upper-body lean, head nod / tilt / turn, mouth
//   cloth  hem swing = the body's motion filtered by a damped spring (convolution with its impulse response),
//          so the skirt lags, overshoots and settles, plus a beat flare
import { beatAt, energyAt, onsetAt, voiceAt } from '../../engine.js';
import { QC } from './qc.js';

const { clamp, lerp, smoothstep, TAU } = QC;
const E = t => clamp(energyAt(t) / 0.4, 0, 1.25);
const hash = x => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const easeOutBack = x => { const c = 1.9; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };

export const STYLES = {
  sing:    { sway: 0.8, turn: 0.35, arms: 1.0, head: 1.0, sing: 1.0, twirl: false, flare: 0.8 },
  closeup: { sway: 0.6, turn: 0.25, arms: 1.0, head: 1.5, sing: 1.0, twirl: false, flare: 0.6, close: true },
  wide:    { sway: 1.6, turn: 1.0, arms: 1.15, head: 1.0, sing: 0.6, twirl: true, flare: 1.4 },
  morph:   { sway: 1.2, turn: 0.6, arms: 1.0, head: 1.0, sing: 0.7, twirl: false, flare: 1.0 },
  gallery: { sway: 1.3, turn: 0.4, arms: 1.1, head: 1.0, sing: 0.3, twirl: false, flare: 1.2 },
};

// ---------------------------------------------------------------- body (root) motion
export function bodyAt(t, st) {
  const B = beatAt(t), x = B.index + B.phase, e = E(t);
  const sway = st.sway * (0.012 + 0.03 * e) * Math.sin(Math.PI * x);
  let yaw = st.turn * (0.16 + 0.22 * e) * Math.sin((Math.PI * x) / 4 + 0.6);
  if (st.twirl) {   // a full turn in the last bar of every four, cumulative so the yaw stays continuous
    const bar = Math.floor(x / 4), ph = (x / 4) - bar, done = Math.floor((bar + 1) / 4);
    yaw += TAU * (done + (bar % 4 === 3 ? smoothstep(0.05, 0.95, ph) : 0));
  }
  return { x: sway, z: 0, yaw, roll: -sway * 1.4 };
}
// hem = body motion filtered by an under-damped spring (ω = 8 rad/s, ζ = 0.3); kernel samples cached
const KN = 30, KDT = 0.05, KW = [];
{ const w = 8, z = 0.3, wd = w * Math.sqrt(1 - z * z); let s = 0; for (let k = 0; k < KN; k++) { const u = (k + 0.5) * KDT; KW.push(Math.exp(-z * w * u) * Math.sin(wd * u)); s += KW[k]; } for (let k = 0; k < KN; k++) KW[k] /= s; }
function clothAt(t, st, body) {
  let hx = 0, hz = 0, hy = 0;
  for (let k = 0; k < KN; k++) { const b = bodyAt(t - (k + 0.5) * KDT, st); hx += KW[k] * b.x; hz += KW[k] * b.z; hy += KW[k] * b.yaw; }
  const h = 1 / 30, b0 = bodyAt(t - h, st), b1 = bodyAt(t + h, st);
  const c = Math.cos(body.yaw), s = Math.sin(body.yaw), toLocal = (wx, wz) => [wx * c - wz * s, wx * s + wz * c];
  const [ox, oz] = toLocal(hx - body.x, hz - body.z), [vx, vz] = toLocal((b1.x - b0.x) / (2 * h), (b1.z - b0.z) / (2 * h));
  const B = beatAt(t), e = E(t), on = Math.min(1.2, onsetAt(t));
  const lim = (v, m) => clamp(v, -m, m);
  return { ox: lim(ox * 1.6, 0.3), oz: lim(oz * 1.6, 0.3), yaw: lim((hy - body.yaw) * 1.3, 0.9), tx: -vx * 0.08, tz: -vz * 0.08,
    flare: st.flare * ((0.02 + 0.045 * e) * B.pulse + 0.025 * on), wind: 0.12 + 0.12 * e, time: t };
}

// ---------------------------------------------------------------- arm pose library (side +1; x mirrors for side -1)
// each entry: wrist target and elbow pole, as functions of the figure f
const POSES = {
  REST:  f => [[0.075, f.waistY + 0.015, 0.215], [1, -0.2, -0.6]],
  HIP:   f => [[0.2, f.waistY + 0.03, 0.06], [1, 0.25, -0.6]],
  CHEST: f => [[0.05, f.bustY + 0.03, 0.2], [1, -1, -0.2]],
  OPEN:  f => [[0.56, f.shoulderY - 0.2, 0.26], [0.3, -1, -0.5]],
  REACH: f => [[0.15, f.shoulderY - 0.02, 0.56], [1, -1, 0]],
  PLEAD: f => [[0.24, f.shoulderY + 0.12, 0.47], [0.6, -1, -0.2]],
  RAISE: f => [[0.34, f.shoulderY + 0.48, 0.1], [1, -0.2, -0.3]],
  HIGH:  f => [[0.18, f.shoulderY + 0.55, 0.06], [1, 0, -0.3]],
  WAVE:  f => [[0.6, f.shoulderY + 0.14, 0.04], [0, -1, -0.4]],
  FACE:  f => [[0.17, f.headY - 0.05, 0.04], [1, -0.6, -0.5]],
  CROWN: f => [[0.14, f.headY + 0.13, 0.04], [1, 0, -0.3]],
};
const CALM = [['REST', 'REST'], ['CHEST', 'REST'], ['REST', 'CHEST'], ['HIP', 'HIP'], ['CHEST', 'HIP'], ['OPEN', 'OPEN'], ['HIP', 'OPEN']];
const MID = [['OPEN', 'OPEN'], ['REACH', 'HIP'], ['HIP', 'REACH'], ['CHEST', 'OPEN'], ['OPEN', 'CHEST'], ['FACE', 'OPEN'], ['WAVE', 'HIP'], ['PLEAD', 'CHEST'], ['RAISE', 'HIP']];
const CLOSE = [['FACE', 'CHEST'], ['CHEST', 'FACE'], ['CROWN', 'PLEAD'], ['PLEAD', 'CROWN'], ['FACE', 'FACE'], ['PLEAD', 'PLEAD'], ['CHEST', 'PLEAD'], ['REACH', 'FACE'], ['CROWN', 'CROWN'], ['OPEN', 'FACE']];
const HIGH = [['RAISE', 'RAISE'], ['HIGH', 'HIP'], ['HIP', 'HIGH'], ['WAVE', 'WAVE'], ['HIGH', 'OPEN'], ['OPEN', 'HIGH'], ['RAISE', 'REACH'], ['CROWN', 'WAVE'], ['REACH', 'RAISE']];

function beatTime(t, B, i) { return t - B.phase * B.period + (i - B.index) * B.period; }
function comboAt(t, B, i, seed, close) {
  const bar = Math.floor(i / 4), eb = E(beatTime(t, B, bar * 4));
  const hold = eb < 0.35 ? 4 : eb < 0.7 ? 2 : 1, ie = i - (((i % hold) + hold) % hold), te = beatTime(t, B, ie);
  const e = E(te), v = voiceAt(te + 0.05), shout = v.line && v.line.kind === 'shout';
  const list = close ? CLOSE : shout || e > 0.85 ? HIGH : e > 0.45 ? MID : CALM;
  return list[Math.floor(hash(ie * 7.31 + seed * 3.7) * list.length)];
}

// two-bone IK: shoulder S, wrist target W, pole direction → elbow
const L1 = 0.29, L2 = 0.27;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return mul(a, 1 / l); };
const mix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
function ik(S, W, pole) {
  let d = sub(W, S), len = Math.hypot(...d);
  const dir = norm(d); len = clamp(len, 0.1, L1 + L2 - 0.004);
  const w = add(S, mul(dir, len));
  const a = (L1 * L1 - L2 * L2 + len * len) / (2 * len), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  let pp = sub(pole, mul(dir, dot(pole, dir))); pp = norm(pp);
  return [add(add(S, mul(dir, a)), mul(pp, h)), w];
}
function pushOutsideTorso(q, p, f, m) {
  if (q[1] > f.waistY - 0.08 && q[1] < f.neckY + 0.02) {
    const s = QC.torsoSection(q[1], p), ex = q[0] / (s.rx + m), ez = (q[2] - s.cz) / (s.rz + m), d = Math.hypot(ex, ez);
    if (d < 1) { const k = 1 / Math.max(d, 1e-3); if (d < 1e-3) { q[2] = s.cz + s.rz + m; } else { q[0] *= k; q[2] = s.cz + (q[2] - s.cz) * k; } }
  }
  const dy = q[1] - f.headY, r = Math.hypot(q[0], dy * 0.8, q[2]), R = 0.12 + m;
  if (r < R) { const k = R / Math.max(r, 1e-3); q[0] *= k; q[2] *= k; if (r < 1e-3) q[2] = R; }
  return q;
}

// ---------------------------------------------------------------- the whole performance at time t
// opts: { mode, seed, mirror, p (gown params) }
export function perform(t, opts) {
  const st = STYLES[opts.mode] || STYLES.sing, p = opts.p, f = QC.figure(p);
  const B = beatAt(t), x = B.index + B.phase, e = E(t), on = Math.min(1.2, onsetAt(t)), seed = opts.seed || 0;
  const body = bodyAt(t, st), cloth = clothAt(t, st, body);
  // smoothed vocal activity (the arm should not flicker between words)
  let ws = 0; for (let k = -6; k <= 2; k++) ws += voiceAt(t + k * 0.07).sing; ws = clamp(ws / 9 * 1.25, 0, 1) * st.sing;
  const V = voiceAt(t), line = V.line || voiceAt(t - 0.6).line, shout = line && line.kind === 'shout';
  const leadSide = line ? (hash(line.t0 * 3.1 + seed) < 0.5 ? 1 : -1) : 1, leadPose = line && hash(line.t0 * 1.7) < 0.5 ? 'PLEAD' : 'REACH';
  // gestures: previous → current beat's combo, snapping in just after the beat with a little overshoot
  const close = !!st.close, c0 = comboAt(t, B, B.index - 1, seed, close), c1 = comboAt(t, B, B.index, seed, close);
  const k = easeOutBack(clamp(B.phase / 0.42, 0, 1)), amp = clamp((close ? 0.85 : 0.5) + 0.55 * e, 0.5, 1.1) * st.arms;
  const arms = [];
  for (let ai = 0; ai < 2; ai++) {
    const side = ai === 0 ? 1 : -1, ci = opts.mirror ? 1 - ai : ai;
    const S = QC.armPoints(p, side)[0];
    const pose = name => { const [w, pl] = POSES[name](f); return [[w[0] * side, w[1], w[2]], [pl[0] * side, pl[1], pl[2]]]; };
    const [rw, rp] = pose('REST'), [w0, p0] = pose(c0[ci]), [w1, p1] = pose(c1[ci]);
    let W = mix3(w0, w1, k), P = mix3(p0, p1, clamp(k, 0, 1));
    W = add(rw, mul(sub(W, rw), amp));
    // singing: the lead arm reaches toward the camera, the other one comes to the heart; shouted lines: both arms up
    if (ws > 0.001) {
      const lead = side === leadSide;
      const [tw, tp] = pose(shout ? (lead ? 'HIGH' : 'RAISE') : lead ? leadPose : (e > 0.5 ? 'OPEN' : 'CHEST'));
      const wgt = ws * (lead || shout ? 0.85 : 0.4);
      W = mix3(W, tw, wgt); P = mix3(P, tp, wgt);
      if (lead && line && !shout) {   // the reach unfolds and rises through the line
        const u = clamp((t - line.t0) / Math.max(0.5, line.t1 - line.t0), 0, 1), un = smoothstep(0, 1, u) * ws;
        W[0] += side * 0.1 * un; W[1] += 0.12 * un; W[2] += 0.04 * un;
      }
    }
    // groove: a small figure-eight on the beat, a bounce on the pulse, a kick outwards on onsets
    W[0] += side * 0.025 * st.arms * Math.sin(Math.PI * x + side);
    W[1] += 0.03 * st.arms * Math.sin(TAU * x * 0.5 + 1.3 * side) + 0.035 * B.pulse * (0.3 + e) * st.arms;
    W = add(W, mul(norm(sub(W, S)), 0.06 * on * st.arms));
    let [El, Wr] = ik(S, W, norm(P));
    const gap = 0.05;
    for (const q of [El, Wr]) { QC.pushOutsideSkirt(q, p, gap); pushOutsideTorso(q, p, f, q === El ? 0.035 : 0.045); }
    const m1 = mix3(S, El, 0.5), m2 = mix3(El, Wr, 0.5);
    QC.pushOutsideSkirt(m2, p, gap); pushOutsideTorso(m1, p, f, 0.02); pushOutsideTorso(m2, p, f, 0.035);
    arms.push([S, m1, El, m2, Wr]);
  }
  const hs = st.head;
  const head = {
    pitch: hs * (0.08 * B.pulse * (0.4 + e) + 0.04 * Math.sin((Math.PI * x) / 2)) - 0.16 * ws,
    roll: hs * 0.1 * Math.sin(Math.PI * x + 0.5) * (0.5 + e) + body.roll * 0.5,
    yaw: 0.22 * leadSide * ws + hs * 0.08 * Math.sin((Math.PI * x) / 4),
  };
  const upper = { roll: body.roll, pitch: 0.07 * ws * (shout ? -0.6 : 1) + 0.02 * B.pulse * e, yaw: 0.1 * leadSide * ws, dip: -0.008 * B.pulse * e };
  const mouth = clamp(V.sing, 0, 1) * (0.55 + 0.45 * Math.abs(Math.sin(t * TAU * 2.7))) * (shout ? 1.25 : 1);
  return { body, cloth, arms, head, upper, mouth, ws };
}
