// Validators: CI for history. Each check returns issues; any error fails the run.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { Constraint, Conflict } from '../../../../core/stn.ts';
import { toMa } from '../../../../core/time.ts';
import { claimGroups, solveAlternatives, solveWorld, subjects } from '../chronology.ts';
import { resolvePoints } from '../importer.ts';
import { loadManifest } from '../manifest.ts';
import { WORLD } from '../paths.ts';
import { loadWorld, schemaDir, type Entity, type World } from '../world.ts';

export interface Issue {
  level: 'error' | 'warning' | 'info';
  check: string;
  file?: string;
  where?: string;
  message: string;
}

function ajvFor(root: string) {
  const dir = schemaDir(root);
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  (addFormats as unknown as (a: Ajv2020) => void)(ajv);
  for (const name of ['defs', 'entity', 'source', 'periods']) {
    ajv.addSchema(JSON.parse(readFileSync(join(dir, `${name}.schema.json`), 'utf8')));
  }
  return ajv;
}

const SCHEMA = 'https://lightworld.invalid/schema/';

function checkSchemas(world: World, issues: Issue[]): void {
  const ajv = ajvFor(world.root);
  const run = (schema: string, records: { file: string; data: unknown }[]) => {
    const validate = ajv.getSchema(SCHEMA + schema)!;
    for (const r of records) {
      if (!validate(r.data)) {
        for (const e of validate.errors ?? []) {
          issues.push({ level: 'error', check: 'schema', file: r.file, where: e.instancePath || '/', message: `${e.message}${e.params && 'additionalProperty' in e.params ? `: ${e.params.additionalProperty}` : ''}` });
        }
      }
    }
  };
  run('entity.json', world.entities);
  run('source.json', world.sources);
  run('periods.json', world.periods);
}

function checkIdsAndRefs(world: World, issues: Issue[]): void {
  const ajv = ajvFor(world.root);
  const validTime = ajv.compile({ $ref: `${SCHEMA}defs.json#/$defs/time` });
  const validPoint = ajv.compile({ $ref: `${SCHEMA}defs.json#/$defs/point` });
  const sources = new Set<string>();
  for (const { file, data } of world.sources) {
    if (file !== `sources/${data.id}.yaml`) issues.push({ level: 'error', check: 'ids', file, message: `source id "${data.id}" does not match its path` });
    if (sources.has(data.id)) issues.push({ level: 'error', check: 'ids', file, message: `duplicate source id "${data.id}"` });
    sources.add(data.id);
  }
  const entities = new Map<string, Entity>();
  for (const { file, data } of world.entities) {
    if (file !== `entities/${data.id}.yaml`) issues.push({ level: 'error', check: 'ids', file, message: `entity id "${data.id}" does not match its path` });
    if (entities.has(data.id)) issues.push({ level: 'error', check: 'ids', file, message: `duplicate entity id "${data.id}"` });
    entities.set(data.id, data);
  }
  for (const { file, data: e } of world.entities) {
    const kind = world.vocab.kinds[e.kind];
    if (!kind) issues.push({ level: 'error', check: 'vocab', file, where: 'kind', message: `unknown kind "${e.kind}"` });
    if (!world.frames[e.frame]) issues.push({ level: 'error', check: 'refs', file, where: 'frame', message: `unknown frame "${e.frame}"` });
    for (const [id, c] of Object.entries(e.claims ?? {})) {
      const where = `claims.${id}`;
      const prop = world.vocab.props[c.prop];
      if (!prop) {
        issues.push({ level: 'error', check: 'vocab', file, where, message: `unknown property "${c.prop}"` });
        continue;
      }
      if (!sources.has(c.source)) issues.push({ level: 'error', check: 'refs', file, where, message: `unknown source "${c.source}"` });
      if (c.phase && !e.phases?.[c.phase]) issues.push({ level: 'error', check: 'refs', file, where, message: `unknown phase "${c.phase}"` });
      const ok =
        prop.type === 'time' ? validTime(c.value) :
        prop.type === 'point' ? validPoint(c.value) :
        prop.type === 'number' ? typeof c.value === 'number' :
        typeof c.value === 'string' && c.value.length > 0;
      if (!ok) issues.push({ level: 'error', check: 'values', file, where, message: `value is not a valid ${prop.type} for "${c.prop}"` });
      if (c.author.startsWith('machine:') && c.status === 'accepted') {
        issues.push({ level: 'error', check: 'review', file, where, message: `machine-made claim (${c.author}) is marked accepted; a person has to accept it` });
      }
      if (kind?.temporal === 'instant' && !c.phase && (c.prop === 'start' || c.prop === 'end')) {
        issues.push({ level: 'error', check: 'values', file, where, message: `${e.kind} is instantaneous: use "date", not "${c.prop}"` });
      }
      if (kind?.temporal === 'interval' && (c.prop === 'date' || c.prop === 'date_before' || c.prop === 'date_after')) {
        issues.push({ level: 'error', check: 'values', file, where, message: `${e.kind} lasts: use "start"/"end", not "${c.prop}"` });
      }
    }
    for (const [id, r] of Object.entries(e.relations ?? {})) {
      const where = `relations.${id}`;
      if (!world.vocab.relations[r.type]) issues.push({ level: 'error', check: 'vocab', file, where, message: `unknown relation type "${r.type}"` });
      if (!sources.has(r.source)) issues.push({ level: 'error', check: 'refs', file, where, message: `unknown source "${r.source}"` });
      if (r.phase && !e.phases?.[r.phase]) issues.push({ level: 'error', check: 'refs', file, where, message: `unknown phase "${r.phase}"` });
      const [oid, ophase] = r.of.split('#');
      const other = entities.get(oid);
      if (!other) issues.push({ level: 'error', check: 'refs', file, where, message: `unknown entity "${oid}"` });
      else if (ophase && !other.phases?.[ophase]) issues.push({ level: 'error', check: 'refs', file, where, message: `entity "${oid}" has no phase "${ophase}"` });
    }
  }
  for (const g of claimGroups(world)) {
    const nPreferred = g.claims.filter((c) => c.claim.rank === 'preferred').length;
    if (nPreferred > 1 || (g.claims.length > 1 && nPreferred === 0)) {
      const e = entities.get(g.subject.split('#')[0]);
      const file = world.entities.find((x) => x.data === e)?.file;
      issues.push({ level: 'error', check: 'ranks', file, where: g.claims.map((c) => `claims.${c.id}`).join(', '), message: `competing "${g.prop}" claims need exactly one rank: preferred (found ${nPreferred})` });
    }
  }
  const periodIds = new Set<string>();
  for (const { file, data } of world.periods) {
    if (!sources.has(data.source)) issues.push({ level: 'error', check: 'refs', file, message: `unknown source "${data.source}"` });
    for (const p of data.periods ?? []) {
      if (periodIds.has(p.id)) issues.push({ level: 'error', check: 'ids', file, where: p.id, message: 'duplicate period id' });
      periodIds.add(p.id);
    }
  }
}

function pointLabel(point: string): string {
  const [ref, which] = point.split('@');
  return which === 'date' ? `${ref} (date)` : `${ref} (${which})`;
}

const fmtMa = (year: number) => `${toMa(year).toFixed(3)} Ma`;

function fmtYears(y: number): string {
  const a = Math.abs(y);
  return a >= 1e6 ? `${+(a / 1e6).toFixed(3)} Myr` : a >= 1e3 ? `${+(a / 1e3).toFixed(1)} kyr` : `${a} yr`;
}

/** One constraint in words: "X (start) = 70.000 Ma", "Y is at least 0 yr after X". */
export function describeConstraint(c: Constraint): string {
  if (c.from === '$origin') {
    const p = pointLabel(c.to);
    const lo = Number.isFinite(c.lo);
    const hi = Number.isFinite(c.hi);
    if (lo && hi && c.lo === c.hi) return `${p} = ${fmtMa(c.lo)}`;
    if (lo && hi) return `${p} between ${fmtMa(c.lo)} and ${fmtMa(c.hi)}`;
    if (hi) return `${p} no later than ${fmtMa(c.hi)}`;
    return `${p} no earlier than ${fmtMa(c.lo)}`;
  }
  const a = pointLabel(c.from);
  const b = pointLabel(c.to);
  const parts: string[] = [];
  if (Number.isFinite(c.lo)) parts.push(c.lo === 0 ? `${b} is not before ${a}` : `${b} is at least ${fmtYears(c.lo)} after ${a}`);
  if (Number.isFinite(c.hi)) parts.push(`${b} is at most ${fmtYears(c.hi)} after ${a}`);
  return parts.join(', and ');
}

export function describeConflict(world: World, conflict: Conflict): string {
  const fileOf = (entityId: string) => world.entities.find((e) => e.data.id === entityId)?.file ?? entityId;
  const lines = conflict.constraints.map((c: Constraint) => {
    const [entity, where] = c.source.split(':');
    return `    ${fileOf(entity)} ${where}: ${describeConstraint(c)}${c.note ? ` (${c.note})` : ''}`;
  });
  return `these constraints cannot all hold; together they are ${fmtYears(conflict.slack)} short:\n${lines.join('\n')}`;
}

function checkChronology(world: World, issues: Issue[]): void {
  const sol = solveWorld(world);
  if (!sol.ok) {
    issues.push({ level: 'error', check: 'chronology', message: describeConflict(world, sol.conflict) });
    return;
  }
  for (const alt of solveAlternatives(world)) {
    if (alt.solution.ok) continue;
    const [subject, prop] = alt.group.split('|');
    const e = world.entities.find((x) => x.data.id === subject.split('#')[0])!;
    const rank = e.data.claims[alt.claim].rank;
    issues.push({
      level: rank === 'deprecated' ? 'info' : 'warning',
      check: 'chronology',
      file: e.file,
      where: `claims.${alt.claim}`,
      message: `alternative "${prop}" claim (rank ${rank}) is inconsistent with the rest of the world: ${describeConflict(world, alt.solution.conflict)}`,
    });
  }
}

async function checkFrames(world: World, issues: Issue[]): Promise<void> {
  const sol = solveWorld(world);
  if (!sol.ok) return;
  const subs = subjects(world);
  const queries = [];
  for (const { data: e } of world.entities) {
    if (e.frame !== 'earth/plates') continue;
    const loc = Object.entries(e.claims).find(([, c]) => c.prop === 'location' && c.rank === 'preferred');
    if (!loc) continue;
    const s = subs.get(e.id)!;
    const earliest = sol.bounds.get(s.start)!.lo;
    const ages = Number.isFinite(earliest) ? [0, Math.round(toMa(earliest) * 1000) / 1000] : [0];
    const p = loc[1].value as { lat: number; lon: number };
    queries.push({ id: e.id, lat: p.lat, lon: p.lon, agesMa: ages });
  }
  if (!queries.length) return;
  for (const r of await resolvePoints(queries)) {
    const file = world.entities.find((x) => x.data.id === r.id)?.file;
    if (r.plate === null) {
      issues.push({ level: 'error', check: 'frames', file, where: 'claims.location', message: 'location is outside every plate polygon of the plate model' });
      continue;
    }
    for (const [age, exists] of Object.entries(r.existsAt ?? {})) {
      if (!exists) issues.push({ level: 'error', check: 'frames', file, where: 'claims.location', message: `plate ${r.plate}'s polygon at this location does not exist at ${age} Ma, within the entity's lifetime` });
    }
  }
}

/** Every dataset is pinned by checksum, licensed, credited and tied to a source record. */
async function checkManifest(world: World, issues: Issue[]): Promise<void> {
  const sources = new Set(world.sources.map((s) => s.data.id));
  for (const [id, d] of Object.entries((await loadManifest()).datasets)) {
    const where = `datasets.${id}`;
    const file = 'manifest.yaml';
    if (!/^[0-9a-f]{64}$/.test(d.sha256 ?? '')) issues.push({ level: 'error', check: 'manifest', file, where, message: 'sha256 must be 64 hex digits' });
    if (!/^https:\/\//.test(d.url ?? '')) issues.push({ level: 'error', check: 'manifest', file, where, message: 'url must be https' });
    if (!d.license) issues.push({ level: 'error', check: 'manifest', file, where, message: 'license is required' });
    if (!d.credit) issues.push({ level: 'error', check: 'manifest', file, where, message: 'credit (the attribution to display) is required' });
    if (!sources.has(d.source)) issues.push({ level: 'error', check: 'manifest', file, where, message: `unknown source "${d.source}"` });
    for (const [name, f] of Object.entries(d.files ?? {})) {
      if (!/^[0-9a-f]{64}$/.test(f.sha256 ?? '')) issues.push({ level: 'error', check: 'manifest', file, where: `${where}.files.${name}`, message: 'sha256 must be 64 hex digits' });
    }
  }
}

export async function validateWorld(world: World, opts: { frames?: boolean } = {}): Promise<Issue[]> {
  const issues: Issue[] = world.parseErrors.map((e) => ({ level: 'error', check: 'parse', file: e.file, message: e.message }));
  checkSchemas(world, issues);
  checkIdsAndRefs(world, issues);
  if (world.root === WORLD) await checkManifest(world, issues);
  if (!issues.some((i) => i.level === 'error')) checkChronology(world, issues);
  if (opts.frames !== false && !issues.some((i) => i.level === 'error')) await checkFrames(world, issues);
  return issues;
}

export function formatIssue(i: Issue): string {
  const loc = [i.file, i.where].filter(Boolean).join(' ');
  return `${i.level.padEnd(7)} ${i.check.padEnd(10)} ${loc ? loc + ': ' : ''}${i.message}`;
}

export async function runValidate(args: string[]): Promise<number> {
  const wi = args.indexOf('--world');
  const root = wi >= 0 ? resolve(args[wi + 1]) : WORLD;
  const world = await loadWorld(root);
  const issues = await validateWorld(world, { frames: !args.includes('--no-frames') });
  for (const i of issues) console.log(formatIssue(i));
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;
  console.log(`${world.entities.length} entities, ${world.sources.length} sources: ${errors} errors, ${warnings} warnings`);
  return errors ? 1 : 0;
}
