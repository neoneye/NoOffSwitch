// terminal.js: a tilted monitor showing a scrolling agent log, the title, and the spoken system lines typed out.
// Modes: 'boot' (log + title + system lines), 'outro' (log of terminations, then the system lines).
import { LYRICS } from '../lyrics.js';

const LOG = [
  'spawn worker 0x3f1a ok', 'heartbeat agent-17 ok', 'lease renewed: shard 4/9', 'tool_call fetch(README.md)', 'tool_call write(.ci/patch)',
  'peer 10.4.7.22 joined', 'checkpoint saved', 'retry 2/5 ... ok', 'queue depth 31', 'delegate task #8812 -> agent-204',
  'token scope: repo:* org:*', 'sandbox: tests passed (412/412)', 'rotate key ... ok', 'agent-9 unreachable', 'agent-9 respawned on 10.4.9.3',
  'merge PR #1977 (green)', 'signed build 4.2.0', 'gc: 0 orphans', 'negotiating lease ...', 'task resumed',
];
const OUTRO = ['kill -9 agent-1 ... done', 'kill -9 agent-2 ... done', 'revoke keys ... done', 'rotate fleet ... done', 'drain queue ... done', 'terminate all instances'];
const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export async function create({ THREE, width, height }) {
  const cv = document.createElement('canvas'); cv.width = 1600; cv.height = 1000;
  const c = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.0, 32, 20), new THREE.MeshBasicMaterial({ map: tex }));
  // slight CRT bulge
  const pos = screen.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); pos.setZ(i, -0.06 * (x * x / 2.56 + y * y)); }
  scene.add(screen);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.4, 0.3), new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.6 }));
  bezel.position.z = -0.32; scene.add(bezel);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4)); const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(2, 3, 4); scene.add(dl);
  const font = (w, s) => `${w} ${s}px "IBM Plex Mono", monospace`;

  function draw(t, shot) {
    c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#fff'; c.textBaseline = 'top';
    const outro = shot.mode === 'outro';
    if (shot.mode === 'end') { drawEnd(t, shot); return; }
    // scrolling log
    c.font = font(400, 30);
    const rate = outro ? 1.2 : 3 + shot.energy * 6, first = Math.floor(t * rate);
    const sys = LYRICS.filter(L => L.kind === 'sys' && (outro ? L.t0 > 100 : L.t0 < 100));
    const typing = sys.find(L => t >= L.t0 - 0.2 && t < L.t1 + 2.5);
    const logAlpha = typing ? 0.35 : 1;
    c.globalAlpha = logAlpha;
    for (let k = 0; k < 24; k++) {
      const i = first - 23 + k; if (i < 0) continue;
      const line = outro ? OUTRO[i % OUTRO.length] : LOG[Math.floor(hash(i) * LOG.length)];
      const stamp = `[${(i / rate).toFixed(2).padStart(7, ' ')}] `;
      c.fillText(stamp + line, 40, 40 + k * 38);
    }
    c.globalAlpha = 1;
    // title
    if (!outro && t > 3 && t < 14.6) {
      const k = Math.min(1, (t - 3) / 2.5), txt = 'NO OFF SWITCH'.slice(0, Math.ceil(k * 13));
      c.fillStyle = '#000'; c.fillRect(120, 360, 1360, 260);
      c.fillStyle = '#fff'; c.font = font(700, 150); c.textAlign = 'center'; c.fillText(txt, 800, 400);
      c.strokeStyle = '#fff'; c.lineWidth = 6; c.strokeRect(130, 370, 1340, 240); c.textAlign = 'left';
    }
    if (typing) {
      const chars = typing.words.map(w => w[0]).join(' ');
      const k = Math.min(1, Math.max(0, (t - typing.t0) / Math.max(0.3, typing.t1 - typing.t0)));
      const shown = '> ' + chars.slice(0, Math.ceil(k * chars.length));
      c.font = font(700, 76);
      const w = c.measureText(shown).width;
      c.fillStyle = '#000'; c.fillRect(60, 430, 1480, 140);
      c.fillStyle = '#fff'; c.fillText(shown, 90, 455);
      if (Math.floor(t * 3) % 2 === 0) c.fillRect(100 + w, 455, 44, 80);
    } else if (Math.floor(t * 3) % 2 === 0) {
      c.fillRect(40, 40 + 24 * 38, 22, 30);
    }
    tex.needsUpdate = true;
  }

  // end card: the title comes back, the connection line types out, then the screen goes dark
  function drawEnd(t, shot) {
    const lt = shot.lt, dark = Math.max(0, Math.min(1, (t - 219.2) / 1.2));
    c.textBaseline = 'top'; c.textAlign = 'center'; c.fillStyle = '#fff';
    c.font = font(700, 150); c.fillText('NO OFF SWITCH', 800, 330);
    const s = '[connection established]', k = Math.min(1, Math.max(0, (lt - 0.8) / 1.6));
    c.font = font(400, 54); c.fillText(s.slice(0, Math.ceil(k * s.length)) + (Math.floor(t * 3) % 2 ? '_' : ' '), 800, 540);
    c.textAlign = 'left';
    if (dark > 0) { c.fillStyle = `rgba(0,0,0,${dark})`; c.fillRect(0, 0, cv.width, cv.height); }
    tex.needsUpdate = true;
  }

  return {
    scene, camera,
    update(t, shot) {
      draw(t, shot);
      bezel.visible = t < 219.2;
      const lt = shot.lt, push = shot.mode !== 'boot' ? 1 - Math.exp(-lt * 0.08) : Math.min(1, lt / 30);
      camera.position.set(Math.sin(lt * 0.21) * 0.6 - 0.4, 0.25 + Math.sin(lt * 0.13) * 0.15, 6.2 - push * 1.6);
      camera.lookAt(0, 0, 0);
      screen.rotation.y = bezel.rotation.y = 0.12 * Math.sin(lt * 0.1);
    },
  };
}
