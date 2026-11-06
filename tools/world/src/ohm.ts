// OpenHistoricalMap, read as a pinned snapshot of one site (section 8.1: databases that change
// continuously are pinned as dated snapshots). Its data is CC0 except where a tag says
// otherwise, and those elements are left out when the snapshot is made.
//
// Every dated element of the snapshot becomes a record of its own, written as a machine's
// proposal: a footprint and a name and dates that a community of mappers traced from the maps
// in their `source` tags. A record written by hand adopts an element by naming it in its
// footprint claim, and then that element is no longer imported.
import type { Claim, Entity } from './world.ts';

export type LatLon = [lat: number, lon: number];

export interface OhmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags: Record<string, string>;
  /** a node's point */
  point?: LatLon;
  /** a way's line; closed if it ends where it starts */
  line?: LatLon[];
  /** a relation's rings, or the chains that did not close */
  outer?: LatLon[][];
  inner?: LatLon[][];
}

export interface OhmSnapshot {
  format: 'lightworld-ohm-snapshot@1';
  snapshot: string;
  bbox: [south: number, west: number, north: number, east: number];
  query: string;
  elements: OhmElement[];
}

/** An element's name in a footprint claim: way/123. */
export const elementKey = (e: Pick<OhmElement, 'type' | 'id'>) => `${e.type}/${e.id}`;

/** The Overpass query a snapshot is made from. */
export function snapshotQuery(bbox: OhmSnapshot['bbox']): string {
  const b = bbox.join(',');
  return `[out:json][timeout:170];(way(${b});relation(${b});node["start_date"](${b}););out geom;`;
}

const KEEP_TAGS = new Set([
  'name', 'name:en', 'name:la', 'name:it', 'alt_name', 'start_date', 'end_date', 'building', 'building:part', 'building:levels', 'building:colour',
  'height', 'min_height', 'roof:shape', 'roof:colour', 'roof:height', 'amenity', 'historic', 'leisure', 'landuse', 'natural', 'water', 'waterway',
  'bridge', 'tunnel', 'layer', 'highway', 'surface', 'barrier', 'place', 'wikidata', 'tomb', 'theatre:type', 'sport', 'man_made', 'tourism', 'source', 'source:url', 'source:1',
]);

/** Year on the time axis from a tag such as -0496, 0075-01-01 or 312-10-28 (ISO 8601: year 0 is 1 BCE). */
export function ohmYear(s: string | undefined): number | undefined {
  const m = s === undefined ? null : /^(-?)(\d{1,4})(?:-\d\d(?:-\d\d)?)?(?:~|\?)?$/.exec(s.trim());
  if (!m) return undefined;
  const y = Number(m[2]);
  return m[1] ? -y : y;
}

/** The year as the world's records write it. */
const yearText = (y: number) => (y <= 0 ? `${1 - y} BCE` : `${y} CE`);

const closes = (a: LatLon, b: LatLon) => a[0] === b[0] && a[1] === b[1];

/** Join a relation's ways end to end: closed rings, and whatever chains are left open. */
export function assembleRings(lines: LatLon[][]): LatLon[][] {
  const left = lines.filter((l) => l.length > 1).map((l) => [...l]);
  const out: LatLon[][] = [];
  while (left.length) {
    const chain = left.shift()!;
    for (let grown = true; grown && !closes(chain[0], chain[chain.length - 1]); ) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const l = left[i];
        const tail = chain[chain.length - 1];
        if (closes(l[0], tail)) chain.push(...l.slice(1));
        else if (closes(l[l.length - 1], tail)) chain.push(...[...l].reverse().slice(1));
        else if (closes(l[l.length - 1], chain[0])) chain.unshift(...l.slice(0, -1));
        else if (closes(l[0], chain[0])) chain.unshift(...[...l].reverse().slice(0, -1));
        else continue;
        left.splice(i, 1);
        grown = true;
        break;
      }
    }
    out.push(chain);
  }
  return out;
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const point = (p: { lat: number; lon: number }): LatLon => [round(p.lat), round(p.lon)];

/** Is an element something of the ancient city: dated in antiquity, or the river it stands on? */
function belongs(tags: Record<string, string>): boolean {
  if (tags.licence || tags.license) return false;
  if (tags.boundary || tags.route || tags.railway || tags.type === 'route') return false;
  if (tags.natural === 'water' && !tags.start_date) return true;
  if (tags.name === 'Insula Tiberina') return true;
  const start = ohmYear(tags.start_date);
  const end = ohmYear(tags.end_date);
  if (start === undefined) return false;
  return start <= 600 && (end === undefined || end >= -1000);
}

/** Where the map's database answers queries. */
export const OVERPASS = 'https://overpass-api.openhistoricalmap.org/api/interpreter';

/** Ask the map's database for a fresh extract of a snapshot's box, and make a snapshot of it. */
export async function exportSnapshot(bbox: OhmSnapshot['bbox'], date: string): Promise<OhmSnapshot> {
  const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: snapshotQuery(bbox) }), headers: { 'User-Agent': 'wikiworldmodel-world-tools' } });
  if (!res.ok) throw new Error(`POST ${OVERPASS}: HTTP ${res.status}`);
  return snapshotFrom((await res.json()) as { elements: Record<string, unknown>[] }, date, bbox);
}

/** A snapshot from an Overpass response: the elements that belong, in id order, with the tags used. */
export function snapshotFrom(raw: { elements: Record<string, unknown>[] }, date: string, bbox: OhmSnapshot['bbox']): OhmSnapshot {
  const elements: OhmElement[] = [];
  for (const e of raw.elements as { type: OhmElement['type']; id: number; tags?: Record<string, string>; lat?: number; lon?: number; geometry?: { lat: number; lon: number }[]; members?: { type: string; role: string; geometry?: ({ lat: number; lon: number } | null)[] }[] }[]) {
    const all = e.tags ?? {};
    if (!belongs(all)) continue;
    const tags = Object.fromEntries(Object.entries(all).filter(([k]) => KEEP_TAGS.has(k)).sort(([a], [b]) => (a < b ? -1 : 1)));
    const out: OhmElement = { type: e.type, id: e.id, tags };
    if (e.type === 'node') out.point = [round(e.lat!), round(e.lon!)];
    else if (e.type === 'way') out.line = (e.geometry ?? []).map(point);
    else {
      const of = (role: string) => (e.members ?? []).filter((m) => m.type === 'way' && m.role === role).map((m) => (m.geometry ?? []).filter((g): g is { lat: number; lon: number } => !!g).map(point));
      out.outer = assembleRings([...of('outer'), ...of('')]);
      out.inner = assembleRings(of('inner'));
      if (!out.outer.length) continue;
    }
    elements.push(out);
  }
  elements.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.id - b.id));
  return { format: 'lightworld-ohm-snapshot@1', snapshot: date, bbox, query: snapshotQuery(bbox), elements };
}

/** What sort of thing an element is, from its tags. */
export function ohmKind(e: OhmElement): string {
  const t = e.tags;
  const name = (t.name ?? '').toLowerCase();
  if (t.natural === 'water' || t.waterway === 'river') return 'open/water';
  if (t.highway) return 'works/road';
  if (t.barrier === 'city_wall' || t.barrier === 'wall') return 'works/wall';
  if (t.historic === 'city_gate' || t.barrier === 'gate') return 'works/gate';
  if (t.waterway) return /cloaca/.test(name) ? 'works/sewer' : 'works/aqueduct';
  if (t.man_made === 'bridge') return 'works/bridge';
  if (t.place === 'suburb' || t.place === 'quarter') return 'open/district';
  if (t.place === 'islet' || t.place === 'island') return 'open/island';
  if (t.place === 'square' || t.place === 'city') return 'open/square';
  if (t.leisure === 'garden' || t.natural) return 'open/garden';
  if (t.landuse === 'cemetery') return 'open/cemetery';
  if (t.tourism === 'zoo') return 'open/enclosure';
  if (t.landuse === 'military' || t.military) return 'building/barracks';
  if (t.landuse) return 'open/district';
  if (/^(arcus|arco|fornix|arcate)\b/.test(name)) return 'monument/arch';
  if (/^(column|colonna)/.test(name)) return 'monument/column';
  if (/^obelisco/.test(name)) return 'monument/obelisk';
  if (/^(colossus|equus|statua)/.test(name)) return 'monument/statue';
  if (t.amenity === 'public_bath' || /^(thermae|terme)\b/.test(name)) return 'building/baths';
  if (t.amenity === 'theatre') return t['theatre:type'] === 'amphi' ? 'building/amphitheatre' : 'building/theatre';
  if (t.leisure === 'stadium' || t.leisure === 'track' || t.leisure === 'sports_centre') return 'building/circus';
  if (t.building === 'temple' || t.amenity === 'place_of_worship') return 'building/temple';
  if (t.building === 'pyramid' || t.historic === 'tomb' || t.tomb) return 'building/tomb';
  if (t.building === 'warehouse') return 'building/warehouse';
  if (t.amenity === 'marketplace' || t.building === 'commercial') return 'building/market';
  if (t.building === 'house' || t.building === 'residential') return 'building/house';
  if (t.historic === 'castle') return 'building/palace';
  if (t.building === 'public' || t.building === 'civic') return 'building/civic';
  if (t.historic === 'monument' || t.historic === 'memorial') return 'monument/other';
  return 'building/other';
}

/** Where an element is: the mean of its points, which for a ring is near enough to place a label. */
export function ohmCentre(e: OhmElement): LatLon {
  const pts = e.point ? [e.point] : (e.line ?? e.outer!.flat());
  // A closed ring repeats its first point.
  const n = pts.length > 1 && closes(pts[0], pts[pts.length - 1]) ? pts.length - 1 : pts.length;
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < n; i++) {
    lat += pts[i][0];
    lon += pts[i][1];
  }
  return [round(lat / n), round(lon / n)];
}

const IMPORT_AUTHOR = 'machine:ohm-import';

/**
 * The records of a snapshot's elements, leaving out those a written record has adopted. A
 * start later than the end (the map is a work in progress) keeps the start alone, with a note.
 */
export function ohmEntities(snap: OhmSnapshot, dataset: string, file: string, frame: string, adopted: Set<string>): Entity[] {
  const out: Entity[] = [];
  for (const e of snap.elements) {
    const key = elementKey(e);
    if (adopted.has(key)) continue;
    const id = `rome/ohm/${e.type}-${e.id}`;
    const t = e.tags;
    const claims: Claim[] = [];
    const add = (k: string, prop: string, value: unknown, extra: Partial<Claim> = {}) =>
      claims.push({
        key: k,
        entity: id,
        ref: `${id}#${k}`,
        subject: id,
        sources: [{ ref: dataset, loc: key }],
        basis: 'reconstruction',
        author: IMPORT_AUTHOR,
        status: 'proposed',
        rank: 'normal',
        checked: [],
        file,
        where: `${key} ${k}`,
        prop,
        value,
        method: 'compilation',
        ...extra,
      });
    const name: Record<string, string> = {};
    if (t['name:en']) name.en = t['name:en'];
    if (t['name:la']) name.la = t['name:la'];
    // The river is the one water the map names only in Latin.
    if (t.water === 'river' && t.name) {
      name.en = UNNAMED['open/water'];
      name.la = t.name;
    }
    if (t.name && !Object.values(name).includes(t.name)) name.und = t.name;
    if (!Object.keys(name).length) name.en = UNNAMED[ohmKind(e)] ?? 'A structure the map does not name';
    add('name', 'name', name);
    const start = ohmYear(t.start_date);
    const end = ohmYear(t.end_date);
    if (start !== undefined) add('start', 'start', yearText(start), t.source ? { note: `The map's source: ${t.source}` } : {});
    else add('start', 'start', { hi: '1000 BCE' }, { note: 'The map gives no date: it is as old as the site.' });
    if (end !== undefined && (start === undefined || end >= start)) add('end', 'end', yearText(end));
    else if (end !== undefined) claims[claims.length - 1].note = `The map's end date, ${t.end_date}, is before its start, and is left out.`;
    const [lat, lon] = ohmCentre(e);
    add('location', 'location', { lat, lon, frame: 'frame:earth/present-day' });
    add('frame', 'frame', frame, { method: 'plate-polygon', sources: [{ ref: 'src:paleomap-plate-model', loc: 'PALEOMAP_PlatePolygons.gpml' }] });
    if (!e.point) add('footprint', 'footprint', { from: dataset, elements: [key] });
    const height = Number(t.height);
    if (t.height && Number.isFinite(height) && height > 0) add('height', 'height', height);
    out.push({ id, kind: ohmKind(e), phases: [], claims, relations: [], file, same_as: t.wikidata ? { ohm: key, wikidata: t.wikidata } : { ohm: key } });
  }
  return out;
}

const UNNAMED: Record<string, string> = {
  'works/road': 'A street the map does not name',
  'works/wall': 'A stretch of wall',
  'works/gate': 'A gate the map does not name',
  'works/aqueduct': 'An aqueduct the map does not name',
  'open/water': 'The Tiber',
  'open/garden': 'A garden the map does not name',
  'open/square': 'A square the map does not name',
  'building/temple': 'A temple the map does not name',
  'monument/other': 'A monument the map does not name',
};
