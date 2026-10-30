// Runs the Python importer (pyGPlates) on fetched datasets, caching its output by input hash.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDuration, parsePoint, toMa, type TimePointInput } from '../../../core/time.ts';
import { datasetFile, loadManifest } from './manifest.ts';
import { CACHE, REPO, WORLD } from './paths.ts';
import { readYaml, sha256, stableStringify } from './util.ts';
import type { Field } from './world.ts';

const IMPORTER = join(REPO, 'tools/world/importers/paleomap.py');
const REQUIREMENTS = join(REPO, 'tools/world/importers/requirements.txt');

export function python(): string {
  if (process.env.LIGHTWORLD_PYTHON) return process.env.LIGHTWORLD_PYTHON;
  const venv = join(REPO, '.venv/bin/python');
  return existsSync(venv) ? venv : 'python3';
}

/** The field the build renders, and the plate model its nodes move with. */
export const ELEVATION = 'field:earth/elevation';

export async function loadField(): Promise<Field> {
  const f = (await readYaml<Field>(join(WORLD, 'fields/earth/elevation.yaml')));
  if (f.id !== ELEVATION) throw new Error(`fields/earth/elevation.yaml is ${f.id}, not ${ELEVATION}`);
  return f;
}

/** A field's time span in Ma, oldest first. */
export function fieldAgesMa(f: Field): { maxAgeMa: number; minAgeMa: number; stepMyr: number } {
  const lo = toMa(parsePoint(f.time!.lo as TimePointInput).t);
  const hi = toMa(parsePoint(f.time!.hi as TimePointInput).t);
  return { maxAgeMa: Math.round(lo * 1e6) / 1e6, minAgeMa: Math.round(hi * 1e6) / 1e6, stepMyr: parseDuration(f.time!.step) / 1e6 };
}

async function importKey(parts: unknown): Promise<string> {
  const code = await readFile(IMPORTER, 'utf8');
  const reqs = await readFile(REQUIREMENTS, 'utf8');
  return sha256(stableStringify({ code: sha256(code), reqs: sha256(reqs), parts })).slice(0, 16);
}

async function inputs() {
  const manifest = await loadManifest();
  const field = await loadField();
  const pmId = field.moves_with!;
  const demId = field.data!.from;
  const pm = manifest.datasets[pmId];
  const dem = manifest.datasets[demId];
  if (!pm || !dem) throw new Error(`${ELEVATION}: ${!pm ? pmId : demId} is not a dataset in the manifest`);
  return {
    field,
    rotations: datasetFile(pmId, pm, 'rotations'),
    polygons: datasetFile(pmId, pm, 'polygons'),
    paleodem: datasetFile(demId, dem),
    checksums: { [pmId]: pm.fetch.sha256, [demId]: dem.fetch.sha256 },
  };
}

/** Normalized snapshots + per-node plate ids; returns the output directory. */
export async function importFields(log: (s: string) => void = console.log): Promise<string> {
  const inp = await inputs();
  const request = {
    rotations: inp.rotations,
    polygons: inp.polygons,
    paleodem: inp.paleodem,
    minAgeMa: fieldAgesMa(inp.field).minAgeMa,
    maxAgeMa: fieldAgesMa(inp.field).maxAgeMa,
  };
  const key = await importKey({ checksums: inp.checksums, min: request.minAgeMa, max: request.maxAgeMa });
  const out = join(CACHE, 'import', `paleomap-fields@${key}`);
  if (existsSync(join(out, 'meta.json'))) {
    log(`fields: cached (${key})`);
    return out;
  }
  for (const p of [request.rotations, request.polygons, request.paleodem]) {
    if (!existsSync(p)) throw new Error(`missing ${p}; run \`npm run fetch\` first`);
  }
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const reqPath = join(out, 'request.json');
  await writeFile(reqPath, JSON.stringify({ ...request, out }, null, 1));
  log(`fields: importing ${request.maxAgeMa}–${request.minAgeMa} Ma with pyGPlates (${key})`);
  execFileSync(python(), [IMPORTER, 'fields', reqPath], { stdio: 'inherit' });
  return out;
}

export interface PointQuery {
  id: string;
  lat: number;
  lon: number;
  agesMa: number[];
}

export interface PointResult {
  id: string;
  plate: number | null;
  polygonValidFromMa?: number | null;
  existsAt?: Record<string, boolean>;
}

/** Which plate polygon contains each present-day point, and whether it exists at given ages. */
export async function resolvePoints(points: PointQuery[]): Promise<PointResult[]> {
  const inp = await inputs();
  const request = { rotations: inp.rotations, polygons: inp.polygons, points };
  const key = await importKey({ checksums: inp.checksums, points });
  const cached = join(CACHE, 'import', `points@${key}.json`);
  if (existsSync(cached)) return JSON.parse(await readFile(cached, 'utf8')).points;
  await mkdir(join(CACHE, 'import'), { recursive: true });
  const reqPath = join(CACHE, 'import', `points@${key}.request.json`);
  await writeFile(reqPath, JSON.stringify(request));
  const stdout = execFileSync(python(), [IMPORTER, 'points', reqPath], { encoding: 'utf8' });
  await writeFile(cached, stdout);
  return JSON.parse(stdout).points;
}
