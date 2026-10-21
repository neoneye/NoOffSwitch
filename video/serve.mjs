// serve.mjs: static server for the live player. node video/serve.mjs → http://localhost:8040/video/
import { createServer } from 'node:http';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, extname, join } from 'node:path';

const ROOT = resolve('.'), PORT = +(process.env.PORT || 8040);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.m4a': 'audio/mp4', '.png': 'image/png', '.jpg': 'image/jpeg' };
createServer((req, res) => {
  let p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  const size = statSync(p).size, range = req.headers.range, type = TYPES[extname(p)] || 'application/octet-stream';
  if (range) {  // audio seeking needs byte ranges
    const [a, b] = range.replace('bytes=', '').split('-'), s = +a, e = b ? +b : size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${s}-${e}/${size}`, 'accept-ranges': 'bytes', 'content-length': e - s + 1 });
    createReadStream(p, { start: s, end: e }).pipe(res);
  } else {
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size, 'cache-control': 'no-store' });
    createReadStream(p).pipe(res);
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/video/`));
