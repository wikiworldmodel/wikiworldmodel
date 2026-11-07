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
  plate: Uint16Array | Uint32Array;
  /** the grid it is on, if not 1° (SRC_W × SRC_H nodes from 90°N and 180°W) */
  src?: SourceGrid;
}

/** A global grid of nodes `step` degrees apart, from 90°N and 180°W, wrapping east. */
export interface SourceGrid {
  width: number;
  height: number;
  step: number;
}

const ONE_DEGREE: SourceGrid = { width: SRC_W, height: SRC_H, step: 1 };

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
    const p = await readFile(join(dir, 'plate', `${s.ageMa}.u32`));
    const plate = new Uint32Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength));
    snapshots.push({ ageMa: s.ageMa, elev: Int16Array.from(plate, (x) => (x ? BLOCK_INSIDE : -BLOCK_INSIDE)), plate });
  }
  snapshots.sort((a, b) => a.ageMa - b.ageMa);
  return { meta, snapshots };
}

/** Today's relief on its field's grid, with the plate under each node at the present: one snapshot. */
export async function loadRelief(platesDir: string, grid: { nx: number; ny: number; step: number }, elev: Int16Array): Promise<Snapshot> {
  const meta = JSON.parse(await readFile(join(platesDir, 'meta.json'), 'utf8')) as { grid: { width: number; height: number; step: number }; ageMa: number };
  if (meta.grid.width !== grid.nx || meta.grid.height !== grid.ny) throw new Error(`relief: ${grid.nx} × ${grid.ny} nodes, but the plates are on ${meta.grid.width} × ${meta.grid.height}`);
  const p = await readFile(join(platesDir, 'plate', `${meta.ageMa}.u16`));
  const plate = new Uint16Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength));
  return { ageMa: meta.ageMa, elev, plate, src: { width: grid.nx, height: grid.ny, step: grid.step } };
}

/** A gridded field, imported, and the ages it covers. */
export interface GridField {
  field: Field;
  mode: 'elevation' | 'blocks';
  snapshots: Snapshot[];
  /** [older, younger] Ma; younger is negative where a projection holds the field into the future */
  coverMa: [number, number];
  /** the spacing of its grid, in degrees */
  res: number;
  /** for today's relief on a fixed datum: the series of sea level its coastline is drawn at */
  seaLevel?: string;
  /** for a field that moves with a plate model other than the first: what its plates are written plus (PLATE_OFFSET) */
  plateOffset?: number;
  /** for today's relief: the ground as measured, with its hollows, and today's ocean, which the drainage routes over */
  drain?: { z: Float32Array; ocean: Uint8Array; lakes: Uint8Array };
}

/** The gridded field covering a span, if any: the first whose cover overlaps the span's inside. */
export function fieldFor(grids: GridField[], [older, younger]: [number, number]): GridField | undefined {
  return grids.find((g) => g.coverMa[0] > younger && g.coverMa[1] < older);
}

/** The field of the deep past's elevation: the grids of many ages, which the climate, ice and life are laid on. */
export function paleoElevation(grids: GridField[]): GridField | undefined {
  return grids.find((g) => g.mode === 'elevation' && !g.seaLevel);
}

/**
 * Sample a global grid at `grid`'s spacing: elevation tent-filtered over the source nodes within one step of the
 * node, plate from the nearest node itself.
 */
function sample(s: Snapshot, grid: FieldGrid, plateIndex: Map<number, number>, offset = 0): { elev: Int16Array; plate: Uint16Array } {
  const src = s.src ?? ONE_DEGREE;
  const n = grid.nx * grid.ny;
  const elev = new Int16Array(n);
  const plate = new Uint16Array(n);
  const at = (lon: number, lat: number) => {
    const j = ((Math.round((lon + 180) / src.step) % src.width) + src.width) % src.width;
    const i = Math.max(0, Math.min(src.height - 1, Math.round((90 - lat) / src.step)));
    return i * src.width + j;
  };
  // The filter's radius in source nodes: none where the grid is as fine as the source.
  const k = Math.max(0, Math.round(grid.step / src.step) - 1);
  for (let r = 0; r < grid.ny; r++) {
    const lat = grid.lat0 - r * grid.step;
    for (let c = 0; c < grid.nx; c++) {
      const lon = grid.lon0 + c * grid.step;
      let sum = 0;
      let wsum = 0;
      for (let di = -k; di <= k; di++) {
        const la = Math.max(-90, Math.min(90, lat + di * src.step));
        const wi = k + 1 - Math.abs(di);
        for (let dj = -k; dj <= k; dj++) {
          const w = wi * (k + 1 - Math.abs(dj));
          sum += s.elev[at(lon + dj * src.step, la)] * w;
          wsum += w;
        }
      }
      elev[r * grid.nx + c] = Math.round(sum / wsum);
      const p = s.plate[at(lon, lat)];
      plate[r * grid.nx + c] = p ? (plateIndex.get(p + offset) ?? 0) : 0;
    }
  }
  return { elev, plate };
}

export interface FieldLod {
  lod: number;
  step: number;
  /** cells as [west, south, east, north], from the north-west, west to east */
  cells: [number, number, number, number][];
  /** how many cells a row of them has */
  across: number;
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

/** Cells of `size` degrees over the globe, from the north-west, west to east. */
function cellsOf(size: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let y = 0; y < 180 / size; y++) for (let x = 0; x < 360 / size; x++) out.push([-180 + size * x, 90 - size * (y + 1), -180 + size * (x + 1), 90 - size * y]);
  return out;
}

/** The finer levels, for a field whose grid is finer than 1°: their spacing and the size of their cells, in degrees. */
const FINE_LODS = [
  { lod: 2, step: 0.25, cell: 30 },
  { lod: 3, step: 0.1, cell: 10 },
];

/**
 * LOD 0: the globe at 2° in the time bins; LOD 1: 90° cells at 1°, in half-bins, where a
 * gridded field covers them (a bin with no field has nothing to refine). Finer levels in
 * smaller cells, in the bins of the past where a field as fine as the level covers them.
 */
export function fieldLods(bins: [number, number][], grids: GridField[]): FieldLod[] {
  const half: [number, number][] = bins.flatMap(([a, b]) => {
    const m = b + (a - b) / 2;
    return [[m, b], [a, m]] as [number, number][];
  });
  const lods: FieldLod[] = [
    { lod: 0, step: 2, cells: [[-180, -90, 180, 90]], across: 1, binsMa: bins },
    { lod: 1, step: 1, cells: cellsOf(90), across: 4, binsMa: half.filter((h) => fieldFor(grids, h)).sort((p, q) => p[1] - q[1]) },
  ];
  for (const f of FINE_LODS) {
    const binsMa = bins.filter((b) => b[1] >= 0 && (fieldFor(grids, b)?.res ?? Infinity) <= f.step + 1e-9);
    if (binsMa.length) lods.push({ lod: f.lod, step: f.step, cells: cellsOf(f.cell), across: 360 / f.cell, binsMa });
  }
  return lods;
}

/** The grid a tile carries: the cell plus a one-node border, so neighbouring meshes overlap. */
export function tileGrid(lod: FieldLod, cell: [number, number, number, number]): FieldGrid {
  if (lod.lod === 0) return { lon0: -180, lat0: 90, step: lod.step, nx: 360 / lod.step, ny: 180 / lod.step + 1, wrap: true };
  const [w, s, e, n] = cell;
  const top = Math.min(90, n + lod.step);
  const bottom = Math.max(-90, s - lod.step);
  return { lon0: w - lod.step, lat0: top, step: lod.step, nx: Math.round((e - w) / lod.step) + 3, ny: Math.round((top - bottom) / lod.step) + 1, wrap: false };
}

export function sliceField(snapshots: Snapshot[], grid: FieldGrid, plateIndex: Map<number, number>, plateOffset = 0) {
  return snapshots.map((s) => ({ ageMa: s.ageMa, ...sample(s, grid, plateIndex, plateOffset) }));
}
