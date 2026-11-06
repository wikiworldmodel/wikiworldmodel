// The texture of the land's cover, version 1 of gen:earth/biome-texture; its parameters and seed
// are in the generator's record. It makes one RGBA tile that repeats in both directions:
//   R  the mottling of a forest's canopy
//   G  long streaks, for dunes and dry ground
//   B  a smooth field that makes the edge between two covers ragged
//   A  fine speckle, for rock, low plants and reefs
// The output depends only on the seed and the parameters, and the code uses only + − × ÷, floor
// and 32-bit integer operations; the build and the browser are held to agree within the tolerance
// of core/fingerprint.ts.
import { hash3, hashString } from '../clouds/v1.ts';

/** The record this code implements (world/generators/earth/biome.yaml). */
export const GENERATOR = 'gen:earth/biome-texture';
export const VERSION = 1;

export interface BiomeTextureParams {
  size: number;
  canopy: number;
  streaks: number;
  edges: number;
  speckle: number;
  octaves: number;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Value noise on a torus of `period` cells across. */
function periodic(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const wrap = (n: number, p: number) => ((n % p) + p) % p;
  const at = (i: number, j: number) => hash3(wrap(i, periodX), wrap(j, periodY), 0, seed);
  const a = at(xi, yi);
  const b = at(xi + 1, yi);
  const c = at(xi, yi + 1);
  const d = at(xi + 1, yi + 1);
  const top = a + (b - a) * u;
  return top + (c + (d - c) * u - top) * v;
}

/** Octaves of periodic noise, each with twice the cells and half the weight. */
function fbm(u: number, v: number, cellsX: number, cellsY: number, octaves: number, seed: number): number {
  let sum = 0;
  let weight = 0;
  let w = 1;
  let px = cellsX;
  let py = cellsY;
  for (let o = 0; o < octaves; o++) {
    sum += periodic(u * px, v * py, px, py, seed + o * 131) * w;
    weight += w;
    w *= 0.5;
    px *= 2;
    py *= 2;
  }
  return sum / weight;
}

/** RGBA per texel of a tile, `size` on a side, 0–255. */
export function generateBiomeTexture(seed: string, p: BiomeTextureParams): Uint8Array {
  const s = hashString(seed);
  const n = p.size;
  const out = new Uint8Array(n * n * 4);
  const byte = (x: number) => Math.floor(Math.max(0, Math.min(1, x)) * 255 + 0.5);
  // Noise piles up towards its middle: stretch it so the channels use their range.
  const stretch = (x: number) => (x - 0.5) * 2.2 + 0.5;
  for (let j = 0; j < n; j++) {
    const v = (j + 0.5) / n;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const o = (j * n + i) * 4;
      out[o] = byte(stretch(fbm(u, v, p.canopy, p.canopy, p.octaves, s + 11)));
      out[o + 1] = byte(stretch(fbm(u, v, p.streaks, p.streaks * 4, p.octaves, s + 23)));
      out[o + 2] = byte(stretch(fbm(u, v, p.edges, p.edges, p.octaves + 1, s + 37)));
      out[o + 3] = byte(stretch(fbm(u, v, p.speckle, p.speckle, 2, s + 53)));
    }
  }
  return out;
}
