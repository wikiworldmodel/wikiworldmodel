// Field tiles: slice the imported keyframes into the space × time × LOD tile tree.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FieldGrid } from '../../../../core/tileset.ts';
import type { Field } from '../world.ts';

export const SRC_W = 360;
export const SRC_H = 181;

export interface Snapshot {
  ageMa: number;
  elev: Int16Array;
  /** plate ids, as imported */
  plate: Uint16Array;
}

export interface ImportMeta {
  snapshots: { ageMa: number; alignment: { land_inside_polygons: number }; corrections: unknown[] }[];
  pygplates: string;
}

export async function loadSnapshots(dir: string): Promise<{ meta: ImportMeta; snapshots: Snapshot[] }> {
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as ImportMeta;
  const snapshots: Snapshot[] = [];
  for (const s of meta.snapshots) {
    const e = await readFile(join(dir, 'elev', `${s.ageMa}.i16`));
    const p = await readFile(join(dir, 'plate', `${s.ageMa}.u16`));
    snapshots.push({
      ageMa: s.ageMa,
      elev: new Int16Array(e.buffer.slice(e.byteOffset, e.byteOffset + e.byteLength)),
      plate: new Uint16Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength)),
    });
  }
  snapshots.sort((a, b) => a.ageMa - b.ageMa);
  return { meta, snapshots };
}

/** The value a blocks field takes inside a continental block; outside, its negative. */
export const BLOCK_INSIDE = 1000;

export interface BlocksMeta {
  snapshots: { ageMa: number; polygons: number; polygons_without_rotation: number }[];
  pygplates: string;
}

/** Blocks snapshots: the plate ids as imported, and a mask in the place of elevation. */
export async function loadBlocks(dir: string): Promise<{ meta: BlocksMeta; snapshots: Snapshot[] }> {
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as BlocksMeta;
  const snapshots: Snapshot[] = [];
  for (const s of meta.snapshots) {
    const p = await readFile(join(dir, 'plate', `${s.ageMa}.u16`));
    const plate = new Uint16Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength));
    snapshots.push({ ageMa: s.ageMa, elev: Int16Array.from(plate, (x) => (x ? BLOCK_INSIDE : -BLOCK_INSIDE)), plate });
  }
  snapshots.sort((a, b) => a.ageMa - b.ageMa);
  return { meta, snapshots };
}

/** A gridded field, imported, and the ages it covers. */
export interface GridField {
  field: Field;
  mode: 'elevation' | 'blocks';
  snapshots: Snapshot[];
  /** [older, younger] Ma; younger is negative where a projection holds the field into the future */
  coverMa: [number, number];
}

/** The gridded field covering a span, if any: the first whose cover overlaps the span's inside. */
export function fieldFor(grids: GridField[], [older, younger]: [number, number]): GridField | undefined {
  return grids.find((g) => g.coverMa[0] > younger && g.coverMa[1] < older);
}

const idx = (lon: number, lat: number) => {
  const j = ((((lon + 180) % 360) + 360) % 360) | 0;
  const i = 90 - lat;
  return i * SRC_W + j;
};

/** Sample a global grid at `step`° spacing: elevation tent-filtered, plate from the node itself. */
function sample(s: Snapshot, grid: FieldGrid, plateIndex: Map<number, number>): { elev: Int16Array; plate: Uint16Array } {
  const n = grid.nx * grid.ny;
  const elev = new Int16Array(n);
  const plate = new Uint16Array(n);
  const k = grid.step === 1 ? 0 : 1; // filter radius in source nodes
  for (let r = 0; r < grid.ny; r++) {
    const lat = grid.lat0 - r * grid.step;
    for (let c = 0; c < grid.nx; c++) {
      const lon = grid.lon0 + c * grid.step;
      let sum = 0;
      let wsum = 0;
      for (let di = -k; di <= k; di++) {
        const la = Math.max(-90, Math.min(90, lat + di));
        const wi = di === 0 ? 2 : 1;
        for (let dj = -k; dj <= k; dj++) {
          const w = k ? wi * (dj === 0 ? 2 : 1) : 1;
          sum += s.elev[idx(lon + dj, la)] * w;
          wsum += w;
        }
      }
      elev[r * grid.nx + c] = Math.round(sum / wsum);
      plate[r * grid.nx + c] = plateIndex.get(s.plate[idx(lon, lat)]) ?? 0;
    }
  }
  return { elev, plate };
}

export interface FieldLod {
  lod: number;
  step: number;
  /** cells as [west, south, east, north] */
  cells: [number, number, number, number][];
  binsMa: [number, number][];
}

/**
 * Time bins in Ma, as [older, younger], over a world's span: each twice as long as the one
 * nearer the present, in both directions (0–20, 20–40, 40–80 … Ma, and the same into the
 * future), and split wherever a gridded field starts or ends, so one field covers each bin,
 * or none does.
 */
export function timeBins(olderMa: number, youngerMa: number, cuts: number[]): [number, number][] {
  const edges = new Set<number>([0, olderMa, youngerMa, ...cuts]);
  for (let e = 20; e < olderMa; e *= 2) edges.add(e);
  for (let e = -20; e > youngerMa; e *= 2) edges.add(e);
  const sorted = [...edges].filter((e) => e <= olderMa && e >= youngerMa).sort((a, b) => a - b);
  return sorted.slice(1).map((e, i) => [e, sorted[i]]);
}

/**
 * LOD 0: the globe at 2° in the time bins; LOD 1: 90° cells at 1°, in half-bins, where a
 * gridded field covers them (a bin with no field has nothing to refine).
 */
export function fieldLods(bins: [number, number][], grids: GridField[]): FieldLod[] {
  const half: [number, number][] = bins.flatMap(([a, b]) => {
    const m = b + (a - b) / 2;
    return [[m, b], [a, m]] as [number, number][];
  });
  const cells1: [number, number, number, number][] = [];
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) cells1.push([-180 + 90 * x, -90 * y, -90 + 90 * x, 90 - 90 * y]);
  return [
    { lod: 0, step: 2, cells: [[-180, -90, 180, 90]], binsMa: bins },
    { lod: 1, step: 1, cells: cells1, binsMa: half.filter((h) => fieldFor(grids, h)).sort((p, q) => p[1] - q[1]) },
  ];
}

/** The grid a tile carries: the cell plus a one-node border, so neighbouring meshes overlap. */
export function tileGrid(lod: FieldLod, cell: [number, number, number, number]): FieldGrid {
  if (lod.lod === 0) return { lon0: -180, lat0: 90, step: lod.step, nx: 360 / lod.step, ny: 180 / lod.step + 1, wrap: true };
  const [w, s, e, n] = cell;
  const top = Math.min(90, n + lod.step);
  const bottom = Math.max(-90, s - lod.step);
  return { lon0: w - lod.step, lat0: top, step: lod.step, nx: (e - w) / lod.step + 3, ny: (top - bottom) / lod.step + 1, wrap: false };
}

export function sliceField(snapshots: Snapshot[], grid: FieldGrid, plateIndex: Map<number, number>) {
  return snapshots.map((s) => ({ ageMa: s.ageMa, ...sample(s, grid, plateIndex) }));
}
