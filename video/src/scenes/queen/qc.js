// qc.js: the shared parameter model and geometry code (QC) of assets/3d-queen-clothing/index.html, copied verbatim
// (parts 1 and 2: schema, eras, paramsAtYear, randomCommission, silhouettes, plain-array mesh builders, arms, poses, gallery).
const QC = {};
// ============================================================ part 1: parameter model, eras, morph, hash, dice
Object.assign(QC, (() => {
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a * (1 - t) + b * t;
  function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function decimals(step) { const s = String(step), i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  function snap(v, d) {
    const n = Math.round((clamp(v, d.min, d.max) - d.min) / d.step);
    return +clamp(d.min + n * d.step, d.min, d.max).toFixed(decimals(d.step));
  }

  // -------- colours
  const HEX = /^#[0-9a-f]{6}$/;
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function rgbToHex(c) { return '#' + c.map(x => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join(''); }
  const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const toSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  function mixHex(a, b, t) {
    if (t <= 0) return a; if (t >= 1) return b;
    const A = hexToRgb(a).map(toLin), B = hexToRgb(b).map(toLin);
    return rgbToHex(A.map((x, i) => toSrgb(lerp(x, B[i], t))));
  }
  function rgbToHsl([r, g, b]) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function hslToRgb([h, s, l]) {
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }
  function jitterHex(hex, rng, amt) {
    const [h, s, l] = rgbToHsl(hexToRgb(hex));
    return rgbToHex(hslToRgb([(h + (rng() * 2 - 1) * 0.07 * amt + 1) % 1, clamp(s + (rng() * 2 - 1) * 0.12 * amt, 0, 1), clamp(l + (rng() * 2 - 1) * 0.08 * amt, 0, 1)]));
  }

  // -------- schema
  const PATTERNS = ['plain', 'damask', 'trellis', 'floral', 'brocade', 'stripes', 'jewelgrid'];
  const GROUPS = ['Silhouette', 'Bodice', 'Sleeves', 'Collar', 'Mantle', 'Fabric', 'Trim', 'Jewels', 'Hair & face', 'Motion'];
  const N = (key, group, min, max, step, label, extra) => Object.assign({ key, group, kind: 'num', min, max, step, label }, extra);
  const C = (key, group, label) => ({ key, group, kind: 'color', label });
  const CH = (key, group, options, label, extra) => Object.assign({ key, group, kind: 'choice', options, label }, extra);
  const SCHEMA = [
    N('waistY', 'Silhouette', 0.95, 1.12, 0.005, 'Waist height (m)'),
    N('waist', 'Silhouette', 0.085, 0.17, 0.001, 'Waist radius (m)'),
    N('hipShelf', 'Silhouette', 0.12, 0.6, 0.005, 'Hip shelf / drum (m)'),
    N('hemRadius', 'Silhouette', 0.15, 0.85, 0.005, 'Hem radius (m)'),
    N('curve', 'Silhouette', -1, 1, 0.01, 'Profile: trumpet ↔ dome'),
    N('pannier', 'Silhouette', 0, 1.2, 0.01, 'Panniers'),
    N('bustle', 'Silhouette', 0, 1, 0.01, 'Bustle'),
    N('trainLength', 'Silhouette', 0, 3, 0.05, 'Train (m)'),
    N('frontOpen', 'Silhouette', 0, 1.2, 0.01, 'Front opening'),
    N('flounces', 'Silhouette', 0, 6, 1, 'Flounce tiers'),
    N('flounceDepth', 'Silhouette', 0.05, 0.25, 0.005, 'Flounce depth'),
    N('hemFullness', 'Silhouette', 0, 1, 0.01, 'Hem folds'),
    N('bust', 'Bodice', 0.1, 0.18, 0.001, 'Bust radius (m)'),
    CH('corsetShape', 'Bodice', ['cone', 'hourglass', 'sbend', 'natural'], 'Corset shape'),
    CH('neckShape', 'Bodice', ['square', 'high', 'offshoulder', 'v', 'sweetheart'], 'Neckline'),
    N('neckDepth', 'Bodice', 0, 0.2, 0.005, 'Neckline depth'),
    N('neckWidth', 'Bodice', 0.04, 0.16, 0.005, 'Neckline width'),
    N('pointDepth', 'Bodice', 0, 0.16, 0.005, 'Waist point'),
    N('stomacher', 'Bodice', 0, 1, 0.01, 'Stomacher'),
    N('stomacherBows', 'Bodice', 0, 7, 1, 'Échelle bows'),
    N('sleeveLength', 'Sleeves', 0.15, 1, 0.01, 'Length'),
    N('shoulderPuff', 'Sleeves', 0, 1, 0.01, 'Shoulder puff'),
    N('upperFull', 'Sleeves', 0, 1, 0.01, 'Upper fullness (gigot)'),
    N('cuffFlare', 'Sleeves', 0, 1, 0.01, 'Trumpet cuff'),
    N('engageantes', 'Sleeves', 0, 1, 0.01, 'Lace engageantes'),
    N('sleeveSlash', 'Sleeves', 0, 6, 1, 'Slashed puffs'),
    N('ruff', 'Collar', 0, 1, 0.01, 'Cartwheel ruff'),
    N('ruffLayers', 'Collar', 1, 3, 1, 'Ruff layers'),
    N('fanCollar', 'Collar', 0, 1, 0.01, 'Wired lace fan'),
    N('bertha', 'Collar', 0, 1, 0.01, 'Lace bertha'),
    N('highCollar', 'Collar', 0, 1, 0.01, 'High lace collar'),
    N('mantle', 'Mantle', 0, 4, 0.05, 'Mantle trail (m)'),
    N('mantleWidth', 'Mantle', 0, 1, 0.01, 'Mantle spread'),
    N('ermine', 'Mantle', 0, 0.25, 0.005, 'Ermine border (m)'),
    C('mantleColor', 'Mantle', 'Mantle'),
    C('gownColor', 'Fabric', 'Gown'), C('gownAccent', 'Fabric', 'Gown accent'),
    C('foreColor', 'Fabric', 'Forepart'), C('foreAccent', 'Fabric', 'Forepart accent'),
    C('bodiceColor', 'Fabric', 'Bodice'), C('bodiceAccent', 'Fabric', 'Bodice accent'),
    CH('pattern', 'Fabric', PATTERNS, 'Gown pattern'),
    CH('forePattern', 'Fabric', PATTERNS, 'Forepart pattern'),
    N('patternScale', 'Fabric', 0.4, 2.5, 0.05, 'Pattern scale'),
    CH('material', 'Fabric', ['satin', 'velvet', 'brocade', 'taffeta'], 'Material'),
    N('sheen', 'Fabric', 0, 1, 0.01, 'Sheen'),
    N('braidBands', 'Trim', 0, 6, 1, 'Hem braid bands'),
    C('braidColor', 'Trim', 'Braid'),
    N('frontTrim', 'Trim', 0, 0.08, 0.002, 'Opening trim (m)'),
    N('pearlRows', 'Trim', 0, 3, 1, 'Pearl rows'),
    N('jewelDensity', 'Trim', 0, 1, 0.01, 'Jewels on skirt'),
    N('fringe', 'Trim', 0, 1, 0.01, 'Fringe'),
    N('bowsOnSkirt', 'Trim', 0, 12, 1, 'Skirt bows'),
    N('sash', 'Trim', 0, 1, 0.01, 'Order sash'),
    C('sashColor', 'Trim', 'Sash'),
    N('necklaces', 'Jewels', 0, 6, 1, 'Pearl ropes'),
    N('pearlLength', 'Jewels', 0, 1, 0.01, 'Rope length'),
    CH('crown', 'Jewels', ['none', 'tudor', 'diadem', 'tiara', 'coronation'], 'Crown'),
    N('crownScale', 'Jewels', 0.6, 1.4, 0.01, 'Crown size'),
    CH('gloves', 'Jewels', ['none', 'wrist', 'opera'], 'Gloves'),
    CH('sceptreOrb', 'Jewels', ['none', 'sceptre', 'orb', 'both'], 'Sceptre & orb'),
    CH('handFan', 'Jewels', ['off', 'on'], 'Hand fan'),
    CH('hairStyle', 'Hair & face', ['gable', 'curls', 'pouf', 'chignon', 'upswept', 'modern'], 'Hair style'),
    C('hairColor', 'Hair & face', 'Hair'),
    N('poufHeight', 'Hair & face', 0, 1, 0.01, 'Pouf height'),
    C('skinTone', 'Hair & face', 'Skin'),
    N('faceMakeup', 'Hair & face', 0, 1, 0.01, 'Court make-up'),
    CH('motionMode', 'Motion', ['still', 'turntable', 'walk', 'twirl'], 'Motion', { global: true, def: 'turntable' }),
    N('speed', 'Motion', 0.2, 2, 0.05, 'Speed', { global: true, def: 1 }),
    N('wind', 'Motion', 0, 1, 0.01, 'Wind', { global: true, def: 0.15 }),
    N('swing', 'Motion', 0, 1, 0.01, 'Looseness', { global: true, def: 0.6 }),
    N('damping', 'Motion', 0, 1, 0.01, 'Damping', { global: true, def: 0.45 }),
  ];
  const SCHEMA_BY_KEY = {};
  for (const d of SCHEMA) SCHEMA_BY_KEY[d.key] = d;

  // -------- eras (notes are our own words)
  const ERAS = [
    { year: 1500, name: 'Tudor', dates: 'c. 1500–1560',
      note: 'Early Tudor court dress: a stiff cone of a skirt held out by a Spanish farthingale of graduated hoops, a square neckline, wide trumpet sleeves turned back in fur or brocade, and a gable hood framing the face. The gown often opened at the front over a separate forepart of richer cloth.',
      params: { waistY: 1, waist: 0.112, hipShelf: 0.2, hemRadius: 0.55, curve: 0, pannier: 0, bustle: 0, trainLength: 0.35, frontOpen: 0.45, flounces: 0, flounceDepth: 0.12, hemFullness: 0.3,
        bust: 0.13, corsetShape: 'cone', neckShape: 'square', neckDepth: 0.08, neckWidth: 0.11, pointDepth: 0.03, stomacher: 0.8, stomacherBows: 0,
        sleeveLength: 1, shoulderPuff: 0.1, upperFull: 0.1, cuffFlare: 0.65, engageantes: 0, sleeveSlash: 2,
        ruff: 0, ruffLayers: 1, fanCollar: 0, bertha: 0, highCollar: 0,
        mantle: 0, mantleWidth: 0.5, ermine: 0.1, mantleColor: '#5a1020',
        gownColor: '#7a1424', gownAccent: '#c9a245', foreColor: '#c9a24a', foreAccent: '#7a1424', bodiceColor: '#7a1424', bodiceAccent: '#c9a245',
        pattern: 'plain', forePattern: 'brocade', patternScale: 1, material: 'velvet', sheen: 0.7,
        braidBands: 1, braidColor: '#d4af37', frontTrim: 0.03, pearlRows: 1, jewelDensity: 0.05, fringe: 0, bowsOnSkirt: 0, sash: 0, sashColor: '#2a5aa8',
        necklaces: 2, pearlLength: 0.4, crown: 'none', crownScale: 1, gloves: 'none', sceptreOrb: 'none', handFan: 'off',
        hairStyle: 'gable', hairColor: '#6b3a1e', poufHeight: 0, skinTone: '#ecc4aa', faceMakeup: 0.25 } },
    { year: 1600, name: 'Elizabethan', dates: 'c. 1580–1620',
      note: 'Late Elizabethan: the French wheel farthingale threw the skirt out flat at the hips before it dropped straight to the floor. Starched cartwheel ruffs, wired lace fans behind the head, jewel-studded silk and long ropes of pearls turned the queen into an icon.',
      params: { waistY: 1, waist: 0.105, hipShelf: 0.46, hemRadius: 0.49, curve: 0, pannier: 0, bustle: 0, trainLength: 0.2, frontOpen: 0, flounces: 0, flounceDepth: 0.12, hemFullness: 0.45,
        bust: 0.12, corsetShape: 'cone', neckShape: 'high', neckDepth: 0.02, neckWidth: 0.07, pointDepth: 0.13, stomacher: 0.9, stomacherBows: 0,
        sleeveLength: 1, shoulderPuff: 0.65, upperFull: 0.45, cuffFlare: 0, engageantes: 0.15, sleeveSlash: 0,
        ruff: 0.8, ruffLayers: 2, fanCollar: 0.9, bertha: 0, highCollar: 0,
        mantle: 0, mantleWidth: 0.5, ermine: 0.1, mantleColor: '#3a1830',
        gownColor: '#f2eee4', gownAccent: '#b3122b', foreColor: '#f2eee4', foreAccent: '#b3122b', bodiceColor: '#f2eee4', bodiceAccent: '#b3122b',
        pattern: 'jewelgrid', forePattern: 'jewelgrid', patternScale: 1.3, material: 'satin', sheen: 0.6,
        braidBands: 0, braidColor: '#d4af37', frontTrim: 0.02, pearlRows: 2, jewelDensity: 0.1, fringe: 0, bowsOnSkirt: 0, sash: 0, sashColor: '#2a5aa8',
        necklaces: 5, pearlLength: 1, crown: 'tudor', crownScale: 0.8, gloves: 'none', sceptreOrb: 'none', handFan: 'on',
        hairStyle: 'curls', hairColor: '#b5532a', poufHeight: 0, skinTone: '#f2dccd', faceMakeup: 0.9 } },
    { year: 1700, name: 'Rococo', dates: 'c. 1720–1780',
      note: 'The robe à la française at its mid-century height: side hoops called panniers made the skirt very wide but flat front to back. The gown opened over a matching petticoat and a stomacher laced with a ladder of bows, with tiers of lace at the elbow and a tall powdered coiffure.',
      params: { waistY: 1.02, waist: 0.1, hipShelf: 0.28, hemRadius: 0.38, curve: 0.1, pannier: 1, bustle: 0, trainLength: 0.5, frontOpen: 0.55, flounces: 2, flounceDepth: 0.1, hemFullness: 0.6,
        bust: 0.12, corsetShape: 'cone', neckShape: 'square', neckDepth: 0.09, neckWidth: 0.12, pointDepth: 0.09, stomacher: 1, stomacherBows: 6,
        sleeveLength: 0.5, shoulderPuff: 0, upperFull: 0.05, cuffFlare: 0.35, engageantes: 1, sleeveSlash: 0,
        ruff: 0, ruffLayers: 1, fanCollar: 0, bertha: 0, highCollar: 0,
        mantle: 0, mantleWidth: 0.5, ermine: 0.1, mantleColor: '#2b4a7a',
        gownColor: '#b8d2e3', gownAccent: '#e8a0b0', foreColor: '#f1ece2', foreAccent: '#e8a0b0', bodiceColor: '#b8d2e3', bodiceAccent: '#e8a0b0',
        pattern: 'floral', forePattern: 'floral', patternScale: 1, material: 'taffeta', sheen: 0.5,
        braidBands: 0, braidColor: '#f1ece2', frontTrim: 0.04, pearlRows: 0, jewelDensity: 0, fringe: 0, bowsOnSkirt: 6, sash: 0, sashColor: '#2a5aa8',
        necklaces: 1, pearlLength: 0.1, crown: 'none', crownScale: 1, gloves: 'none', sceptreOrb: 'none', handFan: 'on',
        hairStyle: 'pouf', hairColor: '#e8e2d8', poufHeight: 0.8, skinTone: '#f0d2c0', faceMakeup: 0.5 } },
    { year: 1800, name: 'Victorian', dates: 'c. 1840–1870',
      note: 'Mid-Victorian court and evening dress: a cage crinoline of steel hoops replaced heavy layers of petticoats and gave a smooth dome. Bodices sat off the shoulder under a deep lace bertha, the skirt was tiered in flounces, and long gloves and a tiara finished the look.',
      params: { waistY: 1.03, waist: 0.095, hipShelf: 0.22, hemRadius: 0.72, curve: 0.7, pannier: 0, bustle: 0, trainLength: 0.6, frontOpen: 0, flounces: 3, flounceDepth: 0.16, hemFullness: 0.5,
        bust: 0.13, corsetShape: 'hourglass', neckShape: 'offshoulder', neckDepth: 0.12, neckWidth: 0.13, pointDepth: 0.06, stomacher: 0, stomacherBows: 0,
        sleeveLength: 0.22, shoulderPuff: 0.2, upperFull: 0, cuffFlare: 0.15, engageantes: 0.4, sleeveSlash: 0,
        ruff: 0, ruffLayers: 1, fanCollar: 0, bertha: 0.8, highCollar: 0,
        mantle: 0.7, mantleWidth: 0, ermine: 0.05, mantleColor: '#7e2234',
        gownColor: '#f3efe6', gownAccent: '#d8cdb8', foreColor: '#f3efe6', foreAccent: '#d8cdb8', bodiceColor: '#f3efe6', bodiceAccent: '#d8cdb8',
        pattern: 'damask', forePattern: 'damask', patternScale: 0.9, material: 'satin', sheen: 0.7,
        braidBands: 0, braidColor: '#d9c9a0', frontTrim: 0, pearlRows: 1, jewelDensity: 0, fringe: 0, bowsOnSkirt: 0, sash: 0, sashColor: '#2a5aa8',
        necklaces: 2, pearlLength: 0.25, crown: 'tiara', crownScale: 1, gloves: 'opera', sceptreOrb: 'none', handFan: 'off',
        hairStyle: 'chignon', hairColor: '#4a2c1d', poufHeight: 0, skinTone: '#efcdb8', faceMakeup: 0.15 } },
    { year: 1900, name: 'Edwardian', dates: 'c. 1895–1910',
      note: 'Around 1900 a straight-front corset pushed the figure into an S-bend, with the bust forward and the hips back. Skirts were smooth over the hips and flared into long trains; boned lace collars rose up the neck and the upper sleeves were full.',
      params: { waistY: 1.02, waist: 0.09, hipShelf: 0.17, hemRadius: 0.4, curve: -0.4, pannier: 0, bustle: 0.05, trainLength: 1.4, frontOpen: 0, flounces: 0, flounceDepth: 0.1, hemFullness: 0.3,
        bust: 0.135, corsetShape: 'sbend', neckShape: 'high', neckDepth: 0, neckWidth: 0.07, pointDepth: 0.02, stomacher: 0, stomacherBows: 0,
        sleeveLength: 1, shoulderPuff: 0.9, upperFull: 0.7, cuffFlare: 0, engageantes: 0.15, sleeveSlash: 0,
        ruff: 0, ruffLayers: 1, fanCollar: 0.55, bertha: 0, highCollar: 0.8,
        mantle: 0, mantleWidth: 0.5, ermine: 0.1, mantleColor: '#4a2a5a',
        gownColor: '#c79ac4', gownAccent: '#7e5a8c', foreColor: '#c79ac4', foreAccent: '#7e5a8c', bodiceColor: '#c79ac4', bodiceAccent: '#7e5a8c',
        pattern: 'trellis', forePattern: 'trellis', patternScale: 1.2, material: 'satin', sheen: 0.7,
        braidBands: 1, braidColor: '#8a6a9c', frontTrim: 0.02, pearlRows: 0, jewelDensity: 0, fringe: 0, bowsOnSkirt: 0, sash: 0, sashColor: '#2a5aa8',
        necklaces: 1, pearlLength: 0.05, crown: 'tiara', crownScale: 0.9, gloves: 'none', sceptreOrb: 'none', handFan: 'off',
        hairStyle: 'upswept', hairColor: '#5a3a28', poufHeight: 0, skinTone: '#edcdb9', faceMakeup: 0.1 } },
    { year: 2000, name: 'Modern', dates: 'c. 1990–2020',
      note: 'A modern state gown: a natural waist and a fluid column or soft A-line skirt with no hoops at all, embroidered or beaded rather than boned, the sash of an order of chivalry worn across the bodice, and a diamond tiara for evening.',
      params: { waistY: 1.04, waist: 0.105, hipShelf: 0.17, hemRadius: 0.33, curve: -0.1, pannier: 0, bustle: 0, trainLength: 0.25, frontOpen: 0, flounces: 0, flounceDepth: 0.1, hemFullness: 0.15,
        bust: 0.135, corsetShape: 'natural', neckShape: 'v', neckDepth: 0.07, neckWidth: 0.07, pointDepth: 0, stomacher: 0, stomacherBows: 0,
        sleeveLength: 0.2, shoulderPuff: 0, upperFull: 0, cuffFlare: 0, engageantes: 0, sleeveSlash: 0,
        ruff: 0, ruffLayers: 1, fanCollar: 0, bertha: 0, highCollar: 0,
        mantle: 0, mantleWidth: 0.5, ermine: 0.1, mantleColor: '#3a2a6e',
        gownColor: '#efe9df', gownAccent: '#b9c2cf', foreColor: '#efe9df', foreAccent: '#b9c2cf', bodiceColor: '#efe9df', bodiceAccent: '#b9c2cf',
        pattern: 'brocade', forePattern: 'brocade', patternScale: 0.8, material: 'satin', sheen: 0.8,
        braidBands: 0, braidColor: '#c0c8d8', frontTrim: 0, pearlRows: 0, jewelDensity: 0.03, fringe: 0, bowsOnSkirt: 0, sash: 1, sashColor: '#3a6fb8',
        necklaces: 3, pearlLength: 0.1, crown: 'tiara', crownScale: 1, gloves: 'none', sceptreOrb: 'none', handFan: 'off',
        hairStyle: 'modern', hairColor: '#8a7f78', poufHeight: 0, skinTone: '#e6c1a9', faceMakeup: 0.1 } },
  ];
  const SKIN = ['#f6e2d3', '#efd0bb', '#e8bea3', '#dcae8f', '#c99372', '#a8744f', '#8a5a3c', '#6b432c'];
  const HAIR = ['#1c1410', '#3b2417', '#5a3a28', '#7a4a2a', '#a0522d', '#b8602e', '#c9a467', '#e2cf9c', '#8a7f78', '#e8e2d8'];
  const ROYAL = ['#7a1424', '#b3122b', '#1d3a6e', '#2a6fb5', '#0f5132', '#3d6b45', '#5b2a6e', '#c79ac4', '#b8d2e3', '#f2eee4', '#efe9df', '#d4af37', '#c9a24a', '#1a1a1a', '#e8a0b0', '#a9c8de', '#8b2b3a', '#f3efe6'];

  // -------- param sets
  function paramsForEra(i, cur) {
    const out = {};
    for (const d of SCHEMA) out[d.key] = d.global ? (cur && cur[d.key] !== undefined ? cur[d.key] : d.def) : ERAS[i].params[d.key];
    return out;
  }
  function clampParams(p, fallback) {
    const out = {};
    for (const d of SCHEMA) {
      const v = p ? p[d.key] : undefined, fb = fallback[d.key];
      if (d.kind === 'num') out[d.key] = typeof v === 'number' && isFinite(v) ? snap(v, d) : fb;
      else if (d.kind === 'color') out[d.key] = typeof v === 'string' && HEX.test(v.toLowerCase()) ? v.toLowerCase() : fb;
      else out[d.key] = d.options.includes(v) ? v : fb;
    }
    return out;
  }
  function paramsAtYear(year, cur) {
    const y = clamp(year, ERAS[0].year, ERAS[ERAS.length - 1].year);
    let i = 0;
    while (i < ERAS.length - 2 && y > ERAS[i + 1].year) i++;
    const A = ERAS[i], B = ERAS[i + 1], t = smoothstep(0, 1, (y - A.year) / (B.year - A.year));
    const out = paramsForEra(i, cur);
    for (const d of SCHEMA) {
      if (d.global) continue;
      const a = A.params[d.key], b = B.params[d.key];
      if (d.kind === 'num') out[d.key] = d.step >= 1 ? Math.round(lerp(a, b, t)) : lerp(a, b, t);
      else if (d.kind === 'color') out[d.key] = mixHex(a, b, t);
      else out[d.key] = t < 0.5 ? a : b;
    }
    return out;
  }
  const nearestEra = y => clamp(Math.round((y - ERAS[0].year) / 100), 0, ERAS.length - 1);

  // -------- share links
  function encodeHash(p, eraIndex) {
    const base = paramsForEra(eraIndex), parts = ['e=' + eraIndex];
    for (const d of SCHEMA) {
      const v = p[d.key], b = base[d.key];
      if (d.kind === 'num') { const sv = snap(v, d); if (sv !== snap(b, d)) parts.push(d.key + '=' + sv); }
      else if (d.kind === 'color') { if (v !== b) parts.push(d.key + '=' + v.slice(1)); }
      else if (v !== b) parts.push(d.key + '=' + v);
    }
    return parts.join('&');
  }
  function decodeHash(str) {
    const kv = Object.create(null);
    for (const part of String(str || '').replace(/^#/, '').split('&')) { const i = part.indexOf('='); if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1); }
    let e = parseInt(kv.e, 10);
    if (!(e >= 0 && e < ERAS.length)) e = 0;
    const p = paramsForEra(e);
    for (const d of SCHEMA) {
      if (!(d.key in kv)) continue;
      const s = kv[d.key];
      if (d.kind === 'num') { const n = parseFloat(s); if (isFinite(n)) p[d.key] = snap(n, d); }
      else if (d.kind === 'color') { if (/^[0-9a-fA-F]{6}$/.test(s)) p[d.key] = '#' + s.toLowerCase(); }
      else if (d.options.includes(s)) p[d.key] = s;
    }
    return { era: e, params: p };
  }

  // -------- dice
  function randomCommission(rng, mode, eraIndex, cur) {
    const base = paramsForEra(eraIndex, cur), out = Object.assign({}, base);
    for (const d of SCHEMA) {
      if (d.global) continue;
      const b = base[d.key];
      if (mode === 'wild') {
        if (d.kind === 'num') out[d.key] = snap(d.min + rng() * (d.max - d.min), d);
        else if (d.kind === 'color') { const pal = d.key === 'skinTone' ? SKIN : d.key === 'hairColor' ? HAIR : ROYAL; out[d.key] = pal[Math.floor(rng() * pal.length)]; }
        else out[d.key] = d.options[Math.floor(rng() * d.options.length)];
      } else {
        if (d.kind === 'num') out[d.key] = snap(b + (rng() * 2 - 1) * 0.25 * (d.max - d.min), d);
        else if (d.kind === 'color') out[d.key] = jitterHex(b, rng, 1);
        else out[d.key] = rng() < 0.8 ? b : d.options[Math.floor(rng() * d.options.length)];
      }
    }
    return out;
  }

  return { TAU, clamp, lerp, smoothstep, mulberry32, decimals, snap, HEX, hexToRgb, rgbToHex, mixHex, jitterHex,
    PATTERNS, GROUPS, SCHEMA, SCHEMA_BY_KEY, ERAS, ROYAL, SKIN, HAIR, paramsForEra, clampParams, paramsAtYear, nearestEra, encodeHash, decodeHash, randomCommission };
})());

// ============================================================ part 2: figure, silhouette, meshes, underpinnings, motion
Object.assign(QC, (() => {
  const { clamp, lerp, smoothstep, TAU } = QC;
  const HEM_Y = 0.012, FOLDS = 22, HEAD = [0.083, 0.105, 0.092];
  function figure(p) { const w = p.waistY; return { waistY: w, bustY: w + 0.25, shoulderY: w + 0.38, neckY: w + 0.43, headY: w + 0.565, D: w - HEM_Y }; }

  // -------- torso: elliptical sections between key heights
  const BUST_RZ = { cone: 0.72, hourglass: 0.95, sbend: 1.0, natural: 0.88 };
  function torsoKeys(p) {
    const f = figure(p), sh = p.corsetShape, sb = sh === 'sbend';
    return [
      [f.waistY - 0.08, p.waist * 1.1 + 0.035, p.waist * 0.9 + 0.02, sb ? -0.035 : 0],
      [f.waistY, p.waist * 1.1, p.waist * 0.9, sb ? -0.012 : 0],
      [f.bustY, p.bust * 1.05, p.bust * BUST_RZ[sh], sb ? 0.03 : sh === 'cone' ? -0.004 : 0.004],
      [f.shoulderY - 0.05, 0.148 + (p.bust - 0.12) * 0.5, 0.082, sb ? 0.008 : 0],
      [f.shoulderY - 0.015, 0.162, 0.066, -0.005],
      [f.neckY, 0.058, 0.052, -0.004],
    ];
  }
  function torsoSection(y, p) {
    const K = torsoKeys(p);
    if (y <= K[0][0]) return { rx: K[0][1], rz: K[0][2], cz: K[0][3] };
    for (let i = 0; i < K.length - 1; i++) {
      const a = K[i], b = K[i + 1];
      if (y <= b[0]) {
        let t = (y - a[0]) / (b[0] - a[0]);
        if (!(p.corsetShape === 'cone' && i === 1)) t = t * t * (3 - 2 * t);   // a cone corset is straight from waist to bust
        return { rx: lerp(a[1], b[1], t), rz: lerp(a[2], b[2], t), cz: lerp(a[3], b[3], t) };
      }
    }
    const L = K[K.length - 1]; return { rx: L[1], rz: L[2], cz: L[3] };
  }
  function torsoPoint(phi, y, p, off = 0) { const s = torsoSection(y, p); return [(s.rx + off) * Math.sin(phi), y, s.cz + (s.rz + off) * Math.cos(phi)]; }
  function necklineTop(phi, p) {
    const f = figure(p), c = Math.cos(phi), s = Math.abs(Math.sin(phi)), front = c > 0;
    const nw = p.neckWidth / 0.17, base = f.neckY - 0.012;
    switch (p.neckShape) {
      case 'high': return f.neckY + 0.01;
      case 'square': { const inside = 1 - smoothstep(nw - 0.05, nw + 0.05, s); return lerp(base, f.shoulderY - (front ? 0.03 + p.neckDepth : 0.03 + 0.3 * p.neckDepth), inside); }
      case 'offshoulder': return f.shoulderY - 0.035 - p.neckDepth * (front ? 0.6 : 0.4) * c * c;
      case 'v': { const inside = Math.max(0, 1 - s / Math.max(nw, 0.05)); return front ? lerp(base, f.shoulderY - 0.07 - p.neckDepth, inside) : base - 0.03 * inside; }
      default: { // sweetheart, strapless
        const b = f.bustY + 0.045;
        if (!front) return b - 0.01 * smoothstep(0, 0.4, -c);
        return b + 0.02 * Math.exp(-(((s - 0.35) / 0.2) ** 2)) - p.neckDepth * 0.4 * Math.exp(-((s / 0.08) ** 2));
      }
    }
  }
  function bodiceBottom(phi, p) { const c = Math.cos(phi); return figure(p).waistY - 0.012 - p.pointDepth * Math.max(0, c) ** 6 - 0.25 * p.pointDepth * Math.max(0, -c) ** 6; }
  function stomacherHalfWidth(y, p) {
    const yb = bodiceBottom(0, p), yt = necklineTop(0, p);
    if (p.stomacher < 0.01 || y < yb || y > yt + 0.001) return 0;
    return lerp(0.012, 0.012 + 0.085 * p.stomacher, (y - yb) / Math.max(0.01, yt - yb));
  }

  // -------- skirt silhouette
  function shelfInfo(p) { const shelf = Math.max(p.hipShelf, p.waist * 1.15); return { shelf, vs: lerp(0.2, 0.06, smoothstep(0.2, 0.4, shelf)), hem: Math.max(p.hemRadius, shelf) }; }
  function skirtProfile(v, p) {
    const { shelf, vs, hem } = shelfInfo(p);
    if (v <= vs) return lerp(p.waist, shelf, Math.sin((v / vs) * Math.PI / 2));
    const t = clamp((v - vs) / (1 - vs), 0, 1), k = 1 + 1.5 * Math.abs(p.curve);
    return lerp(shelf, hem, p.curve >= 0 ? 1 - Math.pow(1 - t, k) : Math.pow(t, k));
  }
  function bustleAdd(v, p) { return p.bustle * 0.32 * smoothstep(0, 0.1, v) * (1 - 0.6 * smoothstep(0.15, 1, v)); }
  function skirtRadius(v, th, p) {
    const R = skirtProfile(v, p), w = p.waist, { vs } = shelfInfo(p);
    const a = R + 0.1 * w + p.pannier * 0.3 * (1 - 0.35 * v) * smoothstep(0, Math.max(vs, 0.08), v);
    const bF = R - 0.1 * w, c = Math.cos(th), s = Math.sin(th);
    const b = c >= 0 ? bF : bF + bustleAdd(v, p);
    const n = 2 + 2 * Math.min(1, p.pannier);   // panniers square the cross-section off
    return Math.pow(Math.pow(Math.abs(s) / a, n) + Math.pow(Math.abs(c) / b, n), -1 / n);
  }
  const halfGap = (v, p) => Math.min(1.35, p.frontOpen * (0.3 + 0.7 * v));
  const foldAt = (v, th, p) => p.hemFullness * 0.035 * Math.pow(v, 1.5) * (0.5 + 0.5 * Math.sin(th * FOLDS));
  function trainAt(th, p) { const b = Math.max(0, -Math.cos(th)); return p.trainLength * b * b; }
  // v in [0, vf] hangs from the waist to the floor; (vf, 1] lies on the floor as train
  function skirtPoint(v, th, p) {
    const f = figure(p), T = trainAt(th, p), vf = f.D / (f.D + T);
    let r, y;
    if (v <= vf) { const vv = v / vf; r = skirtRadius(vv, th, p) + T * 0.12 * smoothstep(0.6, 1, vv); y = f.waistY - vv * f.D; }
    else { const s = (v - vf) / (1 - vf); r = skirtRadius(1, th, p) + T * (0.12 + 0.88 * s); y = HEM_Y; }
    return [r * Math.sin(th), y, r * Math.cos(th)];
  }
  function pushOutsideSkirt(q, p, gap) {
    const f = figure(p);
    if (q[1] >= f.waistY) return q;
    const v = clamp((f.waistY - q[1]) / f.D, 0, 1), r = Math.hypot(q[0], q[2]);
    if (r < 1e-9) return q;
    const need = skirtRadius(v, Math.atan2(q[0], q[2]), p) + gap;
    if (r < need) { const k = need / r; q[0] *= k; q[2] *= k; }
    return q;
  }
  // outer radius of everything the queen wears at height y (used to drape the mantle)
  function envelopeRadius(y, th, p) {
    const f = figure(p), s = Math.sin(th), c = Math.cos(th);
    if (y >= f.waistY) {
      const t = torsoSection(y, p);
      const r = 1 / Math.sqrt((s / t.rx) ** 2 + (c / t.rz) ** 2) + Math.max(0, t.cz * c);
      return r + (0.09 + 0.1 * p.shoulderPuff + 0.06 * p.upperFull) * s * s + 0.02;   // arms at the sides
    }
    const T = trainAt(th, p), fl = p.flounces > 0 ? 0.03 : 0;
    if (y <= HEM_Y + 0.03) return skirtRadius(1, th, p) + T + p.hemFullness * 0.035 + fl;
    const vv = clamp((f.waistY - y) / f.D, 0, 1);
    return skirtRadius(vv, th, p) + T * 0.12 * smoothstep(0.6, 1, vv) + p.hemFullness * 0.035 * Math.pow(vv, 1.5) + fl;
  }

  // -------- mesh builders (plain arrays, no three.js)
  function gridMesh(cols, rows, fn, groupFn) {
    const C = cols + 1, nv = C * (rows + 1);
    const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const k = j * C + i, q = fn(i / cols, j / rows);
      pos[3 * k] = q[0]; pos[3 * k + 1] = q[1]; pos[3 * k + 2] = q[2]; uv[2 * k] = q[3]; uv[2 * k + 1] = q[4];
    }
    const lists = [[], []];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = j * C + i, b = a + 1, c = a + C, d = c + 1;
      lists[groupFn ? groupFn(i, j) : 0].push(a, b, c, b, d, c);
    }
    const idx = new Uint32Array(lists[0].length + lists[1].length);
    idx.set(lists[0]); idx.set(lists[1], lists[0].length);
    const groups = [{ start: 0, count: lists[0].length, materialIndex: 0 }, { start: lists[0].length, count: lists[1].length, materialIndex: 1 }].filter(g => g.count > 0);
    return { pos, uv, idx, groups, cols, rows, seam: false };
  }
  function buildSkirtGrid(p, cols, rows, o = {}) {
    const v0 = o.v0 ?? 0, v1 = o.v1 ?? 1, gap = !!o.gap && p.frontOpen > 0.01;
    const q = o.noTrain ? Object.assign({}, p, { trainLength: 0 }) : p;
    const span = o.span || (v => (gap ? [halfGap(v, p), TAU - halfGap(v, p)] : [Math.PI, Math.PI + TAU]));
    const m = gridMesh(cols, rows, (s, t) => {
      const v = lerp(v0, v1, t), [a, b] = span(v), th = lerp(a, b, s), P = skirtPoint(v, th, q);
      const r = Math.max(Math.hypot(P[0], P[2]), 1e-6);
      let extra = (o.offset || 0) + (o.flare || 0) * t;
      if (o.folds !== false) extra += foldAt(v, th, p);
      if (o.ruffle) extra += 0.007 * t * (0.5 + 0.5 * Math.sin(th * 70));
      const k = (r * (o.inset ?? 1) + extra) / r;
      return [P[0] * k, P[1] + (o.lift || 0), P[2] * k, (th / TAU) * (o.uScale || 1), t];
    });
    if (!o.uvBand) {   // v texture coordinate = arc length down the column, in metres
      const C = cols + 1;
      for (let i = 0; i < C; i++) {
        let acc = 0;
        for (let j = 0; j <= rows; j++) {
          const k = j * C + i;
          if (j > 0) { const a = 3 * k, b = 3 * (k - C); acc += Math.hypot(m.pos[a] - m.pos[b], m.pos[a + 1] - m.pos[b + 1], m.pos[a + 2] - m.pos[b + 2]); }
          m.uv[2 * k + 1] = acc;
        }
      }
    }
    m.seam = !gap && !o.span;
    return m;
  }
  function buildTorsoBand(p, cols, rows, lowFn, highFn, off, groupFn, push) {
    const m = gridMesh(cols, rows, (s, t) => {
      const phi = Math.PI + s * TAU, y0 = lowFn(phi), y1 = Math.max(highFn(phi), y0 + 0.01), y = lerp(y0, y1, t);
      const q = torsoPoint(phi, y, p, off);
      if (push) pushOutsideSkirt(q, p, push);
      return [q[0], q[1], q[2], s, y];
    }, groupFn);
    m.seam = true;
    return m;
  }
  function buildBodiceGrid(p, cols = 96, rows = 36) {
    const off = 0.006;
    return buildTorsoBand(p, cols, rows, phi => bodiceBottom(phi, p), phi => necklineTop(phi, p), off, (i, j) => {
      const phi = Math.PI + ((i + 0.5) / cols) * TAU;
      if (Math.cos(phi) <= 0) return 0;
      const y0 = bodiceBottom(phi, p), y1 = Math.max(necklineTop(phi, p), y0 + 0.01), y = lerp(y0, y1, (j + 0.5) / rows);
      return Math.abs(torsoPoint(phi, y, p, off)[0]) < stomacherHalfWidth(y, p) ? 1 : 0;
    }, 0.004);
  }
  function buildRuffRing(p, layer) {
    const f = figure(p);
    const r0 = 0.06 + 0.01 * layer, r1 = r0 + (0.05 + 0.2 * p.ruff) * (1 + 0.15 * layer);
    const N = 2 * Math.round(26 + 22 * p.ruff), yc = f.neckY + 0.012 - 0.012 * layer;
    return gridMesh(N * 8, 6, (s, t) => {
      const ph = s * TAU;
      const rho = lerp(r0, r1, t) + 0.006 * t * Math.cos(N * ph);
      const amp = (0.006 + 0.026 * p.ruff) * (0.25 + 0.75 * t);
      const tilt = 0.18 * (rho - r0) * (1 - Math.cos(ph));   // the cartwheel rises at the back
      return [rho * Math.sin(ph), yc + amp * Math.sin(N * ph) + tilt, rho * Math.cos(ph) - 0.01, s * Math.round(N / 4), 1 - t * t];   // whole number of lace tiles, so the seam meets
    });
  }

  // -------- arms & sleeves
  function armPoints(p, side) {
    const f = figure(p);
    return [[0.158 * side, f.shoulderY - 0.045, -0.005], [0.195 * side, (f.shoulderY + f.waistY) / 2 + 0.02, -0.025],
      [0.205 * side, f.waistY + 0.04, -0.035], [0.1 * side, f.waistY + 0.02, 0.17], [0.075 * side, f.waistY + 0.015, 0.215]];
  }
  const armRadius = t => lerp(0.042, 0.026, Math.min(1, t / 0.9));
  function sleeveRadius(t, p) {
    const L = p.sleeveLength * 0.9;
    let r = armRadius(t) + 0.008;
    r += p.shoulderPuff * 0.085 * Math.exp(-(((t - 0.08) / 0.1) ** 2));
    r += p.upperFull * 0.055 * Math.exp(-(((t - 0.25) / 0.16) ** 2));
    r += p.cuffFlare * 0.13 * Math.pow(smoothstep(L - 0.32, L, t), 1.6);
    if (p.sleeveSlash > 0) r *= 1 + 0.16 * Math.sin((Math.PI * p.sleeveSlash * t) / L) ** 2;
    return r;
  }

  // -------- mantle of estate: s across (left edge → right edge round the back), t down then along the floor
  function mantleDims(p) { const f = figure(p), D = f.shoulderY - 0.04 - HEM_Y; return { D, tf: D / (D + 0.9 * p.mantle + 1e-6) }; }
  function mantleHalfSpan(t, p) { const { tf } = mantleDims(p); return lerp(1.05, lerp(1.35, 2.6, p.mantleWidth), smoothstep(0, 1, Math.min(1, t / tf))); }
  function mantlePoint(s, t, p) {
    const f = figure(p), { D, tf } = mantleDims(p), th = Math.PI + (2 * s - 1) * mantleHalfSpan(t, p), back = Math.max(0, -Math.cos(th));
    let y, r;
    if (t <= tf) { const u = t / tf; y = f.shoulderY - 0.02 - u * D; r = envelopeRadius(Math.max(y, HEM_Y + 0.031), th, p) + 0.015 + 0.02 * u; }
    else { const u = (t - tf) / (1 - tf); y = HEM_Y + 0.02; r = envelopeRadius(HEM_Y, th, p) + 0.04 + u * p.mantle * (0.35 + 0.65 * back); }
    return [r * Math.sin(th), y, r * Math.cos(th)];
  }

  // -------- underpinnings
  function underpinningsFor(p) {
    let kind;
    if (p.pannier > 0.3) kind = 'panniers';
    else if (p.hipShelf >= 0.3) kind = 'wheel';
    else if (p.bustle >= 0.15) kind = 'bustle';
    else if (p.curve >= 0.25 && p.hemRadius >= 0.5) kind = 'crinoline';
    else if (p.hemRadius >= 0.42) kind = 'cone';
    else kind = 'petticoat';
    const hoops = [], add = (n, v0, v1, part) => { for (let i = 0; i < n; i++) hoops.push({ v: n === 1 ? v0 : lerp(v0, v1, i / (n - 1)), part }); };
    if (kind === 'cone') add(5, 0.2, 0.95, 'full');
    if (kind === 'crinoline') add(9, 0.18, 0.97, 'full');
    if (kind === 'panniers') add(5, 0.08, 0.6, 'full');
    if (kind === 'wheel') add(1, shelfInfo(p).vs + 0.005, 0, 'full');
    if (kind === 'bustle') add(5, 0.04, 0.42, 'back');
    return { kind, hoops, corset: p.corsetShape, bumRoll: kind === 'wheel', tapes: { crinoline: 10, cone: 6, panniers: 4 }[kind] || 0, petticoat: kind === 'petticoat' };
  }
  function hoopPoints(h, p, n) {
    const f = figure(p), y = f.waistY - h.v * f.D, out = [];
    for (let k = 0; k < n; k++) {
      const th = h.part === 'back' ? lerp(Math.PI / 2, 1.5 * Math.PI, k / (n - 1)) : (k / n) * TAU;
      const r = skirtRadius(h.v, th, p) * 0.965;
      out.push([r * Math.sin(th), y, r * Math.cos(th)]);
    }
    return out;
  }

  // -------- swing spring (hem lag) and body poses
  function swingParams(p) { return { k: lerp(42, 7, p.swing), c: lerp(0.8, 7, p.damping), gain: 3 }; }
  function swingStep(s, inp, dt, p) {
    const { k, c, gain } = swingParams(p), n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    const lim = (x, v, m) => (Math.abs(s[x]) > m ? ((s[x] = Math.sign(s[x]) * m), (s[v] = 0)) : 0);
    for (let i = 0; i < n; i++) {
      s.yawV += (-k * s.yaw - c * s.yawV - inp.yawAcc) * h; s.yaw += s.yawV * h;
      s.oxV += (-k * s.ox - c * s.oxV - gain * inp.ax) * h; s.ox += s.oxV * h;
      s.ozV += (-k * s.oz - c * s.ozV - gain * inp.az) * h; s.oz += s.ozV * h;
      lim('yaw', 'yawV', 1); lim('ox', 'oxV', 0.35); lim('oz', 'ozV', 0.35);
    }
    return s;
  }
  function poseAt(mode, t, speed) {
    switch (mode) {
      case 'turntable': return { x: 0, z: 0, yaw: 0.3 * speed * t };
      case 'twirl': return { x: 0, z: 0, yaw: 1.25 * Math.sin(1.7 * speed * t) };
      case 'walk': {
        const R = 1.1, ph = ((0.42 * speed) / R) * t, yaw = ph + Math.PI / 2, sway = 0.015 * Math.sin(TAU * 0.9 * speed * t);
        return { x: R * Math.sin(ph) + sway * Math.cos(yaw), z: R * Math.cos(ph) - sway * Math.sin(yaw), yaw };
      }
      case 'idle': return { x: 0, z: 0, yaw: 0.06 * Math.sin(0.6 * t) };
      default: return { x: 0, z: 0, yaw: 0 };
    }
  }
  function galleryLayout(n) {
    const out = [];
    for (let i = 0; i < n; i++) { const a = lerp(-0.85, 0.85, n === 1 ? 0.5 : i / (n - 1)); out.push({ x: 7 * Math.sin(a), z: 2 - 7 * Math.cos(a), yaw: -a }); }
    return out;
  }

  return { HEM_Y, FOLDS, HEAD, figure, torsoSection, torsoPoint, necklineTop, bodiceBottom, stomacherHalfWidth,
    shelfInfo, skirtProfile, bustleAdd, skirtRadius, halfGap, foldAt, trainAt, skirtPoint, pushOutsideSkirt, envelopeRadius,
    gridMesh, buildSkirtGrid, buildTorsoBand, buildBodiceGrid, buildRuffRing, armPoints, armRadius, sleeveRadius,
    mantleDims, mantleHalfSpan, mantlePoint, underpinningsFor, hoopPoints, swingParams, swingStep, poseAt, galleryLayout };
})());
export { QC };
