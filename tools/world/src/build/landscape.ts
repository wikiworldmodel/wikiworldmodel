// The anonymous human landscape (docs/HUMAN-LANDSCAPE.md), built: what kind of place every 5′ cell of land was at each
// of Anthromes 12K's 73 times, the ArchaeoGLOBE region it lies in, what the region's archaeologists said of it, and the
// building traditions the world records. The viewer and the scenes read them; resolve answers the people's layer from
// them; the coverage counts where HYDE and the archaeologists disagree.
//
//   people/landscape.json            the index: steps, classes, tiles, the assessments' file and the traditions'
//   people/anthromes/<n>_<w>.lwt     a 10° tile of 5′ cells: each cell's classes through time as runs, and its region
//   people/anthromes/globe.lwt       the same at 0.25°, each cell the commonest class of its nine, for the globe
//   people/assessments.json          ArchaeoGLOBE's rows, by region and time
//   people/traditions.json           the building traditions, each with what it inherits
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { decodeTile, encodeTile } from '../../../../core/container.ts';
import { compileTraditions, type DwellingSpec, type FieldSpec, type SettlementSpec, type Tradition, type TraditionInput } from '../../../../core/dwelling.ts';
import type { LandscapeIndex, TraditionsFile } from '../../../../core/landscape.ts';
export type { LandscapeIndex, TraditionsFile };
import { anthromeTile, assessmentAt, cityPeople, classAtStep, cellOf, kmBetween, LEVEL_WORDS, lifewayOf, nearestStep, tileKey, type AnthromeClass, type City, type CitiesFile, type AnthromeTile, type AnthromeTileHeader, type Assessment, type AssessmentsFile } from '../../../../core/landscape.ts';
import { datasetFile } from '../manifest.ts';
import { CACHE } from '../paths.ts';
import { sha256, stableStringify } from '../util.ts';
import type { Field, World } from '../world.ts';
import { claimOf, subjectTime, type Solved } from './records.ts';

const NX = 4320;
const NY = 2160;
const RES = 1 / 12;

// ——— Reading the grids ———

/** An Arc ASCII grid of small whole numbers, as the build's class numbers: anything not in `index`, nodata included, is 0. */
export function parseClassGrid(b: Uint8Array, out: Uint8Array, index: Int16Array): void {
  let p = 0;
  for (let lines = 0; lines < 6; p++) if (b[p] === 10) lines++;
  const n = out.length;
  for (let i = 0; i < n; i++) {
    while (b[p] <= 32) p++;
    if (p >= b.length) throw new Error(`the grid ends after ${i} of ${n} cells`);
    let neg = false;
    if (b[p] === 45) {
      neg = true;
      p++;
    }
    let v = 0;
    while (p < b.length && b[p] > 32) v = v * 10 + (b[p++] - 48);
    out[i] = neg || v >= index.length || index[v] < 0 ? 0 : index[v];
  }
}

/** The year a grid of Anthromes 12K is labelled with, as the axis reads it: 10000BC is −10000, 0AD is 0. */
export function stepOfName(name: string): number | undefined {
  const m = /(?:^|\/)(\d+)(AD|BC)_anthromes\.zip$/.exec(name);
  return m ? (m[2] === 'BC' ? -Number(m[1]) : Number(m[1])) : undefined;
}

// ——— The regions ———

/** Eckert IV, back to latitude and longitude, on a sphere of the WGS84 semi-major axis, as the regions' shapes were projected. */
export function eckert4Inverse(x: number, y: number, R = 6378137): [number, number] {
  const cx = 2 / Math.sqrt(Math.PI * (4 + Math.PI));
  const cy = 2 * Math.sqrt(Math.PI / (4 + Math.PI));
  const s = Math.max(-1, Math.min(1, y / (cy * R)));
  const theta = Math.asin(s);
  const lat = Math.asin(Math.max(-1, Math.min(1, (theta + Math.sin(theta) * Math.cos(theta) + 2 * Math.sin(theta)) / (2 + Math.PI / 2))));
  const c = 1 + Math.cos(theta);
  const lon = c > 1e-12 ? x / (cx * R * c) : 0;
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** A shapefile's polygons, each a list of rings of [x, y]. */
export function readPolygons(shp: Uint8Array): number[][][][] {
  const v = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  if (v.getInt32(0, false) !== 9994) throw new Error('not a shapefile');
  const out: number[][][][] = [];
  for (let p = 100; p + 8 <= shp.length; ) {
    const len = v.getInt32(p + 4, false) * 2;
    const at = p + 8;
    const type = v.getInt32(at, true);
    if (type === 5) {
      const parts = v.getInt32(at + 36, true);
      const points = v.getInt32(at + 40, true);
      const starts = Array.from({ length: parts }, (_, i) => v.getInt32(at + 44 + 4 * i, true));
      const base = at + 44 + 4 * parts;
      const rings: number[][][] = [];
      for (let i = 0; i < parts; i++) {
        const a = starts[i];
        const b = i + 1 < parts ? starts[i + 1] : points;
        const ring: number[][] = [];
        for (let k = a; k < b; k++) ring.push([v.getFloat64(base + 16 * k, true), v.getFloat64(base + 16 * k + 8, true)]);
        rings.push(ring);
      }
      out.push(rings);
    } else out.push([]);
    p = at + len;
  }
  return out;
}

/** A dBASE table's rows, each by field name, as text. */
export function readDbf(dbf: Uint8Array): Record<string, string>[] {
  const v = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
  const n = v.getUint32(4, true);
  const headerLength = v.getUint16(8, true);
  const recordLength = v.getUint16(10, true);
  const fields: { name: string; length: number }[] = [];
  for (let p = 32; dbf[p] !== 0x0d; p += 32) {
    const name = new TextDecoder('latin1').decode(dbf.subarray(p, p + 11)).replace(/\0.*$/, '');
    fields.push({ name, length: dbf[p + 16] });
  }
  const out: Record<string, string>[] = [];
  for (let r = 0; r < n; r++) {
    let p = headerLength + r * recordLength + 1;
    const row: Record<string, string> = {};
    for (const f of fields) {
      row[f.name] = new TextDecoder('latin1').decode(dbf.subarray(p, p + f.length)).trim();
      p += f.length;
    }
    out.push(row);
  }
  return out;
}

/**
 * Each region's outline filled into a grid of cells `res` degrees across, by row from the north: a cell takes the region
 * whose rings cross a line through its centre around it an odd number of times. Later regions win where outlines overlap.
 */
export function rasterizeRegions(polys: { id: number; rings: number[][][] }[], nx: number, ny: number, res: number): Uint8Array {
  const out = new Uint8Array(nx * ny);
  for (const { id, rings } of polys) {
    let south = 90;
    let north = -90;
    for (const r of rings) for (const [, lat] of r) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    const r0 = Math.max(0, Math.floor((90 - north) / res));
    const r1 = Math.min(ny - 1, Math.ceil((90 - south) / res));
    const xs: number[] = [];
    for (let row = r0; row <= r1; row++) {
      const lat = 90 - (row + 0.5) * res;
      xs.length = 0;
      for (const ring of rings) {
        for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
          const [x0, y0] = ring[j];
          const [x1, y1] = ring[k];
          if (y0 > lat !== y1 > lat) xs.push(x0 + ((lat - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] + 180) / res - 0.5));
        const c1 = Math.min(nx - 1, Math.floor((xs[k + 1] + 180) / res - 0.5));
        for (let c = c0; c <= c1; c++) out[row * nx + c] = id;
      }
    }
  }
  return out;
}

/** A cell of land that no outline holds takes the region of the nearest cell that one does, within `reach` cells, by rings of growing distance. */
export function fillGaps(region: Uint8Array, land: (i: number) => boolean, nx: number, ny: number, reach: number): number {
  let filled = 0;
  const src = region.slice();
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      const i = row * nx + col;
      if (src[i] || !land(i)) continue;
      let best = 0;
      let bestD = Infinity;
      for (let d = 1; d <= reach && !best; d++) {
        for (let dr = -d; dr <= d; dr++) {
          const r = row + dr;
          if (r < 0 || r >= ny) continue;
          for (let dc = -d; dc <= d; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue;
            const c = (((col + dc) % nx) + nx) % nx;
            const v = src[r * nx + c];
            if (!v) continue;
            const dd = dr * dr + dc * dc;
            if (dd < bestD || (dd === bestD && v < best)) {
              best = v;
              bestD = dd;
            }
          }
        }
      }
      if (best) {
        region[i] = best;
        filled++;
      }
    }
  }
  return filled;
}

// ——— The anthromes, as runs ———

interface Runs {
  steps: number[];
  /** for each cell of the 5′ grid, its runs: counts, and pairs of class and first step */
  counts: Uint8Array;
  offsets: Uint32Array;
  runs: Uint8Array;
  /** the same at the globe's resolution */
  globe: { nx: number; ny: number; counts: Uint8Array; offsets: Uint32Array; runs: Uint8Array };
}

/** Growing arrays of changes: the cell, its new class and the step. */
class Changes {
  cell = new Uint32Array(1 << 20);
  cls = new Uint8Array(1 << 20);
  step = new Uint8Array(1 << 20);
  n = 0;
  add(c: number, k: number, s: number): void {
    if (this.n === this.cell.length) {
      const grow = <T extends Uint32Array | Uint8Array>(a: T): T => {
        const b = new (a.constructor as new (n: number) => T)(a.length * 2);
        b.set(a);
        return b;
      };
      this.cell = grow(this.cell);
      this.cls = grow(this.cls);
      this.step = grow(this.step);
    }
    this.cell[this.n] = c;
    this.cls[this.n] = k;
    this.step[this.n] = s;
    this.n++;
  }
  /** By cell, in the order of steps: counts, offsets and runs. */
  sort(cells: number): { counts: Uint8Array; offsets: Uint32Array; runs: Uint8Array } {
    const counts = new Uint8Array(cells);
    for (let i = 0; i < this.n; i++) counts[this.cell[i]]++;
    const offsets = new Uint32Array(cells + 1);
    for (let i = 0; i < cells; i++) offsets[i + 1] = offsets[i] + counts[i];
    const at = offsets.slice(0, cells);
    const runs = new Uint8Array(this.n * 2);
    for (let i = 0; i < this.n; i++) {
      const k = at[this.cell[i]]++;
      runs[2 * k] = this.cls[i];
      runs[2 * k + 1] = this.step[i];
    }
    return { counts, offsets, runs };
  }
}

/** The commonest class of a block of cells, ignoring no land; a tie goes to the lower number, the more intensive use. */
function commonest(grid: Uint8Array, nx: number, row: number, col: number, f: number, tally: Uint16Array): number {
  tally.fill(0);
  for (let r = 0; r < f; r++) for (let c = 0; c < f; c++) tally[grid[(row * f + r) * nx + col * f + c]]++;
  let best = 0;
  for (let k = 1; k < tally.length; k++) if (tally[k] > tally[best] || (best === 0 && tally[k] > 0)) best = k;
  return tally[best] > 0 ? best : 0;
}

/** Every grid of the archive, read one at a time into runs of each cell's classes, and the globe's picture with them. */
export function anthromeRuns(zip: Uint8Array, classes: AnthromeClass[], globeFactor: number, log: (s: string) => void): Runs {
  const outer = unzipSync(zip);
  const members = Object.keys(outer)
    .map((name) => ({ name, step: stepOfName(name) }))
    .filter((m): m is { name: string; step: number } => m.step !== undefined)
    .sort((a, b) => a.step - b.step);
  if (!members.length) throw new Error('the anthromes archive has no grids');
  if (members.length > 255) throw new Error('more steps than a byte holds');
  const index = new Int16Array(100).fill(-1);
  classes.forEach((c, i) => (index[c.code] = i + 1));
  const N = NX * NY;
  const gx = NX / globeFactor;
  const gy = NY / globeFactor;
  const grid = new Uint8Array(N);
  const prev = new Uint8Array(N);
  const gridG = new Uint8Array(gx * gy);
  const prevG = new Uint8Array(gx * gy);
  const fine = new Changes();
  const coarse = new Changes();
  const tally = new Uint16Array(classes.length + 1);
  members.forEach((m, s) => {
    const inner = unzipSync(outer[m.name]);
    const asc = Object.entries(inner).find(([k]) => k.endsWith('.asc'));
    if (!asc) throw new Error(`${m.name} holds no grid`);
    parseClassGrid(asc[1], grid, index);
    for (let i = 0; i < N; i++) if (grid[i] !== prev[i]) fine.add(i, grid[i], s);
    prev.set(grid);
    for (let r = 0; r < gy; r++) for (let c = 0; c < gx; c++) gridG[r * gx + c] = commonest(grid, NX, r, c, globeFactor, tally);
    for (let i = 0; i < gridG.length; i++) if (gridG[i] !== prevG[i]) coarse.add(i, gridG[i], s);
    prevG.set(gridG);
  });
  log(`landscape  ${members.length} grids of anthromes read, ${fine.n.toLocaleString('en-US')} runs at 5′, ${coarse.n.toLocaleString('en-US')} at ${globeFactor * 5}′`);
  return { steps: members.map((m) => m.step), ...fine.sort(N), globe: { nx: gx, ny: gy, ...coarse.sort(gx * gy) } };
}

// ——— ArchaeoGLOBE ———

/** The snapshot's rows, as the viewer reads them. */
export function assessmentsFile(csv: string, source: string, title: string): AssessmentsFile {
  const lines = csv.split('\n').filter((l) => l && !l.startsWith('#'));
  const split = (l: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) {
        if (ch === '"' && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  const col = (name: string) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`the assessments have no column ${name}`);
    return i;
  };
  const level = (v: string) => {
    const k = (LEVEL_WORDS as readonly string[]).indexOf(v);
    if (k < 0) throw new Error(`"${v}" is not a level`);
    return k;
  };
  const slices: { year: number; label: string }[] = [];
  const regions = new Map<number, string>();
  const rows: Record<string, Assessment[]> = {};
  const SLICE_LABEL: Record<string, string> = { '10K': '10,000 BP', '8K': '8,000 BP', '6K': '6,000 BP', '4K': '4,000 BP', '3K': '3,000 BP', '2K': '2,000 BP', '1K': '1,000 BP', '1500CE': '1500 CE', '1750CE': '1750 CE', '1850CE': '1850 CE' };
  for (const l of lines.slice(1)) {
    const c = split(l);
    const id = Number(c[col('region')]);
    const year = Number(c[col('year')]);
    if (!slices.some((s) => s.year === year)) slices.push({ year, label: SLICE_LABEL[c[col('slice')]] ?? c[col('slice')] });
    regions.set(id, c[col('label')]);
    const use = (u: string): [number, number, number, number] => [level(c[col(u)]), level(c[col(`${u}_min`)]), level(c[col(`${u}_median`)]), level(c[col(`${u}_max`)])];
    const urban = (v: string) => (v === 'Present' ? 1 : v === 'Split' ? 2 : 0);
    (rows[String(id)] ??= []).push({
      use: [use('foraging'), use('extensive'), use('intensive'), use('pastoral')],
      urban: urban(c[col('urban')]),
      urbanMedian: urban(c[col('urban_median')]),
      quality: Number(c[col('quality')]),
      expertise: Number(c[col('expertise')]),
    });
  }
  slices.sort((a, b) => a.year - b.year);
  return { format: 'lightworld-assessments@1', source, title, slices, regions: [...regions.entries()].sort((a, b) => a[0] - b[0]).map(([id, label]) => ({ id, label })), rows };
}

// ——— Cities ———

/** A column of a city list, as the axis reads it: BC_3000 is −2999, AD_100 is 100. */
export function cityYear(column: string): number | undefined {
  const m = /^(BC|AD)_(\d+)$/.exec(column);
  return m ? (m[1] === 'BC' ? 1 - Number(m[2]) : Number(m[2])) : undefined;
}

/** The rows of a list of cities, each with its people at the years it gives, less the cells a field leaves out. */
export function citiesOf(csv: string, source: string, field: string, leftOut: { city: string; columns: string[] }[]): City[] {
  const lines = csv.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const split = (l: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) {
        if (ch === '"' && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  const out: City[] = [];
  for (const l of lines.slice(1)) {
    const c = split(l);
    const name = c[0].trim();
    const skip = new Set(leftOut.filter((x) => x.city === name).flatMap((x) => x.columns));
    const pops: [number, number][] = [];
    head.forEach((h, i) => {
      const y = cityYear(h);
      const v = Number(c[i]);
      if (y !== undefined && c[i] && c[i].trim() && Number.isFinite(v) && v > 0 && !skip.has(h)) pops.push([y, v]);
    });
    const lat = Number(c[head.indexOf('Latitude')]);
    const lon = Number(c[head.indexOf('Longitude')]);
    if (!pops.length || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    pops.sort((a, b) => a[0] - b[0]);
    out.push({ name, country: c[head.indexOf('Country')].trim(), lat, lon, certainty: Number(c[head.indexOf('Certainty')]) || 0, source, field, pops });
  }
  return out;
}

// ——— The traditions ———

/** Each building tradition the world records, with its own claims, before inheritance. */
export function traditionInputs(s: Solved, regionsSource: string): TraditionInput[] {
  const w = s.world;
  const out: TraditionInput[] = [];
  for (const e of w.entities) {
    if (e.kind !== 'tradition/building' && e.kind !== 'tradition') continue;
    const value = <T>(prop: string): T | undefined => claimOf(s, e.id, prop)?.value as T | undefined;
    const extent = value<{ from: string; names: string[] }>('extent');
    const regions = extent && extent.from === regionsSource ? extent.names.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    const { time } = subjectTime(s, e.id);
    // A tradition holds from its best start to its best end; an end no claim gives is the present, and one known to be
    // unknown is the latest the evidence allows.
    const best = (e: { best: number | null; lo: number; hi: number }, or: number) => (e.best !== null && Number.isFinite(e.best) ? e.best : Number.isFinite(or) ? or : NaN);
    const start = best(time.start, time.start.lo);
    const end = time.endUnknown ? best(time.end, time.end.hi) : best(time.end, Infinity);
    const name = value<Record<string, string>>('name');
    const parent = e.relations.find((r) => r.rel === 'member-of')?.to;
    out.push({
      id: e.id,
      label: name?.en ?? Object.values(name ?? {})[0] ?? e.id,
      ...(parent ? { parent } : {}),
      regions,
      // A billion years either way stands for no bound, as JSON has no infinity.
      span: [Number.isFinite(start) ? start : -1e9, Number.isFinite(end) ? end : 1e9],
      ...(value<DwellingSpec>('dwelling') ? { dwelling: value<DwellingSpec>('dwelling') } : {}),
      ...(value<SettlementSpec>('settlement_form') ? { settlement: value<SettlementSpec>('settlement_form') } : {}),
      ...(value<FieldSpec>('field_system') ? { fields: value<FieldSpec>('field_system') } : {}),
    });
  }
  return out;
}

// ——— The build ———

export interface LandscapeBuilt {
  files: Map<string, Uint8Array | string>;
  index: LandscapeIndex;
  assessments: AssessmentsFile;
  traditions: Tradition[];
  cities: CitiesFile;
  /** the span the anthromes hold, and the assessments' */
  span: [number, number];
  assessed: [number, number];
  /** the class and the region at a place and time, from the built tiles */
  at: (lat: number, lon: number, t: number) => { anthrome: number; region: number } | undefined;
  classes: AnthromeClass[];
}

const fieldOf = (w: World, as: string): Field | undefined => w.fields.find((f) => f.data?.as === as);

/** Everything the human landscape needs, made from its datasets and records; undefined if the world has no anthromes field. */
export async function buildLandscape(s: Solved, log: (s: string) => void): Promise<LandscapeBuilt | undefined> {
  const w = s.world;
  const af = fieldOf(w, 'anthromes');
  const lf = fieldOf(w, 'land-use-assessment');
  const lifeways = w.fields.find((f) => f.rule === 'lifeways');
  if (!af || !lf) return undefined;
  const params = af.params as unknown as { tile_deg: number; globe_deg: number; classes: AnthromeClass[] };
  const lparams = lf.params as unknown as { res_deg: number; reach_cells: number };
  const classes = params.classes;
  const globeFactor = Math.round(params.globe_deg / RES);
  const tileCells = Math.round(params.tile_deg / RES);
  const ds = w.manifest.datasets;
  const zipPath = datasetFile(af.data!.from, ds[af.data!.from]);
  const regionsId = lf.data!.regions!;
  const shp = datasetFile(regionsId, ds[regionsId], 'shapes');
  const dbf = datasetFile(regionsId, ds[regionsId], 'table');
  for (const p of [zipPath, shp, dbf]) if (!existsSync(p)) throw new Error(`missing ${p}; run \`npm run fetch\` first`);
  // The tiles take a minute to make and change only with their inputs, so they are kept between builds.
  const key = sha256(stableStringify({ zip: ds[af.data!.from].fetch.sha256, regions: ds[regionsId].fetch.sha256, params, lparams, code: 1 })).slice(0, 16);
  const cache = join(CACHE, 'import', `landscape@${key}`);
  const files = new Map<string, Uint8Array | string>();
  if (existsSync(join(cache, 'done'))) {
    log(`landscape  cached (${key})`);
    for (const name of await readdir(cache)) if (name.endsWith('.lwt')) files.set(`people/anthromes/${name}`, new Uint8Array(await readFile(join(cache, name))));
  } else {
    const runs = anthromeRuns(new Uint8Array(await readFile(zipPath)), classes, globeFactor, log);
    // The regions, into the same grid: their shapes back from Eckert IV, then filled, then gaps of the coast closed.
    const rows = readDbf(new Uint8Array(await readFile(dbf)));
    const polys = readPolygons(new Uint8Array(await readFile(shp))).map((rings, i) => ({ id: Number(rows[i].Archaeo_ID), rings: rings.map((r) => r.map(([x, y]) => eckert4Inverse(x, y))) }));
    if (Math.abs(lparams.res_deg - RES) > 1e-4) throw new Error('the regions are drawn on the anthromes\' grid');
    const region = rasterizeRegions(polys, NX, NY, RES);
    const filled = fillGaps(region, (i) => runs.counts[i] > 0, NX, NY, lparams.reach_cells);
    let landNoRegion = 0;
    for (let i = 0; i < region.length; i++) if (runs.counts[i] > 0 && !region[i]) landNoRegion++;
    log(`landscape  ${polys.length} regions drawn at 5′; ${filled.toLocaleString('en-US')} cells of land outside every outline took the nearest region, ${landNoRegion.toLocaleString('en-US')} are too far from one`);
    await mkdir(cache, { recursive: true });
    const header = (north: number, west: number, nx: number, ny: number, res: number): AnthromeTileHeader => ({ format: 'lightworld-anthromes@1', north, west, nx, ny, res, steps: runs.steps });
    for (let tr = 0; tr < NY / tileCells; tr++) {
      for (let tc = 0; tc < NX / tileCells; tc++) {
        const n = tileCells * tileCells;
        const counts = new Uint8Array(n);
        const reg = new Uint8Array(n);
        let total = 0;
        for (let r = 0; r < tileCells; r++) for (let c = 0; c < tileCells; c++) {
          const g = (tr * tileCells + r) * NX + tc * tileCells + c;
          counts[r * tileCells + c] = runs.counts[g];
          reg[r * tileCells + c] = region[g];
          total += runs.counts[g];
        }
        if (!total) continue;
        const pairs = new Uint8Array(total * 2);
        let k = 0;
        for (let r = 0; r < tileCells; r++) for (let c = 0; c < tileCells; c++) {
          const g = (tr * tileCells + r) * NX + tc * tileCells + c;
          pairs.set(runs.runs.subarray(2 * runs.offsets[g], 2 * runs.offsets[g + 1]), k);
          k += 2 * runs.counts[g];
        }
        const north = 90 - tr * params.tile_deg;
        const west = -180 + tc * params.tile_deg;
        const name = `${north}_${west}.lwt`;
        const bytes = encodeTile(header(north, west, tileCells, tileCells, RES) as unknown as Record<string, unknown>, [counts, pairs, reg], stableStringify);
        files.set(`people/anthromes/${name}`, bytes);
        await writeFile(join(cache, name), bytes);
      }
    }
    // The globe's picture: each cell the commonest class of its nine, and the commonest region of its land.
    const g = runs.globe;
    const greg = new Uint8Array(g.nx * g.ny);
    const tally = new Uint16Array(256);
    for (let r = 0; r < g.ny; r++) for (let c = 0; c < g.nx; c++) {
      tally.fill(0);
      for (let a = 0; a < globeFactor; a++) for (let b = 0; b < globeFactor; b++) tally[region[(r * globeFactor + a) * NX + c * globeFactor + b]]++;
      let best = 0;
      for (let k = 1; k < 256; k++) if (tally[k] > (best ? tally[best] : 0)) best = k;
      greg[r * g.nx + c] = best;
    }
    const globe = encodeTile(header(90, -180, g.nx, g.ny, params.globe_deg) as unknown as Record<string, unknown>, [g.counts, g.runs, greg], stableStringify);
    files.set('people/anthromes/globe.lwt', globe);
    await writeFile(join(cache, 'globe.lwt'), globe);
    await writeFile(join(cache, 'done'), '');
  }
  // The assessments and the traditions are small, and follow the records: made every build.
  const csv = await readFile(datasetFile(lf.data!.from, ds[lf.data!.from]), 'utf8');
  const assessments = assessmentsFile(csv, lf.data!.from, lf.title);
  files.set('people/assessments.json', stableStringify(assessments));
  const cityFields = w.fields.filter((f) => f.data?.as === 'cities');
  const cities: CitiesFile = { format: 'lightworld-cities@1', lists: [], cities: [] };
  for (const f of cityFields) {
    const p = (f.params ?? {}) as { left_out?: { city: string; columns: string[] }[]; hold_yr?: number; gap_yr?: number };
    const text = new TextDecoder('latin1').decode(await readFile(datasetFile(f.data!.from, ds[f.data!.from])));
    cities.lists.push({ source: f.data!.from, field: f.id, title: f.title, hold: p.hold_yr ?? 0, gap: p.gap_yr ?? 1e9 });
    cities.cities.push(...citiesOf(text, f.data!.from, f.id, p.left_out ?? []));
  }
  files.set('people/cities.json', stableStringify(cities));
  const traditions = compileTraditions(traditionInputs(s, regionsId));
  files.set('people/traditions.json', stableStringify({ format: 'lightworld-traditions@1', regions: regionsId, traditions } satisfies TraditionsFile));
  const globe = decodeTile<AnthromeTileHeader>(toBuffer(files.get('people/anthromes/globe.lwt') as Uint8Array));
  const steps = globe.header.steps;
  const tiles = [...files.keys()].filter((k) => /^people\/anthromes\/-?\d+_-?\d+\.lwt$/.test(k)).map((k) => k.slice('people/anthromes/'.length, -4)).sort();
  const gen = w.generators.find((g) => g.id === 'gen:people/settlement');
  const index: LandscapeIndex = {
    format: 'lightworld-landscape@1',
    title: af.title,
    source: af.data!.from,
    steps,
    classes,
    tile_deg: params.tile_deg,
    res: RES,
    tiles,
    globe: { file: 'people/anthromes/globe.lwt', res: params.globe_deg },
    assessments: 'people/assessments.json',
    traditions: 'people/traditions.json',
    cities: 'people/cities.json',
    fields: { anthromes: af.id, assessment: lf.id, lifeways: lifeways?.id ?? 'field:people/lifeways', population: w.fields.find((f) => f.data?.as === 'people')?.id ?? 'field:earth/population' },
    ...(gen ? { generator: { generator: gen.id, version: gen.version, params: gen.params as Record<string, unknown> } } : {}),
    reach_deg: 0.25,
    reach_km: (gen?.params as { cities?: { reach_km?: number } } | undefined)?.cities?.reach_km ?? 30,
  };
  files.set('people/landscape.json', stableStringify(index));
  log(`landscape  ${tiles.length} tiles of 5′ cells over ${steps.length} steps, ${assessments.regions.length} regions assessed at ${assessments.slices.length} times, ${cities.cities.length} cities, ${traditions.length} building traditions`);
  // Lookups at a place and time, from the tiles as the viewer reads them.
  const decoded = new Map<string, AnthromeTile>();
  const tileOf = (name: string): AnthromeTile | undefined => {
    if (decoded.has(name)) return decoded.get(name);
    const bytes = files.get(`people/anthromes/${name}.lwt`) as Uint8Array | undefined;
    if (!bytes) return undefined;
    const { header, arrays } = decodeTile<AnthromeTileHeader>(toBuffer(bytes));
    const t = anthromeTile(header, arrays[0] as Uint8Array, arrays[1] as Uint8Array, arrays[2] as Uint8Array);
    decoded.set(name, t);
    return t;
  };
  const at = (lat: number, lon: number, t: number) => {
    const step = nearestStep(steps, t);
    if (step < 0) return undefined;
    const tile = tileOf(tileKey(lat, lon, params.tile_deg).key);
    if (!tile) return { anthrome: 0, region: 0 };
    const cell = cellOf(tile, lat, lon);
    if (cell < 0) return { anthrome: 0, region: 0 };
    return { anthrome: classAtStep(tile, cell, step), region: tile.region[cell] };
  };
  const span: [number, number] = [steps[0], steps.at(-1)!];
  const assessed: [number, number] = [assessments.slices[0].year, assessments.slices.at(-1)!.year];
  return { files, index, assessments, traditions, cities, span, assessed, at, classes };
}

const toBuffer = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** What resolve reads of the human landscape (core/resolve.ts): the lifeway's tier at a place and time, and a city near it. */
export function landscapeResolve(b: LandscapeBuilt): NonNullable<import('../../../../core/resolve.ts').ResolveWorld['landscape']> {
  // The cities by whole degree, so that a grid of places asks only the few near each.
  const buckets = new Map<string, City[]>();
  for (const c of b.cities.cities) {
    const k = `${Math.floor(c.lat)}_${Math.floor(c.lon)}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(c);
  }
  const reach = b.index.reach_km;
  const lists = new Map(b.cities.lists.map((l) => [l.source, l]));
  return {
    span: b.span,
    at: (lat, lon, t) => {
      const here = b.at(lat, lon, t);
      if (!here || !here.anthrome) return undefined;
      for (let dl = -1; dl <= 1; dl++) for (let dn = -1; dn <= 1; dn++) {
        for (const c of buckets.get(`${Math.floor(lat) + dl}_${Math.floor(lon) + dn}`) ?? []) {
          const l = lists.get(c.source);
          if (kmBetween(lat, lon, c.lat, c.lon) <= reach && (cityPeople(c, t, l?.hold ?? 0, l?.gap ?? Infinity) ?? 0) > 0) return { tier: 'evidence', pattern: 'city', city: c.name };
        }
      }
      const a = here.region ? assessmentAt(b.assessments, here.region, t)?.a : undefined;
      const l = lifewayOf(b.classes, here.anthrome, 0, a);
      return { tier: l.tier, pattern: l.pattern };
    },
  };
}

/** How much of the land, at each of some times, HYDE and the archaeologists disagree on: the share of cells of land whose lifeway says so. */
export function disagreement(b: LandscapeBuilt, times: number[], step = 1): { t: number; land: number; disagree: number; evidence: number }[] {
  return times.map((t) => {
    let land = 0;
    let disagree = 0;
    let evidence = 0;
    for (let lat = -60 + step / 2; lat < 84; lat += step) {
      for (let lon = -180 + step / 2; lon < 180; lon += step) {
        const here = b.at(lat, lon, t);
        if (!here || !here.anthrome) continue;
        const a = here.region ? assessmentAt(b.assessments, here.region, t)?.a : undefined;
        const l = lifewayOf(b.classes, here.anthrome, 0, a);
        // The cosine weights a cell by its area.
        const w = Math.cos((lat * Math.PI) / 180);
        land += w;
        if (l.disagrees) disagree += w;
        if (l.tier === 'evidence') evidence += w;
      }
    }
    return { t, land: Math.round(land * 100) / 100, disagree: land ? Math.round((disagree / land) * 1e4) / 1e4 : 0, evidence: land ? Math.round((evidence / land) * 1e4) / 1e4 : 0 };
  });
}


/**
 * How HYDE's anthromes and the archaeologists agree on farming, region by region, at each of the survey's times: of the
 * regions where the archaeologists found no farming, how many the anthromes farm less than a hundredth of; and of those
 * where they call it widespread (over a fifth of the land), how many the anthromes farm at all, and more than a twentieth.
 * A farmed cell is one of a class of croplands, villages or dense settlements.
 */
export function farmingAgreement(b: LandscapeBuilt): { slice: string; year: number; none: [number, number]; widespread: [number, number, number] }[] {
  const farmed = new Set(b.classes.flatMap((c, i) => (c.level === 'Villages' || c.level === 'Croplands' || c.level === 'Dense settlements' ? [i + 1] : [])));
  const tiles: AnthromeTile[] = [];
  for (const [k, v] of b.files) {
    if (!/^people\/anthromes\/-?\d+_-?\d+\.lwt$/.test(k)) continue;
    const { header, arrays } = decodeTile<AnthromeTileHeader>(toBuffer(v as Uint8Array));
    tiles.push(anthromeTile(header, arrays[0] as Uint8Array, arrays[1] as Uint8Array, arrays[2] as Uint8Array));
  }
  return b.assessments.slices.map((sl, si) => {
    const step = nearestStep(b.index.steps, sl.year);
    const land = new Map<number, number>();
    const farm = new Map<number, number>();
    for (const t of tiles) {
      for (let c = 0; c < t.counts.length; c++) {
        const g = t.region[c];
        if (!t.counts[c] || !g) continue;
        const k = classAtStep(t, c, step);
        if (!k) continue;
        land.set(g, (land.get(g) ?? 0) + 1);
        if (farmed.has(k)) farm.set(g, (farm.get(g) ?? 0) + 1);
      }
    }
    const none: [number, number] = [0, 0];
    const wide: [number, number, number] = [0, 0, 0];
    for (const r of b.assessments.regions) {
      const a = b.assessments.rows[String(r.id)]?.[si];
      if (!a || !land.get(r.id)) continue;
      const level = Math.max(a.use[1][0], a.use[2][0]);
      const share = (farm.get(r.id) ?? 0) / land.get(r.id)!;
      if (level === 0) {
        none[1]++;
        if (share < 0.01) none[0]++;
      } else if (level === 3) {
        wide[2]++;
        if (share > 0) wide[0]++;
        if (share > 0.05) wide[1]++;
      }
    }
    return { slice: sl.label, year: sl.year, none, widespread: wide };
  });
}
