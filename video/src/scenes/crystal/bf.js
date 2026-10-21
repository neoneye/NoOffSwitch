// bf.js: birefringence physics core, ported verbatim from assets/3d-birefringent-crystal/index.html (<script id="physics-core">).
// Units: millimetres; table plane is z = 0, z points up. Wave vectors are in units of k0 (|k| = n).
const BF = (function () {
  const BF = {};
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.sqrt(dot(a, a));
  const norm = a => mul(a, 1 / len(a));
  const deg = Math.PI / 180;
  BF.v = { add, sub, mul, dot, cross, len, norm };

  // Refractive indices (sodium D line, 589 nm) and the spread between red (656 nm) and blue (486 nm).
  BF.MATERIALS = {
    calcite: { name: 'Calcite (Iceland spar)', no: 1.658, ne: 1.486, dNo: 0.0135, dNe: 0.0062 },
    quartz: { name: 'Quartz', no: 1.544, ne: 1.553, dNo: 0.0078, dNe: 0.0081 },
    rutile: { name: 'Rutile (TiO₂)', no: 2.613, ne: 2.909, dNo: 0.085, dNe: 0.12 },
    nitrate: { name: 'Sodium nitrate', no: 1.587, ne: 1.336, dNo: 0.012, dNe: 0.005 },
    ice: { name: 'Ice', no: 1.309, ne: 1.313, dNo: 0.004, dNe: 0.004 },
    glass: { name: 'Glass (control, not birefringent)', no: 1.52, ne: 1.52, dNo: 0.008, dNe: 0.008 },
  };

  // Per-channel indices [R, G, B]; `amount` scales the real dispersion (0 = none).
  BF.channelIndices = (n, spread, amount) => [n - spread * 0.4 * amount, n, n + spread * 0.6 * amount];

  // Extraordinary index for a wave travelling at angle theta to the optic axis.
  BF.nTheta = (theta, no, ne) => 1 / Math.sqrt(Math.cos(theta) ** 2 / no ** 2 + Math.sin(theta) ** 2 / ne ** 2);

  // Walk-off angle between the e-wave's wave vector and its energy (ray) direction.
  BF.walkoff = (theta, no, ne) => {
    const n = BF.nTheta(theta, no, ne);
    return Math.atan(0.5 * n * n * Math.abs(1 / ne ** 2 - 1 / no ** 2) * Math.sin(2 * theta));
  };

  // Q(v) = 1 is the index ellipsoid for the e-wave: k_par^2/no^2 + k_perp^2/ne^2.
  const bil = (u, v, a, no, ne) => dot(u, v) / (ne * ne) + dot(u, a) * dot(v, a) * (1 / (no * no) - 1 / (ne * ne));

  // Wave vector inside the crystal for tangential part kt, travelling into the half-space along m.
  // mode 0 = ordinary, 1 = extraordinary. Returns null if no propagating solution.
  BF.insideK = (kt, m, mode, a, no, ne) => {
    if (mode === 0) {
      const q2 = no * no - dot(kt, kt);
      return q2 < 0 ? null : add(kt, mul(m, Math.sqrt(q2)));
    }
    const A = bil(m, m, a, no, ne), B = bil(kt, m, a, no, ne), C = bil(kt, kt, a, no, ne) - 1;
    const disc = B * B - A * C;
    if (disc < 0) return null;
    return add(kt, mul(m, (-B + Math.sqrt(disc)) / A));
  };

  // Energy direction (where the light actually goes) for wave vector k.
  BF.rayDir = (k, mode, a, no, ne) => {
    if (mode === 0) return norm(k);
    return norm(add(mul(k, 1 / (ne * ne)), mul(a, dot(k, a) * (1 / (no * no) - 1 / (ne * ne)))));
  };

  // Leaving the crystal through a face with outward normal N; null = total internal reflection.
  BF.exitDir = (k, N) => {
    const kt = sub(k, mul(N, dot(k, N)));
    const q2 = 1 - dot(kt, kt);
    return q2 < 0 ? null : add(kt, mul(N, Math.sqrt(q2)));
  };

  // Polarization (E-field direction) of each mode for wave vector k.
  BF.polarization = (k, mode, a) => {
    let o = cross(k, a);
    if (len(o) < 1e-6) o = cross(k, Math.abs(k[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    o = norm(o);
    return mode === 0 ? o : norm(cross(k, o));
  };

  // Unit edge directions of the calcite cleavage rhombohedron lying on one face, plus its optic axis.
  // All three face angles at the blunt corner are 101.92 deg; the optic axis is the 3-fold symmetry axis.
  BF.RHOMB_FACE_ANGLE = 101.92;
  BF.rhombFrame = () => {
    const cosA = Math.cos(BF.RHOMB_FACE_ANGLE * deg);
    const cb = Math.sqrt((cosA + 0.5) / 1.5), sb = Math.sqrt(1 - cb * cb);
    const u = [0, 1, 2].map(i => [sb * Math.cos(i * 2 * Math.PI / 3), sb * Math.sin(i * 2 * Math.PI / 3), cb]);
    const c = [0, 0, 1];
    let z = norm(cross(u[0], u[1]));
    if (dot(z, u[2]) < 0) z = mul(z, -1);
    const x = u[0], y = cross(z, x);
    const toW = v => [dot(v, x), dot(v, y), dot(v, z)];
    let axis = toW(c);
    if (axis[2] < 0) axis = mul(axis, -1);
    return { u1: toW(u[0]), u2: toW(u[1]), u3: toW(u[2]), axis };
  };

  // Optic axis from tilt (from vertical) and azimuth (from the crystal's length edge), crystal frame.
  BF.axisFromAngles = (tiltDeg, azDeg) => {
    const t = tiltDeg * deg, p = azDeg * deg;
    return [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)];
  };
  BF.anglesFromAxis = a => ({ tilt: Math.acos(Math.min(1, a[2])) / deg, az: Math.atan2(a[1], a[0]) / deg });

  // Build the crystal: a parallelepiped standing on the table.
  // p = { shape: 'rhomb'|'box', length, width, thickness, rotation (deg), x, y, tilt, azimuth }
  BF.buildCrystal = p => {
    let u1 = [1, 0, 0], u2 = [0, 1, 0], u3 = [0, 0, 1];
    if (p.shape === 'rhomb') ({ u1, u2, u3 } = BF.rhombFrame());
    const E1 = mul(u1, p.length), E2 = mul(u2, p.width), E3 = mul(u3, p.thickness / u3[2]);
    const r = (p.rotation || 0) * deg, cr = Math.cos(r), sr = Math.sin(r);
    const rot = v => [cr * v[0] - sr * v[1], sr * v[0] + cr * v[1], v[2]];
    const e1 = rot(E1), e2 = rot(E2), e3 = rot(E3);
    const half = mul(add(add(e1, e2), e3), 0.5);
    const O = [p.x - half[0], p.y - half[1], 0];
    const axis = norm(rot(BF.axisFromAngles(p.tilt, p.azimuth)));
    // Faces: 0 bottom, 1 top, 2..5 sides. Each plane: outward normal N and offset D (inside: N.x <= D).
    const planes = [];
    const pair = (ea, eb, ec) => {
      let n = norm(cross(ea, eb));
      if (dot(n, ec) < 0) n = mul(n, -1);
      planes.push({ N: mul(n, -1), D: -dot(n, O) });
      planes.push({ N: n, D: dot(n, add(O, ec)) });
    };
    pair(e1, e2, e3); pair(e2, e3, e1); pair(e3, e1, e2);
    planes[0] = { N: [0, 0, -1], D: 0 };
    const foot = [O, add(O, e1), add(add(O, e1), e2), add(O, e2)].map(v => [v[0], v[1]]);
    const center = add(O, half);
    return { O, e1, e2, e3, planes, axis, foot, center };
  };

  // Ray vs convex polyhedron. Returns { t, face } for the entry point, or null.
  BF.intersect = (cr, ro, rd) => {
    let tN = -Infinity, tF = Infinity, face = -1;
    for (let i = 0; i < 6; i++) {
      const { N, D } = cr.planes[i];
      const den = dot(N, rd), num = D - dot(N, ro);
      if (Math.abs(den) < 1e-12) { if (num < 0) return null; continue; }
      const t = num / den;
      if (den < 0) { if (t > tN) { tN = t; face = i; } } else if (t < tF) tF = t;
    }
    return tN < tF && tN > 0 ? { t: tN, face } : null;
  };

  // From point p inside, along s: the face it leaves through.
  BF.exitFace = (cr, p, s) => {
    let best = Infinity, face = -1;
    for (let i = 0; i < 6; i++) {
      const { N, D } = cr.planes[i];
      const den = dot(N, s);
      if (den <= 1e-12) continue;
      const t = (D - dot(N, p)) / den;
      if (t < best) { best = t; face = i; }
    }
    return { t: best, face };
  };

  // Trace one mode backwards from the eye: air ray dAir enters at p through face `face`.
  // Returns { kind: 'paper', xy, path, k0, k } when it reaches the bottom face of a crystal lying on the
  // table, { kind: 'out', p, dir, face, k0, k } when it leaves elsewhere (k0 = first, k = last wave vector),
  // or { kind: 'lost' } after too many internal reflections.
  BF.traceMode = (cr, p, dAir, face, mode, no, ne, maxBounce = 6) => {
    const a = cr.axis;
    let N = cr.planes[face].N;
    let k = BF.insideK(sub(dAir, mul(N, dot(dAir, N))), mul(N, -1), mode, a, no, ne);
    if (!k) return { kind: 'lost' };
    const k0 = k;
    let path = 0;
    for (let b = 0; b <= maxBounce; b++) {
      const s = BF.rayDir(k, mode, a, no, ne);
      const ex = BF.exitFace(cr, p, s);
      p = add(p, mul(s, ex.t)); path += ex.t;
      if (ex.face === 0 && cr.onTable !== false) return { kind: 'paper', xy: [p[0], p[1]], path, k0, k, bounces: b };
      N = cr.planes[ex.face].N;
      const out = BF.exitDir(k, N);
      if (out) return { kind: 'out', p, dir: out, face: ex.face, path, k0, k, bounces: b };
      const k2 = BF.insideK(sub(k, mul(N, dot(k, N))), mul(N, -1), mode, a, no, ne);
      if (!k2) return { kind: 'lost' };
      k = k2;
    }
    return { kind: 'lost' };
  };

  // ---- Two stacked crystals. Crystal 2 rests on crystal 1's top face, centred on it, turned by
  // rotation2 relative to crystal 1, with thickness2. Same material, shape and optic-axis setting.
  BF.moveCrystal = (cr, T) => Object.assign({}, cr, {
    O: add(cr.O, T), center: add(cr.center, T), onTable: false,
    planes: cr.planes.map(({ N, D }) => ({ N, D: D + dot(N, T) })),
    foot: cr.foot.map(f => [f[0] + T[0], f[1] + T[1]]),
  });
  // p = buildCrystal params + { stack, rotation2, thickness2, plate: 'none'|'hwp'|'rot', plateAngle (deg) }
  BF.buildStack = p => {
    const c1 = BF.buildCrystal(p);
    if (!p.stack) return { c1, c2: null, plate: null };
    const c2 = BF.buildCrystal(Object.assign({}, p, { thickness: p.thickness2, rotation: (p.rotation || 0) + (p.rotation2 || 0), x: 0, y: 0 }));
    const top1 = add(add(c1.O, mul(add(c1.e1, c1.e2), 0.5)), c1.e3);
    const bot2 = add(c2.O, mul(add(c2.e1, c2.e2), 0.5));
    // Half-wave plate: fast axis at plateAngle from crystal 1's grain direction on the table.
    // Rotator: turns every polarization by plateAngle.
    const g = Math.atan2(c1.axis[1], c1.axis[0]);
    const ang = p.plate === 'hwp' ? g + p.plateAngle * deg : (p.plateAngle || 0) * deg;
    const plate = { type: p.plate || 'none', c: Math.cos(ang), s: Math.sin(ang) };
    return { c1, c2: BF.moveCrystal(c2, sub(top1, bot2)), plate };
  };

  const perp = (v, d) => { const u = sub(v, mul(d, dot(v, d))), l = len(u); return l < 1e-9 ? null : mul(u, 1 / l); };
  // A thin plate lying flat between the crystals acts on the horizontal part of the polarization.
  // Half-wave plate: mirrors it about the fast axis. Rotator: turns it.
  BF.applyPlate = (p, pl) => {
    if (!pl || pl.type === 'none') return p;
    if (pl.type === 'hwp') { const f = [pl.c, pl.s, 0]; return add(sub(mul(f, 2 * dot(p, f)), p), [0, 0, 2 * p[2]]); }
    return [pl.c * p[0] - pl.s * p[1], pl.s * p[0] + pl.c * p[1], p[2]];
  };
  // Malus's law between crystals: light polarized along pol, crossing the gap along d, enters the next
  // crystal; the fraction that goes into mode m (whose wave vector at that face is k) is cos^2.
  BF.linkWeight = (pol, k, a, m, d, plate) => {
    const p = perp(BF.applyPlate(perp(pol, d) || pol, plate), d);
    const q = perp(BF.polarization(k, 0, a), d);
    if (!p || !q) return 0.5;
    const wo = dot(p, q) ** 2;
    return m === 0 ? wo : 1 - wo;
  };

  const airEnd = (q, d) => d[2] < -1e-4 ? { kind: 'paper', xy: [q[0] - d[0] * q[2] / d[2], q[1] - d[1] * q[2] / d[2]] } : { kind: 'sky', dir: d };

  // Backward trace of an eye ray through the stack (at most one pass through each crystal, like the shader).
  // Returns every light path: { kind: 'paper', xy } or { kind: 'sky', dir }, its share w of the eye ray's
  // brightness (unpolarized paper: 1/2 per mode in the first crystal, then cos^2 at the gap), and
  // modes = [mode in crystal 1, mode in crystal 2] (0 = o, 1 = e; one entry if it met only one crystal).
  BF.traceStack = (st, ro, rd, no, ne) => {
    const cs = [st.c1, st.c2].filter(Boolean);
    let h = null, ci = -1;
    cs.forEach((c, i) => { const t = BF.intersect(c, ro, rd); if (t && (!h || t.t < h.t)) { h = t; ci = i; } });
    if (!h) return [Object.assign(airEnd(ro, rd), { w: 1, modes: [] })];
    const A = cs[ci], p = add(ro, mul(rd, h.t)), paths = [];
    for (const m1 of [0, 1]) {
      const r = BF.traceMode(A, p, rd, h.face, m1, no, ne);
      if (r.kind === 'lost') continue;
      if (r.kind === 'paper') { paths.push({ kind: 'paper', xy: r.xy, w: 0.5, modes: [m1] }); continue; }
      const B = cs.length > 1 ? cs[1 - ci] : null, ro2 = sub(r.p, mul(r.dir, 1e-3));
      const h2 = B && BF.intersect(B, ro2, r.dir);
      if (!h2) { paths.push(Object.assign(airEnd(r.p, r.dir), { w: 0.5, modes: [m1] })); continue; }
      const p2 = add(ro2, mul(r.dir, h2.t));
      for (const m2 of [0, 1]) {
        const r2 = BF.traceMode(B, p2, r.dir, h2.face, m2, no, ne);
        if (r2.kind === 'lost') continue;
        const wl = BF.linkWeight(BF.polarization(r2.k0, m2, B.axis), r.k, A.axis, m1, r.dir, st.plate);
        const end = r2.kind === 'paper' ? { kind: 'paper', xy: r2.xy } : airEnd(r2.p, r2.dir);
        paths.push(Object.assign(end, { w: 0.5 * wl, modes: ci === 0 ? [m1, m2] : [m2, m1] }));
      }
    }
    return paths;
  };

  // Group paths that land on the same spot of paper into images (their brightness adds: the beams that
  // meet are polarized at right angles, so they don't interfere). Faint paths below minW are dropped.
  BF.images = (paths, tol = 0.05, minW = 1e-3) => {
    const out = [];
    for (const q of paths) {
      if (q.kind !== 'paper' || q.w < minW) continue;
      const im = out.find(o => Math.hypot(o.xy[0] - q.xy[0], o.xy[1] - q.xy[1]) < tol);
      if (im) { im.w += q.w; im.paths.push(q.modes); } else out.push({ xy: q.xy.slice(), w: q.w, paths: [q.modes] });
    }
    return out;
  };

  // Huygens construction in the principal section (2D): a flat wavefront enters straight down.
  // Ordinary wavelet: circle of radius 1/no. Extraordinary: ellipse with semi-axis 1/no along the
  // optic axis and 1/ne across it. Returns the tangent point of the e-ellipse with the new wavefront.
  BF.huygensTangent = (tiltDeg, no, ne) => {
    const t = tiltDeg * deg;
    const u = [Math.sin(t), -Math.cos(t)];           // optic axis, pointing down into the crystal
    const w = [Math.cos(t), Math.sin(t)];            // perpendicular, in the section
    const A = 1 / no, B = 1 / ne;
    // maximise depth = -(y): point(s) = A cos s u + B sin s w
    const s = Math.atan2(-B * w[1], -A * u[1]);
    return [A * Math.cos(s) * u[0] + B * Math.sin(s) * w[0], A * Math.cos(s) * u[1] + B * Math.sin(s) * w[1]];
  };

  return BF;
})();
export default BF;
