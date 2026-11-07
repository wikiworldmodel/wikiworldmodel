// The city's shaders. Nothing here is a fact about Rome: materials are procedural, seen through a
// physically based sky, so that the same light falls on everything the records raise.

/** Structures rise over the years up to their start, and fall over the years after their end. */
export const RISE_YEARS = 7;

/** The curvature of the Earth, relative to the local grid's origin; applied to everything drawn. */
const DROP = /* glsl */ `
const float PLANET_RADIUS = 6371000.0;
float drop(vec2 p) { return dot(p, p) / (2.0 * PLANET_RADIUS); }
`;

/** Rising and falling: a vertex's entity says when it stood, and evidence what it rests on. */
const ENTITY = /* glsl */ `
uniform highp sampler2D uEntities;
uniform float uTime;
const float RISE_YEARS = ${RISE_YEARS.toFixed(1)};
// x start, y end, z flags (basis + 8·selected + 16·hovered), w the ground under it
invariant gl_Position;
vec4 entityOf(int id) { return texelFetch(uEntities, ivec2(id & 255, id >> 8), 0); }
// 0: not standing; 1: as built. Between: going up, or falling down.
float standing(vec4 e) {
  if (uTime < e.x - RISE_YEARS || uTime > e.y + RISE_YEARS) return 0.0;
  return min(smoothstep(e.x - RISE_YEARS, e.x, uTime), 1.0 - smoothstep(e.y, e.y + RISE_YEARS, uTime));
}
`;

export const MESH_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in uvec2 aMat;
layout(location = 4) in uint aEntity;
// One mesh drawn many times: each one's place, its size, the way it faces, its entity and how its colour shifts.
layout(location = 5) in vec4 iPlace;
layout(location = 6) in vec2 iFace;
layout(location = 7) in uvec2 iMeta;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform float uInstanced;
${DROP}
${ENTITY}
out vec3 vPos;
out vec3 vN;
out vec2 vUv;
out float vLight;
flat out int vMaterial;
flat out float vTint;
flat out float vFlags;
flat out int vEntity;
void main() {
  bool many = uInstanced > 0.5;
  int entity = many ? int(iMeta.x) : int(aEntity);
  vec4 e = entityOf(entity);
  float up = standing(e);
  if (up <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 p = aPos;
  vec3 n = aNormal.xyz * 2.0 - 1.0;
  float tint = float(aMat.y) / 255.0;
  if (many) {
    // +y of the mesh goes to (fx, fy), and +x to (fy, −fx). A horn, an eye or a trunk's bark stays its colour.
    p = iPlace.xyz + vec3(aPos.x * iFace.y + aPos.y * iFace.x, -aPos.x * iFace.x + aPos.y * iFace.y, aPos.z) * iPlace.w;
    n = vec3(n.x * iFace.y + n.y * iFace.x, -n.x * iFace.x + n.y * iFace.y, n.z);
    if (aMat.x != 32u && aMat.x != 10u && aMat.x != 37u) tint = fract(tint + float(iMeta.y) / 255.0);
  }
  // A structure rises from the ground it stands on.
  if (up < 1.0) p.z = e.w + (p.z - e.w) * up;
  vPos = p;
  p.z -= drop(p.xy);
  vN = n;
  vLight = aNormal.w;
  vUv = aUv;
  vMaterial = int(aMat.x);
  vTint = tint;
  vFlags = e.z;
  vEntity = entity;
  gl_Position = uViewProj * vec4(p - uEye, 1.0);
  // Paving, roads and sand lie on the ground: they win over it at any distance.
  if (aMat.x == 11u || aMat.x == 12u || aMat.x == 13u || aMat.x == 18u) gl_Position.z -= 1.4e-4 * gl_Position.w;
}`;

export const DEPTH_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`;

export const ID_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
flat in int vEntity;
out vec4 o;
void main() {
  o = vec4(float(vEntity & 255), float((vEntity >> 8) & 255), 0.0, 255.0) / 255.0;
}`;

/** Sky, haze, lighting and shadows: what every lit surface shares. */
const LIGHTING = /* glsl */ `
${DROP}
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyLow;
uniform vec3 uBounce;
uniform highp sampler2D uSkyLut;
uniform highp sampler2DArrayShadow uShadow;
uniform mat4 uShadowM[3];
uniform vec3 uShadowFocus;
uniform vec3 uShadowRadii;
uniform float uHazeK;
uniform highp sampler3D uNoise;

// Noise whose features are about \`size\` metres across (the texture holds 64 cells to its repeat).
float noiseM(vec3 p, float size) { return texture(uNoise, p / (64.0 * size)).r; }
float noiseS(vec3 p, vec3 size) { return texture(uNoise, p / (64.0 * size)).g; }
float fbmM(vec3 p, float size) {
  vec3 q = p / (64.0 * size);
  return texture(uNoise, q).r * 0.5 + texture(uNoise, q * 2.03 + 0.37).g * 0.3 + texture(uNoise, q * 4.1 + 0.71).b * 0.2;
}

// The sky in a direction, from the table made for this sun.
vec3 skyColor(vec3 d) {
  float az = acos(clamp(dot(normalize(d.xy + 1e-5), normalize(uSun.xy + 1e-5)), -1.0, 1.0)) / 3.14159265;
  float el = asin(clamp(d.z, -1.0, 1.0));
  // More of the table near the horizon.
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / 1.5708);
  return texture(uSkyLut, vec2(az, v)).rgb;
}

// Haze: extinction along a view, thinning with height, and what the air adds.
vec3 aerial(vec3 c, vec3 p, vec3 eye) {
  vec3 v = p - eye;
  float d = length(v);
  vec3 dir = v / d;
  // Mean density along the ray, from an exponential atmosphere of 2.2 km scale height.
  float h0 = max(eye.z, 0.0);
  float h1 = max(p.z, 0.0);
  float dh = h1 - h0;
  float rho = abs(dh) < 1.0 ? exp(-h0 / 2200.0) : (exp(-h0 / 2200.0) - exp(-h1 / 2200.0)) * 2200.0 / dh;
  vec3 ext = vec3(0.70, 0.86, 1.18) * uHazeK * d * rho;
  vec3 t = exp(-ext);
  vec3 air = skyColor(normalize(vec3(dir.xy, max(dir.z, 0.015))));
  return c * t + air * (1.0 - t);
}

// The shadows of fair-weather clouds, broad and soft, passing over the land.
float cloudShade(vec3 p) {
  float c = fbmM(p + uSun * 2000.0, 260.0);
  return 1.0 - 0.42 * smoothstep(0.5, 0.68, c) * smoothstep(0.08, 0.3, uSun.z);
}

float shadowAt(vec3 p, vec3 n, float pixel) {
  float d = distance(p, uShadowFocus);
  int k = d < uShadowRadii.x * 0.92 ? 0 : d < uShadowRadii.y * 0.92 ? 1 : 2;
  float texel = uShadowRadii[k] * 2.0 / 2048.0;
  vec3 q = p + n * texel * 1.6 + uSun * texel * 0.6;
  q.z -= drop(q.xy);
  vec4 c = uShadowM[k] * vec4(q, 1.0);
  vec3 u = c.xyz * 0.5 + 0.5;
  if (u.x < 0.0 || u.x > 1.0 || u.y < 0.0 || u.y > 1.0 || u.z > 1.0) return 1.0;
  float bias = 0.00012;
  float s = 0.0;
  float o = 1.1 / 2048.0;
  s += texture(uShadow, vec4(u.xy, float(k), u.z - bias));
  s += texture(uShadow, vec4(u.xy + vec2( o,  o * 0.4), float(k), u.z - bias));
  s += texture(uShadow, vec4(u.xy + vec2(-o, -o * 0.4), float(k), u.z - bias));
  s += texture(uShadow, vec4(u.xy + vec2( o * 0.4, -o), float(k), u.z - bias));
  s += texture(uShadow, vec4(u.xy + vec2(-o * 0.4,  o), float(k), u.z - bias));
  return s / 5.0;
}

// GGX highlight of the sun.
float sunSpecular(vec3 n, vec3 v, float rough) {
  vec3 h = normalize(uSun + v);
  float nh = max(dot(n, h), 0.0);
  float a = rough * rough;
  float a2 = a * a;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float vh = max(dot(v, h), 0.0);
  float fres = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
  return a2 / (3.14159 * d * d + 1e-4) * fres * 0.25 / max(0.1, vh);
}

// Sun, sky and the light bounced off the ground.
vec3 shade(vec3 albedo, float rough, float metal, vec3 n, vec3 p, vec3 eye, float occl, float shadow) {
  vec3 v = normalize(eye - p);
  float ndl = max(dot(n, uSun), 0.0);
  float up = n.z * 0.5 + 0.5;
  vec3 sky = mix(uSkyLow, uSkyTop, up);
  // A camera's white balance takes most of the blue out of the shade.
  float grey = dot(sky, vec3(0.3, 0.5, 0.2));
  sky = mix(vec3(grey), sky, 0.5) + uBounce * 0.45;
  vec3 bounce = uBounce * (1.0 - up) * (0.4 + 0.6 * shadow);
  vec3 diff = (albedo * (1.0 - metal)) * (uSunColor * ndl * shadow + (sky + bounce) * occl);
  float spec = sunSpecular(n, v, rough) * ndl * shadow;
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 r = reflect(-v, n);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
  // The sky in a polished surface; a rough one only scatters it, and the blaze by the sun is kept out.
  float gloss = (1.0 - rough) * (1.0 - rough);
  vec3 env = min(skyColor(normalize(vec3(r.xy, abs(r.z) + 0.02))), vec3(2.0)) * (f0 + (1.0 - f0) * fres) * gloss * occl;
  return diff + uSunColor * spec * f0 * 2.5 + env;
}
`;

export const MESH_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
precision highp sampler2DArrayShadow;
in vec3 vPos;
in vec3 vN;
in vec2 vUv;
in float vLight;
flat in int vMaterial;
flat in float vTint;
flat in float vFlags;
uniform vec3 uEye;
uniform highp sampler2D uAO;
uniform vec2 uAOSize;
uniform float uEvidence;
out vec4 o;
${LIGHTING}

const int MARBLE=1, TRAVERTINE=2, BRICK=3, PLASTER=4, TILE=5, GILT=6, BRONZE=7, GRANITE=8, WOOD=9, DARK=10, PAVING=11, BASALT=12, SAND=13, CONCRETE=14, LEAD=15, LEAF=16, TRUNK=17, GRASS=18, SHAFT=19, FACADE=20, STATUE=21, EARTH=22, SEATS=23, AWNING=24, SPIRAL=25, CLOTH=26, SKIN=27, DENTIL=28, FRIEZE=29, POOL=30, HIDE=31, HORN=32, SHELL=33, FUR=34, NEEDLE=35, FROND=36, BARK=37, BROAD=38, FEATHER=39, MEMBRANE=40, CHITIN=41;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Fades a pattern away once it is finer than a pixel or two, so nothing shimmers.
float visible(float size, float fw) { return 1.0 - smoothstep(size * 0.25, size * 0.9, fw); }

struct Surface { vec3 albedo; float rough; float metal; float bump; };

// Courses of blocks: a joint mask and a per-block number.
vec2 courses(vec2 uv, vec2 size) {
  float row = floor(uv.y / size.y);
  float x = uv.x / size.x + mod(row, 2.0) * 0.5;
  vec2 id = vec2(floor(x), row);
  vec2 f = vec2(fract(x), fract(uv.y / size.y));
  float jx = min(f.x, 1.0 - f.x) * size.x;
  float jy = min(f.y, 1.0 - f.y) * size.y;
  return vec2(min(jx, jy), hash(id));
}

const vec3 PLASTERS[8] = vec3[8](
  vec3(0.70, 0.60, 0.47), vec3(0.76, 0.70, 0.59), vec3(0.60, 0.40, 0.31), vec3(0.78, 0.74, 0.66),
  vec3(0.55, 0.36, 0.30), vec3(0.72, 0.62, 0.48), vec3(0.66, 0.54, 0.43), vec3(0.82, 0.80, 0.74));
const vec3 BRICKS[4] = vec3[4](vec3(0.50, 0.30, 0.22), vec3(0.56, 0.35, 0.25), vec3(0.44, 0.27, 0.21), vec3(0.60, 0.42, 0.31));

// A house's front: floors of windows over shops, in plaster or brick.
Surface facade(vec3 p, vec2 uv, float tint, float fw, vec3 n, out float glass) {
  Surface s;
  int st = int(tint * 255.0 + 0.5);
  bool brick = (st & 3) == 0;
  vec3 base = brick ? BRICKS[(st >> 2) & 3] : PLASTERS[(st >> 2) & 7];
  // Weather: big patches, and rain streaks down from the eaves.
  float patches = fbmM(p, 2.4);
  float streaks = noiseS(p, vec3(0.5, 0.5, 4.5));
  base *= 0.74 + 0.5 * patches;
  base = mix(base, base * vec3(0.72, 0.70, 0.66), smoothstep(0.45, 0.7, streaks) * 0.55);
  if (brick) {
    vec2 c = courses(uv, vec2(0.42, 0.075));
    float vis = visible(0.075, fw);
    base = mix(base, mix(vec3(0.60, 0.55, 0.47), base * (0.78 + 0.44 * c.y), smoothstep(0.004, 0.012, c.x)), vis);
  } else {
    // Stucco comes away in places, and the brick shows through.
    float flake = smoothstep(0.66, 0.70, fbmM(p + 3.1, 0.7));
    vec3 under = BRICKS[(st >> 4) & 3] * (0.8 + 0.3 * noiseM(p, 0.09));
    base = mix(base, under, flake * (1.0 - smoothstep(1.5, 6.0, fw)) * 0.85);
    base *= 0.94 + 0.12 * noiseM(p, 0.05) * visible(0.05, fw);
  }
  s.rough = 0.92;
  s.metal = 0.0;
  s.bump = 0.0;
  glass = 0.0;
  // The grid of windows: a bay about three metres wide, a storey 3.3 m high, the ground floor apart.
  float bay = 2.9 + 0.6 * float(st & 3) * 0.33;
  float story = 3.3;
  vec2 g = vec2(uv.x / bay, (uv.y - 3.7) / story);
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float rnd = hash(cell + vec2(float(st)));
  if (uv.y > 3.7) {
    vec2 w = abs(f - vec2(0.5, 0.46)) * vec2(bay, story);
    float missing = step(0.84, rnd);
    float hw = 0.42 + 0.12 * step(0.5, fract(rnd * 7.0));
    float hh = 0.66;
    float win = (1.0 - smoothstep(hw - 0.02, hw + 0.02, w.x)) * (1.0 - smoothstep(hh - 0.02, hh + 0.02, w.y)) * (1.0 - missing);
    float vis = 1.0 - smoothstep(0.55, 1.8, fw);
    // From far off the windows melt into a slight darkening of the wall.
    base *= mix(0.88, 1.0, vis);
    if (vis > 0.0) {
      float surround = (1.0 - smoothstep(hw + 0.08, hw + 0.11, w.x)) * (1.0 - smoothstep(hh + 0.08, hh + 0.11, w.y)) * (1.0 - missing);
      base = mix(base, brick ? vec3(0.66, 0.60, 0.52) : base * 0.8, surround * vis);
      // Most stand open, with a shutter folded back at either side; some are closed up.
      float closed = step(fract(rnd * 3.7), 0.3);
      float leaf = step(hw * 0.6, w.x);
      vec3 wood = mix(vec3(0.15, 0.095, 0.06), vec3(0.09, 0.13, 0.10), step(0.72, rnd)) * (0.7 + 0.6 * noiseS(p, vec3(0.03, 0.03, 0.5)));
      vec3 inside = mix(vec3(0.016, 0.014, 0.012), wood, closed > 0.5 ? 1.0 : leaf);
      base = mix(base, inside, win * vis);
    }
  } else {
    // Shops: wide arched openings along the ground floor, in brick.
    float sb = 4.4;
    float sx = fract(uv.x / sb);
    float sid = floor(uv.x / sb);
    float wx = abs(sx - 0.5) * sb;
    float shop = 1.0 - smoothstep(1.45, 1.5, wx);
    float archTop = 2.05 + sqrt(max(0.0, 1.5 * 1.5 - wx * wx)) * 0.55;
    float open = shop * (1.0 - smoothstep(archTop - 0.03, archTop + 0.03, uv.y)) * smoothstep(-0.2, -0.05, uv.y);
    float vis = 1.0 - smoothstep(0.7, 2.0, fw);
    vec3 lower = brick ? base : mix(base, BRICKS[int(hash(vec2(sid, float(st))) * 3.99)], 0.6) * 0.92;
    base = mix(base, lower, vis);
    base *= mix(0.78, 1.0, vis);
    if (vis > 0.0) {
      float ring = shop * smoothstep(archTop - 0.32, archTop - 0.28, uv.y) * (1.0 - open);
      base = mix(base, vec3(0.70, 0.62, 0.50) * (0.8 + 0.3 * noiseM(p, 0.1)), ring * smoothstep(1.2, 1.3, uv.y));
      float closed = step(0.55, hash(vec2(sid, float(st) + 3.0)));
      vec3 boards = vec3(0.13, 0.085, 0.05) * (0.65 + 0.7 * noiseS(p, vec3(0.03, 0.03, 0.8)));
      vec3 inner = mix(vec3(0.018, 0.015, 0.012), boards, closed);
      base = mix(base, inner, open * vis);
    }
  }
  // Damp at the foot.
  base *= mix(0.66, 1.0, smoothstep(0.0, 1.5, uv.y));
  s.albedo = base;
  return s;
}

Surface surface(int m, vec3 p, vec2 uv, float tint, vec3 n, float fw, out vec3 bumpN) {
  Surface s;
  s.rough = 0.8;
  s.metal = 0.0;
  s.bump = 0.0;
  bumpN = n;
  if (m == SPIRAL) {
    // A band of relief winding up the shaft: u wraps once around in twelve, v is height.
    float band = fract(uv.y / 1.5 - uv.x / 12.0);
    float edge = abs(band - 0.5) * 2.0;
    vec3 base = vec3(0.82, 0.80, 0.75) * (0.86 + 0.28 * noiseM(p, 0.1));
    float vis = visible(0.2, fw);
    base *= mix(1.0, 0.62 + 0.38 * smoothstep(0.82, 0.98, 1.0 - edge) + 0.28 * noiseM(p, 0.22), vis);
    bumpN = normalize(n + vec3(0.0, 0.0, 1.0) * (band - 0.5) * 0.7 * vis);
    s.albedo = base;
    s.rough = 0.5;
  } else if (m == MARBLE || m == SHAFT) {
    vec3 base = vec3(0.84, 0.82, 0.77);
    float vein = abs(fbmM(p, 0.7) - 0.5) * 2.0;
    base = mix(base * 0.94, base, smoothstep(0.02, 0.16, vein));
    base *= 0.97 + 0.06 * noiseM(p, 0.03) * visible(0.03, fw);
    // Grime gathers in the wet, in soft patches and down from the ledges.
    base *= mix(0.88, 1.0, smoothstep(0.3, 0.62, fbmM(p, 5.0)));
    base = mix(base, base * vec3(0.86, 0.83, 0.77), smoothstep(0.4, 0.75, noiseS(p, vec3(0.7, 0.7, 4.5))) * 0.45);
    if (m == MARBLE) {
      vec2 c = courses(uv, vec2(1.8, 0.62));
      base *= mix(1.0, 0.68 + 0.32 * smoothstep(0.003, 0.012, c.x), visible(0.25, fw));
      base *= 0.96 + 0.08 * c.y;
    } else {
      // Flutes around the shaft: u counts the column's facets, twelve to the round.
      float a = fract(uv.x * 2.0);
      float prof = abs(a - 0.5) * 2.0;
      float vis = visible(0.022, fw);
      base *= mix(0.92, 0.6 + 0.4 * prof * prof, vis);
      float tilt = (prof - 0.5) * 0.7 * vis * sign(a - 0.5);
      vec3 t = normalize(cross(vec3(0.0, 0.0, 1.0), n));
      bumpN = normalize(n + t * tilt);
    }
    s.albedo = base;
    s.rough = 0.4;
  } else if (m == TRAVERTINE || m == SEATS) {
    vec3 base = vec3(0.64, 0.58, 0.47);
    base *= 0.82 + 0.34 * noiseS(p, vec3(1.8, 1.8, 0.16));
    float pits = smoothstep(0.6, 0.72, noiseM(p, 0.05));
    base *= 1.0 - pits * 0.3 * visible(0.05, fw);
    base *= mix(0.86, 1.0, smoothstep(0.3, 0.62, fbmM(p, 6.0)));
    base = mix(base, base * vec3(0.84, 0.8, 0.74), smoothstep(0.4, 0.75, noiseS(p, vec3(0.9, 0.9, 5.0))) * 0.45);
    if (m == TRAVERTINE) {
      vec2 c = courses(uv, vec2(1.5, 0.58));
      base *= mix(1.0, 0.68 + 0.32 * smoothstep(0.004, 0.014, c.x), visible(0.25, fw));
      base *= 0.94 + 0.12 * c.y;
    } else {
      float row = fract(uv.y);
      base *= mix(0.9, 1.0, step(0.5, row));
      base *= 0.86 + 0.26 * hash(vec2(floor(uv.x), floor(uv.y)));
    }
    s.albedo = base;
    s.rough = 0.85;
  } else if (m == BRICK) {
    vec3 base = BRICKS[int(tint * 255.0) & 3] * (0.82 + 0.34 * fbmM(p, 1.4));
    vec2 c = courses(uv, vec2(0.42, 0.075));
    float vis = visible(0.075, fw);
    base = mix(base, mix(vec3(0.6, 0.54, 0.46), base * (0.76 + 0.48 * c.y), smoothstep(0.004, 0.012, c.x)), vis);
    base *= mix(0.74, 1.0, smoothstep(0.3, 0.62, fbmM(p, 5.0)));
    base = mix(base, base * vec3(0.72, 0.72, 0.7), noiseS(p, vec3(0.7, 0.7, 4.5)) * 0.4);
    s.albedo = base;
    s.rough = 0.92;
  } else if (m == PLASTER) {
    s.albedo = PLASTERS[int(tint * 255.0) & 7] * (0.8 + 0.4 * fbmM(p, 1.2));
    s.rough = 0.9;
  } else if (m == TILE) {
    // Rows of tiles down the slope, a ridge over each joint.
    float pitch = 0.44;
    vec2 q = uv / vec2(pitch, 0.62);
    float rowV = floor(q.y);
    float a = fract(q.x);
    float prof = abs(a - 0.5) * 2.0;
    float ridge = pow(prof, 5.0);
    float vis = visible(0.2, fw);
    // Each roof its own age: fresh orange to weathered brown and grey.
    vec3 fresh = mix(vec3(0.60, 0.27, 0.15), vec3(0.70, 0.40, 0.22), tint);
    vec3 old = mix(vec3(0.38, 0.27, 0.21), vec3(0.47, 0.38, 0.30), tint);
    float age = fract(tint * 7.3);
    vec3 base = mix(fresh, old, age * 0.85);
    base *= 0.76 + 0.48 * fbmM(p, 2.2);
    base = mix(base, base * vec3(0.66, 0.72, 0.64), smoothstep(0.42, 0.7, fbmM(p + 7.0, 5.5)) * 0.6);
    float id = hash(vec2(floor(q.x), rowV));
    base *= mix(1.0, 0.8 + 0.38 * id, vis);
    base *= mix(1.0, 0.68 + 0.38 * ridge, vis);
    // Each row laps over the next.
    base *= mix(1.0, 0.78 + 0.22 * smoothstep(0.0, 0.1, fract(q.y)), visible(0.3, fw));
    // Far off, the ridges still darken a roof a little, and catch the sun.
    base *= mix(0.86, 1.0, vis);
    vec3 t = normalize(cross(vec3(0.0, 0.0, 1.0), n) + vec3(1e-4));
    bumpN = normalize(n + t * (a - 0.5) * 0.7 * vis);
    s.albedo = base;
    s.rough = 0.78;
  } else if (m == GILT) {
    s.albedo = vec3(1.0, 0.76, 0.34) * (0.82 + 0.26 * fbmM(p, 0.8));
    s.metal = 1.0;
    s.rough = 0.32;
    float vis = visible(0.2, fw);
    float a = fract(uv.x / 0.5);
    vec3 t = normalize(cross(vec3(0.0, 0.0, 1.0), n) + vec3(1e-4));
    bumpN = normalize(n + t * (a - 0.5) * 0.4 * vis);
  } else if (m == BRONZE || m == STATUE) {
    s.albedo = mix(vec3(0.55, 0.40, 0.22), vec3(0.26, 0.40, 0.33), smoothstep(0.38, 0.62, fbmM(p, 0.6)));
    s.metal = 0.85;
    s.rough = 0.48;
  } else if (m == GRANITE) {
    vec3 base = mix(vec3(0.42, 0.37, 0.37), vec3(0.62, 0.47, 0.44), tint);
    float sp = noiseM(p, 0.012);
    base *= mix(1.0, 0.72 + 0.56 * sp, visible(0.012, fw));
    s.albedo = base;
    s.rough = 0.34;
  } else if (m == WOOD || m == TRUNK) {
    vec3 base = m == WOOD ? vec3(0.33, 0.21, 0.12) : vec3(0.26, 0.19, 0.14);
    base *= 0.7 + 0.56 * noiseS(p, vec3(0.03, 0.03, 0.5));
    s.albedo = base;
    s.rough = 0.86;
  } else if (m == HIDE) {
    // Pebbled skin, darker along the back, paler beneath, its colours nobody's record: the generator's.
    float k = tint * 4.0;
    vec3 a = vec3(0.145, 0.125, 0.082);
    vec3 b = vec3(0.17, 0.165, 0.085);
    vec3 c = vec3(0.215, 0.14, 0.075);
    vec3 d = vec3(0.105, 0.115, 0.10);
    vec3 base = k < 1.0 ? mix(a, b, k) : k < 2.0 ? mix(b, c, k - 1.0) : k < 3.0 ? mix(c, d, k - 2.0) : mix(d, a, k - 3.0);
    float mott = fbmM(p, 0.32);
    float band = smoothstep(0.44, 0.62, fbmM(p * vec3(1.0, 0.45, 0.8), 0.5) + (mott - 0.5) * 0.35);
    vec3 skin = base * mix(1.25, 0.55, band);
    float back = smoothstep(0.2, 0.95, n.z);
    float belly = smoothstep(-0.15, -0.8, n.z);
    skin = mix(skin, skin * 0.58, back);
    skin = mix(skin, mix(skin, vec3(0.42, 0.37, 0.27), 0.68), belly);
    s.albedo = skin * (0.66 + 0.68 * noiseM(p, 0.06));
    s.rough = 0.66;
    vec3 q = p / (64.0 * 0.045);
    vec3 wob = vec3(texture(uNoise, q).r, texture(uNoise, q).g, texture(uNoise, q).b) - 0.5;
    bumpN = normalize(n + wob * 1.5);
  } else if (m == HORN) {
    s.albedo = mix(vec3(0.58, 0.52, 0.40), vec3(0.20, 0.17, 0.13), tint) * (0.84 + 0.3 * noiseM(p, 0.05));
    s.rough = 0.48;
  } else if (m == SHELL) {
    // Scutes: cells on the shell's own plan, with dark seams between them.
    vec2 g = uv / 0.11;
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float seam = smoothstep(0.0, 0.08, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    vec3 base = mix(vec3(0.17, 0.15, 0.09), vec3(0.30, 0.25, 0.13), hash(cell + floor(tint * 8.0)));
    s.albedo = base * mix(0.5, 1.0, seam * visible(0.06, fw) + 1.0 - visible(0.06, fw)) * (0.8 + 0.4 * noiseM(p, 0.04));
    s.rough = 0.42;
  } else if (m == FUR) {
    float k = fract(tint * 3.0);
    vec3 base = tint < 0.34 ? mix(vec3(0.20, 0.145, 0.09), vec3(0.34, 0.25, 0.14), k) : tint < 0.67 ? mix(vec3(0.27, 0.20, 0.11), vec3(0.16, 0.14, 0.11), k) : mix(vec3(0.42, 0.34, 0.20), vec3(0.22, 0.17, 0.12), k);
    float back = smoothstep(0.2, 0.9, n.z);
    float belly = smoothstep(-0.1, -0.8, n.z);
    s.albedo = mix(mix(base, base * 0.6, back), vec3(0.56, 0.50, 0.40), belly * 0.7) * (0.74 + 0.5 * noiseS(p, vec3(0.03, 0.03, 0.14)));
    s.rough = 0.95;
  } else if (m == FEATHER) {
    // Vanes in long strokes, darker on the back and paler beneath. Their colours are nobody's record: the generator's.
    float k = tint * 4.0;
    vec3 a = vec3(0.13, 0.12, 0.10);
    vec3 b = vec3(0.30, 0.24, 0.14);
    vec3 c = vec3(0.10, 0.14, 0.18);
    vec3 d = vec3(0.36, 0.33, 0.27);
    vec3 base = k < 1.0 ? mix(a, b, k) : k < 2.0 ? mix(b, c, k - 1.0) : k < 3.0 ? mix(c, d, k - 2.0) : mix(d, a, k - 3.0);
    float back = smoothstep(0.2, 0.9, n.z);
    float belly = smoothstep(-0.1, -0.8, n.z);
    s.albedo = mix(mix(base, base * 0.7, back), vec3(0.62, 0.58, 0.50), belly * 0.6) * (0.78 + 0.44 * noiseS(p, vec3(0.018, 0.09, 0.018)));
    s.rough = 0.82;
  } else if (m == MEMBRANE) {
    // A wing's skin: thin, leathery and a little see-through against the light.
    vec3 base = mix(vec3(0.26, 0.17, 0.11), vec3(0.42, 0.29, 0.17), tint);
    s.albedo = base * (0.8 + 0.34 * noiseS(p, vec3(0.3, 0.04, 0.3)));
    s.rough = 0.62;
  } else if (m == CHITIN) {
    // A hard, glossy shell of plates.
    vec3 base = mix(vec3(0.05, 0.035, 0.025), vec3(0.20, 0.13, 0.06), tint);
    s.albedo = base * (0.8 + 0.4 * noiseM(p, 0.02));
    s.rough = 0.32;
  } else if (m == NEEDLE) {
    // Soft sprays of needles, in streaks falling away from the trunk.
    vec3 dark = mix(vec3(0.03, 0.064, 0.032), vec3(0.05, 0.085, 0.036), tint);
    vec3 lite = mix(vec3(0.075, 0.135, 0.05), vec3(0.135, 0.185, 0.06), tint);
    float spray = noiseS(p, vec3(0.2, 0.2, 0.06)) * 0.6 + noiseM(p, 0.12) * 0.4;
    s.albedo = mix(dark, lite, smoothstep(0.3, 0.7, spray)) * (0.85 + 0.35 * fbmM(p, 3.0));
    s.rough = 0.86;
    vec3 q = p / (64.0 * 0.26);
    vec3 wob = vec3(texture(uNoise, q).r, texture(uNoise, q).g, texture(uNoise, q).b) - 0.5;
    bumpN = normalize(n + wob * 1.5);
  } else if (m == FROND) {
    // Veined blades: fans and fronds, with a glossy side.
    vec3 dark = mix(vec3(0.05, 0.11, 0.035), vec3(0.075, 0.13, 0.04), tint);
    vec3 lite = mix(vec3(0.16, 0.25, 0.07), vec3(0.25, 0.30, 0.085), tint);
    float vein = abs(fract(uv.x + 0.5) - 0.5) * 2.0;
    s.albedo = mix(dark, lite, 0.42 + 0.5 * vein * visible(0.1, fw)) * (0.8 + 0.4 * noiseM(p, 0.22));
    s.rough = 0.56;
  } else if (m == BROAD) {
    // A mass of broad leaves: the light on them, in small flecks.
    vec3 dark = mix(vec3(0.028, 0.06, 0.024), vec3(0.052, 0.078, 0.022), tint);
    vec3 lite = mix(vec3(0.085, 0.14, 0.04), vec3(0.16, 0.185, 0.05), tint);
    float fleck = noiseM(p, 0.09) * 0.55 + noiseM(p + 5.0, 0.28) * 0.45;
    s.albedo = mix(dark, lite, smoothstep(0.32, 0.72, fleck)) * (0.82 + 0.4 * fbmM(p, 3.5));
    s.rough = 0.8;
    vec3 q = p / (64.0 * 0.14);
    vec3 wob = vec3(texture(uNoise, q).r, texture(uNoise, q).g, texture(uNoise, q).b) - 0.5;
    bumpN = normalize(n + wob * 2.2);
  } else if (m == BARK) {
    vec3 base = mix(vec3(0.17, 0.13, 0.095), vec3(0.31, 0.22, 0.14), tint);
    float ridges = noiseS(p, vec3(0.05, 0.05, 0.7));
    s.albedo = base * (0.58 + 0.84 * ridges);
    s.rough = 0.9;
  } else if (m == DARK) {
    s.albedo = vec3(0.012, 0.011, 0.01);
    s.rough = 0.9;
  } else if (m == POOL) {
    s.albedo = vec3(0.03, 0.06, 0.055);
    s.rough = 0.1;
  } else if (m == PAVING) {
    vec2 c = courses(uv, vec2(1.8, 1.05));
    vec3 base = mix(vec3(0.62, 0.58, 0.50), vec3(0.76, 0.74, 0.68), tint);
    base *= 0.82 + 0.26 * c.y;
    base *= mix(1.0, 0.6 + 0.4 * smoothstep(0.012, 0.04, c.x), visible(0.4, fw));
    base *= mix(0.76, 1.0, smoothstep(0.26, 0.6, fbmM(p, 6.0)));
    base *= 0.94 + 0.12 * noiseM(p, 0.06) * visible(0.06, fw);
    s.albedo = base;
    s.rough = 0.7;
  } else if (m == BASALT) {
    // Polygonal stones, in the manner of the Roman road.
    vec2 cell = floor(uv * 1.5);
    vec2 f = fract(uv * 1.5);
    float d1 = 8.0;
    float d2 = 8.0;
    float idn = 0.0;
    float vis = visible(0.25, fw);
    if (vis > 0.0) {
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 r = g + vec2(hash(cell + g), hash(cell + g + 17.3)) - f;
        float q = dot(r, r);
        if (q < d1) { d2 = d1; d1 = q; idn = hash(cell + g + 3.1); }
        else if (q < d2) d2 = q;
      }
    }
    float edge = sqrt(d2) - sqrt(d1);
    vec3 base = mix(vec3(0.20, 0.20, 0.21), vec3(0.30, 0.29, 0.28), idn);
    base = mix(vec3(0.25, 0.24, 0.23), base, vis);
    base *= mix(1.0, 0.45 + 0.55 * smoothstep(0.02, 0.12, edge), vis);
    base *= 0.72 + 0.56 * fbmM(p, 3.5);
    s.albedo = base;
    s.rough = 0.55;
  } else if (m == SAND) {
    s.albedo = vec3(0.74, 0.64, 0.47) * (0.8 + 0.4 * fbmM(p, 1.6));
    s.rough = 0.95;
  } else if (m == CONCRETE) {
    s.albedo = vec3(0.58, 0.54, 0.47) * (0.72 + 0.5 * fbmM(p, 0.5));
    s.rough = 0.95;
  } else if (m == LEAD) {
    s.albedo = vec3(0.30, 0.31, 0.31) * (0.8 + 0.34 * fbmM(p, 1.5));
    s.metal = 0.0;
    s.rough = 0.8;
  } else if (m == LEAF) {
    vec3 dark = mix(vec3(0.05, 0.095, 0.035), vec3(0.08, 0.125, 0.045), tint);
    vec3 lite = mix(vec3(0.15, 0.21, 0.07), vec3(0.22, 0.27, 0.09), tint);
    float clump = noiseM(p, 0.55) * 0.6 + noiseM(p + 5.0, 0.16) * 0.4;
    s.albedo = mix(dark, lite, smoothstep(0.32, 0.66, clump)) * (0.8 + 0.5 * fbmM(p, 3.0));
    s.rough = 0.85;
    vec3 q = p / (64.0 * 0.4);
    vec3 wob = vec3(texture(uNoise, q).r, texture(uNoise, q).g, texture(uNoise, q).b) - 0.5;
    bumpN = normalize(n + wob * 1.6);
  } else if (m == GRASS) {
    s.albedo = mix(vec3(0.15, 0.21, 0.08), vec3(0.28, 0.30, 0.12), fbmM(p, 2.5)) * (0.84 + 0.32 * noiseM(p, 0.25));
    s.rough = 0.95;
  } else if (m == EARTH) {
    s.albedo = mix(vec3(0.28, 0.24, 0.15), vec3(0.20, 0.26, 0.11), fbmM(p, 2.0));
    s.rough = 0.95;
  } else if (m == CLOTH) {
    int k = int(tint * 255.0) & 7;
    vec3 c = k < 3 ? vec3(0.78, 0.75, 0.68) : k == 3 ? vec3(0.62, 0.48, 0.30) : k == 4 ? vec3(0.50, 0.17, 0.14) : k == 5 ? vec3(0.22, 0.28, 0.42) : k == 6 ? vec3(0.55, 0.52, 0.45) : vec3(0.36, 0.28, 0.20);
    s.albedo = c * (0.8 + 0.3 * noiseM(p, 0.12));
    s.rough = 0.95;
  } else if (m == SKIN) {
    s.albedo = mix(vec3(0.47, 0.31, 0.22), vec3(0.28, 0.18, 0.12), tint);
    s.rough = 0.7;
  } else if (m == DENTIL) {
    // A row of small blocks under a cornice.
    vec3 base = vec3(0.82, 0.80, 0.75) * (0.92 + 0.14 * fbmM(p, 1.0));
    float a = fract(uv.x / 0.42);
    float vis = visible(0.2, fw);
    base *= mix(0.86, 0.55 + 0.45 * step(0.34, a), vis);
    s.albedo = base;
    s.rough = 0.45;
  } else if (m == FRIEZE) {
    // A band of carved relief: garlands and figures, seen as light and shade.
    vec3 base = vec3(0.82, 0.80, 0.75);
    float a = abs(fract(uv.x / 1.7) - 0.5) * 2.0;
    float carved = noiseS(p, vec3(0.28, 0.28, 0.2)) * 0.6 + (0.5 + 0.5 * sin(uv.x * 7.4 + 2.0 * sin(uv.x * 1.85))) * 0.4;
    float vis = visible(0.18, fw);
    base *= mix(0.92, 0.72 + 0.46 * carved, vis);
    base *= 0.9 + 0.14 * a;
    s.albedo = base;
    s.rough = 0.48;
  } else if (m == AWNING) {
    vec3 a = tint < 0.33 ? vec3(0.56, 0.18, 0.13) : tint < 0.66 ? vec3(0.72, 0.66, 0.52) : vec3(0.20, 0.30, 0.40);
    s.albedo = mix(a, a * 0.7, step(0.5, fract(uv.x * 1.6)));
    s.rough = 0.9;
  } else {
    s.albedo = vec3(0.6);
  }
  return s;
}

void main() {
  vec3 n = normalize(vN);
  float fw = max(length(dFdx(vUv)), length(dFdy(vUv)));
  float glass = 0.0;
  vec3 bumped = n;
  Surface s;
  if (vMaterial == FACADE) s = facade(vPos, vUv, vTint, fw, n, glass);
  else s = surface(vMaterial, vPos, vUv, vTint, n, fw, bumped);
  // The eye's side of a face.
  vec3 toEye = uEye - vPos;
  // Foliage has holes in it, up close, where the leaves stop: fewer with distance, none once they would shimmer.
  if (vMaterial == BROAD || vMaterial == NEEDLE) {
    float span = vMaterial == BROAD ? 0.34 : 0.26;
    float gap = texture(uNoise, vPos / (64.0 * span)).r * 0.7 + texture(uNoise, vPos / (64.0 * span * 0.45)).g * 0.3;
    float reach = 1.0 - smoothstep(14.0, 70.0, length(toEye));
    if (gap < 0.46 * reach) discard;
  }
  vec3 w = gl_FrontFacing ? bumped : -bumped;
  float pixel = length(toEye) * 0.002;
  float sh = shadowAt(vPos, gl_FrontFacing ? n : -n, pixel) * cloudShade(vPos);
  float ao = texture(uAO, gl_FragCoord.xy / uAOSize).r;
  float occl = ao * (vLight * 0.5 + 0.5);
  vec3 c = shade(s.albedo, s.rough, s.metal, w, vPos, uEye, occl, sh * mix(1.0, ao, 0.35));
  c = aerial(c, vPos, uEye);
  // Evidence mode: what rests on a reconstruction is amber, what was generated magenta.
  int flags = int(vFlags);
  int basis = flags & 7;
  if (uEvidence > 0.5) {
    float hatch = step(0.62, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0));
    vec3 tint2 = basis >= 3 ? vec3(0.92, 0.25, 0.75) : basis >= 1 ? vec3(0.95, 0.65, 0.18) : vec3(0.3, 0.85, 0.5);
    c = mix(c, tint2 * 1.2, 0.18 + 0.28 * hatch);
  }
  if ((flags & 8) != 0) {
    float e = pow(1.0 - abs(dot(normalize(toEye), n)), 2.0);
    c += vec3(1.0, 0.82, 0.42) * (0.1 + 0.55 * e);
  } else if ((flags & 16) != 0) {
    c += vec3(0.9, 0.8, 0.6) * 0.06;
  }
  o = vec4(c, 1.0);
}`;

// ——— Terrain ———

const GROUND = /* glsl */ `
uniform highp isampler2D uGround0;
uniform highp isampler2D uGround1;
uniform highp isampler2D uGround2;
// Each grid: x0, y0, cell, ease distance; and its size in cells.
uniform vec4 uGrid[3];
uniform vec2 uGridSize[3];
float readGrid(highp isampler2D t, int k, vec2 p) {
  vec2 f = clamp((p - uGrid[k].xy) / uGrid[k].z, vec2(0.0), uGridSize[k] - 1.001);
  ivec2 i = ivec2(floor(f));
  vec2 u = f - vec2(i);
  float a = float(texelFetch(t, i, 0).r);
  float b = float(texelFetch(t, i + ivec2(1, 0), 0).r);
  float c = float(texelFetch(t, i + ivec2(0, 1), 0).r);
  float d = float(texelFetch(t, i + ivec2(1, 1), 0).r);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.1;
}
float gridWeight(int k, vec2 p) {
  vec2 lo = p - uGrid[k].xy;
  vec2 hi = uGrid[k].xy + (uGridSize[k] - 1.0) * uGrid[k].z - p;
  float d = min(min(lo.x, lo.y), min(hi.x, hi.y));
  return smoothstep(0.0, 1.0, d / uGrid[k].w);
}
float groundAt(vec2 p) {
  float z = readGrid(uGround2, 2, p);
  float w1 = gridWeight(1, p);
  if (w1 > 0.0) z = mix(z, readGrid(uGround1, 1, p), w1);
  float w0 = gridWeight(0, p);
  if (w0 > 0.0) z = mix(z, readGrid(uGround0, 0, p), w0);
  return z;
}
`;

export const TERRAIN_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec2 aGrid;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform vec2 uCenter;
uniform float uCell;
uniform float uSeaSurface;
${DROP}
${GROUND}
out vec3 vPos;
invariant gl_Position;
void main() {
  // Toward its outer edge a ring's vertices slide onto the next ring's grid, so they meet without gaps.
  float edge = max(abs(aGrid.x), abs(aGrid.y));
  float m = clamp((edge - 54.0) / 8.0, 0.0, 1.0);
  vec2 even = floor(aGrid * 0.5 + 0.5) * 2.0;
  vec2 g = mix(aGrid, even, m);
  vec2 p = uCenter + g * uCell;
  float z = groundAt(p);
  vPos = vec3(p, z);
  // Where the sea is what is seen, it is drawn at its surface; the depth under it only colours it.
  float shown = uSeaSurface > 0.5 ? max(z, 0.0) : z;
  gl_Position = uViewProj * vec4(vec3(p, shown - drop(p)) - uEye, 1.0);
}`;

export const TERRAIN_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
precision highp sampler2DArrayShadow;
in vec3 vPos;
uniform vec3 uEye;
uniform vec4 uInner;
uniform highp sampler2D uNormal0;
uniform highp sampler2D uNormal1;
uniform highp sampler2D uNormal2;
uniform highp sampler2D uMask;
uniform vec4 uMaskBox;
uniform highp sampler2D uAO;
uniform vec2 uAOSize;
uniform float uUseAO;
uniform float uEvidence;
uniform float uWater;
uniform float uWild;
uniform vec3 uTone[10];
uniform vec3 uShare;
uniform vec4 uGrid[3];
uniform vec2 uGridSize[3];
out vec4 o;
${LIGHTING}
float gridWeight(int k, vec2 p) {
  vec2 lo = p - uGrid[k].xy;
  vec2 hi = uGrid[k].xy + (uGridSize[k] - 1.0) * uGrid[k].z - p;
  float d = min(min(lo.x, lo.y), min(hi.x, hi.y));
  return smoothstep(0.0, 1.0, d / uGrid[k].w);
}
vec2 gridUv(int k, vec2 p) { return ((p - uGrid[k].xy) / uGrid[k].z + 0.5) / uGridSize[k]; }
float shoreHeight;
vec3 normalAt(vec2 p) {
  vec3 t = texture(uNormal2, gridUv(2, p)).rgb;
  float w1 = gridWeight(1, p);
  if (w1 > 0.0) t = mix(t, texture(uNormal1, gridUv(1, p)).rgb, w1);
  float w0 = gridWeight(0, p);
  if (w0 > 0.0) t = mix(t, texture(uNormal0, gridUv(0, p)).rgb, w0);
  // The blue channel is the height near the shore, filtered, so the coast is smooth at any cell size.
  shoreHeight = (t.b * 255.0 - 127.5) / 0.4;
  vec2 n = t.rg * 2.0 - 1.0;
  return normalize(vec3(n, sqrt(max(0.02, 1.0 - dot(n, n)))));
}
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// Fields and woods, seen from the air: a patchwork of plots whose size and tone are chosen by cell.
vec3 countryside(vec3 p, vec3 n, float dist) {
  float slope = 1.0 - n.z;
  float z = p.z;
  vec2 warped = p.xy + vec2(noiseM(p, 120.0), noiseM(p + 91.0, 120.0)) * 110.0;
  vec2 cell = floor(warped / 170.0);
  vec2 f = warped / 170.0 - cell;
  float h = hash(cell);
  vec3 wheat = mix(vec3(0.52, 0.45, 0.25), vec3(0.42, 0.38, 0.19), hash(cell + 2.0));
  vec3 pasture = mix(vec3(0.24, 0.29, 0.13), vec3(0.33, 0.33, 0.16), hash(cell + 5.0));
  vec3 olive = vec3(0.21, 0.25, 0.14);
  vec3 fallow = vec3(0.40, 0.33, 0.24);
  vec3 fieldC = h < 0.34 ? wheat : h < 0.68 ? pasture : h < 0.88 ? olive : fallow;
  float vis = 1.0 - smoothstep(900.0, 9000.0, dist);
  // From far off the plots melt into broad tones: paler plains, greener high ground.
  vec3 broad = mix(vec3(0.34, 0.33, 0.19), vec3(0.20, 0.26, 0.12), smoothstep(0.34, 0.66, fbmM(p, 900.0)));
  broad = mix(broad, vec3(0.13, 0.19, 0.09), smoothstep(160.0, 800.0, z));
  vec3 near = mix(broad, fieldC, vis);
  // Furrows, faint, and gone before they could be seen as stripes from the air.
  float fur = smoothstep(4.0, 30.0, dist) * (1.0 - smoothstep(60.0, 420.0, dist));
  near *= 1.0 - 0.05 * fur * smoothstep(0.25, 0.75, abs(fract((h > 0.5 ? f.x : f.y) * 34.0) - 0.5) * 2.0);
  near *= mix(1.0, 0.84 + 0.16 * smoothstep(0.0, 0.03, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y))), vis);
  // Woods on the slopes and the higher ground.
  float wood = smoothstep(0.03, 0.12, slope + noiseM(p, 26.0) * 0.1) * smoothstep(40.0, 150.0, z + noiseM(p, 16.0) * 170.0);
  wood = max(wood, smoothstep(0.6, 0.72, fbmM(p, 28.0)));
  vec3 forest = mix(vec3(0.06, 0.10, 0.045), vec3(0.11, 0.16, 0.065), noiseM(p, 3.0));
  vec3 c = mix(near, forest, wood);
  // Rock and scree higher up, snow on the highest.
  c = mix(c, vec3(0.36, 0.33, 0.29), smoothstep(1100.0, 1900.0, z));
  c = mix(c, vec3(0.90, 0.92, 0.95), smoothstep(2300.0, 2700.0, z));
  c = mix(c, vec3(0.38, 0.35, 0.30), smoothstep(0.3, 0.55, slope));
  return c * (0.82 + 0.36 * fbmM(p, 60.0));
}
// Land nobody has farmed. The mask says what covers it: R canopy, G low plants, B bare sediment, A water.
// Its colours and shares are the place's climate's: soil, low plants, bare ground, canopy and low plants from afar, each from one tone to another.
vec3 wilderness(vec3 p, vec3 n, float dist, out float water) {
  vec2 muv = (p.xy - uMaskBox.xy) / uMaskBox.zw;
  float inside = step(0.0, muv.x) * step(0.0, muv.y) * step(muv.x, 1.0) * step(muv.y, 1.0);
  // Beyond the plan's map, forest and glade by noise of about the same size, growing with distance so
  // that it never shows as a repeating grain from high up.
  float away = smoothstep(30000.0, 400000.0, dist);
  float patchy = smoothstep(0.42, 0.54, mix(fbmM(p, 110.0), fbmM(p, 5000.0), away)) * uShare.x;
  // And from high up it melts into one tone.
  float melt = smoothstep(60000.0, 500000.0, dist);
  vec4 beyond = mix(vec4(patchy, (1.0 - patchy) * (1.0 - uShare.z), uShare.z, 0.0), vec4(0.6 * uShare.x, (1.0 - 0.6 * uShare.x) * (1.0 - uShare.z), uShare.z, 0.0), melt);
  vec4 mask = beyond;
  if (inside > 0.5) {
    vec2 e = min(muv, 1.0 - muv);
    mask = mix(beyond, texture(uMask, muv), smoothstep(0.0, 0.1, min(e.x, e.y)));
  }
  water = mask.a * smoothstep(450.0, 1000.0, dist);
  float slope = 1.0 - n.z;
  float nearby = 1.0 - smoothstep(40.0, 600.0, dist);
  // Leaf litter under the trees, and earth.
  vec3 soil = mix(uTone[0], uTone[1], fbmM(p, 2.4));
  soil = mix(soil, soil * (0.68 + 0.64 * noiseM(p, 0.16)), nearby);
  // Low plants in patches with bare earth between. What they are is not said: no grass, until grass has spread.
  vec3 herb = mix(uTone[2], uTone[3], fbmM(p, 1.1));
  herb = mix(herb, herb * (0.5 + 1.0 * noiseM(p, 0.09)), nearby);
  float thin = smoothstep(0.42, 0.62, fbmM(p, 2.6) * 0.6 + noiseM(p, 0.6) * 0.4);
  herb = mix(herb, soil, thin * 0.8);
  vec3 bare = mix(uTone[4], uTone[5], fbmM(p, 3.0));
  bare = mix(bare, bare * (0.8 + 0.4 * noiseM(p, 0.06)), nearby);
  vec3 under = mix(soil, herb, (0.35 + 0.65 * smoothstep(0.34, 0.6, fbmM(p, 9.0))) * uShare.y);
  vec3 c = mix(under, herb, mask.g);
  c = mix(c, bare, mask.b);
  // From afar the canopy hides all that, and at the plain's edge no trees are drawn at all.
  float grain = 1.0 - smoothstep(3000.0, 40000.0, dist);
  vec3 canopy = mix(uTone[6], uTone[7], mix(0.5, fbmM(p, 55.0), grain)) * mix(1.0, 0.8 + 0.4 * noiseM(p, 7.0), grain);
  // In the trees' reach the ground shows between them close by, and the canopy further off; beyond it there is only canopy.
  float far = max(smoothstep(500.0, 2400.0, dist), 1.0 - inside);
  c = mix(c, canopy, mask.r * far);
  vec3 distantHerb = mix(uTone[8], uTone[9], mix(0.5, fbmM(p, 90.0), grain));
  c = mix(c, distantHerb, mask.g * smoothstep(900.0, 5000.0, dist));
  // The high ground: rock, and then what stays on top.
  c = mix(c, vec3(0.25, 0.24, 0.18), smoothstep(900.0, 1700.0, p.z + (fbmM(p, 400.0) - 0.5) * 500.0));
  c = mix(c, vec3(0.36, 0.33, 0.28), smoothstep(0.28, 0.5, slope));
  c = mix(c, vec3(0.86, 0.88, 0.9), smoothstep(3000.0, 3400.0, p.z));
  return c;
}
void main() {
  if (vPos.x > uInner.x && vPos.y > uInner.y && vPos.x < uInner.z && vPos.y < uInner.w) discard;
  vec3 p = vPos;
  vec3 n = normalAt(p.xy);
  float dist = distance(p, uEye);
  float fw = dist * 0.0016;
  // Far off, the shadow map is too coarse to trust: the hills' own shading does the work.
  float sh = mix(shadowAt(p, n, fw), 1.0, smoothstep(9000.0, 22000.0, dist)) * cloudShade(p);
  float ao = uUseAO > 0.5 ? texture(uAO, gl_FragCoord.xy / uAOSize).r : 1.0;
  // The sea: anywhere the ground lies under its surface.
  if (shoreHeight <= 0.0) {
    float deep = smoothstep(-5.0, -120.0, p.z);
    vec3 water = mix(vec3(0.06, 0.20, 0.22), vec3(0.015, 0.06, 0.13), deep);
    vec3 wob = vec3(noiseM(p, 8.0) - 0.5, noiseM(p + 9.0, 8.0) - 0.5, 4.0);
    vec3 wn = normalize(vec3(0.0, 0.0, 1.0) + wob * 0.05);
    vec3 c = shade(water, 0.12, 0.0, wn, p, uEye, 1.0, 1.0);
    o = vec4(aerial(c, vec3(p.xy, 0.0), uEye), 1.0);
    return;
  }
  float river = 0.0;
  vec3 c = uWild > 0.5 ? wilderness(p, n, dist, river) : countryside(p, n, dist);
  // Inside the city's map: what the plan says this ground is.
  vec2 muv = (p.xy - uMaskBox.xy) / uMaskBox.zw;
  if (uWild < 0.5 && muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0) {
    vec4 mask = texture(uMask, muv);
    // From far off the river's bed is narrower than the terrain's cells, so its water is painted on.
    river = mask.a * smoothstep(450.0, 1000.0, dist);
    // R built-up ground, G garden.
    float detail = 1.0 - smoothstep(10.0, 400.0, dist);
    float dust = fbmM(p, 5.0);
    vec3 urban = mix(vec3(0.27, 0.24, 0.19), vec3(0.38, 0.33, 0.25), dust);
    urban *= 0.86 + 0.28 * fbmM(p, 0.8);
    // Beaten earth, and worn cobbles in patches of it, up close.
    float cobbled = (1.0 - smoothstep(12.0, 110.0, dist)) * smoothstep(0.42, 0.6, fbmM(p, 1.6));
    if (cobbled > 0.0) {
      vec2 q = p.xy * 2.8;
      vec2 g = floor(q);
      vec2 f = q - g;
      float d1 = 8.0;
      float d2 = 8.0;
      float id = 0.0;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 r = o + vec2(hash(g + o), hash(g + o + 17.3)) - f;
        float e = dot(r, r);
        if (e < d1) { d2 = d1; d1 = e; id = hash(g + o + 3.1); }
        else if (e < d2) d2 = e;
      }
      vec3 stone = mix(vec3(0.24, 0.22, 0.20), vec3(0.40, 0.36, 0.30), id);
      urban = mix(urban, mix(urban * 0.62, stone, smoothstep(0.03, 0.16, sqrt(d2) - sqrt(d1))), cobbled);
    }
    c = mix(c, urban, mask.r);
    // Paved precincts around the monuments: travertine slabs, worn and stained.
    if (mask.b > 0.01) {
      vec2 sl = p.xy / vec2(1.8, 1.05);
      float row = floor(sl.y);
      vec2 cell = vec2(floor(sl.x + mod(row, 2.0) * 0.5), row);
      vec2 f = vec2(fract(sl.x + mod(row, 2.0) * 0.5), fract(sl.y));
      float jv = 1.0 - smoothstep(15.0, 120.0, dist);
      vec3 slab = mix(vec3(0.46, 0.43, 0.37), vec3(0.58, 0.55, 0.48), hash(cell)) * (0.84 + 0.3 * fbmM(p, 6.0));
      slab *= mix(1.0, 0.68 + 0.32 * smoothstep(0.0, 0.025, min(min(f.x, 1.0 - f.x) * 1.8, min(f.y, 1.0 - f.y) * 1.05)), jv);
      c = mix(c, slab, smoothstep(0.35, 0.65, mask.b));
    }
    vec3 garden = mix(vec3(0.12, 0.19, 0.06), vec3(0.24, 0.28, 0.10), fbmM(p, 4.0)) * (0.82 + 0.36 * noiseM(p, 0.4));
    c = mix(c, garden, mask.g);
  }
  // Wet, darker ground at the river's edge.
  if (uWild > 0.5) c = mix(c, vec3(0.15, 0.125, 0.085), smoothstep(uWater + 0.7, uWater + 0.05, p.z) * smoothstep(uWater - 9.0, uWater - 5.0, p.z) * (1.0 - smoothstep(16000.0, 18000.0, length(p.xy))) * 0.9);
  else c = mix(c, vec3(0.28, 0.25, 0.18), smoothstep(uWater + 4.0, uWater + 1.0, p.z) * 0.8);
  vec3 lit = shade(c, 0.92, 0.0, n, p, uEye, ao, sh);
  if (river > 0.0) lit = mix(lit, shade(vec3(0.145, 0.15, 0.085), 0.14, 0.0, vec3(0.0, 0.0, 1.0), p, uEye, 1.0, sh), river);
  lit = aerial(lit, p, uEye);
  if (uEvidence > 0.5) {
    float hatch = step(0.62, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0));
    lit = mix(lit, vec3(0.95, 0.65, 0.18) * 1.1, 0.08 + 0.18 * hatch);
  }
  o = vec4(lit, 1.0);
}`;

export const WATER_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
// Where it flows: its velocity, m/s, and its depth, m.
layout(location = 1) in vec3 aFlow;
uniform mat4 uViewProj;
uniform vec3 uEye;
// How far toward the eye the water is drawn, as a share of its distance.
uniform float uWaterBias;
${DROP}
out vec3 vPos;
out vec3 vFlow;
void main() {
  vPos = aPos;
  vFlow = aFlow;
  // A little toward the eye: where the ground's coarser rings cannot follow a channel, between their corners the ground
  // stands above the water, and the water is still seen in its channel, out to its banks.
  vec3 q = (vec3(aPos.xy, aPos.z - drop(aPos.xy)) - uEye) * (1.0 - uWaterBias);
  gl_Position = uViewProj * vec4(q, 1.0);
}`;

export const WATER_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
precision highp sampler2DArrayShadow;
in vec3 vPos;
in vec3 vFlow;
uniform vec3 uEye;
uniform highp sampler2D uAO;
uniform vec2 uAOSize;
// The shallows' colour, then the depths', where a scene gives them.
uniform float uWaterTone[6];
uniform float uToned;
out vec4 o;
${LIGHTING}
void main() {
  vec3 p = vPos;
  float dist = distance(p, uEye);
  // Ripples, stilled with distance, before they could break up into glitter; drawn out along the current where it flows.
  float speed = length(vFlow.xy);
  vec2 along = speed > 0.01 ? vFlow.xy / speed : vec2(1.0, 0.0);
  vec2 q = vec2(dot(p.xy, along), dot(p.xy, vec2(-along.y, along.x)));
  float stretch = 1.0 + 2.5 * smoothstep(0.05, 1.5, speed);
  q.x /= stretch;
  float amp = mix(0.05, 0.004, smoothstep(15.0, 320.0, dist)) * (1.0 + 0.8 * smoothstep(0.05, 2.0, speed));
  vec3 d1 = vec3(texture(uNoise, vec3(q / 96.0, 0.2)).r, texture(uNoise, vec3(q / 96.0, 0.7)).g, 0.5) - 0.5;
  vec3 d2 = vec3(texture(uNoise, vec3(q / 19.0, 0.4)).b, texture(uNoise, vec3(q / 19.0, 0.9)).r, 0.5) - 0.5;
  vec2 dq = (d1.xy + d2.xy * 0.6) * amp * 3.0;
  vec3 n = normalize(vec3(along * dq.x + vec2(-along.y, along.x) * dq.y, 1.0));
  vec3 v = normalize(uEye - p);
  float sh = shadowAt(p, vec3(0.0, 0.0, 1.0), dist * 0.002);
  vec3 r = reflect(-v, n);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  // The Tiber is silty: green-brown, not blue. A scene's water is its climate's: lighter in the shallows, darker deep.
  vec3 body = vec3(0.145, 0.15, 0.085);
  if (uToned > 0.5) {
    vec3 shallow = vec3(uWaterTone[0], uWaterTone[1], uWaterTone[2]);
    vec3 deep = vec3(uWaterTone[3], uWaterTone[4], uWaterTone[5]);
    body = mix(shallow, deep, smoothstep(0.3, 3.0, vFlow.z));
  }
  vec3 c = body * (uSunColor * max(uSun.z, 0.0) * sh * 0.8 + uSkyTop * 0.6);
  c = mix(c, skyColor(normalize(vec3(r.xy, abs(r.z)))), fres * 0.8);
  c += uSunColor * pow(max(dot(r, uSun), 0.0), 360.0) * 1.4 * sh;
  o = vec4(aerial(c, p, uEye), 1.0);
}`;

// ——— Sky ———

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** One table per sun: the sky seen from the eye's height, by azimuth from the sun and elevation. */
export const SKY_LUT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uSunLut;
uniform float uHeight;
out vec4 o;
const float R0 = 6371000.0;
const float R1 = 6471000.0;
const vec3 RAY = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const float MIE = 14e-6;
vec2 sphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e12, -1e12);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
void main() {
  float az = vUv.x * 3.14159265;
  float k = vUv.y * 2.0 - 1.0;
  float el = sign(k) * k * k * 1.5708;
  // Sun along +x, in the table's frame.
  vec3 s = uSunLut;
  vec3 d = vec3(cos(el) * cos(az), cos(el) * sin(az), sin(el));
  vec3 ro = vec3(0.0, 0.0, R0 + uHeight);
  vec2 hit = sphere(ro, d, R1);
  vec2 g = sphere(ro, d, R0);
  float t1 = hit.y;
  if (g.x > 0.0) t1 = min(t1, g.x);
  float dt = t1 / 18.0;
  vec3 ray = vec3(0.0);
  vec3 mie = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;
  for (int i = 0; i < 18; i++) {
    vec3 p = ro + d * (float(i) + 0.5) * dt;
    float h = length(p) - R0;
    float dR = exp(-h / 8000.0) * dt;
    float dM = exp(-h / 1500.0) * dt;
    odR += dR;
    odM += dM;
    vec2 ls = sphere(p, s, R1);
    vec2 lg = sphere(p, s, R0);
    if (lg.x > 0.0) continue;
    float dl = ls.y / 8.0;
    float lR = 0.0;
    float lM = 0.0;
    for (int j = 0; j < 8; j++) {
      vec3 q = p + s * (float(j) + 0.5) * dl;
      float hq = length(q) - R0;
      lR += exp(-hq / 8000.0) * dl;
      lM += exp(-hq / 1500.0) * dl;
    }
    vec3 tr = exp(-(RAY * (odR + lR) + MIE * 1.1 * (odM + lM)));
    ray += tr * dR;
    mie += tr * dM;
  }
  float mu = dot(d, s);
  float pr = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
  float g2 = 0.76 * 0.76;
  float pm = 3.0 / (8.0 * 3.14159265) * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * 0.76 * mu, 1.5));
  vec3 c = 18.0 * (ray * RAY * pr + mie * MIE * pm);
  o = vec4(c, 1.0);
}`;

export const SKY_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
uniform mat4 uInvViewProj;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform highp sampler2D uSkyLut;
uniform highp sampler3D uNoise;
uniform float uHeight;
uniform float uAlpha;
out vec4 o;
vec3 skyColor(vec3 d) {
  float az = acos(clamp(dot(normalize(d.xy + 1e-5), normalize(uSun.xy + 1e-5)), -1.0, 1.0)) / 3.14159265;
  float el = asin(clamp(d.z, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / 1.5708);
  return texture(uSkyLut, vec2(az, v)).rgb;
}
float clouds(vec2 p) {
  // Soft-edged, on a broad pattern that thins out in places: fair weather.
  float broad = texture(uNoise, vec3(p * 0.11, 0.3)).g;
  float n = texture(uNoise, vec3(p * 0.42, 0.15)).r * 0.5 + texture(uNoise, vec3(p * 1.1, 0.45)).g * 0.3 + texture(uNoise, vec3(p * 2.7, 0.75)).b * 0.2;
  return smoothstep(0.5, 0.74, n + (broad - 0.5) * 0.3);
}
void main() {
  vec4 a = uInvViewProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  vec3 c = skyColor(d);
  // The sun's disc, and its glare in the haze.
  float sd = dot(d, uSun);
  c += uSunColor * smoothstep(0.99985, 0.99995, sd) * 18.0;
  c += uSunColor * pow(max(sd, 0.0), 300.0) * 0.28;
  // Fair-weather clouds, flat on a layer high above, lit by the sun.
  if (d.z > 0.012) {
    vec2 p = d.xy / (d.z + 0.1) * 0.11;
    float m = clouds(p);
    if (m > 0.0) {
      float m2 = clouds(p + uSun.xy * 0.012);
      vec3 lit = mix(uSunColor * 0.9 + vec3(0.35, 0.38, 0.44), vec3(0.42, 0.42, 0.48), m2 * 0.7);
      float far = smoothstep(0.012, 0.16, d.z);
      c = mix(c, lit, m * 0.78 * far);
    }
  }
  o = vec4(c, uAlpha);
}`;

// ——— Ambient occlusion ———

export const AO_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uDepth;
uniform vec2 uProjK;   // tan(fov/2)·aspect, tan(fov/2)
uniform vec2 uNearFar;
uniform vec2 uTexel;
out vec4 o;
float linear(float z) {
  float n = uNearFar.x;
  float f = uNearFar.y;
  return (2.0 * n * f) / (f + n - (z * 2.0 - 1.0) * (f - n));
}
vec3 viewPos(vec2 uv) {
  float d = linear(texture(uDepth, uv).r);
  return vec3((uv * 2.0 - 1.0) * uProjK * d, -d);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  float raw = texture(uDepth, vUv).r;
  if (raw >= 1.0) {
    o = vec4(1.0);
    return;
  }
  vec3 p = viewPos(vUv);
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  float dist = -p.z;
  // The radius grows with distance: nearby the corners of a wall, far away the streets of a city.
  float radius = clamp(dist * 0.035, 0.7, 30.0);
  vec2 sr = radius / (uProjK * dist) * 0.5;
  float a = ign(gl_FragCoord.xy) * 6.2831853;
  float sum = 0.0;
  const int N = 10;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
    float ang = a + t * 6.2831853 * 2.4;
    vec2 uv = vUv + vec2(cos(ang), sin(ang)) * sr * sqrt(t);
    vec3 q = viewPos(uv);
    vec3 v = q - p;
    float vv = dot(v, v);
    float vn = dot(v, n);
    float f = max(radius * radius - vv, 0.0) / (radius * radius);
    sum += f * f * max(vn / (vv + 1e-3 * radius) - 0.02, 0.0) * radius;
  }
  float ao = clamp(1.0 - 1.6 * sum / float(N), 0.0, 1.0);
  o = vec4(ao, ao, ao, 1.0);
}`;

export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uTex;
uniform highp sampler2D uDepth;
uniform vec2 uDir;
uniform vec2 uNearFar;
out vec4 o;
float linear(float z) {
  float n = uNearFar.x;
  float f = uNearFar.y;
  return (2.0 * n * f) / (f + n - (z * 2.0 - 1.0) * (f - n));
}
void main() {
  float d0 = linear(texture(uDepth, vUv).r);
  float sum = 0.0;
  float w = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uDir * float(i);
    float d = linear(texture(uDepth, uv).r);
    float k = exp(-float(i * i) * 0.16) * exp(-abs(d - d0) / (d0 * 0.02 + 0.05));
    sum += texture(uTex, uv).r * k;
    w += k;
  }
  float v = sum / max(w, 1e-4);
  o = vec4(v, v, v, 1.0);
}`;

// ——— Finishing ———

export const BRIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
out vec4 o;
void main() {
  // A soft blur on the way down.
  vec3 c = vec3(0.0);
  c += texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  c += texture(uTex, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
  if (uThreshold > 0.0) {
    float l = max(c.r, max(c.g, c.b));
    c *= smoothstep(uThreshold, uThreshold * 2.0, l);
  }
  o = vec4(min(c, vec3(16.0)), 1.0);
}`;

export const POST_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uScene;
uniform highp sampler2D uBloom0;
uniform highp sampler2D uBloom1;
uniform highp sampler2D uBloom2;
uniform float uExposure;
uniform float uAlpha;
out vec4 o;
vec3 aces(vec3 x) {
  // Narkowicz's fit, with a little more shoulder for skies.
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec4 s = texture(uScene, vUv);
  vec3 c = s.rgb;
  vec3 bloom = texture(uBloom0, vUv).rgb * 0.5 + texture(uBloom1, vUv).rgb * 0.3 + texture(uBloom2, vUv).rgb * 0.2;
  c += bloom * 0.1;
  c *= uExposure;
  c = aces(c);
  // A touch more saturation and warmth, as a film stock gives.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 0.98);
  c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  // Vignette.
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * 0.28;
  o = vec4(c * uAlpha * s.a, uAlpha * s.a);
}`;
