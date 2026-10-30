// Procedural cloud cover, version 1 of gen:earth/clouds; its parameters and seed are in
// the generator's record. The output depends only on the seed and the parameters, and the
// code uses only + − × ÷, floor and 32-bit integer operations, so every JavaScript engine
// produces the same bytes. That is what lets the build and the browser run it and agree.

/** The record this code implements (world/generators/earth/clouds.yaml). */
export const GENERATOR = 'gen:earth/clouds';
export const VERSION = 1;

export interface CloudParams {
  width: number;
  height: number;
  /** base frequency on the unit sphere */
  scale: number;
  octaves: number;
  /** cloud fraction by latitude: [latitudeDeg, fraction] knots, linearly interpolated */
  profile: [number, number][];
  /** how quickly coverage goes from clear to overcast */
  sharpness: number;
  /** strength of the domain warp that gives the pattern its swirls */
  warp: number;
}

/** FNV-1a, 32 bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const w = fade(z - zi);
  const c000 = hash3(xi, yi, zi, seed);
  const c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed);
  const c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed);
  const c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed);
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

function fbm(x: number, y: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise3(x * f, y * f, z * f, seed + o * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** sin and cos of an angle in degrees, by range reduction and a Taylor series. */
export function sinCosDeg(deg: number): [number, number] {
  let d = deg - 360 * Math.floor((deg + 180) / 360); // [-180, 180)
  let sign = 1;
  if (d > 90) {
    d = 180 - d;
    sign = -1;
  } else if (d < -90) {
    d = -180 - d;
    sign = -1;
  }
  const x = (d * 3.141592653589793) / 180; // [-π/2, π/2]
  const x2 = x * x;
  let s = x;
  let term = x;
  let c = 1;
  let cterm = 1;
  for (let n = 1; n <= 10; n++) {
    term = (-term * x2) / ((2 * n) * (2 * n + 1));
    s += term;
    cterm = (-cterm * x2) / ((2 * n - 1) * (2 * n));
    c += cterm;
  }
  return [s, sign * c];
}

function coverage(profile: [number, number][], lat: number): number {
  for (let i = 0; i < profile.length - 1; i++) {
    const [a, fa] = profile[i];
    const [b, fb] = profile[i + 1];
    if (lat >= a && lat <= b) return fa + ((lat - a) / (b - a)) * (fb - fa);
  }
  return profile[profile.length - 1][1];
}

/** Cloud density per texel of an equirectangular grid (row 0 at 90°N), 0–255. */
export function generateClouds(seed: string, p: CloudParams): Uint8Array {
  const s = hashString(seed);
  const out = new Uint8Array(p.width * p.height);
  const lonSC: [number, number][] = [];
  for (let i = 0; i < p.width; i++) lonSC.push(sinCosDeg(-180 + ((i + 0.5) * 360) / p.width));
  for (let j = 0; j < p.height; j++) {
    const lat = 90 - ((j + 0.5) * 180) / p.height;
    const [sLat, cLat] = sinCosDeg(lat);
    const cov = coverage(p.profile, lat);
    for (let i = 0; i < p.width; i++) {
      const [sLon, cLon] = lonSC[i];
      const x = cLat * cLon * p.scale;
      const y = cLat * sLon * p.scale;
      const z = sLat * p.scale;
      const wx = fbm(x + 5.2, y + 1.3, z, 2, s + 7) - 0.5;
      const wy = fbm(x, y + 9.7, z + 2.8, 2, s + 11) - 0.5;
      const n = fbm(x + p.warp * wx * p.scale, y + p.warp * wy * p.scale, z, p.octaves, s);
      let d = (n - (1 - cov)) * p.sharpness + 0.5;
      d = d < 0 ? 0 : d > 1 ? 1 : d;
      out[j * p.width + i] = Math.floor(d * 255 + 0.5);
    }
  }
  return out;
}
