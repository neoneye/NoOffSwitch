// shader.js: the ray tracer from assets/3d-birefringent-crystal/index.html (ordinary + extraordinary rays, stacked crystals),
// ported nearly verbatim. Additions for the video: a spotlight pool on the paper (uSpot*), a darker room (uEnvDim).
export const VS = `#version 300 es
in vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;
uniform vec2 uRes;
uniform vec3 uCamPos, uCamF, uCamR, uCamU;
uniform float uTanHalf;
uniform vec3 uPN[12];   // crystal 1 planes 0..5, crystal 2 planes 6..11 (0 bottom, 1 top, 2..5 sides)
uniform float uPD[12];
uniform vec3 uAxis[2];
uniform vec3 uNo, uNe;
uniform int uDisp, uShow, uCode, uPol, uSamples, uStack, uPlate;
uniform vec2 uPlateCS;
uniform vec3 uPolAxis;
uniform sampler2D uPaper;
uniform vec2 uPaperC, uPaperHalf, uPaperRot;
uniform float uTexPxPerMm;
uniform vec2 uFoot[8];
uniform vec2 uShadowOff;
uniform float uFrost, uAmber, uRefl, uLight;
uniform vec3 uTable;
uniform vec2 uSpotC;
uniform float uSpotR, uSpotAmb, uEnvDim, uVig;

float gLod = 0.0;

vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }

float sdFoot(vec2 p, int o){
  float d = dot(p - uFoot[o], p - uFoot[o]);
  float s = 1.0;
  for (int i0 = 0; i0 < 4; i0++) {
    int i = o + i0, j = o + (i0 + 3) % 4;
    vec2 e = uFoot[j] - uFoot[i], w = p - uFoot[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= uFoot[i].y, p.y < uFoot[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}

vec3 env(vec3 d){
  float up = d.z;
  vec3 c = uEnvDim * mix(vec3(0.22, 0.23, 0.25), vec3(0.50, 0.52, 0.56), smoothstep(-0.2, 0.9, up));
  vec3 L1 = normalize(vec3(-0.45, 0.40, 0.80));
  vec3 L2 = normalize(vec3(0.60, -0.45, 0.66));
  c += vec3(4.0) * smoothstep(0.970, 0.985, dot(d, L1));
  c += vec3(2.2, 2.3, 2.5) * smoothstep(0.982, 0.992, dot(d, L2));
  // a long window strip low on one side
  float strip = smoothstep(0.06, 0.0, abs(d.z - 0.25)) * smoothstep(0.2, 0.5, d.x);
  c += vec3(0.9) * strip;
  return c * uLight;
}

vec3 paperAt(vec2 xy){
  vec2 q = xy - uPaperC;
  q = vec2(uPaperRot.x * q.x + uPaperRot.y * q.y, -uPaperRot.y * q.x + uPaperRot.x * q.y);
  vec2 uv = q / (2.0 * uPaperHalf) + 0.5;
  vec3 c;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) c = toLin(uTable);
  else c = toLin(textureLod(uPaper, vec2(uv.x, 1.0 - uv.y), gLod).rgb);
  float sd = sdFoot(xy - uShadowOff, 0);
  if (uStack == 1) sd = min(sd, sdFoot(xy - uShadowOff, 4));
  c *= 1.0 - 0.22 * exp(-max(sd, 0.0) / 6.0);
  vec2 sq = (xy - uSpotC) / uSpotR;
  c *= mix(uSpotAmb, 1.0, exp(-dot(sq, sq)));
  return c * 0.92 * uLight;
}

float bil(vec3 u, vec3 v, vec3 a, float ne, float dl){ return dot(u, v) / (ne * ne) + dot(u, a) * dot(v, a) * dl; }

bool insideK(vec3 kt, vec3 m, int mode, vec3 a, float no, float ne, out vec3 k){
  k = vec3(0.0);
  if (mode == 0) {
    float q2 = no * no - dot(kt, kt);
    if (q2 < 0.0) return false;
    k = kt + m * sqrt(q2);
    return true;
  }
  float dl = 1.0 / (no * no) - 1.0 / (ne * ne);
  float A = bil(m, m, a, ne, dl), B = bil(kt, m, a, ne, dl), C = bil(kt, kt, a, ne, dl) - 1.0;
  float disc = B * B - A * C;
  if (disc < 0.0) return false;
  k = kt + m * ((-B + sqrt(disc)) / A);
  return true;
}

vec3 rayDir(vec3 k, int mode, vec3 a, float no, float ne){
  if (mode == 0) return normalize(k);
  float dl = 1.0 / (no * no) - 1.0 / (ne * ne);
  return normalize(k / (ne * ne) + a * (dot(k, a) * dl));
}

// Polarization (E-field direction) of a mode, as BF.polarization.
vec3 polVec(vec3 k, int mode, vec3 a){
  vec3 o = cross(k, a);
  if (dot(o, o) < 1e-12) o = cross(k, abs(k.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0));
  o = normalize(o);
  return mode == 0 ? o : normalize(cross(k, o));
}

float schlick(float c, float n){
  float r0 = (n - 1.0) / (n + 1.0); r0 *= r0;
  return r0 + (1.0 - r0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0);
}

// Ray vs crystal ci (convex polyhedron): entry distance and face, as BF.intersect.
bool hitCrystal(int ci, vec3 ro, vec3 rd, out float tHit, out int face){
  int o6 = ci * 6;
  float tN = -1e9, tF = 1e9;
  face = -1; tHit = 0.0;
  for (int i = 0; i < 6; i++) {
    float den = dot(uPN[o6 + i], rd), num = uPD[o6 + i] - dot(uPN[o6 + i], ro);
    if (abs(den) < 1e-9) { if (num < 0.0) return false; continue; }
    float t = num / den;
    if (den < 0.0) { if (t > tN) { tN = t; face = i; } } else tF = min(tF, t);
  }
  tHit = tN;
  return tN < tF && tN > 0.0;
}

// Backwards trace of one polarization mode inside crystal ci, as BF.traceMode. p: entry point, d: air ray,
// face: entry face. Returns 1 if the ray leaves into the air at q along od: the colour is then
// (whatever lies along od) * thr + col. Returns 0 when col is already final (paper under crystal 1, or lost).
// k0/k: first and last wave vector inside.
int traceIn(int ci, vec3 p, vec3 d, int face, int mode, float no, float ne,
            out vec3 k0, out vec3 k, out vec3 q, out vec3 od, out vec3 thr, out vec3 col){
  vec3 a = uAxis[ci];
  int o6 = ci * 6;
  vec3 N = uPN[o6 + face];
  k = vec3(0.0, 0.0, -1.0); k0 = k; q = p; od = d; thr = vec3(0.0); col = vec3(0.0);
  if (!insideK(d - N * dot(d, N), -N, mode, a, no, ne, k)) return 0;
  k0 = k;
  float path = 0.0, T = 0.0;
  float frost = face >= 2 ? uFrost : 0.0;
  int status = 0;
  col = vec3(0.03);
  for (int b = 0; b < 7; b++) {
    vec3 s = rayDir(k, mode, a, no, ne);
    float best = 1e9; int ef = -1;
    for (int i = 0; i < 6; i++) {
      float den = dot(uPN[o6 + i], s);
      if (den > 1e-6) {
        float t = (uPD[o6 + i] - dot(uPN[o6 + i], p)) / den;
        if (t < best) { best = t; ef = i; }
      }
    }
    if (ef < 0) break;
    p += s * best; path += best;
    if (ef == 0 && ci == 0) { col = paperAt(p.xy); break; }
    N = uPN[o6 + ef];
    vec3 kt = k - N * dot(k, N);
    float q2 = 1.0 - dot(kt, kt);
    if (q2 >= 0.0) {
      od = kt + N * sqrt(q2); q = p;
      T = 1.0 - schlick(sqrt(q2), length(k));
      if (ef >= 2) frost = max(frost, uFrost);
      status = 1;
      break;
    }
    vec3 k2;
    if (!insideK(kt, -N, mode, a, no, ne, k2)) break;
    k = k2;
  }
  vec3 att = exp(-uAmber * path * vec3(0.0008, 0.0035, 0.0110));
  float f = frost * 0.75;
  if (status == 1) { thr = att * T * (1.0 - f); col = vec3(0.62) * uLight * f * att; }
  else col = mix(col, vec3(0.62) * uLight, f) * att;
  return status;
}

// What the air ray from q along od sees when it meets no other crystal.
vec3 airCol(vec3 q, vec3 od){ return od.z < -1e-4 ? paperAt((q + od * (-q.z / od.z)).xy) : env(od); }

vec3 perpTo(vec3 v, vec3 d){ vec3 u = v - d * dot(v, d); float l = dot(u, u); return l > 1e-18 ? u / sqrt(l) : vec3(0.0); }

// Malus's law across the gap (with the optional plate), as BF.linkWeight.
float linkWeight(vec3 pol, vec3 k, vec3 a, int m, vec3 d){
  vec3 p = perpTo(pol, d);
  if (uPlate == 1) { vec3 f = vec3(uPlateCS, 0.0); p = 2.0 * dot(p, f) * f - p + vec3(0.0, 0.0, 2.0 * p.z); }
  else if (uPlate == 2) p = vec3(uPlateCS.x * p.x - uPlateCS.y * p.y, uPlateCS.y * p.x + uPlateCS.x * p.y, p.z);
  p = perpTo(p, d);
  vec3 qo = perpTo(polVec(k, 0, a), d);
  if (dot(p, p) < 0.5 || dot(qo, qo) < 0.5) return 0.5;
  float wo = dot(p, qo) * dot(p, qo);
  return m == 0 ? wo : 1.0 - wo;
}

// Colour-coding: one crystal o red, e blue. Two crystals by (mode in crystal 1, mode in crystal 2):
// o-o red, e-e blue, o-e amber, e-o green.
vec3 codeTint(int m1, int m2){
  if (m1 == 0 && m2 == 0) return vec3(0.90, 0.10, 0.05);
  if (m1 == 1 && m2 == 1) return vec3(0.05, 0.30, 0.95);
  return m1 == 0 ? vec3(0.95, 0.62, 0.02) : vec3(0.08, 0.72, 0.20);
}
vec3 coded(vec3 c, int m1, int m2){
  if (uCode != 1) return c;
  float L = dot(c, vec3(0.3, 0.6, 0.1)) / uLight;
  return mix(codeTint(m1, m2) * 0.8 * uLight, c, smoothstep(0.08, 0.45, L));
}

vec3 shade(vec2 pix){
  vec2 ndc = pix / uRes * 2.0 - 1.0;
  vec3 rd = normalize(uCamF + ndc.x * uTanHalf * (uRes.x / uRes.y) * uCamR + ndc.y * uTanHalf * uCamU);
  vec3 ro = uCamPos;
  float pixAng = 2.0 * uTanHalf / uRes.y;
  float tN; int face, ci = 0;
  bool hit = hitCrystal(0, ro, rd, tN, face);
  if (uStack == 1) {
    float t2; int f2;
    if (hitCrystal(1, ro, rd, t2, f2) && (!hit || t2 < tN)) { hit = true; tN = t2; face = f2; ci = 1; }
  }
  if (!hit) {
    if (rd.z < 0.0) {
      float t = -ro.z / rd.z;
      gLod = log2(max(t * pixAng * uTexPxPerMm / sqrt(max(-rd.z, 0.05)), 1.0));
      return paperAt((ro + rd * t).xy);
    }
    return env(rd);
  }
  int cj = 1 - ci;
  vec3 p = ro + rd * tN;
  vec3 N = uPN[ci * 6 + face];
  gLod = log2(max(tN * 1.2 * pixAng * uTexPxPerMm, 1.0));
  float R = schlick(-dot(rd, N), 0.5 * (uNo.y + uNe.y));
  vec3 P = normalize(uPolAxis - rd * dot(uPolAxis, rd));
  vec3 sum = vec3(0.0);
  int nch = uDisp == 1 ? 3 : 1;
  for (int ch = 0; ch < 3; ch++) {
    if (ch >= nch) break;
    int chi = uDisp == 1 ? ch : 1;
    float no = uNo[chi], ne = uNe[chi];
    for (int mode = 0; mode < 2; mode++) {
      if ((uShow == 1 && mode == 1) || (uShow == 2 && mode == 0)) continue;
      vec3 k0, kL, q, od, thr, col;
      int st = traceIn(ci, p, rd, face, mode, no, ne, k0, kL, q, od, thr, col);
      // brightness share at the eye: 1/2 per mode (unpolarized paper), or Malus through the polarizer
      vec3 pol = polVec(k0, mode, uAxis[ci]);
      float w = 0.5;
      if (uPol == 1) {
        vec3 pp = pol - rd * dot(pol, rd);
        float l2 = dot(pp, pp);
        w = l2 > 1e-8 ? dot(pp, P) * dot(pp, P) / l2 : 0.5;
      }
      vec3 c = vec3(0.0);
      float t2; int f2;
      vec3 ro2 = q - od * 1e-3;
      if (st == 1 && uStack == 1 && hitCrystal(cj, ro2, od, t2, f2)) {
        // into the other crystal: split again, each part weighted by Malus's law across the gap
        vec3 p2 = ro2 + od * t2;
        for (int m2 = 0; m2 < 2; m2++) {
          vec3 k0b, kLb, qb, odb, thrb, colb;
          int stb = traceIn(cj, p2, od, f2, m2, no, ne, k0b, kLb, qb, odb, thrb, colb);
          vec3 cb = stb == 1 ? airCol(qb, odb) * thrb + colb : colb;
          float wl = linkWeight(polVec(k0b, m2, uAxis[cj]), kL, uAxis[ci], mode, od);
          c += coded(cb * thr + col, ci == 0 ? mode : m2, ci == 0 ? m2 : mode) * wl;
        }
      } else {
        c = coded(st == 1 ? airCol(q, od) * thr + col : col, mode, mode);
      }
      if (uShow != 0 && uPol == 0) w = 1.0;
      if (uDisp == 1) sum[ch] += c[ch] * w; else sum += c * w;
    }
  }
  return sum * (1.0 - R) + env(reflect(rd, N)) * R * uRefl;
}

void main(){
  vec3 acc = vec3(0.0);
  int n = uSamples;
  for (int sy = 0; sy < 2; sy++) for (int sx = 0; sx < 2; sx++) {
    if (sy * 2 + sx >= n) continue;
    vec2 off = n == 1 ? vec2(0.5) : vec2(0.25 + 0.5 * float(sx), 0.25 + 0.5 * float(sy));
    acc += shade(floor(gl_FragCoord.xy) + off);
  }
  vec3 c = acc / float(n);
  vec2 vq = gl_FragCoord.xy / uRes - 0.5;
  c *= 1.0 - uVig * dot(vq, vq) * 2.2;
  c = mix(c, 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2)), step(0.8, c));
  fragColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);
}`;
