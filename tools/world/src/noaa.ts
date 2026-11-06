// NOAA's hazard databases as a dated snapshot: significant eruptions, earthquakes and tsunamis, read
// through the Hazard Event service and kept in world/snapshots, with the query that made them.
import type { HazardKind } from '../../../core/layers.ts';

const SERVICE = 'https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1';
const ENDPOINT: Record<HazardKind, string> = { eruption: 'volcanoes', earthquake: 'earthquakes', tsunami: 'tsunamis/events' };
const PAGE = 200;

/** A row as the snapshot keeps it: the database's year, on its own calendar. */
export interface HazardSource {
  kind: HazardKind;
  id: number;
  year: number;
  month?: number;
  day?: number;
  lat: number;
  lon: number;
  name: string;
  size?: number;
  deaths?: number;
}

export interface HazardSnapshot {
  format: 'lightworld-hazard-snapshot@1';
  snapshot: string;
  query: Record<HazardKind, string>;
  rows: HazardSource[];
}

type Item = Record<string, string | number | boolean | undefined>;

const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

/**
 * One item of the service, or nothing if it has no place to draw it at. A tsunami the database calls
 * very doubtful or questionable (its validity below 3) is left out.
 */
export function hazardRow(kind: HazardKind, it: Item): HazardSource | undefined {
  const lat = num(it.latitude);
  const lon = num(it.longitude);
  const year = num(it.year);
  if (lat === undefined || lon === undefined || year === undefined) return undefined;
  if (kind === 'tsunami' && (num(it.eventValidity) ?? 0) < 3) return undefined;
  const name = kind === 'eruption' ? `${String(it.name)}, ${String(it.country ?? it.location ?? '')}`.replace(/, $/, '') : String(it.locationName ?? it.country ?? '');
  const size = kind === 'eruption' ? num(it.vei) : kind === 'earthquake' ? num(it.eqMagnitude) : num(it.tsIntensity);
  const deaths = num(it.deathsTotal) ?? num(it.deaths);
  return {
    kind,
    id: num(it.id)!,
    year,
    ...(num(it.month) !== undefined ? { month: num(it.month) } : {}),
    ...(num(it.day) !== undefined ? { day: num(it.day) } : {}),
    lat,
    lon,
    name,
    ...(size !== undefined ? { size } : {}),
    ...(deaths !== undefined ? { deaths } : {}),
  };
}

/** Rows of a kind by page, in the order the service gives them. */
async function allOf(kind: HazardKind): Promise<HazardSource[]> {
  const out: HazardSource[] = [];
  for (let page = 1; ; page++) {
    const url = `${SERVICE}/${ENDPOINT[kind]}?itemsPerPage=${PAGE}&page=${page}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'wikiworldmodel-world-tools' } });
    if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
    const d = (await res.json()) as { items: Item[]; totalPages: number };
    for (const it of d.items) {
      const r = hazardRow(kind, it);
      if (r) out.push(r);
    }
    if (page >= d.totalPages) return out;
  }
}

export async function exportHazards(date: string): Promise<HazardSnapshot> {
  const rows = [...(await allOf('eruption')), ...(await allOf('earthquake')), ...(await allOf('tsunami'))];
  return {
    format: 'lightworld-hazard-snapshot@1',
    snapshot: date,
    query: { eruption: `${SERVICE}/${ENDPOINT.eruption}`, earthquake: `${SERVICE}/${ENDPOINT.earthquake}`, tsunami: `${SERVICE}/${ENDPOINT.tsunami}` },
    rows: rows.sort((a, b) => a.year - b.year || (a.month ?? 0) - (b.month ?? 0) || (a.day ?? 0) - (b.day ?? 0) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id - b.id)),
  };
}
