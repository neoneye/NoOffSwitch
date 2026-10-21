// gol.js: the 3D Game of Life engine, copied verbatim from the shared-code block of assets/3d-game-of-life/index.html
// (lattices, neighbour rings, rule parser, World stepping, presets). Only the test harness and tests are left out.
// ── Engine ───────────────────────────────────────────────────────────────
export const GOL = (() => {
  // Kuhn/Freudenthal triangulation: tetra k = monotone path (0,0,0) → (1,1,1) adding axes in PERMS[k] order.
  const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const TETRA = PERMS.map(p => {
    const v = [0, 0, 0], out = [[0, 0, 0]];
    for (const ax of p) { v[ax] = 1; out.push(v.slice()); }
    return out;
  });

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Triangle crystal (tetrahedral-octahedral honeycomb, the FCC crystal): every unit voxel (x,y,z) holds one regular
  // tetrahedron (d4) on its corners with an even coordinate sum, so it points one of two ways in a 3D checkerboard
  // (parity of x+y+z); a regular octahedron (d8, vertices w±e_i) sits at every odd grid corner w and fills the gaps.
  // Every face is an equilateral triangle; volumes 1/3 + 4/3 per two voxels fill space exactly.
  // Cells: d4 of voxel v is c = v; the d8 centred at the min corner of an odd voxel v is c = nv + (v >> 1).
  const CRYSTAL_TET = [0, 1].map(p => {
    const out = [];
    for (let c = 0; c < 8; c++) {
      const q = [c & 1, (c >> 1) & 1, (c >> 2) & 1];
      if (((q[0] + q[1] + q[2] + p) & 1) === 0) out.push(q);
    }
    return out;
  });
  const CRYSTAL_OCTA = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  // Corner-sharing neighbour rings, derived from the shapes on a small patch. `cells` lists {x, y, z, cls, corners}
  // (corners as "x,y,z" keys); for each reference cell the result holds flat Int8Arrays of [dx, dy, dz, cls, ...].
  // Ring 1, the 3×3 analogue, is every cell sharing at least one corner; ring 2, the 5×5 analogue, adds every cell
  // sharing a corner with a ring-1 cell.
  function cornerRings(cells, refs) {
    const byCorner = new Map();
    cells.forEach((c, i) => { for (const k of c.corners) { if (!byCorner.has(k)) byCorner.set(k, []); byCorner.get(k).push(i); } });
    const ring1 = i => { const s = new Set(); for (const k of cells[i].corners) for (const j of byCorner.get(k)) s.add(j); s.delete(i); return s; };
    const flat = (i, set) => Int8Array.from([...set].flatMap(j => [cells[j].x - cells[i].x, cells[j].y - cells[i].y, cells[j].z - cells[i].z, cells[j].cls]));
    const out = { 1: [], 2: [] };
    for (const i of refs) {
      const r1 = ring1(i), r2 = new Set(r1);
      for (const j of r1) for (const k of ring1(j)) r2.add(k);
      r2.delete(i);
      out[1].push(flat(i, r1)); out[2].push(flat(i, r2));
    }
    return out;
  }
  const ringReach = rings => Math.max(...rings[2].flatMap(L => [...L].filter((_, i) => i % 4 < 3).map(Math.abs)));
  const cornerKeys = (pts, dx, dy, dz) => pts.map(([a, b, c]) => `${a + dx},${b + dy},${c + dz}`);

  // Triangle crystal rings per cell class (0: d4 in an even voxel, 1: d4 in an odd voxel, 2: d8); cls in the
  // offsets is 0 for a d4 target and 1 for a d8 target.
  const CRYSTAL_NBRS = (() => {
    const R = 6, cells = [];
    for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) {
      const p = (x + y + z) & 1;
      cells.push({ x, y, z, cls: 0, corners: cornerKeys(CRYSTAL_TET[p], x, y, z) });
      if (p) cells.push({ x, y, z, cls: 1, corners: cornerKeys(CRYSTAL_OCTA, x, y, z) });
    }
    const find = (x, y, z, cls) => cells.findIndex(c => c.x === x && c.y === y && c.z === z && c.cls === cls);
    return cornerRings(cells, [find(0, 0, 0, 0), find(1, 0, 0, 0), find(1, 0, 0, 1)]);
  })();
  const CRYSTAL_REACH = ringReach(CRYSTAL_NBRS);

  // A15 Frank–Kasper crystal (β-tungsten / Cr3Si) split into its Delaunay tetrahedra: space filled by d4 cells only,
  // 46 per cubic unit cell in 3 slightly irregular shapes (edges within ±11%), 5 or 6 tetrahedra around every edge.
  // Corners in quarter-cell units: a unit cell is 4 across, and in the world it spans 4 voxels.
  // Cells: tetrahedron k of unit cell v (index over the (N/4)³ cells) is c = v * 46 + k.
  const A15_TETS = [
    [[1,0,2],[-1,0,2],[0,2,1],[0,0,0]], [[1,0,2],[0,2,3],[-1,0,2],[0,0,4]], [[1,0,2],[0,2,3],[0,2,1],[-1,0,2]],
    [[0,2,3],[0,2,1],[-1,4,2],[1,4,2]], [[0,2,1],[-1,4,2],[1,4,2],[0,4,0]], [[0,4,4],[0,2,3],[-1,4,2],[1,4,2]],
    [[2,1,0],[0,2,1],[0,2,-1],[0,0,0]], [[0,2,1],[0,2,-1],[0,4,0],[2,3,0]], [[1,0,2],[0,2,1],[2,1,0],[0,0,0]],
    [[1,0,2],[0,2,3],[0,0,4],[2,1,4]], [[1,0,2],[0,2,1],[0,2,3],[2,2,2]], [[0,2,3],[0,2,1],[1,4,2],[2,2,2]],
    [[0,2,1],[0,4,0],[1,4,2],[2,3,0]], [[0,4,4],[0,2,3],[1,4,2],[2,3,4]], [[2,1,0],[0,2,-1],[0,2,1],[2,3,0]],
    [[2,-1,0],[1,0,2],[2,1,0],[0,0,0]], [[1,0,2],[0,0,4],[2,-1,4],[2,1,4]], [[1,0,2],[2,1,0],[0,2,1],[2,2,2]],
    [[1,0,2],[0,2,3],[2,1,4],[2,2,2]], [[0,2,1],[2,3,0],[1,4,2],[2,2,2]], [[0,2,3],[1,4,2],[2,3,4],[2,2,2]],
    [[2,1,0],[2,3,0],[0,2,1],[2,2,2]], [[0,2,3],[2,3,4],[2,1,4],[2,2,2]], [[2,-1,0],[1,0,2],[3,0,2],[2,1,0]],
    [[3,0,2],[1,0,2],[2,-1,4],[2,1,4]], [[3,0,2],[2,1,0],[1,0,2],[2,2,2]], [[3,0,2],[1,0,2],[2,1,4],[2,2,2]],
    [[1,4,2],[2,3,0],[3,4,2],[2,2,2]], [[1,4,2],[3,4,2],[2,3,4],[2,2,2]], [[2,1,0],[4,2,1],[2,3,0],[2,2,2]],
    [[4,2,3],[2,1,4],[2,3,4],[2,2,2]], [[2,-1,0],[2,1,0],[3,0,2],[4,0,0]], [[3,0,2],[2,-1,4],[4,0,4],[2,1,4]],
    [[3,0,2],[4,2,1],[2,1,0],[2,2,2]], [[3,0,2],[2,1,4],[4,2,3],[2,2,2]], [[3,4,2],[2,3,0],[4,2,1],[2,2,2]],
    [[4,2,3],[2,3,4],[3,4,2],[2,2,2]], [[2,1,0],[2,3,0],[4,2,1],[4,2,-1]], [[3,0,2],[4,0,0],[2,1,0],[4,2,1]],
    [[3,0,2],[4,0,4],[4,2,3],[2,1,4]], [[3,0,2],[4,2,3],[4,2,1],[2,2,2]], [[4,2,3],[3,4,2],[4,2,1],[2,2,2]],
    [[4,4,0],[4,2,1],[3,4,2],[2,3,0]], [[4,2,3],[4,4,4],[3,4,2],[2,3,4]], [[2,1,0],[4,2,1],[4,0,0],[4,2,-1]],
    [[4,4,0],[4,2,1],[2,3,0],[4,2,-1]],
  ];
  // Rings per tetrahedron k of the unit cell; offsets in whole cells, cls = the target tetrahedron's index.
  const A15_NBRS = (() => {
    const R = 3, cells = [];
    for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++)
      A15_TETS.forEach((t, k) => cells.push({ x, y, z, cls: k, corners: cornerKeys(t, 4 * x, 4 * y, 4 * z) }));
    return cornerRings(cells, A15_TETS.map((_, k) => cells.findIndex(c => !c.x && !c.y && !c.z && c.cls === k)));
  })();
  const A15_REACH = ringReach(A15_NBRS);

  const cellsPerVoxel = lattice => (lattice === 'tetra' ? 6 : 1);
  const ringMax = rings => Math.max(...rings.map(L => L.length / 4));
  const maxCount = (lattice, r) => lattice === 'crystal' ? ringMax(CRYSTAL_NBRS[r])
    : lattice === 'a15' ? ringMax(A15_NBRS[r])
    : cellsPerVoxel(lattice) * (2 * r + 1) ** 3 - 1;

  // "S/B/C", optionally followed by "/M" (box neighbourhood) as in common 3D CA rule lists.
  function parseRule(text, maxC) {
    const parts = String(text).replace(/\s+/g, '').split('/');
    if (parts.length === 4) {
      if (/^n$/i.test(parts[3])) return { error: 'Only box (M) neighbourhoods are supported, not von Neumann (N)' };
      if (!/^m$/i.test(parts[3])) return { error: `Unknown neighbourhood "${parts[3]}"` };
      parts.pop();
    }
    if (parts.length !== 3) return { error: 'Rule must be S/B/C, e.g. 4/4/5' };
    const tables = [];
    for (let i = 0; i < 2; i++) {
      const t = new Uint8Array(maxC + 1);
      if (parts[i] !== '') for (const tok of parts[i].split(',')) {
        const m = /^(\d+)(?:-(\d+))?$/.exec(tok);
        if (!m) return { error: `Bad ${i ? 'birth' : 'survival'} entry "${tok}"` };
        const a = +m[1], b = m[2] === undefined ? a : +m[2];
        if (a > b) return { error: `Backwards range "${tok}"` };
        if (b > maxC) return { error: `${b} exceeds the max neighbour count ${maxC}` };
        for (let c = a; c <= b; c++) t[c] = 1;
      }
      tables.push(t);
    }
    if (!/^\d+$/.test(parts[2])) return { error: 'State count C must be a whole number' };
    const C = +parts[2];
    if (C < 2 || C > 255) return { error: 'State count C must be 2..255' };
    return { S: tables[0], B: tables[1], C, text: parts.join('/') };
  }

  // Wrap-around sliding-window sum of radius r along one axis of an N³ grid.
  function boxAxis(src, dst, N, r, axis) {
    const st = axis === 0 ? 1 : axis === 1 ? N : N * N;  // stride along the summed axis
    const s1 = axis === 0 ? N : 1;                       // strides of the two other axes
    const s2 = axis === 2 ? N : N * N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const base = i * s1 + j * s2;
      let sum = 0;
      for (let d = -r; d <= r; d++) sum += src[base + ((d + N) % N) * st];
      for (let t = 0; t < N; t++) {
        dst[base + t * st] = sum;
        sum += src[base + ((t + r + 1) % N) * st] - src[base + ((t - r + N) % N) * st];
      }
    }
  }

  class World {
    constructor(N, lattice, r) {
      this.crystal = lattice === 'crystal';
      this.a15 = lattice === 'a15';
      this.cellCounted = this.crystal || this.a15;   // per-cell corner rings instead of voxel box sums
      if (this.crystal) {
        if (N % 2 || N < 2 * CRYSTAL_REACH + 2) throw new Error(`triangle crystal needs an even N >= ${2 * CRYSTAL_REACH + 2}, got ${N}`);
      } else if (this.a15) {
        if (N % 4 || N / 4 < 2 * A15_REACH + 1) throw new Error(`A15 needs N a multiple of 4 with N/4 >= ${2 * A15_REACH + 1}, got ${N}`);
      } else if (N < 2 * r + 1) throw new Error(`N=${N} is too small for radius ${r}`);
      this.N = N; this.lattice = lattice; this.r = r;
      this.G = this.a15 ? N / 4 : N;      // grid side: voxels, or A15 unit cells of 4 voxels
      // crystal: 1 d4 per voxel, its d8 cells live after the d4s (see CRYSTAL_TET); A15: 46 d4 per unit cell
      this.per = this.a15 ? 46 : cellsPerVoxel(lattice);
      this.nv = this.G ** 3; this.nc = this.crystal ? this.nv + this.nv / 2 : this.nv * this.per;
      this.maxCount = maxCount(lattice, r);
      this.state = new Uint8Array(this.nc);
      this.next = new Uint8Array(this.nc);
      if (this.cellCounted) {
        const G = this.G, K = this.reach = this.a15 ? A15_REACH : CRYSTAL_REACH;
        this.cnt = new Uint16Array(this.nc);
        this.nbrs = (this.a15 ? A15_NBRS : CRYSTAL_NBRS)[r];
        this.wrap = Int32Array.from({ length: G + 2 * K }, (_, i) => (i - K + G) % G);
      } else {
        this.a = new Uint16Array(this.nv);
        this.b = new Uint16Array(this.nv);
      }
      this.rule = null;
      this.gen = 0; this.alive = 0; this.nonDead = 0; this.changes = 0; this.changed = false;
    }
    setRule(rule) {
      if (!rule || rule.error || rule.S.length !== this.maxCount + 1)
        throw new Error('rule was parsed for a different neighbourhood');
      this.rule = rule;
    }
    clear() { this.state.fill(0); this.gen = 0; this.updateStats(); }
    seed(density, region, rng) {
      const { N, G, per, state } = this;
      state.fill(0);
      const L = Math.max(1, Math.min(G, Math.round(region * G / N))), o = (G - L) >> 1;   // region is in voxels
      for (let z = o; z < o + L; z++) for (let y = o; y < o + L; y++) for (let x = o; x < o + L; x++) {
        const v = x + G * (y + G * z), base = v * per;
        for (let k = 0; k < per; k++) if (rng() < density) state[base + k] = 1;
        if (this.crystal && ((x + y + z) & 1) && rng() < density) state[this.nv + (v >> 1)] = 1;
      }
      this.gen = 0; this.updateStats();
    }
    updateStats() {
      let alive = 0, nonDead = 0;
      const st = this.state;
      for (let c = 0; c < st.length; c++) { const s = st[c]; if (s) { nonDead++; if (s === 1) alive++; } }
      this.alive = alive; this.nonDead = nonDead; this.changes = 0; this.changed = false;
    }
    // Per-voxel count of alive cells in the (2r+1)³ voxel block, the voxel itself included.
    countVoxels() {
      const { N, r, per, state, a, b, nv } = this;
      if (per === 1) for (let v = 0; v < nv; v++) a[v] = state[v] === 1 ? 1 : 0;
      else for (let v = 0, c = 0; v < nv; v++) {
        let s = 0;
        for (let k = 0; k < 6; k++, c++) if (state[c] === 1) s++;
        a[v] = s;
      }
      boxAxis(a, b, N, r, 0); boxAxis(b, a, N, r, 1); boxAxis(a, b, N, r, 2);
      return b;
    }
    // Triangle crystal and A15: per-cell count of alive neighbours (self excluded). Each alive cell adds 1 to every
    // cell in its offset list; the corner-sharing relation is symmetric, so this equals counting each cell's own neighbours.
    countCells() {
      const { G, nv, state, cnt, wrap: W, reach: K, nbrs } = this;
      cnt.fill(0);
      // target(t, cls) maps a neighbour's grid position and class to its cell index.
      const scatter = (L, x, y, z, target) => {
        for (let i = 0; i < L.length; i += 4)
          cnt[target(W[x + L[i] + K] + G * (W[y + L[i + 1] + K] + G * W[z + L[i + 2] + K]), L[i + 3])]++;
      };
      if (this.a15) {
        const target = (t, k) => t * 46 + k;
        for (let z = 0, v = 0; z < G; z++) for (let y = 0; y < G; y++) for (let x = 0; x < G; x++, v++)
          for (let k = 0, c = v * 46; k < 46; k++, c++) if (state[c] === 1) scatter(nbrs[k], x, y, z, target);
      } else {
        const target = (t, octa) => (octa ? nv + (t >> 1) : t);
        for (let z = 0, v = 0; z < G; z++) for (let y = 0; y < G; y++) for (let x = 0; x < G; x++, v++) {
          const p = (x + y + z) & 1;
          if (state[v] === 1) scatter(nbrs[p], x, y, z, target);
          if (p && state[nv + (v >> 1)] === 1) scatter(nbrs[2], x, y, z, target);
        }
      }
      return cnt;
    }
    step() {
      const { per, state, next, nv, nc } = this, { S, B, C } = this.rule;
      let alive = 0, nonDead = 0, changes = 0;
      // n = alive neighbours excluding the cell itself.
      const advance = (c, n) => {
        const s = state[c];
        const ns = s === 0 ? B[n] : s === 1 ? (S[n] ? 1 : (C === 2 ? 0 : 2)) : (s + 1 >= C ? 0 : s + 1);
        next[c] = ns;
        if (ns) { nonDead++; if (ns === 1) alive++; }
        if (ns !== s) changes++;
      };
      if (this.cellCounted) {
        const cnt = this.countCells();
        for (let c = 0; c < nc; c++) advance(c, cnt[c]);
      } else {
        const cnt = this.countVoxels();   // box sums include the cell itself when it is alive
        for (let v = 0, c = 0; v < nv; v++) {
          const n = cnt[v];
          for (let k = 0; k < per; k++, c++) advance(c, state[c] === 1 ? n - 1 : n);
        }
      }
      this.state = next; this.next = state;
      this.alive = alive; this.nonDead = nonDead; this.changes = changes; this.changed = changes > 0;
      this.gen++;
    }
  }

  // Presets, curated by eye in the browser (cube at N=48, tetra at N=32, gens ~30/100/250): distinct 3D structures with
  // empty space around them, not TV static, not frozen. Candidates came from search.mjs and scratch scans around known
  // 26-neighbour classics (Builder 2,6,9/4,6,8-9/10, Large Lines 5/4,6,9/10, Coral 5-8/6-7,9,12/4, Pyroclastic) and
  // their density-scaled versions. Every entry passes evaluate() on seed 1 (N=32); each default also on seeds 2 and 3.
  // The first entry of each lattice/radius is that combination's default, best-looking first.
  // (cube r=2 leads with Coral Islands: it passes N=32 and N=48 on seeds 1-12, whereas Billowing Membranes is fragile at small N.)
  // Tetra note: all 6 tetrahedra of a voxel see the same box count, so a voxel's cells only ever split along the random
  // seed (alive vs dead at gen 0) and a voxel that empties and is reborn fills 6/6. Fire rules therefore draw whole
  // voxels (tetra visible as diagonal cracks); the fill=1.0 presets keep seeded split voxels and show single tetrahedra.
  // The triangle crystal counts per cell (corner-sharing rings), so its d4 and d8 cells evolve independently.
  const PRESETS = [
    // cube r=1
    { name: 'Builder',             lattice: 'cube', r: 1, rule: '2,6,9/4,6,8-9/10',            density: 0.3,  fill: 0.2 },
    { name: 'Comet Tubes',         lattice: 'cube', r: 1, rule: '11-20/4-5/16',                density: 0.4,  fill: 0.3 },
    { name: 'Shard Burst',         lattice: 'cube', r: 1, rule: '10-18/4-5/10',                density: 0.4,  fill: 0.3 },
    { name: 'Large Lines',         lattice: 'cube', r: 1, rule: '5/4,6,9/10',                  density: 0.35, fill: 0.5 },
    { name: 'Creeping Bush',       lattice: 'cube', r: 1, rule: '4-7/6-7/10',                  density: 0.3,  fill: 0.3 },
    { name: 'Spreading Coral',     lattice: 'cube', r: 1, rule: '5-8/6-7,9,12/16',             density: 0.3,  fill: 0.5 },
    // cube r=2
    { name: 'Coral Islands',       lattice: 'cube', r: 2, rule: '14-33/30-33/16',              density: 0.3,  fill: 1.0 },
    { name: 'Billowing Membranes', lattice: 'cube', r: 2, rule: '24-39/26-35,43-46,53-58/10',  density: 0.4,  fill: 0.5 },
    { name: 'Crumbling Ruin',      lattice: 'cube', r: 2, rule: '21-52/43-52/8',               density: 0.5,  fill: 0.5 },
    { name: 'Smouldering Rock',    lattice: 'cube', r: 2, rule: '22-65/16-18/24',              density: 0.5,  fill: 0.5 },
    { name: 'Lace Web',            lattice: 'cube', r: 2, rule: '11-30/30-33/8',               density: 0.3,  fill: 1.0 },
    // tetra r=1
    { name: 'Swooping Sheets',     lattice: 'tetra', r: 1, rule: '63-127/23-35/8',             density: 0.3,  fill: 0.5 },
    { name: 'Drifting Shells',     lattice: 'tetra', r: 1, rule: '58-112/21-35/10',            density: 0.4,  fill: 0.5 },
    { name: 'Scattered Rods',      lattice: 'tetra', r: 1, rule: '29-34/20-29,34-40,52-62/10', density: 0.3,  fill: 0.5 },
    { name: 'Prism Glitter',       lattice: 'tetra', r: 1, rule: '14-47/42-49/16',             density: 0.3,  fill: 1.0 },
    { name: 'Thinning Frost',      lattice: 'tetra', r: 1, rule: '18-43/36-43/8',              density: 0.2,  fill: 1.0 },
    { name: 'Lone Gliders',        lattice: 'tetra', r: 1, rule: '62-111/23-35/8',             density: 0.2,  fill: 0.7 },
    // tetra r=2
    { name: 'Tetra Archipelago',   lattice: 'tetra', r: 2, rule: '67-198/179-215/8',           density: 0.3,  fill: 1.0 },
    { name: 'Windowed Shell',      lattice: 'tetra', r: 2, rule: '65-218/194-227/16',          density: 0.4,  fill: 0.7 },
    { name: 'Twisting Knot',       lattice: 'tetra', r: 2, rule: '118-291/241-291/10',         density: 0.4,  fill: 0.7 },
    { name: 'Wandering Lump',      lattice: 'tetra', r: 2, rule: '95-221/181-227/10',          density: 0.4,  fill: 0.5 },
    // triangle crystal r=1 (d4 38 / d8 50 corner neighbours): fire-style rules found by a structure-ranked scan
    { name: 'Folded Planes',       lattice: 'crystal', r: 1, rule: '7-8/7-10/10',              density: 0.5,  fill: 0.3 },
    { name: 'Broken Coral',        lattice: 'crystal', r: 1, rule: '8-10,13-14/6-7/8',         density: 0.2,  fill: 0.3 },
    { name: 'Rolling Sheets',      lattice: 'crystal', r: 1, rule: '10-15/7-9/8',              density: 0.2,  fill: 0.5 },
    { name: 'Bubble Burst',        lattice: 'crystal', r: 1, rule: '4-6/6-9/16',               density: 0.5,  fill: 0.2 },
    { name: 'Ember Ball',          lattice: 'crystal', r: 1, rule: '1-7/8/8',                  density: 0.2,  fill: 0.3 },
    { name: 'Glowing Seed',        lattice: 'crystal', r: 1, rule: '1-6/8-10/10',              density: 0.2,  fill: 0.3 },
    // triangle crystal r=2 (d4 226 / d8 244): cube r=2 presets with counts scaled ~1.85x, plus one lively scan find
    { name: 'Crystal Islands',     lattice: 'crystal', r: 2, rule: '26-62/55-62/16',           density: 0.3,  fill: 1.0 },
    { name: 'Hollow Geode',        lattice: 'crystal', r: 2, rule: '41-120/30-33/24',          density: 0.5,  fill: 0.5 },
    { name: 'Boiling Lumps',       lattice: 'crystal', r: 2, rule: '24-44/34-44/10',           density: 0.3,  fill: 0.3 },
    { name: 'Twin Nuggets',        lattice: 'crystal', r: 2, rule: '39-96/80-96/8',            density: 0.5,  fill: 0.5 },
    { name: 'Shattered Glass',     lattice: 'crystal', r: 2, rule: '20-55/55-61/8',            density: 0.3,  fill: 1.0 },
    // A15 all-d4 r=1 (67–70 corner neighbours): other lattices' presets with counts scaled to this ring, then mutated
    { name: 'Coral Drift',         lattice: 'a15', r: 1, rule: '8-18/15-19/16',                density: 0.2,  fill: 0.5 },
    { name: 'Ember Veins',         lattice: 'a15', r: 1, rule: '7-17/14-18/16',                density: 0.2,  fill: 0.3 },
    { name: 'Spark Storm',         lattice: 'a15', r: 1, rule: '3-7/4/5',                      density: 0.2,  fill: 0.3 },
    { name: 'Geode Shell',         lattice: 'a15', r: 1, rule: '11-36/8/24',                   density: 0.4,  fill: 0.5 },
    { name: 'Glass Bloom',         lattice: 'a15', r: 1, rule: '6-20/17-22/24',                density: 0.3,  fill: 0.3 },
    { name: 'Frosted Block',       lattice: 'a15', r: 1, rule: '5-16/17-22/16',                density: 0.2,  fill: 1.0 },
    // A15 all-d4 r=2 (339–349)
    { name: 'Quartz Geode',        lattice: 'a15', r: 2, rule: '59-172/43-47/24',              density: 0.5,  fill: 0.5 },
    { name: 'Drifting Isles',      lattice: 'a15', r: 2, rule: '31-92/83-100/8',               density: 0.4,  fill: 0.5 },
    { name: 'Glitter Lump',        lattice: 'a15', r: 2, rule: '30-102/91-106/16',             density: 0.4,  fill: 0.5 },
    { name: 'Ash Shell',           lattice: 'a15', r: 2, rule: '55-160/40-42/10',              density: 0.5,  fill: 0.5 },
    { name: 'Boiling Foam',        lattice: 'a15', r: 2, rule: '34-63/49-63/10',               density: 0.3,  fill: 0.3 },
  ];
  const presetsFor = (lattice, r) => PRESETS.filter(p => p.lattice === lattice && p.r === r);

  // Acceptance thresholds for evaluate(). Sparse enough to see into (non-dead fraction and alive fraction capped),
  // and, for C=2 rules only, calm enough to watch: see `flicker` below. C>2 "fire" rules are exempt from the
  // flicker cap because every alive cell is meant to die into a decay trail the next generation.
  const FLICKER_CAP = 0.5;
  const MAX_FRAC = 0.30;
  const MAX_ALIVE_FRAC = 0.12;

  function evaluate(preset, { N = 32, gens = 300, window = 50, seed = 1 } = {}) {
    const w = new World(N, preset.lattice, preset.r);
    const rule = parseRule(preset.rule, w.maxCount);
    if (rule.error) return { ok: false, reason: rule.error };
    w.setRule(rule);
    w.seed(preset.density, preset.fill * N, mulberry32(seed));
    // flicker: mean over the last `window` gens of (births + deaths) / max(1, alive). A birth is 0->1,
    // a death is 1->(0|2); decay advances (s>=2 -> s+1 | 0) do not count, so C>2 rules are not penalised
    // for their trails. TV static scores >= 1.3, calm structured patterns stay well under 1.
    let lastChange = -1, act = 0, flick = 0, prev = null;
    for (let g = 0; g < gens; g++) {
      if (g >= gens - window) prev = prev ? (prev.set(w.state), prev) : w.state.slice();
      w.step();
      if (w.changed) lastChange = g;
      if (g >= gens - window) {
        act += w.changes / w.nc;
        const cur = w.state; let bd = 0;
        for (let c = 0; c < cur.length; c++) { const a = prev[c], b = cur[c]; if (a === 1 ? b !== 1 : (a === 0 && b === 1)) bd++; }
        flick += bd / Math.max(1, w.alive);
      }
    }
    const stats = { alive: w.alive, frac: w.nonDead / w.nc, aliveFrac: w.alive / w.nc, lastChange,
                    activity: act / window, flicker: flick / window };
    return { ok: accepts(stats, rule.C, { gens, window }), ...stats };
  }

  // The acceptance test on evaluate()'s stats: alive, sparse (non-dead <= MAX_FRAC, alive <= MAX_ALIVE_FRAC), still
  // changing in the last `window` gens, and for C=2 rules calm (flicker <= FLICKER_CAP).
  function accepts({ alive, frac, aliveFrac, lastChange, flicker }, C, { gens = 300, window = 50 } = {}) {
    return alive > 0 && frac <= MAX_FRAC && aliveFrac <= MAX_ALIVE_FRAC && lastChange >= gens - window &&
           (C > 2 || flicker <= FLICKER_CAP);
  }

  return { PERMS, TETRA, CRYSTAL_TET, CRYSTAL_OCTA, CRYSTAL_NBRS, CRYSTAL_REACH, A15_TETS, A15_NBRS, A15_REACH, mulberry32, cellsPerVoxel, maxCount, parseRule, boxAxis, World, PRESETS, presetsFor, evaluate, accepts, FLICKER_CAP, MAX_FRAC, MAX_ALIVE_FRAC };
})();
