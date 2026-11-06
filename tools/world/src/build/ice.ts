// The ice-sheet field (ice.lwt): from a reconstruction's grids of thickness, what the globe draws at
// each keyframe. The grids are on today's coordinates at every keyframe. Each node gets the plate it
// rides today, so that the globe can move it from there, as it moves everything else. The thickness is
// what the dataset gives; how far a node is from the margin is worked out here.
import { BETWEEN, perMember, spread } from '../../../../core/samples.ts';
import { EARTH_RADIUS } from '../../../../core/city.ts';
import { encodeTile } from '../../../../core/container.ts';
import { encodeMargin, encodeThickness, MARGIN_KM_PER_STEP, THICKNESS_TOP, type IceHeader, type IceKeyframe, type IceScenario } from '../../../../core/ice.ts';
import type { SeriesRecord } from '../../../../core/records.ts';
import { fromMa, parsePoint, PRESENT_YEAR, toMa, type TimePointInput } from '../../../../core/time.ts';
import type { FieldGrid } from '../../../../core/tileset.ts';
import { datasetFile } from '../manifest.ts';
import { openNetcdf, type NcFile } from '../netcdf.ts';
import { stableStringify } from '../util.ts';
import type { Field, World } from '../world.ts';
import { climateGrid } from './climate.ts';
import type { Snapshot } from './fields.ts';

const SRC_W = 360;
const RAD = Math.PI / 180;

/** The grids of an ice field, read onto a grid whose nodes run from 90°N, 180°W, wrapping east. */
interface IceGrids {
  grid: FieldGrid;
  /** by source order, oldest first */
  agesMa: number[];
  read(variable: string, i: number): Promise<Float64Array>;
  close(): Promise<void>;
}

async function openGrids(world: World, f: Field): Promise<IceGrids> {
  const d = world.manifest.datasets[f.data!.from];
  const nc: NcFile = await openNetcdf(datasetFile(d.id, d, f.data!.file));
  const grid = climateGrid((f.grid as { res_deg: number }).res_deg);
  const lat = await nc.read('lat');
  const lon = await nc.read('lon');
  const time = await nc.read('time');
  // Latitudes run north from the south pole, and the last longitude repeats the first.
  if (lat.length !== grid.ny || lat[0] !== -90 || lat.at(-1) !== 90 || lon.length !== grid.nx + 1 || lon[0] !== grid.lon0) throw new Error(`${f.id}: the grids are not on ${grid.step}° nodes from 90°S and ${grid.lon0}°`);
  const row = lon.length;
  return {
    grid,
    // Years since 1950, as the file gives them.
    agesMa: [...time].map((y) => toMa(PRESENT_YEAR + y)),
    async read(variable, i) {
      const src = await nc.read(variable, i, 1);
      const out = new Float64Array(grid.nx * grid.ny);
      for (let j = 0; j < grid.ny; j++) for (let k = 0; k < grid.nx; k++) out[j * grid.nx + k] = src[(grid.ny - 1 - j) * row + k];
      return out;
    },
    close: () => nc.close(),
  };
}

const unit = (latDeg: number, lonDeg: number): [number, number, number] => {
  const la = latDeg * RAD;
  const lo = lonDeg * RAD;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};

/**
 * How far each node is from where a grid crosses a level, in km along the sphere: positive above it,
 * negative below it, and ±`reachKm` for any further than that. The crossing is placed between
 * neighbouring nodes in proportion to their values, so that it falls between them.
 */
export function distanceToContour(grid: FieldGrid, values: ArrayLike<number>, level: number, reachKm: number): Float32Array {
  const { nx, ny } = grid;
  const latOf = (j: number) => grid.lat0 - j * grid.step;
  const lonOf = (i: number) => grid.lon0 + i * grid.step;
  // Points on the contour, kept by cells of 10° so that each node looks only at those it could reach.
  const cell = 10;
  const rows = 18;
  const cols = 36;
  const cells: number[][] = Array.from({ length: rows * cols }, () => []);
  const pts: number[] = [];
  const addPoint = (la: number, lo: number) => {
    const [x, y, z] = unit(la, lo);
    const r = Math.min(rows - 1, Math.floor((la + 90) / cell));
    const c = Math.floor((((lo + 180) % 360) + 360) % 360 / cell) % cols;
    cells[r * cols + c].push(pts.length / 3);
    pts.push(x, y, z);
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = values[j * nx + i] - level;
      const east = values[j * nx + ((i + 1) % nx)] - level;
      if (a > 0 !== east > 0) addPoint(latOf(j), lonOf(i) + (grid.step * a) / (a - east));
      if (j + 1 < ny) {
        const south = values[(j + 1) * nx + i] - level;
        if (a > 0 !== south > 0) addPoint(latOf(j) - (grid.step * a) / (a - south), lonOf(i));
      }
    }
  }
  const out = new Float32Array(nx * ny);
  const reachDeg = (reachKm * 1e3) / EARTH_RADIUS / RAD;
  for (let j = 0; j < ny; j++) {
    const la = latOf(j);
    const r0 = Math.max(0, Math.floor((la - reachDeg + 90) / cell));
    const r1 = Math.min(rows - 1, Math.floor((la + reachDeg + 90) / cell));
    // At the latitude nearest a pole in reach, how many cells of longitude that reach spans.
    const nearest = Math.abs(la) + reachDeg;
    const span = nearest >= 85 ? cols : Math.ceil(reachDeg / Math.cos(nearest * RAD) / cell) + 1;
    const scan = span * 2 + 1 >= cols ? cols : span * 2 + 1;
    for (let i = 0; i < nx; i++) {
      const lo = lonOf(i);
      const [x, y, z] = unit(la, lo);
      const first = scan === cols ? 0 : Math.floor((lo + 180) / cell) - span + cols * 2;
      let best = Infinity;
      for (let r = r0; r <= r1; r++) {
        for (let k = 0; k < scan; k++) {
          for (const p of cells[r * cols + ((first + k) % cols)]) {
            const dx = pts[p * 3] - x;
            const dy = pts[p * 3 + 1] - y;
            const dz = pts[p * 3 + 2] - z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < best) best = d;
          }
        }
      }
      // From the straight line through the Earth to the way round its surface.
      const km = best === Infinity ? reachKm : Math.min(reachKm, (2 * Math.asin(Math.min(1, Math.sqrt(best) / 2)) * EARTH_RADIUS) / 1e3);
      out[j * nx + i] = values[j * nx + i] > level ? km : -km;
    }
  }
  return out;
}

export interface IceBuilt {
  bytes: Uint8Array;
  coverage: [number, number];
  keyframesMa: number[];
  marginM: number;
  scenarios: { id: string; title: string; alt?: string }[];
}

/** Every keyframe of an ice field, on the plates of the elevation's snapshot of the present. */
export async function buildIce(world: World, f: Field, present: Snapshot, plateIndex: Map<number, number>, log: (s: string) => void): Promise<IceBuilt> {
  const g = await openGrids(world, f);
  const { grid } = g;
  const marginM = f.params!.margin_m as number;
  const reachKm = 127.5 * MARGIN_KM_PER_STEP;
  const arrays: (Uint8Array | Uint16Array)[] = [];
  const plate = new Uint16Array(grid.nx * grid.ny);
  for (let k = 0; k < plate.length; k++) {
    const la = grid.lat0 - Math.floor(k / grid.nx) * grid.step;
    const lo = grid.lon0 + (k % grid.nx) * grid.step;
    plate[k] = plateIndex.get(present.plate[(90 - la) * SRC_W + ((lo + 180) % 360)]) ?? 0;
  }
  arrays.push(plate);
  const scenarios: IceScenario[] = [];
  let top = 0;
  for (const s of f.data!.scenarios!) {
    const span = s.span ? [toMa(parsePoint(s.span.hi as TimePointInput).t), toMa(parsePoint(s.span.lo as TimePointInput).t)] : [-Infinity, Infinity];
    const keyframes: IceKeyframe[] = [];
    for (let i = g.agesMa.length - 1; i >= 0; i--) {
      const ageMa = g.agesMa[i];
      if (ageMa < span[0] || ageMa > span[1]) continue;
      const h = await g.read(s.variable, i);
      const d = distanceToContour(grid, h, marginM, reachKm);
      const margin = new Uint8Array(h.length);
      const thickness = new Uint8Array(h.length);
      for (let k = 0; k < h.length; k++) {
        margin[k] = encodeMargin(d[k]);
        thickness[k] = encodeThickness(h[k]);
        if (h[k] > top) top = h[k];
      }
      arrays.push(margin, thickness);
      keyframes.push({ ageMa, margin: arrays.length - 2, thickness: arrays.length - 1 });
    }
    scenarios.push({ id: s.id, title: s.title, alt: s.alt, keyframes });
  }
  await g.close();
  if (top >= THICKNESS_TOP) throw new Error(`${f.id}: ice ${top} m thick is more than the file format holds`);
  const header: IceHeader = { format: 'lightworld-ice@1', grid, plate: 0, marginM, scenarios };
  const until = f.projection ? parsePoint(f.projection.until as TimePointInput).t : PRESENT_YEAR;
  const keyframesMa = scenarios[0].keyframes.map((k) => k.ageMa);
  log(`ice: ${keyframesMa.length} keyframes on a ${grid.step}° grid, ${scenarios.map((s) => `${s.id} ${s.keyframes.length}`).join(', ')}`);
  return {
    bytes: encodeTile(header as unknown as Record<string, unknown>, arrays, stableStringify),
    coverage: [Math.round(fromMa(keyframesMa.at(-1)!)), until],
    keyframesMa,
    marginM,
    scenarios: scenarios.map((s) => ({ id: s.id, title: s.title, alt: s.alt })),
  };
}

/** The volume of ice on a grid in km³, each node standing for the piece of the sphere closest to it. */
export function iceVolume(grid: FieldGrid, thickness: ArrayLike<number>): number {
  const stepRad = grid.step * RAD;
  const r = EARTH_RADIUS / 1e3;
  let km3 = 0;
  for (let j = 0; j < grid.ny; j++) {
    const lat = grid.lat0 - j * grid.step;
    const north = Math.min(90, lat + grid.step / 2) * RAD;
    const south = Math.max(-90, lat - grid.step / 2) * RAD;
    const area = (Math.sin(north) - Math.sin(south)) * stepRad * r * r;
    for (let i = 0; i < grid.nx; i++) km3 += Math.max(0, thickness[j * grid.nx + i]) * 1e-3 * area;
  }
  return km3;
}

const sig = (x: number) => Number(x.toPrecision(5));

/**
 * Each keyframe's ice, above the youngest's, as metres of sea level, with the range of the scenarios
 * around it: the first scenario's as the series, and any other's for the alternative that draws it.
 */
export async function iceSeaLevel(world: World, f: Field): Promise<{ points: SeriesRecord['points']; variants: NonNullable<SeriesRecord['variants']> }> {
  const ice = world.fields.find((x) => x.id === f.from![0]);
  if (!ice?.data?.scenarios) throw new Error(`${f.id}: ${f.from![0]} has no grids`);
  const p = f.params as { ocean_area_km2: number; ice_density: number; water_density: number };
  const g = await openGrids(world, ice);
  const volumes: number[][] = [];
  for (const s of ice.data.scenarios) {
    const v: number[] = [];
    for (let i = 0; i < g.agesMa.length; i++) v.push(iceVolume(g.grid, await g.read(s.variable, i)));
    volumes.push(v);
  }
  await g.close();
  const youngest = g.agesMa.indexOf(Math.min(...g.agesMa));
  const level = (v: number[], i: number) => -((v[i] - v[youngest]) * p.ice_density) / p.water_density / p.ocean_area_km2 * 1e3;
  // The scenarios are alternatives, each its own picture (docs/STRUCTURE.md section 3.2): the model runs once per
  // member, and its band is the whole range between them, as none is more likely than another.
  const pointsOf = (scenario: number): SeriesRecord['points'] =>
    g.agesMa
      .map((a, i): SeriesRecord['points'][number] => {
        const all = perMember(volumes.length, (m) => level(volumes[m], i));
        const s = spread(all, BETWEEN);
        return [Math.round(PRESENT_YEAR - a * 1e6), sig(all[scenario]), sig(s.lo), sig(s.hi)];
      })
      .sort((a, b) => a[0] - b[0]);
  const variants: NonNullable<SeriesRecord['variants']> = {};
  ice.data.scenarios.forEach((s, i) => {
    if (s.alt) variants[s.alt] = pointsOf(i);
  });
  return { points: pointsOf(0), variants };
}
