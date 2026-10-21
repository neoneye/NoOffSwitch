// geom.js: the mesh generators of assets/3d-torus-shooter/index.html, ported to THREE.BufferGeometry.
// Same vertex data, face normals and sizes as the original (size 0.25 ≈ the SDF size 0.125 used on the torus).
// 0=Cube 1=Cylinder 2=Dodecahedron 3=Sphere 4=Tetrahedron 5=StellatedOcta 6=Cross 7=GreatIcosa 8=Icosidodecahedron 9=SmallStellatedDodeca

const out = () => ({ p: [], n: [], idx: [] });

function makeCube(s) {
  const h = s / 2, o = out();
  [[0, 0, 1, [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]], [0, 0, -1, [h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]],
   [1, 0, 0, [h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]], [-1, 0, 0, [-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]],
   [0, 1, 0, [-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]], [0, -1, 0, [-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]],
  ].forEach((f, fi) => {
    for (let k = 3; k < 7; k++) { o.p.push(...f[k]); o.n.push(f[0], f[1], f[2]); }
    const b = fi * 4; o.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return o;
}
export function makeSphere(r, stacks, slices) {
  const o = out();
  for (let i = 0; i <= stacks; i++) {
    const phi = Math.PI * i / stacks, sp = Math.sin(phi), cp = Math.cos(phi);
    for (let j = 0; j <= slices; j++) {
      const th = 2 * Math.PI * j / slices, nx = sp * Math.cos(th), ny = cp, nz = sp * Math.sin(th);
      o.p.push(r * nx, r * ny, r * nz); o.n.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < stacks; i++) for (let j = 0; j < slices; j++) {
    const a = i * (slices + 1) + j, b = a + slices + 1; o.idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return o;
}
function makeCylinder(r, hh, slices) {
  const o = out(), { p, n, idx } = o;
  for (let i = 0; i <= 1; i++) {
    const y = i === 0 ? -hh : hh;
    for (let j = 0; j <= slices; j++) { const th = 2 * Math.PI * j / slices, ct = Math.cos(th), st = Math.sin(th); p.push(r * ct, y, r * st); n.push(ct, 0, st); }
  }
  for (let j = 0; j < slices; j++) { const a = j, b = j + slices + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  for (let cap = 0; cap < 2; cap++) {
    const y = cap === 0 ? -hh : hh, ny = cap === 0 ? -1 : 1, base = p.length / 3;
    p.push(0, y, 0); n.push(0, ny, 0);
    for (let j = 0; j <= slices; j++) { const th = 2 * Math.PI * j / slices; p.push(r * Math.cos(th), y, r * Math.sin(th)); n.push(0, ny, 0); }
    for (let j = 0; j < slices; j++) { if (cap === 0) idx.push(base, base + j + 1, base + j + 2); else idx.push(base, base + j + 2, base + j + 1); }
  }
  return o;
}
function triN(a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; return [nx / l, ny / l, nz / l];
}
function makeTetrahedron(size) {
  const s = size * 0.55, V = [[s, s, s], [s, -s, -s], [-s, s, -s], [-s, -s, s]], o = out();
  [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]].forEach((f, fi) => {
    const a = V[f[0]], b = V[f[1]], c = V[f[2]], nn = triN(a, b, c);
    o.p.push(...a, ...b, ...c); o.n.push(...nn, ...nn, ...nn); o.idx.push(fi * 3, fi * 3 + 1, fi * 3 + 2);
  });
  return o;
}
const PHI = (1 + Math.sqrt(5)) / 2, IP = 1 / PHI;
const DOD_V = [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
  [0, IP, PHI], [0, IP, -PHI], [0, -IP, PHI], [0, -IP, -PHI], [IP, PHI, 0], [IP, -PHI, 0], [-IP, PHI, 0], [-IP, -PHI, 0],
  [PHI, 0, IP], [PHI, 0, -IP], [-PHI, 0, IP], [-PHI, 0, -IP]];
const DOD_F = [[0, 8, 10, 2, 16], [0, 16, 17, 1, 12], [0, 12, 14, 4, 8], [1, 17, 3, 11, 9], [1, 9, 5, 14, 12], [2, 10, 6, 15, 13],
  [2, 13, 3, 17, 16], [3, 13, 15, 7, 11], [4, 14, 5, 19, 18], [4, 18, 6, 10, 8], [5, 9, 11, 7, 19], [6, 18, 19, 7, 15]];
function makeDodecahedron(size) {
  const s = size * 0.45, V = DOD_V.map(v => v.map(c => c * s)), o = out();
  DOD_F.forEach(f => {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 5; k++) { cx += V[f[k]][0]; cy += V[f[k]][1]; cz += V[f[k]][2]; }
    const l = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1, nn = [cx / l, cy / l, cz / l];
    const w = triN(V[f[0]], V[f[1]], V[f[2]]), base = o.p.length / 3;
    for (let k = 0; k < 5; k++) { o.p.push(...V[f[k]]); o.n.push(...nn); }
    if (w[0] * nn[0] + w[1] * nn[1] + w[2] * nn[2] > 0) o.idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 3, base + 4);
    else o.idx.push(base, base + 2, base + 1, base, base + 3, base + 2, base, base + 4, base + 3);
  });
  return o;
}
function makeStellatedOcta(size) {
  const s = size * 0.55, V1 = [[s, s, s], [s, -s, -s], [-s, s, -s], [-s, -s, s]], V2 = V1.map(v => [-v[0], -v[1], -v[2]]), o = out();
  [V1, V2].forEach(V => [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]].forEach(f => {
    const a = V[f[0]], b = V[f[1]], c = V[f[2]], nn = triN(a, b, c), base = o.p.length / 3;
    o.p.push(...a, ...b, ...c); o.n.push(...nn, ...nn, ...nn); o.idx.push(base, base + 1, base + 2);
  }));
  return o;
}
function makeCross(size) {
  const h = size / 2, t = h * 0.35, o = out();
  [[h, t, t], [t, h, t], [t, t, h]].forEach(([bx, by, bz]) => {
    [[0, 0, 1, [-bx, -by, bz], [bx, -by, bz], [bx, by, bz], [-bx, by, bz]],
     [0, 0, -1, [bx, -by, -bz], [-bx, -by, -bz], [-bx, by, -bz], [bx, by, -bz]],
     [1, 0, 0, [bx, -by, bz], [bx, -by, -bz], [bx, by, -bz], [bx, by, bz]],
     [-1, 0, 0, [-bx, -by, -bz], [-bx, -by, bz], [-bx, by, bz], [-bx, by, -bz]],
     [0, 1, 0, [-bx, by, bz], [bx, by, bz], [bx, by, -bz], [-bx, by, -bz]],
     [0, -1, 0, [-bx, -by, -bz], [bx, -by, -bz], [bx, -by, bz], [-bx, -by, bz]],
    ].forEach(f => {
      const base = o.p.length / 3;
      for (let k = 3; k < 7; k++) { o.p.push(...f[k]); o.n.push(f[0], f[1], f[2]); }
      o.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
  });
  return o;
}
function icoVerts() {
  const raw = [];
  for (let s1 = -1; s1 <= 1; s1 += 2) for (let s2 = -1; s2 <= 1; s2 += 2) { raw.push([0, s1, s2 * PHI]); raw.push([s1, s2 * PHI, 0]); raw.push([s2 * PHI, 0, s1]); }
  return raw.map(v => { const l = Math.hypot(...v); return v.map(c => c / l); });
}
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function icoFaces(V) {
  let minD = Infinity;
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) minD = Math.min(minD, dist2(V[i], V[j]));
  const th = minD * 1.5, F = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++)
    if (dist2(V[i], V[j]) < th && dist2(V[j], V[k]) < th && dist2(V[i], V[k]) < th) F.push([i, j, k]);
  return { F, th };
}
// outward-oriented triangle with flat normal
function addTriOut(o, va, vb, vc) {
  const [nx, ny, nz] = triN(va, vb, vc), cx = (va[0] + vb[0] + vc[0]) / 3, cy = (va[1] + vb[1] + vc[1]) / 3, cz = (va[2] + vb[2] + vc[2]) / 3;
  const base = o.p.length / 3;
  if (nx * cx + ny * cy + nz * cz >= 0) { o.p.push(...va, ...vb, ...vc); o.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz); }
  else { o.p.push(...va, ...vc, ...vb); o.n.push(-nx, -ny, -nz, -nx, -ny, -nz, -nx, -ny, -nz); }
  o.idx.push(base, base + 1, base + 2);
}
function makeGreatIcosa(size) {   // triakis icosahedron spikes, as in the original
  const r = size * 0.5, V = icoVerts().map(v => v.map(c => c * r)), { F } = icoFaces(V), spikeR = r * 1.3, o = out();
  F.forEach(f => {
    const a = V[f[0]], b = V[f[1]], c = V[f[2]];
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3, cl = Math.hypot(cx, cy, cz) || 1;
    const tip = [cx / cl * spikeR, cy / cl * spikeR, cz / cl * spikeR];
    [[tip, a, b], [tip, b, c], [tip, c, a]].forEach(tr => addTriOut(o, ...tr));
  });
  return o;
}
function makeIcosidodecahedron(size) {
  const s = size * 0.9, icoV = icoVerts(), { F, th } = icoFaces(icoV), edges = [], edgeMap = {};
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (dist2(icoV[i], icoV[j]) < th) { edgeMap[i + ',' + j] = edges.length; edges.push([i, j]); }
  const V = edges.map(([a, b]) => [(icoV[a][0] + icoV[b][0]) / 2 * s, (icoV[a][1] + icoV[b][1]) / 2 * s, (icoV[a][2] + icoV[b][2]) / 2 * s]);
  const o = out(), ge = (a, b) => edgeMap[Math.min(a, b) + ',' + Math.max(a, b)];
  F.forEach(([i, j, k]) => addTriOut(o, V[ge(i, j)], V[ge(j, k)], V[ge(i, k)]));
  for (let v = 0; v < 12; v++) {
    const ring = []; edges.forEach(([a, b], ei) => { if (a === v || b === v) ring.push(ei); });
    const vn = icoV[v];
    const proj = ring.map(ei => { const mp = V[ei], d = mp[0] * vn[0] + mp[1] * vn[1] + mp[2] * vn[2]; return [mp[0] - d * vn[0], mp[1] - d * vn[1], mp[2] - d * vn[2]]; });
    const ul = Math.hypot(...proj[0]) || 1, u = proj[0].map(c => c / ul);
    const w = [vn[1] * u[2] - vn[2] * u[1], vn[2] * u[0] - vn[0] * u[2], vn[0] * u[1] - vn[1] * u[0]];
    const sorted = ring.map((ei, i) => ({ ei, ang: Math.atan2(proj[i][0] * w[0] + proj[i][1] * w[1] + proj[i][2] * w[2], proj[i][0] * u[0] + proj[i][1] * u[1] + proj[i][2] * u[2]) }))
      .sort((a, b) => a.ang - b.ang).map(x => x.ei);
    for (let i = 1; i < sorted.length - 1; i++) addTriOut(o, V[sorted[0]], V[sorted[i]], V[sorted[i + 1]]);
  }
  return o;
}
function makeSmallStellatedDodeca(size) {
  const s = size * 0.35, V = DOD_V.map(v => v.map(c => c * s)), o = out();
  DOD_F.forEach(f => {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 5; k++) { cx += V[f[k]][0]; cy += V[f[k]][1]; cz += V[f[k]][2]; }
    const tip = [cx / 5 * PHI, cy / 5 * PHI, cz / 5 * PHI];
    for (let k = 0; k < 5; k++) addTriOut(o, tip, V[f[k]], V[f[(k + 1) % 5]]);
  });
  return o;
}
export function makePacman(radius, stacks, slices, mouthHalf) {
  const o = out(), { p, n, idx } = o, cosM = Math.cos(mouthHalf), kept = [];
  for (let i = 0; i <= stacks; i++) {
    kept.push([]);
    const phi = Math.PI * i / stacks, sp = Math.sin(phi), cp = Math.cos(phi);
    for (let j = 0; j <= slices; j++) {
      const th = 2 * Math.PI * j / slices, nx = sp * Math.cos(th), ny = cp, nz = sp * Math.sin(th);
      if (nx > cosM && sp > 0.01) { kept[i].push(-1); continue; }
      kept[i].push(p.length / 3); p.push(radius * nx, radius * ny, radius * nz); n.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < stacks; i++) for (let j = 0; j < slices; j++) {
    const a = kept[i][j], b = kept[i + 1][j], c = kept[i][j + 1], d = kept[i + 1][j + 1];
    if (a >= 0 && b >= 0 && c >= 0) idx.push(a, b, c);
    if (c >= 0 && b >= 0 && d >= 0) idx.push(c, b, d);
  }
  const originIdx = p.length / 3; p.push(0, 0, 0); n.push(1, 0, 0);
  const boundary = [];
  for (let i = 0; i <= stacks; i++) {
    const phi = Math.PI * i / stacks, sp = Math.sin(phi), cp = Math.cos(phi);
    for (let j = 0; j <= slices; j++) {
      const th = 2 * Math.PI * j / slices, nx = sp * Math.cos(th), ny = cp, nz = sp * Math.sin(th);
      if (nx > cosM && sp > 0.01) {
        for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]])
          if (ni >= 0 && ni <= stacks && nj >= 0 && nj <= slices && kept[ni] && kept[ni][nj] >= 0) { boundary.push({ nx, ny, nz }); break; }
      }
    }
  }
  boundary.sort((a, b) => Math.atan2(a.nz, a.ny) - Math.atan2(b.nz, b.ny));
  const bStart = p.length / 3;
  for (const bv of boundary) { p.push(radius * bv.nx, radius * bv.ny, radius * bv.nz); const ll = Math.hypot(bv.ny, bv.nz) || 1; n.push(0, bv.ny / ll, bv.nz / ll); }
  for (let k = 0; k < boundary.length - 1; k++) idx.push(originIdx, bStart + k, bStart + k + 1);
  if (boundary.length > 1) idx.push(originIdx, bStart + boundary.length - 1, bStart);
  return o;
}
export function makeMouthStrip(pacRadius, segments, halfWidth, curveAmount) {
  const o = out(), thick = 0.012, yBase = -0.06;
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * 2 - 1, z = t * halfWidth, yMid = yBase + curveAmount * (1 - t * t);
    for (let side = -1; side <= 1; side += 2) {
      const y = yMid + side * thick, x = Math.sqrt(Math.max(pacRadius * pacRadius - y * y - z * z, 0.001)) + 0.003, nl = Math.hypot(x, y, z) || 1;
      o.p.push(x, y, z); o.n.push(x / nl, y / nl, z / nl);
    }
  }
  for (let i = 0; i < segments; i++) { const a = i * 2; o.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  return o;
}

export function toGeometry(THREE, o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
  g.setIndex(o.idx);
  g.computeBoundingSphere();
  return g;
}

export const SHAPE_NAMES = ['Cube', 'Cylinder', 'Dodeca', 'Sphere', 'Tetra', 'Stella', 'Cross', 'Gt.Icosa', 'IcoDodeca', 'StarDodeca'];
export function shapeGeometries(THREE) {
  return [makeCube(0.25), makeCylinder(0.1, 0.125, 16), makeDodecahedron(0.25), makeSphere(0.125, 12, 16), makeTetrahedron(0.25),
    makeStellatedOcta(0.25), makeCross(0.25), makeGreatIcosa(0.25), makeIcosidodecahedron(0.25), makeSmallStellatedDodeca(0.25)].map(o => toGeometry(THREE, o));
}
