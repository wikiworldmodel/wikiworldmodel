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
  const res = await fetch(url, { headers: { 'User-Agent': 'lightworld-world-tools' } });
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
