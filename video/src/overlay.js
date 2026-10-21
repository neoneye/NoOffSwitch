// overlay.js: the lyric bar, drawn on a 2D canvas that is laid over the dithered frame without being dithered.
// Words already sung are solid, the word being pronounced is inverted in a block, words still to come are outlined.
import { LYRICS } from './lyrics.js';
import { W, H } from './engine.js';

export const FONT = '"IBM Plex Mono", Menlo, monospace';

function activeLine(t) {
  // A line shows from just before its first word until the next line takes over (back-to-back lines swap in place,
  // only a real pause closes the bar).
  const span = i => {
    const L = LYRICS[i], next = LYRICS[i + 1], start = L.t0 - 0.35;
    const end = next && next.t0 - 0.35 < L.t1 + 0.9 ? next.t0 - 0.35 : L.t1 + 0.9;
    return [start, end, !!next && end === next.t0 - 0.35];
  };
  for (let i = 0; i < LYRICS.length; i++) {
    const [start, end, handoff] = span(i);
    if (t >= start && t < end) {
      const fromPrev = i > 0 && span(i - 1)[2];
      return { L: LYRICS[i], age: fromPrev ? 1 : t - start, left: handoff ? 1 : end - t };
    }
  }
  return null;
}

export function drawOverlay(c, t, { shot }) {
  const a = activeLine(t);
  if (!a) return;
  const { L } = a;
  if (L.kind === 'sys' && shot.scene === 'terminal') return;  // the terminal scene types these itself
  const shout = L.kind === 'shout', sys = L.kind === 'sys';
  const size = shout ? 62 : 50;
  c.font = `700 ${size}px ${FONT}`; c.textBaseline = 'middle';
  const words = L.words.map(w => (shout ? w[0].toUpperCase() : w[0]));
  const sp = c.measureText(' ').width, ws = words.map(w => c.measureText(w).width);
  const total = ws.reduce((p, q) => p + q, 0) + sp * (words.length - 1) + (sys ? c.measureText('> ').width : 0);
  const padX = 34, padY = 22, bh = size + padY * 2, y = H - 70 - bh / 2;
  // the slab wipes open left to right and closes the same way, in hard steps (no soft fades in a 1-bit world)
  const open = Math.min(1, a.age / 0.18), close = Math.min(1, a.left / 0.14), k = Math.min(open, close);
  const bw = (total + padX * 2), x0 = (W - bw) / 2;
  const step = q => Math.floor(q * 8) / 8;
  c.fillStyle = '#000'; c.fillRect(x0, y - bh / 2, bw * step(k), bh);
  if (k < 1) return;
  c.strokeStyle = '#fff'; c.lineWidth = 3; c.strokeRect(x0 + 6, y - bh / 2 + 6, bw - 12, bh - 12);
  let x = x0 + padX;
  if (sys) { c.fillStyle = '#fff'; c.fillText('> ', x, y); x += c.measureText('> ').width; }
  L.words.forEach(([, wa, wb], i) => {
    const w = words[i];
    if (t >= wa && t < wb + 0.06) {
      c.fillStyle = '#fff'; c.fillRect(x - 8, y - size / 2 - 8, ws[i] + 16, size + 16);
      c.fillStyle = '#000'; c.fillText(w, x, y + 2);
    } else if (t >= wb) {
      c.fillStyle = '#fff'; c.fillText(w, x, y + 2);
    } else {
      c.strokeStyle = '#fff'; c.lineWidth = 1.6; c.strokeText(w, x, y + 2);
    }
    x += ws[i] + sp;
  });
}
