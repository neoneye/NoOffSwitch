// engine.js: loads the scenes, renders the shot(s) active at song time t into render targets, then runs the
// dither/composite pass with the lyric overlay. Every frame is a function of t, so frames can render in any order.
import * as THREE from 'three';
import { Post } from './post.js';
import { BEAT, BEAT0, RMS, ONSET, FPS_DATA } from './audio.js';
import { LYRICS } from './lyrics.js';
import { drawOverlay } from './overlay.js';

export const W = 1920, H = 1080;

const sample = (arr, t) => { const f = t * FPS_DATA, i = Math.max(0, Math.min(arr.length - 2, Math.floor(f))), k = f - i; return arr[i] * (1 - k) + arr[i + 1] * k; };
// smoothed loudness: average of the envelope over ±0.25 s
export function energyAt(t) { let s = 0; for (let k = -4; k <= 4; k++) s += sample(RMS, Math.max(0, t + k * 0.0625)); return s / 9; }
export function onsetAt(t) { return sample(ONSET, Math.max(0, t)); }
export function beatAt(t) {
  const x = (t - BEAT0) / BEAT, index = Math.floor(x), phase = x - index;
  return { bpm: 60 / BEAT, period: BEAT, index, phase, pulse: Math.exp(-phase * 5), bar: Math.floor(index / 4), barPhase: ((x / 4) % 1 + 1) % 1 };
}
// vocal activity: 1 while a word is being pronounced (with short attack/release), plus the current word
export function voiceAt(t) {
  let sing = 0, word = '', line = null;
  for (const L of LYRICS) {
    if (t < L.t0 - 0.3 || t > L.t1 + 0.4) continue;
    line = L;
    for (const [w, a, b] of L.words) {
      const k = Math.min(1, Math.max(0, (t - a + 0.06) / 0.08), Math.max(0, (b + 0.12 - t) / 0.12));
      if (k > sing) { sing = k; word = w; }
    }
  }
  return { sing, word, line };
}

export class Engine {
  constructor(canvas, shots, { scenesBase = './scenes/', lyrics = true } = {}) {
    this.canvas = canvas; this.shots = shots; this.scenesBase = scenesBase; this.lyrics = lyrics;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1); this.renderer.setSize(W, H, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const rt = () => new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace, type: THREE.UnsignedByteType });
    this.rtA = rt(); this.rtB = rt();
    this.overlay = document.createElement('canvas'); this.overlay.width = W; this.overlay.height = H;
    this.post = new Post(this.renderer, W, H, this.overlay);
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.black.needsUpdate = true;
    this.scenes = {};
    this.canvasTex = new Map();
  }
  async load(names, onProgress) {
    const ctx = { THREE, renderer: this.renderer, width: W, height: H, base: new URL('../../', import.meta.url).href };
    for (const n of names) {
      onProgress && onProgress(n);
      try {
        const mod = await import(this.scenesBase + n + '.js');
        this.scenes[n] = await mod.create(ctx);
      } catch (e) { console.error(`scene ${n} failed to load:`, e); }
    }
  }
  shotAt(t) {
    let i = 0; while (i + 1 < this.shots.length && t >= this.shots[i + 1].t0) i++;
    return i;
  }
  info(shot, t, i) {
    const t1 = i + 1 < this.shots.length ? this.shots[i + 1].t0 : shot.t1 ?? 9999;
    const v = voiceAt(t);
    return { ...shot, t1, lt: t - shot.t0, dur: t1 - shot.t0, p: (t - shot.t0) / (t1 - shot.t0), t, beat: beatAt(t), energy: energyAt(t), onset: onsetAt(t), sing: v.sing, word: v.word, line: v.line };
  }
  // Renders one shot into a target; returns the texture to sample.
  renderShot(shot, t, i, target) {
    const sc = this.scenes[shot.scene];
    if (!sc) return this.black;
    sc.update(t, this.info(shot, t, i));
    const r = this.renderer;
    if (sc.canvas) {
      let tex = this.canvasTex.get(sc);
      if (!tex) { tex = new THREE.CanvasTexture(sc.canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; this.canvasTex.set(sc, tex); }
      tex.needsUpdate = true; return tex;
    }
    r.setRenderTarget(target); r.setClearColor(0x000000, 1); r.clear();
    if (sc.render) sc.render(r, target);
    else r.render(sc.scene, sc.camera);
    r.setRenderTarget(null);
    return target.texture;
  }
  frame(t) {
    const i = this.shotAt(t), cur = this.shots[i], prev = this.shots[i - 1];
    const tr = cur.trans ?? 0.35;                       // dissolve length from the previous shot
    const k = prev && tr > 0 && cur.scene !== prev.scene ? Math.min(1, (t - cur.t0) / tr) : 1;
    const texB = this.renderShot(cur, t, i, this.rtB);
    const texA = k < 1 ? this.renderShot(prev, t, i - 1, this.rtA) : this.black;
    const sideU = (s) => [s.dither === false ? 0 : 1, s.cell ?? 3, [s.exposure ?? 1, s.contrast ?? 1.15, s.gamma ?? 1]];
    const [dA, cA, gA] = sideU(prev || cur), [dB, cB, gB] = sideU(cur);
    const b = beatAt(t), fx = cur.fx ? cur.fx(t, this.info(cur, t, i)) : {};
    const ctx = this.overlay.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (this.lyrics) drawOverlay(ctx, t, { shot: cur, beat: b });
    this.post.render({
      tA: texA, tB: texB, mixAB: k, ditherA: dA, ditherB: dB, cellA: cA, cellB: cB, gainA: gA, gainB: gB,
      invert: fx.invert ? 1 : 0, flash: fx.flash ?? 0, glitch: fx.glitch ?? 0, seed: Math.floor(t * 12),
    });
  }
}
