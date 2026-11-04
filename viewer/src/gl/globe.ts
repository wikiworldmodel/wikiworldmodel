// The globe: background (stars, atmosphere halo), the surface shaded from the field cube map,
// and the cloud layer. The coastline is derived here, as the sea-level isoline of the
// blended field, so it is never stored and always agrees with the terrain under it.
//
// The surface has three modes, after the field that covers the time shown: elevation;
// continental blocks (inside a block or not, no relief and no sea level); and none, where no
// geography is known and the globe is drawn plain.
//
// Over the mode go the planet's states at the time (core/planet.ts): a magma ocean or a
// crust over magma, an atmosphere of rock vapour or steam, the ice of a glaciation, and,
// where the map is unknown, the oceans or bare rock of the time. The states are claims; how
// they look here, and the surface generator's pattern they are drawn with, is procedural.
//
// Where a field has the ice sheets of the time, they take the place of a claimed latitude of ice: their
// edge is the field's, and it moves between its keyframes.
//
// Over the land, polities' territory (ui/territory.ts): one polity per channel of a map
// texture, its land tinted and its frontiers outlined. Its coasts are the field's.
//
// Over the land too, when asked for, where people lived (ui/layers.ts): a map texture of how
// dense they are, on the viewer's scale. Its coasts are the field's as well.
import { THICKNESS_TOP } from '../../../core/ice.ts';
import type { Cover, Look } from '../../../core/planet.ts';
import type { SurfaceParams } from '../../../world/generators/earth/surface/v1.ts';
import { program, setUniforms, texture2D, type GL, type Program } from './context.ts';
import type { Mat4 } from '../mat.ts';

const SPHERE_VS = `#version 300 es
precision highp float;
in vec3 aPos;
uniform mat4 uViewProj;
uniform float uRadius;
out vec3 vN;
void main() {
  vN = aPos;
  gl_Position = uViewProj * vec4(aPos * uRadius, 1.0);
}`;

const SURFACE_FS = `#version 300 es
precision highp float;
uniform highp samplerCube uField;
uniform highp sampler2D uPattern;
uniform float uMix;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uEvidence;
uniform float uCoast;
uniform float uTexel;
uniform int uMode;
// The planet's state: surface 0 as the mode draws it, 1 oceans, 2 magma, 3 crust over
// magma, 4 bare rock; air 0 today's sky, 1 rock vapour.
uniform int uSurface;
uniform int uAir;
uniform float uCrust;
uniform float uIceReach;
uniform float uIceEdge;
uniform vec3 uRim;
uniform highp sampler2D uTerritory;
uniform float uTerritoryOn;
uniform mat3 uTerritoryColors;
uniform int uTerritorySel;
// The climate of the land at the two keyframes around the time shown, as the climate field holds it.
uniform highp samplerCube uClimate0;
uniform highp samplerCube uClimate1;
uniform float uClimateMix;
uniform float uClimateOn;
// How far each cover has spread: microbial crusts, land plants, forests, grasslands.
uniform vec4 uCover;
uniform float uReefs;
// The biome rule's thresholds: polar, frost, tropical, cold; arid, desert, reef depth and latitude.
uniform vec4 uRule;
uniform vec4 uRule2;
uniform highp sampler2D uBiomeTex;
// The ice sheets, moved with their plates: R and G how far the keyframes on either side of the time
// shown are from their margin, with 0.5 at the margin; B and A the root of their thickness.
uniform highp samplerCube uIce;
uniform float uIceOn;
uniform float uIceMix;
uniform float uIceTop;
// Where people lived: how dense they are, from 0 to 1 on the viewer's scale.
uniform highp sampler2D uPeople;
uniform float uPeopleOn;
in vec3 vN;
out vec4 o;

float elev(vec3 n) {
  vec4 f = texture(uField, n);
  return mix(f.r, f.g, uMix);
}

// A tent filter about one source cell wide: the source grid is 1°, and its isolines are
// rounder after smoothing at that scale than straight off the triangulated grid.
float smoothElev(vec3 n, vec3 t1, vec3 t2, float h) {
  float s = 4.0 * elev(n);
  s += 2.0 * (elev(normalize(n + t1 * h)) + elev(normalize(n - t1 * h)) + elev(normalize(n + t2 * h)) + elev(normalize(n - t2 * h)));
  s += elev(normalize(n + (t1 + t2) * h)) + elev(normalize(n + (t1 - t2) * h)) + elev(normalize(n - (t1 - t2) * h)) + elev(normalize(n - (t1 + t2) * h));
  return s / 16.0;
}

vec3 ramp(float e) {
  if (e < 0.0) {
    float d = clamp(-e / 6500.0, 0.0, 1.0);
    vec3 shelf = vec3(0.20, 0.52, 0.66);
    vec3 mid = vec3(0.06, 0.25, 0.45);
    vec3 deep = vec3(0.025, 0.08, 0.20);
    vec3 c = mix(shelf, mid, smoothstep(0.0, 0.35, d));
    return mix(c, deep, smoothstep(0.35, 1.0, d));
  }
  float h = e / 1000.0;
  vec3 low = vec3(0.47, 0.53, 0.33);
  vec3 up = vec3(0.62, 0.57, 0.38);
  vec3 high = vec3(0.55, 0.45, 0.33);
  vec3 peak = vec3(0.86, 0.84, 0.80);
  vec3 c = mix(low, up, smoothstep(0.1, 0.9, h));
  c = mix(c, high, smoothstep(0.9, 2.4, h));
  return mix(c, peak, smoothstep(2.8, 5.0, h));
}

// Continental blocks: bare crust and open water, their relief and depth unknown.
vec3 blockRamp(float e) {
  return e < 0.0 ? vec3(0.07, 0.24, 0.40) : vec3(0.52, 0.48, 0.42);
}

float graticule(vec3 n) {
  float lat = degrees(asin(clamp(n.z, -1.0, 1.0)));
  float lon = degrees(atan(n.y, n.x));
  float glat = 1.0 - smoothstep(0.0, 1.5 * fwidth(lat), abs(mod(lat + 15.0, 30.0) - 15.0));
  float glon = 1.0 - smoothstep(0.0, 1.5 * fwidth(lon), abs(mod(lon + 15.0, 30.0) - 15.0));
  return max(glat, glon);
}

// No geography known: a plain sphere with a 30° graticule.
vec3 unknownSurface(vec3 n) {
  float light = 0.35 + 0.75 * max(dot(n, uSun), 0.0);
  return vec3(0.11, 0.14, 0.20) * light + vec3(0.32, 0.38, 0.50) * graticule(n) * 0.3;
}

// Where a direction falls on an equirectangular map, row 0 at the north pole.
vec2 mapUv(vec3 n) {
  float lon = atan(n.y, n.x);
  float lat = asin(clamp(n.z, -1.0, 1.0));
  return vec2(lon / 6.28318530718 + 0.5, 0.5 - lat / 3.14159265359);
}

// The surface generator's pattern: R when a spot crusts over, G hot and cool melt, B the
// ice's edge, A fine texture.
vec4 pattern(vec3 n) {
  return textureGrad(uPattern, mapUv(n), vec2(0.0), vec2(0.0));
}

// The generator's texture of the land's cover, at a scale in repeats around the globe. Its level of
// detail is worked out from the direction, not the map position, which jumps at the date line.
vec4 coverTex(vec3 n, float scale) {
  vec2 uv = mapUv(n) * vec2(scale, scale * 0.5);
  vec2 g = vec2(length(fwidth(n)) * scale * 0.16);
  return textureGrad(uBiomeTex, uv, vec2(g.x, 0.0), vec2(0.0, g.y));
}

// What covers the land here: the climate says what could grow, and the world's transitions what had
// come to exist by now. With no land plants yet, only rock, sand, frost and a film of microbes are drawn.
vec3 biome(vec3 n, float e, float reach) {
  vec4 k = mix(texture(uClimate0, n), texture(uClimate1, n), uClimateMix);
  vec4 wide = coverTex(n, 5.0);
  vec4 near = coverTex(n, 37.0);
  float rag = (wide.b - 0.5) + (near.b - 0.5) * 0.5;
  float hot = k.r * 110.0 - 60.0 + rag * 6.0;
  float cold = k.g * 110.0 - 60.0 + rag * 6.0;
  float wetness = k.b * k.b * 4.0 * (1.0 + rag * 0.8);
  float margin = k.a * 300.0 - 150.0 + rag * 50.0;
  float polar = smoothstep(uRule.x + 1.0, uRule.x - 1.0, hot);
  float frost = smoothstep(uRule.y + 1.0, uRule.y - 1.0, hot);
  float dry = smoothstep(uRule2.x * 1.06, uRule2.x * 0.94, wetness) * (1.0 - polar);
  float desert = smoothstep(uRule2.y * 1.1, uRule2.y * 0.9, wetness) * (1.0 - polar);
  float tropical = smoothstep(uRule.z - 1.0, uRule.z + 1.0, cold);
  float boreal = smoothstep(uRule.w + 1.0, uRule.w - 1.0, cold);
  float rainy = smoothstep(-8.0, 8.0, margin);
  float fine = mix(wide.a, near.a, reach);
  float mott = mix(wide.r, near.r, reach);
  float streak = mix(wide.g, near.g, reach);
  // Bare ground: rock and weathered regolith, and sand where it is driest.
  vec3 rock = mix(vec3(0.44, 0.37, 0.30), vec3(0.58, 0.50, 0.41), fine);
  vec3 sand = mix(vec3(0.80, 0.68, 0.47), vec3(0.67, 0.53, 0.35), streak);
  vec3 c = mix(rock, sand, desert);
  // Microbial crusts darken damp ground.
  c = mix(c, c * vec3(0.72, 0.70, 0.60), uCover.x * (1.0 - dry) * (1.0 - frost) * 0.8);
  // Low plants on damp ground, patchy at first and thickening as they spread; tundra is the same to the eye.
  vec3 low = mix(vec3(0.30, 0.34, 0.15), vec3(0.42, 0.42, 0.22), fine);
  float patches = smoothstep(1.0 - uCover.y * 1.15, 1.0 - uCover.y * 0.75, mott);
  c = mix(c, low, patches * (1.0 - dry) * (1.0 - frost));
  // Trees, in the colours of their climates, where it is warm and wet enough.
  vec3 trees = mix(vec3(0.17, 0.30, 0.11), vec3(0.11, 0.22, 0.08), mott);
  trees = mix(trees, mix(vec3(0.10, 0.19, 0.11), vec3(0.06, 0.13, 0.08), mott), boreal);
  trees = mix(trees, mix(vec3(0.05, 0.19, 0.06), vec3(0.10, 0.27, 0.08), mott), tropical * rainy);
  float woods = smoothstep(1.0 - uCover.z * 1.15, 1.0 - uCover.z * 0.75, wide.r * 0.5 + 0.25) * (1.0 - dry) * (1.0 - polar);
  c = mix(c, trees, woods * (1.0 - tropical * (1.0 - rainy) * 0.8));
  // Open country: where grasses have come it is grassland, before them scrub.
  vec3 grass = mix(vec3(0.55, 0.49, 0.24), vec3(0.43, 0.43, 0.19), mott);
  vec3 scrub = mix(vec3(0.42, 0.40, 0.25), vec3(0.34, 0.34, 0.18), mott);
  vec3 open = mix(scrub, grass, uCover.w);
  float seasonal = tropical * (1.0 - rainy) * (1.0 - dry) * (1.0 - polar);
  c = mix(c, open, uCover.y * max(seasonal, dry * (1.0 - desert)) * 0.95);
  // Above the trees, bare rock; and ice where no month thaws, unless a field says where the ice sheets
  // are: then that is theirs to say, and ground that never thaws is left bare.
  float h = e / 1000.0;
  vec3 bare = vec3(0.50, 0.44, 0.37) * (0.85 + 0.3 * fine);
  c = mix(c, bare, smoothstep(2.6, 3.6, h));
  if (uIceOn > 0.5) c = mix(c, bare, frost);
  c = mix(c, vec3(0.90, 0.92, 0.95) * (0.92 + 0.14 * fine), max(uIceOn > 0.5 ? 0.0 : frost, smoothstep(4.2, 5.4, h)));
  return c;
}

// Territory over the land: each channel's polity tinted, its frontier outlined, brighter for
// the one selected. Nothing is drawn over the sea, so the coasts stay the field's.
vec3 territory(vec3 c, vec3 n, float land, float diffuse) {
  vec3 cover = textureGrad(uTerritory, mapUv(n), vec2(0.0), vec2(0.0)).rgb;
  for (int i = 0; i < 3; i++) {
    float v = cover[i];
    vec3 col = uTerritoryColors[i];
    float w = max(fwidth(v), 0.02);
    float frontier = (1.0 - smoothstep(0.0, 1.6 * w, abs(v - 0.5))) * land;
    c = mix(c, col * (0.3 + 0.8 * diffuse), smoothstep(0.3, 0.7, v) * land * 0.34);
    c = mix(c, mix(col, vec3(1.0), 0.4), frontier * (i == uTerritorySel ? 1.0 : 0.7));
  }
  return c;
}

// Glowing rock, from dull red to yellow-white as x goes from 0 to 1.
vec3 heat(float x) {
  vec3 c = mix(vec3(0.22, 0.02, 0.0), vec3(0.85, 0.22, 0.02), smoothstep(0.0, 0.4, x));
  c = mix(c, vec3(1.0, 0.62, 0.14), smoothstep(0.35, 0.75, x));
  return mix(c, vec3(1.0, 0.93, 0.68), smoothstep(0.7, 1.0, x));
}

// Where people lived: the land dimmed, so that they show against desert and ice alike, and a glow
// that starts from nothing and stays dark until there are many. Nothing is drawn over the sea, so the
// coasts stay the field's. The legend's bar (style.css) runs the same way.
vec3 people(vec3 c, vec3 n, float land) {
  float v = textureGrad(uPeople, mapUv(n), vec2(0.0), vec2(0.0)).r;
  return mix(c, mix(c * 0.4, heat(v * v), smoothstep(0.02, 0.35, v)), land);
}

// Molten rock where the crust has not formed yet, dark crust where it has; the crust glows
// a little where it is youngest, next to the melt.
vec3 magma(vec4 p, float crust, float light) {
  float w = max(fwidth(p.r), 0.004);
  float solid = 1.0 - smoothstep(crust - w, crust + w, p.r);
  float hot = clamp((p.r - crust) / 0.3, 0.0, 1.0);
  vec3 melt = heat(clamp(0.38 + 0.42 * hot + 1.1 * (p.g - 0.5), 0.0, 1.0));
  float young = smoothstep(crust - 0.1, crust, p.r);
  vec3 rock = vec3(0.075, 0.062, 0.058) * (0.25 + 0.9 * light) * (0.8 + 0.4 * p.a) + vec3(0.32, 0.05, 0.0) * young * 0.55;
  return mix(melt, rock, solid);
}

// How much of a spot is under ice: poleward of the claimed reach, its edge made ragged.
float iceCover(vec3 n, vec4 p) {
  if (uIceReach >= 90.0) return 0.0;
  if (uIceReach <= 0.0) return 1.0;
  float lat = abs(degrees(asin(clamp(n.z, -1.0, 1.0))));
  float edge = uIceReach + clamp((p.b - 0.5) * 4.0, -1.0, 1.0) * uIceEdge;
  float w = max(fwidth(lat), 0.08);
  return smoothstep(edge - w, edge + w, lat);
}

// The height of the ice sheets' surface, in metres: the thickness over the ground the globe has here.
// It leaves out how far the ground sank under the ice, which is broad and smooth.
float iceSurface(vec3 n) {
  vec4 s = textureLod(uIce, n, 0.0);
  vec4 f = textureLod(uField, n, 0.0);
  return mix(f.r, f.g, uMix) + mix(s.b * s.b, s.a * s.a, uIceMix) * uIceTop;
}

void main() {
  vec3 n = normalize(vN);
  vec3 view = normalize(uEye - n);
  float rim = pow(1.0 - max(dot(n, view), 0.0), 3.0);
  float hatch = step(0.62, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0));
  vec3 magenta = vec3(0.92, 0.25, 0.75);
  vec4 p = pattern(n);
  // An atmosphere of rock vapour hides the surface: the planet glows like an ember.
  if (uAir == 1) {
    float mu = max(dot(n, view), 0.0);
    vec3 c = heat(clamp(0.74 + 0.9 * (p.g - 0.5), 0.0, 1.0)) * (0.5 + 0.5 * pow(mu, 0.45));
    c = mix(c, magenta, uEvidence * (0.14 + 0.26 * hatch));
    o = vec4(c + uRim * rim * 0.45, 1.0);
    return;
  }
  // Magma, or crust over magma, covers whatever the map has.
  if (uSurface == 2 || uSurface == 3) {
    vec3 c = magma(p, uCrust, max(dot(n, uSun), 0.0));
    c = mix(c, vec3(0.88, 0.9, 0.93) * (0.35 + 0.75 * max(dot(n, uSun), 0.0)), iceCover(n, p));
    c = mix(c, magenta, uEvidence * (0.14 + 0.26 * hatch));
    o = vec4(c + uRim * rim * 0.45, 1.0);
    return;
  }
  if (uMode == 2) {
    // No map: the plain globe, or the oceans or bare rock of the time with a faint graticule,
    // since where the land was is not known.
    float diffuse = max(dot(n, uSun), 0.0);
    vec3 c = unknownSurface(n);
    if (uSurface == 1) {
      c = vec3(0.035, 0.15, 0.30) * (0.22 + 0.85 * diffuse);
      c += vec3(0.55, 0.65, 0.75) * pow(max(dot(reflect(-uSun, n), view), 0.0), 60.0) * 0.35;
      c += vec3(0.32, 0.38, 0.50) * graticule(n) * 0.12;
    } else if (uSurface == 4) {
      c = vec3(0.46, 0.38, 0.30) * (0.75 + 0.5 * p.a) * (0.22 + 0.85 * diffuse);
      c += vec3(0.32, 0.38, 0.50) * graticule(n) * 0.12;
    }
    float ice = iceCover(n, p);
    c = mix(c, vec3(0.80, 0.87, 0.93) * (0.86 + 0.24 * p.a) * (0.35 + 0.75 * diffuse), ice);
    if (uSurface != 0) c = mix(c, magenta, uEvidence * (0.14 + 0.26 * hatch));
    o = vec4(c + uRim * rim * 0.45, 1.0);
    return;
  }
  vec3 ref = abs(n.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, n));
  vec3 t2 = cross(n, t1);
  float e = smoothElev(n, t1, t2, 0.006) - uCoast;
  float h = uTexel;
  float ex = elev(normalize(n + t1 * h)) - elev(normalize(n - t1 * h));
  float ey = elev(normalize(n + t2 * h)) - elev(normalize(n - t2 * h));
  float exaggeration = uMode == 1 ? 0.0 : e > 0.0 ? 30.0 : 8.0;  // e is relative to the coastline isoline
  vec3 grad = (t1 * ex + t2 * ey) / (2.0 * h * 6371000.0) * exaggeration;
  vec3 bump = normalize(n - grad);
  float diffuse = max(dot(bump, uSun), 0.0);
  vec3 base = uMode == 1 ? blockRamp(e) : ramp(e);
  if (uMode == 0 && uClimateOn > 0.5) {
    // Close up the cover's texture is finer: from a third of an Earth radius above the ground.
    float reach = smoothstep(1.9, 1.25, length(uEye));
    if (e >= 0.0) base = biome(n, e, reach);
    else if (uReefs > 0.5 && e > -uRule2.z && abs(n.z) < sin(radians(uRule2.w))) {
      // Reefs on warm shelves, broken up by the generator's speckle.
      vec4 t = coverTex(n, 37.0);
      float reef = smoothstep(0.55, 0.8, t.a) * smoothstep(-uRule2.z, -uRule2.z * 0.4, e);
      base = mix(base, vec3(0.42, 0.78, 0.72), reef * 0.75);
    }
  }
  vec3 c = base * (0.22 + 0.85 * diffuse);
  if (e < 0.0) {
    float spec = pow(max(dot(reflect(-uSun, n), view), 0.0), 60.0);
    c += vec3(0.55, 0.65, 0.75) * spec * 0.35;
  }
  // Ice: sheets over the land, sea ice over the water, their pattern procedural.
  float de = max(fwidth(e), 1.0);
  float ice = iceCover(n, p);
  if (ice > 0.0) {
    vec3 sheet = mix(vec3(0.80, 0.87, 0.93) * (0.86 + 0.24 * p.a), vec3(0.93, 0.95, 0.97), smoothstep(-0.5, 0.5, e / de));
    c = mix(c, sheet * (0.35 + 0.75 * diffuse), ice);
  }
  // The ice sheets of a field: their edge between the keyframes is where the distance to it, moved
  // evenly from one to the next, comes to nothing. Grounded ice, whether the sea or the land is under it.
  float sheets = 0.0;
  if (uIceOn > 0.5) {
    vec4 s = texture(uIce, n);
    float d = mix(s.r, s.g, uIceMix) - 0.5;
    float w = max(fwidth(d), 0.0008);
    sheets = smoothstep(-w, w, d);
    if (sheets > 0.0) {
      // Over about a node of the grid, so that its domes are shaded and not its nodes.
      float ih = 0.012;
      float ix = iceSurface(normalize(n + t1 * ih)) - iceSurface(normalize(n - t1 * ih));
      float iy = iceSurface(normalize(n + t2 * ih)) - iceSurface(normalize(n - t2 * ih));
      vec3 domes = normalize(n - (t1 * ix + t2 * iy) / (2.0 * ih * 6371000.0) * 22.0);
      float thin = smoothstep(0.0, 0.14, mix(s.b * s.b, s.a * s.a, uIceMix));
      vec3 sheet = mix(vec3(0.76, 0.84, 0.92), vec3(0.95, 0.97, 0.98), thin) * (0.95 + 0.1 * p.a);
      c = mix(c, sheet * (0.3 + 0.8 * max(dot(domes, uSun), 0.0)), sheets);
    }
  }
  // Coastline: the sea-level isoline, about one pixel wide; fainter under ice.
  float line = 1.0 - smoothstep(0.5, 1.5, abs(e) / de);
  if (uPeopleOn > 0.5) c = people(c, n, smoothstep(0.5, 1.5, e / de));
  if (uTerritoryOn > 0.5) c = territory(c, n, smoothstep(0.5, 1.5, e / de), diffuse);
  c = mix(c, vec3(0.93, 0.96, 0.95), line * 0.85 * (1.0 - 0.5 * max(ice, sheets)));
  // Evidence mode: the whole field is a reconstruction — amber hatching, the ice sheets of a field too;
  // ice from a claimed latitude is procedural.
  c = mix(c, mix(vec3(0.95, 0.65, 0.18), magenta, ice), uEvidence * (0.14 + 0.26 * hatch));
  c += uRim * rim * 0.45;
  o = vec4(c, 1.0);
}`;

const CLOUD_FS = `#version 300 es
precision highp float;
uniform sampler2D uClouds;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uEvidence;
uniform float uOpacity;
uniform float uBase;
uniform vec3 uTint;
uniform vec3 uGlow;
in vec3 vN;
out vec4 o;
void main() {
  vec3 n = normalize(vN);
  float lon = atan(n.y, n.x);
  float lat = asin(clamp(n.z, -1.0, 1.0));
  vec2 uv = vec2(lon / 6.28318530718 + 0.5, 0.5 - lat / 3.14159265359);
  float d = textureGrad(uClouds, uv, vec2(0.0), vec2(0.0)).r;
  float light = 0.35 + 0.75 * max(dot(n, uSun), 0.0);
  // Lit from above, and from below by anything glowing under the clouds.
  vec3 c = uTint * light + uGlow * max(1.0 - light, 0.0);
  float a = min(d * uOpacity + uBase, 1.0);
  // Evidence mode: procedural — magenta, thinned.
  c = mix(c, vec3(0.92, 0.25, 0.75), uEvidence * 0.75);
  a *= 1.0 - 0.45 * uEvidence;
  o = vec4(c * a, a);
}`;

const SKY_VS = `#version 300 es
precision highp float;
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
uniform mat4 uInvViewProj;
uniform vec3 uEye;
uniform vec3 uHalo;
in vec2 vNdc;
out vec4 o;
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
  vec4 a = uInvViewProj * vec4(vNdc, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  float bq = dot(uEye, d);
  float r = sqrt(max(dot(uEye, uEye) - bq * bq, 0.0));
  vec3 c = vec3(0.008, 0.012, 0.03);
  // Stars: at most one per cell of a direction grid, at a random spot in the cell.
  vec3 g = d * 180.0;
  vec3 cell = floor(g);
  float s = hash(cell);
  vec3 spot = vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1)) * 0.6 + 0.2;
  float sr = length(fract(g) - spot);
  float star = step(0.985, s) * smoothstep(0.09, 0.0, sr) * (0.25 + 0.75 * hash(cell + 7.0));
  c += vec3(0.9, 0.93, 1.0) * star;
  if (bq < 0.0) {
    float glow = exp(-max(r - 1.0, 0.0) * 28.0) * smoothstep(0.97, 1.0, r);
    c += uHalo * glow * 0.9;
  }
  o = vec4(c, 1.0);
}`;

function sphere(segLon: number, segLat: number): { pos: Float32Array; idx: Uint32Array } {
  const pos = new Float32Array((segLon + 1) * (segLat + 1) * 3);
  let o = 0;
  for (let j = 0; j <= segLat; j++) {
    const lat = Math.PI / 2 - (j / segLat) * Math.PI;
    for (let i = 0; i <= segLon; i++) {
      const lon = -Math.PI + (i / segLon) * 2 * Math.PI;
      pos[o++] = Math.cos(lat) * Math.cos(lon);
      pos[o++] = Math.cos(lat) * Math.sin(lon);
      pos[o++] = Math.sin(lat);
    }
  }
  const idx = new Uint32Array(segLon * segLat * 6);
  o = 0;
  for (let j = 0; j < segLat; j++) {
    for (let i = 0; i < segLon; i++) {
      const a = j * (segLon + 1) + i;
      const b = a + 1;
      const c = a + segLon + 1;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], o);
      o += 6;
    }
  }
  return { pos, idx };
}

type RGB = [number, number, number];

/** How the globe draws the planet's state: what the shaders are told. */
export interface GlobeLook {
  /** false: the planet has not formed, and only the sky is drawn */
  formed: boolean;
  /** 0 as the mode draws it, 1 oceans, 2 magma, 3 crust over magma, 4 bare rock */
  surface: number;
  /** 0 today's sky, 1 rock vapour */
  air: number;
  /** the share of a molten surface crusted over, 0–1 */
  crust: number;
  /** the lowest latitude ice reaches, in degrees; 90 is none */
  iceReach: number;
  iceEdge: number;
  /** how far each cover of the land has spread, 0–1 */
  cover: Cover;
  rim: RGB;
  halo: RGB;
  /** cover is density × opacity + base */
  clouds: { opacity: number; base: number; tint: RGB; glow: RGB } | null;
}

const RIM: RGB = [0.25, 0.45, 0.85];
const HALO: RGB = [0.22, 0.42, 0.95];
const CLEAR_CLOUDS = { opacity: 0.78, base: 0, tint: [1, 1, 1] as RGB, glow: [0, 0, 0] as RGB };
const NONE: RGB = [0, 0, 0];

/** As the world was drawn before it had states: today's sky, clouds, no ice. */
export const PLAIN_LOOK: GlobeLook = { formed: true, surface: 0, air: 0, crust: 0, iceReach: 90, iceEdge: 0, cover: { crust: 0, plants: 0, forests: 0, grasses: 0, reefs: 0 }, rim: RIM, halo: HALO, clouds: CLEAR_CLOUDS };

const SURFACES: Record<string, number> = { ocean: 1, magma: 2, 'crust-and-magma': 3, 'bare-rock': 4 };

/**
 * The drawing of a state. Clouds need water: oceans or a steam atmosphere, which is all but
 * overcast and lit from below by the magma; over a Snowball Earth they are thin. Where no
 * atmosphere is claimed the sky is today's, except over a molten surface, drawn bare.
 */
export function globeLook(look: Look, draw: SurfaceParams['draw'] | undefined, cover?: Cover): GlobeLook {
  if (!look.formed) return { ...PLAIN_LOOK, formed: false, rim: NONE, halo: NONE, clouds: null };
  const surface = SURFACES[look.surface ?? ''] ?? 0;
  const crustAt = draw?.crust ?? { start: 0, end: 0.96, over_magma: 0.82 };
  const crust = surface === 3 ? crustAt.over_magma : crustAt.start + (crustAt.end - crustAt.start) * look.progress;
  const base = { ...PLAIN_LOOK, surface, crust, iceReach: look.iceReach, iceEdge: draw?.ice_edge ?? 5, cover: cover ?? PLAIN_LOOK.cover };
  if (look.atmosphere === 'rock-vapour') return { ...base, air: 1, rim: [1.0, 0.62, 0.28], halo: [1.0, 0.55, 0.2], clouds: null };
  if (look.atmosphere === 'steam') {
    const glow = 1 - crust;
    return { ...base, rim: [0.82, 0.82, 0.84], halo: [0.78, 0.8, 0.86], clouds: { opacity: 0.6, base: 0.55, tint: [0.88, 0.88, 0.9], glow: [0.55 * glow, 0.12 * glow, 0.02 * glow] } };
  }
  if (surface === 2 || surface === 3) return { ...base, rim: NONE, halo: NONE, clouds: null };
  if (surface === 4) return { ...base, clouds: null };
  if (look.iceReach <= 0) return { ...base, clouds: { ...CLEAR_CLOUDS, opacity: 0.45 } };
  return base;
}

/** Polities' territory over the land: whether any is drawn, each channel's colour, and the one selected. */
export interface GlobeTerritory {
  on: boolean;
  colors: [number, number, number][];
  /** the channel of the polity selected, or −1 */
  selected: number;
}

export interface GlobeFrame {
  viewProj: Mat4;
  invViewProj: Mat4;
  eye: [number, number, number];
  sun: [number, number, number];
  mix: number;
  evidence: number;
  coast: number;
  /** 0: elevation, 1: continental blocks, 2: no geography known */
  mode: number;
  look: GlobeLook;
  showClouds: boolean;
  territory?: GlobeTerritory;
  /** the climate's mix between its two keyframes, if the land is painted from it */
  climate?: { mix: number; rule: { polar: number; frost: number; tropical: number; cold: number; arid: number; desert: number; reef_depth: number; reef_latitude: number } };
  /** the ice sheets' mix between the keyframes drawn, where a field has them at this time */
  ice?: { mix: number };
  /** where people lived is drawn: the clouds, which are made up, thin out so as not to hide it */
  people?: boolean;
}

export class GlobeRenderer {
  private surface: Program;
  private clouds: Program;
  private sky: Program;
  private vao: WebGLVertexArrayObject;
  private count: number;
  private cloudTex: WebGLTexture | null = null;
  private patternTex: WebGLTexture;
  private territoryTex: WebGLTexture;
  private biomeTex: WebGLTexture;
  private peopleTex: WebGLTexture;
  private peopleSize: [number, number] = [1, 1];
  private emptyVao: WebGLVertexArrayObject;
  /** the climate's two cube maps, once the field has them */
  climateCubes: [WebGLTexture, WebGLTexture] | null = null;
  /** the ice sheets' cube, once the field has it */
  iceCube: WebGLTexture | null = null;

  constructor(private gl: GL, private fieldCube: WebGLTexture, private cubeSize: number) {
    this.surface = program(gl, 'surface', SPHERE_VS, SURFACE_FS);
    this.clouds = program(gl, 'clouds', SPHERE_VS, CLOUD_FS);
    this.sky = program(gl, 'sky', SKY_VS, SKY_FS);
    const { pos, idx } = sphere(256, 128);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    for (const p of [this.surface, this.clouds]) {
      const loc = gl.getAttribLocation(p.program, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    }
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.count = idx.length;
    gl.bindVertexArray(null);
    this.emptyVao = gl.createVertexArray()!;
    // Until the surface generator has run, a flat pattern: nothing is drawn from it.
    this.patternTex = texture2D(gl, { width: 1, height: 1, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: new Uint8Array([128, 128, 128, 128]), filter: gl.LINEAR, wrapS: gl.REPEAT });
    this.territoryTex = texture2D(gl, { width: 1, height: 1, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: new Uint8Array([0, 0, 0, 255]), filter: gl.LINEAR, wrapS: gl.REPEAT });
    this.biomeTex = texture2D(gl, { width: 1, height: 1, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: new Uint8Array([128, 128, 128, 128]), filter: gl.LINEAR, wrapS: gl.REPEAT });
    this.peopleTex = texture2D(gl, { width: 1, height: 1, internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, data: new Uint8Array([0]), filter: gl.LINEAR, wrapS: gl.REPEAT });
  }

  /** The generator's texture of the land's cover: a tile that repeats both ways. */
  setBiomeTexture(size: number, rgba: Uint8Array): void {
    const gl = this.gl;
    gl.deleteTexture(this.biomeTex);
    this.biomeTex = texture2D(gl, { width: size, height: size, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: rgba, filter: gl.LINEAR, wrapS: gl.REPEAT });
    gl.bindTexture(gl.TEXTURE_2D, this.biomeTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  /** Polities' territory: an equirectangular map, one polity per colour channel. */
  setTerritory(map: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.territoryTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, map);
  }

  /** Where people lived: an equirectangular map, row 0 at the north, of how dense they are on the viewer's scale. It changes with the time shown. */
  setPeople(width: number, height: number, levels: Uint8Array): void {
    const gl = this.gl;
    if (width !== this.peopleSize[0] || height !== this.peopleSize[1]) {
      gl.deleteTexture(this.peopleTex);
      this.peopleTex = texture2D(gl, { width, height, internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, data: levels, filter: gl.LINEAR, wrapS: gl.REPEAT });
      this.peopleSize = [width, height];
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.peopleTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, levels);
  }

  setClouds(width: number, height: number, density: Uint8Array): void {
    const gl = this.gl;
    if (this.cloudTex) gl.deleteTexture(this.cloudTex);
    this.cloudTex = texture2D(gl, { width, height, internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, data: density, filter: gl.LINEAR, wrapS: gl.REPEAT });
  }

  /** The surface generator's pattern: RGBA over an equirectangular grid. */
  setPattern(width: number, height: number, rgba: Uint8Array): void {
    const gl = this.gl;
    gl.deleteTexture(this.patternTex);
    this.patternTex = texture2D(gl, { width, height, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: rgba, filter: gl.LINEAR, wrapS: gl.REPEAT });
  }

  render(f: GlobeFrame, width: number, height: number): void {
    const gl = this.gl;
    const look = f.look;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.sky.program);
    setUniforms(gl, this.sky, { uInvViewProj: f.invViewProj, uEye: f.eye, uHalo: look.halo });
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!look.formed) {
      gl.bindVertexArray(null);
      return;
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.bindVertexArray(this.vao);
    gl.useProgram(this.surface.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.fieldCube);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.patternTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.territoryTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.biomeTex);
    const cl = f.climate && this.climateCubes ? this.climateCubes : null;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, cl ? cl[0] : this.fieldCube);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, cl ? cl[1] : this.fieldCube);
    const iceCube = f.ice ? this.iceCube : null;
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, iceCube ?? this.fieldCube);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.peopleTex);
    setUniforms(gl, this.surface, { uField: 0, uPattern: 1, uTerritory: 2, uBiomeTex: 3, uClimate0: 4, uClimate1: 5, uIce: 6, uPeople: 7 }, ['uField', 'uPattern', 'uTerritory', 'uBiomeTex', 'uClimate0', 'uClimate1', 'uIce', 'uPeople']);
    setUniforms(gl, this.surface, { uIceOn: iceCube ? 1 : 0, uIceMix: f.ice?.mix ?? 0, uIceTop: THICKNESS_TOP });
    const r = f.climate?.rule;
    const cv = look.cover;
    setUniforms(gl, this.surface, {
      uClimateOn: cl ? 1 : 0,
      uClimateMix: f.climate?.mix ?? 0,
      uCover: [cv.crust, cv.plants, cv.forests, cv.grasses],
      uReefs: cv.reefs,
      uRule: r ? [r.polar, r.frost, r.tropical, r.cold] : [0, 0, 0, 0],
      uRule2: r ? [r.arid, r.desert, r.reef_depth, r.reef_latitude] : [0, 0, 0, 0],
    });
    const ter = f.territory;
    setUniforms(gl, this.surface, { uTerritoryOn: ter?.on ? 1 : 0, uTerritoryColors: (ter?.colors ?? [[0, 0, 0], [0, 0, 0], [0, 0, 0]]).flat(), uTerritorySel: ter?.selected ?? -1 }, ['uTerritorySel']);
    setUniforms(gl, this.surface, {
      uViewProj: f.viewProj,
      uRadius: 1,
      uMix: f.mix,
      uSun: f.sun,
      uEye: f.eye,
      uEvidence: f.evidence,
      uCoast: f.coast,
      uTexel: 1.5 / this.cubeSize,
      uCrust: look.crust,
      uIceReach: look.iceReach,
      uIceEdge: look.iceEdge,
      uRim: look.rim,
    });
    setUniforms(gl, this.surface, { uPeopleOn: f.people ? 1 : 0 });
    setUniforms(gl, this.surface, { uMode: f.mode, uSurface: look.surface, uAir: look.air }, ['uMode', 'uSurface', 'uAir']);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.activeTexture(gl.TEXTURE0);

    if (f.showClouds && this.cloudTex && look.clouds) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(this.clouds.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
      setUniforms(gl, this.clouds, { uClouds: 0 }, ['uClouds']);
      const thin = f.people ? 0.3 : 1;
      setUniforms(gl, this.clouds, { uViewProj: f.viewProj, uRadius: 1.008, uSun: f.sun, uEye: f.eye, uEvidence: f.evidence, uOpacity: look.clouds.opacity * thin, uBase: look.clouds.base * thin, uTint: look.clouds.tint, uGlow: look.clouds.glow });
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }
}
