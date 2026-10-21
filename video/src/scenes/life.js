// life.js: 3D Game of Life on the A15 "All d4" Frank–Kasper crystal, ported from assets/3d-game-of-life/index.html.
// Director's settings: lattice All d4 (a15), neighbourhood 3×3×3 (r = 1), preset Coral Drift (8-18/15-19/16),
// grid 32³ (N = 32; the "32 degrees" is the 32³ grid, the camera also uses a 32° field of view).
// The simulation is precomputed lazily per variant (seed) and indexed by beats since the shot started, so every frame
// is a function of (t, shot). Cells pop in when born, shrink while they decay, and are lit for the 1-bit dither.
// Modes:
//   grow   the preset's seed soup grows into coral, two generations per beat (on and off the beat), camera orbiting and pulling back
//   drift  a mature colony; the camera pushes in from outside to deep inside, cells parting around it
//   slice  a cutting plane sweeps through the cube, the cross-section glows
//   kill   a big sphere of the colony is wiped on a beat, and the survivors regrow into it (two generations per beat)
import * as THREE from 'three';
import { GOL } from './life/gol.js';

export const meta = { modes: ['grow', 'drift', 'slice', 'kill'], variants: 1000 };

const N = 32, LATTICE = 'a15', R = 1;
const PRESET = GOL.PRESETS.find(p => p.name === 'Coral Drift');   // 8-18/15-19/16, density 0.2, fill 0.5
const MATURE = 60;                                                 // first generation shown by drift/slice/kill
const KILL_FIRST = 4, KILL_EVERY = 32, KILL_GPB = 2;               // kill mode: beats; generations per beat
const GROW_GPB = 2, GROW_CYCLE = 48, DRIFT_CYCLE = 256, KILL_CYCLE = 128;        // beats before a mode loops (long dev shots)

// Unit-cell centroids of the 46 tetrahedra (quarter-cell units = voxels).
const CEN = GOL.A15_TETS.map(t => [0, 1, 2].map(i => (t[0][i] + t[1][i] + t[2][i] + t[3][i]) / 4));
const ruleOf = w => GOL.parseRule(PRESET.rule, w.maxCount);

// Kill sphere for kill j of a variant: centre (cube coords 0..N) on the side facing the camera at that moment.
function killSphere(variant, j) {
  const ang = killCamAngle(variant, KILL_FIRST + j * KILL_EVERY);
  const rng = GOL.mulberry32(variant * 977 + j * 131 + 5);
  const a = ang + (rng() - 0.5) * 0.7, h = (rng() - 0.5) * 8;
  return { x: N / 2 + Math.sin(a) * N * 0.3, y: N / 2 + h, z: N / 2 + Math.cos(a) * N * 0.3, r: N * 0.42 };
}
const killCamAngle = (variant, gb) => 0.7 + variant * 2.39996 + gb * 0.05;
const torusD2 = (x, y, z, c) => {
  let dx = Math.abs(x - c.x), dy = Math.abs(y - c.y), dz = Math.abs(z - c.z);
  dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy); dz = Math.min(dz, N - dz);
  return dx * dx + dy * dy + dz * dz;
};

// A lazily extended list of generations for one seed; `kills` wipes spheres at given generations.
class Sim {
  constructor(variant, kills = false) {
    this.variant = variant; this.kills = kills;
    this.world = new GOL.World(N, LATTICE, R);
    this.world.setRule(ruleOf(this.world));
    this.world.seed(PRESET.density, PRESET.fill * N, GOL.mulberry32(variant * 7919 + 1));
    this.states = [this.world.state.slice()];
  }
  killAt(g) {   // index j of the kill applied when generation g is produced, or -1
    if (!this.kills) return -1;
    const b = (g - 1 - MATURE) / KILL_GPB - KILL_FIRST;   // the wipe transition starts on the beat
    return b >= 0 && Number.isInteger(b) && b % KILL_EVERY === 0 ? b / KILL_EVERY : -1;
  }
  get(g) {
    while (this.states.length <= g) {
      const w = this.world;
      w.step();
      const j = this.killAt(this.states.length);
      if (j >= 0) {
        const c = killSphere(this.variant, j), r2 = c.r * c.r, G = w.G;
        for (let v = 0, i = 0; v < w.nv; v++) {
          const ox = (v % G) * 4, oy = ((v / G | 0) % G) * 4, oz = (v / (G * G) | 0) * 4;
          for (let k = 0; k < 46; k++, i++)
            if (w.state[i] && torusD2(ox + CEN[k][0], oy + CEN[k][1], oz + CEN[k][2], c) < r2) w.state[i] = 0;
        }
      }
      this.states.push(w.state.slice());
    }
    return this.states[g];
  }
}

// Convex polyhedron from vertices + triangle faces, shrunk about its centroid (as in the experiment), plus the
// centroid as an attribute so the shader can scale each cell about it.
function polyGeometry(verts, faces, shrink) {
  const V = verts.map(v => new THREE.Vector3(...v));
  const cen = V.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / V.length);
  const P = V.map(v => v.clone().sub(cen).multiplyScalar(shrink).add(cen));
  const pos = [], cpos = [];
  for (const f of faces) {
    let [a, b, c] = f.map(i => P[i]);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.dot(new THREE.Vector3().subVectors(cen, a)) > 0) [b, c] = [c, b]; // face outward
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) cpos.push(cen.x, cen.y, cen.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCen', new THREE.Float32BufferAttribute(cpos, 3));
  g.computeVertexNormals(); // non-indexed → flat face normals
  return g;
}
const TET_FACES = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];

const VERT = /* glsl */`
  attribute vec3 aCen;
  attribute vec3 aCell;     // unit cell origin in voxels
  attribute vec2 aS;        // state at generation g and g+1
  uniform float uN, uC, uF, uPulse;
  uniform float uSlice;     // slice: cells with centroid above this world y are cut away
  uniform vec4 uKill;       // kill sphere (cube coords) and radius; uKillOn 1 during the wipe transition
  uniform float uKillOn;
  uniform vec2 uFog;        // view distance where the fog starts / is total
  uniform vec4 uClear;      // drift: cells part around this point (xyz) within radius w
  varying vec3 vColor;
  varying float vRim;
  varying vec3 vN;
  varying vec3 vV;
  varying float vGlow;
  varying float vFog;
  // decaying cells shrink away within ~half of their 14-generation trail, so the 1-bit image keeps air in it
  float sizeOf(float s, float t) { return s < 0.5 ? 0.0 : s < 1.5 ? 1.0 : max(0.0, 0.74 - 1.3 * t); }
  float decay(float s) { return uC > 2.0 && s > 1.5 ? clamp((s - 1.0) / (uC - 1.0), 0.0, 1.0) : 0.0; }
  void main() {
    float s0 = aS.x, s1 = aS.y;
    float t0 = decay(s0), t1 = decay(s1);
    float f = uF;
    float e = smoothstep(0.0, 1.0, f);
    float born = step(s0, 0.5) * step(0.5, s1) * step(s1, 1.5);
    if (born > 0.5) { float k = f - 1.0; e = 1.0 + 2.7 * k * k * k + 1.7 * k * k; }      // back-out pop
    float sc = mix(sizeOf(s0, t0), sizeOf(s1, t1), e);
    float t = s0 < 0.5 ? t1 : s1 < 0.5 ? t0 : mix(t0, t1, e);

    vec3 cc = aCell + aCen;                                       // centroid, cube coords 0..N
    vec3 cen = cc - 0.5 * uN;                                     // world centroid
    // kill: cells inside the sphere flare up and are torn away
    float glow = 0.0;
    if (uKillOn > 0.5) {
      vec3 d = abs(cc - uKill.xyz); d = min(d, uN - d);
      float r = length(d);
      if (r < uKill.w && s0 > 0.5) {
        float k = clamp(f * 1.6 - (r / uKill.w) * 0.6, 0.0, 1.0);   // wave from the centre outwards
        sc = (s0 < 1.5 ? 1.0 : sizeOf(s0, t0)) * (1.0 + 0.5 * sin(3.14159 * k)) * (1.0 - smoothstep(0.55, 1.0, k));
        glow = 1.6 * (1.0 - k);
        t = 0.0;
      }
    }
    // slice: cut away above the plane, light up the cross-section
    float above = cen.y - uSlice;
    sc *= 1.0 - smoothstep(-0.2, 0.6, above);
    glow += smoothstep(-1.6, 0.0, above) * (1.0 - smoothstep(0.0, 0.6, above)) * 0.45 * step(s1, 1.5) * step(0.5, s1);

    if (uClear.w > 0.0) sc *= smoothstep(uClear.w * 0.45, uClear.w, distance(cen, uClear.xyz));
    vec3 p = cen + (position - aCen) * sc;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    float dist = length(mv.xyz);
    vFog = 1.0 - smoothstep(uFog.x, uFog.y, dist);

    // colour by position (the experiment's mode 0), decaying cells ember and darker
    vec3 base = 0.22 + 0.78 * (cc + 0.5) / uN;
    vec3 ember = vec3(0.55, 0.15, 0.08);
    vec3 col = mix(base, ember, clamp(t * 1.6, 0.0, 1.0)) * (1.0 - 0.5 * t);
    // 1-bit: keep hue for colour shots, but flatten the brightness gradient so no corner of the cube goes dark
    float lum = dot(col, vec3(0.3, 0.55, 0.15));
    col = col / max(lum, 0.05) * mix(0.62, 1.0, lum) * (1.0 - 0.72 * t);
    vColor = col;
    vGlow = glow;
    vRim = t;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */`
  uniform vec3 uKey, uFill;
  uniform float uPulse, uAmb;
  varying vec3 vColor;
  varying float vRim;
  varying vec3 vN;
  varying vec3 vV;
  varying float vGlow;
  varying float vFog;
  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    float key = max(dot(n, uKey), 0.0);
    float fill = max(dot(n, uFill), 0.0);
    float rim = pow(1.0 - clamp(abs(dot(n, normalize(vV))), 0.0, 1.0), 3.0);
    float lit = uAmb + (1.2 + 0.3 * uPulse) * smoothstep(0.12, 0.85, key) + 0.18 * smoothstep(0.2, 0.9, fill);
    vec3 c = vColor * lit + rim * (0.9 - 0.6 * vRim) * vec3(0.85, 0.92, 1.0);
    c = c * vFog + vGlow * vec3(1.0);
    gl_FragColor = vec4(c, 1.0);
  }`;

export async function create({ width, height }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(32, width / height, 0.3, 400);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uN: { value: N }, uC: { value: 16 }, uF: { value: 0 }, uPulse: { value: 0 }, uAmb: { value: 0.07 },
      uSlice: { value: 1e3 }, uKill: { value: new THREE.Vector4(0, 0, 0, 0) }, uKillOn: { value: 0 },
      uFog: { value: new THREE.Vector2(50, 120) }, uClear: { value: new THREE.Vector4() },
      uKey: { value: new THREE.Vector3(0.45, 0.75, 0.45).normalize() }, uFill: { value: new THREE.Vector3(-0.7, -0.2, 0.3).normalize() },
    },
    side: THREE.DoubleSide,
  });

  // One instanced layer per A15 tetrahedron shape (46), instance = unit cell origin + two states.
  const G = N / 4, NV = G * G * G;
  const layers = GOL.A15_TETS.map(tet => {
    const src = polyGeometry(tet, TET_FACES, 0.84);
    const geo = new THREE.InstancedBufferGeometry().copy(src); src.dispose();
    const cell = new THREE.InstancedBufferAttribute(new Float32Array(NV * 3), 3);
    const st = new THREE.InstancedBufferAttribute(new Float32Array(NV * 2), 2);
    cell.setUsage(THREE.DynamicDrawUsage); st.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCell', cell); geo.setAttribute('aS', st);
    geo.instanceCount = 0;
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, geo, cell, st };
  });

  // Bounding cube and the slice plane outline.
  // (thin boxes instead of 1 px lines, so the edges survive the 3 px dither cells)
  const frameMat = new THREE.MeshBasicMaterial({ color: 0x9aa4bc });
  const frame = new THREE.Group();
  for (let a = 0; a < 3; a++) for (const u of [-1, 1]) for (const v of [-1, 1]) {
    const w = 0.16, size = [w, w, w]; size[a] = N + w;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(...size), frameMat), p = [u * N / 2, v * N / 2];
    bar.position.set(...(a === 0 ? [0, p[0], p[1]] : a === 1 ? [p[0], 0, p[1]] : [p[0], p[1], 0]));
    frame.add(bar);
  }
  scene.add(frame);
  const planeLine = new THREE.Group(), planeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const a of [0, 2]) for (const u of [-1, 1]) {
    const w = 0.28, bar = new THREE.Mesh(new THREE.BoxGeometry(a === 0 ? N + w : w, w, a === 2 ? N + w : w), planeMat);
    bar.position.set(a === 2 ? u * N / 2 : 0, 0, a === 0 ? u * N / 2 : 0);
    planeLine.add(bar);
  }
  scene.add(planeLine);

  const sims = new Map();
  const simFor = (variant, kills) => {
    const key = variant + (kills ? 'k' : '');
    if (!sims.has(key)) sims.set(key, new Sim(variant, kills));
    return sims.get(key);
  };
  // Warm the default variant now (a few ms per generation), the rest extends lazily.
  simFor(0, false).get(MATURE + 40);
  simFor(0, true).get(MATURE + 2 * KILL_FIRST + 24);

  let shown = null;
  function fill(sim, g) {
    const key = sim.variant + (sim.kills ? 'k' : '') + ':' + g;
    if (shown === key) return;
    shown = key;
    const a = sim.get(g), b = sim.get(g + 1), counts = new Int32Array(46);
    const bufs = layers.map(L => [L.cell.array, L.st.array]);
    for (let v = 0, c = 0; v < NV; v++) {
      const ox = (v % G) * 4, oy = ((v / G | 0) % G) * 4, oz = (v / (G * G) | 0) * 4;
      for (let k = 0; k < 46; k++, c++) {
        const s0 = a[c], s1 = b[c];
        if (!s0 && !s1) continue;
        const [cb, sb] = bufs[k], i = counts[k]++;
        cb[i * 3] = ox; cb[i * 3 + 1] = oy; cb[i * 3 + 2] = oz; sb[i * 2] = s0; sb[i * 2 + 1] = s1;
      }
    }
    layers.forEach((L, k) => {
      const n = counts[k];
      L.geo.instanceCount = n; L.mesh.visible = n > 0;
      if (n) {
        L.cell.clearUpdateRanges(); L.cell.addUpdateRange(0, n * 3); L.cell.needsUpdate = true;
        L.st.clearUpdateRanges(); L.st.addUpdateRange(0, n * 2); L.st.needsUpdate = true;
      }
    });
  }

  const U = material.uniforms;
  return {
    scene, camera,
    update(t, shot) {
      const mode = meta.modes.includes(shot.mode) ? shot.mode : 'grow';
      const variant = Math.max(0, Math.floor(shot.variant ?? 0));
      const { beat } = shot, beatF = beat.index + beat.phase;
      const gb = Math.max(0, beatF - Math.floor(beatF - shot.lt / beat.period + 1e-6));   // beats since shot start
      const lt = shot.lt, pulse = beat.pulse;
      U.uPulse.value = pulse * (0.4 + 0.6 * shot.energy);
      U.uSlice.value = 1e3; U.uKillOn.value = 0; U.uClear.value.set(0, 0, 0, 0);
      frame.visible = true; planeLine.visible = false;
      camera.fov = 32; camera.near = 0.3; camera.far = 400; camera.up.set(0, 1, 0);

      let sim, gF;
      // orbit around the cube centre; the view offset lifts the subject above the lyric band
      camera.setViewOffset(width, height, 0, 80, width, height);
      const orbit = (ang, elev, dist) => {
        camera.position.set(Math.sin(ang) * Math.cos(elev) * dist, Math.sin(elev) * dist, Math.cos(ang) * Math.cos(elev) * dist);
        camera.lookAt(0, 0, 0);
        U.uFog.value.set(Math.max(4, dist - N * 0.45), dist + N * 0.95);
      };

      if (mode === 'grow') {
        sim = simFor(variant, false);
        gF = (gb % GROW_CYCLE) * GROW_GPB;
        const grow = THREE.MathUtils.smoothstep(gF, 0, 90);
        orbit(0.6 + variant * 2.39996 + lt * 0.11, 0.42 - 0.1 * grow, N * (2.0 + 1.1 * grow));
      } else if (mode === 'drift') {
        sim = simFor(variant, false);
        gF = MATURE + gb % DRIFT_CYCLE;
        // push in from outside the cube to deep inside it over 64 beats; cells part around the camera
        const u = (gb % 64) / 64, push = 1 - Math.pow(1 - u, 1.4);
        const dist = N * (3.1 - 2.5 * push) - pulse * 0.6;
        orbit(1.3 + variant * 2.39996 + lt * 0.05, 0.3 - 0.15 * push, dist);
        U.uClear.value.set(camera.position.x, camera.position.y, camera.position.z, 4 + 7 * push);
        camera.fov = 32 + 18 * push;
        const L = THREE.MathUtils.lerp;   // inside the colony the fog closes in, so only the parted cells near the camera stay bright
        const k = push * push;
        U.uFog.value.set(L(dist - N * 0.45, 6, k), L(dist + N * 0.95, 26, k));
      } else if (mode === 'slice') {
        sim = simFor(variant, false);
        gF = MATURE + gb % DRIFT_CYCLE;
        const sweep = 0.5 - 0.5 * Math.cos(Math.PI * 2 * (gb / 32 + 0.06));
        U.uSlice.value = N / 2 - 1 - (N - 4) * sweep;
        planeLine.visible = true; planeLine.position.y = U.uSlice.value;
        orbit(0.9 + variant * 2.39996 + lt * 0.07, 0.52, N * 3.2);
      } else {   // kill
        sim = simFor(variant, true);
        const kb = gb % KILL_CYCLE;
        gF = MATURE + kb * KILL_GPB;
        orbit(killCamAngle(variant, kb), 0.36, N * 3.15);
        // the wipe: from the generation before a kill to the kill generation
        const g0 = Math.floor(gF), j = sim.killAt(g0 + 1);
        if (j >= 0) {
          const c = killSphere(variant, j);
          U.uKillOn.value = 1; U.uKill.value.set(c.x, c.y, c.z, c.r);
        }
      }
      const g = Math.floor(gF);
      fill(sim, g);
      U.uF.value = gF - g;
      camera.updateProjectionMatrix();
    },
  };
}
