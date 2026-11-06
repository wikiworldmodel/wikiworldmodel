// The Paleobiology Database, read as a pinned snapshot of one formation (section 8.1: databases
// that change continuously are pinned as dated snapshots). A snapshot holds the formation's
// occurrences and collections, as rows, and the taxa they name with all their parents.
//
// The rows stay rows: a formation has thousands, and they are data, not things anyone wrote. Its
// taxa become records of their own, written as a machine's proposal (tools/world/src/world.ts), so
// that the tree of life and the solver can use them. A record written by hand adopts a taxon by
// giving its PBDB id in same_as, and what it does not say is filled in from the snapshot.

import type { Claim, Entity, Relation } from './world.ts';

const SERVICE = 'https://paleobiodb.org/data1.2';

export interface PbdbTaxon {
  /** the PBDB's accepted taxon number */
  no: number;
  name: string;
  rank: string;
  /** its parent's number; 0 for the root */
  parent: number;
  extant: boolean | null;
  /** the oldest and youngest ages of the interval it first appears in, and of the one it last appears in, in Ma */
  first: [number, number] | null;
  last: [number, number] | null;
  /** how many occurrences the whole database holds */
  occs: number;
}

export interface PbdbCollection {
  no: number;
  name: string;
  lat: number;
  lng: number;
  formation: string;
  member?: string;
  state?: string;
  county?: string;
  environment?: string;
  lithology?: string;
}

export interface PbdbOccurrence {
  no: number;
  collection: number;
  /** the accepted taxon's number */
  taxon: number;
  /** the name as identified in the record */
  identified: string;
  max: number;
  min: number;
  interval: string;
}

export interface PbdbSnapshot {
  format: 'lightworld-pbdb-snapshot@1';
  snapshot: string;
  formation: string;
  license: string;
  /** what the service was asked, with the date it answered */
  query: { occurrences: string; collections: string; taxa: string };
  taxa: PbdbTaxon[];
  collections: PbdbCollection[];
  occurrences: PbdbOccurrence[];
}

type Row = Record<string, string | number | undefined>;

async function service(url: string): Promise<{ records: Row[]; data_license?: string }> {
  const res = await fetch(url, { headers: { 'User-Agent': 'wikiworldmodel-world-tools' } });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return (await res.json()) as { records: Row[]; data_license?: string };
}

const num = (x: string | number | undefined): number => Number(x);

/** A snapshot from the service's answers: the rows of the formation itself, in number order. */
export function snapshotFrom(formation: string, date: string, license: string, query: PbdbSnapshot['query'], occs: Row[], colls: Row[], taxa: Row[]): PbdbSnapshot {
  // A search by formation also finds names that contain it, such as Shell Creek.
  const collections: PbdbCollection[] = colls
    .filter((c) => c.formation === formation)
    .map((c) => {
      const out: PbdbCollection = { no: num(c.collection_no), name: String(c.collection_name ?? ''), lat: num(c.lat), lng: num(c.lng), formation: String(c.formation) };
      if (c.member) out.member = String(c.member);
      if (c.state) out.state = String(c.state);
      if (c.county) out.county = String(c.county);
      if (c.environment) out.environment = String(c.environment);
      if (c.lithology1) out.lithology = String(c.lithology1);
      return out;
    })
    .sort((a, b) => a.no - b.no);
  const known = new Set(collections.map((c) => c.no));
  const occurrences: PbdbOccurrence[] = occs
    .filter((o) => known.has(num(o.collection_no)) && o.accepted_no !== undefined && num(o.accepted_no) > 0)
    .map((o) => ({
      no: num(o.occurrence_no),
      collection: num(o.collection_no),
      taxon: num(o.accepted_no),
      identified: String(o.identified_name ?? o.accepted_name),
      max: num(o.max_ma),
      min: num(o.min_ma),
      interval: o.late_interval ? `${o.early_interval}–${o.late_interval}` : String(o.early_interval),
    }))
    .sort((a, b) => a.no - b.no);
  const seen = new Map<number, PbdbTaxon>();
  for (const t of taxa) {
    // A name's concept is its orig_no: parents and accepted names point to that, not to a spelling.
    const no = num(t.orig_no);
    if (seen.has(no) || num(t.accepted_no) !== no) continue;
    seen.set(no, {
      no,
      name: String(t.taxon_name),
      rank: String(t.accepted_rank ?? t.taxon_rank ?? ''),
      parent: num(t.parent_no ?? 0),
      extant: t.is_extant === 'extant' ? true : t.is_extant === 'extinct' ? false : null,
      first: t.firstapp_max_ma === undefined ? null : [num(t.firstapp_max_ma), num(t.firstapp_min_ma)],
      last: t.lastapp_max_ma === undefined ? null : [num(t.lastapp_max_ma), num(t.lastapp_min_ma)],
      occs: num(t.n_occs ?? 0),
    });
  }
  return { format: 'lightworld-pbdb-snapshot@1', snapshot: date, formation, license, query, taxa: [...seen.values()].sort((a, b) => a.no - b.no), collections, occurrences };
}

/** Ask the service for a formation: its occurrences and collections, and every taxon they name with all its parents. */
export async function exportSnapshot(formation: string, date: string): Promise<PbdbSnapshot> {
  const strat = encodeURIComponent(formation);
  const occUrl = `${SERVICE}/occs/list.json?strat=${strat}&show=ident,strat&vocab=pbdb&limit=all&datainfo`;
  const colUrl = `${SERVICE}/colls/list.json?strat=${strat}&show=loc,strat,lith,env&vocab=pbdb&limit=all`;
  const taxUrl = `${SERVICE}/taxa/list.json?id={ids}&rel=all_parents&show=app,size&vocab=pbdb&limit=all`;
  const occs = await service(occUrl);
  const colls = await service(colUrl);
  const names = [...new Set(occs.records.map((o) => num(o.accepted_no)).filter((n) => n > 0))].sort((a, b) => a - b);
  const taxa: Row[] = [];
  for (let i = 0; i < names.length; i += 120) {
    const ids = names.slice(i, i + 120).map((n) => `txn:${n}`).join(',');
    taxa.push(...(await service(taxUrl.replace('{ids}', ids))).records);
  }
  return snapshotFrom(formation, date, occs.data_license ?? 'unknown', { occurrences: occUrl, collections: colUrl, taxa: taxUrl }, occs.records, colls.records, taxa);
}

// ——— The land's fossils, all of them ———

/**
 * The fossils of the land, for the atlas of who lived where: every regular occurrence named to a genus or
 * better from a terrestrial environment, over the Phanerozoic. It has far too many taxa to make records of,
 * so rows stay rows and taxa stay rows too. Only a taxon a record adopts by its number becomes part of the
 * world's tree. It is kept as tables with few repeated strings, as it is the largest thing in world/snapshots.
 */
export interface LandSnapshot {
  format: 'lightworld-pbdb-land@1';
  snapshot: string;
  license: string;
  /** what the service was asked, with the date it answered */
  query: { occurrences: string; taxa: string };
  /** the words the tables below refer to by number */
  words: string[];
  /** no, name, rank, parent, extant (1, 0, or null), oldest max and min, youngest max and min (Ma), environment, diet, habit, motility: the last four as words */
  taxa: LandTaxon[];
  /** collection number, lat, lng, max and min (Ma), formation (a word): one for each collection and age */
  sites: LandSite[];
  /** occurrence number, site (an index), taxon */
  rows: [number, number, number][];
}

export type LandTaxon = [no: number, name: string, rank: number, parent: number, extant: 0 | 1 | null, firstMax: number | null, firstMin: number | null, lastMax: number | null, lastMin: number | null, environment: number, diet: number, habit: number, motility: number];
export type LandSite = [collection: number, lat: number, lng: number, max: number, min: number, formation: number];

/** A line of the service's CSV, with its quotes. */
export function csvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let j = i + 1;
      let s = '';
      while (j < line.length) {
        if (line[j] === '"') {
          if (line[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += line[j++];
      }
      out.push(s);
      i = j + 2;
    } else {
      const j = line.indexOf(',', i);
      const end = j < 0 ? line.length : j;
      out.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return out;
}

/** The land's fossils, from the service. `log` says how far it has got: it takes some minutes. */
export async function exportLand(date: string, log: (m: string) => void, range: { max: number; min: number } = { max: 541, min: 0 }): Promise<LandSnapshot> {
  const occUrl = `${SERVICE}/occs/list.csv?max_ma=${range.max}&min_ma=${range.min}&envtype=terrestrial&pres=regular&idreso=genus&show=coords,strat&vocab=pbdb&limit=all&datainfo`;
  const taxUrl = `${SERVICE}/taxa/list.json?id={ids}&rel=all_parents&show=app,ecospace&vocab=pbdb&limit=all`;
  log(`asking for the occurrences: ${occUrl}`);
  const res = await fetch(occUrl, { headers: { 'User-Agent': 'wikiworldmodel-world-tools' } });
  if (!res.ok) throw new Error(`GET ${occUrl}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split('\n');
  let license = 'unknown';
  let at = 0;
  for (; at < lines.length; at++) {
    if (lines[at].startsWith('"Data License"')) license = csvLine(lines[at])[1];
    if (lines[at].startsWith('"Records:"')) break;
  }
  const head = csvLine(lines[at + 1]);
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const words = new Map<string, number>([['', 0]]);
  const word = (w: string | undefined) => {
    const key = w ?? '';
    let n = words.get(key);
    if (n === undefined) {
      n = words.size;
      words.set(key, n);
    }
    return n;
  };
  const siteOf = new Map<string, number>();
  const sites: LandSite[] = [];
  const rows: [number, number, number][] = [];
  for (let i = at + 2; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = csvLine(lines[i]);
    const taxon = Number(r[col.accepted_no]);
    if (!taxon) continue;
    const lat = Number(r[col.lat]);
    const lng = Number(r[col.lng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${r[col.collection_no]}|${r[col.max_ma]}|${r[col.min_ma]}`;
    let s = siteOf.get(key);
    if (s === undefined) {
      s = sites.length;
      siteOf.set(key, s);
      sites.push([Number(r[col.collection_no]), lat, lng, Number(r[col.max_ma]), Number(r[col.min_ma]), word(r[col.formation])]);
    }
    rows.push([Number(r[col.occurrence_no]), s, taxon]);
  }
  log(`${rows.length} occurrences at ${sites.length} sites; ${license}`);
  const names = [...new Set(rows.map((x) => x[2]))].sort((a, b) => a - b);
  const seen = new Map<number, LandTaxon>();
  const wanted = new Set(names);
  for (let i = 0; i < names.length; i += 120) {
    if (seen.has(names[i]) && names.slice(i, i + 120).every((n) => seen.has(n))) continue;
    const ids = names.slice(i, i + 120).filter((n) => !seen.has(n)).map((n) => `txn:${n}`).join(',');
    for (const t of (await service(taxUrl.replace('{ids}', ids))).records) {
      const no = num(t.orig_no);
      if (seen.has(no) || num(t.accepted_no) !== no) continue;
      wanted.delete(no);
      seen.set(no, [no, String(t.taxon_name), word(String(t.accepted_rank ?? t.taxon_rank ?? '')), num(t.parent_no ?? 0), t.is_extant === 'extant' ? 1 : t.is_extant === 'extinct' ? 0 : null, t.firstapp_max_ma === undefined ? null : num(t.firstapp_max_ma), t.firstapp_min_ma === undefined ? null : num(t.firstapp_min_ma), t.lastapp_max_ma === undefined ? null : num(t.lastapp_max_ma), t.lastapp_min_ma === undefined ? null : num(t.lastapp_min_ma), word(t.taxon_environment as string | undefined), word(t.diet as string | undefined), word(t.life_habit as string | undefined), word(t.motility as string | undefined)]);
    }
    if (i % 2400 === 0) log(`taxa: ${Math.min(i + 120, names.length)} of ${names.length} asked for, ${seen.size} known`);
  }
  // Rows that name a taxon the classification has no accepted record of cannot be placed: they are left out.
  const kept = rows.filter((x) => seen.has(x[2]));
  log(`${kept.length} of ${rows.length} rows placed; ${seen.size} taxa`);
  return {
    format: 'lightworld-pbdb-land@1',
    snapshot: date,
    license,
    query: { occurrences: occUrl, taxa: taxUrl },
    words: [...words.keys()],
    taxa: [...seen.values()].sort((a, b) => a[0] - b[0]),
    sites,
    rows: kept.sort((a, b) => a[0] - b[0]),
  };
}

/**
 * A written record of a taxon of the land's snapshot joins the world's tree: it hangs from the nearest taxon
 * above it that a record adopts, by the database's classification, unless it says otherwise. Taxa no record
 * adopts stay rows.
 */
export function placeInLand(snap: LandSnapshot, dataset: string, file: string, entities: Entity[]): void {
  const adopted = new Map<number, Entity>();
  for (const e of entities) {
    const no = e.kind === 'taxon' ? pbdbNumber(e) : undefined;
    if (no !== undefined) adopted.set(no, e);
  }
  const byNo = new Map(snap.taxa.map((t) => [t[0], t]));
  const range = (a: number, b: number) => (a === b ? `${a} Ma` : { lo: `${a} Ma`, hi: `${b} Ma` });
  for (const [no, e] of [...adopted].sort((a, b) => a[0] - b[0])) {
    const t = byNo.get(no);
    if (!t) continue;
    // What a written record does not say of its rank and dates comes from the database, as for a formation's taxa.
    const has = (prop: string) => e.claims.some((c) => c.prop === prop);
    const claim = (key: string, prop: string, value: unknown, note?: string): Claim => ({ key, entity: e.id, ref: `${e.id}#${key}`, subject: e.id, sources: [{ ref: dataset, loc: `taxon ${no}` }], basis: 'evidence', author: IMPORT_AUTHOR, status: 'proposed', rank: 'normal', note, file, where: `taxon ${no} ${key}`, prop, value, method: 'compilation' });
    const rank = snap.words[t[2]];
    if (rank && !has('taxon_rank')) e.claims.push(claim('rank-land', 'taxon_rank', rank));
    if (t[5] !== null && t[6] !== null && !has('start') && LOW_RANKS.has(rank)) e.claims.push(claim('start-land', 'start', range(t[5], t[6]), 'The interval of its oldest record in the whole database: its origin may be older.'));
    if (t[7] !== null && t[8] !== null && t[4] !== 1 && !has('end')) e.claims.push(claim('end-land', 'end', range(t[7], t[8]), 'The interval of its youngest record in the whole database.'));
    if (e.relations.some((r) => r.rel === 'descends-from')) continue;
    for (let x = t[3], guard = 0; x && byNo.has(x) && guard < 200; x = byNo.get(x)![3], guard++) {
      const up = adopted.get(x);
      if (!up || up === e) continue;
      e.relations.push({ key: 'parent-pbdb', entity: e.id, ref: `${e.id}#parent-pbdb`, subject: e.id, sources: [{ ref: dataset, loc: `taxon ${no}` }], basis: 'evidence', author: IMPORT_AUTHOR, status: 'proposed', rank: 'normal', file, where: `taxon ${no} parent`, rel: 'descends-from', to: up.id });
      break;
    }
  }
}

const IMPORT_AUTHOR = 'machine:pbdb-import';
const LOW_RANKS = new Set(['genus', 'subgenus', 'species', 'subspecies']);

/** The record of a PBDB taxon: the one a written record adopted, or the import's own. */
export const pbdbId = (no: number) => `life/pbdb/txn-${no}`;

/** A taxon's PBDB number, from a record's same_as: { pbdb: "txn:123" }. */
export function pbdbNumber(e: Pick<Entity, 'same_as'>): number | undefined {
  const m = /^txn:(\d+)$/.exec(String(e.same_as?.pbdb ?? ''));
  return m ? Number(m[1]) : undefined;
}

/**
 * The records of a snapshot's taxa: every taxon an occurrence names and its parents, up to a taxon
 * the world already places in the tree of life. A written record adopts a taxon by naming its PBDB
 * number; whatever it does not say of its parent and its dates is filled in here, in its own claims.
 */
export function pbdbEntities(snap: PbdbSnapshot, dataset: string, file: string, existing: Entity[]): Entity[] {
  const byNo = new Map(snap.taxa.map((t) => [t.no, t]));
  const adopted = new Map<number, Entity>();
  for (const e of existing) {
    const no = e.kind === 'taxon' ? pbdbNumber(e) : undefined;
    if (no !== undefined) adopted.set(no, e);
  }
  // A record already in the tree ends the walk upwards.
  const placed = (e: Entity | undefined) => !!e?.relations.some((r) => r.rel === 'descends-from');
  const keep = new Set<number>();
  for (const o of snap.occurrences) {
    for (let no = o.taxon; no && byNo.has(no) && !keep.has(no); no = byNo.get(no)!.parent) {
      if (placed(adopted.get(no))) break;
      keep.add(no);
    }
  }
  const rowsOf = new Map<number, PbdbOccurrence[]>();
  for (const o of snap.occurrences) rowsOf.set(o.taxon, [...(rowsOf.get(o.taxon) ?? []), o]);
  const idOf = (no: number) => adopted.get(no)?.id ?? pbdbId(no);
  const out: Entity[] = [];
  for (const no of [...keep].sort((a, b) => a - b)) {
    const t = byNo.get(no)!;
    const mine = adopted.get(no);
    const id = idOf(no);
    const claim = (key: string, prop: string, value: unknown, note?: string): Claim => ({
      key,
      entity: id,
      ref: `${id}#${key}`,
      subject: id,
      sources: [{ ref: dataset, loc: `taxon ${no}` }],
      basis: 'evidence',
      author: IMPORT_AUTHOR,
      status: 'proposed',
      rank: 'normal',
      note,
      file,
      where: `taxon ${no} ${key}`,
      prop,
      value,
      method: 'compilation',
    });
    const range = (a: [number, number]) => (a[0] === a[1] ? `${a[0]} Ma` : { lo: `${a[0]} Ma`, hi: `${a[1]} Ma` });
    const rows = rowsOf.get(no) ?? [];
    const first: [number, number] | null = t.first ?? (rows.length ? [Math.max(...rows.map((r) => r.max)), Math.max(...rows.map((r) => r.min))] : null);
    const last: [number, number] | null = t.last ?? (rows.length ? [Math.min(...rows.map((r) => r.max)), Math.min(...rows.map((r) => r.min))] : null);
    const claims: Claim[] = [];
    const has = (prop: string) => !!mine?.claims.some((c) => c.prop === prop);
    if (!mine) claims.push(claim('name', 'name', { la: t.name }));
    if (t.rank && !has('taxon_rank')) claims.push(claim('rank', 'taxon_rank', t.rank));
    // Only a genus or a species gets a start here. A higher group's oldest record in the database can
    // be a stray or a matter of classification, and contradict the tree: it starts with its members.
    if (first && !has('start') && LOW_RANKS.has(t.rank)) claims.push(claim('start', 'start', range(first), 'The interval of its oldest record in the whole database: its origin may be older.'));
    if (last && t.extant !== true && !has('end')) claims.push(claim('end', 'end', range(last), 'The interval of its youngest record in the whole database.'));
    const relations: Relation[] = [];
    if (t.parent && byNo.has(t.parent) && !mine?.relations.some((r) => r.rel === 'descends-from')) {
      const c = claim('parent', 'parent', null);
      const { prop: _p, value: _v, method: _m, ...base } = c;
      relations.push({ ...base, rel: 'descends-from', to: idOf(t.parent) });
    }
    if (mine) {
      mine.claims.push(...claims);
      mine.relations.push(...relations);
    } else out.push({ id, kind: 'taxon', summary: `A ${t.rank || 'taxon'} in the Paleobiology Database.`, same_as: { pbdb: `txn:${no}` }, phases: [], claims, relations, file });
  }
  return out;
}
