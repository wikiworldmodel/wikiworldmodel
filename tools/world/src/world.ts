// Load a world: entities, sources, periods, frames, fields, vocabularies and the manifest.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { WORLD } from './paths.ts';

export interface Claim {
  prop: string;
  phase?: string;
  value: unknown;
  source: string;
  locator?: string;
  quote?: string;
  method?: string;
  confidence?: 'high' | 'medium' | 'low';
  author: string;
  status: 'proposed' | 'accepted' | 'disputed' | 'deprecated';
  rank: 'preferred' | 'normal' | 'deprecated';
  note?: string;
}

export interface Relation {
  type: string;
  phase?: string;
  of: string;
  lag?: { min?: Record<string, number>; max?: Record<string, number> };
  source: string;
  locator?: string;
  quote?: string;
  author: string;
  status: Claim['status'];
  note?: string;
}

export interface Entity {
  id: string;
  kind: string;
  label: string;
  summary?: string;
  frame: string;
  basis?: 'evidence' | 'reconstruction' | 'procedural';
  same_as?: Record<string, string | number>;
  phases?: Record<string, { label: string; summary?: string }>;
  claims: Record<string, Claim>;
  relations?: Record<string, Relation>;
}

export interface Source {
  id: string;
  type: string;
  citation: string;
  authors?: string[];
  year?: number;
  title?: string;
  container?: string;
  doi?: string;
  url?: string;
  license?: string;
  via?: string;
  reliability?: string;
  verified?: { by: string; how: string };
  note?: string;
}

export interface Period {
  id: string;
  name: string;
  rank: string;
  start: { ma: number };
  end: { ma: number };
  color?: string;
  parent?: string;
}

export interface PeriodFile {
  source: string;
  periods: Period[];
}

export interface Kind {
  label: string;
  description: string;
  temporal: 'instant' | 'interval';
}

export interface Vocab {
  kinds: Record<string, Kind>;
  props: Record<string, { type: 'time' | 'point' | 'string' | 'number'; description: string }>;
  relations: Record<string, { family: string; temporal?: string }>;
}

export interface Frame {
  title: string;
  description?: string;
  parent?: string;
  dataset?: string;
  rotations?: string;
  polygons?: string;
  anchor?: number;
}

/** A loaded record and where it came from, for error messages. */
export interface Loaded<T> {
  file: string;
  data: T;
}

export interface World {
  root: string;
  entities: Loaded<Entity>[];
  sources: Loaded<Source>[];
  periods: Loaded<PeriodFile>[];
  frames: Record<string, Frame>;
  vocab: Vocab;
  /** YAML or other files that failed to parse */
  parseErrors: { file: string; message: string }[];
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

async function loadYamlFiles<T>(root: string, dir: string, errors: World['parseErrors']): Promise<Loaded<T>[]> {
  const out: Loaded<T>[] = [];
  for (const path of await walk(join(root, dir))) {
    const file = relative(root, path);
    const doc = parseDocument(await readFile(path, 'utf8'), { uniqueKeys: true });
    if (doc.errors.length) {
      errors.push({ file, message: doc.errors.map((e) => e.message).join('; ') });
      continue;
    }
    out.push({ file, data: doc.toJS() as T });
  }
  return out;
}

async function yamlOf<T>(path: string): Promise<T> {
  return parseDocument(await readFile(path, 'utf8')).toJS() as T;
}

/**
 * Load the world at `root`. Schema, vocabularies and frames fall back to the main world, so a
 * test fixture only needs the records it is about.
 */
export async function loadWorld(root: string = WORLD): Promise<World> {
  const parseErrors: World['parseErrors'] = [];
  const from = (rel: string) => (existsSync(join(root, rel)) ? join(root, rel) : join(WORLD, rel));
  const vocab: Vocab = {
    kinds: (await yamlOf<{ kinds: Vocab['kinds'] }>(from('schema/vocab/kinds.yaml'))).kinds,
    props: (await yamlOf<{ props: Vocab['props'] }>(from('schema/vocab/props.yaml'))).props,
    relations: (await yamlOf<{ relations: Vocab['relations'] }>(from('schema/vocab/relations.yaml'))).relations,
  };
  const frames: Record<string, Frame> = {};
  for (const f of await loadYamlFiles<{ frames: Record<string, Frame> }>(existsSync(join(root, 'frames')) ? root : WORLD, 'frames', parseErrors)) {
    Object.assign(frames, f.data.frames);
  }
  return {
    root,
    entities: await loadYamlFiles<Entity>(root, 'entities', parseErrors),
    sources: await loadYamlFiles<Source>(root, 'sources', parseErrors),
    periods: await loadYamlFiles<PeriodFile>(root, 'periods', parseErrors),
    frames,
    vocab,
    parseErrors,
  };
}

export function schemaDir(root: string): string {
  return existsSync(join(root, 'schema/entity.schema.json')) ? join(root, 'schema') : join(WORLD, 'schema');
}
