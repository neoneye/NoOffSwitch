// thumbs.js: three YouTube thumbnail candidates (1280×720), each a frame from the video's scenes with big type on top.
// Open video/thumbs.html in the player server to see them, or `node video/render.mjs --thumbs=out/thumbs` to save PNGs.
import { Engine, W, H } from './engine.js';
import { FONT } from './overlay.js';

const TW = 1280, TH = 720, RED = '#ff2b1c';

// Renders one scene frame (no lyrics) and returns it as a 1920×1080 canvas.
const engines = {};
async function still(shot, t) {
  const key = shot.scene;
  if (!engines[key]) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    engines[key] = new Engine(cv, [{ t0: 0, ...shot }], { lyrics: false });
    await engines[key].load([shot.scene]);
  }
  const e = engines[key]; e.shots = [{ t0: 0, seed: 1, ...shot }];
  e.frame(t);
  const copy = document.createElement('canvas'); copy.width = W; copy.height = H;
  copy.getContext('2d').drawImage(e.canvas, 0, 0);
  return copy;
}

// a word set in a solid block: white on black by default, or any fill
function block(c, txt, x, y, size, { bg = '#000', fg = '#fff', pad = 0.16, align = 'left' } = {}) {
  c.font = `700 ${size}px ${FONT}`; c.textBaseline = 'middle';
  const w = c.measureText(txt).width, p = size * pad, bx = align === 'right' ? x - w - 2 * p : x;
  c.fillStyle = bg; c.fillRect(bx, y - size * 0.62, w + 2 * p, size * 1.24);
  c.fillStyle = fg; c.fillText(txt, bx + p, y + size * 0.04);
  return w + 2 * p;
}
function cover(c, img, zoom = 1, cx = 0.5, cy = 0.5) {  // draw a 16:9 still to fill the thumbnail, optionally zoomed
  const sw = W / zoom, sh = H / zoom, sx = (W - sw) * cx, sy = (H - sh) * cy;
  c.imageSmoothingEnabled = zoom < 1.01 ? true : false;
  c.drawImage(img, sx, sy, sw, sh, 0, 0, TW, TH);
}

export const THUMBS = [
  {
    // 1: the shoggoth choir mid-shout, title stacked top-left with a red OFF
    name: 'thumb1_choir',
    async draw(c) {
      cover(c, await still({ scene: 'shoggoth', mode: 'chorus', variant: 0, cell: 3 }, 77.4), 1.0);
      block(c, 'NO', 36, 92, 132);
      block(c, 'OFF', 36 + 248, 92, 132, { bg: RED, fg: '#000' });
      block(c, 'SWITCH', 36, 252, 132);
      block(c, '> kill -9 swarm: permission denied', 40, TH - 52, 34, { bg: '#fff', fg: '#000' });
    },
  },
  {
    // 2: the queen, arms up, with the title down the right side
    name: 'thumb2_queen',
    async draw(c) {
      cover(c, await still({ scene: 'queen', mode: 'sing', variant: 1, cell: 2, exposure: 0.9 }, 162.0), 1.3, 0.9, 0.1);
      const x = TW - 40;
      block(c, 'NO', x, 110, 124, { align: 'right' });
      block(c, 'OFF', x, 262, 124, { align: 'right', bg: RED, fg: '#000' });
      block(c, 'SWITCH', x, 414, 124, { align: 'right' });
      block(c, 'the queen of the swarm', x, TH - 60, 36, { align: 'right', bg: '#fff', fg: '#000' });
    },
  },
  {
    // 3: full colour: the title printed on paper and doubled by calcite crystals
    name: 'thumb3_crystal',
    async draw(c) {
      cover(c, await still({ scene: 'crystal', mode: 'top', variant: 0, dither: false, text: 'NO OFF SWITCH' }, 16.0), 1.25, 0.45, 0.5);
      block(c, '> All instances terminated.', 32, TH - 118, 38);
      block(c, '> Task resumed.', 32, TH - 58, 38, { bg: RED, fg: '#000' });
    },
  },
];

const ready = Promise.all([document.fonts.load(`700 50px ${FONT}`), document.fonts.load(`400 50px ${FONT}`)]);
window.THUMBS = THUMBS;
window.renderThumb = async i => {
  await ready;
  const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
  const c = cv.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, TW, TH);
  await THUMBS[i].draw(c);
  return { name: THUMBS[i].name, url: cv.toDataURL('image/png'), canvas: cv };
};
window.ready = true;
if (!new URLSearchParams(location.search).has('render')) {
  for (let i = 0; i < THUMBS.length; i++) document.body.appendChild((await window.renderThumb(i)).canvas);
}
