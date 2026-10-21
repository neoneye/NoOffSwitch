// queen.js: the singer. A port of assets/3d-queen-clothing (Queen Clothing Simulator: royal gowns 1500–2000) with an
// arm/pose rig that dances and sings to the song. Helpers live in ./queen/ (qc.js = the experiment's shared code,
// build.js = its mesh/material code, rig.js = choreography, gowns.js = variants and morph paths).
// Modes:
//   'sing'     medium shot, singing toward the camera (reaching arm while she sings), slow camera drift
//   'wide'     full figure, orbiting camera, dancing with twirls and a swinging skirt / train
//   'morph'    full figure; the gown morphs through eras and commissions across the shot (driven by shot.p)
//   'gallery'  5, 7 or 9 different queens side by side, dancing in sync (mirrored pairs)
//   'closeup'  head and shoulders: ruff, crown, face, mouth, hands coming up to the face
// variant: any integer ≥ 0. 0..5 = era presets 1500, 1600, 1700, 1800, 1900, 2000; ≥ 6 = seeded commissions.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QC } from './queen/qc.js';
import { Queen, setRenderer } from './queen/build.js';
import { gownParams, morphAt } from './queen/gowns.js';
import { perform } from './queen/rig.js';

export const meta = { modes: ['sing', 'wide', 'morph', 'gallery', 'closeup'], variants: 24 };

const FOV = 30, TAN = Math.tan((FOV / 2) * Math.PI / 180);

export async function create({ renderer, width, height }) {
  setRenderer(renderer);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 7, 18);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environmentIntensity = 0.16;
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.05, 80);

  // ---- lights: strong key from camera-right above (shadows), two cool rims from behind, weak fill
  const hemi = new THREE.HemisphereLight(0xfff0e0, 0x100810, 0.12);
  const key = new THREE.SpotLight(0xfff2e0, 60, 0, 0.42, 0.55, 1.6);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 1; key.shadow.camera.far = 40;
  const rimL = new THREE.DirectionalLight(0xd0dcff, 2.2), rimR = new THREE.DirectionalLight(0xffffff, 1.6);
  const fill = new THREE.DirectionalLight(0xffe0c0, 0.35);
  scene.add(hemi, key, key.target, rimL, rimL.target, rimR, rimR.target, fill, fill.target);

  // ---- floor: dark marble baked with a radial fade, so it dissolves into the void
  const fc = document.createElement('canvas'); fc.width = fc.height = 1024;
  {
    const g = fc.getContext('2d'), S = 1024, rnd = QC.mulberry32(5);
    g.fillStyle = '#6a6066'; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 90; k++) {
      g.strokeStyle = `rgba(${(200 + rnd() * 40) | 0},${(185 + rnd() * 40) | 0},${(175 + rnd() * 30) | 0},${0.05 + rnd() * 0.12})`; g.lineWidth = 0.5 + rnd() * 3;
      let x = rnd() * S, y = rnd() * S; g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < 40; i++) { x += (rnd() - 0.3) * 40; y += (rnd() - 0.5) * 30; g.lineTo(x, y); }
      g.stroke();
    }
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.18, 'rgba(0,0,0,0.25)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.9)'); gr.addColorStop(0.6, 'rgba(0,0,0,1)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  const floorTex = new THREE.CanvasTexture(fc); floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.anisotropy = 8;
  // unlit (the pool of light is baked), plus a shadow catcher for the key light's contact shadows
  const floor = new THREE.Group();
  const floorBase = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.MeshBasicMaterial({ map: floorTex, fog: false }));
  const floorShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.ShadowMaterial({ opacity: 0.75, fog: false }));
  floorShadow.position.z = 0.001; floorShadow.receiveShadow = true;
  floor.add(floorBase, floorShadow); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  // dais ring under a single queen
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.012, 8, 160), new THREE.MeshStandardMaterial({ color: '#d9b54a', metalness: 1, roughness: 0.3 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.006; scene.add(ring);

  // ---- halo: a soft disc of light on the void behind the queen, so dark gowns read as silhouettes
  const hc = document.createElement('canvas'); hc.width = hc.height = 256;
  {
    const g = hc.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, '#a0a0a0'); gr.addColorStop(0.3, '#727272'); gr.addColorStop(0.6, '#303030'); gr.addColorStop(0.85, '#0c0c0c'); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }
  const haloTex = new THREE.CanvasTexture(hc); haloTex.colorSpace = THREE.SRGBColorSpace;
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: haloTex, fog: false, depthWrite: false }));
  halo.renderOrder = -1; scene.add(halo);

  const stage = new THREE.Group(); scene.add(stage);

  // ---- caches: built gowns per variant (LRU), and a short LRU of morph steps
  const cache = new Map(), morphCache = new Map();
  function fromCache(map, key, make, limit) {
    let q = map.get(key);
    if (q) { map.delete(key); map.set(key, q); return q; }
    q = new Queen(make()); map.set(key, q);
    while (map.size > limit) { const k0 = map.keys().next().value; map.get(k0).dispose(); map.delete(k0); }   // LRU: never one used this frame
    return q;
  }
  const queenFor = v => fromCache(cache, v, () => gownParams(v), 16);

  const lookAt = new THREE.Vector3();
  let gain = 1;
  const gownGain = p => { const c = new THREE.Color(p.gownColor), l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; return 1.4 - 0.9 * Math.min(1, l / 0.8); };
  const queenGain = p => p.mantle > 0.5 ? 0.5 * (gownGain(p) + gownGain({ gownColor: p.mantleColor })) : gownGain(p);
  function placeLights(target, az, spread) {
    // positions in a frame turned with the camera azimuth, so the key / rim look survives an orbit
    const c = Math.cos(az), s = Math.sin(az), P = (x, y, z) => new THREE.Vector3(target.x + x * c + z * s, y, target.z - x * s + z * c);
    key.position.copy(P(2.6 * spread, 5.8 * Math.max(1, spread * 0.8), 3.6 * spread)); key.target.position.set(target.x, 0.9, target.z);
    key.angle = spread > 1.5 ? 0.62 : 0.42;
    key.intensity = 60 * spread * spread * gain; rimL.intensity = 2.2 * (0.6 + 0.4 * gain); rimR.intensity = 1.6 * (0.6 + 0.4 * gain);
    rimL.position.copy(P(-3, 3.6, -4.5)); rimL.target.position.set(target.x, 1, target.z);
    rimR.position.copy(P(3.2, 2.4, -4)); rimR.target.position.set(target.x, 1, target.z);
    fill.position.copy(P(-3.5, 1.6, 3)); fill.target.position.set(target.x, 1, target.z);
  }
  function placeHalo(target, size) {
    const d = new THREE.Vector3().subVectors(target, camera.position).setY(0).normalize();
    halo.position.copy(target).addScaledVector(d, 3.2); halo.position.y = target.y + 0.15;
    halo.scale.setScalar(size); halo.lookAt(camera.position);
  }
  function setCam(az, el, dist, target) {
    camera.position.set(target.x + dist * Math.sin(az) * Math.cos(el), target.y + dist * Math.sin(el), target.z + dist * Math.cos(az) * Math.cos(el));
    camera.lookAt(target);
    scene.fog.near = dist + 3; scene.fog.far = dist + 14;
  }
  function placeQueen(q, t, shot, o) {
    const P = perform(t, { mode: shot.mode, seed: o.seed || 0, mirror: o.mirror, p: q.p });
    q.pose(P);
    q.root.position.set(o.x + P.body.x * Math.cos(o.yaw), 0, o.z - P.body.x * Math.sin(o.yaw));
    q.root.rotation.set(0, o.yaw + P.body.yaw, 0);
    stage.add(q.root);
    return P;
  }

  // warm up: build the era presets and the first commissions, and compile their shaders, so the first shots don't stall
  for (let v = 0; v < 9; v++) stage.add(queenFor(v).root);
  { // one real (tiny) render: compiles the programs with shadows on and uploads every texture
    const rt = new THREE.WebGLRenderTarget(64, 36), se = renderer.shadowMap.enabled, st = renderer.shadowMap.type;
    stage.children.forEach((r, i) => r.position.set((i - 4) * 1.6, 0, 0));
    setCam(0, 0.1, 30, new THREE.Vector3(0, 1, 0)); placeLights(new THREE.Vector3(), 0, 2);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null);
    renderer.shadowMap.enabled = se; renderer.shadowMap.type = st; rt.dispose();
  }
  stage.clear();

  return {
    scene, camera,
    render(r) {
      const se = r.shadowMap.enabled, st = r.shadowMap.type;
      r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.render(scene, camera);
      r.shadowMap.enabled = se; r.shadowMap.type = st;
    },
    update(t, shot) {
      const mode = meta.modes.includes(shot.mode) ? shot.mode : 'sing';
      const v = Math.max(0, Math.floor(shot.variant || 0)), lt = shot.lt, s = { ...shot, mode };
      const vh = (v * 0.618034) % 1;   // per-variant offsets for the camera
      stage.clear(); halo.material.color.setScalar(1);
      floor.scale.setScalar(7); ring.visible = true;
      if (mode === 'gallery') {
        // a shallow arc of queens side by side; with more than fit the frame, the camera trucks along the line
        const n = 5 + 2 * (v % 3), c = (n - 1) / 2, sp = 1.55; gain = 0.85;
        const W = (n - 1) * sp + 1.9, Wv = Math.min(W, 8.2), Hv = Wv / camera.aspect, dist = Hv / 2 / TAN;
        for (let i = 0; i < n; i++) {
          const k = i - c, x = k * sp, z = -0.06 * k * k;
          placeQueen(queenFor(v + i), t, s, { x, z, yaw: -0.05 * k, mirror: i % 2 === 1, seed: 0 });
        }
        const truck = (W - Wv) / 2 * Math.sin(lt * 0.16 + vh * 6);
        lookAt.set(truck, 0.27 * Hv, -0.3);
        setCam(0.05 * Math.sin(lt * 0.13 + vh * 6), 0.08 + 0.02 * Math.sin(lt * 0.2), dist * (1 - 0.04 * Math.min(1, lt / 12)), lookAt);
        placeLights(new THREE.Vector3(truck, 0, 0), 0, 2.0); placeHalo(lookAt, Hv * 1.5); halo.material.color.setScalar(0.75);
        floor.scale.set(Math.max(8, W * 0.8), 8, 1); floorBase.material.color.setScalar(0.25); ring.visible = false;
      } else {
        let q;
        if (mode === 'morph') {
          // scene-alone dev mode (?scene=queen) makes one endless shot: morph over a 24 s loop there
          const pm = shot.dur > 600 ? (lt % 24) / 24 : shot.p ?? 0;
          const m = morphAt(v, QC.clamp(pm, 0, 1));
          q = fromCache(morphCache, m.key, m.params, 3);
        } else q = queenFor(v);
        placeQueen(q, t, s, { x: 0, z: 0, yaw: 0 });
        const f = q.f; gain = queenGain(q.p); floorBase.material.color.setScalar(1);
        if (mode === 'sing') {
          const H = 1.28, dist = H / 2 / TAN;
          lookAt.set(0, f.bustY + 0.06 + 0.02 * Math.sin(lt * 0.21), 0);
          setCam((v % 2 ? 1 : -1) * (0.28 + 0.2 * vh) + 0.15 * Math.sin(lt * 0.12), 0.05 + 0.03 * Math.sin(lt * 0.17), dist * (1.06 - 0.06 * Math.min(1, lt / 20)), lookAt);
          placeLights(lookAt, camera.position.x * 0.2, 1); placeHalo(lookAt, 4.6);
        } else if (mode === 'closeup') {
          const H = 0.78, dist = H / 2 / TAN;
          lookAt.set(0, f.headY - 0.07, 0);
          setCam((vh - 0.5) * 0.6 + 0.12 * Math.sin(lt * 0.15), 0.03 + 0.03 * Math.sin(lt * 0.19), dist * (1.04 - 0.04 * Math.min(1, lt / 15)), lookAt);
          placeLights(lookAt, 0, 1); placeHalo(lookAt, 3.2);
        } else {   // wide / morph: full figure, feet near the lyric line
          const H = mode === 'wide' ? 2.75 : 2.6, dist = H / 2 / TAN;
          const az = mode === 'wide' ? (vh - 0.5) * 1.4 + 1.15 * Math.sin(lt * 0.21 + vh * 4) : (vh - 0.5) * 0.8 + 0.35 * Math.sin(lt * 0.1);
          lookAt.set(0, 0.285 * H, 0);
          setCam(az, 0.1 + 0.04 * Math.sin(lt * 0.15), dist, lookAt);
          placeLights(lookAt, az, 1.1); placeHalo(lookAt, 6.5);
        }
      }
    },
  };
}
