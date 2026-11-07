// The climate field (climate.lwt): from the months of a model's runs, a keyframe per run on a grid
// the globe can warp with the plates. The model has land where it has it; a node it has no land at
// takes the nearest land's climate, so that the field's own coasts, drawn from the elevation, always
// find a climate under them. Those nodes are marked, and land wins where warping folds them together.
import { encodeTile } from '../../../../core/container.ts';
import { encodeNode, LAND_BIT, reduceMonths, type ClimateHeader, type ClimateNode, type ClimateRule } from '../../../../core/climate.ts';
import { climateClass, CLIMATE_LABEL, type ClimateClass } from '../../../../core/climate.ts';
import { conj, rotate, toLatLon, unitVector } from '../../../../core/quat.ts';
import { toMa } from '../../../../core/time.ts';
import type { FieldGrid } from '../../../../core/tileset.ts';
import { claimOf, subjectTime, type Solved } from './records.ts';
import { datasetFile } from '../manifest.ts';
import { openNetcdf } from '../netcdf.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stableStringify } from '../util.ts';
import type { Field, World } from '../world.ts';
import type { Snapshot } from './fields.ts';

const SRC_W = 360;

/** Every grid the keyframes share: nodes every 2°, the first at 90°N and 180°W, wrapping east. */
export function climateGrid(step: number): FieldGrid {
  return { lon0: -180, lat0: 90, step, nx: 360 / step, ny: 180 / step + 1, wrap: true };
}

export interface ClimateKeyframe {
  ageMa: number;
  /** the age whose coordinates its nodes are on, if not its own: 0 for a field measured on today's Earth */
  frameMa?: number;
  /** four bytes per node */
  values: Uint8Array;
  /** the plate's index, with LAND_BIT where the model has land */
  plate: Uint16Array;
  /** the same nodes as numbers, for the build's checks; NaN where the model has no land near */
  nodes: Float32Array;
}

/** The nodes of one run: land cells of the model averaged into each node, then spread out over the sea. */
export function nodesOfRun(grid: FieldGrid, lat: ArrayLike<number>, lon: ArrayLike<number>, land: ArrayLike<number>, t: ArrayLike<number>, p: ArrayLike<number>): Float32Array {
  const nlat = lat.length;
  const nlon = lon.length;
  const n = grid.nx * grid.ny;
  const sum = new Float64Array(n * 4);
  const count = new Float64Array(n);
  const months = new Float64Array(12);
  const rains = new Float64Array(12);
  for (let j = 0; j < nlat; j++) {
    const row = Math.round((grid.lat0 - lat[j]) / grid.step);
    if (row < 0 || row >= grid.ny) continue;
    for (let i = 0; i < nlon; i++) {
      if (land[j * nlon + i] < 0.5) continue;
      for (let m = 0; m < 12; m++) {
        const at = (m * nlat + j) * nlon + i;
        months[m] = t[at];
        rains[m] = p[at];
      }
      const c = reduceMonths(months, rains);
      const lo = ((lon[i] + 180) % 360) - 180;
      const col = ((Math.round((lo - grid.lon0) / grid.step) % grid.nx) + grid.nx) % grid.nx;
      const k = row * grid.nx + col;
      sum[k * 4] += c.hot;
      sum[k * 4 + 1] += c.cold;
      sum[k * 4 + 2] += c.aridity;
      sum[k * 4 + 3] += c.margin;
      count[k]++;
    }
  }
  const out = new Float32Array(n * 4).fill(NaN);
  for (let k = 0; k < n; k++) if (count[k]) for (let q = 0; q < 4; q++) out[k * 4 + q] = sum[k * 4 + q] / count[k];
  return out;
}

/** Spread the land's climate out over the sea, a ring of nodes at a time. */
export function spreadOverSea(grid: FieldGrid, nodes: Float32Array, rings: number): Float32Array {
  const out = nodes.slice();
  const { nx, ny } = grid;
  for (let r = 0; r < rings; r++) {
    const prev = out.slice();
    let changed = false;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!Number.isNaN(prev[k * 4])) continue;
        const s = [0, 0, 0, 0];
        let c = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= ny) continue;
          for (let di = -1; di <= 1; di++) {
            const q = jj * nx + ((i + di + nx) % nx);
            if (Number.isNaN(prev[q * 4])) continue;
            for (let e = 0; e < 4; e++) s[e] += prev[q * 4 + e];
            c++;
          }
        }
        if (!c) continue;
        for (let e = 0; e < 4; e++) out[k * 4 + e] = s[e] / c;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

/** Every keyframe of a climate field, oldest run first in the dataset, youngest first here. */
export async function climateKeyframes(world: World, f: Field, snapshots: Snapshot[], plateIndex: Map<number, number>, log: (s: string) => void): Promise<ClimateKeyframe[]> {
  const d = world.manifest.datasets[f.data!.from];
  const nc = await openNetcdf(datasetFile(d.id, d));
  const grid = climateGrid((f.grid as { res_deg: number }).res_deg);
  const lat = await nc.read('lat');
  const lon = await nc.read('lon');
  const runs = nc.variables.get('T')!.dims[0].size;
  const out: ClimateKeyframe[] = [];
  const step = f.time!.step!;
  const stepMyr = Number(/^(\d+)/.exec(step)![1]);
  for (let run = runs - 1; run >= 0; run--) {
    // The runs go from 540 Ma to the pre-industrial, one every 10 Myr.
    const ageMa = (runs - 1 - run) * stepMyr;
    const t = await nc.read('T', run, 1);
    const p = await nc.read('P', run, 1);
    const land = await nc.read('LANDFRAC', run, 1);
    const raw = nodesOfRun(grid, lat, lon, land, t, p);
    const nodes = spreadOverSea(grid, raw, 16);
    const snap = snapshots.find((s) => s.ageMa === ageMa);
    if (!snap) throw new Error(`${f.id}: no elevation snapshot at ${ageMa} Ma to take its plates from`);
    const n = grid.nx * grid.ny;
    const values = new Uint8Array(n * 4);
    const plate = new Uint16Array(n);
    for (let k = 0; k < n; k++) {
      const c: ClimateNode = Number.isNaN(nodes[k * 4]) ? { hot: 0, cold: 0, aridity: 1, margin: 0 } : { hot: nodes[k * 4], cold: nodes[k * 4 + 1], aridity: nodes[k * 4 + 2], margin: nodes[k * 4 + 3] };
      values.set(encodeNode(c), k * 4);
      const row = Math.floor(k / grid.nx);
      const col = k % grid.nx;
      const la = grid.lat0 - row * grid.step;
      const lo = grid.lon0 + col * grid.step;
      const at = (90 - la) * SRC_W + (((lo + 180) % 360) + 360) % 360;
      plate[k] = (plateIndex.get(snap.plate[at]) ?? 0) | (Number.isNaN(raw[k * 4]) ? 0 : LAND_BIT);
    }
    out.push({ ageMa, values, plate, nodes });
  }
  await nc.close();
  log(`climate: ${out.length} keyframes on a ${grid.step}° grid, from ${d.id}`);
  return out;
}

export function encodeClimate(grid: FieldGrid, keys: ClimateKeyframe[], rule: ClimateRule): Uint8Array {
  const arrays: (Uint8Array | Uint16Array)[] = [];
  const keyframes = keys.map((k) => {
    arrays.push(k.values, k.plate);
    return { ageMa: k.ageMa, values: arrays.length - 2, plate: arrays.length - 1, ...(k.frameMa !== undefined ? { frameMa: k.frameMa } : {}) };
  });
  const header: ClimateHeader = { format: 'lightworld-climate@1', grid, keyframes, rule };
  return encodeTile(header as unknown as Record<string, unknown>, arrays, stableStringify);
}

/** What the months importer (tools/world/importers/months.py) writes beside its arrays. */
interface MonthsMeta {
  grid: { latitudes: number[]; longitudes: number[] };
  units: { temperature: string; precipitation: string; time: string };
  slices: { index: number; time: number; cells: number }[];
}

/**
 * Every keyframe of a climate field read as months (importMonths): a run of a model at each of its times, on today's
 * coordinates, carried by the plates under them today. Its nodes beyond the latitudes the runs reach are left without a
 * climate, as nodes far from any land are, rather than given the nearest land's.
 */
export async function monthsKeyframes(f: Field, dir: string, present: Snapshot, plateIndex: Map<number, number>, log: (s: string) => void): Promise<ClimateKeyframe[]> {
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as MonthsMeta;
  if (meta.units.temperature !== 'degrees celsius' || meta.units.precipitation !== 'millimetres per month' || meta.units.time !== 'years since present') throw new Error(`${f.id}: units ${JSON.stringify(meta.units)} are not read`);
  const grid = climateGrid((f.grid as { res_deg: number }).res_deg);
  const lat = meta.grid.latitudes;
  const lon = meta.grid.longitudes;
  const nlat = lat.length;
  const nlon = lon.length;
  const cells = nlat * nlon;
  const [south, north] = [Math.min(...lat), Math.max(...lat)];
  const read = async <T>(path: string, C: { new (b: ArrayBuffer): T }) => {
    const b = await readFile(join(dir, path));
    return new C(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  };
  const out: ClimateKeyframe[] = [];
  for (const sl of meta.slices) {
    const land = await read(`land/${sl.index}.u32`, Uint32Array);
    const t10 = await read(`t/${sl.index}.i16`, Int16Array);
    const p10 = await read(`p/${sl.index}.u16`, Uint16Array);
    // The months on the file's whole grid, as nodesOfRun reads them: month by month, row by row.
    const mask = new Float32Array(cells);
    const t = new Float32Array(12 * cells);
    const p = new Float32Array(12 * cells);
    land.forEach((c, i) => {
      mask[c] = 1;
      for (let m = 0; m < 12; m++) {
        t[m * cells + c] = t10[i * 12 + m] / 10;
        p[m * cells + c] = p10[i * 12 + m] / 10;
      }
    });
    const raw = nodesOfRun(grid, lat, lon, mask, t, p);
    const nodes = spreadOverSea(grid, raw, 16);
    const n = grid.nx * grid.ny;
    const values = new Uint8Array(n * 4);
    const plate = new Uint16Array(n);
    for (let k = 0; k < n; k++) {
      const row = Math.floor(k / grid.nx);
      const la = grid.lat0 - row * grid.step;
      if (la < south - grid.step / 2 || la > north + grid.step / 2) nodes.fill(NaN, k * 4, k * 4 + 4);
      const c: ClimateNode = Number.isNaN(nodes[k * 4]) ? { hot: 0, cold: 0, aridity: 1, margin: 0 } : { hot: nodes[k * 4], cold: nodes[k * 4 + 1], aridity: nodes[k * 4 + 2], margin: nodes[k * 4 + 3] };
      values.set(encodeNode(c), k * 4);
      const lo = grid.lon0 + (k % grid.nx) * grid.step;
      const at = (90 - la) * SRC_W + ((((lo + 180) % 360) + 360) % 360);
      plate[k] = (plateIndex.get(present.plate[at]) ?? 0) | (Number.isNaN(raw[k * 4]) ? 0 : LAND_BIT);
    }
    // Years before the present, as the file counts them.
    out.push({ ageMa: Math.round(-sl.time) / 1e6, frameMa: 0, values, plate, nodes });
  }
  out.sort((a, b) => a.ageMa - b.ageMa);
  log(`climate: ${out.length} keyframes on a ${grid.step}° grid, from ${f.data!.from}, ${(out.at(-1)!.ageMa * 1e3).toFixed(0)} ka to the present`);
  return out;
}

/** A fossil forest, against the climate the field gives its place at its time. */
export interface ForestCheck {
  id: string;
  ageMa: number;
  /** the keyframe read, and where the place stood then */
  keyframeMa: number;
  lat: number;
  lon: number;
  climate: ClimateClass | null;
  label: string;
}

/**
 * The outline's check of the biomes: no forest fossil falls in a reconstructed desert. Every record
 * whose evidence is a forest in place, read at its best age and carried there by its plate.
 */
export function forestChecks(s: Solved, keys: ClimateKeyframe[], grid: FieldGrid, rule: ClimateRule): ForestCheck[] {
  const out: ForestCheck[] = [];
  const w = s.world;
  for (const e of w.entities) {
    if (claimOf(s, e.id, 'evidence')?.value !== 'in-situ-forest') continue;
    const loc = claimOf(s, e.id, 'location')?.value as { lat: number; lon: number } | undefined;
    const frame = claimOf(s, e.id, 'frame')?.value as string | undefined;
    const plate = frame ? w.frame.get(frame)?.transform?.plate : undefined;
    const { start } = subjectTime(s, e.id).time;
    // Dated between two bounds, it is read at the middle of them.
    const best = start.best ?? (start.lo !== null && start.hi !== null ? (start.lo + start.hi) / 2 : null);
    if (!loc || !plate || best === null) continue;
    const ageMa = toMa(best);
    const key = [...keys].sort((a, b) => Math.abs(a.ageMa - ageMa) - Math.abs(b.ageMa - ageMa))[0];
    const [lat, lon] = toLatLon(rotate(s.model.total(plate, key.ageMa), rotate(conj(s.model.total(plate, 0)), unitVector(loc.lat, loc.lon))));
    const row = Math.round((grid.lat0 - lat) / grid.step);
    const col = ((Math.round((lon - grid.lon0) / grid.step) % grid.nx) + grid.nx) % grid.nx;
    const k = (row * grid.nx + col) * 4;
    const node = { hot: key.nodes[k], cold: key.nodes[k + 1], aridity: key.nodes[k + 2], margin: key.nodes[k + 3] };
    const climate = Number.isFinite(node.hot) ? climateClass(node, rule) : null;
    out.push({ id: e.id, ageMa: Math.round(ageMa * 1000) / 1000, keyframeMa: key.ageMa, lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, climate, label: climate ? CLIMATE_LABEL[climate] : 'no reading' });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}
