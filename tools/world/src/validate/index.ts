// Validators: CI for history (section 9.2 of WORLD-MODEL.md). Each check adds issues; any
// error fails the run. The chronology and frame checks run on the default picture and again
// on every alternative combined with it.
import { canonicalForm, resolveForm } from '../../../../core/form.ts';
import { checkForm } from '../../../../world/generators/life/forms.ts';
import { changeProblems, FormTree } from '../forms.ts';
import { cityKind } from '../../../../core/tileset.ts';
import { kindScore } from '../build/featuretiles.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { formProblem } from '../../../../core/city.ts';
import { dwellingProblems, fieldProblems, settlementProblems } from '../../../../core/dwelling.ts';
import { ladderCounts, LEVELS, STEPS } from '../../../../core/ladder.ts';
import { parseRef, RefError, splitRef } from '../../../../core/refs.ts';
import { conflictChanged, conflictIn, type Constraint, type Conflict, type Solution } from '../../../../core/stn.ts';
import { parseLag, parseTime, TimeError, toMa } from '../../../../core/time.ts';
import { available, buildNetwork, chosen, pictureNetwork, claimGroup, claimGroups, conflictInScenario, pictures, pointOf, scenariosOf, solveScenario, type Scenario } from '../chronology.ts';
import { resolvePoints } from '../importer.ts';
import { REPO, WORLD } from '../paths.ts';
import { readTable, rowClaims, type Table } from '../tables.ts';
import { kindIs, loadWorld, schemaDir, type Claim, type Entity, type Field, type Input, type Model, type Relation, type World } from '../world.ts';

export interface Issue {
  level: 'error' | 'warning' | 'info';
  check: string;
  file?: string;
  where?: string;
  message: string;
}

/** A reference to a record that does not exist yet (section 4.1), and who makes it. */
export interface Wanted {
  ref: string;
  from: { file: string; where: string }[];
}

export interface Report {
  issues: Issue[];
  wanted: Wanted[];
}

const SCHEMA = 'https://wikiworldmodel.invalid/schema/';
const SCHEMAS = ['defs', 'entity', 'source', 'frame', 'field', 'model', 'generator', 'alternative', 'overlay', 'manifest'];

function ajvFor(root: string) {
  const dir = schemaDir(root);
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true, strictRequired: false });
  (addFormats as unknown as (a: Ajv2020) => void)(ajv);
  for (const name of SCHEMAS) ajv.addSchema(JSON.parse(readFileSync(join(dir, `${name}.schema.json`), 'utf8')));
  return ajv;
}

function checkSchemas(world: World, issues: Issue[]): void {
  const ajv = ajvFor(world.root);
  const run = (schema: string, file: string, data: unknown) => {
    const validate = ajv.getSchema(SCHEMA + schema)!;
    if (validate(data)) return;
    // oneOf failures repeat every branch's complaint; report each message once per place.
    const seen = new Set<string>();
    const errs = validate.errors ?? [];
    const missing = (path: string, prop: string) => errs.some((e) => e.instancePath === path && e.keyword === 'required' && e.params.missingProperty === prop);
    for (const e of errs) {
      let message = `${e.message}${e.params && 'additionalProperty' in e.params ? `: ${e.params.additionalProperty}` : ''}`;
      if (e.keyword === 'required' && ['source', 'unsourced'].includes(e.params.missingProperty) && missing(e.instancePath, 'source') && missing(e.instancePath, 'unsourced')) {
        message = 'a claim needs a source, or `unsourced:` saying why it has none';
      }
      const key = `${e.instancePath} ${message}`;
      if (seen.has(key) || e.keyword === 'oneOf' || e.keyword === 'if') continue;
      seen.add(key);
      issues.push({ level: 'error', check: 'schema', file, where: e.instancePath || '/', message });
    }
  };
  for (const r of world.raw) run(`${r.type}.json`, r.file, r.data);
}

/** Every record id, by id, with the file it is in. */
function registry(world: World, issues: Issue[]): Map<string, { type: string; file: string }> {
  const out = new Map<string, { type: string; file: string }>();
  const add = (id: string, type: string, file: string) => {
    const prev = out.get(id);
    if (prev) issues.push({ level: 'error', check: 'ids', file, message: `id "${id}" is also used by ${prev.file}` });
    else out.set(id, { type, file });
  };
  for (const e of world.entities) add(e.id, 'entity', e.file);
  for (const s of world.sources) add(s.id, 'src', s.file === 'manifest.yaml' ? `manifest.yaml (${s.id})` : s.file);
  for (const f of world.frames) add(f.id, 'frame', f.file);
  for (const f of world.fields) add(f.id, 'field', f.file);
  for (const m of world.models) add(m.id, 'model', m.file);
  for (const g of world.generators) add(g.id, 'gen', g.file);
  for (const a of world.alternatives) add(a.id, 'alt', a.file);
  return out;
}

class RefChecker {
  readonly wanted = new Map<string, Wanted>();
  constructor(
    private world: World,
    private ids: Map<string, { type: string; file: string }>,
    private issues: Issue[],
    /** the datasets read as tables of rows, for references to their rows */
    private tables: Map<string, Table> = new Map(),
  ) {}

  /**
   * Check a reference: it must parse, be of an expected type, and resolve, or be reported as
   * wanted. Returns the referenced entity when it is one that exists.
   */
  check(s: unknown, file: string, where: string, opts: { self?: string; types?: string[] } = {}): Entity | undefined {
    if (typeof s !== 'string') {
      this.issues.push({ level: 'error', check: 'refs', file, where, message: `not a reference: ${JSON.stringify(s)}` });
      return undefined;
    }
    let r;
    try {
      r = parseRef(s, opts.self);
    } catch (e) {
      this.issues.push({ level: 'error', check: 'refs', file, where, message: (e as RefError).message });
      return undefined;
    }
    if (opts.types && !opts.types.includes(r.type)) {
      this.issues.push({ level: 'error', check: 'refs', file, where, message: `"${s}" should name a ${opts.types.join(' or ')} record` });
      return undefined;
    }
    if (r.type === 'external') return undefined;
    if (r.type === 'row') {
      if (!this.ids.has(r.id)) {
        this.issues.push({ level: 'error', check: 'refs', file, where, message: `${s} is a row of ${r.id}, which is not a dataset of the world` });
        return undefined;
      }
      const table = this.tables.get(r.id);
      if (table && !table.rows.has(r.key)) this.issues.push({ level: 'error', check: 'refs', file, where, message: `${r.id} has no row "${r.key}"` });
      return undefined;
    }
    if (!this.ids.has(r.id)) {
      const w = this.wanted.get(r.id) ?? { ref: r.id, from: [] };
      w.from.push({ file, where });
      this.wanted.set(r.id, w);
      return undefined;
    }
    if (r.type !== 'entity') return undefined;
    const e = this.world.entity.get(r.id)!;
    if (r.phase && !e.phases.some((p) => p.id === r.phase)) {
      this.issues.push({ level: 'error', check: 'refs', file, where, message: `${r.id} has no phase "${r.phase}"` });
    }
    if (r.part && !e.claims.some((c) => c.key === r.part) && !e.relations.some((x) => x.key === r.part)) {
      this.issues.push({ level: 'error', check: 'refs', file, where, message: `${r.id} has no claim or relation "${r.part}"` });
    }
    return e;
  }
}

/** "a plate", "an occurrence". */
const article = (word: string) => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;

/** Does a subject of kind `kind` fit a property's `applies_to`? A phase is lasting, and of its entity's kind. */
function applies(world: World, appliesTo: string[] | undefined, kind: string | undefined, phase = false): boolean {
  if (!appliesTo) return true;
  const moment = !phase && kind !== undefined && !!world.vocab.kinds[kind]?.moment;
  return appliesTo.some((a) => (a === 'moments' ? moment : a === 'lasting' ? !moment : kind !== undefined && kindIs(kind, a)));
}

function checkValue(world: World, refs: RefChecker, c: Claim, issues: Issue[]): void {
  const prop = world.vocab.properties[c.prop];
  const bad = (message: string) => issues.push({ level: 'error', check: 'values', file: c.file, where: `${c.where}.value`, message });
  const v = c.value;
  switch (prop.type) {
    case 'time':
      try {
        const t = parseTime(v as never);
        if (t.kind === 'ref') refs.check(t.ref, c.file, `${c.where}.value.ref`, { self: c.entity, types: ['entity'] });
        if (t.kind === 'ref' && !t.edge && (v as { lag?: unknown }).lag !== undefined) bad('a lag counts from an edge of the record: add edge: start or end');
        if (t.kind === 'unknown' && c.prop !== 'end') bad(`only an end may be unknown`);
      } catch (e) {
        bad((e as TimeError).message);
      }
      break;
    case 'point': {
      const p = v as { lat?: unknown; lon?: unknown; frame?: unknown };
      if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') bad('a point needs lat and lon');
      else refs.check(p.frame, c.file, `${c.where}.value.frame`, { types: ['frame'] });
      break;
    }
    case 'ref':
      refs.check(v, c.file, `${c.where}.value`, { self: c.entity, types: prop.ref_types });
      break;
    case 'text':
      if (!v || typeof v !== 'object' || Array.isArray(v) || !Object.values(v).every((x) => typeof x === 'string' && x)) bad('text needs its language, e.g. { en: … }');
      break;
    case 'string':
      if (typeof v !== 'string' || !v) bad(`not a string`);
      else if (prop.values && !Object.hasOwn(prop.values, v)) bad(`not one of the values of ${c.prop}: ${Object.keys(prop.values).join(', ')}`);
      break;
    case 'quantity': {
      // A number, or a number with its uncertainty as the source gives it.
      const q = v as { mean?: unknown; sd?: unknown; lo?: unknown; hi?: unknown } | null;
      const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
      const band = !!q && typeof q === 'object' && ((num(q.mean) && num(q.sd) && Object.keys(q).length === 2) || (num(q.lo) && num(q.hi) && Object.keys(q).length === 2 && (q.lo as number) <= (q.hi as number)));
      if (!num(v) && !band) bad(`a quantity is a number, in ${prop.unit}, or { mean, sd } or { lo, hi } of numbers`);
      break;
    }
    case 'color':
      if (typeof v !== 'string' || !/^#[0-9A-F]{6}$/.test(v)) bad('a colour is #RRGGBB');
      break;
    case 'geometry': {
      // An area written in the claim itself, where the property allows one: rings closed, on the globe, in a frame.
      if (v && typeof v === 'object' && 'type' in (v as object)) {
        if (!prop.inline) {
          bad(`"${c.prop}" takes rows or elements of a dataset, not an outline written in the claim`);
          break;
        }
        for (const problem of areaProblems(v)) bad(problem);
        refs.check((v as { frame?: unknown }).frame, c.file, `${c.where}.value.frame`, { types: ['frame'] });
        break;
      }
      const g = v as { from?: unknown; names?: unknown; elements?: unknown };
      const list = g?.names ?? g?.elements;
      const snap = typeof g?.from === 'string' ? world.snapshots.get(g.from) : undefined;
      if (snap && g.elements) for (const k of g.elements as string[]) if (!snap.elements.some((x) => `${x.type}/${x.id}` === k)) bad(`no element ${k} in ${g.from}`);
      if (!g || typeof g.from !== 'string' || !Array.isArray(list) || !list.length || !list.every((n) => typeof n === 'string' && n)) bad('a geometry names its dataset and rows or elements: { from: src:…, names: [...] } or { from: src:…, elements: [...] }');
      else checkDataset(world, refs, g.from, c.file, `${c.where}.value.from`, undefined, issues);
      break;
    }
    case 'form': {
      const problem = formProblem(v);
      if (problem) bad(problem);
      break;
    }
    case 'body-form': {
      for (const problem of changeProblems(v)) bad(problem);
      break;
    }
    case 'dwelling':
      for (const problem of dwellingProblems(v)) bad(problem);
      break;
    case 'settlement-form':
      for (const problem of settlementProblems(v)) bad(problem);
      break;
    case 'field-system':
      for (const problem of fieldProblems(v)) bad(problem);
      break;
  }
}

/** What is wrong with an area written in a claim: a GeoJSON Polygon or MultiPolygon of closed rings on the globe. */
export function areaProblems(v: unknown): string[] {
  const g = v as { type?: unknown; coordinates?: unknown; frame?: unknown };
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return ['an area is a GeoJSON Polygon or MultiPolygon'];
  if (typeof g.frame !== 'string') return ['an area names the frame its coordinates were measured in'];
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as unknown[];
  if (!Array.isArray(polys) || !polys.length) return ['an area has at least one ring'];
  const out: string[] = [];
  polys.forEach((poly, i) => {
    if (!Array.isArray(poly) || !poly.length) return out.push(`polygon ${i} has no rings`);
    poly.forEach((ring: unknown, j: number) => {
      const r = ring as number[][];
      if (!Array.isArray(r) || r.length < 4) return out.push(`ring ${j} of polygon ${i} has fewer than four points`);
      if (!r.every((p) => Array.isArray(p) && p.length >= 2 && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)) return out.push(`ring ${j} of polygon ${i} has a point that is not [lon, lat] on the globe`);
      if (r[0][0] !== r.at(-1)![0] || r[0][1] !== r.at(-1)![1]) out.push(`ring ${j} of polygon ${i} does not close: its last point is not its first`);
    });
  });
  return out;
}

/** Claims and relations: what they share (section 4.3). */
function checkClaimCommon(world: World, refs: RefChecker, c: Claim | Relation, issues: Issue[]): void {
  const at = (where: string) => ({ file: c.file, where: `${c.where}${where}` });
  for (const [i, s] of c.sources.entries()) refs.check(s.ref, c.file, `${c.where}.source${c.sources.length > 1 ? `[${i}]` : ''}`, { types: ['src'] });
  if (c.alt) {
    refs.check(c.alt, c.file, `${c.where}.alt`, { types: ['alt'] });
    const a = world.alternative.get(c.alt);
    if (a && a.type !== 'alternative') issues.push({ level: 'error', check: 'refs', ...at('.alt'), message: `${c.alt} is a group; a claim names one of its alternatives` });
  }
  if (c.valid !== undefined) {
    try {
      parseTime(c.valid as never);
    } catch (e) {
      issues.push({ level: 'error', check: 'values', ...at('.valid'), message: (e as TimeError).message });
    }
  }
  if (typeof c.confidence === 'string' && !world.vocab.confidence[c.confidence]) {
    issues.push({ level: 'error', check: 'vocab', ...at('.confidence'), message: `unknown confidence word "${c.confidence}"; use a probability or one of ${Object.keys(world.vocab.confidence).join(', ')}` });
  }
  if (c.author.startsWith('machine:') && c.status === 'accepted') {
    issues.push({ level: 'error', check: 'review', ...at(''), message: `made by ${c.author} but marked accepted; a person has to accept it` });
  }
  checkLadder(c, issues);
}

/**
 * How far a claim has been checked (core/ladder.ts): each step once; a quote found only where there is one;
 * a re-reading by someone other than its author; an audit by a person. A step above a missing one is noted.
 */
function checkLadder(c: Claim | Relation, issues: Issue[]): void {
  const seen = new Set<string>();
  c.checked.forEach((s, i) => {
    const at = { file: c.file, where: `${c.where}.checked[${i}]` };
    if (seen.has(s.step)) issues.push({ level: 'error', check: 'review', ...at, message: `"${s.step}" is recorded twice` });
    seen.add(s.step);
    if (s.step === 'quoted' && !c.sources.some((x) => x.quote)) issues.push({ level: 'error', check: 'review', ...at, message: 'marked quoted, but none of its sources has a quote to find' });
    if (s.step === 're-read' && s.by === c.author) issues.push({ level: 'error', check: 'review', ...at, message: `re-read by ${s.by}, who wrote it: a second reader re-reads` });
    if (s.step === 'audited' && s.by.startsWith('machine:')) issues.push({ level: 'error', check: 'review', ...at, message: `audited by ${s.by}: an audit is a person's` });
  });
  for (const [i, s] of STEPS.entries()) {
    if (i && seen.has(s) && !seen.has(STEPS[i - 1])) issues.push({ level: 'warning', check: 'review', file: c.file, where: `${c.where}.checked`, message: `${s} but not ${STEPS[i - 1]}: each step stands on the one below it` });
  }
}

function checkRecords(world: World, issues: Issue[], tables: Map<string, Table> = new Map()): Wanted[] {
  const ids = registry(world, issues);
  const refs = new RefChecker(world, ids, issues, tables);
  for (const e of world.entities) {
    const kind = world.vocab.kinds[e.kind];
    if (!kind) issues.push({ level: 'error', check: 'vocab', file: e.file, where: 'kind', message: `unknown kind "${e.kind}"` });
    const keys = new Set<string>();
    for (const x of [...e.claims, ...e.relations]) {
      if (keys.has(x.key)) issues.push({ level: 'error', check: 'ids', file: e.file, where: x.where, message: `"${x.key}" is used by a claim and a relation; they share one namespace` });
      keys.add(x.key);
    }
    const phases = new Set<string>();
    for (const p of e.phases) {
      if (phases.has(p.id)) issues.push({ level: 'error', check: 'ids', file: e.file, where: `phases.${p.id}`, message: 'duplicate phase id' });
      phases.add(p.id);
    }
    if (kind?.moment && e.phases.length) issues.push({ level: 'error', check: 'values', file: e.file, where: 'phases', message: `${article(e.kind)} is a moment and has no phases` });
    for (const c of e.claims) {
      const subjectEntity = refs.check(c.subject, c.file, `${c.where}.subject`, { self: e.id, types: ['entity'] });
      if (subjectEntity && subjectEntity.id !== e.id) issues.push({ level: 'error', check: 'refs', file: c.file, where: `${c.where}.subject`, message: `a claim lives in its subject's file: move it to ${subjectEntity.file}` });
      const phaseSubject = !!splitRef(c.subject).phase;
      checkClaimCommon(world, refs, c, issues);
      const prop = world.vocab.properties[c.prop];
      if (!prop) {
        issues.push({ level: 'error', check: 'vocab', file: c.file, where: c.where, message: `unknown property "${c.prop}"` });
        continue;
      }
      if (kind && !applies(world, prop.applies_to, e.kind, phaseSubject)) {
        issues.push({ level: 'error', check: 'fit', file: c.file, where: c.where, message: `"${c.prop}" does not apply to ${phaseSubject ? `a phase of ${article(e.kind)}` : article(e.kind)} (it applies to ${prop.applies_to!.join(', ')})` });
      }
      if (c.method && !world.vocab.methods[c.method]) issues.push({ level: 'error', check: 'vocab', file: c.file, where: `${c.where}.method`, message: `unknown method "${c.method}"` });
      checkValue(world, refs, c, issues);
    }
    for (const r of e.relations) {
      const subjectEntity = refs.check(r.subject, r.file, `${r.where}.subject`, { self: e.id, types: ['entity'] });
      if (subjectEntity && subjectEntity.id !== e.id) issues.push({ level: 'error', check: 'refs', file: r.file, where: `${r.where}.subject`, message: `a relation lives in its subject's file: move it to ${subjectEntity.file}` });
      checkClaimCommon(world, refs, r, issues);
      const type = world.vocab.relations[r.rel] as (typeof world.vocab.relations)[string] | undefined;
      // A relation that constrains time must point to an entity or a phase.
      const target = refs.check(r.to, r.file, `${r.where}.to`, { self: e.id, types: type?.time ? ['entity'] : undefined });
      if (!type) {
        issues.push({ level: 'error', check: 'vocab', file: r.file, where: r.where, message: `unknown relation type "${r.rel}"` });
        continue;
      }
      if (type.from && !type.from.some((k) => kindIs(e.kind, k))) issues.push({ level: 'error', check: 'fit', file: r.file, where: r.where, message: `"${r.rel}" joins ${article(type.from.join(' or '))}, not ${article(e.kind)}` });
      if (type.to && target && !type.to.some((k) => kindIs(target.kind, k))) issues.push({ level: 'error', check: 'fit', file: r.file, where: `${r.where}.to`, message: `"${r.rel}" points to ${article(type.to.join(' or '))}, not ${article(target.kind)}` });
      try {
        parseLag(r.lag);
      } catch (err) {
        issues.push({ level: 'error', check: 'values', file: r.file, where: `${r.where}.lag`, message: (err as TimeError).message });
      }
    }
  }
  for (const s of world.sources) {
    const file = s.file;
    if (!world.vocab.sourceTypes[s.type]) issues.push({ level: 'error', check: 'vocab', file, where: 'type', message: `unknown source type "${s.type}"` });
    if (!world.vocab.sourceKinds[s.kind]) issues.push({ level: 'error', check: 'vocab', file, where: 'kind', message: `unknown source kind "${s.kind}"` });
    if (s.via?.startsWith('src:')) refs.check(s.via, file, 'via', { types: ['src'] });
    if (s.written !== undefined) {
      try {
        const w = parseTime(s.written as never);
        if (w.kind === 'ref' || w.kind === 'unknown') throw new TimeError('when a text was written is a time or a range');
      } catch (e) {
        issues.push({ level: 'error', check: 'values', file, where: 'written', message: (e as TimeError).message });
      }
    }
  }
  for (const f of world.frames) {
    if (f.parent) refs.check(f.parent, f.file, 'parent', { types: ['frame'] });
    if (f.entity) refs.check(f.entity, f.file, 'entity', { types: ['entity'] });
    if (f.transform?.rotations) checkDataset(world, refs, f.transform.rotations, f.file, 'transform.rotations', f.transform.file, issues);
    if (f.transform?.snapshot_of) refs.check(f.transform.snapshot_of, f.file, 'transform.snapshot_of', { types: ['frame'] });
    if (f.extent) checkDataset(world, refs, f.extent.polygons, f.file, 'extent.polygons', f.extent.file, issues);
  }
  for (const f of world.fields) {
    if (f.frame) refs.check(f.frame, f.file, 'frame', { types: ['frame'] });
    if (f.refines) refs.check(f.refines, f.file, 'refines', { types: ['field'] });
    // A series of the world's own measurements names the work that frames them, not a dataset to fetch.
    if (f.data?.prop) refs.check(f.data.from, f.file, 'data.from', { types: ['src'] });
    else if (f.data) checkDataset(world, refs, f.data.from, f.file, 'data.from', f.data.file, issues);
    if (f.moves_with) checkDataset(world, refs, f.moves_with, f.file, 'moves_with', undefined, issues);
    for (const k of ['ocean', 'lakes'] as const) if (f.data?.water) checkDataset(world, refs, f.data.water[k], f.file, `data.water.${k}`, undefined, issues);
    if (f.source) refs.check(f.source.ref, f.file, 'source.ref', { types: ['src'] });
    for (const [i, x] of (f.from ?? []).entries()) refs.check(x, f.file, `from[${i}]`, { types: ['field'] });
    for (const [i, s] of (f.data?.scenarios ?? []).entries()) if (s.alt) refs.check(s.alt, f.file, `data.scenarios[${i}].alt`, { types: ['alt'] });
  }
  for (const m of world.models) {
    for (const [i, x] of m.inputs.entries()) checkInput(world, refs, x, m.file, `inputs[${i}]`, issues);
    for (const [i, x] of (m.outputs ?? []).entries()) refs.check(x, m.file, `outputs[${i}]`, { types: ['field'] });
    for (const [k, p] of Object.entries(m.params ?? {})) {
      if ('source' in p) refs.check(p.source.ref, m.file, `params.${k}.source.ref`, { types: ['src'] });
      if ('follows' in p) refs.check(p.follows, m.file, `params.${k}.follows`);
    }
    for (const [i, d] of (m.disagrees ?? []).entries()) refs.check(d.with, m.file, `disagrees[${i}].with`);
  }
  for (const g of world.generators) {
    for (const [i, x] of (g.inputs ?? []).entries()) checkInput(world, refs, x, g.file, `inputs[${i}]`, issues);
    checkTests(g.checks, g.file, 'generators', issues);
    if (!existsSync(join(world.root === WORLD ? WORLD : world.root, g.code)) && !existsSync(join(WORLD, g.code))) {
      issues.push({ level: 'error', check: 'refs', file: g.file, where: 'code', message: `no code at ${g.code}` });
    }
  }
  for (const a of world.alternatives) {
    if (a.type === 'alternative') {
      refs.check(a.group, a.file, 'group', { types: ['alt'] });
      const g = a.group ? world.alternative.get(a.group) : undefined;
      if (g && g.type !== 'group') issues.push({ level: 'error', check: 'refs', file: a.file, where: 'group', message: `${a.group} is not a group` });
    } else {
      for (const [i, m] of (a.show ?? []).entries()) {
        refs.check(m, a.file, `show[${i}]`, { types: ['alt'] });
        const alt = world.alternative.get(m);
        if (alt && alt.group !== a.id) issues.push({ level: 'error', check: 'refs', file: a.file, where: `show[${i}]`, message: `${m} is not in this group` });
      }
      if (a.default && !a.show?.includes(a.default)) issues.push({ level: 'error', check: 'refs', file: a.file, where: 'default', message: 'the default must be one of the members shown' });
    }
  }
  checkRowSpecs(world, issues);
  checkOverlays(world, refs, tables, issues);
  return [...refs.wanted.values()].sort((a, b) => (a.ref < b.ref ? -1 : 1));
}

/** A field that reads its dataset as rows says what a row is, and every property it maps applies to that. */
function checkRowSpecs(world: World, issues: Issue[]): void {
  for (const f of world.fields) {
    // A field drawn over the globe is points, lines or areas, read as rows; points need a place to stand.
    if (f.layer) {
      if (!['points', 'lines', 'areas'].includes(f.kind ?? '')) issues.push({ level: 'error', check: 'rows', file: f.file, where: 'kind', message: 'a field drawn over the globe by its layer: style is of kind points, lines or areas' });
      if (!f.rows) issues.push({ level: 'error', check: 'rows', file: f.file, where: 'layer', message: 'a field drawn by its layer: style reads its dataset as rows: give it a rows: section' });
      else if (f.kind === 'points' && !f.rows.claims.location) issues.push({ level: 'error', check: 'rows', file: f.file, where: 'rows.claims', message: 'points stand where their location says: map a column to location' });
      const keys = world.fields.filter((x) => x.layer?.toggle?.key === f.layer!.toggle?.key && x.layer?.toggle);
      if (keys.length > 1 && keys[0] === f) issues.push({ level: 'error', check: 'rows', file: f.file, where: 'layer.toggle.key', message: `the toggle "${f.layer.toggle!.key}" is used by ${keys.length} fields` });
    }
    if (!f.rows) continue;
    const at = (where: string) => ({ file: f.file, where: `rows${where}` });
    if (!f.data || f.derived) issues.push({ level: 'error', check: 'rows', ...at(''), message: 'only a field read from a dataset has rows' });
    if (!world.vocab.kinds[f.rows.kind]) issues.push({ level: 'error', check: 'vocab', ...at('.kind'), message: `unknown kind "${f.rows.kind}"` });
    if (!/\{[^}]+\}/.test(f.rows.key)) issues.push({ level: 'error', check: 'rows', ...at('.key'), message: 'a key template names a column, {Column}, or the row\'s place, {#}' });
    for (const [prop, map] of Object.entries(f.rows.claims)) {
      const p = world.vocab.properties[prop];
      if (!p) issues.push({ level: 'error', check: 'vocab', ...at(`.claims.${prop}`), message: `unknown property "${prop}"` });
      else if (world.vocab.kinds[f.rows.kind] && !applies(world, p.applies_to, f.rows.kind)) issues.push({ level: 'error', check: 'fit', ...at(`.claims.${prop}`), message: `"${prop}" does not apply to ${article(f.rows.kind)} (it applies to ${p.applies_to!.join(', ')})` });
      if (map.method && !world.vocab.methods[map.method]) issues.push({ level: 'error', check: 'vocab', ...at(`.claims.${prop}.method`), message: `unknown method "${map.method}"` });
      if ((map.as === 'point' || map.as === 'ma-range') !== Array.isArray(map.column)) issues.push({ level: 'error', check: 'rows', ...at(`.claims.${prop}.column`), message: 'a point reads two columns, latitude and longitude, and a range of ages two, older and younger; anything else reads one' });
    }
  }
}

/**
 * Overlays (docs/STRUCTURE.md section 3.1): one file per row, of a dataset some field reads as rows, and of a
 * row it has. Each claim is a claim, of a property the rows give. A claim that differs from the row is a
 * correction, ranked preferred with a note saying why; one that agrees corroborates it, from another source.
 */
function checkOverlays(world: World, refs: RefChecker, tables: Map<string, Table>, issues: Issue[]): void {
  const seen = new Map<string, string>();
  for (const o of world.overlays) {
    if (seen.has(o.row)) issues.push({ level: 'error', check: 'ids', file: o.file, where: 'row', message: `${o.row} has an overlay already, in ${seen.get(o.row)}: one file per row` });
    seen.set(o.row, o.file);
    const field = world.fields.find((f) => f.rows && f.data?.from === o.dataset);
    if (!field) {
      issues.push({ level: 'error', check: 'rows', file: o.file, where: 'row', message: `no field reads ${o.dataset} as rows: give its field a rows: section first` });
      continue;
    }
    refs.check(o.row, o.file, 'row');
    if (o.same_as) refs.check(o.same_as, o.file, 'same_as', { types: ['entity'] });
    const table = tables.get(o.dataset);
    if (!table) issues.push({ level: 'info', check: 'rows', file: o.file, where: 'row', message: `${o.dataset} is not fetched here, so its row could not be checked` });
    const given = table ? rowClaims(table, o.key) : [];
    for (const c of o.claims) {
      checkClaimCommon(world, refs, c, issues);
      const map = field.rows!.claims[c.prop];
      if (!map) {
        issues.push({ level: 'error', check: 'rows', file: o.file, where: c.where, message: `the rows of ${o.dataset} give no "${c.prop}": they give ${Object.keys(field.rows!.claims).join(', ')}` });
        continue;
      }
      if (c.method && !world.vocab.methods[c.method]) issues.push({ level: 'error', check: 'vocab', file: o.file, where: `${c.where}.method`, message: `unknown method "${c.method}"` });
      if (world.vocab.properties[c.prop]) checkValue(world, refs, c, issues);
      const row = given.find((x) => x.prop === c.prop);
      if (!row) continue;
      const agrees = JSON.stringify(row.value) === JSON.stringify(c.value);
      if (agrees && c.sources.every((s) => s.ref === o.dataset)) issues.push({ level: 'warning', check: 'rows', file: o.file, where: c.where, message: `restates the row's ${c.prop}; to corroborate it, cite another source` });
      if (!agrees && (c.rank !== 'preferred' || !c.note)) issues.push({ level: 'error', check: 'rows', file: o.file, where: c.where, message: `differs from the row's ${c.prop} (${JSON.stringify(row.value)}): a correction is ranked preferred, with a note saying why the row is wrong` });
    }
  }
}

/** The tables the overlays need, read where their datasets are here. */
export async function overlayTables(world: World): Promise<Map<string, Table>> {
  const out = new Map<string, Table>();
  for (const id of new Set(world.overlays.map((o) => o.dataset))) {
    const field = world.fields.find((f) => f.rows && f.data?.from === id);
    const t = field ? await readTable(world, field) : undefined;
    if (t) out.set(id, t);
  }
  return out;
}

/** Checks named by a model or a generator: each a test file that exists, with a test of that name in it. */
function checkTests(checks: { test: string; holds: string }[] | undefined, file: string, check: string, issues: Issue[]): void {
  for (const [i, c] of (checks ?? []).entries()) {
    const path = join(REPO, c.test);
    if (!existsSync(path)) issues.push({ level: 'error', check, file, where: `checks[${i}].test`, message: `no test file ${c.test}` });
    else if (!readFileSync(path, 'utf8').replace(/\\'/g, "'").includes(c.holds)) issues.push({ level: 'error', check, file, where: `checks[${i}].holds`, message: `no test in ${c.test} is named "${c.holds}"` });
  }
}

/**
 * A generator samples the models it reads (docs/STRUCTURE.md section 3.4): one that reads a model's output, or the
 * world's claims, names a test that holds what it makes, in aggregate, to them.
 */
function checkGeneratorSamples(world: World, issues: Issue[]): void {
  const madeByModel = new Set(world.models.flatMap((m) => m.outputs ?? []));
  for (const g of world.generators) {
    const samples = (g.inputs ?? []).some((x) => (typeof x === 'string' ? madeByModel.has(x) || x.startsWith('field:') : 'ref' in x ? madeByModel.has(x.ref) || x.ref.startsWith('field:') : 'prop' in x));
    if (samples && !g.checks?.length) issues.push({ level: 'warning', check: 'generators', file: g.file, where: 'checks', message: 'it samples fields or claims of the world: name a test that holds what it makes, in aggregate, to them' });
  }
}

/** An input of a model or a generator: a record that resolves, or terms the vocabularies declare. */
function checkInput(world: World, refs: RefChecker, x: Input, file: string, where: string, issues: Issue[]): void {
  if (typeof x === 'string' || 'ref' in x) {
    refs.check(typeof x === 'string' ? x : x.ref, file, where);
    return;
  }
  if ('prop' in x && !world.vocab.properties[x.prop]) issues.push({ level: 'error', check: 'vocab', file, where: `${where}.prop`, message: `unknown property "${x.prop}"` });
  if ('rel' in x && !world.vocab.relations[x.rel]) issues.push({ level: 'error', check: 'vocab', file, where: `${where}.rel`, message: `unknown relation type "${x.rel}"` });
  if ('kind' in x && x.kind !== undefined && !Object.keys(world.vocab.kinds).some((k) => kindIs(k, x.kind!))) {
    issues.push({ level: 'error', check: 'vocab', file, where: `${where}.kind`, message: `unknown kind "${x.kind}"` });
  }
}

/** The names of a field's parameters a model must say the origin of. A series' `band` says what its band is, and is not one. */
function paramNames(f: Field): string[] {
  return [...Object.keys(f.params ?? {}).filter((k) => k !== 'band'), ...(f.isoline_m !== undefined ? ['isoline_m'] : [])];
}

/**
 * Models (section 4.10): each field is made by one model at most, and every derived field by one;
 * a model says where every parameter of what it makes comes from; its code and its checks exist.
 * Then a note for each model, and each field read from a model run elsewhere, that no evidence of
 * the world reaches.
 */
function checkModels(world: World, issues: Issue[]): void {
  const field = new Map(world.fields.map((f) => [f.id, f]));
  const madeBy = new Map<string, Model>();
  for (const m of world.models) {
    if (!existsSync(join(REPO, m.code))) issues.push({ level: 'error', check: 'models', file: m.file, where: 'code', message: `no code at ${m.code}` });
    for (const out of m.outputs ?? []) {
      const prev = madeBy.get(out);
      if (prev) issues.push({ level: 'error', check: 'models', file: m.file, where: 'outputs', message: `${out} is made by ${prev.id} already` });
      else madeBy.set(out, m);
    }
    const names = new Set((m.outputs ?? []).flatMap((o) => (field.get(o) ? paramNames(field.get(o)!) : [])));
    for (const n of names) {
      if (!m.params?.[n]) issues.push({ level: 'error', check: 'models', file: m.file, where: 'params', message: `say where "${n}" comes from: a source, a claim it follows, or a choice` });
    }
    for (const n of Object.keys(m.params ?? {})) {
      if (!names.has(n)) issues.push({ level: 'error', check: 'models', file: m.file, where: `params.${n}`, message: `no output of this model has a parameter "${n}"` });
    }
    checkTests(m.checks, m.file, 'models', issues);
  }
  for (const f of world.fields) {
    if (f.derived && !madeBy.has(f.id)) issues.push({ level: 'warning', check: 'models', file: f.file, message: `a derived field is made by a model: write one in models/ that lists ${f.id} among its outputs` });
  }
  // A model that reads a spread carries it on (docs/STRUCTURE.md section 3.2): run once per member, not once.
  for (const m of world.models) {
    if (m.uncertainty.kind !== 'none') continue;
    for (const x of m.inputs) {
      const ref = typeof x === 'string' ? x : 'ref' in x ? x.ref : undefined;
      const f = ref ? field.get(ref) : undefined;
      if (f?.spread && ['band', 'alternatives', 'ensemble'].includes(f.spread)) {
        issues.push({ level: 'warning', check: 'models', file: m.file, where: 'uncertainty', message: `reads ${f.id}, which carries ${({ band: 'a band', alternatives: 'alternatives', ensemble: 'an ensemble' } as Record<string, string>)[f.spread]}, and says its output carries none: run it once per member (core/samples.ts) and carry the spread on` });
      }
    }
  }

  // Does any evidence of the world reach it? The world's records and claims are evidence, and so are
  // works that are not models; a field rests on what makes it.
  const seen = new Map<string, boolean>();
  const sourceIsEvidence = (id: string) => world.source.get(id)?.kind !== 'model';
  const fieldRests = (f: Field): boolean => {
    if (seen.has(f.id)) return seen.get(f.id)!;
    seen.set(f.id, false);
    const m = madeBy.get(f.id);
    const r = m ? modelRests(m) : f.data ? !!f.data.prop || sourceIsEvidence(f.data.from) : (f.from ?? []).some((x) => !!field.get(x) && fieldRests(field.get(x)!));
    seen.set(f.id, r);
    return r;
  };
  const inputRests = (x: Input): boolean => {
    if (typeof x !== 'string' && !('ref' in x)) return true;
    const ref = typeof x === 'string' ? x : x.ref;
    if (ref.startsWith('field:')) return !!field.get(ref) && fieldRests(field.get(ref)!);
    if (ref.startsWith('src:')) return sourceIsEvidence(ref);
    return !ref.includes(':');
  };
  const modelRests = (m: Model): boolean => m.inputs.some(inputRests);
  for (const m of world.models) {
    if (!modelRests(m)) issues.push({ level: 'info', check: 'models', file: m.file, message: `${m.id} rests on no evidence of the world: only on models run elsewhere` });
  }
  for (const f of world.fields) {
    if (madeBy.has(f.id) || !f.data || f.data.prop || sourceIsEvidence(f.data.from)) continue;
    issues.push({ level: 'info', check: 'models', file: f.file, message: `${f.id} is a model's output, run elsewhere (${f.data.from}): no evidence of the world feeds it` });
  }
}

function checkDataset(world: World, refs: RefChecker, id: string, file: string, where: string, member: string | undefined, issues: Issue[]): void {
  refs.check(id, file, where, { types: ['src'] });
  const d = world.manifest.datasets[id];
  if (world.source.has(id) && !d) issues.push({ level: 'error', check: 'refs', file, where, message: `${id} is a source but not a dataset in the manifest, so the build cannot fetch it` });
  if (d && member && !d.fetch.files?.[member]) issues.push({ level: 'error', check: 'refs', file, where, message: `${id} has no file "${member}"` });
}

/** Competing claims need one of them preferred, in each picture they compete in. */
function checkRanks(world: World, issues: Issue[]): void {
  for (const p of pictures(world)) {
    for (const g of claimGroups(world)) {
      const avail = available(g, p).filter((c) => c.rank !== 'deprecated');
      if (avail.length < 2 || chosen(g, p)) continue;
      const n = avail.filter((c) => c.rank === 'preferred').length;
      issues.push({
        level: 'error',
        check: 'ranks',
        file: avail[0].file,
        where: avail.map((c) => c.where).join(', '),
        message: `competing "${g.prop}" claims need exactly one rank: preferred${p.alts ? ` (in ${p.alts.join(', ')})` : ''}; found ${n}`,
      });
    }
  }
}

/** A claim restating another's value belongs to it as a corroborating source. */
function checkDuplicates(world: World, issues: Issue[]): void {
  for (const g of claimGroups(world)) {
    const seen = new Map<string, Claim>();
    for (const c of g.claims) {
      const k = `${c.alt ?? ''} ${JSON.stringify(c.value)} ${JSON.stringify(c.valid ?? null)}`;
      const prev = seen.get(k);
      if (prev) issues.push({ level: 'warning', check: 'duplicates', file: c.file, where: c.where, message: `restates ${prev.where}; add its source to that claim instead, as corroboration` });
      else seen.set(k, c);
    }
  }
}

const fmtMa = (year: number) => `${toMa(year).toFixed(3)} Ma`;

function fmtYears(y: number): string {
  const a = Math.abs(y);
  return a >= 1e6 ? `${+(a / 1e6).toFixed(3)} Myr` : a >= 1e3 ? `${+(a / 1e3).toFixed(1)} kyr` : `${+a.toFixed(1)} yr`;
}

function pointLabel(point: string): string {
  const [subject, edge] = point.split('|');
  return `${subject} (${edge})`;
}

/** One constraint in words: "X (start) = 70.000 Ma", "Y (date) is not before X (start)". */
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
  if (c.lo === 0 && c.hi === 0) return `${b} is ${a}`;
  const parts: string[] = [];
  if (Number.isFinite(c.lo)) parts.push(c.lo === 0 ? `${b} is not before ${a}` : `${b} is at least ${fmtYears(c.lo)} after ${a}`);
  if (Number.isFinite(c.hi)) parts.push(`${b} is at most ${fmtYears(c.hi)} after ${a}`);
  return parts.join(', and ');
}

/** Where a constraint comes from: the file and claim or relation of its source. */
export function sourceOf(world: World, source: string): { file: string; where: string } {
  const { record, part: key } = splitRef(source);
  const e = world.entity.get(record);
  if (!e) return { file: record, where: '' };
  if (!key) return { file: e.file, where: '(structure)' };
  const x = e.claims.find((c) => c.key === key) ?? e.relations.find((r) => r.key === key);
  return { file: e.file, where: x?.where ?? key };
}

export function describeConflict(world: World, conflict: Conflict): string {
  const lines = conflict.constraints.map((c: Constraint) => {
    const s = sourceOf(world, c.source);
    return `    ${s.file} ${s.where}: ${describeConstraint(c)}${c.note ? ` (${c.note})` : ''}`;
  });
  return `these constraints cannot all hold; together they are ${fmtYears(conflict.slack)} short:\n${lines.join('\n')}`;
}

function pictureName(s: Scenario): string {
  return s.alts?.length ? `with ${s.alts.join(' and ')}` : 'in the default picture';
}

function checkChronology(world: World, issues: Issue[]): void {
  // Best dates come from pinning each dated claim to its centre: if that does not hold, every best
  // date in the build falls back to the middle of its bounds, so it must hold, in the default picture.
  const centred = conflictInScenario(world, {}) ? undefined : conflictInScenario(world, {}, true);
  if (centred) issues.push({ level: 'error', check: 'chronology', message: `with each dated claim at the middle of its range, ${describeConflict(world, centred)}` });
  // One at a time, with nothing kept but what is wrong: there are thousands of them. A pick is
  // checked only in the pieces of its picture's network that it changes (conflictChanged).
  let picture: { points: string[]; constraints: Constraint[]; holds: boolean } | undefined;
  for (const scenario of scenariosOf(world)) {
    let conflict: Conflict | undefined;
    if (!scenario.picks?.length) {
      const net = pictureNetwork(world, scenario);
      conflict = conflictIn(net.points, net.constraints);
      picture = { ...net, holds: !conflict };
    } else {
      const net = buildNetwork(world, scenario);
      const quick = picture?.holds ? conflictChanged(picture, net.points, net.constraints) : 'whole';
      conflict = quick === 'whole' ? conflictIn(net.points, net.constraints) : quick;
    }
    if (!conflict) continue;
    const v = { scenario, solution: { conflict } };
    const pick = v.scenario.picks?.[0];
    if (!pick) {
      issues.push({ level: 'error', check: 'chronology', message: `${pictureName(v.scenario)}, ${describeConflict(world, v.solution.conflict)}` });
      continue;
    }
    const { record, part } = splitRef(pick);
    const c = world.entity.get(record)!.claims.find((x) => x.key === part)!;
    issues.push({
      level: c.rank === 'deprecated' ? 'info' : 'warning',
      check: 'chronology',
      file: c.file,
      where: c.where,
      message: `this competing "${c.prop}" claim (rank ${c.rank}) contradicts the rest of the world ${pictureName(v.scenario)}: ${describeConflict(world, v.solution.conflict)}`,
    });
  }
}

/** The chosen claim of an entity's property in a picture. */
export function claimOf(world: World, subject: string, prop: string, s: Scenario = {}): Claim | undefined {
  const g = claimGroup(world, subject, prop);
  return g ? chosen(g, s) : undefined;
}

/**
 * Frames: an entity with a location must say which frame it moves with, the build must be
 * able to carry the location there, and a plate frame must hold the location in its
 * polygon while the entity exists, in every picture.
 */
async function checkFrames(world: World, issues: Issue[]): Promise<void> {
  const sols = pictures(world).map((p) => solveScenario(world, p)).filter((s): s is Solution & { ok: true } => s.ok);
  if (!sols.length) return;
  const queries = [];
  const expect = new Map<string, number>();
  const subjects = world.entities.flatMap((e) => [{ e, subject: e.id }, ...e.phases.map((p) => ({ e, subject: `${e.id}@${p.id}` }))]);
  const frameClaim = (e: World['entities'][number], subject: string) => claimOf(world, subject, 'frame') ?? claimOf(world, e.id, 'frame');
  for (const { e, subject } of subjects) {
    const loc = claimOf(world, subject, 'location');
    const fr = frameClaim(e, subject);
    if (!loc) continue;
    if (!fr) {
      issues.push({ level: 'error', check: 'frames', file: e.file, where: loc.where, message: 'a location needs a frame claim: the frame it moves with' });
      continue;
    }
    const p = loc.value as { lat: number; lon: number; frame: string };
    const frame = world.frame.get(fr.value as string);
    if (!frame) continue; // wanted
    // A placeholder holds the coordinates measured in its parent as they are: nothing to carry, nothing to check.
    if (frame.kind === 'placeholder' && p.frame === frame.parent) continue;
    if (frame.kind === 'deforming') {
      issues.push({ level: 'error', check: 'frames', file: e.file, where: fr.where, message: `the build cannot yet carry coordinates through a deforming frame (${frame.id})` });
      continue;
    }
    if (p.frame !== 'frame:earth/present-day' || frame.kind !== 'plate' || !frame.extent) {
      if (p.frame !== frame.id) issues.push({ level: 'error', check: 'frames', file: e.file, where: loc.where, message: `the build cannot yet carry coordinates from ${p.frame} into ${frame.id}` });
      continue;
    }
    const earliest = Math.min(...sols.map((s) => s.bounds.get(pointOf(world, subject, 'start'))!.lo));
    const ages = Number.isFinite(earliest) ? [0, Math.round(toMa(earliest) * 1000) / 1000] : [0];
    queries.push({ id: subject, lat: p.lat, lon: p.lon, agesMa: ages });
    expect.set(subject, frame.extent.plate);
  }
  if (!queries.length) return;
  for (const r of await resolvePoints(queries)) {
    const e = world.entity.get(r.id.split('@')[0])!;
    const where = frameClaim(e, r.id)!.where;
    if (r.plate !== expect.get(r.id)) {
      issues.push({ level: 'error', check: 'frames', file: e.file, where, message: r.plate === null ? 'the location is outside every plate polygon of the plate model' : `the location is in plate ${r.plate}'s polygon, not plate ${expect.get(r.id)}'s` });
      continue;
    }
    for (const [age, exists] of Object.entries(r.existsAt ?? {})) {
      if (!exists) issues.push({ level: 'error', check: 'frames', file: e.file, where, message: `plate ${r.plate}'s polygon at this location does not exist at ${age} Ma, within the entity's lifetime` });
    }
  }
}

/**
 * The license filter: what a published build may include (section 13). It applies to the
 * datasets, whose content the build copies into tiles; publications and database records
 * contribute single facts and short quotes, with credit.
 */
function checkLicenses(world: World, issues: Issue[]): void {
  const allowed = new Set(world.manifest.publish.licenses);
  for (const [id, d] of Object.entries(world.manifest.datasets)) {
    if (!allowed.has(d.license ?? 'unknown')) issues.push({ level: 'error', check: 'licenses', file: 'manifest.yaml', where: id, message: `license "${d.license ?? 'none'}" is not one a published build may include (${[...allowed].join(', ')})` });
  }
}

/** The rule for how far away a record shows names real kinds and sizes, and covers what is on the globe. */
function checkProminence(world: World, issues: Issue[]): void {
  const rule = world.vocab.prominence;
  const file = 'schema/vocab/prominence.yaml';
  const domains = Object.entries(rule.domains);
  if (domains.reduce((n, [, d]) => n + d.reserve, 0) > rule.budget) issues.push({ level: 'error', check: 'vocab', file, where: 'domains', message: `the domains reserve more than the budget of ${rule.budget}` });
  for (const [name, d] of domains) {
    for (const k of Object.keys(d.kinds)) if (!world.vocab.kinds[k]) issues.push({ level: 'error', check: 'vocab', file, where: `domains.${name}`, message: `unknown kind "${k}"` });
  }
  for (const p of Object.keys(rule.scale)) if (world.vocab.properties[p]?.type !== 'quantity') issues.push({ level: 'error', check: 'vocab', file, where: 'scale', message: `"${p}" is not a quantity` });
  for (const e of world.entities) {
    if (cityKind(e.kind) || !world.vocab.kinds[e.kind] || !e.claims.some((c) => c.prop === 'location')) continue;
    if (!kindScore(rule, e.kind)) issues.push({ level: 'error', check: 'vocab', file: e.file, where: 'kind', message: `the prominence rule gives no score for the kind "${e.kind}"` });
  }
}

/** Every body plan can be drawn; every taxon that says anything of its body reaches a plan and can be drawn too. */
function checkForms(world: World, issues: Issue[]): void {
  const allowed = world.vocab.properties.body_plan?.values ?? {};
  for (const [name, plan] of Object.entries(world.plans)) {
    if (!allowed[name]) issues.push({ level: 'error', check: 'forms', file: `plans/${name}.yaml`, where: 'body_plan', message: `the vocabulary's body_plan has no value "${name}"` });
    for (const message of checkForm(canonicalForm(plan))) issues.push({ level: 'error', check: 'forms', file: `plans/${name}.yaml`, where: name, message });
  }
  for (const name of Object.keys(allowed)) if (!world.plans[name] && Object.keys(world.plans).length) issues.push({ level: 'error', check: 'forms', file: 'schema/vocab/properties.yaml', where: 'body_plan', message: `no file in world/plans for "${name}"` });
  if (!Object.keys(world.plans).length) return;
  const tree = new FormTree(world);
  // A number looked up wrongly would draw the wrong animal without a word: note any name the database does not give it.
  const landNames = new Map<number, string>();
  for (const snap of world.landFossils.values()) for (const t of snap.taxa) landNames.set(t[0], t[1]);
  for (const e of world.entities) {
    if (e.kind !== 'taxon') continue;
    const change = e.claims.find((c) => c.prop === 'body_form');
    if (!change && !e.claims.some((c) => c.prop === 'body_plan')) continue;
    const c = change ?? e.claims.find((x) => x.prop === 'body_plan')!;
    const no = /^txn:(\d+)$/.exec(String(e.same_as?.pbdb ?? ''))?.[1];
    const dbName = no ? landNames.get(Number(no)) : undefined;
    const names = Object.values((e.claims.find((x) => x.prop === 'name')?.value ?? {}) as Record<string, string>).map((n) => String(n).toLowerCase());
    if (dbName && !names.includes(dbName.toLowerCase())) issues.push({ level: 'info', check: 'forms', file: c.file, where: 'same_as', message: `${e.id} adopts txn:${no}, which the land's snapshot calls ${dbName}` });
    const source = tree.source(e.id);
    if (!source) {
      issues.push({ level: 'error', check: 'forms', file: c.file, where: c.where, message: `${e.id} says something of its body, but no node above it has a body_plan to start from` });
      continue;
    }
    for (const message of checkForm(resolveForm(world.plans, source))) issues.push({ level: 'error', check: 'forms', file: c.file, where: c.where, message });
  }
}

export async function validateWorld(world: World, opts: { frames?: boolean; tables?: Map<string, Table> } = {}): Promise<Report> {
  const issues: Issue[] = world.loadIssues.map((e) => ({ level: 'error', check: 'load', file: e.file, where: e.where, message: e.message }));
  checkSchemas(world, issues);
  const wanted = checkRecords(world, issues, opts.tables ?? (await overlayTables(world)));
  checkRanks(world, issues);
  checkProminence(world, issues);
  checkForms(world, issues);
  checkModels(world, issues);
  checkGeneratorSamples(world, issues);
  checkDuplicates(world, issues);
  if (world.root === WORLD || existsSync(join(world.root, 'manifest.yaml'))) checkLicenses(world, issues);
  for (const w of wanted) {
    issues.push({ level: 'info', check: 'wanted', message: `${w.ref} is wanted: referenced ${w.from.length} time${w.from.length > 1 ? 's' : ''} (${w.from.map((f) => `${f.file} ${f.where}`).join('; ')}) but not written yet` });
  }
  const ok = () => !issues.some((i) => i.level === 'error');
  if (ok()) checkChronology(world, issues);
  if (opts.frames !== false && ok()) await checkFrames(world, issues);
  return { issues, wanted };
}

export function formatIssue(i: Issue): string {
  const loc = [i.file, i.where].filter(Boolean).join(' ');
  return `${i.level.padEnd(7)} ${i.check.padEnd(11)} ${loc ? loc + ': ' : ''}${i.message}`;
}

export async function runValidate(args: string[]): Promise<number> {
  const wi = args.indexOf('--world');
  const root = wi >= 0 ? resolve(args[wi + 1]) : WORLD;
  const world = await loadWorld(root);
  const { issues, wanted } = await validateWorld(world, { frames: !args.includes('--no-frames') });
  for (const i of issues) if (i.level !== 'info' || args.includes('--verbose')) console.log(formatIssue(i));
  const n = (l: Issue['level']) => issues.filter((i) => i.level === l).length;
  const claims = world.entities.flatMap((e) => e.claims);
  const all = [...claims, ...world.entities.flatMap((e) => e.relations)];
  const unsourced = all.filter((c) => c.unsourced).length;
  const ladder = ladderCounts(all);
  console.log(
    `${world.entities.length} entities, ${claims.length} claims, ${world.sources.length} sources: ${n('error')} errors, ${n('warning')} warnings; ` +
      `${unsourced} unsourced claims, ${wanted.length} wanted records${n('info') && !args.includes('--verbose') ? ` (--verbose lists ${n('info')} notes)` : ''}\n` +
      `checked: ${LEVELS.map((l) => `${ladder[l]} ${l}`).join(', ')}`,
  );
  return n('error') ? 1 : 0;
}

