// shoggoth.js: the agent swarm as shoggoths, ported from assets/3d-shoggoth (procedural genomes, novelty search,
// layout and mesh building live in ./shoggoth/). Every creature on screen is a different genome, picked by the
// experiment's novelty search from a stream seeded by `variant`, so variant N always shows the same cast.
// Modes:
//   solo    one hero shoggoth, low slow orbiting camera, menacing
//   swarm   8..30 different shoggoths spread as a colony, camera flying low over them (crowd LOD)
//   chorus  a choir wall of shoggoths facing camera, mouths on the sung words, eyes and bodies on the beat
//   emerge  one shoggoth coming out of total darkness: eyes first, then rim, then key light (over shot.p)
//   split   one shoggoth is killed (flash, shrink) and ten different ones pop up around it, on the beats
import * as THREE from 'three';
import { makeCreature, poseCreature, setGlow, S } from './shoggoth/build.js';
import { voiceAt } from '../engine.js';

export const meta = { modes: ['solo', 'swarm', 'chorus', 'emerge', 'split'], variants: 1000 };   // any integer >= 0 works

const { clamp, lerp, smooth } = S;
const TAU = Math.PI * 2;
const FLOOR = .0015;   // floor albedo (linear): dark, so lit creatures separate from it
const hashInt = (a, b = 0) => {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); return (h ^ (h >>> 16)) >>> 0;
};
const rand = (a, b) => hashInt(a, b) / 4294967296;
const easeOutBack = (x) => { const c = 1.9; x = clamp(x, 0, 1); return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

// ---- cast: genomes per variant, creatures cached per (genome, lod) ---------------------------------
const pools = new Map();
function pool(variant, n) {
  let p = pools.get(variant);
  if (!p) { p = { rng: S.makeRng(hashInt(variant, 0x5106)), list: [] }; pools.set(variant, p); }
  while (p.list.length < n) p.list.push(S.pickNovel(p.list, p.rng, 48));
  return p.list;
}
// Roles nudge a genome so it can do its job on screen: singers need a front-facing mouth and some eyes.
function forRole(g, role) {
  if (role === 'crowd') return g;
  const o = { ...g };
  if (o.eyes === 0) o.eyes = 2 + (o.seed % 6);
  if (o.mouths === 0) o.mouths = 1 + (o.seed % 3);
  if (o.mouthPlace === 'arms' || o.mouthPlace === 'body') o.mouthPlace = o.heads && (o.seed & 2) ? 'heads' : 'belly';
  o.mouthSize = Math.max(o.mouthSize, 1);
  if (role === 'hero') o.eyeSize = Math.max(o.eyeSize, 1.2);
  if (role === 'singer') {
    // one to three big mouths on the front, a manageable number of eyes, arms that do not hide the choir
    o.mouths = 1 + (o.seed % 3 === 0 ? 1 : 0); o.mouthPlace = 'belly'; o.mouthSize = Math.max(o.mouthSize, 1.6);
    o.eyes = Math.min(o.eyes, 24); o.armLen = Math.min(o.armLen, .45); o.arms = Math.min(o.arms, 10);
  }
  return S.normalizeGenome(o);
}
const recs = new Map();
function creature(g, lod) {
  const key = JSON.stringify(g) + '|' + lod;
  let r = recs.get(key);
  if (!r) {
    r = makeCreature(g, { lod });
    // framing box from the built meshes at rest (the layout's own bounds over-estimate reach a lot)
    r.root.position.set(0, 0, 0); r.root.rotation.set(0, 0, 0); r.root.scale.setScalar(1); r.root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(r.root);
    r.fit = { h: Math.max(.8, b.max.y), w: Math.max(b.max.x - b.min.x, b.max.z - b.min.z, .8), cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2 };
    recs.set(key, r);
  }
  return r;
}
const swarmCount = (v) => [22, 14, 30, 10, 26, 18, 8, 24, 16, 28, 12, 20][v % 12];
const chorusRows = (v) => [[3, 4, 5], [3, 4], [4, 5], [2, 3, 4], [3, 4, 3]][v % 5];
const casts = new Map();
function cast(mode, variant) {
  const v = Math.max(0, Math.floor(variant || 0)), key = mode + v;
  if (!casts.has(key)) casts.set(key, castOf(mode, v));
  return casts.get(key);
}
function castOf(mode, v) {
  if (mode === 'swarm') return pool(v, swarmCount(v)).map((g) => creature(g, 2));
  if (mode === 'chorus') {
    const n = chorusRows(v).reduce((a, b) => a + b, 0), list = pool(v, n).map((g) => creature(forRole(g, 'singer'), 1));
    // the most upright, face-like singers stand in the front row, the best one in the middle
    const order = list.map((r, i) => ({ r, i, k: r.fit.h / r.fit.w })).sort((a, b) => b.k - a.k || a.i - b.i).map((o) => o.r);
    const front = order.slice(0, chorusRows(v)[0]), mid = [];
    front.forEach((r, i) => { if (i % 2) mid.unshift(r); else mid.push(r); });
    return [...mid, ...order.slice(front.length)];
  }
  if (mode === 'split') return pool(v, 11).map((g, i) => creature(forRole(g, i ? 'crowd' : 'hero'), i ? (i < 5 ? 1 : 2) : 0));
  return [creature(forRole(pool(v, 1)[0], 'hero'), 0)];
}

// ---- singing ---------------------------------------------------------------------------------------
// Mouth opening from the vocal: open while a word sounds, articulated into rough syllables, wide on shouts.
function mouthAt(t, shot, lag = 0) {
  const v = lag ? voiceAt(t - lag) : { sing: shot.sing, word: shot.word, line: shot.line };
  if (!v.sing) return 0;
  let u = .5, syl = 1;
  const L = v.line;
  if (L) for (const [w, a, b] of L.words) if (t - lag >= a - .06 && t - lag <= b + .12) { u = clamp((t - lag - a) / Math.max(.08, b - a), 0, 1); syl = Math.max(1, Math.round(w.replace(/[^a-z]/gi, '').length / 3)); }
  const shout = L && L.kind === 'shout';
  const art = shout ? .85 + .15 * Math.abs(Math.sin(Math.PI * u * syl)) : .45 + .55 * Math.abs(Math.sin(Math.PI * (u * syl + .15)));
  return clamp(v.sing * art * (shout ? 1.05 : .95), 0, 1);
}

export async function create({ width, height, renderer }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 10, 40);   // linear, set per mode: near = subject, far = darkness
  const camera = new THREE.PerspectiveCamera(35, width / height, .1, 200);

  // A studio environment that is black except for a few softboxes: glossy skin, slime and eyeballs get crisp
  // white highlight streaks (they survive 1-bit), and nothing gets a grey ambient wash.
  {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x000000);
    const panel = (w, h, pos, look, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
      m.position.set(...pos); m.lookAt(...look); env.add(m);
    };
    panel(6, 3, [3, 6, 6], [0, 0, 0], 4);       // key softbox, front right above
    panel(1, 8, [-7, 3, -5], [0, 0, 0], 3);     // rim strips behind
    panel(1, 8, [7, 3, -5], [0, 0, 0], 3);
    panel(10, 1, [0, -3, 6], [0, 0, 0], .4);    // faint floor bounce
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0, .1, 100).texture;
    pm.dispose();
  }

  const hemi = new THREE.HemisphereLight(0x9aa4b0, 0x000000, .25);
  const key = new THREE.SpotLight(0xfff2e0, 4, 0, .55, .7, 0);
  const rimL = new THREE.DirectionalLight(0xffffff, 3), rimR = new THREE.DirectionalLight(0xffffff, 3);
  const under = new THREE.PointLight(0xffffff, 0, 0, 2);
  scene.add(hemi, key, key.target, rimL, rimL.target, rimR, rimR.target, under);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x2a2a2a }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // soft contact shadows (no shadow maps: cheap, and the renderer's shadow state stays untouched)
  const sc = document.createElement('canvas'); sc.width = sc.height = 128;
  { const c = sc.getContext('2d'), gr = c.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(.55, 'rgba(0,0,0,.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(0, 0, 128, 128); }
  const shadowTex = new THREE.CanvasTexture(sc);
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadows = Array.from({ length: 40 }, () => { const m = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })); m.renderOrder = 1; return m; });

  // pools of light on the floor (the floor itself is almost black): a soft disc that dithers into rings
  const pc = document.createElement('canvas'); pc.width = pc.height = 256;
  { const c = pc.getContext('2d'), gr = c.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.45, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 256, 256); }
  const poolTex = new THREE.CanvasTexture(pc);
  const poolMeshes = Array.from({ length: 4 }, () => { const m = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); m.renderOrder = 0; return m; });
  let poolIndex = 0;
  function lightPool(x, y, z, rx, rz, k) {
    if (poolIndex >= poolMeshes.length || k <= 0) return;
    const m = poolMeshes[poolIndex++];
    m.position.set(x, y + .005, z); m.scale.set(rx * 2, 1, rz * 2); m.material.color.setScalar(k); stage.add(m);
  }

  // kill shockwave for 'split'
  const wave = new THREE.Mesh(new THREE.RingGeometry(.92, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const flashLight = new THREE.PointLight(0xffffff, 0, 0, 0);
  scene.add(flashLight);

  const stage = new THREE.Group();
  scene.add(stage);
  const frustum = new THREE.Frustum(), projView = new THREE.Matrix4(), sphere = new THREE.Sphere();

  // Place a creature: feet centre at (x, y, z), turned by yaw, scaled to fit height h / width w.
  let shadowIndex = 0;
  function place(r, x, y, z, yaw, size, opt = {}) {
    const f = r.fit, s = size * Math.min(1 / f.h, (opt.aspect ?? 1.25) / f.w) * (opt.grow ?? 1);
    const sq = opt.squash || 0;
    const root = r.root;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const ox = -(f.cx * c + f.cz * sn) * s, oz = -(-f.cx * sn + f.cz * c) * s;
    root.position.set(x + ox, y + (opt.lift || 0), z + oz);
    root.rotation.set(opt.tilt || 0, yaw, opt.roll || 0);
    root.scale.set(s * (1 + sq * .5), s * (1 - sq), s * (1 + sq * .5));
    root.visible = s > 1e-4;
    sphere.center.set(x, y + f.h * s * .5, z); sphere.radius = Math.max(f.h, f.w) * s * .75;
    if (!root.visible || !frustum.intersectsSphere(sphere)) return false;
    stage.add(root);
    if (opt.shadow !== false && shadowIndex < shadows.length) {
      const m = shadows[shadowIndex++], k = f.w * s * 1.15;
      m.position.set(x, y + .015, z); m.scale.set(k, 1, k * .85);
      m.material.opacity = clamp(.9 - (opt.lift || 0) / (f.h * s) * 1.5, .2, .9);
      stage.add(m);
    }
    return true;
  }
  // Scaled height / width of a creature placed with `size` and `aspect` (see place), and a camera distance that
  // makes it fill `fill` of the frame height without overflowing the width.
  function fitOf(r, size, aspect, fill = .62, fov = 34) {
    const f = r.fit, s = size * Math.min(1 / f.h, aspect / f.w), h = f.h * s, w = f.w * s;
    const k = 2 * Math.tan(fov * Math.PI / 360);
    return { h, w, d: clamp(Math.max(h / (fill * k), w / (.85 * k * width / height)), 4, 16) };
  }
  function look(px, py, pz, tx, ty, tz, fov = 35) {
    camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
  }
  function rig({ keyPos, keyAt, keyI = 4, angle = .55, rimI = 3, rimL: rl = [-6, 7, -9], rimR: rr = [7, 5, -9], at = [0, 1, 0], hemiI = .25, underI = 0, underPos = [0, .3, 3] }) {
    key.position.set(...keyPos); key.target.position.set(...(keyAt || at)); key.intensity = keyI; key.angle = angle;
    rimL.position.set(...rl); rimR.position.set(...rr);
    rimL.target.position.set(...at); rimR.target.position.set(...at);
    rimL.intensity = rimI; rimR.intensity = rimI * .8;
    hemi.intensity = hemiI;
    under.intensity = underI; under.position.set(...underPos);
  }
  // Beat helpers: time of beat i, derived from the beat state the engine passes in.
  const beatTime = (shot, i) => shot.t - (shot.beat.index + shot.beat.phase) * shot.beat.period + i * shot.beat.period;
  const envK = (r, k) => { if (r._env === k) return; r._env = k; for (const m of r.materials) m.envMapIntensity = k; };
  const fogAt = (near, far) => { scene.fog.near = Math.max(0, near); scene.fog.far = far; };
  const en = (shot) => clamp((shot.energy || 0) * 2.2, 0, 1);

  // per-creature beat animation: hop landing on the beat, squash on impact, blinks on staggered beats
  function groove(shot, i, k = 1) {
    const b = shot.beat, e = en(shot);
    const ph = (b.phase + rand(i, 77) * .06) % 1;
    const hop = Math.sin(Math.PI * ph) * (.06 + .3 * e) * k;
    const squash = Math.exp(-ph * 9) * (.05 + .1 * e) * k - Math.sin(Math.PI * ph) * .03 * k;
    const blinkBeat = (b.index + (i * 3 % 4)) % 4 === 0;
    const blink = blinkBeat ? Math.max(0, 1 - Math.abs(ph - .06) / .1) : 0;
    return { hop, squash, blink, pulse: b.pulse * (.4 + .6 * e) * k, roll: Math.sin((b.index % 2 ? 1 : -1) * Math.PI * ph) * .03 * k };
  }

  const modes = {
    solo(t, shot) {
      const [r] = cast('solo', shot.variant);
      const lt = shot.lt, a = rand(shot.variant, 3) * TAU + lt * .1, F = fitOf(r, 3.4, 2, .64), H = F.h;
      const dist = F.d * (1.08 - Math.min(1, lt / 25) * .14) + Math.sin(lt * .21) * .2;
      look(Math.sin(a) * dist, H * .18 + Math.sin(lt * .13) * .15, Math.cos(a) * dist, 0, H * .46, 0, 34);
      rig({ keyPos: [Math.sin(a + .9) * 7, 3.2, Math.cos(a + .9) * 7], at: [0, H * .5, 0], keyI: 9, angle: .5, rimI: 6,
        rimL: [Math.sin(a + 2.6) * 8, 6, Math.cos(a + 2.6) * 8], rimR: [Math.sin(a - 2.6) * 8, 4, Math.cos(a - 2.6) * 8], underI: 8, underPos: [Math.sin(a) * 4, 1, Math.cos(a) * 4] });
      fogAt(dist - 2, dist + 14);
      const e = en(shot), b = shot.beat;
      const heave = .5 + .5 * Math.sin(lt * .9);
      place(r, 0, 0, 0, 0, 3.4, { aspect: 2, squash: -heave * .03 - b.pulse * e * .04 });
      lightPool(0, 0, 0, F.w * .9 + 1, F.w * .9 + 1, .3 + b.pulse * e * .15);
      poseCreature(r, t, { cam: camera.position, pulse: b.pulse * e * .6, wob: .9 + e * .6 });
      setGlow(r, 0, 0); envK(r, 1);
    },

    emerge(t, shot) {
      const [r] = cast('emerge', shot.variant);
      const p = clamp(shot.p, 0, 1), lt = shot.lt, F = fitOf(r, 3.4, 2, .66, 33), H = F.h;
      const eyes = smooth(.03, .22, p), rim = smooth(.18, .65, p), keyK = smooth(.42, .95, p);
      const dist = F.d * lerp(1.35, .95, smooth(0, 1, p));
      look(Math.sin(lt * .05) * .6, H * (.3 + p * .1), dist, 0, H * .5, 0, 33);
      rig({ keyPos: [4.5, 6, 6], at: [0, H * .5, 0], keyI: 9 * keyK, angle: .5, rimI: 5 * rim, hemiI: .2 * keyK, underI: 6 * keyK, underPos: [0, 1, 4.5] });
      floor.material.color.setScalar(FLOOR * keyK);
      fogAt(dist - 3, dist + lerp(2, 14, rim));
      envK(r, rim);
      const b = shot.beat;
      place(r, 0, 0, 0, 0, 3.4, { aspect: 2, squash: -Math.sin(lt * .8) * .02, shadow: keyK > .05 });
      lightPool(0, 0, 0, F.w * .9 + 1, F.w * .9 + 1, .3 * keyK);
      const opening = 1 - smooth(.06, .16, p);
      poseCreature(r, t, { cam: camera.position, blink: opening, pulse: b.pulse * .3 * eyes, wob: .5 + .5 * p });
      setGlow(r, 0, eyes * (1 - keyK * .7));
    },

    chorus(t, shot) {
      const rows = chorusRows(shot.variant), list = cast('chorus', shot.variant);
      const lt = shot.lt, b = shot.beat, e = en(shot), nRows = rows.length, ASP = 1.5;
      // measure the front row so every framing fits whatever creatures this variant has
      let hf = 0;
      for (let k = 0; k < rows[0]; k++) hf += fitOf(list[k], 3, ASP).h / rows[0];
      const sp = clamp(hf * 1.15, 2.4, 3.6), lift = Math.max(1, hf * .5);
      const ROW = (ri) => ({ z: -ri * 3.1, y: ri * lift, sp: sp * (1 - ri * .04), size: 3 * (1 - ri * .03) });
      const W0 = rows[0] * sp, top = (nRows - 1) * lift + hf;
      // framing changes every two bars: wide, close on the left, centre close-up from below, close on the right, low wide
      const seg = Math.floor(Math.max(0, lt) / (b.period * 8)), u = (Math.max(0, lt) / (b.period * 8)) % 1;
      const frame = (seg + shot.variant) % 5;
      const zoom = 1 - b.pulse * .015 * e, fx = rows[0] > 2 ? sp : sp * .5;
      const dWide = Math.max(W0 / 1.05, top / .68), dClose = hf / (.63 * .8);
      if (frame === 0) look(Math.sin(lt * .17) * .8, top * .6, dWide * (1.02 - u * .1), 0, top * .5, -1.5, 35 * zoom);
      else if (frame === 1) look(-fx - .6 + u * 1.2, hf * .5, dClose * (1 - u * .06), -fx * .8 + u * .4, hf * .5, 0, 35 * zoom);
      else if (frame === 2) look(Math.sin(lt * .3) * .4, hf * .12, dClose * (1.05 - u * .1), 0, hf * .58, 0, 38 * zoom);
      else if (frame === 3) look(fx + .6 - u * 1.2, hf * .5, dClose * (1 - u * .06), fx * .8 - u * .4, hf * .5, 0, 35 * zoom);
      else look(Math.sin(lt * .2) * 1.5, .45, dWide * (.95 - u * .1), 0, top * .55, -1.5, 38 * zoom);
      rig({ keyPos: [3.5, 9, 10], at: [0, hf * .4, -1], keyI: 11, angle: .5, rimI: 6.5, rimL: [-8, 8, -16], rimR: [8, 7, -16], hemiI: .15, underI: 6 + b.pulse * 14 * e, underPos: [0, hf * .4, 4.5] });
      { const d = Math.hypot(camera.position.x, camera.position.z); fogAt(d - 1, d + 9); }
      floor.material.color.setScalar(FLOOR);
      let idx = 0;
      rows.forEach((n, ri) => {
        const R = ROW(ri);
        for (let k = 0; k < n; k++, idx++) {
          const r = list[idx], x = (k - (n - 1) / 2) * R.sp;
          const gv = groove(shot, idx, 1 - ri * .15);
          const yaw = Math.atan2(camera.position.x - x, camera.position.z - R.z) * .5;
          if (place(r, x, R.y, R.z, yaw, R.size, { aspect: ASP, lift: gv.hop, squash: gv.squash, roll: gv.roll })) {
            const lag = rand(idx, 5) * .05;
            poseCreature(r, t, { cam: camera.position, mouth: mouthAt(t, shot, lag), blink: gv.blink, pulse: gv.pulse, wob: 1 + e });
            setGlow(r, 0, 0);
          }
        }
        if (!ri) lightPool(0, 0, .6, W0 * .55 + .5, 2.4, .3);
        // a dark riser under every row behind the first, so the back rows stand on something
        if (ri) { const m = risers[ri - 1]; m.position.set(0, R.y / 2, R.z); m.scale.set(n * R.sp + 1.5, R.y, 3.1); stage.add(m); }
      });
    },

    swarm(t, shot) {
      const list = cast('swarm', shot.variant), n = list.length, v = shot.variant | 0;
      const lt = shot.lt, e = en(shot);
      // A packed colony on a disc; the camera glides over it in a slow descending orbit, looking across the
      // crowd, so the frame stays full of different creatures for any shot length.
      const R = 1.55 * Math.sqrt(n) + 1, a = rand(v, 9) * TAU + lt * .07;
      const orbit = R * (1.05 - .25 * smooth(0, 40, lt)) + 2, h = 4.6 + .25 * R * (1 - smooth(0, 40, lt)) + Math.sin(lt * .31) * .4;
      const cx = Math.cos(a) * orbit, cz = Math.sin(a) * orbit;
      const tx = Math.cos(a + .35) * R * .15, tz = Math.sin(a + .35) * R * .15;
      look(cx, h, cz, tx, .4, tz, 40);
      camera.rotateZ(Math.sin(lt * .23) * .05);
      camera.updateMatrixWorld(); projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projView);
      rig({ keyPos: [cx * .6, 12, cz * .6], keyAt: [tx, 0, tz], keyI: 10, angle: .75,
        rimI: 5.5, rimL: [-cx * 2 + cz, 5, -cz * 2 - cx], rimR: [-cx * 2 - cz, 4, -cz * 2 + cx], at: [0, 0, 0], hemiI: .2 });
      { const d = Math.hypot(cx, cz, h); fogAt(d - R * .6, d + R * .9); }
      floor.material.color.setScalar(FLOOR);
      for (let i = 0; i < n; i++) {
        // sunflower spiral: even density, jittered
        const rr = R * Math.sqrt((i + .5) / n) * (.92 + rand(v * 31 + i, 1) * .16), th = i * 2.39996 + rand(v * 31 + i, 2) * .5;
        const x = Math.cos(th) * rr, z = Math.sin(th) * rr, size = 1.7 + rand(v * 31 + i, 3) * 1.1;
        const gv = groove(shot, i, .6);
        const yaw = Math.atan2(cx - x, cz - z) + (rand(v * 31 + i, 4) - .5) * 1.4;
        if (place(list[i], x, 0, z, yaw, size, { lift: gv.hop * .6, squash: gv.squash })) poseCreature(list[i], t, { cam: camera.position, wob: 1 + e });
      }
    },

    split(t, shot) {
      const list = cast('split', shot.variant), lt = shot.lt, b = shot.beat, e = en(shot), v = shot.variant | 0;
      const t0 = shot.t - lt, dur = Math.max(2, shot.dur || 8);
      // beat grid of the shot: the kill lands on the first beat after 18% of the shot, then one birth per beat (or two)
      const first = Math.ceil((t0 - beatTime(shot, 0)) / b.period);
      const killBeat = first + Math.max(2, Math.ceil(dur * .18 / b.period));
      const tKill = beatTime(shot, killBeat);
      const beatsLeft = Math.max(10, Math.floor((t0 + dur * .9 - tKill) / b.period) - 2);
      const every = Math.max(1, Math.floor(beatsLeft / 10));
      const births = Array.from({ length: 10 }, (_, j) => beatTime(shot, killBeat + 2 + j * every));
      const born = births.filter((x) => t >= x).length;
      const reach = smooth(0, 10, born + clamp((t - (births[Math.min(9, born)] || 0)) / b.period, 0, 1));
      const a = rand(v, 13) * TAU + lt * .05, hero = list[0];
      const F = fitOf(hero, 3.1, 2, .6, 35);
      const dist = lerp(F.d, 11.5, reach), camH = lerp(F.h * .3, 2.8, reach);
      look(Math.sin(a) * dist, camH, Math.cos(a) * dist, 0, lerp(F.h * .48, 1.2, reach), 0, 35);
      rig({ keyPos: [Math.sin(a + .8) * 9, 10, Math.cos(a + .8) * 9], at: [0, 1, 0], keyI: 9, angle: .7, rimI: 4.5,
        rimL: [Math.sin(a + 2.7) * 10, 6, Math.cos(a + 2.7) * 10], rimR: [Math.sin(a - 2.7) * 10, 5, Math.cos(a - 2.7) * 10], hemiI: .2 });
      fogAt(dist - 4, dist + 16);
      floor.material.color.setScalar(FLOOR);
      lightPool(0, 0, 0, lerp(F.w * .9 + 1, 6.5, reach), lerp(F.w * .9 + 1, 6.5, reach), lerp(.3, .2, reach));
      // the victim
      const k = (t - tKill) / .55;
      if (k < 1) {
        const pre = smooth(-1.2, 0, k);   // a shudder just before the hit
        const flash = k >= 0 ? Math.exp(-k * 3) : pre * .15;
        const shrink = k < 0 ? 1 : Math.pow(1 - k, 2);
        const jit = k >= 0 ? (rand(Math.floor(t * 30), 1) - .5) * .25 * (1 - k) : (rand(Math.floor(t * 30), 2) - .5) * .04 * pre;
        place(hero, jit, 0, 0, jit * 2, 3.1, { aspect: 2, grow: shrink, squash: k >= 0 ? -k * .5 : 0, shadow: true });
        poseCreature(hero, t, { cam: camera.position, blink: k >= 0 ? 1 : 0, pulse: pre, wob: 1 + pre * 2 });
        setGlow(hero, clamp(flash, 0, 1), 0); envK(hero, 1);
      }
      const kw = (t - tKill) / 1.1;
      if (kw >= 0 && kw < 1) {
        wave.scale.setScalar(.5 + kw * 9); wave.position.y = .03; wave.material.opacity = (1 - kw) * (1 - kw); stage.add(wave);
        flashLight.intensity = 14 * Math.exp(-kw * 6); flashLight.position.set(0, 1.5, 0);
      } else flashLight.intensity = 0;
      // the survivors: inner ring of four, outer ring of six, each popping up on its beat
      for (let j = 0; j < 10; j++) {
        const g = (t - births[j]) / .45;
        if (g <= 0) continue;
        const inner = j < 4, slot = inner ? j : j - 4, m = inner ? 4 : 6;
        const th = (slot / m) * TAU + (inner ? .4 : 0) + rand(v, 20 + j) * .3, rr = inner ? 2.9 : 5.2;
        const x = Math.sin(th) * rr, z = Math.cos(th) * rr;
        const r = list[j + 1], gv = groove(shot, j, .8);
        const yaw = Math.atan2(camera.position.x - x, camera.position.z - z) * .7 + Math.atan2(-x, -z) * .3;
        if (place(r, x, 0, z, yaw, inner ? 3 : 2.9, { aspect: 1.5, grow: easeOutBack(g), lift: g >= 1 ? gv.hop * .5 : 0, squash: g >= 1 ? gv.squash : 0 })) {
          poseCreature(r, t, { cam: camera.position, blink: gv.blink, pulse: gv.pulse, wob: 1 + e });
          setGlow(r, clamp(1 - g / 1.2, 0, 1) * .8, 0);
        }
      }
    },
  };

  const riserMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, envMapIntensity: 0 });
  const risers = [0, 1, 2, 3].map(() => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), riserMat));

  // Build the casts the timeline (or the dev query) will need now, so playback never stalls on a build.
  try {
    const { SHOTS } = await import('../timeline.js');
    const q = new URLSearchParams(location.search);
    const want = SHOTS.filter((s) => s.scene === 'shoggoth');
    if (q.get('scene') === 'shoggoth') want.push({ mode: q.get('mode') || 'solo', variant: +(q.get('variant') || 0) });
    for (const s of want) cast(modes[s.mode] ? s.mode : 'solo', s.variant || 0);
  } catch (err) { console.warn('shoggoth prebuild skipped', err); }

  return {
    scene, camera,
    update(t, shot) {
      stage.clear();
      shadowIndex = 0; poolIndex = 0;
      floor.material.color.setScalar(FLOOR);
      // Dev convenience: with ?scene=shoggoth the whole song is one endless shot, so the timed modes
      // (emerge, split) run in repeating 12 s windows instead of never getting anywhere.
      if ((shot.mode === 'emerge' || shot.mode === 'split') && !(shot.dur < 120)) {
        const lt = ((shot.lt % 12) + 12) % 12;
        shot = { ...shot, lt, dur: 12, p: lt / 12 };
      }
      (modes[shot.mode] || modes.solo)(t, shot);
    },
  };
}
