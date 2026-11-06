// Today's borders and cities (present.json), from Natural Earth, and the hazards of the last few
// thousand years (hazards.json), from NOAA's snapshot. Both are rows of a dataset drawn over the globe.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gridSize, type HazardFile, type HazardRow, type LanguageRow, type LanguagesFile, type PeopleHeader, type PolitiesFile, type PolityRow, type PresentFile, type PresentPlace, type RouteRow, type RoutesFile } from '../../../../core/layers.ts';
import { formatTime, parsePoint, type TimePointInput } from '../../../../core/time.ts';
import { datasetFile } from '../manifest.ts';
import { CACHE } from '../paths.ts';
import { sha256, stableStringify } from '../util.ts';
import type { HazardSnapshot, HazardSource } from '../noaa.ts';
import type { Field, World } from '../world.ts';
import { parseTable } from './series.ts';
import { rowRef } from '../../../../core/refs.ts';
import { correctRows, type Fix } from '../tables.ts';
import { sourceRecord } from './records.ts';

interface Geo {
  features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[];
}

const hundredths = (x: number) => Math.round(x * 100);

/** A border's lines as flat hundredths of a degree, with their repeated points left out. */
export function linesOf(geometry: Geo['features'][number]['geometry']): number[][] {
  const lists = (geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates) as number[][][];
  return lists.map((l) => {
    const out: number[] = [];
    for (const [lon, lat] of l) {
      const x = hundredths(lon);
      const y = hundredths(lat);
      if (out.length >= 2 && out[out.length - 2] === x && out[out.length - 1] === y) continue;
      out.push(x, y);
    }
    return out;
  });
}

export function placeOf(p: Record<string, unknown>): PresentPlace {
  return {
    name: String(p.name),
    country: String(p.adm0name ?? p.sov0name ?? ''),
    lon: Number(p.longitude),
    lat: Number(p.latitude),
    pop: Number(p.pop_max ?? 0),
    capital: Number(p.adm0cap ?? 0) === 1,
  };
}

export async function presentLayer(w: World): Promise<PresentFile | undefined> {
  const f = w.fields.find((x) => x.data?.as === 'borders');
  if (!f) return undefined;
  const places = f.data!.places!;
  const read = async (id: string) => JSON.parse(await readFile(datasetFile(id, w.manifest.datasets[id]), 'utf8')) as Geo;
  const [lines, towns] = await Promise.all([read(f.data!.from), read(places)]);
  const borders: number[][] = [];
  const disputed: number[] = [];
  for (const b of lines.features) {
    const dis = /disputed/i.test(String(b.properties.FEATURECLA ?? ''));
    for (const l of linesOf(b.geometry)) {
      if (dis) disputed.push(borders.length);
      borders.push(l);
    }
  }
  const src = (id: string) => {
    const s = w.source.get(id);
    return s ? sourceRecord(s) : undefined;
  };
  return {
    format: 'lightworld-present@1',
    title: f.title,
    description: f.description,
    since: parsePoint(f.time!.lo as TimePointInput).t,
    until: parsePoint(f.time!.hi as TimePointInput).t,
    source: f.data!.from,
    sourceRecord: src(f.data!.from),
    placesSource: places,
    placesSourceRecord: src(places),
    borders,
    disputed,
    places: towns.features.map((t) => placeOf(t.properties)).sort((a, b) => b.pop - a.pop || (a.name < b.name ? -1 : 1)),
  };
}

/** A row on the world's axis. The database counts 2150 BC as −2150, with no year zero. */
export function hazardOf(r: HazardSource): HazardRow {
  const year = r.year < 0 ? r.year + 1 : r.year;
  const t = year + ((r.month ?? 1) - 1 + ((r.day ?? 1) - 1) / 31) / 12 + (r.month === undefined ? 0.5 : r.day === undefined ? 1 / 24 : 1 / 744);
  const stamp = r.month !== undefined ? `${r.day !== undefined ? `${r.day} ` : ''}${MONTHS[r.month - 1]} ` : '';
  return {
    kind: r.kind,
    t: Math.round(t * 1000) / 1000,
    when: `${stamp}${formatTime(year)}`,
    lat: r.lat,
    lon: r.lon,
    name: r.name,
    ...(r.size !== undefined ? { size: r.size } : {}),
    ...(r.deaths !== undefined ? { deaths: r.deaths } : {}),
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export async function hazardLayer(w: World, fixes: Map<string, Fix[]> = new Map()): Promise<HazardFile | undefined> {
  const f: Field | undefined = w.fields.find((x) => x.data?.as === 'hazards');
  if (!f) return undefined;
  const id = f.data!.from;
  const snap = JSON.parse(await readFile(datasetFile(id, w.manifest.datasets[id]), 'utf8')) as HazardSnapshot;
  const s = w.source.get(id);
  // Each row with its address, and what the overlays correct in it.
  const raw = snap.rows as unknown as Record<string, unknown>[];
  const fixed = f.rows ? correctRows(f.rows, raw, fixes) : undefined;
  const rows = (fixed?.rows ?? raw).map((r, i) => {
    const row = hazardOf(r as unknown as HazardSource);
    if (!fixed) return row;
    const changed = fixed.changed.get(i);
    return { ...row, row: rowRef(id, fixed.keys[i]), ...(changed ? { corrected: changed } : {}) };
  });
  return {
    format: 'lightworld-hazards@1',
    title: f.title,
    description: f.description,
    source: id,
    sourceRecord: s ? sourceRecord(s) : undefined,
    rows: rows.sort((a, b) => a.t - b.t),
  };
}

/** A line thinned to within `tolerance` of itself: Douglas and Peucker's rule, keeping its ends. */
export function thin(points: number[], tolerance: number): number[] {
  const n = points.length >> 1;
  if (n < 3) return points;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const limit = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = points[a * 2];
    const ay = points[a * 2 + 1];
    const ex = points[b * 2] - ax;
    const ey = points[b * 2 + 1] - ay;
    const q = ex * ex + ey * ey;
    let far = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = points[i * 2] - ax;
      const py = points[i * 2 + 1] - ay;
      const k = q > 0 ? Math.max(0, Math.min(1, (px * ex + py * ey) / q)) : 0;
      const dx = px - ex * k;
      const dy = py - ey * k;
      const d = dx * dx + dy * dy;
      if (d > far) {
        far = d;
        at = i;
      }
    }
    if (far > limit) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  return out;
}

/** The dataset's years on the axis: no year 0 (a stray 0 is read as 1 BCE), and a row holds to the end of its last year. */
const yearOf = (y: number) => (y < 0 ? y + 1 : y);

interface PolityFeature {
  properties: { Name: string; FromYear: number; ToYear: number; Area: number; Type?: string; Wikipedia?: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

/** One row of the dataset, thinned; undefined if nothing is left of it. */
export function polityRow(f: PolityFeature, tolerance: number): PolityRow | undefined {
  const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
  const rings: number[][] = [];
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (const ring of polys.flat()) {
    const flat: number[] = [];
    for (const [lon, lat] of ring) flat.push(Math.round(lon * 100), Math.round(lat * 100));
    const kept = thin(flat, tolerance * 100);
    if (kept.length < 6) continue;
    rings.push(kept);
    for (let i = 0; i < kept.length; i += 2) {
      sx += kept[i];
      sy += kept[i + 1];
      count++;
    }
  }
  if (!rings.length) return undefined;
  const p = f.properties;
  return {
    name: p.Name,
    from: yearOf(p.FromYear),
    to: yearOf(p.ToYear) + 1,
    area: Math.round(p.Area),
    at: [Math.round(sx / count) / 100, Math.round(sy / count) / 100],
    rings,
    ...(p.Wikipedia ? { wikipedia: p.Wikipedia } : {}),
  };
}

/** The states of the world as rows, thinned for the globe; those a record draws as its own territory are left to it. */
export async function polityLayer(w: World, claimed: ReadonlySet<string>, fixes: Map<string, Fix[]> = new Map()): Promise<PolitiesFile | undefined> {
  const f = w.fields.find((x) => x.data?.as === 'polities');
  if (!f) return undefined;
  const id = f.data!.from;
  const d = w.manifest.datasets[id];
  const tolerance = (f.params as { tolerance_deg: number }).tolerance_deg;
  // The overlays' corrections are part of what is cached: a new one makes the rows again.
  const key = sha256(stableStringify({ dataset: d.fetch.sha256, tolerance, rows: f.rows ?? null, fixes: [...fixes].sort(([a], [b]) => (a < b ? -1 : 1)), reader: 2 })).slice(0, 16);
  const cached = join(CACHE, 'import', `polities@${key}.json`);
  let rows: PolityRow[];
  if (existsSync(cached)) rows = JSON.parse(await readFile(cached, 'utf8'));
  else {
    const member = f.data!.file ?? Object.keys(d.fetch.files ?? {})[0];
    const doc = JSON.parse(await readFile(datasetFile(id, d, member), 'utf8')) as { features: PolityFeature[] };
    const fixed = f.rows ? correctRows(f.rows, doc.features.map((x) => x.properties as unknown as Record<string, unknown>), fixes) : undefined;
    rows = doc.features
      .map((x, i) => {
        const r = polityRow(fixed ? { ...x, properties: fixed.rows[i] as unknown as PolityFeature['properties'] } : x, tolerance);
        if (!r || !fixed) return r;
        const changed = fixed.changed.get(i);
        return { ...r, row: rowRef(id, fixed.keys[i]), ...(changed ? { corrected: changed } : {}) };
      })
      .filter((x): x is PolityRow => !!x);
    await mkdir(join(CACHE, 'import'), { recursive: true });
    await writeFile(cached, JSON.stringify(rows));
  }
  const s = w.source.get(id);
  return {
    format: 'lightworld-polities@1',
    title: f.title,
    description: f.description,
    source: id,
    sourceRecord: s ? sourceRecord(s) : undefined,
    rows: rows.filter((r) => !claimed.has(r.name)).sort((a, b) => a.from - b.from || (a.name < b.name ? -1 : 1)),
  };
}

/** Latitude and longitude from the world Mercator projection (EPSG:3395), on the WGS 84 ellipsoid. */
export function fromWorldMercator(x: number, y: number): [lat: number, lon: number] {
  const a = 6378137;
  const e = 0.0818191908426215;
  const t = Math.exp(-y / a);
  let phi = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 8; i++) {
    const s = e * Math.sin(phi);
    phi = Math.PI / 2 - 2 * Math.atan(t * ((1 - s) / (1 + s)) ** (e / 2));
  }
  return [(phi * 180) / Math.PI, (x / a) * (180 / Math.PI)];
}

interface RoadFeature {
  properties: { Type?: string; Segment_s?: string; Lower_Date?: number | null; Upper_Date?: number | null };
  geometry: { type: 'MultiLineString' | 'LineString'; coordinates: unknown } | null;
}

/** A date the dataset gives, or nothing: it writes 9999 for none. */
const knownYear = (y: number | null | undefined) => (y === null || y === undefined || y === 9999 ? undefined : y < 0 ? y + 1 : y);

/** The stretches of one road of Itiner-e, thinned. */
export function routeRows(f: RoadFeature, tolerance: number, span: [number, number]): RouteRow[] {
  if (!f.geometry) return [];
  const lists = (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][];
  const certainty = (f.properties.Segment_s ?? 'conjectured').toLowerCase() as RouteRow['certainty'];
  const out: RouteRow[] = [];
  for (const l of lists) {
    const flat: number[] = [];
    for (const [x, y] of l) {
      const [lat, lon] = fromWorldMercator(x, y);
      flat.push(Math.round(lon * 100), Math.round(lat * 100));
    }
    const line = thin(flat, tolerance * 100);
    if (line.length < 4 || (line.length === 4 && line[0] === line[2] && line[1] === line[3])) continue;
    out.push({ line, main: f.properties.Type === 'Main Road', certainty, from: knownYear(f.properties.Lower_Date) ?? span[0], to: knownYear(f.properties.Upper_Date) ?? span[1] });
  }
  return out;
}

export async function routesLayer(w: World, fixes: Map<string, Fix[]> = new Map()): Promise<RoutesFile | undefined> {
  const f = w.fields.find((x) => x.data?.as === 'routes');
  if (!f) return undefined;
  const id = f.data!.from;
  const d = w.manifest.datasets[id];
  const tolerance = (f.params as { tolerance_deg: number }).tolerance_deg;
  const span: [number, number] = [parsePoint(f.time!.lo as TimePointInput).t, parsePoint(f.time!.hi as TimePointInput).t];
  const key = sha256(stableStringify({ dataset: d.fetch.sha256, tolerance, span, fixes: [...fixes].sort(([a], [b]) => (a < b ? -1 : 1)), reader: 1 })).slice(0, 16);
  const cached = join(CACHE, 'import', `routes@${key}.json`);
  let routes: RouteRow[];
  if (existsSync(cached)) routes = JSON.parse(await readFile(cached, 'utf8'));
  else {
    const doc = JSON.parse(await readFile(datasetFile(id, d), 'utf8')) as { features: RoadFeature[] };
    const fixed = f.rows && fixes.size ? correctRows(f.rows, doc.features.map((x) => x.properties as unknown as Record<string, unknown>), fixes).rows : undefined;
    routes = doc.features.flatMap((x, i) => routeRows(fixed ? { ...x, properties: fixed[i] as unknown as RoadFeature['properties'] } : x, tolerance, span));
    await mkdir(join(CACHE, 'import'), { recursive: true });
    await writeFile(cached, JSON.stringify(routes));
  }
  const s = w.source.get(id);
  return { format: 'lightworld-routes@1', title: f.title, description: f.description, source: id, sourceRecord: s ? sourceRecord(s) : undefined, routes };
}

/** Glottolog's languages with a place, from its table of languoids; a family's name for a language in one. */
export function languageRows(rows: Record<string, string>[]): LanguageRow[] {
  const names = new Map(rows.map((r) => [r.ID, r.Name]));
  const out: LanguageRow[] = [];
  for (const r of rows) {
    if (r.Level !== 'language' || !r.Latitude || !r.Longitude) continue;
    out.push({ name: r.Name, family: names.get(r.Family_ID) ?? r.Name, lat: Math.round(Number(r.Latitude) * 1000) / 1000, lon: Math.round(Number(r.Longitude) * 1000) / 1000, code: r.Glottocode });
  }
  return out.sort((a, b) => (a.code < b.code ? -1 : 1));
}

export async function languagesLayer(w: World, fixes: Map<string, Fix[]> = new Map()): Promise<LanguagesFile | undefined> {
  const f = w.fields.find((x) => x.data?.as === 'languages');
  if (!f) return undefined;
  const id = f.data!.from;
  const s = w.source.get(id);
  const table = parseTable(await readFile(datasetFile(id, w.manifest.datasets[id]), 'utf8'));
  const fixed = f.rows && fixes.size ? correctRows(f.rows, table, fixes) : undefined;
  const corrected = new Map([...(fixed?.changed ?? [])].map(([i, props]) => [table[i].Glottocode, props]));
  const rows = languageRows(fixed?.rows ?? table).map((r) => (corrected.has(r.code) ? { ...r, corrected: corrected.get(r.code) } : r));
  return {
    format: 'lightworld-languages@1',
    title: f.title,
    description: f.description,
    source: id,
    sourceRecord: s ? sourceRecord(s) : undefined,
    rows,
  };
}

/** A snapshot's table of people on a grid: its steps, and for each cell that ever holds anyone, where it is, its land, and how many at each step. */
export function peopleTable(text: string, res: number): { steps: number[]; cell: Uint32Array; land: Uint32Array; people: Uint32Array } {
  const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
  const head = lines[0].split(',');
  if (head.slice(0, 3).join(',') !== 'lat,lon,land_km2') throw new Error(`a population table starts "lat,lon,land_km2", not "${head.slice(0, 3).join(',')}"`);
  const steps = head.slice(3).map(Number);
  const { nx, ny } = gridSize(res);
  const n = lines.length - 1;
  const cell = new Uint32Array(n);
  const land = new Uint32Array(n);
  const people = new Uint32Array(n * steps.length);
  for (let i = 0; i < n; i++) {
    const f = lines[i + 1].split(',');
    if (f.length !== head.length) throw new Error(`row ${i + 1} of a population table has ${f.length} columns, not ${head.length}`);
    // A row's latitude and longitude are its south-west corner.
    const row = (90 - Number(f[0])) / res - 1;
    const col = (Number(f[1]) + 180) / res;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= ny || col < 0 || col >= nx) throw new Error(`row ${i + 1} of a population table is at ${f[0]}, ${f[1]}: not a corner of the grid`);
    cell[i] = row * nx + col;
    if (i > 0 && cell[i] <= cell[i - 1]) throw new Error(`row ${i + 1} of a population table is out of order`);
    land[i] = Number(f[2]);
    for (let j = 0; j < steps.length; j++) people[j * n + i] = Number(f[3 + j]);
  }
  return { steps, cell, land, people };
}

/** Where people lived, from the snapshot its field names; the viewer's colours and the authors' range are the field's. */
export async function peopleLayer(w: World): Promise<{ header: PeopleHeader; arrays: Uint32Array[] } | undefined> {
  const f = w.fields.find((x) => x.data?.as === 'people');
  if (!f) return undefined;
  const id = f.data!.from;
  const grid = f.grid as { kind: 'lonlat'; res_deg: number };
  const t = peopleTable(await readFile(datasetFile(id, w.manifest.datasets[id]), 'utf8'), grid.res_deg);
  const lo = parsePoint(f.time!.lo as TimePointInput).t;
  const hi = parsePoint(f.time!.hi as TimePointInput).t;
  if (t.steps[0] !== lo || t.steps.at(-1) !== hi) throw new Error(`${f.id}: its table runs from ${t.steps[0]} to ${t.steps.at(-1)}, and the field says ${lo} to ${hi}`);
  const p = f.params as unknown as { scale: PeopleHeader['scale']; range: { at: TimePointInput; percent: number }[] };
  const s = w.source.get(id);
  return {
    header: {
      format: 'lightworld-people@1',
      title: f.title,
      description: f.description,
      source: id,
      sourceRecord: s ? sourceRecord(s) : undefined,
      res: grid.res_deg,
      steps: t.steps,
      scale: p.scale,
      range: p.range.map((r) => [parsePoint(r.at).t, r.percent] as [number, number]).sort((a, b) => a[0] - b[0]),
    },
    arrays: [t.cell, t.land, t.people],
  };
}
