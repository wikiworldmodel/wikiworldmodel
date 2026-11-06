// Load a world: every record type, the vocabularies and the manifest, normalized so that
// the rest of the tools see one shape. Defaults (section 4.3 of WORLD-MODEL.md):
//   - a claim's subject is its entity; `subject: "@phase"` names a phase
//   - a claim's author is the file's `author`
//   - status: machine claims start `proposed`, others `accepted`
//   - rank: `normal`; basis: `evidence`
//   - `source` is one citation or a list of them (corroboration)
import type { Form } from '../../../core/form.ts';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { parseRef, RefError, splitRef, type Ref } from '../../../core/refs.ts';
import type { LagInput, TimeInput } from '../../../core/time.ts';
import { elementKey, ohmEntities, type OhmSnapshot } from './ohm.ts';
import { pbdbEntities, placeInLand, type LandSnapshot, type PbdbSnapshot } from './pbdb.ts';
import { REPO, WORLD } from './paths.ts';

export type Status = 'proposed' | 'accepted' | 'disputed' | 'deprecated';
export type Rank = 'preferred' | 'normal' | 'deprecated';
export type Basis = 'evidence' | 'reconstruction' | 'projection' | 'procedural';
export const BASES: Basis[] = ['evidence', 'reconstruction', 'projection', 'procedural'];

export interface Citation {
  ref: string;
  loc?: string;
  quote?: string;
}

/** What claims and relations share: they are both claims (section 4.5). */
interface ClaimBase {
  /** local key, unique across the entity's claims and relations */
  key: string;
  entity: string;
  /** entity#key */
  ref: string;
  /** the entity, or entity@phase */
  subject: string;
  valid?: TimeInput;
  sources: Citation[];
  unsourced?: string;
  confidence?: number | string;
  basis: Basis;
  alt?: string;
  author: string;
  status: Status;
  rank: Rank;
  note?: string;
  file: string;
  /** where in the file, e.g. claims.date */
  where: string;
}

export interface Claim extends ClaimBase {
  prop: string;
  value: unknown;
  method?: string;
}

export interface Relation extends ClaimBase {
  rel: string;
  /** the target, as written (local shorthand resolved) */
  to: string;
  lag?: LagInput;
}

export interface Phase {
  id: string;
  label?: string;
  /** an explicit gap: a stretch of the lifetime whose state is unknown */
  gap?: boolean;
}

export interface Entity {
  id: string;
  kind: string;
  summary?: string;
  same_as?: Record<string, string | number>;
  phases: Phase[];
  claims: Claim[];
  relations: Relation[];
  file: string;
}

export interface Source {
  id: string;
  type: string;
  kind: string;
  citation: string;
  authors?: string[];
  published?: number;
  /** when a text from before printing was written, as a time value */
  written?: unknown;
  snapshot?: string;
  title?: string;
  container?: string;
  doi?: string;
  url?: string;
  license?: string;
  license_note?: string;
  via?: string;
  reliability?: string;
  verified?: { by: string; how: string };
  note?: string;
  /** set for datasets in the manifest */
  credit?: string;
  version?: string;
  file: string;
}

export interface DatasetFile {
  path: string;
  sha256: string;
}

export interface Dataset extends Source {
  /** a snapshot of a database whose elements become records (tools/world/src/ohm.ts) */
  import?: { as: 'ohm-site' | 'pbdb-formation' | 'pbdb-land'; frame?: string };
  fetch: {
    url: string;
    sha256: string;
    bytes: number;
    format: 'zip' | 'parquet' | 'csv' | 'tsv' | 'xlsx' | 'tif' | 'json' | 'netcdf';
    files?: Record<string, DatasetFile>;
    upstream?: { url: string; sha256: string };
    via?: string;
  };
}

export interface Manifest {
  publish: { licenses: string[] };
  datasets: Record<string, Dataset>;
}

export interface Frame {
  id: string;
  kind: string;
  title: string;
  description?: string;
  parent?: string;
  entity?: string;
  transform?: { rotations?: string; file?: string; plate?: number; interp?: string; snapshot_of?: string; at?: TimeInput };
  extent?: { polygons: string; file: string; plate: number };
  note?: string;
  file: string;
}

export interface Field {
  id: string;
  title: string;
  description?: string;
  quantity?: string;
  unit?: string;
  datum?: string;
  frame?: string;
  /** a grid on a frame, or a series: one value for the whole planet at each time */
  grid?: { kind: 'lonlat'; res_deg: number } | { kind: 'series' } | { kind: 'rows' };
  time?: { lo: TimeInput; hi: TimeInput; step?: string };
  /** for a series: the series of the same quantity that this one is finer than, over part of its span */
  refines?: string;
  data?: {
    from: string;
    file?: string;
    /** what the data is read as, where it is not elevation */
    as?: 'climate' | 'ice-sheets' | 'borders' | 'hazards' | 'polities' | 'routes' | 'languages' | 'people' | 'community';
    places?: string;
    /** a series of the world's own measurements: the property whose claims give its values */
    prop?: string;
    /** for a series read from a table: column names, or a workbook's column letters */
    columns?: { time: string; time_to?: string; value: string; lo?: string; hi?: string };
    /** for a workbook: the sheet, and the first row of data */
    sheet?: string;
    first_row?: number;
    time_unit?: 'Ma' | 'ka' | 'ka-b2k' | 'BP' | 'CE';
    band?: string;
    /** for grids with several readings of the same thing: the first is the default picture's */
    scenarios?: { id: string; title: string; variable: string; alt?: string; span?: { lo: TimeInput; hi: TimeInput } }[];
  };
  basis?: Basis;
  interp?: string;
  moves_with?: string;
  /** after its youngest snapshot, the field holds it as a projection until `until` */
  projection?: { method: 'hold'; until: TimeInput; note?: string };
  derived?: boolean;
  from?: string[];
  rule?: string;
  isoline_m?: number;
  params?: Record<string, unknown>;
  /** where a derived field's rule comes from */
  source?: Citation;
  /** what a click says of how far to trust a value of it, where a grid has no error bars */
  uncertainty?: string;
  file: string;
}

/**
 * What a model or a generator reads: a record, every claim of a property (on records of a kind, if
 * given), every relation of a type, or every record of a kind.
 */
export type Input = string | { ref: string; note?: string } | { prop: string; kind?: string; note?: string } | { rel: string; note?: string } | { kind: string; note?: string };

export interface Generator {
  id: string;
  title: string;
  version: number;
  code: string;
  runs_in: string[];
  outputs: { basis: Basis };
  inputs: Input[];
  slots: Record<string, { place: string; seed: string }>;
  params: Record<string, unknown>;
  file: string;
}

/** Where a parameter of a model's output comes from: a work, a claim of the world, or a choice. */
export type Provenance = { source: Citation; note?: string } | { follows: string; note?: string } | { choice: string };

/**
 * A model run here (section 4.10): what it reads, what it makes, where its outputs' parameters
 * come from, how uncertain they are, and what they are checked against.
 */
export interface Model {
  id: string;
  title: string;
  description: string;
  author?: string;
  code: string;
  inputs: Input[];
  outputs?: string[];
  derives?: string;
  params?: Record<string, Provenance>;
  uncertainty: { kind: 'none' | 'interval' | 'band' | 'ensemble' | 'alternatives' | 'tiers'; note: string };
  checks?: { test: string; holds: string }[];
  disagrees?: { with: string; note: string }[];
  file: string;
}

export interface Alternative {
  id: string;
  type: 'group' | 'alternative';
  title: string;
  description?: string;
  kind?: string;
  group?: string;
  show?: string[];
  default?: string | null;
  file: string;
}

export interface Kind {
  label: string;
  description?: string;
  moment?: boolean;
  /** latest: a start derived only from relations is shown at the latest time they allow */
  start?: 'latest';
  /** latest: an end given as a range is shown at the latest time it allows */
  end?: 'latest';
}

export interface Property {
  type: 'time' | 'point' | 'ref' | 'text' | 'string' | 'quantity' | 'color' | 'geometry' | 'form' | 'body-form';
  unit?: string;
  /** for strings: the values allowed, each with what it means */
  values?: Record<string, string>;
  interp?: string;
  moment?: boolean;
  applies_to?: string[];
  ref_types?: string[];
  inverse?: string;
  description: string;
}

export interface TimeConstraintSpec {
  from: string;
  to: string;
  lag?: boolean;
}

export interface RelationType {
  family: string;
  inverse: string;
  description?: string;
  from?: string[];
  to?: string[];
  time?: TimeConstraintSpec[];
}

export interface Vocab {
  /** flattened: "event/impact" → its definition, with `moment` inherited */
  kinds: Record<string, Kind>;
  properties: Record<string, Property>;
  methods: Record<string, { label: string; description?: string }>;
  confidence: Record<string, [number, number]>;
  relations: Record<string, RelationType>;
  sourceTypes: Record<string, string>;
  sourceKinds: Record<string, string>;
  prominence: ProminenceRule;
}

/** How the build derives from how far away a record shows: see schema/vocab/prominence.yaml. */
export interface ProminenceRule {
  budget: number;
  domains: Record<string, { reserve: number; kinds: Record<string, number> }>;
  scale: Record<string, { at: number; add: number }[]>;
}

/** A record as it appears in its file, before normalization, for schema validation. */
export interface RawRecord {
  file: string;
  type: 'entity' | 'source' | 'frame' | 'field' | 'model' | 'generator' | 'alternative' | 'manifest';
  data: Record<string, unknown>;
}

export interface LoadIssue {
  file: string;
  where?: string;
  message: string;
}

export interface World {
  root: string;
  entities: Entity[];
  sources: Source[];
  frames: Frame[];
  fields: Field[];
  models: Model[];
  generators: Generator[];
  alternatives: Alternative[];
  manifest: Manifest;
  vocab: Vocab;
  raw: RawRecord[];
  /** files that failed to parse, and references or forms the loader could not read */
  loadIssues: LoadIssue[];
  /** lookups by id */
  entity: Map<string, Entity>;
  /** snapshots of databases, by dataset id */
  snapshots: Map<string, OhmSnapshot>;
  /** snapshots of a formation's fossils, by dataset id */
  fossils: Map<string, PbdbSnapshot>;
  /** the land's fossils, as rows, by dataset id */
  landFossils: Map<string, LandSnapshot>;
  /** the body plans a taxon's form starts from, by name */
  plans: Record<string, Form>;
  source: Map<string, Source>;
  frame: Map<string, Frame>;
  alternative: Map<string, Alternative>;
}

async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith('.yaml') || e.name.endsWith('.yml')) out.push(p);
  }
  return out.sort();
}

async function loadYamlFiles(root: string, dir: string, issues: LoadIssue[]): Promise<{ file: string; data: Record<string, unknown> }[]> {
  const out: { file: string; data: Record<string, unknown> }[] = [];
  for (const path of await walk(join(root, dir))) {
    const file = relative(root, path);
    const doc = parseDocument(await readFile(path, 'utf8'), { uniqueKeys: true });
    if (doc.errors.length) {
      issues.push({ file, message: `YAML: ${doc.errors.map((e) => e.message).join('; ')}` });
      continue;
    }
    const data = doc.toJS();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      issues.push({ file, message: 'a record file must hold one mapping' });
      continue;
    }
    out.push({ file, data });
  }
  return out;
}

async function yamlOf<T>(path: string): Promise<T> {
  return parseDocument(await readFile(path, 'utf8')).toJS() as T;
}

/** Flatten a tree of terms (children written parent/child), inheriting `moment`. */
function flatten<T extends { children?: Record<string, T> }>(tree: Record<string, T>, inherit: (parent: T, child: T) => T = (_p, c) => c): Record<string, Omit<T, 'children'>> {
  const out: Record<string, Omit<T, 'children'>> = {};
  const visit = (prefix: string, terms: Record<string, T>, parent?: T) => {
    for (const [name, t0] of Object.entries(terms ?? {})) {
      const t = parent ? inherit(parent, t0) : t0;
      const { children, ...rest } = t;
      out[prefix + name] = rest;
      if (children) visit(`${prefix}${name}/`, children, t);
    }
  };
  visit('', tree);
  return out;
}

export function defaultStatus(author: string): Status {
  return author.startsWith('machine:') ? 'proposed' : 'accepted';
}

function citations(v: unknown): Citation[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as Citation[];
}

/** Resolve a reference written in an entity's file; local shorthand becomes a full reference. */
function resolve(s: unknown, self: string, issues: LoadIssue[], file: string, where: string): string {
  if (typeof s !== 'string') {
    issues.push({ file, where, message: `not a reference: ${JSON.stringify(s)}` });
    return String(s);
  }
  try {
    const r = parseRef(s, self);
    return refString(r);
  } catch (e) {
    issues.push({ file, where, message: (e as RefError).message });
    return s;
  }
}

export function refString(r: Ref): string {
  if (r.type === 'entity') return r.phase ? `${r.id}@${r.phase}` : r.part ? `${r.id}#${r.part}` : r.id;
  if (r.type === 'external') return `${r.scheme}:${r.id}`;
  return r.id;
}

function normalizeEntity(file: string, d: Record<string, unknown>, issues: LoadIssue[]): Entity {
  const id = String(d.id);
  const fileAuthor = typeof d.author === 'string' ? d.author : undefined;
  const base = (key: string, c: Record<string, unknown>, section: 'claims' | 'relations'): ClaimBase => {
    const where = `${section}.${key}`;
    const author = typeof c.author === 'string' ? c.author : fileAuthor ?? '';
    if (!author) issues.push({ file, where, message: 'no author: give one on the claim or for the file' });
    const subject = c.subject === undefined ? id : resolve(c.subject, id, issues, file, `${where}.subject`);
    return {
      key,
      entity: id,
      ref: `${id}#${key}`,
      subject,
      valid: c.valid as TimeInput | undefined,
      sources: citations(c.source).map((s, i) => ({ ...s, ref: resolve(s?.ref, id, issues, file, `${where}.source${Array.isArray(c.source) ? `[${i}]` : ''}.ref`) })),
      unsourced: c.unsourced as string | undefined,
      confidence: c.confidence as number | string | undefined,
      basis: (c.basis as Basis) ?? 'evidence',
      alt: c.alt === undefined ? undefined : resolve(c.alt, id, issues, file, `${where}.alt`),
      author,
      status: (c.status as Status) ?? defaultStatus(author),
      rank: (c.rank as Rank) ?? 'normal',
      note: c.note as string | undefined,
      file,
      where,
    };
  };
  const claims: Claim[] = Object.entries((d.claims ?? {}) as Record<string, Record<string, unknown>>).map(([key, c]) => ({
    ...base(key, c ?? {}, 'claims'),
    prop: String(c?.prop),
    value: c?.value,
    method: c?.method as string | undefined,
  }));
  const relations: Relation[] = Object.entries((d.relations ?? {}) as Record<string, Record<string, unknown>>).map(([key, r]) => ({
    ...base(key, r ?? {}, 'relations'),
    rel: String(r?.rel),
    to: resolve(r?.to, id, issues, file, `relations.${key}.to`),
    lag: r?.lag as LagInput | undefined,
  }));
  return {
    id,
    kind: String(d.kind),
    summary: d.summary as string | undefined,
    same_as: d.same_as as Record<string, string | number> | undefined,
    phases: ((d.phases ?? []) as Phase[]).map((p) => ({ id: String(p?.id), label: p?.label, gap: p?.gap })),
    claims,
    relations,
    file,
  };
}

/**
 * Load the world at `root`. The schema and vocabularies fall back to the main world's, so a
 * test fixture only needs the records it is about.
 */
export async function loadWorld(root: string = WORLD): Promise<World> {
  const loadIssues: LoadIssue[] = [];
  const from = (rel: string) => (existsSync(join(root, rel)) ? join(root, rel) : join(WORLD, rel));
  const kindsDoc = await yamlOf<{ kinds: Record<string, Kind & { children?: Record<string, Kind> }> }>(from('schema/vocab/kinds.yaml'));
  const propsDoc = await yamlOf<{
    properties: Vocab['properties'];
    methods: Record<string, { label: string; description?: string; children?: Record<string, { label: string; description?: string }> }>;
    confidence: Vocab['confidence'];
  }>(from('schema/vocab/properties.yaml'));
  const relDoc = await yamlOf<{ relations: Vocab['relations'] }>(from('schema/vocab/relations.yaml'));
  const srcDoc = await yamlOf<{ types: Record<string, string>; kinds: Record<string, string> }>(from('schema/vocab/sources.yaml'));
  const vocab: Vocab = {
    kinds: flatten(kindsDoc.kinds, (p, c) => ({ ...c, moment: c.moment ?? p.moment })),
    properties: propsDoc.properties,
    methods: flatten(propsDoc.methods),
    confidence: propsDoc.confidence,
    relations: relDoc.relations,
    sourceTypes: srcDoc.types,
    sourceKinds: srcDoc.kinds,
    prominence: await yamlOf<ProminenceRule>(from('schema/vocab/prominence.yaml')),
  };

  const raw: RawRecord[] = [];
  const read = async (base: string, dir: string, type: RawRecord['type']) => {
    const files = await loadYamlFiles(base, dir, loadIssues);
    for (const f of files) raw.push({ file: f.file, type, data: f.data });
    return files;
  };
  const entityFiles = await read(root, 'entities', 'entity');
  const sourceFiles = await read(root, 'sources', 'source');
  const frameFiles = await read(root, 'frames', 'frame');
  const fieldFiles = await read(root, 'fields', 'field');
  const modelFiles = await read(root, 'models', 'model');
  const generatorFiles = await read(root, 'generators', 'generator');
  const alternativeFiles = await read(root, 'alternatives', 'alternative');

  const manifestRaw = existsSync(join(root, 'manifest.yaml')) ? await yamlOf<Manifest>(join(root, 'manifest.yaml')) : { publish: { licenses: [] }, datasets: {} };
  if (existsSync(join(root, 'manifest.yaml'))) raw.push({ file: 'manifest.yaml', type: 'manifest', data: manifestRaw as unknown as Record<string, unknown> });
  const manifest: Manifest = {
    publish: manifestRaw.publish ?? { licenses: [] },
    datasets: Object.fromEntries(Object.entries(manifestRaw.datasets ?? {}).map(([id, d]) => [id, { ...d, id, file: 'manifest.yaml' }])),
  };

  const entities = entityFiles.map((f) => normalizeEntity(f.file, f.data, loadIssues));
  // A snapshot's elements become records, but for those a written record has adopted.
  const snapshots = new Map<string, OhmSnapshot>();
  for (const d of Object.values(manifest.datasets)) {
    if (d.import?.as !== 'ohm-site') continue;
    const path = d.fetch.url.replace(/^repo:/, '');
    const snap = JSON.parse(await readFile(join(REPO, path), 'utf8')) as OhmSnapshot;
    snapshots.set(d.id, snap);
    const adopted = new Set<string>();
    for (const e of entities) for (const c of e.claims) if (c.prop === 'footprint') for (const k of (c.value as { elements?: string[] })?.elements ?? []) adopted.add(k);
    for (const k of [...adopted]) if (!snap.elements.some((x) => elementKey(x) === k)) loadIssues.push({ file: 'manifest.yaml', where: d.id, message: `no element ${k} in the snapshot` });
    entities.push(...ohmEntities(snap, d.id, path, d.import.frame!, adopted));
  }
  // A formation's taxa become records too, but its occurrences stay rows of the snapshot.
  const fossils = new Map<string, PbdbSnapshot>();
  for (const d of Object.values(manifest.datasets)) {
    if (d.import?.as !== 'pbdb-formation') continue;
    const path = d.fetch.url.replace(/^repo:/, '');
    const snap = JSON.parse(await readFile(join(REPO, path), 'utf8')) as PbdbSnapshot;
    fossils.set(d.id, snap);
    entities.push(...pbdbEntities(snap, d.id, path, entities));
  }
  // The land's fossils stay rows, taxa and all: only a taxon a record adopts joins the world's tree.
  const landFossils = new Map<string, LandSnapshot>();
  for (const d of Object.values(manifest.datasets)) {
    if (d.import?.as !== 'pbdb-land') continue;
    const path = d.fetch.url.replace(/^repo:/, '');
    const snap = JSON.parse(await readFile(join(REPO, path), 'utf8')) as LandSnapshot;
    landFossils.set(d.id, snap);
    placeInLand(snap, d.id, path, entities);
  }
  const plans: Record<string, Form> = {};
  const planDir = from('plans');
  for (const path of (await walk(planDir)).sort()) plans[basename(path).replace(/\.ya?ml$/, '')] = await yamlOf<Form>(path);
  // A plan's description is its entry in the vocabulary, so that a new plan is one new file.
  if (vocab.properties.body_plan && Object.keys(plans).length) vocab.properties.body_plan.values = Object.fromEntries(Object.entries(plans).map(([k, v]) => [k, v.description ?? k]));
  const sources: Source[] = [
    ...sourceFiles.map((f) => ({ ...(f.data as unknown as Source), file: f.file })),
    ...Object.values(manifest.datasets),
  ];
  const frames = frameFiles.map((f) => ({ ...(f.data as unknown as Frame), file: f.file }));
  const fields = fieldFiles.map((f) => ({ ...(f.data as unknown as Field), file: f.file }));
  const models = modelFiles.map((f) => ({ ...(f.data as unknown as Model), file: f.file }));
  const generators = generatorFiles.map((f) => ({ ...(f.data as unknown as Generator), file: f.file }));
  const alternatives = alternativeFiles.map((f) => ({ ...(f.data as unknown as Alternative), file: f.file }));
  return {
    root,
    entities,
    sources,
    frames,
    fields,
    models,
    generators,
    alternatives,
    manifest,
    vocab,
    raw,
    loadIssues,
    entity: new Map(entities.map((e) => [e.id, e])),
    snapshots,
    fossils,
    landFossils,
    plans,
    source: new Map(sources.map((s) => [s.id, s])),
    frame: new Map(frames.map((f) => [f.id, f])),
    alternative: new Map(alternatives.map((a) => [a.id, a])),
  };
}

export function schemaDir(root: string): string {
  return existsSync(join(root, 'schema/entity.schema.json')) ? join(root, 'schema') : join(WORLD, 'schema');
}

/** Is `kind` the kind `of`, or one of its descendants? */
export function kindIs(kind: string, of: string): boolean {
  return kind === of || kind.startsWith(of + '/');
}

/** Is a subject (entity or phase) a moment? Phases always last. */
export function isMoment(world: World, subject: string): boolean {
  const { record, phase } = splitRef(subject);
  if (phase) return false;
  const e = world.entity.get(record);
  return !!e && !!world.vocab.kinds[e.kind]?.moment;
}
