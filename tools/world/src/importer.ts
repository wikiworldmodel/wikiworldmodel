// Runs the Python importer (pyGPlates) on fetched datasets, caching its output by input hash.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { datasetFile, loadManifest } from './manifest.ts';
import { CACHE, REPO, WORLD } from './paths.ts';
import { readYaml, sha256, stableStringify } from './util.ts';

const IMPORTER = join(REPO, 'tools/world/importers/paleomap.py');
const REQUIREMENTS = join(REPO, 'tools/world/importers/requirements.txt');

export function python(): string {
  if (process.env.LIGHTWORLD_PYTHON) return process.env.LIGHTWORLD_PYTHON;
  const venv = join(REPO, '.venv/bin/python');
  return existsSync(venv) ? venv : 'python3';
}

export interface FieldDef {
  id: string;
  title: string;
  quantity: string;
  units: string;
  datum: string;
  dataset: string;
  plate_model: string;
  frame: string;
  time: { from: { ma: number }; to: { ma: number }; step_myr: number };
  basis: string;
  interpolation: string;
  derived?: { coastline?: { isoline_m: number } };
}

export async function loadField(): Promise<FieldDef> {
  return readYaml<FieldDef>(join(WORLD, 'fields/elevation.yaml'));
}

async function importKey(parts: unknown): Promise<string> {
  const code = await readFile(IMPORTER, 'utf8');
  const reqs = await readFile(REQUIREMENTS, 'utf8');
  return sha256(stableStringify({ code: sha256(code), reqs: sha256(reqs), parts })).slice(0, 16);
}

async function inputs() {
  const manifest = await loadManifest();
  const field = await loadField();
  const pm = manifest.datasets[field.plate_model];
  const dem = manifest.datasets[field.dataset];
  return {
    field,
    rotations: datasetFile(field.plate_model, pm, 'rotations'),
    polygons: datasetFile(field.plate_model, pm, 'polygons'),
    paleodem: datasetFile(field.dataset, dem),
    checksums: { [field.plate_model]: pm.sha256, [field.dataset]: dem.sha256 },
  };
}

/** Normalized snapshots + per-node plate ids; returns the output directory. */
export async function importFields(log: (s: string) => void = console.log): Promise<string> {
  const inp = await inputs();
  const request = {
    rotations: inp.rotations,
    polygons: inp.polygons,
    paleodem: inp.paleodem,
    minAgeMa: inp.field.time.to.ma,
    maxAgeMa: inp.field.time.from.ma,
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
