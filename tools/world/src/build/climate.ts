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
    return { ageMa: k.ageMa, values: arrays.length - 2, plate: arrays.length - 1 };
  });
  const header: ClimateHeader = { format: 'lightworld-climate@1', grid, keyframes, rule };
  return encodeTile(header as unknown as Record<string, unknown>, arrays, stableStringify);
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
