// build.js: Three.js mesh building for shoggoth layouts, ported from assets/3d-shoggoth/index.html (materials,
// blob geometry, dynamic tubes, eyes, mouths, tips, smiley masks, trypophobic holes, hair, buildCreature).
// Changes from the experiment: no module-level creature (every function takes its record), no transmission
// (it costs a second scene pass), optional level of detail, static parts baked into a few merged meshes, and
// poseCreature(rec, t, o) is a pure function of time (no easing toward the previous frame).
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import S from './core.js';
const { clamp, lerp, TAU } = S;

// ---- colour & materials ------------------------------------------------------
const hsl = (c) => new THREE.Color().setHSL(((c[0] % 1) + 1) % 1, clamp(c[1], 0, 1), clamp(c[2], 0, 1), THREE.SRGBColorSpace);

// Inflammation reddens the bump and its halo; ripeness turns the head from pink to a glossy yellow-white.
function pimpleMaterials(g, C, phys, std) {
  const red = new THREE.Color(.62, .07, .06), infl = g.inflammation;
  const head = new THREE.Color(.95, .7, .62).lerp(new THREE.Color(.98, .93, .7), g.ripeness);
  return {
    pimple: phys({ color: C.skin.clone().lerp(red, .2 + infl * .65), roughness: .45, clearcoat: .5, clearcoatRoughness: .3, sheen: .4, sheenColor: red }),
    pimpleHalo: std(C.skin.clone().lerp(red, infl * .75), { roughness: .6 }),
    pimpleHead: phys({ color: head, roughness: .2, clearcoat: 1, clearcoatRoughness: .1, emissive: head.clone().multiplyScalar(.04) })
  };
}
function makeMaterials(g) {
  const P = S.paletteOf(g);
  const C = {};
  for (const k in P) C[k] = hsl(P[k]);
  const realism = g.hyperrealism / 100, slime = g.slime / 100, cartoon = g.cartoonish / 100, glow = g.glow / 100, ugly = g.ugliness / 100;
  const rough = clamp(.82 - realism * .38 - slime * .31 + cartoon * .08 + ugly * .1, .16, .93);
  const toon = cartoon > .68 && slime < .52;
  const emissive = C.skin.clone().multiplyScalar(.025 + glow * .06);
  const emissiveIntensity = .35 + glow * .75;
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .5, metalness: .02, ...o });
  const skinLike = (o) => toon ? new THREE.MeshToonMaterial({ emissive, emissiveIntensity, ...o }) : phys({ roughness: rough, metalness: .01 + slime * .06, emissive, emissiveIntensity, clearcoat: slime * .8, clearcoatRoughness: .15, sheen: realism * .6, sheenColor: C.highlight, ...o });
  return {
    C, toon,
    skin: skinLike({ color: 0xffffff, vertexColors: true }),
    limb: skinLike({ color: C.skin.clone().lerp(C.highlight, .08) }),
    outline: new THREE.MeshBasicMaterial({ color: C.shadow.clone().multiplyScalar(.6), side: THREE.BackSide, transparent: true, opacity: clamp(cartoon * .55, 0, .55), depthWrite: false }),
    eyeWhite: phys({ color: C.eye, roughness: .14, clearcoat: .9, clearcoatRoughness: .08, emissive: C.iris.clone().multiplyScalar(.04 + glow * .08), emissiveIntensity: .55 }),
    slitWhite: phys({ color: C.iris.clone().lerp(new THREE.Color(0xffd85a), .55), roughness: .15, clearcoat: .9, emissive: C.iris.clone().multiplyScalar(.08 + glow * .2), emissiveIntensity: .6 + glow }),
    iris: phys({ color: C.iris, roughness: .2, clearcoat: .7, emissive: C.iris.clone().multiplyScalar(.05 + glow * .25), emissiveIntensity: .6 + glow * 1.2 }),
    pupil: std(C.pupil, { roughness: .12 }),
    shine: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .85 }),
    lid: std(C.shadow.clone().lerp(C.skin, .35), { roughness: .8 }),
    compound: phys({ color: C.pupil.clone().lerp(C.iris, .3), roughness: .12, metalness: .55, clearcoat: 1, iridescence: .9, iridescenceIOR: 1.6 }),
    orb: std(C.accent, { emissive: C.accent, emissiveIntensity: .8 + glow * 2.2, roughness: .3 }),
    halo: new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: .08 + glow * .16, blending: THREE.AdditiveBlending, depthWrite: false }),
    cavity: std(C.mouth, { roughness: .4, emissive: C.mouth.clone().multiplyScalar(.25) }),
    lip: std(C.lip, { roughness: .45 }),
    teeth: std(C.teeth, { roughness: .28 }),
    tongue: std(C.tongue, { roughness: .35 }),
    sucker: std(C.sucker, { roughness: .32, emissive: C.highlight.clone().multiplyScalar(.04 + glow * .1), emissiveIntensity: .7 }),
    suckerDark: std(C.shadow.clone().multiplyScalar(.55), { roughness: .7 }),
    claw: std(C.claw, { roughness: .25, metalness: .15 }),
    bulb: std(C.accent, { emissive: C.accent, emissiveIntensity: .6 + glow * 2, roughness: .25 }),
    wart: std(C.shadow.clone().lerp(C.skin, .35), { roughness: .8 }),
    ...pimpleMaterials(g, C, phys, std),
    brow: std(C.shadow.clone().lerp(C.skin, .15), { roughness: .9 }),
    blush: new THREE.MeshStandardMaterial({ color: new THREE.Color(1, .42, .55).lerp(C.skin, .15), roughness: .7, transparent: true, opacity: Math.min(.75, g.blush * .85), depthWrite: false }),
    spine: std(C.highlight.clone().lerp(C.teeth, .5), { roughness: .4 }),
    frill: phys({ color: C.accent.clone().lerp(C.skin, .45), roughness: .45, side: THREE.DoubleSide, transparent: true, opacity: .88, emissive: C.accent.clone().multiplyScalar(.05 + glow * .15), emissiveIntensity: 1 }),
    slime: phys({ color: C.slime, roughness: .07 + (1 - slime) * .16, transparent: true, opacity: .12 + slime * .52, clearcoat: .95, clearcoatRoughness: .04, emissive: C.slime.clone().multiplyScalar(.04 + glow * .12), emissiveIntensity: .7 + glow * .7 }),
    puddle: phys({ color: C.slime.clone().multiplyScalar(.76), roughness: .08, transparent: true, opacity: .16 + slime * .38, clearcoat: 1, clearcoatRoughness: .02, side: THREE.DoubleSide }),
    strand: std(C.skin.clone().lerp(C.slime, .4), { roughness: .3 })
  };
}

function surfaceColor(g, C, p, bump, seed) {
  const c = C.skin.clone();
  const n1 = S.noise3(p[0] * 2.2, p[1] * 2.2, p[2] * 2.2, seed + 7);
  c.lerp(C.highlight, clamp((bump - 1) * 1.6 + .08 + (n1 - .5) * .14, 0, .6));
  if (g.pattern === "spots") {
    const v = S.noise3(p[0] * 3.4, p[1] * 3.4, p[2] * 3.4, seed + 11);
    if (v > .6) c.lerp(C.accent, clamp((v - .6) / .08, 0, 1) * .85);
  } else if (g.pattern === "stripes") {
    const v = Math.sin(p[1] * 7 + S.noise3(p[0] * 1.5, p[1] * 1.5, p[2] * 1.5, seed) * 5);
    c.lerp(C.shadow, clamp((v - .3) / .3, 0, 1) * .72);
  } else if (g.pattern === "mottle") {
    c.lerp(n1 > .5 ? C.highlight : C.shadow, Math.abs(n1 - .5) * 1.2);
  } else if (g.pattern === "veins") {
    const v = Math.abs(S.noise3(p[0] * 2.6, p[1] * 2.6, p[2] * 2.6, seed + 3) - .5);
    if (v < .05) c.lerp(C.accent.clone().lerp(C.mouth, .45), (1 - v / .05) * .85);
  }
  c.lerp(C.shadow, g.ugliness / 100 * .14);
  return c.lerp(C.highlight, g.cuteness / 100 * .1);
}

// Unit blob with noise relief and baked pattern colours. `shape` squashes the
// sphere (heads), `toWorld` maps a unit-surface point to where the pattern is sampled.
function blobGeometry(g, C, { w, h, lump, seed, shape = [1, 1, 1], taper = 0, toWorld }) {
  let geo = new THREE.SphereGeometry(1, w, h);
  geo.deleteAttribute("uv");
  geo.deleteAttribute("normal");
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const off = (seed % 997) * .173;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    const big = S.noise3(x * 1.6 + off, y * 1.6, z * 1.6, seed) - .5;
    const fine = S.noise3(x * 5 + off, y * 5, z * 5, seed + 1) - .5;
    const k = 1 + big * lump * .34 + fine * (.03 + lump * .05);
    const t = taper && z < 0 ? 1 + z * taper : 1;
    const px = x * k * shape[0] * t, py = y * k * shape[1] * t, pz = z * k * shape[2];
    pos.setXYZ(i, px, py, pz);
    const c = surfaceColor(g, C, toWorld([px, py, pz]), k, seed);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// ---- dynamic tube (arms, necks, strands) ---------------------------------------
class Tube {
  constructor(samples, radial, material) {
    this.samples = samples;
    this.radial = radial;
    const count = samples * (radial + 1);
    this.pos = new Float32Array(count * 3);
    this.nrm = new Float32Array(count * 3);
    const idx = [];
    for (let i = 0; i < samples - 1; i++) for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(idx);
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("normal", new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.tan = new Float32Array(samples * 3);
    this.side = new Float32Array(samples * 3);
  }
  update(pts, radiusAt) {
    const n = this.samples, R = this.radial;
    let nx = 0, ny = 1, nz = 0;
    let tx = 1, ty = 0, tz = 0;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1) * 3, i1 = Math.min(n - 1, i + 1) * 3;
      let ax = pts[i1] - pts[i0], ay = pts[i1 + 1] - pts[i0 + 1], az = pts[i1 + 2] - pts[i0 + 2];
      const al = Math.hypot(ax, ay, az);
      if (al > 1e-6) { tx = ax / al; ty = ay / al; tz = az / al; }
      if (i === 0) { if (Math.abs(ty) < .9) { nx = 0; ny = 1; nz = 0; } else { nx = 1; ny = 0; nz = 0; } }
      const d = nx * tx + ny * ty + nz * tz;
      nx -= tx * d; ny -= ty * d; nz -= tz * d;
      let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-5) { nx = -tz; ny = 0; nz = tx; nl = Math.hypot(nx, nz) || 1; }
      nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      this.tan[i * 3] = tx; this.tan[i * 3 + 1] = ty; this.tan[i * 3 + 2] = tz;
      this.side[i * 3] = nx; this.side[i * 3 + 1] = ny; this.side[i * 3 + 2] = nz;
      const r = radiusAt(i / (n - 1));
      const px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2];
      for (let j = 0; j <= R; j++) {
        const a = j / R * TAU, c = Math.cos(a), s = Math.sin(a);
        const vx = nx * c + bx * s, vy = ny * c + by * s, vz = nz * c + bz * s;
        const o = (i * (R + 1) + j) * 3;
        this.pos[o] = px + vx * r; this.pos[o + 1] = py + vy * r; this.pos[o + 2] = pz + vz * r;
        this.nrm[o] = vx; this.nrm[o + 1] = vy; this.nrm[o + 2] = vz;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.normal.needsUpdate = true;
  }
}

// ---- part builders -----------------------------------------------------------------
const Z = () => new THREE.Vector3(0, 0, 1);
const vec = (a) => new THREE.Vector3(a[0], a[1], a[2]);

const _shared = {};
function sharedGeometry() {
  if (_shared.G) return _shared.G;
  return _shared.G = {
    sphere: new THREE.SphereGeometry(1, 22, 16),
    sphereLo: new THREE.SphereGeometry(1, 12, 9),
    cone: new THREE.ConeGeometry(1, 1, 8),
    coneZ: new THREE.ConeGeometry(1, 1, 8).rotateX(Math.PI / 2).translate(0, 0, .5),
    torus: new THREE.TorusGeometry(1, .22, 8, 28),
    torusThin: new THREE.TorusGeometry(1, .1, 6, 28),
    cylZ: new THREE.CylinderGeometry(1, 1, 1, 8).rotateX(Math.PI / 2).translate(0, 0, .5),
    ico: new THREE.IcosahedronGeometry(1, 1),
    hook: new THREE.TorusGeometry(1, .22, 6, 14, Math.PI * 1.25),
    torusArc: new THREE.TorusGeometry(1, .075, 6, 24, Math.PI * .6),
    halfDisc: new THREE.CircleGeometry(1, 24, Math.PI, Math.PI),
    box: new THREE.BoxGeometry(1, 1, 1),
    suckerRing: new THREE.TorusGeometry(1, .28, 6, 14),
    suckerHole: new THREE.CircleGeometry(.62, 14)
  };
}

function mesh(parent, geometry, material, pos = [0, 0, 0], scl = [1, 1, 1], shadow = false) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(pos[0], pos[1], pos[2]);
  m.scale.set(scl[0], scl[1], scl[2]);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

function makeEye(e, M, G, slitHorizontal, face) {
  const group = new THREE.Group();
  group.position.copy(vec(e.pos));
  group.quaternion.setFromUnitVectors(Z(), vec(e.normal));
  const r = e.r;
  if (e.stalk > 0) mesh(group, G.cylZ, M.limb, [0, 0, 0], [r * .2, r * .2, e.stalk], true);
  const lidGroup = new THREE.Group();
  lidGroup.position.z = e.stalk;
  group.add(lidGroup);
  mesh(lidGroup, G.sphereLo, M.lid, [0, 0, r * .05], [r * 1.14, r * 1.14, r * .55]);
  const ball = new THREE.Group();
  ball.position.z = r * .32;
  lidGroup.add(ball);
  let gaze = true;
  if (e.style === "compound") {
    gaze = false;
    mesh(ball, G.sphere, M.compound, [0, 0, 0], [r, r, r * .8]);
    for (let k = 0; k < 7; k++) {
      const a = k / 6 * TAU, d = k === 6 ? 0 : r * .52;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      mesh(ball, G.sphereLo, M.compound, [x, y, Math.sqrt(Math.max(0, r * r - d * d)) * .72], [r * .4, r * .4, r * .22]);
    }
  } else if (e.style === "orb") {
    gaze = false;
    mesh(ball, G.sphere, M.orb, [0, 0, 0], [r, r, r]);
    mesh(ball, G.sphereLo, M.halo, [0, 0, 0], [r * 1.45, r * 1.45, r * 1.45]);
  } else {
    const slit = e.style === "slit";
    mesh(ball, G.sphere, slit ? M.slitWhite : M.eyeWhite, [0, 0, 0], [r, r, r * .85]);
    const sp = face.sparkle;
    const irisR = (e.style === "cyclops" ? .66 : .52) * (1 + sp * .15);
    if (!slit) mesh(ball, G.sphere, M.iris, [0, 0, r * .7], [r * irisR, r * irisR, r * .2]);
    // sparkle: bigger pupils (slits soften toward round) and extra catchlights
    const thin = .11 + sp * .2;
    const pupil = slit ? (slitHorizontal ? [r * .6, r * (thin + .02), r * .1] : [r * thin, r * .62, r * .1]) : [r * .24 * (1 + sp * .55), r * .24 * (1 + sp * .55), r * .1];
    mesh(ball, G.sphere, M.pupil, [0, 0, r * .8], pupil);
    mesh(ball, G.sphereLo, M.shine, [-r * .24, r * .28, r * .86], [r * .1 * (1 + sp * .9), r * .1 * (1 + sp * .9), r * .05]);
    if (sp > .25) mesh(ball, G.sphereLo, M.shine, [r * .2, -r * .17, r * .88], [r * .06 * sp, r * .06 * sp, r * .03]);
  }
  if (e.style !== "compound") mesh(lidGroup, G.torusThin, M.lid, [0, 0, r * .3], [r * 1.02, r * 1.02, r * (e.style === "cyclops" ? 1.6 : 1)]);
  // The face pieces need to know which way is up; buildCreature turns `upright` groups once placed.
  const upright = [];
  if (gaze && G.happyLid) {
    // smiling eyes: a lower-lid shell hugging the eyeball, tilted forward so its edge arches
    // up in the middle: a happy crescent. It blinks with the lid group.
    const lower = new THREE.Group();
    lower.position.z = r * .32;
    lidGroup.add(lower);
    const lid = mesh(lower, G.happyLid, M.limb, [0, 0, 0], [r * 1.05, r * 1.05, r * .92]);
    lid.rotation.x = -.44;
    upright.push(lower);
  }
  let brow = null;
  if (gaze && G.brow) {
    // friendly brows: raised arches that lift now and then (they do not blink)
    const browGroup = new THREE.Group();
    browGroup.position.z = e.stalk;
    group.add(browGroup);
    brow = mesh(browGroup, G.brow, M.brow, [0, r * 1.2, r * .38], [r * .8, r * .8, r * .8]);
    upright.push(browGroup);
  }
  lidGroup.userData.anim = ball.userData.anim = true;
  if (brow) brow.userData.anim = true;
  return { group, lidGroup, ball, gaze, style: e.style, phase: e.phase, rate: e.rate, upright, brow, browY: r * 1.2, r };
}

function makeMouth(mo, M, G) {
  const m = mo.r;
  const group = new THREE.Group();
  const upper = new THREE.Group(), lower = new THREE.Group(), ring = new THREE.Group();
  group.add(upper, lower, ring);
  let cavity;
  const tooth = (parent, x, y, z, rz, s = 1) => { const t = mesh(parent, G.cone, M.teeth, [x, y, z], [m * .07 * s, m * .2 * s, m * .07 * s]); t.rotation.z = rz; return t; };
  switch (mo.style) {
    case "lips": {
      cavity = mesh(group, G.sphere, M.cavity, [0, 0, 0], [m * .8, m * .36, m * .2]);
      mesh(group, G.torus, M.lip, [0, 0, m * .05], [m * .86, m * .42, m * .5]);
      for (let k = 0; k < 5; k++) tooth(upper, lerp(-.5, .5, k / 4) * m, m * .2, m * .12, Math.PI);
      for (let k = 0; k < 4; k++) tooth(lower, lerp(-.38, .38, k / 3) * m, -m * .2, m * .12, 0);
      mesh(lower, G.sphereLo, M.tongue, [0, -m * .12, m * .1], [m * .34, m * .08, m * .12]);
      break;
    }
    case "grin": {
      cavity = mesh(group, G.sphere, M.cavity, [0, 0, 0], [m * 1.15, m * .22, m * .18]);
      mesh(group, G.torus, M.lip, [0, 0, m * .04], [m * 1.2, m * .28, m * .3]);
      for (let k = 0; k < 12; k++) { const x = lerp(-1, 1, k / 11); tooth(upper, x * m * .98, m * (.12 - x * x * .08), m * .1, Math.PI, .75); }
      for (let k = 0; k < 11; k++) { const x = lerp(-1, 1, k / 10); tooth(lower, x * m * .9, -m * (.12 - x * x * .08), m * .1, 0, .7); }
      break;
    }
    case "vertical": {
      cavity = mesh(group, G.sphere, M.cavity, [0, 0, 0], [m * .25, m * .85, m * .2]);
      mesh(group, G.torus, M.lip, [0, 0, m * .05], [m * .32, m * .92, m * .45]);
      for (let k = 0; k < 5; k++) { tooth(upper, -m * .15, lerp(-.55, .55, k / 4) * m, m * .12, -Math.PI / 2); tooth(lower, m * .15, lerp(-.5, .5, k / 4) * m, m * .12, Math.PI / 2); }
      break;
    }
    case "lamprey": {
      cavity = mesh(group, G.sphere, M.cavity, [0, 0, 0], [m * .72, m * .72, m * .22]);
      mesh(group, G.torus, M.lip, [0, 0, m * .05], [m * .8, m * .8, m * .7]);
      for (const [count, rad, s] of [[12, .58, 1], [8, .34, .8]]) for (let k = 0; k < count; k++) {
        const a = k / count * TAU;
        tooth(ring, Math.cos(a) * rad * m, Math.sin(a) * rad * m, m * .14, a + Math.PI / 2, s);
      }
      break;
    }
    case "beak": {
      cavity = mesh(group, G.sphere, M.cavity, [0, 0, 0], [m * .45, m * .3, m * .2]);
      const up = mesh(upper, G.coneZ, M.claw, [0, m * .12, 0], [m * .5, m * .34, m * 1.05], true);
      up.rotation.x = .28;
      const lo = mesh(lower, G.coneZ, M.claw, [0, -m * .12, 0], [m * .4, m * .24, m * .75], true);
      lo.rotation.x = -.22;
      break;
    }
    default: { // sphincter
      cavity = mesh(group, G.sphere, M.cavity, [0, 0, 0], [m * .32, m * .32, m * .15]);
      for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; mesh(ring, G.sphereLo, M.lip, [Math.cos(a) * m * .42, Math.sin(a) * m * .42, m * .05], [m * .26, m * .2, m * .22]); }
    }
  }
  const smile = mo.smile || 0;
  if (smile > .01 && (mo.style === "lips" || mo.style === "grin")) {
    // y += k x^2 in mouth units: corners rise, the middle stays. Lip and cavity get bent copies
    // of their geometry; teeth and tongue just move.
    const k = smile * (mo.style === "grin" ? .5 : .6) / m;
    group.traverse((o) => {
      if (!o.isMesh) return;
      if (Math.abs(o.scale.x) > m * .3) {
        const geo = o.geometry.clone(), pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) * o.scale.x + o.position.x; pos.setY(i, pos.getY(i) + k * x * x / o.scale.y); }
        geo.computeVertexNormals();
        o.geometry = geo;
      } else o.position.y += k * o.position.x * o.position.x;
    });
  }
  upper.userData.anim = lower.userData.anim = ring.userData.anim = cavity.userData.anim = true;
  return { group, upper, lower, ring, cavity, cavityScale: cavity.scale.clone(), style: mo.style, phase: mo.phase, rate: mo.rate, m, smiling: smile > .01 };
}

function makeTip(arm, M, G) {
  const group = new THREE.Group();
  const r = arm.r0;
  if (arm.type === "hands") {
    // `hand.fingers` digits in total: `hand.thumbs` of them stick out sideways from the palm, the
    // rest fan across its front edge. The palm widens with the finger count; the middle fingers
    // are the longest. Defaults (5 fingers, 1 thumb) give the original four-and-a-thumb hand.
    const hand = arm.hand, n = hand.fingers - hand.thumbs, wide = Math.sqrt(Math.max(1, n) / 4);
    const fanAngle = .35 * hand.spread * 2 * Math.max(.6, wide), fingerR = r * .26 / Math.max(1, wide * .8);
    mesh(group, G.sphere, M.limb, [0, 0, r * .5], [r * 1.5 * wide, r * .6, r * 1.3], true);
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? .5 : k / (n - 1), d = Math.abs(u - .5) * 2;
      const x = lerp(-.9, .9, u) * r * wide, a = lerp(-fanAngle, fanAngle, u);
      const len = r * (1.2 + .55 * (1 - d * d) * (n > 2 ? 1 : 0)) * hand.len;
      const f = mesh(group, G.cylZ, M.limb, [x, 0, r * 1.3], [fingerR, fingerR * .85, len], true);
      f.rotation.y = a;
      mesh(group, G.sphereLo, M.limb, [x + Math.sin(a) * len, 0, r * 1.3 + Math.cos(a) * len], [fingerR, fingerR * .85, fingerR]);
      if (arm.tip === "claw") mesh(group, G.coneZ, M.claw, [x + Math.sin(a) * len, 0, r * 1.3 + Math.cos(a) * len], [fingerR * .78, fingerR * .78, r * .6]).rotation.y = a;
    }
    for (let k = 0; k < hand.thumbs; k++) {
      const side = k === 0 ? 1 : -1;
      const tl = r * 1.1 * Math.sqrt(hand.len), tx = side * r * 1.2 * wide;
      const thumb = mesh(group, G.cylZ, M.limb, [tx, 0, r * .4], [r * .26, r * .24, tl], true);
      thumb.rotation.y = side * 1.1;
      mesh(group, G.sphereLo, M.limb, [tx + Math.sin(side * 1.1) * tl, 0, r * .4 + Math.cos(side * 1.1) * tl], [r * .26, r * .24, r * .26]);
    }
  }
  if (arm.mouthTip) return group;
  if (arm.tip === "claw" && arm.type !== "hands") {
    for (const s of [-1, 1]) { const c = mesh(group, G.coneZ, M.claw, [s * r * .35, 0, 0], [r * .35, r * .3, r * 2.2], true); c.rotation.y = s * .35; }
  } else if (arm.tip === "bulb") mesh(group, G.sphere, M.bulb, [0, 0, r * .8], [r * 1.25, r * 1.25, r * 1.25]);
  else if (arm.tip === "hook") { const h = mesh(group, G.hook, M.claw, [0, r * 1.2, r * .4], [r * 1.3, r * 1.3, r * 1.3], true); h.rotation.y = Math.PI / 2; }
  else if (arm.tip === "paddle") mesh(group, G.sphere, M.limb, [0, 0, r * 1.2], [r * 2.3, r * .3, r * 1.6], true);
  return group;
}

// The smiley mask: a shallow yellow dome with a dark rim, oval eyes and a smile, facing +z.
function makeSmiley(r, face, G) {
  const group = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: .42, metalness: 0, emissive: 0x3a2600, emissiveIntensity: .6 });
  const ink = new THREE.MeshStandardMaterial({ color: 0x1b1206, roughness: .55 });
  const depth = .2;
  mesh(group, G.sphere, yellow, [0, 0, 0], [r, r, r * depth], true);
  mesh(group, G.torusThin, ink, [0, 0, 0], [r * .99, r * .99, r * 1.4]);
  const surfaceZ = (x, y) => r * depth * Math.sqrt(Math.max(0, 1 - (x * x + y * y) / (r * r)));
  const eye = (x, wink) => {
    const y = r * .24;
    if (wink) {
      const m = mesh(group, G.torusArc, ink, [x, y - r * .06, surfaceZ(x, y) - r * .01], [r * .14, r * .14, r * .5]);
      m.rotation.z = Math.PI * .2;   // a closed, happy "^" eye
    } else mesh(group, G.sphereLo, ink, [x, y, surfaceZ(x, y) - r * .02], [r * .085, r * .16, r * .05]);
  };
  eye(-r * .32, false);
  eye(r * .32, face === "wink");
  if (face === "grin") {
    // an open grin: a dark half-disc with a strip of teeth
    const g = mesh(group, G.halfDisc, ink, [0, -r * .1, surfaceZ(0, -r * .3) + r * .005], [r * .52, r * .42, 1]);
    mesh(group, G.box, yellow.clone(), [0, -r * .17, surfaceZ(0, -r * .17) + r * .01], [r * .86, r * .1, r * .02]).material.color.set(0xfff6dc);
    g.rotation.z = 0;
  } else {
    const m = mesh(group, G.torusArc, ink, [0, -r * .02, surfaceZ(0, -r * .45) - r * .01], [r * .55, r * .55, r * .6]);
    m.rotation.z = Math.PI + Math.PI * .2;   // the arc spans .6 pi; centre it at the bottom
  }
  return group;
}

// Trypophobic pits: a disc whose radial gradient runs from a black core (wider when deeper) out to a
// translucent rim colour. The raised rim torus around it sells the concavity.
function pitTexture(depth) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d"), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  const core = .2 + depth * .45;
  gr.addColorStop(0, "rgba(4,1,2,1)");
  gr.addColorStop(core, `rgba(${10 + (1 - depth) * 30},${4 + (1 - depth) * 12},${5 + (1 - depth) * 10},1)`);
  gr.addColorStop(Math.min(.9, core + .28), "rgba(62,24,20,.8)");
  gr.addColorStop(1, "rgba(70,30,24,0)");
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function buildHoles(L, g, M, rec) {
  const C = M.C;
  const pitMat = new THREE.MeshStandardMaterial({ map: pitTexture(g.holeDepth), transparent: true, depthWrite: false, roughness: .55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const rimMat = new THREE.MeshPhysicalMaterial({ color: C.skin.clone().lerp(new THREE.Color(.72, .3, .28), g.holeRim * .6), roughness: .5, clearcoat: .4 + g.slime / 250, clearcoatRoughness: .25, sheen: .5, sheenColor: C.highlight });
  const seedMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(.82, .79, .58).lerp(C.skin, .15), roughness: .25, clearcoat: 1, clearcoatRoughness: .1 });
  const disc = new THREE.CircleGeometry(1, 22), ring = new THREE.TorusGeometry(1, .22, 8, 22), ball = new THREE.SphereGeometry(1, 12, 9);
  rec.holeGeometries = [disc, ring, ball];
  const Z = new THREE.Vector3(0, 0, 1), m = new THREE.Matrix4(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const byCluster = new Map();
  for (const h of L.holes) { if (!byCluster.has(h.cluster)) byCluster.set(h.cluster, []); byCluster.get(h.cluster).push(h); }
  rec.holeClusters = [];
  for (const list of byCluster.values()) {
    const seeds = list.filter((h) => h.seed);
    const pits = new THREE.InstancedMesh(disc, pitMat, list.length), rims = new THREE.InstancedMesh(ring, rimMat, list.length);
    const pods = seeds.length ? new THREE.InstancedMesh(ball, seedMat, seeds.length) : null;
    rims.castShadow = true; rims.receiveShadow = true;
    if (pods) { pods.castShadow = true; pods.receiveShadow = true; }
    const items = list.map((h) => ({ h, n: new THREE.Vector3(...h.normal), q: new THREE.Quaternion().setFromUnitVectors(Z, new THREE.Vector3(...h.normal)) }));
    const cluster = { pits, rims, pods, items, seeds: items.filter((it) => it.h.seed) };
    const place = (k) => {
      // k scales the hole opening (pulse); rims stretch with it, seeds sink and swell a little
      cluster.items.forEach((it, i) => {
        const s = it.h.size * (k ? 1 + k * Math.sin(it.phase) : 1);
        m.compose(v.set(...it.h.pos).addScaledVector(it.n, it.h.size * .03), it.q, sc.set(s, s, s));
        pits.setMatrixAt(i, m);
        m.compose(v.set(...it.h.pos).addScaledVector(it.n, it.h.size * .02), it.q, sc.set(s * 1.1, s * 1.1, it.h.size * (.3 + g.holeRim * 1.1)));
        rims.setMatrixAt(i, m);
      });
      cluster.seeds.forEach((it, i) => {
        const s = it.h.size * (k ? 1 + k * .6 * Math.sin(it.phase) : 1);
        m.compose(v.set(...it.h.pos).addScaledVector(it.n, -it.h.size * .12), it.q, sc.set(s * .5, s * .5, s * .38));
        pods.setMatrixAt(i, m);
      });
      pits.instanceMatrix.needsUpdate = true; rims.instanceMatrix.needsUpdate = true;
      if (pods) pods.instanceMatrix.needsUpdate = true;
    };
    items.forEach((it) => { it.phase = it.h.phase; });
    cluster.place = place;
    place(0);
    const parent = rec.lobes[list[0].lobe].group;
    parent.add(rims, pits);
    if (pods) parent.add(pods);
    rec.holeClusters.push(cluster);
  }
}

// Hair: one merged mesh per host (lobe or head). Each strand is a 3-sided tapered tube along a
// curve that leaves the skin along its normal, droops toward the host's "down" and curls around
// its own axis. Attributes aSway (direction * length, w = 0 at the root .. 1 at the tip) and aPhase
// let the vertex shader sway tips without touching the CPU each frame.
const HAIR_SEG = 5, HAIR_RAD = 3;
const HAIR_TINTS = { pale: 0xeee5bf, golden: 0xd9a03c, dark: 0x1f1813 };
function buildHair(L, g, M, rec, hostGroup, every = 1) {
  const color = g.hairTint === "skin" ? M.C.skin.clone().lerp(M.C.highlight, .35) : new THREE.Color(HAIR_TINTS[g.hairTint]);
  const material = new THREE.MeshStandardMaterial({ color, roughness: .45, metalness: 0, emissive: color.clone().multiplyScalar(g.hairTint === "pale" ? .18 : .06) });
  const uniforms = { uTime: { value: 0 }, uAmp: { value: g.hairSway * .35 } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aSway;\nattribute float aPhase;\nuniform float uTime;\nuniform float uAmp;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += aSway.xyz * (aSway.w * aSway.w) * uAmp * sin(uTime * 1.9 + aPhase);");
  };
  rec.hair = { material, uniforms };
  const byHost = new Map();
  for (let hi = 0; hi < L.hairs.length; hi += every) { const h = L.hairs[hi]; const key = `${h.host.kind}${h.host.index}`; if (!byHost.has(key)) byHost.set(key, { host: h.host, list: [] }); byHost.get(key).list.push(h); }
  const V = THREE.Vector3, up = new V(), a = new V(), b = new V(), n = new V(), down = new V(), u = new V(), w = new V(), tan = new V();
  const pts = Array.from({ length: HAIR_SEG + 1 }, () => new V());
  for (const { host, list } of byHost.values()) {
    // "down" in the host's own frame: heads are turned, lobes are not
    if (host.kind === "head") down.set(0, -1, 0).applyQuaternion(rec.heads[host.index].baseQuat.clone().invert()); else down.set(0, -1, 0);
    const ringVerts = (HAIR_SEG + 1) * HAIR_RAD, vCount = list.length * ringVerts;
    const pos = new Float32Array(vCount * 3), nrm = new Float32Array(vCount * 3), sway = new Float32Array(vCount * 4), phase = new Float32Array(vCount);
    const index = new Uint32Array(list.length * HAIR_SEG * HAIR_RAD * 6);
    let vi = 0, ii = 0;
    list.forEach((h, hi) => {
      n.set(...h.normal);
      u.set(Math.abs(n.y) < .9 ? 0 : 1, Math.abs(n.y) < .9 ? 1 : 0, 0).cross(n).normalize();
      w.crossVectors(n, u);
      const L0 = h.len, r0 = L0 * .022 * g.hairThick;
      const swayDir = new V().copy(u).multiplyScalar(Math.cos(h.phase)).addScaledVector(w, Math.sin(h.phase));
      for (let k = 0; k <= HAIR_SEG; k++) {
        const t = k / HAIR_SEG, curl = g.hairCurl * L0 * .14 * t;
        pts[k].set(...h.pos).addScaledVector(n, L0 * t * (1 - g.hairDroop * .45 * t)).addScaledVector(down, L0 * g.hairDroop * .8 * t * t)
          .addScaledVector(u, Math.cos(h.phase + t * 9) * curl).addScaledVector(w, Math.sin(h.phase + t * 9) * curl);
      }
      for (let k = 0; k <= HAIR_SEG; k++) {
        const t = k / HAIR_SEG, r = r0 * (1 - .88 * t);
        tan.subVectors(pts[Math.min(HAIR_SEG, k + 1)], pts[Math.max(0, k - 1)]).normalize();
        a.copy(Math.abs(tan.y) < .9 ? up.set(0, 1, 0) : up.set(1, 0, 0)).cross(tan).normalize();
        b.crossVectors(tan, a);
        for (let j = 0; j < HAIR_RAD; j++) {
          const ang = j / HAIR_RAD * TAU, c = Math.cos(ang), s = Math.sin(ang);
          const nx = a.x * c + b.x * s, ny = a.y * c + b.y * s, nz = a.z * c + b.z * s;
          pos[vi * 3] = pts[k].x + nx * r; pos[vi * 3 + 1] = pts[k].y + ny * r; pos[vi * 3 + 2] = pts[k].z + nz * r;
          nrm[vi * 3] = nx; nrm[vi * 3 + 1] = ny; nrm[vi * 3 + 2] = nz;
          sway[vi * 4] = swayDir.x * L0; sway[vi * 4 + 1] = swayDir.y * L0; sway[vi * 4 + 2] = swayDir.z * L0; sway[vi * 4 + 3] = t;
          phase[vi] = h.phase;
          vi++;
        }
      }
      const base = hi * ringVerts;
      for (let k = 0; k < HAIR_SEG; k++) for (let j = 0; j < HAIR_RAD; j++) {
        const p0 = base + k * HAIR_RAD + j, p1 = base + k * HAIR_RAD + (j + 1) % HAIR_RAD, q0 = p0 + HAIR_RAD, q1 = p1 + HAIR_RAD;
        index[ii++] = p0; index[ii++] = p1; index[ii++] = q0; index[ii++] = q0; index[ii++] = p1; index[ii++] = q1;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("aSway", new THREE.BufferAttribute(sway, 4));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material);
    m.userData.hair = true;
    m.frustumCulled = false;   // tips sway outside the static bounds
    hostGroup(host).add(m);
  }
}

// ---- build the creature from the layout ---------------------------------------------
// lod 0: hero detail (as the experiment); 1: supporting cast (medium blobs, half the hair);
// 2: crowd (coarse blobs and spheres, a third of the hair).
function buildCreature(L, { lod = 0 } = {}) {
  const g = L.genome;
  const M = makeMaterials(g);
  const G = { ...sharedGeometry() };   // happyLid / brow are per genome
  if (lod >= 2) { G.sphere = G.sphereLo; G.torus = G.torusThin; }
  const root = new THREE.Group();
  const realism = g.hyperrealism / 100;
  const detail = lod >= 2 ? [28, 18] : lod ? [40, 26] : realism > .6 ? [64, 40] : [48, 30];
  const outline = g.cartoonish > 30;
  const rec = { root, M, lobes: [], heads: [], eyes: [], mouths: [], arms: [], strands: [], drips: [], pimples: [], suckers: null, genome: g, layout: L };

  L.lobes.forEach((l, i) => {
    const group = new THREE.Group();
    group.position.copy(vec(l.c));
    const geo = blobGeometry(g, M.C, { w: detail[0], h: detail[1], lump: g.lump, seed: l.seed, toWorld: (p) => [l.c[0] + p[0] * l.r[0], l.c[1] + p[1] * l.r[1], l.c[2] + p[2] * l.r[2]] });
    const body = mesh(group, geo, M.skin, [0, 0, 0], l.r, true);
    body.receiveShadow = true;
    if (outline) mesh(group, geo, M.outline, [0, 0, 0], l.r.map((v) => v * 1.04)).renderOrder = -1;
    root.add(group);
    rec.lobes.push({ group, c: vec(l.c), phase: i });
  });

  const slitHorizontal = (g.seed & 1) === 1;
  const face = { smile: g.smile, happyEyes: g.happyEyes, sparkle: g.sparkle, brows: g.brows };
  // Smiling lower lid: a cap around an axis pointing down and 25 degrees forward. Its edge crosses the
  // eye's front at about lerp(-58, +18) degrees of elevation and dips lower at the sides: an arch.
  if (g.happyEyes > .06) { const cap = lerp(.12, 1.45, g.happyEyes); G.happyLid = new THREE.SphereGeometry(1, 32, 16, 0, TAU, Math.PI - cap, cap); }
  if (g.brows > .06) G.brow = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-1, -.1, 0), new THREE.Vector3(0, .6, 0), new THREE.Vector3(1, -.1, 0)), 18, .1 + g.brows * .14, 6);
  const hostGroup = (host) => host.kind === "head" ? rec.heads[host.index].group : rec.lobes[host.index].group;

  L.heads.forEach((h, i) => {
    const group = new THREE.Group();
    const b = S.basis(h.facing);
    const baseQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(vec(b.x), vec(b.y), vec(b.z)));
    const geo = blobGeometry(g, M.C, { w: lod >= 2 ? 22 : lod ? 30 : 40, h: lod >= 2 ? 16 : lod ? 22 : 28, lump: h.shape === "lumpy" ? .9 : g.lump * .5, seed: h.seed, shape: h.scale, taper: h.shape === "cone" ? .55 : 0, toWorld: (p) => [h.center[0] + p[0] * h.r, h.center[1] + p[1] * h.r, h.center[2] + p[2] * h.r] });
    mesh(group, geo, M.skin, [0, 0, 0], [h.r, h.r, h.r], true).receiveShadow = true;
    if (outline) mesh(group, geo, M.outline, [0, 0, 0], [h.r * 1.05, h.r * 1.05, h.r * 1.05]).renderOrder = -1;
    root.add(group);
    let neck = null;
    if (h.len > 0) { neck = new Tube(14, 10, M.limb); root.add(neck.mesh); }
    rec.heads.push({ h, group, baseQuat, neck, offset: vec(h.center).sub(vec(h.anchorW)), pts: new Float32Array(14 * 3) });
  });

  L.eyes.forEach((e) => {
    const eye = makeEye(e, M, G, slitHorizontal, face);
    hostGroup(e.host).add(eye.group);
    rec.eyes.push(eye);
  });

  const armMouthAt = new Map();
  L.mouths.forEach((mo) => {
    const mouth = makeMouth({ ...mo, smile: g.smile }, M, G);
    if (mo.host.kind === "arm") armMouthAt.set(mo.host.index, mouth);
    else {
      mouth.group.position.copy(vec(mo.pos)).addScaledVector(vec(mo.normal), mo.r * .04);
      mouth.group.quaternion.setFromUnitVectors(Z(), vec(mo.normal));
      hostGroup(mo.host).add(mouth.group);
    }
    rec.mouths.push(mouth);
  });

  let suckerTotal = 0;
  L.arms.forEach((arm, i) => {
    const tubes = arm.strands.map(() => { const t = new Tube(S.ARM_N, arm.leg || arm.type === "limb" || arm.type === "hands" ? 10 : 9, M.limb); root.add(t.mesh); return t; });
    const tip = makeTip(arm, M, G);
    const mouth = armMouthAt.get(i);
    if (mouth) tip.add(mouth.group);
    root.add(tip);
    const cap = mesh(root, G.sphereLo, M.limb, [0, 0, 0], [1, 1, 1], true);
    const joint = arm.leg || arm.type === "limb" ? mesh(root, G.sphereLo, M.limb, [0, 0, 0], [1, 1, 1], true) : null;
    for (const o of [tip, cap, joint, ...tubes.map((t) => t.mesh)]) if (o) o.userData.arm = true;
    rec.arms.push({ arm, tubes, tip, cap, joint, pts: new Float32Array(S.ARM_N * 3), rootW: new THREE.Vector3(), suckerStart: suckerTotal });
    suckerTotal += arm.suckers;
  });
  if (suckerTotal) {
    const rings = new THREE.InstancedMesh(G.suckerRing, M.sucker, suckerTotal);
    const holes = new THREE.InstancedMesh(G.suckerHole, M.suckerDark, suckerTotal);
    rings.frustumCulled = holes.frustumCulled = false;
    rings.userData.arm = holes.userData.arm = true;
    rings.castShadow = true;
    root.add(rings, holes);
    rec.suckers = { rings, holes, total: suckerTotal };
  }

  L.strands.forEach(([a, b]) => { const t = new Tube(12, 7, M.strand); root.add(t.mesh); rec.strands.push({ a, b, tube: t, pts: new Float32Array(12 * 3) }); });

  L.dermal.forEach((d) => {
    const parent = rec.lobes[d.lobe].group;
    const n = vec(d.normal);
    let m;
    if (d.kind === "warts") { m = mesh(parent, G.ico, M.wart, d.pos, [d.size, d.size * .8, d.size], true); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); }
    else if (d.kind === "spines") { m = mesh(parent, G.cone, M.spine, d.pos, [d.size * .25, d.size * 1.5, d.size * .25], true); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); m.position.addScaledVector(n, d.size * .6); }
    else {
      const x = new THREE.Vector3().crossVectors(n, vec(d.along)).normalize();
      const z = new THREE.Vector3().crossVectors(x, n).normalize();
      m = mesh(parent, G.sphereLo, M.frill, d.pos, [d.size * .07, d.size, d.size * .55], true);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, n, z));
      m.position.addScaledVector(n, d.size * .35);
    }
  });

  if (L.holes.length) buildHoles(L, g, M, rec);
  if (L.hairs.length) buildHair(L, g, M, rec, hostGroup, lod + 1);

  L.pimples.forEach((p) => {
    const group = new THREE.Group(), s = p.size;
    group.position.copy(vec(p.pos));
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vec(p.normal));
    rec.lobes[p.lobe].group.add(group);
    // the red halo is a wide ellipsoid sunk into the skin, so only a soft rim shows around the bump
    const halo = s * (1.35 + g.inflammation * .55);
    if (g.inflammation > .05) mesh(group, G.sphere, M.pimpleHalo, [0, -s * .3, 0], [halo, s * .42, halo]);
    const bump = mesh(group, G.sphere, M.pimple, [0, -s * .05, 0], [s, s * .8, s], true);
    let head = null;
    if (p.ripe > .12) head = mesh(group, G.sphereLo, M.pimpleHead, [0, s * .62, 0], [s * .42 * Math.sqrt(p.ripe), s * .3 * p.ripe + s * .06, s * .42 * Math.sqrt(p.ripe)]);
    group.traverse((o) => { o.userData.pimple = rec.pimples.length; });
    rec.pimples.push({ group, bump, head, size: s, ripe: p.ripe, popped: false, phase: p.phase, rate: 1.6 + (p.phase % 1) * 1.4 });
  });

  const slime = g.slime / 100;
  if (slime > .03) {
    // (the experiment's slime puddle is left out: on the video's dark floor it read as a grey disc)
    const rng = S.makeRng(g.seed + 1600);
    const drips = Math.round(3 + slime * 12);
    for (let i = 0; i < drips; i++) {
      const li = Math.floor(rng() * L.lobes.length);
      const l = L.lobes[li];
      const a = rng() * TAU, y = -.35 - rng() * .45, c = Math.sqrt(1 - y * y);
      const p = [Math.cos(a) * c * l.r[0], y * l.r[1], Math.sin(a) * c * l.r[2]];
      if (l.c[1] + p[1] < .1) continue;
      const len = (.1 + rng() * (.2 + slime * .28)) * g.size;
      const drip = mesh(rec.lobes[li].group, G.sphereLo, M.slime, p, [(.05 + rng() * .04) * g.size, len, (.05 + rng() * .04) * g.size]);
      rec.drips.push({ mesh: drip, baseY: p[1], baseScale: drip.scale.clone(), phase: rng() * TAU });
    }
  }

  if (L.mask) {
    const mk = L.mask, smiley = makeSmiley(mk.r, g.maskFace, G);
    const holder = new THREE.Group();
    holder.add(smiley);
    rec.mask = { kind: mk.kind, holder, smiley, tilt: g.maskTilt * .5 };
    if (mk.kind === "tentacle") {
      // its own pseudopod, swaying, with the mask turned to smile at the viewer
      rec.mask.stalk = new Tube(16, 9, M.limb);
      root.add(rec.mask.stalk.mesh, holder);
      Object.assign(rec.mask, { lobe: mk.host.index, local: mk.pos, normal: vec(mk.normal), len: mk.len, r: mk.r, pts: new Float32Array(16 * 3) });
    } else {
      const n = vec(mk.normal);
      holder.position.copy(vec(mk.pos)).addScaledVector(n, mk.lift + mk.r * .06);
      holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      hostGroup(mk.host).add(holder);
      if (mk.lift > .02) {
        // two thin straps back to the skin, so it reads as worn rather than floating
        const strap = new THREE.MeshStandardMaterial({ color: 0x1b1206, roughness: .6 });
        for (const x of [-1, 1]) mesh(smiley, G.cylZ, strap, [x * mk.r * .9, 0, -mk.lift - mk.r * .1], [mk.r * .035, mk.r * .035, mk.lift + mk.r * .1]);
      }
    }
  }

  L.cheeks.forEach((c) => {
    const n = vec(c.normal);
    const m = mesh(hostGroup(c.host), G.sphere, M.blush, [0, 0, 0], [c.r, c.r * .28, c.r * .72]);
    m.position.copy(vec(c.pos)).addScaledVector(n, -c.r * .1);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  });

  // Turn face pieces (smiling lids, brows, smiling mouths) so their +y points at world up.
  for (const hr of rec.heads) hr.group.quaternion.copy(hr.baseQuat);
  root.updateMatrixWorld(true);
  const turnUp = (object, parentForFrame) => {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(parentForFrame.getWorldQuaternion(new THREE.Quaternion()).invert());
    if (Math.hypot(up.x, up.y) > .15) object.rotation.z = Math.atan2(-up.x, up.y);
  };
  for (const eye of rec.eyes) for (const u of eye.upright) turnUp(u, u.parent);
  if (rec.mask && rec.mask.kind !== "tentacle") {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rec.mask.holder.getWorldQuaternion(new THREE.Quaternion()).invert());
    rec.mask.smiley.rotation.z = (Math.hypot(up.x, up.y) > .15 ? Math.atan2(-up.x, up.y) : 0) + rec.mask.tilt;
  } else if (rec.mask) rec.mask.smiley.rotation.z = rec.mask.tilt;
  for (const mouth of rec.mouths) if (mouth.smiling && mouth.group.parent !== root) {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mouth.group.getWorldQuaternion(new THREE.Quaternion()).invert());
    if (Math.hypot(up.x, up.y) > .15) mouth.group.rotateZ(Math.atan2(-up.x, up.y));
  }

  rec.materials = new Set();
  root.traverse((o) => { if (o.material) rec.materials.add(o.material); });
  return rec;
}

function lobeOffset(plan, i, n, t, w) {
  switch (plan) {
    case "worm": return [0, Math.max(0, Math.sin(t * 1.6 - i * .8)) * .12 * w, Math.sin(t * 1.1 - i * .7) * .1 * w];
    case "column": return [Math.sin(t * .8 + i * .35) * .04 * i * w, 0, Math.cos(t * .6 + i * .3) * .03 * i * w];
    case "cluster": return [Math.sin(t * .5 + i * 2.1) * .08 * w, Math.sin(t * .9 + i * 1.7) * .15 * w, Math.cos(t * .6 + i) * .08 * w];
    case "ring": return [0, Math.sin(t * 1.2 + i / n * TAU * 2) * .08 * w, 0];
    case "crawler": return [0, Math.sin(t * 1.4) * .06 * w, 0];
    default: return [Math.sin(t * .7 + i) * .02 * w, Math.sin(t * .9 + i * 1.3) * .03 * w, 0];
  }
}

// ---- baking: merge rigid parts into one mesh per material ---------------------------------------
// `skip(o)` returns "skip" (leave o alone), "nest" (leave it, but bake inside it on its own) or false.
const _inv = new THREE.Matrix4(), _nm = new THREE.Matrix3();
const _prepped = new WeakMap();
// The source geometry reduced to indexed position / normal (/ color), cached: shared shapes are prepared once.
function prepGeometry(geo) {
  let g = _prepped.get(geo);
  if (g) return g;
  g = geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "color") g.deleteAttribute(k);
  if (!g.index) g = mergeVertices(g);
  if (!g.attributes.normal) g.computeVertexNormals();
  _prepped.set(geo, g);
  return g;
}
// Writes every (geometry, matrix) of a bucket into one indexed geometry: no per-part clones.
function mergeBucket(list) {
  let nv = 0, ni = 0;
  const color = !!list[0].g.attributes.color;
  for (const it of list) { nv += it.g.attributes.position.count; ni += it.g.index.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = color ? new Float32Array(nv * 3) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const { g, m } of list) {
    const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, I = g.index.array, n = P.count;
    const e = m.elements;
    _nm.getNormalMatrix(m);
    const q = _nm.elements;
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), o = (vo + i) * 3;
      pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = N.getX(i), b = N.getY(i), c = N.getZ(i);
      let nx = q[0] * a + q[3] * b + q[6] * c, ny = q[1] * a + q[4] * b + q[7] * c, nz = q[2] * a + q[5] * b + q[8] * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[o] = nx / l; nrm[o + 1] = ny / l; nrm[o + 2] = nz / l;
      if (col) { col[o] = C.getX(i); col[o + 1] = C.getY(i); col[o + 2] = C.getZ(i); }
    }
    for (let k = 0; k < I.length; k++) idx[io + k] = I[k] + vo;
    vo += n; io += I.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  if (col) geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}
function bakeInto(group, skip) {
  group.updateMatrixWorld(true);
  _inv.copy(group.matrixWorld).invert();
  const buckets = new Map(), nested = [], baked = [];
  const visit = (o) => {
    for (const c of o.children) {
      const k = c.isInstancedMesh || c.isPoints || c.userData.hair ? "skip" : skip(c);
      if (k === "skip") continue;
      if (k === "nest") { nested.push(c); continue; }
      if (c.isMesh) {
        const g = prepGeometry(c.geometry);
        const key = c.material.uuid + (g.attributes.color ? "c" : "");
        if (!buckets.has(key)) buckets.set(key, { material: c.material, list: [] });
        buckets.get(key).list.push({ g, m: new THREE.Matrix4().multiplyMatrices(_inv, c.matrixWorld) });
        baked.push(c);
      }
      visit(c);
    }
  };
  visit(group);
  for (const c of baked) {
    // keep anything left inside a baked mesh (rare) by moving it up to the mesh's parent
    for (const k of [...c.children]) if (!baked.includes(k)) c.parent.attach(k);
    c.parent.remove(c);
  }
  for (const b of buckets.values()) {
    const m = new THREE.Mesh(mergeBucket(b.list), b.material);
    m.userData.baked = true;
    group.add(m);
  }
  for (const n of nested) bakeInto(n, skip);
}

// Builds a creature and bakes it. lod 0 and 1: everything that moves stays live (eyes blink and gaze, mouths
// open, lobes and heads sway, arms wriggle; pimples and drips freeze). lod 2: a crowd member, coarser,
// with the whole body frozen into ~one mesh per material; only the arms move.
export function makeCreature(genome, { lod = 0 } = {}) {
  const L = S.buildLayout(genome);
  const rec = buildCreature(L, { lod });
  rec.lod = lod;
  for (const m of rec.materials) m.userData.base = { emissive: m.emissive ? m.emissive.clone() : null, ei: m.emissiveIntensity ?? 1 };
  poseCreature(rec, 0, { cam: new THREE.Vector3(0, 2, 30) });
  if (lod >= 2) {
    bakeInto(rec.root, (o) => o.userData.arm ? (o.isMesh ? "skip" : "nest") : false);
    rec.frozen = true;
  } else {
    const skip = (o) => o.userData.anim ? (o.isMesh ? "skip" : "nest") : false;
    for (const l of rec.lobes) bakeInto(l.group, skip);
    for (const h of rec.heads) bakeInto(h.group, skip);
    for (const a of rec.arms) bakeInto(a.tip, skip);
    if (rec.mask) bakeInto(rec.mask.holder, skip);
    rec.pimples = []; rec.drips = [];
  }
  rec.materials = new Set();
  rec.root.traverse((o) => { if (o.material) rec.materials.add(o.material); });
  return rec;
}

// ---- per-frame animation, a pure function of (t, o) --------------------------------------------
// o.cam      camera position (world) for the eyes and the tentacle mask to look at
// o.mouth    null: idle chewing as in the experiment; 0..1: how far every mouth is open (singing)
// o.blink    0..1 extra lid closure (beat blinks), o.pulse 0..1 eye swell / glow on the beat
// o.wob      motion amount multiplier
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _m1 = new THREE.Matrix4(), _e1 = new THREE.Euler(), _e2 = new THREE.Vector3();
const Zv = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);
const _arr = [0, 0, 0];

function lobeWorld(rec, li, local, out) {
  const l = rec.lobes[li].group;
  return out.set(local[0], local[1], local[2]).multiplyScalar(l.scale.x).add(l.position);
}

export function poseCreature(rec, t, o = {}) {
  const g = rec.genome;
  const wob = g.wobble / 100;
  const w = (.3 + wob) * (o.wob ?? 1);
  const cam = o.cam || _v4.set(0, 2, 30);
  const live = !rec.frozen;
  rec.root.updateWorldMatrix(true, false);
  const camLocal = rec.root.worldToLocal(_v4.copy(cam));

  if (live) {
    const n = rec.lobes.length;
    rec.lobes.forEach((l, i) => {
      const off = lobeOffset(g.plan, i, n, t, w);
      l.group.position.set(l.c.x + off[0], l.c.y + off[1], l.c.z + off[2]);
      l.group.scale.setScalar(1 + Math.sin(t * 1.4 + i * .6) * (.008 + wob * .014));
    });
    for (const hr of rec.heads) {
      const h = hr.h;
      const amp = (h.len * .12 + .03) * w;
      const sway = _v2.set(Math.sin(t * h.speed + h.phase), Math.sin(t * h.speed * 1.3 + h.phase * 2) * .5, Math.cos(t * h.speed * .8 + h.phase)).multiplyScalar(amp);
      const anchor = lobeWorld(rec, h.lobe, h.anchor, _v1);
      hr.group.position.copy(anchor).add(hr.offset).add(sway);
      _e1.set(Math.sin(t * .6 + h.phase) * .12 * w, Math.sin(t * .45 + h.phase * 1.7) * .22 * w, 0);
      hr.group.quaternion.copy(hr.baseQuat).multiply(_q1.setFromEuler(_e1));
      if (hr.neck) {
        const p = hr.pts, N = 14;
        const c1 = _v3.set(h.nb[0], h.nb[1], h.nb[2]).multiplyScalar(h.len * .6).add(anchor).addScaledVector(sway, .4);
        const end = hr.group.position;
        for (let k = 0; k < N; k++) {
          const s = k / (N - 1), a = (1 - s) * (1 - s), b = 2 * (1 - s) * s, c = s * s;
          p[k * 3] = anchor.x * a + c1.x * b + end.x * c;
          p[k * 3 + 1] = anchor.y * a + c1.y * b + end.y * c;
          p[k * 3 + 2] = anchor.z * a + c1.z * b + end.z * c;
        }
        hr.neck.update(p, (s) => h.neckR * (1.3 - s * .35));
      }
    }
  }

  let si = 0;
  const sk = rec.suckers;
  for (const ar of rec.arms) {
    const arm = ar.arm;
    const root = lobeWorld(rec, arm.lobe, arm.root, ar.rootW);
    _arr[0] = root.x; _arr[1] = root.y; _arr[2] = root.z;
    ar.tubes.forEach((tube, k) => {
      S.armPath(arm, _arr, t * (o.wob ?? 1), wob, ar.pts, k);
      const sc = arm.strands[k].scale;
      tube.update(ar.pts, (s) => S.armRadius(arm, s) * sc);
      if (k !== 0) return;
      const last = (S.ARM_N - 1) * 3;
      const tipR = S.armRadius(arm, 1);
      ar.cap.position.set(ar.pts[last], ar.pts[last + 1], ar.pts[last + 2]);
      ar.cap.scale.setScalar(tipR * 1.02);
      ar.tip.position.copy(ar.cap.position);
      ar.tip.quaternion.setFromUnitVectors(Zv, _v1.set(tube.tan[last], tube.tan[last + 1], tube.tan[last + 2]));
      if (ar.joint) {
        const j = (arm.leg ? Math.round((S.ARM_N - 1) / 2) : Math.floor((S.ARM_N - 1) * .45)) * 3;
        ar.joint.position.set(ar.pts[j], ar.pts[j + 1], ar.pts[j + 2]);
        ar.joint.scale.setScalar(S.armRadius(arm, .5) * 1.3);
      }
      for (let q = 0; q < arm.suckers; q++) {
        const s = (q + 1) / (arm.suckers + 1) * .88;
        const f = s * (S.ARM_N - 1), i0 = Math.floor(f), fr = f - i0, o0 = i0 * 3, o1 = Math.min(S.ARM_N - 1, i0 + 1) * 3;
        const T = _v1.set(tube.tan[o0], tube.tan[o0 + 1], tube.tan[o0 + 2]);
        const down = _v2.set(0, -1, 0).addScaledVector(T, T.y).normalize();
        const side = _v3.crossVectors(T, down);
        const ang = q % 2 ? .95 : -.95;
        down.multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang));
        const r = S.armRadius(arm, s);
        const pos = side.set(lerp(ar.pts[o0], ar.pts[o1], fr), lerp(ar.pts[o0 + 1], ar.pts[o1 + 1], fr), lerp(ar.pts[o0 + 2], ar.pts[o1 + 2], fr)).addScaledVector(down, r * .92);
        _q1.setFromUnitVectors(Zv, down);
        _m1.compose(pos, _q1, _e2.setScalar(r * .5));
        sk.rings.setMatrixAt(si, _m1);
        _m1.compose(pos.addScaledVector(down, r * .03), _q1, _e2.setScalar(r * .5));
        sk.holes.setMatrixAt(si, _m1);
        si++;
      }
    });
  }
  if (sk) { sk.rings.instanceMatrix.needsUpdate = true; sk.holes.instanceMatrix.needsUpdate = true; }
  if (rec.hair) rec.hair.uniforms.uTime.value = t;
  if (!live) return;

  for (const st of rec.strands) {
    const a = rec.lobes[st.a].group.position, b = rec.lobes[st.b].group.position, p = st.pts;
    for (let k = 0; k < 12; k++) {
      const s = k / 11, sag = Math.sin(s * Math.PI) * (.35 + Math.sin(t * .8 + st.a) * .08);
      p[k * 3] = lerp(a.x, b.x, s); p[k * 3 + 1] = lerp(a.y, b.y, s) - sag; p[k * 3 + 2] = lerp(a.z, b.z, s);
    }
    st.tube.update(p, (s) => .06 * g.size * (1 + Math.abs(s - .5)));
  }

  rec.root.updateMatrixWorld(true);
  const extraBlink = o.blink || 0, pulse = o.pulse || 0;
  for (const e of rec.eyes) {
    const cyc = ((t * e.rate + e.phase / TAU) % 1 + 1) % 1;
    // the experiment's blink, shaped as a quick close-open instead of easing toward the last frame
    const own = e.gaze && cyc < .05 ? Math.sin(cyc / .05 * Math.PI) : 0;
    const shut = Math.max(own, extraBlink);
    e.lidGroup.scale.y = lerp(1, .1, shut) * (1 + pulse * .12);
    e.lidGroup.scale.x = 1 + pulse * .12;
    if (e.brow) {
      const flash = ((t * .17 + e.phase / TAU) % 1 + 1) % 1;
      const lift = (flash < .12 ? Math.sin(flash / .12 * Math.PI) : 0) + shut * .3 + pulse * .5;
      e.brow.position.y = e.browY + lift * e.r * .22;
    }
    if (e.gaze) {
      const local = e.group.worldToLocal(_v1.copy(cam));
      const jitter = g.ugliness / 100 * .15;
      const yaw = clamp(Math.atan2(local.x, local.z), -.55, .55) + Math.sin(t * 3.1 + e.phase) * jitter;
      const pitch = clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)), -.45, .45);
      e.ball.rotation.set(-pitch, yaw, 0);
    } else if (e.style === "orb") e.ball.scale.setScalar(1 + Math.sin(t * 2 + e.phase) * .06 + pulse * .2);
  }

  const sing = o.mouth;
  for (const mo of rec.mouths) {
    const m = mo.m;
    if (sing == null) {
      const open = .5 + .5 * Math.sin(t * mo.rate + mo.phase);
      if (mo.style === "beak") { mo.upper.rotation.x = -open * .3; mo.lower.rotation.x = open * .4; }
      else if (mo.style === "lamprey" || mo.style === "sphincter") mo.ring.scale.setScalar(.82 + open * .3);
      else if (mo.style === "vertical") { mo.upper.position.x = -open * m * .08; mo.lower.position.x = open * m * .08; }
      else { mo.upper.position.y = open * m * .08; mo.lower.position.y = -open * m * .1; }
      mo.cavity.scale.set(mo.cavityScale.x, mo.cavityScale.y * (.8 + open * .5), mo.cavityScale.z);
    } else {
      // singing: a much wider gape, jaws apart, the dark cavity stretched so it reads at a distance
      const open = clamp(sing, 0, 1);
      if (mo.style === "beak") { mo.upper.rotation.x = -open * .6; mo.lower.rotation.x = open * .85; }
      else if (mo.style === "lamprey" || mo.style === "sphincter") mo.ring.scale.setScalar(.75 + open * .65);
      else if (mo.style === "vertical") { mo.upper.position.x = -open * m * .3; mo.lower.position.x = open * m * .3; }
      else { mo.upper.position.y = open * m * .2; mo.lower.position.y = -open * m * .42; mo.lower.rotation.x = open * .25; }
      const wide = mo.style === "vertical" ? [1 + open * 1.4, 1 + open * .2] : mo.style === "lamprey" || mo.style === "sphincter" ? [1 + open * .7, 1 + open * .7] : [1 + open * .15, .6 + open * 2.2];
      mo.cavity.scale.set(mo.cavityScale.x * wide[0], mo.cavityScale.y * wide[1], mo.cavityScale.z);
      mo.cavity.position.y = mo.style === "vertical" ? 0 : -open * m * .1;
    }
  }

  if (rec.holeClusters && g.holePulse > 0) {
    const k = g.holePulse * .16;
    for (const c of rec.holeClusters) {
      c.items.forEach((it) => { it.phase = it.h.phase + t * (.9 + (it.h.phase % 1) * .5); });
      c.place(k);
    }
  }

  const mk = rec.mask;
  if (mk && mk.kind === "tentacle") {
    const a = lobeWorld(rec, mk.lobe, mk.local, _v1), n = mk.normal, L = mk.len, p = mk.pts;
    const sway = _v2.set(Math.sin(t * .7) * .12, Math.sin(t * .9 + 1) * .08, Math.cos(t * .6) * .06).multiplyScalar(L * (.4 + w));
    const end = _v3.copy(a).addScaledVector(n, L * .8).add(_e2.set(0, L * .45, 0)).add(sway);
    for (let k = 0; k < 16; k++) {
      const u = k / 15, c = 2 * (1 - u) * u;
      p[k * 3] = a.x * (1 - u) * (1 - u) + (a.x + n.x * L * .55) * c + end.x * u * u;
      p[k * 3 + 1] = a.y * (1 - u) * (1 - u) + (a.y + n.y * L * .55) * c + end.y * u * u;
      p[k * 3 + 2] = a.z * (1 - u) * (1 - u) + (a.z + n.z * L * .55) * c + end.z * u * u;
    }
    const r0 = mk.r * .32;
    mk.stalk.update(p, (u) => r0 * (1 - u * .55));
    mk.holder.position.copy(end);
    _m1.lookAt(camLocal, end, UP);
    mk.holder.quaternion.setFromRotationMatrix(_m1);
  }
}

// Emissive flash (0..1 towards white) for the kill effect, and a global light gain for the eyes.
const WHITE = new THREE.Color(1, 1, 1);
export function setGlow(rec, flash = 0, eyeGlow = 0) {
  if (rec._flash === flash && rec._eyeGlow === eyeGlow) return;
  rec._flash = flash; rec._eyeGlow = eyeGlow;
  const M = rec.M;
  const eyeMats = new Set([M.eyeWhite, M.slitWhite, M.iris, M.orb, M.compound, M.shine, M.halo]);
  for (const m of rec.materials) {
    const b = m.userData.base;
    if (!b || !m.emissive) continue;
    m.emissive.copy(b.emissive);
    let ei = b.ei;
    if (eyeGlow && eyeMats.has(m)) { m.emissive.lerp(WHITE, Math.min(1, eyeGlow)); ei = b.ei + eyeGlow * 1.5; }
    if (flash) { m.emissive.lerp(WHITE, flash); ei = ei + flash * 3; }
    m.emissiveIntensity = ei;
  }
}

export { S };
