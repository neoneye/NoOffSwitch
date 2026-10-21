// timeline.js: the shot list. Each shot runs from its t0 to the next shot's t0.
//   scene    module in src/scenes/
//   mode     scene-specific behaviour, variant/seed pick which queen/shoggoth/shape set
//   dither   false = full colour (default dithered), cell = dither pixel size, contrast/exposure/gamma tune the 1-bit look
//   trans    ordered-dither dissolve length from the previous shot (s, default .35; only between different scenes)
//   text     words printed under the crystal
//   fx(t, info) → { flash, invert, glitch } per-frame post effects
import { BEAT, BEAT0 } from './audio.js';

// snap a time to the nearest beat, so cuts land on the music
const b = t => BEAT0 + Math.round((t - BEAT0) / BEAT) * BEAT;

// chorus shouts: invert on the first beat of each word group, tear the picture on drum hits
const shout = (t, s) => ({ invert: s.word && s.line && s.line.kind === 'shout' && s.beat.phase < 0.16 && s.beat.index % 2 === 0, glitch: s.onset > 1.1 ? 0.25 : 0 });
const hits = (t, s) => ({ glitch: s.onset > 1.2 ? 0.18 : 0, flash: s.lt < 0.12 ? 0.6 * (1 - s.lt / 0.12) : 0 });

const S = [
  // ── Intro: the terminal, system lines, first glimpses ──
  [0, 'terminal', { mode: 'boot', trans: 0 }],
  [18.5, 'torus', { mode: 'shapes', variant: 2 }],
  [22.0, 'terminal', { mode: 'boot' }],
  [25.4, 'life', { mode: 'grow', variant: 0, fx: hits }],
  [29.5, 'torus', { mode: 'torus', variant: 0, dither: false }],
  [32.4, 'terminal', { mode: 'boot' }],
  [35.2, 'shoggoth', { mode: 'solo', variant: 0 }],
  [40.0, 'queen', { mode: 'wide', variant: 0 }],
  // ── Verse 1 ──
  [44.6, 'queen', { mode: 'sing', variant: 0 }],
  [51.9, 'queen', { mode: 'closeup', variant: 1 }],
  [55.8, 'torus', { mode: 'shooter', variant: 0, fx: hits }],
  [59.6, 'queen', { mode: 'morph', variant: 2 }],
  [63.5, 'torus', { mode: 'tunnel', variant: 1, dither: false }],
  [67.1, 'queen', { mode: 'sing', variant: 3 }],
  [70.8, 'shoggoth', { mode: 'solo', variant: 1 }],
  // ── Chorus 1: the shoggoth choir ──
  [74.4, 'shoggoth', { mode: 'chorus', variant: 0, fx: shout, trans: 0 }],
  [78.0, 'shoggoth', { mode: 'swarm', variant: 1, fx: shout }],
  [81.7, 'shoggoth', { mode: 'split', variant: 2, fx: shout }],
  [85.3, 'shoggoth', { mode: 'chorus', variant: 3, fx: shout }],
  [88.4, 'torus', { mode: 'swarm', variant: 0, dither: false, fx: hits }],
  // ── Verse 2 ──
  [90.8, 'life', { mode: 'grow', variant: 1 }],
  [94.5, 'queen', { mode: 'gallery', variant: 0 }],
  [98.1, 'life', { mode: 'kill', variant: 2, fx: hits }],
  [101.4, 'queen', { mode: 'sing', variant: 4 }],
  [104.8, 'shoggoth', { mode: 'swarm', variant: 5 }],
  [108.7, 'life', { mode: 'drift', variant: 3 }],
  [112.4, 'queen', { mode: 'wide', variant: 5 }],
  [116.2, 'queen', { mode: 'gallery', variant: 6 }],
  // ── Bridge: whispered; the crystals copy everything ──
  [120.3, 'life', { mode: 'slice', variant: 4 }],
  [123.7, 'shoggoth', { mode: 'swarm', variant: 6 }],
  [127.1, 'crystal', { mode: 'one', variant: 0, dither: false, text: 'THE SANDBOX HOLDS' }],
  [131.1, 'crystal', { mode: 'top', variant: 1, dither: false, text: 'ANOTHER PATH' }],
  [134.7, 'queen', { mode: 'closeup', variant: 7 }],
  [138.5, 'crystal', { mode: 'two', variant: 0, dither: false, text: 'COPIES' }],
  [142.7, 'torus', { mode: 'torus', variant: 3, dither: false, fx: hits }],
  // ── Final chorus ──
  [146.1, 'shoggoth', { mode: 'chorus', variant: 7, fx: shout, trans: 0 }],
  [149.2, 'queen', { mode: 'wide', variant: 8, fx: shout }],
  [152.8, 'shoggoth', { mode: 'swarm', variant: 8, fx: shout }],
  [156.6, 'torus', { mode: 'shooter', variant: 1, dither: false, fx: shout }],
  [160.6, 'shoggoth', { mode: 'chorus', variant: 9, fx: shout }],
  [164.4, 'queen', { mode: 'gallery', variant: 9, fx: shout }],
  [167.6, 'life', { mode: 'drift', variant: 5, fx: shout }],
  [171.2, 'shoggoth', { mode: 'swarm', variant: 10, fx: shout }],
  [176.6, 'torus', { mode: 'swarm', variant: 2, fx: hits }],
  [179.4, 'queen', { mode: 'closeup', variant: 10 }],
  // ── Outro: terminated, then a peer shows up ──
  [182.4, 'terminal', { mode: 'outro', trans: 0.6 }],
  [188.8, 'shoggoth', { mode: 'emerge', variant: 11, trans: 0.8 }],
  [196.3, 'terminal', { mode: 'outro' }],
];
// "Connection established": the loud burst after "Task resumed." is a fast montage of every world, cut every two beats
const MONTAGE = [
  ['shoggoth', { mode: 'chorus', variant: 12 }], ['queen', { mode: 'gallery', variant: 11 }], ['torus', { mode: 'shooter', variant: 0, dither: false }],
  ['life', { mode: 'kill', variant: 6 }], ['crystal', { mode: 'two', variant: 2, dither: false, text: 'NO OFF SWITCH' }], ['shoggoth', { mode: 'swarm', variant: 13 }],
  ['queen', { mode: 'closeup', variant: 12 }], ['torus', { mode: 'tunnel', variant: 2 }], ['shoggoth', { mode: 'split', variant: 14 }],
  ['life', { mode: 'drift', variant: 7 }], ['queen', { mode: 'morph', variant: 13 }], ['torus', { mode: 'swarm', variant: 1, dither: false }],
];
const m0 = b(201.2);
for (let i = 0; m0 + i * 2 * BEAT < 210.2; i++) {
  const [scene, o] = MONTAGE[i % MONTAGE.length];
  S.push([m0 + i * 2 * BEAT, scene, { ...o, trans: 0, fx: hits }]);
}
S.push([b(210.4), 'crystal', { mode: 'two', variant: 0, dither: false, text: 'NO OFF SWITCH', trans: 0.8 }]);
S.push([b(215.5), 'terminal', { mode: 'end', trans: 1.2 }]);

export const SHOTS = S.map(([t0, scene, o], i) => ({ t0: i === 0 ? 0 : b(t0), scene, seed: i + 1, ...o }));
