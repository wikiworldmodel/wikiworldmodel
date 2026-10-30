// Field tiles: slice the imported keyframes into the space × time × LOD tile tree.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FieldGrid } from '../../../../core/tileset.ts';

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

/** LOD 0: the globe at 2° in log-scaled time bins; LOD 1: 90° cells at 1° in half-bins. */
export function fieldLods(maxAgeMa: number): FieldLod[] {
  const top: [number, number][] = [[20, 0], [40, 20], [80, 40], [160, 80], [maxAgeMa, 160]];
  const half: [number, number][] = top.flatMap(([a, b]) => {
    const m = b + (a - b) / 2;
    return [[m, b], [a, m]] as [number, number][];
  });
  const cells1: [number, number, number, number][] = [];
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) cells1.push([-180 + 90 * x, -90 * y, -90 + 90 * x, 90 - 90 * y]);
  return [
    { lod: 0, step: 2, cells: [[-180, -90, 180, 90]], binsMa: top },
    { lod: 1, step: 1, cells: cells1, binsMa: half.sort((p, q) => p[1] - q[1]) },
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
