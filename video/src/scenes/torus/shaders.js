// shaders.js: the raymarched faceted Amiga torus (24×12 segments, red/white checker, stuck shapes = SDF union,
// carves = SDF subtraction) from assets/3d-torus-shooter/index.html, plus the lit mesh shader for the flying shapes.
// Changes from the original: world-space camera/torus transforms, depth written from the real projection,
// bounding-sphere culling of stuck/carve shapes, carves swept along the projectile direction (they bore
// through the tube), a hollow "inside the tube" mode, headlight + fog, rim light, background gradient + grid.

export const MS = 40, MC = 40;

export const RM_VS = `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const RM_FS = `
precision highp float;
varying vec2 vNdc;
uniform vec3 uCamPos; uniform mat3 uCamRot; uniform float uTanFov, uAsp;
uniform mat3 uTR, uTRi; uniform vec3 uTP; uniform float uTS;   // torus local -> world: p_w = uTP + uTR * p * uTS
uniform mat4 uViewProj;
uniform float uShow, uInside;
uniform vec3 uColA, uColB, uCarveCol, uSpecCol, uRimCol, uFogCol;
uniform vec3 uBgTop, uBgBot, uGridCol; uniform float uGrid, uGridY;
uniform vec3 uLightL;                               // key light direction in torus-local space
uniform float uAmb, uDiff, uSpec, uRim, uFog, uHeadK, uHeadI, uStkEm, uFill, uChkSub;
uniform vec4 uStk[${MS}]; uniform vec4 uStkB[${MS}]; uniform vec3 uStkC[${MS}]; uniform int uNStk;   // xyz,type | size,flash
uniform vec4 uCrA[${MC}]; uniform vec4 uCrB[${MC}]; uniform vec2 uCrC[${MC}]; uniform mat3 uCrR[${MC}]; uniform int uNCrv;  // xyz,type | dir,size | s0,s1 | frame

const float NMAJ = 24.0, NMIN = 12.0;
const float SMAJ = 6.2831853 / NMAJ, SMIN = 6.2831853 / NMIN;
float sdTorus(vec3 p) {
  float theta = atan(p.y, p.x);
  float tSnap = floor(theta / SMAJ + .5) * SMAJ;
  vec2 c = vec2(cos(tSnap), sin(tSnap));
  float qx = dot(p.xy - c, c);
  float qy = p.z;
  float phi = atan(qy, qx);
  float pa = mod(phi + SMIN * .5, SMIN) - SMIN * .5;
  float dist = length(vec2(qx, qy));
  return dist * cos(pa) - 0.4 * cos(SMIN * .5);
}
float sdBox(vec3 p, vec3 b) { vec3 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0); }
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdCylinder(vec3 p, float r, float h) { vec2 d = vec2(length(p.xz) - r, abs(p.y) - h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float sdTetrahedron(vec3 p, float r) { return (max(max(p.x + p.y - p.z, p.x - p.y + p.z), max(-p.x + p.y + p.z, -p.x - p.y - p.z)) / 1.7321 - r); }
float sdDodecahedron(vec3 p, float r) {
  vec3 n1 = vec3(0, .5257, .8507), n2 = vec3(0, .5257, -.8507), n3 = vec3(.5257, .8507, 0), n4 = vec3(.5257, -.8507, 0), n5 = vec3(.8507, 0, .5257), n6 = vec3(.8507, 0, -.5257);
  float d = max(max(max(abs(dot(p, n1)), abs(dot(p, n2))), max(abs(dot(p, n3)), abs(dot(p, n4)))), max(abs(dot(p, n5)), abs(dot(p, n6))));
  return d - r;
}
float sdIcosahedron(vec3 p, float r) {
  float G = 1.618, IP = .618, sq3 = .5774;
  float d = abs(dot(p, vec3(sq3, sq3, sq3)));
  d = max(d, abs(dot(p, vec3(sq3, sq3, -sq3))));
  d = max(d, abs(dot(p, vec3(sq3, -sq3, sq3))));
  d = max(d, abs(dot(p, vec3(sq3, -sq3, -sq3))));
  d = max(d, abs(IP * p.y + G * p.z));
  d = max(d, abs(IP * p.y - G * p.z));
  d = max(d, abs(IP * p.x + G * p.z));
  d = max(d, abs(IP * p.x - G * p.z));
  d = max(d, abs(IP * p.z + G * p.x));
  d = max(d, abs(IP * p.z - G * p.x));
  return d / G - r;
}
float shapeSDF(vec3 p, float type, float sz) {
  if (type < 0.5) return sdBox(p, vec3(sz));
  if (type < 1.5) return sdCylinder(p, sz, sz);
  if (type < 2.5) return sdDodecahedron(p, sz);
  if (type < 3.5) return sdSphere(p, sz);
  if (type < 4.5) return sdTetrahedron(p, sz);
  if (type < 5.5) return min(sdTetrahedron(p, sz), sdTetrahedron(-p, sz));
  if (type < 6.5) return min(min(sdBox(p, vec3(sz, sz * .35, sz * .35)), sdBox(p, vec3(sz * .35, sz, sz * .35))), sdBox(p, vec3(sz * .35, sz * .35, sz)));
  if (type < 7.5) return max(-sdIcosahedron(p, sz * .55), sdSphere(p, sz));
  if (type < 8.5) return max(sdDodecahedron(p, sz * .9), sdIcosahedron(p, sz * .8));
  return sdIcosahedron(p, sz * .7);
}
float carveD(int i, vec3 p) {
  vec3 q = p - uCrA[i].xyz;
  vec3 dir = uCrB[i].xyz;
  q -= dir * clamp(dot(q, dir), uCrC[i].x, uCrC[i].y);
  return shapeSDF(uCrR[i] * q, uCrA[i].w, uCrB[i].w);
}
float mapD(vec3 p) {
  float d = sdTorus(p);
  if (uInside > 0.5) d = -d;
  for (int i = 0; i < ${MS}; i++) {
    if (i >= uNStk) break;
    vec3 q = p - uStk[i].xyz; float sz = uStkB[i].x;
    if (length(q) - 3.2 * sz < d) d = min(d, shapeSDF(q, uStk[i].w, sz));
  }
  for (int i = 0; i < ${MC}; i++) {
    if (i >= uNCrv) break;
    vec3 q = p - uCrA[i].xyz; vec3 dir = uCrB[i].xyz;
    q -= dir * clamp(dot(q, dir), uCrC[i].x, uCrC[i].y);
    if (length(q) - 3.2 * uCrB[i].w < -d) d = max(d, -shapeSDF(uCrR[i] * q, uCrA[i].w, uCrB[i].w));
  }
  return d;
}
vec3 background(vec3 ro, vec3 rd) {
  float k = rd.y * 0.5 + 0.5;
  vec3 c = mix(uBgBot, uBgTop, smoothstep(0.25, 0.85, k));
  float tt = (uGridY - ro.y) / min(rd.y, -1e-4);
  vec2 xz = (ro + rd * tt).xz * 0.5;
  vec2 fw = fwidth(xz);
  vec2 g = abs(fract(xz - 0.5) - 0.5) / max(fw, 1e-4);
  float line = 1.0 - min(min(g.x, g.y) / 1.2, 1.0);
  float fade = exp(-tt * 0.05) * smoothstep(0.0, -0.06, rd.y);
  if (rd.y < 0.0) c = mix(c, uGridCol, line * uGrid * fade);
  return c;
}
void main() {
  vec3 rd = normalize(uCamRot * vec3(vNdc.x * uAsp * uTanFov, vNdc.y * uTanFov, -1.0));
  vec3 col = background(uCamPos, rd);
  float depth = 1.0;
  if (uShow > 0.5) {
    vec3 lro = uTRi * (uCamPos - uTP) / uTS, lrd = uTRi * rd;
    float tN = 0.0, tF = 6.0;
    bool go = true;
    if (uInside < 0.5) {
      float b = dot(lro, lrd), c = dot(lro, lro) - 4.0, disc = b * b - c;
      if (disc < 0.0) go = false;
      else { float sq = sqrt(disc); tN = max(-b - sq, 0.0); tF = -b + sq; if (tF < 0.0) go = false; }
      // the torus is flat (|z| < 0.4 plus stuck shapes): skip to the slab
    }
    if (go) {
      float t = tN, d = 1.0;
      for (int i = 0; i < 140; i++) {
        d = mapD(lro + lrd * t);
        if (d < .0006 * (1.0 + t) || t > tF) break;
        t += d * 0.8;
      }
      if (d < .02 && t <= tF) {
        vec3 p = lro + lrd * t;
        vec2 e = vec2(.001, 0);
        vec3 n = normalize(vec3(mapD(p + e.xyy) - mapD(p - e.xyy), mapD(p + e.yxy) - mapD(p - e.yxy), mapD(p + e.yyx) - mapD(p - e.yyx)));
        float td = sdTorus(p); if (uInside > 0.5) td = -td;
        float sd = 999.0; vec3 sc = vec3(0.0); float sf = 0.0;
        for (int i = 0; i < ${MS}; i++) {
          if (i >= uNStk) break;
          vec3 q = p - uStk[i].xyz; if (length(q) - 3.2 * uStkB[i].x > sd) continue;
          float s = shapeSDF(q, uStk[i].w, uStkB[i].x);
          if (s < sd) { sd = s; sc = uStkC[i]; sf = uStkB[i].y; }
        }
        float cd = 999.0;
        for (int i = 0; i < ${MC}; i++) { if (i >= uNCrv) break; cd = min(cd, carveD(i, p)); }
        vec3 base; float em = 0.0;
        if (cd < .01) base = uCarveCol;
        else if (sd < td) { base = mix(sc, vec3(1.0), sf); em = uStkEm; }
        else {
          float th = atan(p.y, p.x);
          float majSeg = floor(th / SMAJ + .5);
          float tS = majSeg * SMAJ;
          vec2 cc = vec2(cos(tS), sin(tS));
          float qx = dot(p.xy - cc, cc), qy = p.z;
          float ph = atan(qy, qx);
          float minSeg = floor(ph / SMIN + .5);
          if (uChkSub > 1.5) {   // finer checks (tunnel): split each facet into 2×2
            majSeg = floor(th / SMAJ * 2.0 + 1.0); minSeg = floor(ph / SMIN * 2.0 + 1.0);
          }
          float ck = mod(majSeg + minSeg, 2.0);
          base = mix(uColA, uColB, ck);
        }
        vec3 V = normalize(lro - p);
        vec3 L = uLightL; float att = 1.0;
        float distW = t * uTS;
        if (uInside > 0.5) { L = V; att = uHeadI / (1.0 + uHeadK * distW * distW); }
        vec3 R = reflect(-L, n);
        float diff = max(dot(n, L), 0.0), spec = pow(max(dot(V, R), 0.0), 32.0);
        if (uInside > 0.5) diff = 0.5 + 0.5 * diff;   // wrapped headlight: walls seen edge-on stay lit, distance does the shading
        float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        col = base * (uAmb + em + uDiff * diff + uFill * max(dot(n, V), 0.0)) * att + uSpecCol * uSpec * spec * att + uRimCol * uRim * rim;
        col = mix(col, uFogCol, 1.0 - exp(-uFog * distW));
        vec4 clip = uViewProj * vec4(uTP + uTR * (p * uTS), 1.0);
        depth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
      }
    }
  }
  gl_FragColor = vec4(col, 1.0);
  gl_FragDepth = depth;
}`;

export const MESH_VS = `
attribute float iCheck;
uniform vec3 uTint;
varying vec3 vN, vW, vL, vCol; varying float vChk;
void main() {
  vec4 lp = vec4(position, 1.0); vec3 nn = normal;
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp; nn = mat3(instanceMatrix) * nn;
#endif
  vec4 wp = modelMatrix * lp;
  vW = wp.xyz; vN = mat3(modelMatrix) * nn; vL = position;
  vCol = uTint;
#ifdef USE_INSTANCING_COLOR
  vCol *= instanceColor;
#endif
  vChk = iCheck;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const MESH_FS = `
precision highp float;
uniform vec3 uLight, uSpecCol, uRimCol, uFogCol, uCamPos, uChkA, uChkB;
uniform float uAmb, uDiff, uSpec, uRim, uFog, uHead, uHeadK, uHeadI, uFlat, uFill;
varying vec3 vN, vW, vL, vCol; varying float vChk;
void main() {
  vec3 dv = uCamPos - vW; float dist = length(dv);
  vec3 V = dv / dist;
  vec3 n = normalize(vN); if (dot(n, V) < 0.0) n = -n;   // (the original flips by gl_FrontFacing; some generators wind CW)
  vec3 L = uLight; float att = 1.0;
  if (uHead > 0.5) { L = normalize(V + vec3(0.0, 0.15, 0.0)); att = uHeadI / (1.0 + uHeadK * dist * dist); }
  vec3 base = vCol;
  if (vChk > 0.5) {   // Boing-ball checker in object space
    vec3 q = normalize(vL);
    float a = atan(q.z, q.x), b = acos(clamp(q.y, -1.0, 1.0));
    float c = mod(floor(a / 6.2831853 * 12.0 + 12.0) + floor(b / 3.14159265 * 6.0), 2.0);
    base = mix(uChkA, uChkB, c) * vCol;
  }
  vec3 R = reflect(-L, n);
  float diff = max(dot(n, L), 0.0), spec = pow(max(dot(V, R), 0.0), 32.0);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  vec3 col = base * (uAmb + uDiff * diff + uFill * max(dot(n, V), 0.0)) * att + uSpecCol * uSpec * spec * att + uRimCol * uRim * rim;
  col = mix(col, base, uFlat);
  col = mix(col, uFogCol, 1.0 - exp(-uFog * dist));
  gl_FragColor = vec4(col, 1.0);
}`;
