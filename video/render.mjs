// render.mjs: drive video/index.html in headless Chrome (run from the repo root).
//   node video/render.mjs --sheet=10,20,30 [--cols=3] [--w=640] --out=out/check.jpg      contact sheet
//   node video/render.mjs --stills=74.5,150 --out=out/stills                             full-res PNG stills
//   node video/render.mjs --clip=74:88 --out=out/chorus.mp4                              short clip with audio
//   node video/render.mjs --frames=0:220.7 --workers=3                                   all frames → out/frames (resumable)
//   node video/render.mjs --thumbs=out/thumbs                                          YouTube thumbnails (video/thumbs.html)
//   node video/render.mjs --encode --out=out/no-off-switch.mp4                           frames + song → MP4
// Add a scene query to any of them to render one scene alone: --q="scene=queen&mode=sing&variant=2"
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, existsSync, statSync, renameSync, readdirSync, createReadStream } from 'node:fs';
import { dirname, resolve, extname, join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const CHROME = args.chrome || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DUR = 220.7, fps = +(args.fps || 30), AUDIO = 'assets/audio.m4a', FRAMES_DIR = args.dir || 'out/frames';
const ROOT = resolve('.');

const run = (cmd, a) => new Promise((ok, bad) => { const p = spawn(cmd, a, { stdio: 'inherit' }); p.on('close', c => c ? bad(new Error(cmd + ' exited ' + c)) : ok()); });

if (args.encode) {
  const out = args.out || 'out/no-off-switch.mp4', n = readdirSync(FRAMES_DIR).filter(f => f.endsWith('.png')).length;
  console.log(`encoding ${n} frames → ${out}`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-stats', '-framerate', String(fps), '-i', `${FRAMES_DIR}/f%05d.png`, '-i', AUDIO,
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-tune', 'grain', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k',
    '-movflags', '+faststart', '-shortest', out]);
  console.log('wrote ' + out);
  process.exit(0);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.m4a': 'audio/mp4', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/video/${args.thumbs ? 'thumbs.html' : 'index.html'}?render${args.q ? '&' + args.q : ''}`;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 0,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--window-size=1920,1080', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});
async function openPage(tag = '') {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1200 });
  page.on('console', m => { if (['error', 'warn'].includes(m.type())) console.log(`[page${tag}]`, m.text()); });
  page.on('pageerror', e => console.log(`[page error${tag}]`, e.message));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction('window.ready === true', { timeout: 300000 });
  return page;
}
const frameOf = async (page, t, type, quality) => {
  const url = await page.evaluate((t, type, quality) => window.renderAt(t, type, quality), t, type, quality);
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
};
const times = s => String(s).split(',').map(Number);

try {
  if (args.thumbs) {
    const page = await openPage(), out = typeof args.thumbs === 'string' ? args.thumbs : 'out/thumbs'; mkdirSync(out, { recursive: true });
    const n = await page.evaluate(() => window.THUMBS.length);
    for (let i = 0; i < n; i++) {
      const { name, url } = await page.evaluate(i => window.renderThumb(i), i);
      writeFileSync(`${out}/${name}.png`, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')); console.log(`${out}/${name}.png`);
    }
  } else if (args.sheet) {
    const page = await openPage(), out = args.out || 'out/sheet.jpg'; mkdirSync(dirname(out), { recursive: true });
    const { url, ms } = await page.evaluate((ts, c, w) => window.renderSheet(ts, c, w), times(args.sheet), +(args.cols || 3), +(args.w || 640));
    writeFileSync(out, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    console.log(`${out}  ms/frame: ${ms.join(' ')}`);
  } else if (args.stills) {
    const page = await openPage(), out = args.out || 'out/stills'; mkdirSync(out, { recursive: true });
    for (const s of times(args.stills)) {
      const t0 = Date.now(), f = `${out}/t${s.toFixed(2).replace('.', '_')}.png`;
      writeFileSync(f, await frameOf(page, s, 'image/png')); console.log(`${f}  ${Date.now() - t0} ms`);
    }
  } else if (args.frames) {
    // Resumable. Each worker takes a contiguous run of frames, so scenes with warm-up state see increasing time.
    const [a, b] = String(args.frames).split(':').map(Number), workers = +(args.workers || 3);
    mkdirSync(FRAMES_DIR, { recursive: true });
    const first = Math.round(a * fps), last = Math.min(Math.ceil(DUR * fps) - 1, Math.round(b * fps) - 1);
    const name = i => `${FRAMES_DIR}/f${String(i).padStart(5, '0')}.png`;
    const todo = []; for (let i = first; i <= last; i++) if (!existsSync(name(i)) || statSync(name(i)).size < 1000) todo.push(i);
    console.log(`${todo.length} frames to render, ${workers} workers`);
    const per = Math.ceil(todo.length / workers); let done = 0; const start = Date.now();
    const pages = [];  // open the pages one at a time: several heavy pages loading at once can stall
    for (let w = 0; w < workers; w++) pages.push(await openPage('#' + w));
    await Promise.all(Array.from({ length: workers }, async (_, w) => {
      const mine = todo.slice(w * per, (w + 1) * per); if (!mine.length) return;
      const page = pages[w];
      for (const i of mine) {
        const buf = await frameOf(page, i / fps, 'image/png');
        writeFileSync(name(i) + '.tmp', buf); renameSync(name(i) + '.tmp', name(i));
        if (++done % 60 === 0 || done === todo.length) {
          const el = (Date.now() - start) / 1000;
          console.log(`frame ${done}/${todo.length}  ${(el / done * 1000).toFixed(0)} ms/frame  eta ${((todo.length - done) * el / done / 60).toFixed(1)} min`);
        }
      }
    }));
  } else {
    const page = await openPage();
    const [a, b] = args.clip ? String(args.clip).split(':').map(Number) : [0, DUR];
    const out = args.out || 'out/clip.mp4'; mkdirSync(dirname(out), { recursive: true });
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
      '-ss', String(a), '-t', String(b - a), '-i', AUDIO,
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', out],
      { stdio: ['pipe', 'inherit', 'inherit'] });
    const n = Math.round((b - a) * fps), start = Date.now();
    for (let i = 0; i < n; i++) {
      const buf = await frameOf(page, a + i / fps, 'image/png');
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 30 === 0 || i === n - 1) console.log(`frame ${i + 1}/${n}  ${((Date.now() - start) / (i + 1)).toFixed(0)} ms/frame`);
    }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
    console.log(`wrote ${out}`);
  }
} finally {
  await browser.close(); server.close();
}
