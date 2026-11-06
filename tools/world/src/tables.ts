// Rows are claims (docs/STRUCTURE.md section 3.1). A dataset read as rows is a source whose rows are
// claims: the same meaning as a record's claims, stored in bulk. Each row has an address,
// src:<dataset>#<key>, made from its own columns by the field's `rows.key` template; the field's
// `rows.claims` says which column is which property, read how, with which method and basis.
//
// A record cannot be written into a dataset, so an overlay (world/overlays/) names a row as its subject
// and corrects it, ranks it, corroborates it or ties it to an entity. The row stays as the dataset gives
// it; a correction is a competing claim, ranked preferred, and the build reads the row with it applied.
// Storage is unchanged: the pinned files are read as they are, and only the meaning is shared.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Basis } from '../../../core/tileset.ts';
export { rowRef } from '../../../core/refs.ts';
import { parseTable } from './build/series.ts';
import { datasetFile } from './manifest.ts';
import type { Citation, Field, World } from './world.ts';
import type { LandSnapshot } from './pbdb.ts';

/** How a column's raw value becomes a claim's value, and back. */
export type Conversion = 'string' | 'number' | 'text' | 'year' | 'year-end' | 'ma' | 'ma-range' | 'point';

export interface ColumnMap {
  /** the column; for a point its latitude and longitude columns, for a range of ages its older and younger */
  column: string | [string, string];
  as?: Conversion;
  /** raw values that mean the dataset gives none */
  none?: (string | number)[];
  method?: string;
  basis?: Basis;
}

export interface RowsSpec {
  /** what kind of thing a row is, for the properties that apply to it */
  kind: string;
  /** how a row's key is made from its columns: {Column} for a column, {#} for its place in the file */
  key: string;
  /** which property each column gives */
  claims: Record<string, ColumnMap>;
}

export interface Table {
  dataset: string;
  field: string;
  spec: RowsSpec;
  /** each row's columns, by key, in the dataset's order */
  rows: Map<string, Record<string, unknown>>;
}

/** A claim a row makes, as the world's claims are: its value, and where in the dataset it comes from. */
export interface RowClaim {
  prop: string;
  value: unknown;
  source: Citation;
  method?: string;
  basis: Basis;
}

/** A row's key from its columns by the template, e.g. "{Name}@{FromYear}" or "occ:{occurrence}". */
export function rowKey(template: string, columns: Record<string, unknown>, index: number): string {
  return template.replace(/\{([^}]+)\}/g, (_, c: string) => (c === '#' ? String(index) : String(columns[c] ?? '')));
}

const missing = (v: unknown, none?: (string | number)[]) => v === undefined || v === null || v === '' || (none ?? []).includes(v as string | number);

/** A column's raw value as a claim's value; undefined where the dataset gives none. */
export function toValue(map: ColumnMap, columns: Record<string, unknown>): unknown {
  const as = map.as ?? 'string';
  if (as === 'point') {
    const [la, lo] = map.column as [string, string];
    if (missing(columns[la], map.none) || missing(columns[lo], map.none)) return undefined;
    return { lat: Number(columns[la]), lon: Number(columns[lo]), frame: 'frame:earth/present-day' };
  }
  // Ages in millions of years: one, or the range between the older and the younger.
  if (as === 'ma-range') {
    const [older, younger] = map.column as [string, string];
    if (missing(columns[older], map.none) || missing(columns[younger], map.none)) return undefined;
    const a = Number(columns[older]);
    const b = Number(columns[younger]);
    return a === b ? `${a} Ma` : { lo: `${a} Ma`, hi: `${b} Ma` };
  }
  const raw = columns[map.column as string];
  if (missing(raw, map.none)) return undefined;
  switch (as) {
    case 'string':
      return String(raw);
    case 'number':
      return Number(raw);
    case 'text':
      return { en: String(raw) };
    // A year as datasets count them, with no year 0 (a stray 0 is read as 1 BCE), on the world's axis.
    case 'year':
      return Number(raw) < 0 ? Number(raw) + 1 : Number(raw);
    // The same, holding to the end of the year.
    case 'year-end':
      return (Number(raw) < 0 ? Number(raw) + 1 : Number(raw)) + 1;
    case 'ma':
      return `${Number(raw)} Ma`;
  }
}

/** A claim's value written back into the columns it comes from: how a correction reaches the build. */
export function fromValue(map: ColumnMap, value: unknown, columns: Record<string, unknown>): void {
  const as = map.as ?? 'string';
  if (as === 'point') {
    const p = value as { lat: number; lon: number };
    const [la, lo] = map.column as [string, string];
    columns[la] = p.lat;
    columns[lo] = p.lon;
    return;
  }
  if (as === 'ma-range') {
    const [older, younger] = map.column as [string, string];
    const r = typeof value === 'object' && value !== null ? (value as { lo: string; hi: string }) : { lo: String(value), hi: String(value) };
    columns[older] = parseFloat(r.lo);
    columns[younger] = parseFloat(r.hi);
    return;
  }
  const c = map.column as string;
  switch (as) {
    case 'string':
      columns[c] = String(value);
      return;
    case 'number':
      columns[c] = Number(value);
      return;
    case 'text':
      columns[c] = Object.values(value as Record<string, string>)[0];
      return;
    case 'year':
    case 'year-end': {
      const y = Number(value) - (as === 'year-end' ? 1 : 0);
      columns[c] = y <= 0 ? y - 1 : y;
      return;
    }
    case 'ma':
      columns[c] = parseFloat(String(value));
      return;
  }
}

/** What a row says, property by property. */
export function rowClaims(table: Table, key: string, columns = table.rows.get(key)): RowClaim[] {
  if (!columns) return [];
  const out: RowClaim[] = [];
  for (const [prop, map] of Object.entries(table.spec.claims)) {
    const value = toValue(map, columns);
    if (value === undefined) continue;
    out.push({ prop, value, source: { ref: table.dataset, loc: `row ${key}` }, method: map.method, basis: map.basis ?? 'evidence' });
  }
  return out;
}

/** The column a GeoJSON feature's geometry is kept in. */
export const GEOMETRY = '__geometry';

/** The raw rows of a dataset, as columns, by how the field reads it. */
export async function rawRows(world: World, field: Field): Promise<Record<string, unknown>[] | undefined> {
  const id = field.data!.from;
  const d = world.manifest.datasets[id];
  if (!d) return undefined;
  if (field.data!.as === 'community') {
    const snap = world.landFossils.get(id);
    return snap ? landRows(snap) : undefined;
  }
  const member = field.data!.file ?? (d.fetch.files ? Object.keys(d.fetch.files)[0] : undefined);
  const path = datasetFile(id, d, member);
  if (!existsSync(path)) return undefined;
  const text = await readFile(path, 'utf8');
  if (d.fetch.format === 'csv' || d.fetch.format === 'tsv') return parseTable(text);
  const doc = JSON.parse(text) as { features?: { properties: Record<string, unknown>; geometry?: unknown }[]; rows?: Record<string, unknown>[] };
  // A feature's geometry rides along as a column of its own, for what draws it; no property reads it.
  if (doc.features) return doc.features.map((f) => ({ ...f.properties, [GEOMETRY]: f.geometry ?? null }));
  return doc.rows;
}

/** The land's fossils as one row per occurrence: its collection's place and ages joined in, and its taxon's number and name. */
export function landRows(snap: LandSnapshot): Record<string, unknown>[] {
  const names = new Map(snap.taxa.map((t) => [t[0], t[1]]));
  return snap.rows.map(([occurrence, site, taxon]) => {
    const s = snap.sites[site];
    return { occurrence, collection: s[0], lat: s[1], lng: s[2], max_ma: s[3], min_ma: s[4], formation: snap.words[s[5]] ?? '', taxon: `txn:${taxon}`, taxon_name: names.get(taxon) ?? '' };
  });
}

/** A field's dataset as a table of rows by key, if the field says how its rows are keyed and the dataset is here. */
export async function readTable(world: World, field: Field): Promise<Table | undefined> {
  if (!field.rows || !field.data) return undefined;
  const raw = await rawRows(world, field);
  if (!raw) return undefined;
  const rows = new Map<string, Record<string, unknown>>();
  raw.forEach((columns, i) => {
    const key = rowKey(field.rows!.key, columns, i);
    if (!rows.has(key)) rows.set(key, columns);
  });
  return { dataset: field.data.from, field: field.id, spec: field.rows, rows };
}

/** Every table the world's fields declare, by dataset; a dataset not fetched here has none. */
export async function readTables(world: World): Promise<Map<string, Table>> {
  const out = new Map<string, Table>();
  for (const f of world.fields) {
    const t = await readTable(world, f);
    if (t) out.set(t.dataset, t);
  }
  return out;
}

/** A row's columns with the overlays' preferred claims written into them, and what was changed. */
export function correctedColumns(table: Table, key: string, corrections: { prop: string; value: unknown }[]): { columns: Record<string, unknown>; changed: string[] } | undefined {
  const base = table.rows.get(key);
  if (!base) return undefined;
  const columns = { ...base };
  const changed: string[] = [];
  for (const c of corrections) {
    const map = table.spec.claims[c.prop];
    if (!map) continue;
    fromValue(map, c.value, columns);
    changed.push(c.prop);
  }
  return { columns, changed };
}

export type Fix = { prop: string; value: unknown };

/**
 * A dataset's raw rows with the overlays' corrections written into their columns: each row's key, the rows (a
 * corrected one is a copy; the rest are as they were), and what was changed in which.
 */
export function correctRows<T extends Record<string, unknown>>(spec: RowsSpec, rows: T[], fixes: Map<string, Fix[]>): { keys: string[]; rows: T[]; changed: Map<number, string[]> } {
  const keys: string[] = [];
  const changed = new Map<number, string[]>();
  const out = rows.map((columns, i) => {
    const key = rowKey(spec.key, columns, i);
    keys.push(key);
    const fix = fixes.get(key);
    if (!fix?.length) return columns;
    const copy = { ...columns } as T;
    const props: string[] = [];
    for (const f of fix) {
      const map = spec.claims[f.prop];
      if (!map) continue;
      fromValue(map, f.value, copy as Record<string, unknown>);
      props.push(f.prop);
    }
    if (props.length) changed.set(i, props);
    return copy;
  });
  return { keys, rows: out, changed };
}

/**
 * The land's fossils with corrections applied: a corrected place or age gives the occurrence a site of its own,
 * and a corrected name the taxon the snapshot has by that name, if it has one. Returns the corrected snapshot and
 * what could not be applied.
 */
export function correctLand(snap: LandSnapshot, spec: RowsSpec, fixes: Map<string, Fix[]>): { snap: LandSnapshot; unapplied: string[] } {
  if (!fixes.size) return { snap, unapplied: [] };
  const raw = landRows(snap);
  const { rows, changed } = correctRows(spec, raw, fixes);
  const sites = [...snap.sites];
  const out = [...snap.rows];
  const byName = new Map<string, number>();
  for (const t of snap.taxa) if (!byName.has(t[1])) byName.set(t[1], t[0]);
  const unapplied: string[] = [];
  for (const [i, props] of changed) {
    const r = rows[i];
    const [occ, site, taxon] = out[i];
    let s = site;
    let x = taxon;
    if (props.some((p) => spec.claims[p] && ['lat', 'lng', 'max_ma', 'min_ma'].some((c) => [spec.claims[p].column].flat().includes(c)))) {
      const old = snap.sites[site];
      sites.push([old[0], Number(r.lat), Number(r.lng), Number(r.max_ma), Number(r.min_ma), old[5]]);
      s = sites.length - 1;
    }
    if (props.includes('identified_as')) {
      const no = byName.get(String(r.taxon_name));
      if (no === undefined) unapplied.push(`occ:${occ}: the snapshot has no taxon named ${String(r.taxon_name)}`);
      else x = no;
    }
    out[i] = [occ, s, x];
  }
  return { snap: { ...snap, sites, rows: out }, unapplied };
}
