// The ground of a site: nested grids of heights in its local metres, from a fine survey of the
// city out to a coarse relief of the region (a finer field over a site replaces the coarse one
// there: section 4.7). The finest is today's ground, smoothed of its survey's facets, with the
// river carved in and lowered to the ancient levels the records give where a structure stands.
import { fromLocal, type GroundLevel } from '../../../../core/city.ts';
import { datasetFile } from '../manifest.ts';
import { readTiff, sampleRaster, utm, type Raster } from '../tiff.ts';
import type { World } from '../world.ts';

export interface GroundGrid extends Omit<GroundLevel, 'url'> {
  /** metres above sea level, row 0 at the south */
  z: Float32Array;
}

export interface FlatPlace {
  rings: number[][];
  level: number;
  /** how far around it the ground eases back, in metres */
  margin: number;
}

type Origin = { lat: number; lon: number };

function grid(x0: number, y0: number, nx: number, ny: number, cell: number, at: (x: number, y: number) => number | undefined): GroundGrid {
  const z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = at(x0 + i * cell, y0 + j * cell) ?? 0;
  return { x0, y0, nx, ny, cell, z };
}

/** Blur along rows and columns with a gaussian of `sigma` cells. */
export function blur(g: GroundGrid, sigma: number): void {
  const r = Math.ceil(sigma * 3);
  const k: number[] = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp((-0.5 * i * i) / (sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0);
  const { nx, ny, z } = g;
  const line = new Float32Array(Math.max(nx, ny));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) line[i] = z[j * nx + i];
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let t = -r; t <= r; t++) s += k[t + r] * line[Math.max(0, Math.min(nx - 1, i + t))];
      z[j * nx + i] = s / sum;
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) line[j] = z[j * nx + i];
    for (let j = 0; j < ny; j++) {
      let s = 0;
      for (let t = -r; t <= r; t++) s += k[t + r] * line[Math.max(0, Math.min(ny - 1, j + t))];
      z[j * nx + i] = s / sum;
    }
  }
}

/** Is a point inside rings, by the even-odd rule? */
export function inRings(rings: number[][], x: number, y: number): boolean {
  let inside = false;
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = r[i * 2 + 1];
      const yj = r[j * 2 + 1];
      if (yi > y !== yj > y && x < ((r[j * 2] - r[i * 2]) * (y - yi)) / (yj - yi) + r[i * 2]) inside = !inside;
    }
  }
  return inside;
}

/**
 * Distance in metres from each cell of a box of the grid to the nearest cell inside the rings,
 * by a two-pass chamfer. Cells inside are 0.
 */
function distanceTo(g: GroundGrid, rings: number[][], i0: number, j0: number, i1: number, j1: number): Float32Array {
  const w = i1 - i0 + 1;
  const h = j1 - j0 + 1;
  const d = new Float32Array(w * h).fill(1e9);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (rings.some((r) => inRings([r], g.x0 + (i0 + i) * g.cell, g.y0 + (j0 + j) * g.cell))) d[j * w + i] = 0;
  const a = g.cell;
  const b = g.cell * Math.SQRT2;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let v = d[j * w + i];
      if (i > 0) v = Math.min(v, d[j * w + i - 1] + a);
      if (j > 0) {
        v = Math.min(v, d[(j - 1) * w + i] + a);
        if (i > 0) v = Math.min(v, d[(j - 1) * w + i - 1] + b);
        if (i < w - 1) v = Math.min(v, d[(j - 1) * w + i + 1] + b);
      }
      d[j * w + i] = v;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      let v = d[j * w + i];
      if (i < w - 1) v = Math.min(v, d[j * w + i + 1] + a);
      if (j < h - 1) {
        v = Math.min(v, d[(j + 1) * w + i] + a);
        if (i > 0) v = Math.min(v, d[(j + 1) * w + i - 1] + b);
        if (i < w - 1) v = Math.min(v, d[(j + 1) * w + i + 1] + b);
      }
      d[j * w + i] = v;
    }
  }
  return d;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function boxOf(g: GroundGrid, rings: number[][], margin: number): [number, number, number, number] | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 2) {
      x0 = Math.min(x0, r[i]);
      x1 = Math.max(x1, r[i]);
      y0 = Math.min(y0, r[i + 1]);
      y1 = Math.max(y1, r[i + 1]);
    }
  }
  const i0 = Math.max(0, Math.floor((x0 - margin - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((y0 - margin - g.y0) / g.cell));
  const i1 = Math.min(g.nx - 1, Math.ceil((x1 + margin - g.x0) / g.cell));
  const j1 = Math.min(g.ny - 1, Math.ceil((y1 + margin - g.y0) / g.cell));
  return i0 > i1 || j0 > j1 ? undefined : [i0, j0, i1, j1];
}

/** Bring the ground under a place to its level, easing back to what was there across the margin. */
export function flatten(g: GroundGrid, f: FlatPlace): void {
  const box = boxOf(g, f.rings, f.margin);
  if (!box) return;
  const [i0, j0, i1, j1] = box;
  const d = distanceTo(g, f.rings, i0, j0, i1, j1);
  const w = i1 - i0 + 1;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const t = smoothstep(f.margin, 0, d[(j - j0) * w + (i - i0)] - g.cell * 0.5);
      if (t > 0) g.z[j * g.nx + i] += (f.level - g.z[j * g.nx + i]) * t;
    }
  }
}

/** Bring the ground at a point to a level, and everything around it with it, easing out to a radius. */
export function lowerAround(g: GroundGrid, x: number, y: number, level: number, radius: number): void {
  const delta = level - sampleGrid(g, x, y);
  if (delta >= 0) return;
  const i0 = Math.max(0, Math.floor((x - radius - g.x0) / g.cell));
  const i1 = Math.min(g.nx - 1, Math.ceil((x + radius - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((y - radius - g.y0) / g.cell));
  const j1 = Math.min(g.ny - 1, Math.ceil((y + radius - g.y0) / g.cell));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(g.x0 + i * g.cell - x, g.y0 + j * g.cell - y);
      g.z[j * g.nx + i] += delta * smoothstep(radius, radius * 0.4, d);
    }
  }
}

/** Cut a river into the ground: its bed under the rings, and low banks easing up to the land around. */
export function carve(g: GroundGrid, water: number[][], islands: number[][], level: number, bank: number): void {
  const box = boxOf(g, water, bank);
  if (!box) return;
  const [i0, j0, i1, j1] = box;
  const d = distanceTo(g, water, i0, j0, i1, j1);
  const w = i1 - i0 + 1;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dist = d[(j - j0) * w + (i - i0)];
      const at = j * g.nx + i;
      const x = g.x0 + i * g.cell;
      const y = g.y0 + j * g.cell;
      if (islands.some((r) => inRings([r], x, y))) g.z[at] = level + 3.5;
      else if (dist <= 0) g.z[at] = level - 4;
      else g.z[at] = Math.min(g.z[at], level + 1.5 + (g.z[at] - level - 1.5) * smoothstep(0, bank, dist));
    }
  }
}

/** The median height of the grid within rings, or at their first point if none falls inside. */
export function medianUnder(g: GroundGrid, rings: number[][]): number {
  const box = boxOf(g, rings, 0);
  const vals: number[] = [];
  if (box) {
    const [i0, j0, i1, j1] = box;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inRings(rings, g.x0 + i * g.cell, g.y0 + j * g.cell)) vals.push(g.z[j * g.nx + i]);
  }
  if (!vals.length) return sampleGrid(g, rings[0][0], rings[0][1]);
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

export function sampleGrid(g: GroundGrid, x: number, y: number): number {
  const fx = Math.max(0, Math.min(g.nx - 1.001, (x - g.x0) / g.cell));
  const fy = Math.max(0, Math.min(g.ny - 1.001, (y - g.y0) / g.cell));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const u = fx - i;
  const v = fy - j;
  const at = j * g.nx + i;
  return g.z[at] * (1 - u) * (1 - v) + g.z[at + 1] * u * (1 - v) + g.z[at + g.nx] * (1 - u) * v + g.z[at + g.nx + 1] * u * v;
}

/** Heights to a file: little-endian int16 decimetres above sea level. Depths past what fits are clamped. */
export function encodeGrid(g: GroundGrid): Uint8Array {
  const out = new Int16Array(g.z.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-32000, Math.min(32000, Math.round(g.z[i] * 10)));
  return new Uint8Array(out.buffer);
}

const dataset = (w: World, id: string, name?: string) => datasetFile(id, w.manifest.datasets[id], name);

/** The survey of the city, smoothed: today's ground, bare of buildings. */
export async function cityGrid(w: World, origin: Origin): Promise<GroundGrid> {
  const dem = await readTiff(dataset(w, 'src:tinitaly-1.1-w46075', 'dem'));
  const g = grid(-6400, -6400, 1281, 1261, 10, (x, y) => {
    const [lat, lon] = fromLocal(origin, x, y);
    const [e, n] = utm(lat, lon, 32);
    return sampleRaster(dem, e, n);
  });
  // The survey is a mesh of flat triangles from sparse points: round off their edges.
  blur(g, 4);
  return g;
}

/** The hills around the city, from radar: its buildings and woods are averaged away by the grid. */
export async function hillsGrid(w: World, origin: Origin): Promise<GroundGrid> {
  const tiles: Raster[] = [await readTiff(dataset(w, 'src:srtm-gl1-n41e012')), await readTiff(dataset(w, 'src:srtm-gl1-n42e012'))];
  const g = grid(-40000, -40000, 1601, 1601, 50, (x, y) => {
    const [lat, lon] = fromLocal(origin, x, y);
    for (const t of tiles) {
      const v = sampleRaster(t, lon, lat);
      if (v !== undefined && v > -500) return Math.max(0, v);
    }
    return 0;
  });
  blur(g, 1.6);
  return g;
}

/** The region, with the sea floor. */
export async function regionGrid(w: World, origin: Origin): Promise<GroundGrid> {
  const tiles: Raster[] = [await readTiff(dataset(w, 'src:etopo-2022-n45e000')), await readTiff(dataset(w, 'src:etopo-2022-n45e015'))];
  return grid(-480000, -480000, 1201, 1031, 800, (x, y) => {
    const [lat, lon] = fromLocal(origin, x, y);
    for (const t of tiles) {
      const v = sampleRaster(t, lon, lat);
      if (v !== undefined) return v;
    }
    return 0;
  });
}

