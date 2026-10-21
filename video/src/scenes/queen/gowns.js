// gowns.js: which gown a variant wears, and the morph paths through eras and commissions.
//   variant 0..5  the experiment's era presets 1500, 1600, 1700, 1800, 1900, 2000
//   variant ≥ 6   a seeded random commission (QC.randomCommission) on era variant % 6: mostly 'within' the era with
//                 a fresh palette / pattern / crown / ruff; variants 18–23, 36–41, ... are 'wild' (tamed a little so
//                 the arms stay readable). Any integer ≥ 0 works.
import { QC } from './qc.js';

const CROWNS = ['tudor', 'diadem', 'tiara', 'coronation'];
const pick = (rng, a) => a[Math.floor(rng() * a.length)];

export function gownParams(variant) {
  const v = Math.max(0, Math.floor(+variant || 0));
  if (v < 6) {
    const p = QC.paramsForEra(v);
    if (v === 2) p.crown = 'diadem';   // the rococo preset has no crown; she is still the queen
    return p;
  }
  const rng = QC.mulberry32((Math.imul(v, 2654435761) ^ 0x5bd1e995) >>> 0);
  const era = v % 6, wild = Math.floor(v / 6) % 3 === 2;
  const p = QC.randomCommission(rng, wild ? 'wild' : 'within', era);
  if (!wild) {
    if (rng() < 0.6) { const c = pick(rng, QC.ROYAL); p.gownColor = p.bodiceColor = c; if (p.frontOpen < 0.01) p.foreColor = c; }
    if (rng() < 0.6) p.gownAccent = p.bodiceAccent = p.foreAccent = pick(rng, QC.ROYAL);
    if (rng() < 0.5) { p.pattern = pick(rng, QC.PATTERNS); if (rng() < 0.5) p.forePattern = p.pattern; }
    if (rng() < 0.3) p.mantle = QC.snap(0.8 + rng() * 1.8, QC.SCHEMA_BY_KEY.mantle);
    if (era <= 1 && rng() < 0.5) { p.ruff = QC.snap(0.4 + rng() * 0.6, QC.SCHEMA_BY_KEY.ruff); p.ruffLayers = 1 + Math.floor(rng() * 3); }
  }
  if (wild) {
    const cap = (k, m) => { p[k] = Math.min(p[k], m); };
    cap('cuffFlare', 0.6); cap('shoulderPuff', 0.6); cap('upperFull', 0.6); cap('mantleWidth', 0.45); cap('mantle', 2.5);
  }
  if (p.crown === 'none' && p.hairStyle !== 'gable' && rng() < 0.85) p.crown = pick(rng, CROWNS);
  if (rng() < 0.4) p.crown = p.hairStyle === 'gable' ? p.crown : pick(rng, CROWNS);
  return p;
}

// per-key interpolation, as QC.paramsAtYear does between neighbouring eras
export function lerpParams(A, B, t) {
  const out = {};
  for (const d of QC.SCHEMA) {
    const a = A[d.key], b = B[d.key];
    if (d.global) out[d.key] = a;
    else if (d.kind === 'num') out[d.key] = d.step >= 1 ? Math.round(QC.lerp(a, b, t)) : QC.lerp(a, b, t);
    else if (d.kind === 'color') out[d.key] = QC.mixHex(a, b, t);
    else out[d.key] = t < 0.5 ? a : b;
  }
  return out;
}

// morph path for a variant: keyframe gowns visited across the shot (p = 0..1)
export function morphKeys(variant) {
  const v = Math.max(0, Math.floor(+variant || 0)), k = v % 3;
  if (k === 0) return [0, 1, 2, 3, 4, 5].map(i => ({ id: 'e' + i, p: gownParams(i) }));
  if (k === 1) return [5, 4, 3, 2, 1, 0].map(i => ({ id: 'e' + i, p: gownParams(i) }));
  // eras interleaved with seeded commissions
  const ids = [v % 6, 6 + v * 5, (v + 2) % 6, 7 + v * 5, (v + 4) % 6];
  return ids.map(i => ({ id: 'v' + i, p: gownParams(i) }));
}
// quantised morph step (so builds can be cached): returns { key, params }
export function morphAt(variant, p, stepsPerSegment = 14) {
  const keys = morphKeys(variant), segs = keys.length - 1;
  const x = Math.min(segs, Math.max(0, p * segs)), q = Math.round(x * stepsPerSegment) / stepsPerSegment;
  const i = Math.min(segs - 1, Math.floor(q)), f = q - i;
  const t = QC.smoothstep(0, 1, f);
  return { key: `m${variant}|${q.toFixed(4)}`, params: () => lerpParams(keys[i].p, keys[i + 1].p, t) };
}
