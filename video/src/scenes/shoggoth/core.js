// core.js: the shoggoth morphology engine (genome, novelty search, layout, arm paths), ported verbatim from
// assets/3d-shoggoth/index.html (the #shared-code block). Pure JS, no Three.js. Naming, sharing and voice code removed.
export const Shoggoth = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function makeRng(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value + 0x6D2B79F5) >>> 0;
      let t = value;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function hash3(x, y, z, seed) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function noise3(x, y, z, seed = 0) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    let result = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      result += (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w) * hash3(xi + dx, yi + dy, zi + dz, seed);
    }
    return result;
  }

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
  const div = (a, b) => [a[0] / b[0], a[1] / b[1], a[2] / b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const randomUnit = (rng) => { const z = rng() * 2 - 1, a = rng() * TAU, r = Math.sqrt(1 - z * z); return [r * Math.cos(a), z, r * Math.sin(a)]; };
  function basis(front) {
    const z = norm(front);
    const up = Math.abs(z[1]) > .95 ? [1, 0, 0] : [0, 1, 0];
    const x = norm(cross(up, z));
    return { x, y: cross(z, x), z };
  }
  const fromBasis = (b, d) => add(add(scale(b.x, d[0]), scale(b.y, d[1])), scale(b.z, d[2]));

  // ---- genome ---------------------------------------------------------------
  const PLANS = ["blob", "heap", "column", "worm", "ring", "crawler", "cluster", "tree"];
  const E = (key, group, label, values, w, extra = {}) => ({ key, group, label, kind: "enum", values, w, ...extra });
  const I = (key, group, label, min, max, w, extra = {}) => ({ key, group, label, kind: "int", min, max, w, fmt: "count", ...extra });
  const N = (key, group, label, min, max, w, extra = {}) => ({ key, group, label, kind: "num", min, max, w, fmt: "pct", ...extra });
  const GENES = [
    E("plan", "body", "Body plan", PLANS, 3.2),
    I("segments", "body", "Segments", 1, 9, .5),
    N("size", "body", "Mass", .7, 1.5, .5, { fmt: "x" }),
    N("squash", "body", "Squash", -1, 1, .4, { fmt: "signed" }),
    N("taper", "body", "Taper", 0, 1, .25),
    N("lump", "body", "Lumpiness", 0, 1, .35),
    N("asym", "body", "Asymmetry", 0, 1, .35),
    E("dermal", "body", "Dermis", ["smooth", "warts", "spines", "frills"], .9),
    I("heads", "heads", "Heads", 0, 9, 1.8, { count: true, buckets: [[0, 0, 2], [1, 1, 2.5], [2, 3, 3], [4, 6, 2], [7, 9, 1.5]] }),
    E("headShape", "heads", "Head shape", ["orb", "long", "cone", "disc", "lumpy"], 1.1, { gate: "heads" }),
    E("headMount", "heads", "Attachment", ["stalk", "sprout", "fused"], .8, { gate: "heads" }),
    N("neck", "heads", "Neck length", 0, 1, .4, { gate: "heads" }),
    N("headSize", "heads", "Head size", .5, 1.6, .4, { gate: "heads", fmt: "x" }),
    I("eyes", "eyes", "Eyes", 0, 60, 1.8, { count: true, buckets: [[0, 0, .5], [1, 1, 1.2], [2, 3, 1.5], [4, 8, 2], [9, 18, 2], [19, 34, 1.6], [35, 60, 1.2]] }),
    E("eyeStyle", "eyes", "Eye type", ["round", "slit", "compound", "orb", "cyclops"], 1.2, { gate: "eyes" }),
    E("eyeLayout", "eyes", "Arrangement", ["face", "scatter", "rows", "rings", "stalks"], 1, { gate: "eyes" }),
    N("eyeSize", "eyes", "Eye size", .4, 2, .5, { gate: "eyes", fmt: "x" }),
    N("eyeVar", "eyes", "Size chaos", 0, 1, .3, { gate: "eyes" }),
    N("eyeOnHeads", "eyes", "Share on heads", 0, 1, .4, { gate: "eyes" }),
    I("mouths", "mouths", "Mouths", 0, 12, 1.5, { count: true, buckets: [[0, 0, .7], [1, 1, 2], [2, 3, 2], [4, 7, 1.6], [8, 12, 1.2]] }),
    E("mouthStyle", "mouths", "Mouth type", ["lamprey", "lips", "beak", "vertical", "grin", "sphincter"], 1.1, { gate: "mouths" }),
    E("mouthPlace", "mouths", "Placement", ["heads", "body", "belly", "arms"], .8, { gate: "mouths" }),
    N("mouthSize", "mouths", "Mouth size", .4, 1.8, .4, { gate: "mouths", fmt: "x" }),
    I("arms", "arms", "Arms", 0, 24, 1.8, { count: true, buckets: [[0, 0, .6], [1, 3, 1.3], [4, 7, 2], [8, 13, 2], [14, 24, 1.6]] }),
    E("armType", "arms", "Arm type", ["tentacle", "limb", "feeler", "tendrils", "hands"], 1.2, { gate: "arms" }),
    E("armTip", "arms", "Tip", ["none", "claw", "bulb", "hook", "paddle"], .7, { gate: "arms" }),
    N("armLen", "arms", "Reach", 0, 1, .5, { gate: "arms" }),
    N("armThick", "arms", "Girth", .3, 1.6, .4, { gate: "arms", fmt: "x" }),
    I("suckers", "arms", "Suction cups", 0, 12, .3, { gate: "arms" }),
    I("wobble", "arms", "Wriggle", 0, 100, .2, { fmt: "pct100" }),
    N("hue", "surface", "Hue", 0, 1, 1.2, { kind: "hue", fmt: "deg" }),
    N("sat", "surface", "Saturation", .05, .9, .4),
    N("accent", "surface", "Accent shift", 0, 1, .3),
    E("pattern", "surface", "Pattern", ["none", "spots", "stripes", "mottle", "veins"], .8),
    I("hyperrealism", "surface", "Hyperrealism", 0, 100, .3, { fmt: "pct100" }),
    I("cartoonish", "surface", "Cartoonish", 0, 100, .3, { fmt: "pct100", pow: 2.2 }),
    I("slime", "surface", "Slime", 0, 100, .5, { fmt: "pct100" }),
    I("cuteness", "surface", "Cuteness", 0, 100, .4, { fmt: "pct100", pow: 1.6 }),
    I("ugliness", "surface", "Ugliness", 0, 100, .4, { fmt: "pct100" }),
    I("glow", "surface", "Bio-luminescence", 0, 100, .3, { fmt: "pct100" }),
    // Added after the first share links went out; they must stay last (see decodeGenome).
    I("pimples", "pimples", "Pimples", 0, 80, .9, { count: true, buckets: [[0, 0, 2.2], [1, 6, 1.4], [7, 20, 1.4], [21, 45, 1], [46, 80, .6]] }),
    E("pimplePlace", "pimples", "Distribution", ["scattered", "clustered", "face"], .5, { gate: "pimples" }),
    N("pimpleSize", "pimples", "Pimple size", .4, 2, .3, { gate: "pimples", fmt: "x" }),
    N("ripeness", "pimples", "Ripeness", 0, 1, .3, { gate: "pimples" }),
    N("inflammation", "pimples", "Inflammation", 0, 1, .3, { gate: "pimples" }),
    N("throb", "pimples", "Throb", 0, 1, .2, { gate: "pimples" }),
    // Face genes came after the pimple genes; they must stay last (see decodeGenome).
    // high pow: most Random specimens keep an unsettling face, a few come out friendly
    N("smile", "face", "Smile", 0, 1, .4, { gate: "mouths", pow: 3 }),
    N("happyEyes", "face", "Smiling eyes", 0, 1, .3, { gate: "eyes", pow: 3.5 }),
    N("sparkle", "face", "Eye sparkle", 0, 1, .3, { gate: "eyes", pow: 2 }),
    N("brows", "face", "Eyebrows", 0, 1, .3, { gate: "eyes", pow: 3.5 }),
    N("blush", "face", "Blush", 0, 1, .3, { pow: 3.5 }),
    // Hand genes came after the face genes; they must stay last (see decodeGenome). They live in the
    // Arms card and only matter for arm type "hands".
    I("fingers", "arms", "Fingers", 2, 12, .4, { when: (g) => g.arms > 0 && g.armType === "hands", buckets: [[2, 3, 1], [4, 5, 2.5], [6, 8, 1.6], [9, 12, 1]] }),
    I("thumbs", "arms", "Thumbs", 0, 2, .2, { when: (g) => g.arms > 0 && g.armType === "hands" }),
    N("fingerLen", "arms", "Finger length", .4, 2, .2, { when: (g) => g.arms > 0 && g.armType === "hands", fmt: "x" }),
    N("fingerSpread", "arms", "Finger spread", 0, 1, .2, { when: (g) => g.arms > 0 && g.armType === "hands" }),
    // The smiley mask (the "shoggoth with a smiley face" meme) came after the hand genes; keep these last.
    // Tiny weights: Random's novelty search would otherwise favour masked candidates.
    E("mask", "mask", "Smiley mask", ["none", "body", "head", "tentacle"], .05, { weights: [14, 1.2, 1, 1.6] }),
    E("maskFace", "mask", "Expression", ["smile", "grin", "wink"], .02, { when: (g) => g.mask !== "none" }),
    N("maskSize", "mask", "Mask size", .4, 2, .02, { when: (g) => g.mask !== "none", fmt: "x" }),
    N("maskTilt", "mask", "Tilt", -1, 1, .02, { when: (g) => g.mask !== "none", fmt: "signed" }),
    // Trypophobia genes came after the mask; keep these last. Random gives about 4 in 10 specimens
    // some holes; tiny novelty weights keep the novelty search from chasing them further.
    I("holes", "holes", "Hole clusters", 0, 12, .02, { count: true, buckets: [[0, 0, 2], [1, 3, 1], [4, 12, .5]] }),
    N("holeDensity", "holes", "Holes per cluster", 0, 1, .02, { gate: "holes" }),
    N("holeSize", "holes", "Hole size", .3, 2, .02, { gate: "holes", fmt: "x" }),
    N("holeDepth", "holes", "Depth", 0, 1, .02, { gate: "holes" }),
    N("holeRim", "holes", "Swollen rims", 0, 1, .02, { gate: "holes" }),
    N("holeSeeds", "holes", "Seeds", 0, 1, .02, { gate: "holes" }),
    N("holePulse", "holes", "Pulse", 0, 1, .02, { gate: "holes" }),
    // Hair genes came after the trypophobia genes; keep these last. About half of Random specimens
    // get hair; tiny novelty weights keep the novelty search from chasing it.
    I("hair", "hair", "Hairiness", 0, 100, .05, { count: true, fmt: "pct100", buckets: [[0, 0, 1.6], [5, 30, .5], [31, 70, .7], [71, 100, .4]] }),
    E("hairPlace", "hair", "Growth", ["all over", "tufts", "fringe"], .02, { gate: "hair" }),
    N("hairLen", "hair", "Length", .2, 2, .02, { gate: "hair", fmt: "x" }),
    N("hairThick", "hair", "Thickness", .3, 2, .02, { gate: "hair", fmt: "x" }),
    N("hairDroop", "hair", "Droop", 0, 1, .02, { gate: "hair" }),
    N("hairCurl", "hair", "Curl", 0, 1, .02, { gate: "hair" }),
    E("hairTint", "hair", "Tint", ["pale", "golden", "dark", "skin"], .02, { gate: "hair" }),
    N("hairSway", "hair", "Sway", 0, 1, .02, { gate: "hair" })
  ];
  const GENE = Object.fromEntries(GENES.map((gene) => [gene.key, gene]));

  const CLASSIC = {
    plan: "blob", segments: 6, size: 1.1, squash: 0, taper: .3, lump: .45, asym: .25, dermal: "warts",
    heads: 0, headShape: "orb", headMount: "sprout", neck: .4, headSize: 1,
    eyes: 7, eyeStyle: "round", eyeLayout: "face", eyeSize: 1, eyeVar: .2, eyeOnHeads: .5,
    mouths: 1, mouthStyle: "lips", mouthPlace: "body", mouthSize: .9,
    arms: 8, armType: "tentacle", armTip: "none", armLen: .55, armThick: 1, suckers: 7, wobble: 58,
    hue: .44, sat: .2, accent: .2, pattern: "mottle",
    hyperrealism: 72, cartoonish: 18, slime: 38, cuteness: 22, ugliness: 45, glow: 50,
    pimples: 9, pimplePlace: "scattered", pimpleSize: 1, ripeness: .55, inflammation: .5, throb: .25,
    smile: 0, happyEyes: 0, sparkle: 0, brows: 0, blush: 0,
    fingers: 5, thumbs: 1, fingerLen: 1, fingerSpread: .5,
    mask: "none", maskFace: "smile", maskSize: 1, maskTilt: 0,
    holes: 0, holeDensity: .5, holeSize: 1, holeDepth: .6, holeRim: .4, holeSeeds: .3, holePulse: .2,
    hair: 0, hairPlace: "fringe", hairLen: 1, hairThick: 1, hairDroop: .3, hairCurl: .2, hairTint: "pale", hairSway: .4, seed: 48217
  };

  const qOf = (gene, v) => gene.kind === "hue" ? Math.round((((v % 1) + 1) % 1) * 256) % 256 : Math.round(clamp((v - gene.min) / (gene.max - gene.min), 0, 1) * 255);
  const fromQ = (gene, q) => gene.kind === "hue" ? q / 256 : gene.min + q * (gene.max - gene.min) / 255;

  function normalizeGenome(input) {
    const src = input || {};
    const g = {};
    for (const gene of GENES) {
      const v = src[gene.key] ?? CLASSIC[gene.key];
      if (gene.kind === "enum") g[gene.key] = gene.values.includes(v) ? v : gene.values[0];
      else if (gene.kind === "int") g[gene.key] = clamp(Math.round(Number(v) || 0), gene.min, gene.max);
      else g[gene.key] = fromQ(gene, qOf(gene, Number(v) || 0));
    }
    g.seed = (Number(src.seed) >>> 0) || 1;
    // coherence constraints
    if (g.plan === "crawler" && g.arms < 4) g.arms = 4;
    if (g.plan === "tree") { g.heads = Math.max(2, g.heads); g.headMount = "stalk"; }
    if (g.mouthPlace === "heads" && g.heads === 0) g.mouthPlace = "body";
    if (g.mouthPlace === "arms" && g.arms === 0) g.mouthPlace = "body";
    if (g.mask === "head" && g.heads === 0) g.mask = "body";
    if (g.eyeStyle === "cyclops") g.eyes = Math.min(g.eyes, 6);
    if (g.eyeStyle === "compound") g.eyes = Math.min(g.eyes, 30);
    g.thumbs = Math.min(g.thumbs, g.fingers - 1);
    return g;
  }

  function sampleGene(gene, rng) {
    if (gene.kind === "enum" && gene.weights) {
      let r = rng() * gene.weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < gene.values.length; i++) if ((r -= gene.weights[i]) <= 0) return gene.values[i];
      return gene.values[gene.values.length - 1];
    }
    if (gene.kind === "enum") return gene.values[Math.floor(rng() * gene.values.length)];
    if (gene.kind === "hue") return rng();
    if (gene.kind === "int" && gene.buckets) {
      const total = gene.buckets.reduce((s, b) => s + b[2], 0);
      let r = rng() * total;
      for (const [lo, hi, w] of gene.buckets) { if ((r -= w) <= 0) return lo + Math.floor(rng() * (hi - lo + 1)); }
      return gene.max;
    }
    const t = gene.pow ? Math.pow(rng(), gene.pow) : rng();
    return gene.kind === "int" ? Math.round(gene.min + t * (gene.max - gene.min)) : gene.min + t * (gene.max - gene.min);
  }

  function randomGenome(rng = Math.random) {
    const g = {};
    for (const gene of GENES) g[gene.key] = sampleGene(gene, rng);
    g.seed = Math.floor(rng() * 4294967295) + 1;
    return normalizeGenome(g);
  }

  const countBucket = (v) => v <= 0 ? 0 : Math.floor(Math.log2(v)) + 1;
  const hueDist = (a, b) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };

  function geneDiff(gene, a, b) {
    if (gene.gate && (!a[gene.gate] || !b[gene.gate])) return 0;
    if (gene.when && (!gene.when(a) || !gene.when(b))) return 0;
    const x = a[gene.key], y = b[gene.key];
    if (gene.kind === "enum") return x === y ? 0 : 1;
    if (gene.kind === "hue") return hueDist(x, y) * 2;
    if (gene.count) {
      if ((x === 0) !== (y === 0)) return 1;
      return Math.min(1, 2 * Math.abs(Math.log2(x + 1) - Math.log2(y + 1)) / Math.log2(gene.max + 1));
    }
    return Math.abs(x - y) / (gene.max - gene.min);
  }

  function genomeDistance(a, b) {
    let d = 0;
    for (const gene of GENES) d += gene.w * geneDiff(gene, a, b);
    return d;
  }

  // Coarse "would a person call these different creatures" count.
  function majorDifferences(a, b) {
    let n = 0;
    if (a.plan !== b.plan) n++;
    for (const k of ["heads", "eyes", "mouths", "arms", "pimples"]) if (countBucket(a[k]) !== countBucket(b[k])) n++;
    if (a.heads && b.heads && a.headShape !== b.headShape) n++;
    if (a.eyes && b.eyes && a.eyeStyle !== b.eyeStyle) n++;
    if (a.eyes && b.eyes && a.eyeLayout !== b.eyeLayout) n++;
    if (a.mouths && b.mouths && a.mouthStyle !== b.mouthStyle) n++;
    if (a.arms && b.arms && a.armType !== b.armType) n++;
    if (hueDist(a.hue, b.hue) > .1) n++;
    if (a.pattern !== b.pattern) n++;
    if (a.dermal !== b.dermal) n++;
    return n;
  }

  function nearest(g, history) {
    let distance = Infinity, majors = Infinity;
    for (const h of history) {
      distance = Math.min(distance, genomeDistance(g, h));
      majors = Math.min(majors, majorDifferences(g, h));
    }
    return { distance, majors };
  }

  // Farthest-point sampling: of `samples` random candidates, keep the one whose
  // closest remembered creature is farthest away. Near-duplicates in coarse
  // traits are penalised so a far-but-familiar candidate cannot win.
  function pickNovel(history, rng = Math.random, samples = 64) {
    let best = null;
    for (let i = 0; i < samples; i++) {
      const c = randomGenome(rng);
      let score = Infinity;
      for (const h of history) {
        const m = majorDifferences(c, h);
        const d = genomeDistance(c, h) * (m < 3 ? .2 : m < 5 ? .7 : 1);
        if (d < score) { score = d; if (best && score <= best.score) break; }
      }
      if (!best || score > best.score) best = { genome: c, score };
    }
    return best.genome;
  }

  function mutateGenome(g, rng = Math.random) {
    const out = { ...g };
    const k = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < k; i++) {
      const gene = GENES[Math.floor(rng() * GENES.length)];
      if (gene.key === "plan" && rng() < .7) continue;
      const v = out[gene.key];
      if (gene.kind === "enum") out[gene.key] = gene.values[(gene.values.indexOf(v) + 1 + Math.floor(rng() * (gene.values.length - 1))) % gene.values.length];
      else if (gene.kind === "hue") out[gene.key] = v + (rng() - .5) * .12;
      else if (gene.count) out[gene.key] = Math.round(v * (.65 + rng() * .8) + (rng() < .5 ? -1 : 1));
      else if (gene.kind === "int") out[gene.key] = v + Math.round((rng() - .5) * (gene.max - gene.min) * .3);
      else out[gene.key] = v + (rng() - .5) * (gene.max - gene.min) * .35;
    }
    if (rng() < .35) out.seed = Math.floor(rng() * 4294967295) + 1;
    return normalizeGenome(out);
  }

  // ---- colour -----------------------------------------------------------
  // Colours as [h, s, l] in 0..1 so the renderer can feed them to setHSL.
  function paletteOf(g) {
    const h = g.hue, s = g.sat, cute = g.cuteness / 100, ugly = g.ugliness / 100;
    const accent = (h + .25 + g.accent * .5) % 1;
    return {
      skin: [h, s, clamp(.34 + cute * .12 - ugly * .08, .16, .6)],
      shadow: [h + .02, s * .8, .1],
      highlight: [h + .04, s * .6 + .1, .66],
      accent: [accent, .65, .58],
      sucker: [h + .08, s * .35, .78],
      eye: [h + .1, .22, .9],
      iris: [accent, .72, .55],
      pupil: [h, .3, .06],
      mouth: [.97, .5, .07],
      lip: [h + .96, s * .7 + .1, .45],
      tongue: [.93, .55, .55],
      teeth: [.12, .3, .84],
      claw: [h + .05, .15, .2],
      slime: [h + .1, .55, .6],
      fog: [h, .35 * s + .12, .045],
      floor: [h, .18, .085],
      ring: [accent, .6, .6]
    };
  }

  // ---- layout: genome -> placed parts (creature space, y up, floor y = 0) --
  const HEAD_SHAPES = { orb: [1, 1, 1], long: [.75, .75, 1.55], cone: [.9, .9, 1.3], disc: [1.35, .5, 1.05], lumpy: [1.05, .95, 1] };
  const ARM_N = 20;

  function eyeDirs(count, layout, rng, front) {
    const b = basis(front);
    const out = [];
    const sph = (rad, ang, sx = 1, sy = 1) => [Math.sin(rad) * Math.cos(ang) * sx, Math.sin(rad) * Math.sin(ang) * sy, Math.cos(rad)];
    if (layout === "face") {
      const tmax = Math.min(1.25, .32 + .14 * Math.sqrt(count));
      for (let i = 0; i < count; i++) out.push(sph(count === 1 ? 0 : Math.sqrt((i + .5) / count) * tmax, i * 2.39996 + rng() * .2, 1.15, .8));
    } else if (layout === "rows") {
      const rows = Math.max(1, Math.round(Math.sqrt(count / 2.4)));
      let placed = 0;
      for (let r = 0; r < rows; r++) {
        const inRow = Math.round((count - placed) / (rows - r));
        const pitch = rows === 1 ? .15 : lerp(.55, -.35, r / (rows - 1));
        const spread = Math.min(1.3, .22 * inRow);
        for (let k = 0; k < inRow; k++) {
          const yaw = inRow === 1 ? 0 : lerp(-spread, spread, k / (inRow - 1));
          out.push([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]);
        }
        placed += inRow;
      }
    } else if (layout === "rings") {
      if (count > 0) out.push([0, 0, 1]);
      const step = Math.min(.42, 1.3 / Math.sqrt(count));
      for (let ring = 1; out.length < count; ring++) {
        const m = 6 * ring;
        for (let k = 0; k < m && out.length < count; k++) out.push(sph(ring * step, k / m * TAU + ring * .4));
      }
    } else {
      const tmax = layout === "stalks" ? 1.2 : 1.9;
      for (let i = 0; i < count; i++) {
        let d = sph(Math.acos(1 - rng() * (1 - Math.cos(tmax))), rng() * TAU);
        if (layout === "stalks") d = norm(add(d, [0, .5, 0]));
        out.push(d);
      }
    }
    return out.map((d) => norm(fromBasis(b, d)));
  }

  function buildLayout(input) {
    const g = normalizeGenome(input);
    const rng = makeRng(g.seed ^ 0x5eed1e);
    const s = g.size;
    const R = 1.2 * s;
    const yMul = 1 - g.squash * .35, xzMul = 1 + g.squash * .22;
    const jit = () => 1 + (rng() * 2 - 1) * g.asym * .3;
    const lobes = [];
    const strands = [];
    const addLobe = (c, r) => { lobes.push({ c, r, seed: Math.floor(rng() * 1e9) }); return lobes.length - 1; };
    const ell = (rr, ry = rr) => [rr * xzMul * jit(), ry * yMul * jit(), rr * xzMul * jit()];
    let main = 0;
    let along = [0, 0, 1];
    const seg = g.segments;

    if (g.plan === "blob") {
      const r = [R * 1.05 * xzMul * jit(), R * 1.1 * yMul * jit(), R * .95 * xzMul * jit()];
      addLobe([0, r[1] * .82 + .2, 0], r);
      for (let i = 1; i < seg; i++) {
        const u = randomUnit(rng);
        const d = norm([u[0], Math.abs(u[1]) * .8 - .15, u[2]]);
        const rr = R * (.26 + rng() * .24) * (1 - g.taper * .45);
        const c = add(lobes[0].c, mul(d, scale(lobes[0].r, .78)));
        c[1] = Math.max(c[1], rr * .8);
        addLobe(c, ell(rr));
      }
    } else if (g.plan === "heap") {
      const n = seg + 2, r0 = R * .82;
      addLobe([0, r0 * yMul * .85, 0], ell(r0));
      for (let i = 1; i < n; i++) {
        const rr = R * (.36 + rng() * .3) * (1 - g.taper * i / (n - 1) * .55);
        const a = rng() * TAU, dist = r0 * (.55 + rng() * .6);
        const stack = rng() < .3 ? rr * .9 : 0;
        addLobe([Math.cos(a) * dist, rr * yMul * .8 + stack, Math.sin(a) * dist], ell(rr));
      }
    } else if (g.plan === "column") {
      const n = Math.max(2, seg);
      const base = R * .85 / (1 + (n - 2) * .07);
      let y = 0, prevRy = 0;
      for (let i = 0; i < n; i++) {
        const rr = base * (1 - g.taper * .6 * i / (n - 1));
        const r = ell(rr, rr * .78);
        y = i === 0 ? r[1] + .02 : y + prevRy * .8 + r[1] * .8;
        prevRy = r[1];
        addLobe([Math.sin(i * 1.3 + g.seed % 7) * g.asym * R * .35, y, Math.cos(i * 1.7) * g.asym * R * .15], r);
      }
      main = n - 1;
    } else if (g.plan === "worm") {
      const n = Math.min(11, seg + 2);
      const ph = rng() * TAU;
      let x = 0, z = 0;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const rr = R * .6 * (1 - g.taper * .55 * i / (n - 1)) * (i === 0 ? 1.1 : 1);
        pts.push([x, z, rr]);
        const heading = Math.sin(i * .9 + ph) * (.35 + g.asym * .5);
        x -= Math.cos(heading) * rr * 1.25;
        z += Math.sin(heading) * rr * 1.25;
      }
      const mx = pts.reduce((a, p) => a + p[0], 0) / n, mz = pts.reduce((a, p) => a + p[1], 0) / n;
      pts.forEach(([px, pz, rr], i) => {
        const rear = Math.max(0, 2 - i) / 2;
        const r = ell(rr);
        addLobe([px - mx, r[1] * .85 + rear * R * .55, pz - mz], r);
      });
      along = [1, 0, 0];
    } else if (g.plan === "ring") {
      const n = Math.min(13, seg + 4);
      const ringR = R * (.75 + n * .09);
      const tilt = (rng() - .5) * g.asym * .6;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU;
        const rr = R * .5 * (1 - g.taper * .4 * (.5 + .5 * Math.cos(a)));
        const r = ell(rr);
        addLobe([Math.cos(a) * ringR, r[1] * .9 + .1 + Math.max(0, Math.sin(a) * tilt * ringR), Math.sin(a) * ringR * .9], r);
      }
      main = Math.round(n / 4) % n;
      along = [1, 0, 0];
    } else if (g.plan === "crawler") {
      const legH = (1.1 + g.armLen * 1.6) * s;
      const r0 = R * .8;
      addLobe([0, legH, 0], ell(r0, r0 * .8));
      let z = 0;
      for (let i = 1; i < Math.min(seg, 5); i++) {
        const rr = r0 * (.78 - i * .1) * (1 - g.taper * .3);
        z -= (lobes[i - 1].r[2] + rr) * .75;
        addLobe([(rng() - .5) * g.asym * .6, legH + i * .12 * s, z], ell(rr));
      }
    } else if (g.plan === "cluster") {
      const n = seg + 2, cy = R * 1.7 + .5;
      for (let i = 0; i < n; i++) {
        const rr = R * (.3 + rng() * .32) * (i === 0 ? 1.3 : 1);
        let best = [0, cy, 0], bestGap = -Infinity;
        for (let t = 0; t < (i === 0 ? 1 : 20); t++) {
          const p = i === 0 ? [0, cy, 0] : [(rng() * 2 - 1) * R * 1.7, cy + (rng() * 2 - 1) * R * 1.1, (rng() * 2 - 1) * R * 1.2];
          let gap = Infinity;
          for (const l of lobes) gap = Math.min(gap, length(sub(p, l.c)) - (rr + l.r[0]) * 1.05);
          if (gap >= 0) { best = p; break; }
          if (gap > bestGap) { bestGap = gap; best = p; }
        }
        best[1] = Math.max(best[1], rr + .35);
        addLobe(best, ell(rr));
        if (i > 0) {
          let j = 0;
          for (let k = 1; k < i; k++) if (length(sub(lobes[k].c, best)) < length(sub(lobes[j].c, best))) j = k;
          strands.push([i, j]);
        }
      }
    } else if (g.plan === "tree") {
      const baseR = [R * xzMul, R * .45 * yMul, R * xzMul];
      addLobe([0, baseR[1] * .9, 0], baseR);
      const trunkN = clamp(Math.round(seg / 2) + 1, 1, 5);
      let y = baseR[1] * 1.5;
      for (let i = 0; i < trunkN; i++) {
        const rr = R * .42 * (1 - g.taper * .35 * i / trunkN);
        y += rr * 1.1;
        addLobe([Math.sin(i * 1.7) * g.asym * .3, y, 0], [rr, rr * 1.25, rr]);
        y += rr * 1.1;
      }
      main = lobes.length - 1;
    }

    const area = (l) => (l.r[0] * l.r[1] + l.r[1] * l.r[2] + l.r[0] * l.r[2]) / 3;
    const pickLobe = (weight = area) => {
      const ws = lobes.map(weight);
      let r = rng() * ws.reduce((a, b) => a + b, 0);
      for (let i = 0; i < ws.length; i++) if ((r -= ws[i]) <= 0) return i;
      return lobes.length - 1;
    };
    const inside = (p, skip) => lobes.some((l, j) => j !== skip && ((p[0] - l.c[0]) / l.r[0]) ** 2 + ((p[1] - l.c[1]) / l.r[1]) ** 2 + ((p[2] - l.c[2]) / l.r[2]) ** 2 < .9);
    const onLobe = (li, d) => { const l = lobes[li]; const local = mul(d, l.r); return { local, p: add(l.c, local), n: norm(div(d, l.r)) }; };
    const totalArea = lobes.reduce((a, l) => a + area(l), 0);
    const cen = lobes.reduce((acc, l) => add(acc, scale(l.c, area(l) / totalArea)), [0, 0, 0]);
    const lobeFront = (li) => { const c = lobes[li].c; return norm([(c[0] - cen[0]) * .35, .2, 1]); };
    const lobeR = (li) => Math.min(...lobes[li].r);

    // heads
    const heads = [];
    const H = g.heads;
    const hrBase = g.headSize * .44 * s / (1 + Math.max(0, H - 1) * .09);
    for (let i = 0; i < H; i++) {
      let best = null, bestScore = -Infinity;
      for (let t = 0; t < 14; t++) {
        let li, d;
        if (g.plan === "tree") { li = main; d = norm(add(randomUnit(rng), [0, 1.6, 0])); }
        else if (g.plan === "worm" && i === 0) { li = 0; d = norm([1, .35, .15]); }
        else { li = pickLobe((l) => area(l) * (1 + Math.max(0, l.c[1]) * .3)); d = norm(add(randomUnit(rng), [0, 1.1, .55])); }
        const hit = onLobe(li, d);
        if (inside(hit.p, li) && t < 13) continue;
        let score = hit.p[1] * .05 + hit.n[2] * .2;
        let minD = 10;
        for (const h of heads) minD = Math.min(minD, length(sub(h.anchorW, hit.p)));
        score += minD;
        if (score > bestScore) { bestScore = score; best = { li, ...hit }; }
        if (g.plan === "worm" && i === 0) break;
      }
      if (!best) best = { li: main, ...onLobe(main, [0, 1, 0]) };
      const mount = g.headMount;
      const nb = mount === "fused" ? best.n : norm(add(best.n, [0, mount === "stalk" ? .9 : .35, 0]));
      const L = mount === "stalk" ? (.9 + g.neck * 2.3) * s * (g.plan === "tree" ? 1.15 : 1) * jit() : mount === "sprout" ? (.3 + g.neck * .55) * s : 0;
      const hr = hrBase * (1 + (rng() * 2 - 1) * g.asym * .25);
      const center = add(best.p, scale(nb, L + (mount === "fused" ? hr * .45 : hr * .75)));
      const facing = g.plan === "worm" && i === 0 ? norm([1, .1, .5]) : norm(add(add(scale(nb, .7), [0, 0, 1]), scale(randomUnit(rng), .25 + g.asym * .3)));
      heads.push({ lobe: best.li, anchor: best.local, anchorW: best.p, nb, len: L, r: hr, shape: g.headShape, scale: HEAD_SHAPES[g.headShape], mount, center, facing, neckR: hr * (mount === "stalk" ? .3 : .5), phase: rng() * TAU, speed: .6 + rng() * .6, seed: Math.floor(rng() * 1e9) });
    }

    // how many mouths each host gets (needed before eyes so eyes can move up)
    const M = g.mouths, A = g.arms;
    const headMouths = heads.map(() => 0);
    let armMouths = 0, bodyMouths = 0;
    if (g.mouthPlace === "heads") for (let i = 0; i < M; i++) headMouths[i % H]++;
    else if (g.mouthPlace === "arms") { armMouths = Math.min(M, A); bodyMouths = M - armMouths; }
    else bodyMouths = M;

    // eyes
    const eyes = [];
    const cyclops = g.eyeStyle === "cyclops";
    const placeEyes = (count, host, hostR, surf, front, blocked) => {
      if (!count) return;
      const dirs = eyeDirs(count, g.eyeLayout, rng, front);
      const base = g.eyeSize * hostR * .95 / Math.sqrt(count + 1.5);
      for (let d of dirs) {
        let hit = surf(d);
        for (let t = 0; t < 24 && blocked && blocked(hit); t++) { d = norm(add(scale(front, t < 8 ? 1 : .3), scale(randomUnit(rng), 1.3))); hit = surf(d); }
        let r = base * (1 + g.eyeVar * (rng() * 2 - 1) * .75) * (cyclops ? 1.7 : g.eyeStyle === "compound" ? 1.2 : 1);
        r = clamp(r, hostR * .05, hostR * (cyclops ? .75 : .55));
        const stalk = g.eyeLayout === "stalks" ? hostR * (.35 + rng() * .75) : 0;
        eyes.push({ host, pos: hit.local, normal: hit.n, r, stalk, style: g.eyeStyle, phase: rng() * TAU, rate: .12 + rng() * .25 });
      }
    };
    const E = g.eyes;
    const eH = H > 0 ? Math.round(E * g.eyeOnHeads) : 0;
    heads.forEach((h, i) => {
      const n = Math.floor(eH / H) + (i < eH % H ? 1 : 0);
      const hostR = h.r * Math.min(h.scale[0], h.scale[1]);
      placeEyes(n, { kind: "head", index: i }, hostR, (d) => ({ local: scale(mul(d, h.scale), h.r), n: norm(div(d, h.scale)) }), headMouths[i] ? [0, .35, 1] : [0, .1, 1], null);
    });
    const bodyEyeCounts = lobes.map(() => 0);
    for (let i = 0; i < E - eH; i++) bodyEyeCounts[g.eyeLayout === "face" ? main : pickLobe()]++;
    bodyEyeCounts.forEach((n, li) => {
      placeEyes(n, { kind: "lobe", index: li }, lobeR(li), (d) => onLobe(li, d), bodyMouths && li === main ? norm(add(lobeFront(li), [0, .3, 0])) : lobeFront(li), (hit) => inside(hit.p, li) || hit.p[1] < .15);
    });

    // mouths
    const mouths = [];
    const mouthR = (hostR, n) => clamp(g.mouthSize * hostR * .55 / Math.sqrt(n + .4), hostR * .12, hostR * .7);
    heads.forEach((h, i) => {
      const m = headMouths[i];
      const hostR = h.r * Math.min(h.scale[0], h.scale[1]);
      for (let k = 0; k < m; k++) {
        const yaw = (k - (m - 1) / 2) * .6, pitch = -.5 - (m > 3 ? (k % 2) * .35 : 0);
        const d = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
        mouths.push({ host: { kind: "head", index: i }, pos: scale(mul(d, h.scale), h.r), normal: norm(div(d, h.scale)), r: mouthR(hostR, m), style: g.mouthStyle, phase: rng() * TAU, rate: .5 + rng() * .9 });
      }
    });
    const chainHosts = ["column", "worm", "ring"].includes(g.plan);
    for (let k = 0; k < bodyMouths; k++) {
      let li, d;
      if (g.mouthPlace === "belly") {
        li = chainHosts ? (g.plan === "column" ? lobes.length - 1 - (k % lobes.length) : k % lobes.length) : main;
        const perHost = chainHosts ? Math.ceil(bodyMouths / lobes.length) : bodyMouths;
        const slot = chainHosts ? Math.floor(k / lobes.length) : k;
        const pitch = perHost === 1 ? -.25 : lerp(.35, -.6, slot / (perHost - 1));
        d = norm(fromBasis(basis(lobeFront(li)), [0, Math.sin(pitch), Math.cos(pitch)]));
      } else {
        li = pickLobe();
        d = norm(add(scale(randomUnit(rng), .65), add(lobeFront(li), [0, -.35, 0])));
      }
      let hit = onLobe(li, d);
      for (let t = 0; t < 6 && (inside(hit.p, li) || hit.p[1] < .2); t++) hit = onLobe(li, norm(add(lobeFront(li), scale(randomUnit(rng), 1.1))));
      const count = g.mouthPlace === "belly" ? Math.ceil(bodyMouths / (chainHosts ? lobes.length : 1)) : Math.max(1, bodyMouths / lobes.length);
      mouths.push({ host: { kind: "lobe", index: li }, pos: hit.local, normal: hit.n, r: mouthR(lobeR(li), count), style: g.mouthStyle, phase: rng() * TAU, rate: .5 + rng() * .9 });
    }

    // arms
    const arms = [];
    const band = { tentacle: [-.75, -.15], tendrils: [-.7, -.1], limb: [-.25, .3], hands: [-.2, .35], feeler: [.2, .75] }[g.armType];
    const baseLen = (.9 + g.armLen * 3.2) * s * (g.plan === "worm" ? .6 : 1) * (g.armType === "feeler" ? 1.1 : 1);
    const baseR = (.06 + .09 * g.armThick) * s * ({ feeler: .45, tendrils: .4, limb: 1.1, hands: 1, tentacle: 1 }[g.armType]) * (A > 12 ? .85 : 1);
    const nLegs = g.plan === "crawler" ? Math.min(A, 8) : 0;
    for (let i = 0; i < A; i++) {
      const leg = i < nLegs;
      let li = main, dir, hit;
      for (let t = 0; t < 6; t++) {
        const y = lerp(band[0], band[1], rng());
        const a = (leg ? (i + .5) / nLegs : i / A) * TAU + (rng() - .5) * (.3 + g.asym * .5) + t * .7;
        const ring = [Math.cos(a) * Math.sqrt(1 - y * y), y, Math.sin(a) * Math.sqrt(1 - y * y)];
        if (leg) { li = 0; dir = norm([Math.cos(a), -.3, Math.sin(a)]); }
        else if (g.plan === "heap" || g.plan === "cluster") {
          li = 0;
          let bestV = -Infinity;
          lobes.forEach((l, j) => { const v = g.plan === "cluster" ? -l.c[1] + rng() : l.c[0] * Math.cos(a) + l.c[2] * Math.sin(a) + l.r[0]; if (v > bestV) { bestV = v; li = j; } });
          dir = ring;
        } else if (g.plan === "column") { li = i % lobes.length; dir = norm([Math.cos(i * 2.39996 + t), y, Math.sin(i * 2.39996 + t)]); }
        else if (g.plan === "worm") { li = lobes.length > 1 ? 1 + Math.floor(i / 2) % (lobes.length - 1) : 0; dir = norm([(rng() - .5) * .4, y - .2, i % 2 ? 1 : -1]); }
        else if (g.plan === "ring") { li = i % lobes.length; const c = lobes[li].c; dir = norm(add(norm([c[0], 0, c[2]]), [0, y * 1.5, 0])); }
        else if (g.plan === "tree") { li = i % 3 === 2 && lobes.length > 1 ? 1 + i % (lobes.length - 1) : 0; dir = ring; }
        else dir = ring;
        hit = onLobe(li, dir);
        if (!inside(hit.p, li) && hit.p[1] > .08) break;
      }
      if (hit.p[1] < .08) { hit.local[1] += .08 - hit.p[1]; hit.p[1] = .08; }
      const armDir = norm(add(hit.n, scale(dir, .5)));
      const arm = {
        lobe: li, root: hit.local, rootW: hit.p, dir: armDir, len: baseLen * (.8 + rng() * .35), r0: baseR * (.85 + rng() * .3) * (leg ? 1.25 : 1),
        type: leg ? "leg" : g.armType, tip: g.armTip, leg, hand: { fingers: g.fingers, thumbs: g.thumbs, len: g.fingerLen, spread: g.fingerSpread }, phase: rng() * TAU, speed: .6 + rng() * .8,
        suckers: g.armType === "tentacle" && !leg ? g.suckers : 0, twist: (rng() - .5) * 1.2, curl: rng() * .6,
        mouthTip: false, gait: (i % 2) * Math.PI,
        strands: g.armType === "tendrils" && !leg ? [0, 1, 2].map((k) => ({ yaw: (k - 1) * .32, phase: k * 1.9, scale: 1 - k * .12 })) : [{ yaw: 0, phase: 0, scale: 1 }]
      };
      if (leg) {
        const a = Math.atan2(armDir[2], armDir[0]);
        const reach = (1.3 + g.armLen * 1.4) * s;
        arm.foot = [hit.p[0] + Math.cos(a) * reach, .05, hit.p[2] + Math.sin(a) * reach];
        arm.stride = [-Math.sin(a) * .3 * s, 0, Math.cos(a) * .3 * s];
        arm.len = Math.max(arm.len, length(sub(hit.p, arm.foot)) * 1.2);
      }
      arms.push(arm);
    }
    for (let i = 0, k = 0; k < armMouths && i < A; i++) {
      const pick = Math.floor((i * A) / Math.max(1, armMouths));
      if (pick < A && !arms[pick].mouthTip) { arms[pick].mouthTip = true; mouths.push({ host: { kind: "arm", index: pick }, pos: [0, 0, 0], normal: [0, 0, 1], r: arms[pick].r0 * 2.2 * g.mouthSize, style: g.mouthStyle, phase: rng() * TAU, rate: .6 + rng() }); k++; }
    }

    // dermal ornaments
    const dermal = [];
    if (g.dermal === "warts" || g.dermal === "spines") {
      const count = g.dermal === "warts" ? 14 + Math.round(g.ugliness * .25 + g.lump * 14) : 12 + Math.round(g.ugliness * .15 + g.lump * 10);
      for (let i = 0; i < count; i++) {
        const li = pickLobe();
        const u = randomUnit(rng);
        const hit = onLobe(li, norm([u[0], Math.max(-.4, u[1]), u[2]]));
        if (inside(hit.p, li)) continue;
        const size = lobeR(li) * (g.dermal === "warts" ? .05 + rng() * .08 : .1 + rng() * .14);
        dermal.push({ lobe: li, pos: hit.local, normal: hit.n, size, kind: g.dermal });
      }
    } else if (g.dermal === "frills") {
      lobes.forEach((l, li) => {
        const k = 5 + Math.floor(rng() * 4);
        for (let j = 0; j < k; j++) {
          const phi = lerp(-1.1, 1.1, j / (k - 1));
          const hit = onLobe(li, norm(add(scale([0, 1, 0], Math.cos(phi)), scale(along, Math.sin(phi)))));
          if (inside(hit.p, li)) continue;
          dermal.push({ lobe: li, pos: hit.local, normal: hit.n, size: lobeR(li) * (.28 + .12 * Math.cos(phi)), kind: "frills", along });
        }
      });
    }

    // blush cheeks: either side of the first body/head mouth, else below the eyes; no rng used
    const cheeks = [];
    if (g.blush > .04) {
      const surfaceOn = (host, d) => {
        if (host.kind === "lobe") return onLobe(host.index, d);
        const h = heads[host.index];
        return { local: scale(mul(d, h.scale), h.r), n: norm(div(d, h.scale)) };
      };
      const dirOf = (host, local) => host.kind === "lobe" ? norm(div(local, lobes[host.index].r)) : norm(div(local, scale(heads[host.index].scale, heads[host.index].r)));
      const hostR = (host) => host.kind === "lobe" ? lobeR(host.index) : heads[host.index].r;
      let host = null, dir = null;
      const faceMouth = mouths.find((m) => m.host.kind !== "arm");
      const faceEyes = eyes.filter((e) => e.host.kind !== "arm");
      if (faceMouth) { host = faceMouth.host; dir = dirOf(host, faceMouth.pos); }
      else if (faceEyes.length) {
        host = faceEyes[0].host;
        const same = faceEyes.filter((e) => e.host.kind === host.kind && e.host.index === host.index);
        dir = norm(add(norm(same.reduce((acc, e) => add(acc, dirOf(host, e.pos)), [0, 0, 0])), [0, -.45, 0]));
      }
      if (host) {
        let side = cross([0, 1, 0], dir);
        side = length(side) < .2 ? [1, 0, 0] : norm(side);
        for (const k of [-1, 1]) {
          const hit = surfaceOn(host, norm(add(add(dir, scale(side, k * .55)), [0, .08, 0])));
          cheeks.push({ host, pos: hit.local, normal: hit.n, r: hostR(host) * .26 });
        }
      }
    }

    // smiley mask: worn on the body front, on the first head, or held out on its own pseudopod
    let mask = null;
    if (g.mask !== "none") {
      if (g.mask === "head" && heads.length) {
        const h = heads[0], d = norm([0, .12, 1]);
        mask = { kind: "head", host: { kind: "head", index: 0 }, pos: scale(mul(d, h.scale), h.r), normal: norm(div(d, h.scale)), r: h.r * .8 * g.maskSize };
      } else if (g.mask === "tentacle") {
        const hit = onLobe(main, norm(add(lobeFront(main), [0, .55, 0])));
        const len = lobeR(main) * 1.15;
        mask = { kind: "tentacle", host: { kind: "lobe", index: main }, pos: hit.local, normal: hit.n, len, r: lobeR(main) * .3 * g.maskSize };
      } else {
        const hit = onLobe(main, norm(add(lobeFront(main), [0, .22, 0])));
        mask = { kind: "body", host: { kind: "lobe", index: main }, pos: hit.local, normal: hit.n, r: lobeR(main) * .36 * g.maskSize };
      }
      // a worn mask sits in front of whatever eyes and mouths it covers on its host
      mask.lift = 0;
      if (mask.kind !== "tentacle") {
        const same = (h) => h.kind === mask.host.kind && h.index === mask.host.index;
        const bumps = [...eyes.filter((e) => same(e.host)).map((e) => ({ p: e.pos, r: e.r * 1.2 + e.stalk })), ...mouths.filter((m) => same(m.host)).map((m) => ({ p: m.pos, r: m.r * .5 }))];
        for (const b of bumps) {
          const d = sub(b.p, mask.pos), along = dot(d, mask.normal), lateral = length(sub(d, scale(mask.normal, along)));
          if (lateral < mask.r + b.r) mask.lift = Math.max(mask.lift, along + b.r);
        }
      }
    }

    // pimples: own rng stream, so adding them never moves any other feature
    const pimples = [];
    if (g.pimples) {
      const prng = makeRng((g.seed ^ 0x5bd1e995) >>> 0);
      const lobeOf = (host) => host.kind === "lobe" ? host.index : -1;
      const keepOut = [...eyes.map((e) => ({ li: lobeOf(e.host), p: e.pos, r: e.r + e.stalk })), ...mouths.map((m) => ({ li: lobeOf(m.host), p: m.pos, r: m.r * 1.2 }))].filter((k) => k.li >= 0);
      const clusters = Array.from({ length: Math.max(1, Math.ceil(g.pimples / 7)) }, () => {
        let c;
        for (let k = 0; k < 24; k++) {
          c = { li: pickLobe(), d: randomUnit(prng) };
          c.d = norm([c.d[0], Math.abs(c.d[1]) * .8, c.d[2]]);
          const hit = onLobe(c.li, c.d);
          if (!inside(hit.p, c.li) && hit.p[1] > .15) break;
        }
        return c;
      });
      for (let i = 0, tries = 0; i < g.pimples && tries < g.pimples * 6; tries++) {
        let li, d;
        if (g.pimplePlace === "clustered") {
          const c = clusters[tries % clusters.length];
          li = c.li; d = norm(add(c.d, scale(randomUnit(prng), .28)));
        } else if (g.pimplePlace === "face") {
          li = main; d = norm(add(lobeFront(main), scale(randomUnit(prng), .75)));
        } else {
          li = pickLobe(); d = randomUnit(prng);
        }
        d = norm([d[0], Math.max(-.35, d[1]), d[2]]);
        const hit = onLobe(li, d);
        if (inside(hit.p, li) || hit.p[1] < .08) continue;
        const size = lobeR(li) * .055 * g.pimpleSize * (.6 + prng() * .8);
        if (keepOut.some((k) => k.li === li && Math.hypot(k.p[0] - hit.local[0], k.p[1] - hit.local[1], k.p[2] - hit.local[2]) < k.r + size * 1.6)) continue;
        const ripe = clamp(g.ripeness + (prng() - .5) * .5, 0, 1);
        pimples.push({ lobe: li, pos: hit.local, normal: hit.n, size, ripe, phase: prng() * TAU });
        i++;
      }
    }

    // trypophobic hole clusters: packed patches of pits on the lobes, own rng stream
    const holes = [];
    if (g.holes) {
      const hrng = makeRng((g.seed ^ 0x27d4eb2f) >>> 0);
      const lobeOf = (host) => host.kind === "lobe" ? host.index : -1;
      const keepOut = [...eyes.map((e) => ({ li: lobeOf(e.host), p: e.pos, r: e.r + e.stalk })), ...mouths.map((m) => ({ li: lobeOf(m.host), p: m.pos, r: m.r * 1.2 }))].filter((k) => k.li >= 0);
      const perCluster = Math.round(lerp(6, 70, g.holeDensity));
      // Fill one patch around `centre` on lobe `li`; returns the holes that fit.
      const fillPatch = (c, li, centre) => {
        const R = lobeR(li), base = Math.min(R * .1, lobeR(main) * .05) * g.holeSize;   // one hole size for the whole creature, capped on small lobes
        const b = basis(centre), spread = Math.sqrt(perCluster) * base * 1.35 / R;
        const placed = [];
        for (let t = 0; t < perCluster * 12 && placed.length < perCluster; t++) {
          // denser, larger holes in the middle of a patch, smaller ones at its fringe
          const rad = spread * Math.sqrt(hrng()), ang = hrng() * TAU, edge = rad / spread;
          const size = base * (1.25 - .55 * edge) * (.75 + hrng() * .5);
          const d = norm(fromBasis(b, [Math.cos(ang) * rad, Math.sin(ang) * rad, 1]));
          const hit = onLobe(li, d);
          if (inside(hit.p, li) || hit.p[1] < .05) continue;
          if (placed.concat(holes).some((q) => q.lobe === li && Math.hypot(q.pos[0] - hit.local[0], q.pos[1] - hit.local[1], q.pos[2] - hit.local[2]) < (q.size + size) * 1.12)) continue;
          if (keepOut.some((k) => k.li === li && Math.hypot(k.p[0] - hit.local[0], k.p[1] - hit.local[1], k.p[2] - hit.local[2]) < k.r + size * 1.4)) continue;
          placed.push({ lobe: li, cluster: c, pos: hit.local, normal: hit.n, size, seed: hrng() < g.holeSeeds, phase: hrng() * TAU });
        }
        return placed;
      };
      for (let c = 0; c < g.holes; c++) {
        // Try a few spots and keep the one that fits the most holes (faces, eyes and mouths block
        // spots). The first patch tries the main lobe's front first, where the default camera looks.
        let best = [];
        for (let attempt = 0; attempt < 8 && best.length < perCluster * .6; attempt++) {
          let li, d;
          if (c === 0 && attempt < 4) { li = main; d = norm(add(lobeFront(main), scale(randomUnit(hrng), .45 + attempt * .2))); }
          else { li = pickLobe(); const u = randomUnit(hrng); d = norm([u[0], Math.max(-.3, u[1]), u[2]]); }
          const hit = onLobe(li, d);
          if (inside(hit.p, li) || hit.p[1] < .2) continue;
          const placed = fillPatch(c, li, d);
          if (placed.length > best.length) best = placed;
        }
        holes.push(...best);
      }
    }

    // hair: bristles on the lobes and heads, own rng stream. Each hair is a root, a surface normal
    // and a length; the renderer bends it (droop, curl) and sways it.
    const hairs = [];
    if (g.hair) {
      const hr = makeRng((g.seed ^ 0x165667b1) >>> 0);
      const hosts = [...lobes.map((l, i) => ({ host: { kind: "lobe", index: i }, r: lobeR(i), area: l.r[0] * l.r[1] + l.r[1] * l.r[2] + l.r[0] * l.r[2] })),
        ...heads.map((h, i) => ({ host: { kind: "head", index: i }, r: h.r, area: h.r * h.r * (h.scale[0] * h.scale[1] + h.scale[1] * h.scale[2] + h.scale[0] * h.scale[2]) }))];
      const total = hosts.reduce((a, h) => a + h.area, 0);
      const pickHost = () => { let r = hr() * total; for (const h of hosts) if ((r -= h.area) <= 0) return h; return hosts[0]; };
      const surface = (host, d) => {
        if (host.kind === "lobe") return onLobe(host.index, d);
        const h = heads[host.index];
        const local = scale(mul(d, h.scale), h.r);
        return { local, p: add(h.center, local), n: norm(div(d, h.scale)) };
      };
      const same = (a, b) => a.kind === b.kind && a.index === b.index;
      const keepOut = [...eyes.map((e) => ({ host: e.host, p: e.pos, r: e.r * 1.1 + e.stalk })), ...mouths.map((m) => ({ host: m.host, p: m.pos, r: m.r * 1.1 }))];
      const count = Math.round(g.hair / 100 * 2400);
      const tufts = Array.from({ length: Math.max(3, Math.round(count / 70)) }, () => ({ h: pickHost(), d: randomUnit(hr) }));
      const baseLen = lobeR(main) * .32 * g.hairLen;
      for (let i = 0, tries = 0; i < count && tries < count * 4; tries++) {
        let h, d;
        if (g.hairPlace === "tufts") {
          const t = tufts[tries % tufts.length];
          h = t.h; d = norm(add(t.d, scale(randomUnit(hr), .3)));
        } else {
          h = pickHost(); d = randomUnit(hr);
          // a fringe grows from the lower half, like the bristles under a treehopper's bulbs
          if (g.hairPlace === "fringe") d = norm([d[0], -.15 - Math.abs(d[1]) * .75, d[2]]);
        }
        const hit = surface(h.host, d);
        if (h.host.kind === "lobe" && inside(hit.p, h.host.index)) continue;
        if (hit.p[1] < .06) continue;
        if (keepOut.some((k) => same(k.host, h.host) && Math.hypot(k.p[0] - hit.local[0], k.p[1] - hit.local[1], k.p[2] - hit.local[2]) < k.r)) continue;
        const len = baseLen * Math.min(1, h.r / lobeR(main) + .45) * (.6 + hr() * .8);
        hairs.push({ host: h.host, pos: hit.local, normal: hit.n, len, phase: hr() * TAU });
        i++;
      }
    }

    // bounds for camera / stage framing
    const lo = [Infinity, 0, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const grow = (p, r = 0) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - r); hi[k] = Math.max(hi[k], p[k] + r); } };
    lobes.forEach((l) => { grow(sub(l.c, l.r)); grow(add(l.c, l.r)); });
    heads.forEach((h) => grow(h.center, h.r * 1.3));
    arms.forEach((a) => { const reach = a.leg ? a.foot : add(a.rootW, scale(norm([a.dir[0], a.type === "feeler" ? .6 : 0, a.dir[2]]), a.len * .7)); grow(reach, a.r0); });
    lo[1] = 0;
    const center = scale(add(lo, hi), .5);
    const radius = Math.max(1.5, length(sub(hi, lo)) * .5);
    const footprint = Math.max(Math.abs(lo[0]), Math.abs(hi[0]), Math.abs(lo[2]), Math.abs(hi[2]));

    return { genome: g, lobes, main, along, strands, heads, eyes, mouths, arms, dermal, pimples, cheeks, mask, holes, hairs, bounds: { lo, hi, center, radius, footprint } };
  }

  function armRadius(arm, s) {
    const f = { tentacle: 1 - .8 * s, tendrils: 1 - .85 * s, feeler: 1 - .85 * s, limb: 1 - .35 * s, hands: 1 - .4 * s, leg: 1 - .5 * s }[arm.type];
    return arm.r0 * f;
  }

  // Fills out[0 .. ARM_N*3) with the arm's centre line at time t.
  // root is the (animated) root position in creature space.
  function armPath(arm, root, t, wob, out, strand = 0) {
    const n = ARM_N;
    out[0] = root[0]; out[1] = root[1]; out[2] = root[2];
    if (arm.leg) {
      const phase = t * arm.speed * 1.4 + arm.gait;
      const lift = Math.max(0, Math.sin(phase)) * arm.len * .12 * (.4 + wob);
      const c = Math.cos(phase) * (.4 + wob);
      let foot = [arm.foot[0] + arm.stride[0] * c, arm.foot[1] + lift, arm.foot[2] + arm.stride[2] * c];
      const a = arm.len * .5;
      let d = sub(foot, root);
      let dist = length(d);
      if (dist > a * 1.96) { foot = add(root, scale(d, a * 1.96 / dist)); d = sub(foot, root); dist = a * 1.96; }
      const dh = scale(d, 1 / (dist || 1));
      const u = norm(sub([0, 1, 0], scale(dh, dh[1])));
      const knee = add(add(root, scale(d, .5)), scale(u, Math.sqrt(Math.max(0, a * a - dist * dist / 4))));
      const half = (n - 1) / 2;
      for (let k = 1; k < n; k++) {
        const p = k <= half ? add(root, scale(sub(knee, root), k / half)) : add(knee, scale(sub(foot, knee), (k - half) / (n - 1 - half)));
        out[k * 3] = p[0]; out[k * 3 + 1] = p[1]; out[k * 3 + 2] = p[2];
      }
      return out;
    }
    const st = arm.strands[strand] || arm.strands[0];
    const step = arm.len * st.scale / (n - 1);
    const th0 = Math.atan2(arm.dir[2], arm.dir[0]) + st.yaw;
    const p0 = Math.asin(clamp(arm.dir[1], -1, 1));
    const amp = .12 + wob * .55;
    const ph = arm.phase + st.phase;
    let x = root[0], y = root[1], z = root[2];
    if (arm.type === "limb") {
      const sway = Math.sin(t * arm.speed + ph) * .25 * (.3 + wob);
      const elbow = Math.floor((n - 1) * .45);
      for (let k = 1; k < n; k++) {
        const pitch = k <= elbow ? p0 * .5 + .45 + sway * .5 : -.95 + sway;
        const yaw = th0 + (k <= elbow ? 0 : .35 + Math.cos(t * arm.speed * .8 + ph) * .3 * (.3 + wob));
        const cp = Math.cos(pitch);
        x += Math.cos(yaw) * cp * step; y += Math.sin(pitch) * step; z += Math.sin(yaw) * cp * step;
        y = Math.max(y, armRadius(arm, k / (n - 1)) + .02);
        out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = z;
      }
      return out;
    }
    const pEnd = { tentacle: -1.25, tendrils: -1.05, feeler: .75, hands: -.3 }[arm.type];
    const curl = arm.type === "tentacle" ? 1.4 * (.5 + .5 * Math.sin(t * .6 + ph)) + arm.curl : arm.type === "feeler" ? -.4 : arm.type === "tendrils" ? 1 : .2;
    for (let k = 1; k < n; k++) {
      const sN = k / (n - 1);
      const w = Math.sin(t * arm.speed * 1.7 + ph - sN * 3.4);
      const w2 = Math.cos(t * arm.speed * 1.15 + ph * 1.3 - sN * 2.6);
      const pitch = lerp(p0, pEnd, Math.min(1, sN * 1.5)) + w * amp * sN * 1.1 + curl * smooth(.6, 1, sN);
      const yaw = th0 + w2 * amp * sN + arm.twist * sN;
      const cp = Math.cos(pitch);
      x += Math.cos(yaw) * cp * step; y += Math.sin(pitch) * step; z += Math.sin(yaw) * cp * step;
      y = Math.max(y, armRadius(arm, sN) + .02);
      out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = z;
    }
    return out;
  }

  return {
    TAU, clamp, lerp, smooth, makeRng, noise3, basis, fromBasis, norm,
    PLANS, GENES, GENE, CLASSIC, HEAD_SHAPES, ARM_N,
    normalizeGenome, randomGenome, mutateGenome, genomeDistance, majorDifferences, nearest, pickNovel,
    paletteOf, buildLayout, armPath, armRadius, countBucket
  };
})();

export default Shoggoth;
