// Global series (section 4.7): one value for the whole planet at each time, such as mean
// surface temperature or the Sun's brightness. A series is read from a dataset's table, or
// computed with a published rule; either way it is never stored in git.
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import type { SeriesRecord } from '../../../../core/records.ts';
import { centre, fromKa, fromMa, parseDuration, parsePoint, parseTime, PRESENT_YEAR, type TimePointInput } from '../../../../core/time.ts';
import { chosen, claimGroup } from '../chronology.ts';
import { datasetFile } from '../manifest.ts';
import type { Field, World } from '../world.ts';
import { sourceRecord } from './records.ts';

const sig = (x: number) => Number(x.toPrecision(6));

/**
 * The Sun's luminosity relative to today's, at solar age `age`, given its age today: the fit
 * to standard solar models in Gough (1981), L(t) = L☉ / (1 + 2/5 (1 − t/t☉)).
 */
export function goughLuminosity(age: number, sunAge: number): number {
  return 1 / (1 + (2 / 5) * (1 - age / sunAge));
}

/** Years from `lo` to `hi` every `step`, with `hi` itself last. */
function samples(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let i = 0; lo + i * step < hi; i++) out.push(lo + i * step);
  out.push(hi);
  return out;
}

function computed(f: Field): SeriesRecord['points'] {
  if (f.rule !== 'gough-1981') throw new Error(`${f.id}: no series rule "${f.rule}"`);
  const sunAge = parseDuration(f.params!.sun_age as string);
  const lo = parsePoint(f.time!.lo as TimePointInput).t;
  const hi = parsePoint(f.time!.hi as TimePointInput).t;
  return samples(lo, hi, parseDuration(f.time!.step!)).map((t) => [Math.round(t), sig(goughLuminosity(sunAge - (PRESENT_YEAR - t), sunAge)), null, null]);
}

/**
 * Rows of a CSV or TSV table, by column name; quoted fields may hold the delimiter. What comes
 * before the table is left out: lines starting with #, the block in comment marks that opens a
 * PANGAEA file, and the metadata above the line saying `data` in a CEDA file.
 */
export function parseTable(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').replace(/^\/\*[\s\S]*?\*\/\r?\n/, '').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const data = lines.findIndex((l) => /^data,*$/.test(l));
  if (data >= 0) lines.splice(0, data + 1);
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) out.push(cur.trim()), (cur = '');
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e]);
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** The cells of one sheet of an xlsx workbook, by row number, then by column letters. */
export function xlsxRows(bytes: Uint8Array, sheet: string): Map<number, Record<string, string>> {
  const files = unzipSync(bytes);
  const text = (name: string) => {
    if (!files[name]) throw new Error(`the workbook has no ${name}`);
    return strFromU8(files[name]);
  };
  const sheetTag = text('xl/workbook.xml').match(/<sheet\s[^>]*>/g)?.find((t) => unxml(attr(t, 'name') ?? '') === sheet);
  if (!sheetTag) throw new Error(`the workbook has no sheet "${sheet}"`);
  const rel = text('xl/_rels/workbook.xml.rels').match(/<Relationship\s[^>]*>/g)?.find((t) => attr(t, 'Id') === attr(sheetTag, 'r:id'));
  const target = attr(rel ?? '', 'Target')!.replace(/^\/?(xl\/)?/, '');
  const shared = files['xl/sharedStrings.xml'] ? (text('xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g) ?? []).map((si) => unxml((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''))) : [];
  const rows = new Map<number, Record<string, string>>();
  for (const m of text(`xl/${target}`).matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, col, row, attrs, body = ''] = m;
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1];
    if (v === undefined) continue;
    const cells = rows.get(Number(row)) ?? {};
    cells[col] = /\st="s"/.test(attrs) ? shared[Number(v)] : unxml(v);
    rows.set(Number(row), cells);
  }
  return rows;
}

/** A number, or the band a claim gives: { lo, hi } or { mean, sd }. */
function measured(v: unknown): [number, number | null, number | null] | undefined {
  if (typeof v === 'number') return [v, null, null];
  const q = v as { lo?: number; hi?: number; mean?: number; sd?: number } | null;
  if (typeof q?.mean === 'number') return [q.mean, typeof q.sd === 'number' ? q.mean - q.sd : null, typeof q.sd === 'number' ? q.mean + q.sd : null];
  if (typeof q?.lo === 'number' && typeof q?.hi === 'number') return [(q.lo + q.hi) / 2, q.lo, q.hi];
  return undefined;
}

/** A series of the world's own measurements: each record's claim of a property, at the record's date. */
export function claimedPoints(world: World, prop: string): SeriesRecord['points'] {
  const pts: SeriesRecord['points'] = [];
  for (const e of world.entities) {
    const g = claimGroup(world, e.id, prop);
    const c = g && chosen(g);
    if (!c) continue;
    const when = claimGroup(world, e.id, 'date');
    const d = when && chosen(when);
    if (!d) continue;
    const v = measured(c.value);
    if (!v) continue;
    const [t] = centre(parseTime(d.value as never));
    if (!Number.isFinite(t)) continue;
    pts.push([Math.round(t), sig(v[0]), v[1] === null ? null : sig(v[1]), v[2] === null ? null : sig(v[2])]);
  }
  return pts.sort((a, b) => a[0] - b[0]);
}

/** What a time column counts, as a year on the axis. Ages count back from 1950, except `ka-b2k`: thousands of years before 2000. */
export const YEAR: Record<string, (x: number) => number> = { Ma: fromMa, ka: fromKa, 'ka-b2k': (x) => 2000 - x * 1e3, BP: (x) => PRESENT_YEAR - x, CE: (x) => x };

async function tabled(world: World, f: Field): Promise<SeriesRecord['points']> {
  const d = world.manifest.datasets[f.data!.from];
  if (!d) throw new Error(`${f.id}: ${f.data!.from} is not a dataset in the manifest`);
  const cols = f.data!.columns!;
  const path = datasetFile(f.data!.from, d, f.data!.file);
  // A workbook's columns are letters, read from `first_row` on; a text table's are names.
  const rows = d.fetch.format === 'xlsx'
    ? [...xlsxRows(new Uint8Array(await readFile(path)), f.data!.sheet!).entries()].filter(([n]) => n >= (f.data!.first_row ?? 1)).map(([, cells]) => cells)
    : parseTable(await readFile(path, 'utf8'));
  if (d.fetch.format !== 'xlsx') for (const c of Object.values(cols)) if (!(c in rows[0])) throw new Error(`${f.id}: the table has no column "${c}"`);
  const year = YEAR[f.data!.time_unit ?? 'Ma'];
  const num = (s: string | undefined) => (s === undefined || s === '' || Number.isNaN(Number(s)) ? null : Number(s));
  // A row outside the span the field declares is not part of it.
  const lo = f.time ? parsePoint(f.time.lo as TimePointInput).t : -Infinity;
  const hi = f.time ? parsePoint(f.time.hi as TimePointInput).t : Infinity;
  const pts: SeriesRecord['points'] = [];
  for (const r of rows) {
    const start = num(r[cols.time]);
    const v = num(r[cols.value]);
    if (start === null || v === null) continue;
    // A row that covers an interval is plotted at its middle.
    const end = cols.time_to ? num(r[cols.time_to]) : null;
    const t = end === null ? start : (start + end) / 2;
    // A band given the wrong way round is read as the range it spans.
    let below = cols.lo ? num(r[cols.lo]) : null;
    let above = cols.hi ? num(r[cols.hi]) : null;
    if (below !== null && above !== null && below > above) [below, above] = [above, below];
    const at = Math.round(year(t));
    if (at < lo || at > hi) continue;
    pts.push([at, sig(v), below === null ? null : sig(below), above === null ? null : sig(above)]);
  }
  return pts.sort((a, b) => a[0] - b[0]);
}

export async function series(world: World): Promise<SeriesRecord[]> {
  const out: SeriesRecord[] = [];
  for (const f of world.fields) {
    if (f.grid?.kind !== 'series') continue;
    const points = f.derived ? computed(f) : f.data?.prop ? claimedPoints(world, f.data.prop) : await tabled(world, f);
    const source = f.derived ? f.source! : { ref: f.data!.from };
    const src = world.source.get(source.ref);
    out.push({
      id: f.id,
      title: f.title,
      quantity: f.quantity,
      unit: f.unit,
      description: f.description,
      basis: f.basis ?? 'reconstruction',
      // A rule's values after the present are a projection; a table's rows after 1950 were measured.
      projectedAfter: f.derived && points.some((p) => p[0] > PRESENT_YEAR) ? PRESENT_YEAR : undefined,
      interpolation: f.interp ?? 'linear',
      refines: f.refines,
      band: f.data?.band,
      points,
      source,
      sourceRecord: src ? sourceRecord(src) : undefined,
      rule: f.derived ? { name: f.rule!, params: f.params ?? {} } : undefined,
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'en'));
}
