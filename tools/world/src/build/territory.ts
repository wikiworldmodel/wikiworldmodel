// Polities' territory for the viewer (territory.json): the rows of a borders dataset that
// each territory claim names (section 4.2: a geometry derived from a dataset), moved onto the
// time axis and into hundredths of a degree. Rows that lie wholly outside their polity's
// lifetime, in every scenario, are left out and reported.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatTime } from '../../../../core/time.ts';
import { TERRITORY_SCALE, type Territory, type TerritoryClaim, type TerritoryFile, type TerritoryRow } from '../../../../core/territory.ts';
import { datasetFile, type Dataset } from '../manifest.ts';
import { CACHE } from '../paths.ts';
import { sha256, stableStringify } from '../util.ts';
import { labeller, subjectTime, type Solved } from './records.ts';

/** What a territory claim's value names: a dataset, optionally its file, and its rows by name. */
export interface GeometryValue {
  from: string;
  file?: string;
  names: string[];
}

interface Polygon {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

interface DatasetRow {
  name: string;
  /** the dataset's years, as written */
  fromYear: number;
  toYear: number;
  area: number;
  geometry: Polygon;
}

/**
 * The dataset's years on the axis: integers, negative for BCE, with no year 0 (a stray 0 is
 * read as 1 BCE), and a row holds from its first year to the end of its last.
 */
const astronomical = (y: number) => (y < 0 ? y + 1 : y);

/** A borders dataset's rows with the given names, read as Cliopatria writes them; cached by checksum. */
async function datasetRows(id: string, d: Dataset, file: string | undefined, names: string[]): Promise<DatasetRow[]> {
  const member = file ?? Object.keys(d.fetch.files ?? {})[0];
  const key = sha256(stableStringify({ dataset: d.fetch.sha256, member, names: [...names].sort(), reader: 1 })).slice(0, 16);
  const cached = join(CACHE, 'import', `territory@${key}.json`);
  if (existsSync(cached)) return JSON.parse(await readFile(cached, 'utf8'));
  const path = datasetFile(id, d, member);
  if (!existsSync(path)) throw new Error(`missing ${path}; run \`npm run fetch\` first`);
  const doc = JSON.parse(await readFile(path, 'utf8')) as { features: { properties: Record<string, unknown>; geometry: Polygon }[] };
  const wanted = new Set(names);
  const rows: DatasetRow[] = doc.features
    .filter((f) => wanted.has(String(f.properties.Name)))
    .map((f) => ({ name: String(f.properties.Name), fromYear: Number(f.properties.FromYear), toYear: Number(f.properties.ToYear), area: Number(f.properties.Area), geometry: f.geometry }));
  await mkdir(join(CACHE, 'import'), { recursive: true });
  await writeFile(cached, JSON.stringify(rows));
  return rows;
}

/** Rings in hundredths of a degree, repeated points dropped; rings left with under 3 points go. */
function rings(g: Polygon): number[][] {
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][];
  const out: number[][] = [];
  for (const ring of polys.flat()) {
    const flat: number[] = [];
    for (const [lon, lat] of ring) {
      const x = Math.round(lon * TERRITORY_SCALE);
      const y = Math.round(lat * TERRITORY_SCALE);
      if (flat.length && flat[flat.length - 2] === x && flat[flat.length - 1] === y) continue;
      flat.push(x, y);
    }
    if (flat.length >= 6) out.push(flat);
  }
  return out;
}

/** A label point: the centroid of the rings, each weighted by its area. */
function labelPoint(rs: number[][]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (const r of rs) {
    let ra = 0;
    let rx = 0;
    let ry = 0;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const cross = r[j] * r[i + 1] - r[i] * r[j + 1];
      ra += cross;
      rx += (r[j] + r[i]) * cross;
      ry += (r[j + 1] + r[i + 1]) * cross;
    }
    if (ra === 0) continue;
    const w = Math.abs(ra);
    a += w;
    cx += (rx / (3 * ra)) * w;
    cy += (ry / (3 * ra)) * w;
  }
  if (!a) return [rs[0][0] / TERRITORY_SCALE, rs[0][1] / TERRITORY_SCALE];
  return [Math.round(cx / a) / TERRITORY_SCALE, Math.round(cy / a) / TERRITORY_SCALE];
}

/** The earliest start and the latest end a subject has in any scenario, at best estimates. */
function lifetime(t: Pick<Territory, 'time' | 'variants'>): [number, number] {
  const all = [t.time, ...Object.values(t.variants ?? {})];
  return [Math.min(...all.map((x) => x.start.best ?? -Infinity)), Math.max(...all.map((x) => x.end.best ?? Infinity))];
}

export async function territory(s: Solved, log: (line: string) => void = console.log): Promise<TerritoryFile> {
  const w = s.world;
  const labelOf = labeller(s);
  const bySubject = new Map<string, Territory>();
  for (const e of w.entities) {
    for (const c of e.claims) {
      if (c.prop !== 'territory' || c.status === 'deprecated') continue;
      const v = c.value as GeometryValue;
      const d = w.manifest.datasets[v.from];
      const found = await datasetRows(v.from, d, v.file, v.names);
      for (const name of v.names) if (!found.some((r) => r.name === name)) throw new Error(`${c.ref}: ${v.from} has no rows named "${name}"`);
      let t = bySubject.get(c.subject);
      if (!t) {
        t = { subject: c.subject, label: labelOf(c.subject), ...subjectTime(s, c.subject), claims: [] };
        if (c.subject === e.id && e.phases.length) t.phases = e.phases.map((p) => ({ label: p.label ?? p.id, ...subjectTime(s, `${e.id}@${p.id}`) }));
        bySubject.set(c.subject, t);
      }
      const [born, gone] = lifetime(t);
      const rows: TerritoryRow[] = [];
      const outside: string[] = [];
      for (const r of found.sort((a, b) => a.fromYear - b.fromYear || (a.name < b.name ? -1 : 1))) {
        const from = astronomical(r.fromYear);
        const to = astronomical(r.toYear) + 1;
        if (to <= born || from >= gone) {
          outside.push(`${r.name} ${formatTime(from)} – ${formatTime(to - 1)}`);
          continue;
        }
        const rs = rings(r.geometry);
        if (rs.length) rows.push({ name: r.name, from, to, area: Math.round(r.area), at: labelPoint(rs), rings: rs });
      }
      const n = outside.length;
      if (n) log(`note    territory   ${c.ref}: ${n} row${n > 1 ? 's' : ''} of ${v.from} ${n > 1 ? 'lie' : 'lies'} outside ${labelOf(c.subject)}'s lifetime and ${n > 1 ? 'are' : 'is'} left out: ${outside.join('; ')}`);
      const claim: TerritoryClaim = { claim: c.ref, value: v.names.join(', '), rank: c.rank, alt: c.alt, basis: c.basis, source: v.from, rows };
      t.claims.push(claim);
    }
  }
  return { territories: [...bySubject.values()].sort((a, b) => (a.subject < b.subject ? -1 : 1)) };
}
