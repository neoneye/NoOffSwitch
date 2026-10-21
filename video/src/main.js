// main.js: player (plays the song and renders live) and render hooks for render.mjs.
//   index.html                                   the whole video, synced to the audio
//   index.html?t=74                              start at 74 s
//   index.html?scene=queen&mode=sing&variant=3   one scene alone, for development (also &dither=0, &cell=4)
//   index.html?render                            no UI; render.mjs drives window.renderAt(t)
import { Engine, W, H } from './engine.js';
import { SHOTS } from './timeline.js';

const q = new URLSearchParams(location.search);
const rendering = q.has('render');
if (rendering) document.body.classList.add('render');

let shots = SHOTS;
if (q.get('scene')) {
  const num = k => (q.has(k) ? +q.get(k) : undefined);
  shots = [{ t0: 0, t1: 1e9, scene: q.get('scene'), mode: q.get('mode') || undefined, variant: num('variant') ?? 0, seed: num('seed') ?? 1,
    dither: q.get('dither') !== '0', cell: num('cell'), contrast: num('contrast'), exposure: num('exposure'), gamma: num('gamma') }];
}

const canvas = document.getElementById('out'), tt = document.getElementById('tt');
const engine = new Engine(canvas, shots);
await document.fonts.load('700 50px "IBM Plex Mono"');
await document.fonts.load('400 50px "IBM Plex Mono"');
await engine.load([...new Set(shots.map(s => s.scene))], n => { tt.textContent = 'loading ' + n + '…'; });
window.engine = engine;

window.renderAt = async (t, type = 'image/jpeg', quality = 0.93) => {
  engine.frame(t);
  return canvas.toDataURL(type, quality);
};
// Contact sheet of several times for quick visual checks: returns { url, ms[] }.
window.renderSheet = async (times, cols = 3, w = 640) => {
  const h = Math.round(w * H / W), rows = Math.ceil(times.length / cols), sc = document.createElement('canvas');
  sc.width = cols * w; sc.height = rows * h; const c = sc.getContext('2d'), ms = [];
  for (let i = 0; i < times.length; i++) {
    const t0 = performance.now(); engine.frame(times[i]); ms.push(Math.round(performance.now() - t0));
    const x = (i % cols) * w, y = Math.floor(i / cols) * h;
    c.drawImage(canvas, x, y, w, h); c.fillStyle = 'rgba(0,0,0,.7)'; c.fillRect(x, y, 110, 24); c.fillStyle = '#fff'; c.font = '15px monospace'; c.fillText(times[i].toFixed(2) + 's', x + 6, y + 17);
  }
  return { url: sc.toDataURL('image/jpeg', 0.9), ms };
};
window.ready = true;

if (!rendering) {
  const audio = document.getElementById('audio'), scrub = document.getElementById('scrub'), play = document.getElementById('play');
  audio.currentTime = +(q.get('t') || 0);
  let last = -1;
  const loop = () => {
    const t = audio.currentTime;
    if (t !== last || !audio.paused) {
      const t0 = performance.now(); engine.frame(t); last = t;
      if (!scrubbing) scrub.value = t;
      tt.textContent = `${t.toFixed(2)} s · ${Math.round(performance.now() - t0)} ms`;
    }
    requestAnimationFrame(loop);
  };
  let scrubbing = false;
  scrub.addEventListener('input', () => { scrubbing = true; audio.currentTime = +scrub.value; });
  scrub.addEventListener('change', () => { scrubbing = false; });
  play.addEventListener('click', () => { audio.paused ? audio.play() : audio.pause(); });
  audio.addEventListener('play', () => { play.textContent = 'pause'; });
  audio.addEventListener('pause', () => { play.textContent = 'play'; });
  addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); play.click(); } });
  requestAnimationFrame(loop);
}
