// Procedural surface patterns, version 1 of gen:earth/surface; its parameters and seed are
// in the generator's record. It makes one RGBA texture over an equirectangular grid (row 0
// at 90°N), whose channels the renderer draws a planet's states with:
//   R  when each spot crusts over as a magma ocean cools: plate interiors first, the cracks
//      between plates last (0 earliest, 255 latest)
//   G  hotter and cooler patches of molten rock
//   B  a smooth field that makes the edge of the ice ragged
//   A  fine texture, for ice and bare rock
// The output depends only on the seed and the parameters. Like the clouds, the code uses
// only + − × ÷, floor, Math.sqrt (which ECMAScript requires to be correctly rounded) and
// 32-bit integer operations, so every JavaScript engine produces the same bytes.
import { fbm, hash3, hashString, sinCosDeg } from '../clouds/v1.ts';

/** The record this code implements (world/generators/earth/surface.yaml). */
export const GENERATOR = 'gen:earth/surface';
export const VERSION = 1;

export interface SurfaceParams {
  width: number;
  height: number;
  /** crust plates: plate centres per unit of radius */
  cells: number;
  /** the width of the cracks between plates, as a fraction of a cell */
  crack: number;
  /** how much a plate's own timing varies, 0–1 */
  jitter: number;
  /** strength of the domain warp that bends the plate edges */
  warp: number;
  glow_scale: number;
  ice_scale: number;
  detail_scale: number;
  /** how the renderer draws with the pattern; not used to make it */
  draw: {
    /** the share of a magma surface crusted over at the start and the end of its phase, and of a crust over magma */
    crust: { start: number; end: number; over_magma: number };
    /** how far the ice's edge strays either side of its claimed reach, in degrees */
    ice_edge: number;
  };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Distances to the nearest and second-nearest plate centre, and the nearest's own random value. */
function cellular(x: number, y: number, z: number, seed: number): [number, number, number] {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let d1 = Infinity;
  let d2 = Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const cz = zi + dz;
        const ox = cx + hash3(cx, cy, cz, seed) - x;
        const oy = cy + hash3(cx, cy, cz, seed + 1) - y;
        const oz = cz + hash3(cx, cy, cz, seed + 2) - z;
        const d = ox * ox + oy * oy + oz * oz;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          nx = cx;
          ny = cy;
          nz = cz;
        } else if (d < d2) d2 = d;
      }
    }
  }
  return [Math.sqrt(d1), Math.sqrt(d2), hash3(nx, ny, nz, seed + 3)];
}

/** RGBA per texel of an equirectangular grid (row 0 at 90°N), 0–255. */
export function generateSurface(seed: string, p: SurfaceParams): Uint8Array {
  const s = hashString(seed);
  const out = new Uint8Array(p.width * p.height * 4);
  const lonSC: [number, number][] = [];
  for (let i = 0; i < p.width; i++) lonSC.push(sinCosDeg(-180 + ((i + 0.5) * 360) / p.width));
  const byte = (v: number) => Math.floor(clamp01(v) * 255 + 0.5);
  for (let j = 0; j < p.height; j++) {
    const lat = 90 - ((j + 0.5) * 180) / p.height;
    const [sLat, cLat] = sinCosDeg(lat);
    for (let i = 0; i < p.width; i++) {
      const [sLon, cLon] = lonSC[i];
      const x = cLat * cLon;
      const y = cLat * sLon;
      const z = sLat;
      // Plates: cells on the sphere, their edges bent by a warp so they are not straight.
      const k = p.cells;
      const wx = fbm(x * k + 3.1, y * k, z * k, 2, s + 17) - 0.5;
      const wy = fbm(x * k, y * k + 7.9, z * k, 2, s + 19) - 0.5;
      const wz = fbm(x * k, y * k, z * k + 5.3, 2, s + 23) - 0.5;
      const [d1, d2, own] = cellular(x * k + p.warp * wx, y * k + p.warp * wy, z * k + p.warp * wz, s + 101);
      const inside = clamp01((d2 - d1) / p.crack);
      const order = (1 - inside) * (1 - p.jitter) + own * p.jitter;
      const o = (j * p.width + i) * 4;
      out[o] = byte(order);
      out[o + 1] = byte(fbm(x * p.glow_scale, y * p.glow_scale, z * p.glow_scale, 3, s + 211));
      out[o + 2] = byte(fbm(x * p.ice_scale, y * p.ice_scale, z * p.ice_scale, 3, s + 307));
      out[o + 3] = byte(fbm(x * p.detail_scale, y * p.detail_scale, z * p.detail_scale, 3, s + 401));
    }
  }
  return out;
}
