// GLSL for the film stage. Colours are linear HDR; grading happens in post.ts.

const LIGHT = /* glsl */ `
uniform vec3 uCam;
uniform vec3 uKeyDir;
uniform vec3 uKeyCol;
uniform vec3 uRimDir;
uniform vec3 uRimCol;
uniform vec3 uSky;
uniform vec3 uGround;
uniform float uTime;
uniform vec3 uFog;
uniform vec2 uFogRange;

vec3 env(vec3 r) {
  vec3 c = mix(uGround, uSky, smoothstep(-0.35, 0.75, r.y));
  float strip = smoothstep(0.48, 0.56, r.y) * (1.0 - smoothstep(0.78, 0.9, r.y));
  c += vec3(1.0, 0.96, 0.9) * 1.35 * strip * smoothstep(1.0, 0.15, abs(r.x));
  c += uKeyCol * 2.2 * pow(max(dot(r, uKeyDir), 0.0), 28.0);
  c += uRimCol * 1.4 * pow(max(dot(r, uRimDir), 0.0), 10.0);
  return c;
}

vec3 surface(vec3 base, float rough, float metal, vec3 N, vec3 V, float ao) {
  vec3 L = uKeyDir;
  vec3 H = normalize(L + V);
  float NdL = max(dot(N, L), 0.0), NdV = max(dot(N, V), 1e-3), NdH = max(dot(N, H), 0.0), VdH = max(dot(V, H), 0.0);
  float a = max(rough * rough, 0.002), a2 = a * a;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * dd * dd);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  vec3 F0 = mix(vec3(0.04), base, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdH, 5.0);
  vec3 spec = D * G * F / max(4.0 * NdL * NdV, 1e-3);
  vec3 kd = (1.0 - F) * (1.0 - metal);
  vec3 col = (kd * base / 3.14159 + spec) * uKeyCol * NdL * 3.0;
  float rim = pow(1.0 - NdV, 2.5) * (0.3 + 0.7 * max(dot(N, uRimDir), 0.0));
  col += uRimCol * rim;
  col += kd * base * mix(uGround, uSky, N.y * 0.5 + 0.5) * ao;
  vec3 Fr = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NdV, 5.0);
  col += env(reflect(-V, N)) * Fr * ao * (1.0 - rough * 0.65);
  return col;
}

vec3 fog(vec3 col, vec3 p) {
  return mix(col, uFog, smoothstep(uFogRange.x, uFogRange.y, length(uCam - p)));
}
`;

// value noise shared by the ring dissolve and the particles that replace it
const NOISE = /* glsl */ `
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1, 0, 0)), n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1)), n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float dissolveNoise(vec3 q) { return 0.62 * vnoise(q * 4.2 + 3.1) + 0.38 * vnoise(q * 9.7 - 1.7); }
`;

// «плёнка»: oil-slick thin-film interference, 2·n·d·cosθt path difference with a π shift at the top interface
const FILM = /* glsl */ `
vec3 thinFilm(float cosI, float d) {
  const float n = 1.46;
  float sinT2 = (1.0 - cosI * cosI) / (n * n);
  float opd = 2.0 * n * d * sqrt(max(0.0, 1.0 - sinT2));
  vec3 f = 0.5 - 0.5 * cos(6.2831853 * opd / vec3(650.0, 540.0, 460.0));
  return mix(vec3(dot(f, vec3(0.3333))), f, 0.95);
}
`;

export const RECT_VS = /* glsl */ `#version 300 es
uniform vec4 uRect;
out vec2 vNdc;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vNdc = mix(uRect.xy, uRect.zw, c);
  gl_Position = vec4(vNdc, 0.0, 1.0);
}`;

/** Ring + index dot as signed distance fields: exact logo knockout, rounded tail while drawing, dissolve to a shell. */
export const RING_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvViewProj;
uniform mat4 uViewProj;
uniform mat4 uRingInv;
uniform float uRingScale;
uniform float uRingOn;
uniform float uA0;
uniform float uA1;
uniform vec3 uDot;
uniform mat3 uDotBasis;
uniform vec3 uDotRadii;
uniform float uDotOn;
uniform float uKnock;
uniform float uDissolve;
uniform vec3 uPaper;
uniform vec3 uSignal;
uniform vec3 uGold;
uniform float uDotGlow;
uniform float uDotGold;
out vec4 o;
${LIGHT}
${NOISE}
${FILM}
const float R = 0.62;
const float TUBE = 0.1327;

float sdArc(vec3 q) {
  vec2 cs = vec2(length(q.xy) - R, q.z);
  float span = uA1 - uA0;
  if (span >= 6.2831) return length(cs) - TUBE;
  float rel = mod(atan(q.x, q.y) - uA0, 6.2831853);
  if (rel <= span) return length(cs) - TUBE;
  vec3 e0 = vec3(sin(uA0), cos(uA0), 0.0) * R;
  vec3 e1 = vec3(sin(uA1), cos(uA1), 0.0) * R;
  return min(length(q - e0), length(q - e1)) - TUBE;
}
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}
float ringD(vec3 p) {
  if (uRingOn < 0.5) return 1e5;
  vec3 q = (uRingInv * vec4(p, 1.0)).xyz;
  float d = sdArc(q) * uRingScale;
  if (uDissolve > -0.15) d = abs(d) - 0.0035 * uRingScale;
  if (uDotOn > 0.5) d = max(d, uKnock - length(p - uDot));
  return d;
}
float dotD(vec3 p) {
  if (uDotOn < 0.5) return 1e5;
  return sdEllipsoid(transpose(uDotBasis) * (p - uDot), uDotRadii);
}
vec2 map(vec3 p) {
  float a = ringD(p), b = dotD(p);
  return a < b ? vec2(a, 0.0) : vec2(b, 1.0);
}
vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  float h = 0.0007;
  return normalize(k.xyy * map(p + k.xyy * h).x + k.yyx * map(p + k.yyx * h).x + k.yxy * map(p + k.yxy * h).x + k.xxx * map(p + k.xxx * h).x);
}
void main() {
  vec4 a = uInvViewProj * vec4(vNdc, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 ro = a.xyz / a.w;
  vec3 far = b.xyz / b.w;
  vec3 rd = normalize(far - ro);
  float tMax = min(length(far - ro), 60.0);
  float t = 0.0;
  bool hit = false;
  float mat = 0.0;
  float inner = 0.0;
  float edge = 0.0;
  int passes = 0;
  vec3 p = ro;
  for (int i = 0; i < 110; i++) {
    p = ro + rd * t;
    vec2 m = map(p);
    if (m.x < 0.0005 * (1.0 + t)) {
      if (m.y < 0.5 && uDissolve > -0.15) {
        vec3 q = (uRingInv * vec4(p, 1.0)).xyz;
        float n = dissolveNoise(q);
        if (n < uDissolve) {
          // step clear of the thin shell (0.007·scale thick); a dissolved point is never accepted as a hit
          if (passes >= 6) break;
          passes++;
          t += 0.025 * uRingScale;
          continue;
        }
        edge = 1.0 - smoothstep(0.0, 0.07, n - uDissolve);
      }
      hit = true;
      mat = m.y;
      break;
    }
    t += max(m.x * 0.9, 0.0004);
    if (t > tMax) break;
  }
  if (!hit) discard;
  vec3 N = normalAt(p);
  vec3 V = -rd;
  if (dot(N, V) < 0.0) N = -N;
  inner = float(passes - (passes / 2) * 2);
  vec3 col;
  if (mat < 0.5) {
    vec3 base = uPaper * (inner > 0.5 ? 0.28 : 1.0);
    col = surface(base, 0.34, 0.0, N, V, inner > 0.5 ? 0.45 : 1.0);
    // clear enamel coat
    vec3 H = normalize(uKeyDir + V);
    col += uKeyCol * pow(max(dot(N, H), 0.0), 220.0) * 2.2 * (1.0 - inner);
    // oil sheen at grazing angles: the same film the facets are made of
    float nv = max(dot(N, V), 0.0);
    float thick = 185.0 + 45.0 * sin(dot(p, vec3(1.3, 0.7, -0.9)) * 1.4 + uTime * 0.21);
    col += thinFilm(nv, thick) * pow(1.0 - nv, 3.0) * 0.55 * (1.0 - inner);
    col += uSignal * edge * 2.0;
  } else {
    vec3 base = mix(uSignal, uGold, uDotGold);
    col = surface(base, 0.2, 0.0, N, V, 1.0);
    float facing = max(dot(N, V), 0.0);
    col += base * uDotGlow * (0.55 + 0.45 * facing);
    vec3 H = normalize(uKeyDir + V);
    col += uKeyCol * pow(max(dot(N, H), 0.0), 160.0) * 1.8;
  }
  col = fog(col, p);
  vec4 clip = uViewProj * vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  o = vec4(col, 1.0);
}`;

export const MESH_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform mat4 uModel;
uniform mat4 uViewProj;
out vec3 vW;
out vec3 vN;
out vec2 vUv;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(uModel) * aNormal);
  vUv = aUv;
  gl_Position = uViewProj * w;
}`;

/** Drum wheels (mode 1), instrument window (mode 2), plain lit meshes (mode 0). */
export const MESH_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
in vec2 vUv;
uniform int uMode;
uniform vec3 uBase;
uniform vec3 uInk;
uniform float uRough;
uniform vec3 uEmit;
uniform sampler2D uDigits;
uniform float uBlur;
uniform float uAlpha;
out vec4 o;
${LIGHT}
${NOISE}
void main() {
  if (uAlpha < 0.999 && uAlpha < hash12(gl_FragCoord.xy)) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 base = uBase;
  vec3 emit = uEmit;
  float rough = uRough;
  if (uMode == 1) {
    if (vUv.x >= 0.0) {
      float cov = 0.0;
      for (int i = 0; i < 7; i++) {
        float off = (float(i) / 6.0 - 0.5) * uBlur;
        cov += texture(uDigits, vec2(vUv.x, vUv.y + off)).a;
      }
      cov /= 7.0;
      base = mix(uBase, uInk, cov);
      emit += uInk * cov * 0.08;
    } else {
      base = uBase * 0.55;
    }
  } else if (uMode == 2) {
    vec2 q = abs(vUv - 0.5) * 2.0;
    vec2 e = max(q - vec2(0.86, 0.72), 0.0);
    float d = length(e) - 0.14 + min(max(q.x - 0.86, q.y - 0.72), 0.0);
    if (d > 0.0) discard;
    float rim = smoothstep(-0.05, 0.0, d);
    base = mix(uBase, uBase * 3.0, rim) * (0.75 + 0.25 * vUv.y);
    emit += vec3(0.02, 0.024, 0.03) * rim;
  }
  vec3 col = surface(base, rough, 0.0, N, V, 1.0) + emit;
  o = vec4(fog(col, vW), 1.0);
}`;

/** One primitive per formation: instanced tetrahedra flying between hollow shells. */
export const PARTICLE_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aBary;
layout(location = 3) in vec3 aA;
layout(location = 4) in vec3 aNA;
layout(location = 5) in vec3 aB;
layout(location = 6) in vec3 aNB;
layout(location = 7) in vec4 aSeed;
layout(location = 8) in vec3 aOrder;
uniform mat4 uViewProj;
uniform mat4 uRingModel;
uniform mat4 uExcModel;
uniform float uT;
uniform float uTime;
uniform float uDissolve;
uniform float uFly0;
uniform float uFlySpread;
uniform float uFlyDur;
uniform float uDis0;
uniform float uDisSpread;
uniform float uDisDur;
uniform float uSize;
uniform vec3 uWind;
uniform float uSway;
out vec3 vN;
out vec3 vS;
out vec3 vW;
out vec3 vBary;
out float vFade;
out float vSeed;
out float vFly;
out float vBias;
${NOISE}
mat3 axisAngle(vec3 ax, float a) {
  float s = sin(a), c = cos(a), ic = 1.0 - c;
  return mat3(c + ax.x * ax.x * ic, ax.y * ax.x * ic + ax.z * s, ax.z * ax.x * ic - ax.y * s,
              ax.x * ax.y * ic - ax.z * s, c + ax.y * ax.y * ic, ax.z * ax.y * ic + ax.x * s,
              ax.x * ax.z * ic + ax.y * s, ax.y * ax.z * ic - ax.x * s, c + ax.z * ax.z * ic);
}
/** Tangent frame whose z is n; built from the particle's constant local normal, so it never flips in time. */
mat3 frame(vec3 n) {
  vec3 up = abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(up, n));
  return mat3(t, cross(n, t), n);
}
vec3 bezier(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
  float it = 1.0 - t;
  return it * it * it * a + 3.0 * it * it * t * b + 3.0 * it * t * t * c + t * t * t * d;
}
float inOutCubic(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5; }
float smoother(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
void main() {
  float n = dissolveNoise(aA);
  float appear = smoothstep(n - 0.015, n + 0.09, uDissolve);
  mat3 RA = mat3(uRingModel);
  RA = mat3(normalize(RA[0]), normalize(RA[1]), normalize(RA[2]));
  vec3 A = (uRingModel * vec4(aA, 1.0)).xyz;
  vec3 NA = RA * aNA;
  vec3 B = (uExcModel * vec4(aB, 1.0)).xyz;
  vec3 NB = normalize(mat3(uExcModel) * aNB);

  float fs = uFly0 + aOrder.x * uFlySpread;
  float fd = uFlyDur * (0.84 + 0.32 * aSeed.w);
  float f = clamp((uT - fs) / fd, 0.0, 1.0);
  float fe = inOutCubic(f);
  vec3 P1 = A + NA * 0.42 + vec3(0.0, 0.75, 0.0) + aSeed.xyz * 0.5;
  vec3 P2 = B + NB * 0.55 + vec3(0.0, 0.6, 0.0) + aSeed.zxy * 0.38;
  vec3 pos = bezier(A, P1, P2, B, fe);
  // anticipation: each facet tucks into the shell before it leaves
  float pre = clamp((uT - fs + 0.18) / 0.18, 0.0, 1.0);
  pos -= NA * 0.04 * sin(3.14159 * pre) * step(f, 0.0);
  // arrival: carry through the slot a little, then settle back
  float k = clamp((f - 0.78) / 0.22, 0.0, 1.0);
  pos += normalize(B - P2) * 0.06 * sin(3.14159 * k) * (1.0 - k * 0.4) * step(0.001, f);
  // breathing once formed
  float formed = step(0.999, f);
  pos += NB * formed * 0.006 * sin(uTime * 1.3 + aSeed.w * 23.0);

  float ds = uDis0 + aOrder.y * uDisSpread;
  float dd = uDisDur * (0.8 + 0.4 * aSeed.w);
  float d = clamp((uT - ds) / dd, 0.0, 1.0);
  if (d > 0.0) {
    float tuck = -0.04 * sin(3.14159 * clamp(d / 0.2, 0.0, 1.0));
    vec3 dir = normalize(uWind + aSeed.xyz * 0.6 + NB * 0.3);
    float travel = d * d * (2.3 + 1.7 * aSeed.w);
    vec3 sw = normalize(cross(normalize(aSeed.yzx + 0.01), dir));
    float ang = d * (2.4 + 2.2 * aSeed.w) + aSeed.w * 6.2831;
    vec3 swirl = (sw * sin(ang) + cross(dir, sw) * (cos(ang) - 1.0)) * 0.3 * d;
    pos = B + NB * tuck + dir * travel + swirl + vec3(0.0, 0.5, 0.0) * d * d;
  }

  // orientation: one face lies on the surface, facing out; the surface normal swings from the shell to the machine
  vec3 cr = cross(NA, NB);
  float cl = length(cr);
  vec3 swingAx = cl > 1e-4 ? cr / cl : normalize(cross(NA, abs(NA.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  mat3 swing = axisAngle(swingAx, acos(clamp(dot(NA, NB), -1.0, 1.0)) * fe);
  vec3 Ns = swing * NA;
  // face normal (1,1,-1)/√3 of the unit tetrahedron → +z of the tangent frame
  mat3 pre0 = axisAngle(vec3(0.70710678, -0.70710678, 0.0), 2.186276);
  float tilt = 0.16 + 0.3 * fract(aSeed.w * 7.13) + 0.1 * sin(uTime * 0.8 + aSeed.w * 31.0) * (1.0 - d);
  float tiltDir = aSeed.x * 3.14159;
  mat3 lean = axisAngle(vec3(cos(tiltDir), sin(tiltDir), 0.0), tilt);
  mat3 twist = axisAngle(vec3(0.0, 0.0, 1.0), aSeed.y * 3.14159);
  // whole turns in flight, so each facet lands exactly as it left; a small wobble settles the landing
  float turns = 1.0 + floor(aSeed.w * 2.0);
  float spin = 6.2831853 * turns * smoother(f) + 0.45 * sin(3.14159 * k) * (1.0 - k) + 6.2831 * (0.7 + aSeed.w) * d * d;
  mat3 tumble = axisAngle(normalize(aSeed.xyz + vec3(0.001, 0.002, 0.003)), spin);
  mat3 R = swing * RA * frame(aNA) * twist * lean * tumble * pre0;
  float s = uSize * appear * (1.0 + 0.22 * sin(3.14159 * f)) * (1.0 - smoothstep(0.62, 1.0, d) * 0.7);
  // playhead inertia leans the whole formation a touch
  pos.x += uSway * 0.04 * (pos.y + 0.5);
  vec3 w = pos + R * (aPos * s);
  vN = R * aNormal;
  vS = Ns;
  vW = w;
  vBary = aBary;
  vFade = appear * (1.0 - smoothstep(0.42, 0.97, d));
  vSeed = aSeed.w;
  vFly = sin(3.14159 * f) + d;
  vBias = aOrder.z * fe;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

export const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vS;
in vec3 vW;
in vec3 vBary;
in float vFade;
in float vSeed;
in float vFly;
in float vBias;
uniform vec3 uPaper;
out vec4 o;
${LIGHT}
${NOISE}
${FILM}
void main() {
  if (vFade < 0.999 && vFade < hash12(gl_FragCoord.xy + vSeed * 97.0)) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  if (dot(N, V) < 0.0) N = -N;
  float cosT = clamp(dot(N, V), 0.0, 1.0);
  // first-order film, 120–290 nm: the temper colours of heat-treated steel (straw, gold, bronze, purple, blue),
  // drifting slowly across the whole formation; landed facets add their part's bias
  float d = 192.0 + 62.0 * sin(dot(vW, vec3(0.8, 0.45, -0.4)) * 0.95 - uTime * 0.2);
  d += 30.0 * (vnoise(vW * 1.2 + vec3(0.0, uTime * 0.04, 0.0)) - 0.5) + vSeed * 12.0 + vBias;
  vec3 film = thinFilm(cosT, d);
  vec3 L = uKeyDir;
  vec3 H = normalize(L + V);
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), 64.0);
  float fres = 0.06 + 0.94 * pow(1.0 - cosT, 4.0);
  // the skin facing the camera is lit; the far skin, seen through the gaps, sinks into shadow
  float facing = dot(normalize(vS), V);
  float shell = mix(0.26, 1.0, smoothstep(-0.35, 0.3, facing));
  vec3 col = vec3(0.012, 0.011, 0.009) + film * (0.07 + 0.6 * diff + 0.95 * fres) * shell;
  col += spec * (1.3 + 0.9 * min(vFly, 1.0)) * mix(vec3(1.0), film * 1.5, 0.5) * shell;
  col += env(reflect(-V, N)) * film * fres * 0.45 * shell;
  float e = min(min(vBary.x, vBary.y), vBary.z);
  float w = fwidth(e);
  float edge = 1.0 - smoothstep(w * 0.5, w * 1.5 + 0.022, e);
  col += edge * (0.05 + 1.2 * spec + 0.35 * fres + 0.12 * diff) * mix(uPaper, film, 0.6) * shell;
  o = vec4(fog(col, vW), 1.0);
}`;

export const TERRAIN_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aRoute;
uniform mat4 uViewProj;
uniform float uRise;
uniform vec2 uRiseCentre;
out vec3 vW;
out float vD;
out float vU;
out float vH;
out float vReveal;
void main() {
  float dist = length(aPos.xz - uRiseCentre);
  float k = clamp(uRise * 1.5 - dist / 13.0, 0.0, 1.0);
  float kk = k * k * (3.0 - 2.0 * k);
  vec3 p = vec3(aPos.x, aPos.y * kk - (1.0 - kk) * 0.35, aPos.z);
  vW = p;
  vD = aRoute.x;
  vU = aRoute.y;
  vH = aPos.y;
  vReveal = k;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

export const TERRAIN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vW;
in float vD;
in float vU;
in float vH;
in float vReveal;
uniform vec3 uMast;
uniform float uCover;
uniform float uMachineU;
uniform float uRouteLen;
uniform float uAlpha;
uniform vec3 uTaiga;
uniform vec3 uTaigaDeep;
uniform vec3 uContour;
uniform vec3 uPaper;
uniform vec3 uSignal;
out vec4 o;
${LIGHT}
${NOISE}
float fbm2(vec2 p) { return 0.55 * vnoise(vec3(p, 0.0)) + 0.3 * vnoise(vec3(p * 2.3, 1.7)) + 0.15 * vnoise(vec3(p * 5.1, 3.1)); }
void main() {
  if (vReveal <= 0.002 || uAlpha < hash12(gl_FragCoord.xy * 1.3)) discard;
  vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
  if (N.y < 0.0) N = -N;
  float dm = length(vW.xz - uMast.xz);
  float cover = 1.0 - smoothstep(uCover - 0.3, uCover + 0.3, dm);
  float can = fbm2(vW.xz * 2.4);
  float forest = smoothstep(0.42, 0.72, can);
  vec3 base = mix(uTaigaDeep, uTaiga, forest);
  float light = 0.35 + 0.65 * max(dot(N, uKeyDir), 0.0);
  vec3 col = base * light;
  // topographic contours; lit by the coverage pulses near the mast
  float h = vH * 7.0;
  float fw = fwidth(h) + 1e-4;
  // levels sit at half-steps, so the flattened valley floor (h = 0) never lands on a contour
  float line = 1.0 - smoothstep(fw * 0.6, fw * 1.6, abs(fract(h) - 0.5));
  float pulse = 0.5 + 0.5 * sin(dm * 5.5 - uTime * 3.2);
  pulse = pow(pulse, 6.0);
  vec3 cc = mix(uPaper * 0.075, uContour * (0.4 + 1.6 * pulse), cover);
  col = mix(col, cc, line * 0.8);
  // coverage fringe and rings on the ground
  float ring = exp(-pow((fract(dm * 0.55 - uTime * 0.35) - 0.5) * 9.0, 2.0));
  col += uContour * ring * cover * 0.08;
  col += uContour * exp(-pow((dm - uCover) * 5.0, 2.0)) * 0.12;
  // dead zone: the ground loses signal
  float stat = hash12(floor(gl_FragCoord.xy / 2.0) + floor(uTime * 16.0) * 13.0) - 0.5;
  col += stat * 0.014 * (1.0 - cover);
  col *= mix(0.72, 1.0, cover);
  // the route itself is a separate ribbon (ROUTE_VS/FS): a line thinner than a grid cell cannot come from vD
  // a hairline traces the front while the land assembles
  col += uPaper * 0.22 * (1.0 - smoothstep(0.0, 0.05, vReveal)) * step(0.002, vReveal);
  o = vec4(fog(col, vW), 1.0);
}`;

/** The route as a ribbon on the valley floor; it rises with the land (same easing as TERRAIN_VS). */
export const ROUTE_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aXZ;
layout(location = 1) in vec2 aUS;
uniform mat4 uViewProj;
uniform float uRise;
uniform vec2 uRiseCentre;
out float vU;
out float vSide;
out float vReveal;
out vec3 vW;
void main() {
  float dist = length(aXZ - uRiseCentre);
  float k = clamp(uRise * 1.5 - dist / 13.0, 0.0, 1.0);
  float kk = k * k * (3.0 - 2.0 * k);
  vec3 p = vec3(aXZ.x, 0.012 - (1.0 - kk) * 0.35, aXZ.y);
  vU = aUS.x;
  vSide = aUS.y;
  vReveal = k;
  vW = p;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

export const ROUTE_FS = /* glsl */ `#version 300 es
precision highp float;
in float vU;
in float vSide;
in float vReveal;
in vec3 vW;
uniform float uMachineU;
uniform float uRouteLen;
uniform float uAlpha;
uniform vec3 uPaper;
uniform vec3 uCam;
uniform vec3 uFog;
uniform vec2 uFogRange;
out vec4 o;
void main() {
  if (vReveal <= 0.002) discard;
  float done = step(vU, uMachineU);
  // the part still ahead is dashed and narrower
  float dash = step(0.45, fract(vU * uRouteLen / 0.2));
  float halfW = mix(0.55, 1.0, done);
  float s = abs(vSide);
  float aa = fwidth(vSide) * 1.2 + 1e-4;
  float a = (1.0 - smoothstep(halfW - aa, halfW, s)) * max(done, dash * 0.85) * uAlpha;
  vec3 col = mix(uPaper * 0.34, uPaper * 1.15, done);
  col = mix(col, uFog, smoothstep(uFogRange.x, uFogRange.y, length(uCam - vW)));
  if (a < 0.003) discard;
  o = vec4(col, a);
}`;

export const MARKER_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aStore;
layout(location = 3) in float aK;
uniform mat4 uViewProj;
uniform float uMachineU;
uniform float uFlushT;
uniform vec3 uMastTop;
uniform float uSize;
out vec3 vW;
out vec3 vN;
out float vHeat;
void main() {
  float stored = smoothstep(aStore.w, aStore.w + 0.012, uMachineU);
  float ft = clamp((uFlushT - aK * 0.5) / 0.62, 0.0, 1.0);
  float fe = ft * ft * (3.0 - 2.0 * ft);
  vec3 mid = mix(aStore.xyz, uMastTop, 0.45) + vec3(0.0, 1.2 + aK * 0.7, 0.0);
  vec3 p = mix(mix(aStore.xyz, mid, fe), mix(mid, uMastTop, fe), fe);
  float s = uSize * stored * (1.0 - fe * 0.7) * (1.0 - step(0.999, ft));
  vHeat = smoothstep(0.0, 0.35, fe) * (1.0 - step(0.999, ft));
  vec3 w = p + aPos * s;
  vW = w;
  vN = aNormal;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

export const MARKER_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
in float vHeat;
uniform vec3 uPaper;
uniform vec3 uSignal;
out vec4 o;
${LIGHT}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 col = surface(uPaper * 0.75, 0.42, 0.0, N, V, 1.0);
  col = mix(col, uSignal * 3.2, vHeat);
  o = vec4(fog(col, vW), 1.0);
}`;

export const SPRITE_VS = /* glsl */ `#version 300 es
uniform mat4 uViewProj;
uniform vec3 uCentre;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uSize;
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vUv = c;
  gl_Position = uViewProj * vec4(uCentre + (uRight * c.x + uUp * c.y) * uSize, 1.0);
}`;

export const SPRITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uColor;
uniform float uRadius;
uniform float uWidth;
uniform float uCore;
out vec4 o;
void main() {
  float r = length(vUv);
  float ring = exp(-pow((r - uRadius) / max(uWidth, 1e-3), 2.0));
  float core = exp(-r * r * 18.0) * uCore;
  float a = (ring + core) * (1.0 - smoothstep(0.85, 1.0, r));
  o = vec4(uColor * a, 1.0);
}`;

export const TRI_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const BACKDROP_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uLow;
uniform vec3 uHigh;
uniform vec3 uBeamCol;
uniform float uBeam;
uniform vec2 uBeamPos;
uniform vec3 uGlowCol;
uniform float uGlow;
uniform vec2 uGlowPos;
uniform float uHorizon;
uniform vec3 uHorizonCol;
out vec4 o;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec3 col = mix(uLow, uHigh, smoothstep(-0.1, 1.1, uv.y));
  vec2 q = vec2((uv.x - uBeamPos.x) * aspect, uv.y - uBeamPos.y);
  float width = 0.08 + (1.0 - uv.y) * 0.34;
  float cone = exp(-q.x * q.x / (width * width)) * smoothstep(-0.2, 1.0, uv.y);
  float dust = 1.0;
  col += uBeamCol * cone * uBeam * dust;
  vec2 g = vec2((uv.x - uGlowPos.x) * aspect, uv.y - uGlowPos.y);
  col += uGlowCol * exp(-dot(g, g) * 5.0) * uGlow;
  col += uHorizonCol * exp(-pow((uv.y - 0.08) * 6.0, 2.0)) * uHorizon;
  col += (hash12(gl_FragCoord.xy) - 0.5) * 0.004;
  o = vec4(col, 1.0);
}`;

/** Golden oil in a glass vial: meniscus, slosh, caustics, bubbles, a falling drop and its splash. */
export const OIL_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uMix;
uniform vec4 uVial;
uniform float uLevel;
uniform float uSlosh;
uniform float uSloshPhase;
uniform float uImpact;
uniform float uImpactX;
uniform vec3 uDrop;
uniform vec2 uDropStretch;
uniform float uDropOn;
uniform vec3 uInk;
uniform vec3 uGold;
uniform vec3 uAmber;
uniform vec3 uDeep;
uniform vec3 uPaper;
out vec4 o;
${NOISE}
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float surfaceY(float x) {
  float w = uSlosh * sin(x * 3.2 + uSloshPhase) + uSlosh * 0.35 * sin(x * 7.1 - uSloshPhase * 1.7);
  float t = uImpact;
  if (t > 0.0) {
    float d = abs(x - uImpactX);
    w += 0.06 * exp(-t * 2.4) * cos(d * 26.0 - t * 18.0) * exp(-d * 3.0) * smoothstep(0.0, 0.05, t);
  }
  return uLevel + w;
}
void main() {
  vec2 px = gl_FragCoord.xy;
  float H = uRes.y;
  vec2 p = (px - uVial.xy) / H;
  vec2 half_ = uVial.zw / H * 0.5;
  vec3 col = uInk;
  vec2 g = p / vec2(1.0, 1.4);
  col += uAmber * exp(-dot(g, g) * 5.0) * 0.1;
  float body = sdBox(p, half_, half_.x * 0.98);
  float wall = 0.0045;
  float inside = step(body, -wall);
  // local vial coordinates: x in [-1,1], y from bottom 0 to top 1
  vec2 v = vec2(p.x / half_.x, (p.y + half_.y) / (2.0 * half_.y));
  float sy = surfaceY(v.x);
  float oil = inside * step(v.y, sy);
  if (oil > 0.5) {
    float depth = clamp((sy - v.y) / max(sy, 0.05), 0.0, 1.0);
    // a lit cylinder of oil: gold under the surface, amber in the body, dark at the walls and the bottom
    vec3 c = mix(uGold * 1.2, uAmber, smoothstep(0.0, 0.45, depth));
    c = mix(c, uDeep, smoothstep(0.35, 1.0, depth) * 0.85);
    float wallShade = 1.0 - v.x * v.x;
    c *= 0.4 + 0.6 * wallShade;
    // slow refracted light drifting through the body (soft ridges, not foam)
    vec2 cp = vec2(v.x * 1.6, v.y * 3.2 - uTime * 0.06);
    float ca = vnoise(vec3(cp * 1.7, uTime * 0.12)) * 0.65 + vnoise(vec3(cp * 3.4 + 2.0, uTime * 0.2)) * 0.35;
    float caust = pow(1.0 - abs(ca * 2.0 - 1.0), 3.0);
    c += uGold * caust * (1.0 - depth) * 0.26 * wallShade;
    // backlight through the glass: a soft vertical core
    c += uGold * 0.32 * exp(-v.x * v.x * 6.0) * (1.0 - depth * 0.6);
    c += uAmber * 1.2 * exp(-(sy - v.y) * 60.0);
    // bubbles rising in a few lanes
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float lane = hash12(vec2(fi, 3.7)) * 1.6 - 0.8;
      float speed = 0.08 + 0.06 * hash12(vec2(fi, 9.1));
      float by = fract(uTime * speed + hash12(vec2(fi, 1.3)));
      vec2 bp = vec2(lane + 0.03 * sin(uTime * 2.0 + fi), by * sy);
      vec2 bd = (v - bp) * vec2(half_.x, 2.0 * half_.y);
      float br = 0.006 + 0.004 * hash12(vec2(fi, 5.5));
      float b = length(bd);
      c += uPaper * 0.3 * smoothstep(br, br * 0.6, b) * smoothstep(br * 0.3, br * 0.8, b);
    }
    col = c;
  } else if (inside > 0.5) {
    col = mix(uInk, uInk * 1.6 + uAmber * 0.02, 0.5);
    col += uAmber * 0.25 * exp(-(v.y - sy) * 25.0);
  }
  // meniscus line
  float ms = abs(v.y - sy) * 2.0 * half_.y * H;
  col += uPaper * 1.6 * inside * (1.0 - smoothstep(0.6, 1.8, ms)) * (0.6 + 0.4 * abs(v.x));
  // glass walls: bright thin edges, a vertical specular stripe
  float edge = 1.0 - smoothstep(0.0, 0.0035, abs(body + wall * 0.5));
  col += uPaper * edge * 0.55;
  float stripe = inside * smoothstep(0.1, 0.0, abs(v.x + 0.62)) * 0.12;
  col += uPaper * stripe;
  // graduation ticks on the right wall
  if (inside > 0.5 && v.x > 0.74 && v.x < 0.9) {
    float tpx = 1.0 / (2.0 * half_.y * H);
    float f = abs(fract(v.y * 10.0 + 0.5) - 0.5) / 10.0;
    col += uPaper * 0.3 * (1.0 - smoothstep(tpx * 0.6, tpx * 1.6, f));
  }
  // falling drop: stretched circle with a highlight
  if (uDropOn > 0.5) {
    vec2 dp = (px - uDrop.xy) / H;
    dp /= uDropStretch;
    float r = uDrop.z / H;
    float dd = length(dp) - r;
    float m = 1.0 - smoothstep(-0.0015, 0.0015, dd);
    vec3 dc = mix(uDeep, uGold, 0.6 + 0.4 * (-dp.y / r));
    dc += uPaper * 1.2 * smoothstep(r * 0.45, 0.0, length(dp - vec2(-r * 0.35, r * 0.35)));
    col = mix(col, dc, m);
  }
  // splash droplets on ballistic arcs
  if (uImpact > 0.0 && uImpact < 0.9) {
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      float ang = mix(0.55, 2.6, fi / 6.0);
      float sp = 0.55 + 0.35 * hash12(vec2(fi, 2.0));
      vec2 vel = vec2(cos(ang), sin(ang)) * sp;
      float t = uImpact;
      vec2 dpos = vec2(uImpactX * half_.x, (uLevel * 2.0 - 1.0) * half_.y) + vel * t * 0.32 - vec2(0.0, 1.9) * t * t * 0.5 * 0.32;
      vec2 q = p - dpos;
      float rr = 0.0045 * (1.0 - t);
      col = mix(col, uGold * 1.3, (1.0 - smoothstep(rr * 0.6, rr, length(q))) * step(0.0, rr));
    }
  }
  o = vec4(col, uMix);
}`;
