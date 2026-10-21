// post.js: the final full-screen pass. Mixes two scene renders (A = outgoing, B = incoming), applies 4×4 ordered
// dithering (two colours, 17 levels) per side, a few glitch effects, and lays the lyric overlay on top undithered.
import * as THREE from 'three';

const VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tA, tB, tOver;
uniform vec2 res;
uniform float mixAB;          // 0 = all A, 1 = all B (ordered-dither dissolve between them)
uniform float ditherA, ditherB;  // 1 = dithered to two colours, 0 = full colour
uniform float cellA, cellB;      // dither cell size in output pixels
uniform vec3 gainA, gainB;       // x = exposure, y = contrast, z = gamma
uniform vec3 ink, paper;         // the two dither colours
uniform float invert, flash, glitch, seed, overOn;

// 4×4 Bayer matrix: thresholds (m + 0.5) / 16 give the 17 characteristic patterns.
float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)), i = y * 4 + x;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
float bayer8(vec2 p) {  // for the dissolve: recursive construction from the 4×4 one
  vec2 q = floor(mod(p, 8.0)), h = floor(q / 4.0);
  float c = bayer4(q) * 16.0 - 0.5;
  float k = h.y == 0.0 ? (h.x == 0.0 ? 0.0 : 2.0) : (h.x == 0.0 ? 3.0 : 1.0);
  return (c * 4.0 + k + 0.5) / 64.0;
}
float hash(float n) { return fract(sin(n * 127.1 + seed * 31.7) * 43758.5453); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 side(sampler2D t, vec2 frag, float dith, float cell, vec3 g) {
  if (dith < 0.5) {
    vec3 c = texture2D(t, frag / res).rgb;
    return c * g.x;
  }
  vec2 cc = floor(frag / cell);
  vec2 base = cc * cell;
  // average a few taps inside the cell so thin features survive the downsample
  vec3 s = vec3(0.0);
  s += texture2D(t, (base + vec2(0.25, 0.25) * cell) / res).rgb;
  s += texture2D(t, (base + vec2(0.75, 0.25) * cell) / res).rgb;
  s += texture2D(t, (base + vec2(0.25, 0.75) * cell) / res).rgb;
  s += texture2D(t, (base + vec2(0.75, 0.75) * cell) / res).rgb;
  float l = luma(s * 0.25) * g.x;
  l = pow(clamp(l, 0.0, 1.0), g.z);
  l = clamp((l - 0.5) * g.y + 0.5, 0.0, 1.0);
  return l > bayer4(cc) ? paper : ink;
}

void main() {
  vec2 frag = vUv * res;
  if (glitch > 0.0) {  // horizontal band tearing
    float band = floor(frag.y / 24.0);
    float r = hash(band);
    if (r < glitch) frag.x += (hash(band + 7.0) - 0.5) * 260.0 * glitch;
  }
  float cellMax = max(cellA, cellB);
  float d = bayer8(floor(frag / (cellMax * 2.0)));
  vec3 col = mixAB > d ? side(tB, frag, ditherB, cellB, gainB) : side(tA, frag, ditherA, cellA, gainA);
  if (invert > 0.5) col = ink + paper - col;
  col = mix(col, paper, flash);
  if (overOn > 0.5) {
    vec4 o = texture2D(tOver, vUv);
    col = mix(col, o.rgb, o.a);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  constructor(renderer, W, H, overlayCanvas) {
    this.renderer = renderer;
    this.over = new THREE.CanvasTexture(overlayCanvas);
    this.over.minFilter = this.over.magFilter = THREE.LinearFilter;
    this.over.colorSpace = THREE.NoColorSpace;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false,
      uniforms: {
        tA: { value: null }, tB: { value: null }, tOver: { value: this.over }, res: { value: new THREE.Vector2(W, H) },
        mixAB: { value: 0 }, ditherA: { value: 1 }, ditherB: { value: 1 }, cellA: { value: 3 }, cellB: { value: 3 },
        gainA: { value: new THREE.Vector3(1, 1, 1) }, gainB: { value: new THREE.Vector3(1, 1, 1) },
        ink: { value: new THREE.Color(0, 0, 0) }, paper: { value: new THREE.Color(1, 1, 1) },
        invert: { value: 0 }, flash: { value: 0 }, glitch: { value: 0 }, seed: { value: 0 }, overOn: { value: 1 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  render(u) {
    const U = this.mat.uniforms;
    for (const k in u) {
      if (U[k] === undefined) continue;
      if (U[k].value && U[k].value.set && Array.isArray(u[k])) U[k].value.set(...u[k]);
      else U[k].value = u[k];
    }
    this.over.needsUpdate = true;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
