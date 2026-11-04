// Runs the Python importer (pyGPlates) on fetched datasets, caching its output by input hash.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDuration, parsePoint, toMa, type TimePointInput } from '../../../core/time.ts';
import { datasetFile, loadManifest } from './manifest.ts';
import { CACHE, REPO } from './paths.ts';
import { sha256, stableStringify } from './util.ts';
import type { Field } from './world.ts';

const IMPORTER = join(REPO, 'tools/world/importers/paleomap.py');
const REQUIREMENTS = join(REPO, 'tools/world/importers/requirements.txt');

/** The plate model frames and gridded fields move with. */
export const PLATE_MODEL = 'src:paleomap-plate-model';

export function python(): string {
  if (process.env.LIGHTWORLD_PYTHON) return process.env.LIGHTWORLD_PYTHON;
  const venv = join(REPO, '.venv/bin/python');
  return existsSync(venv) ? venv : 'python3';
}

/** A field's time span in Ma, oldest first. */
export function fieldAgesMa(f: Field): { maxAgeMa: number; minAgeMa: number; stepMyr: number } {
  const lo = toMa(parsePoint(f.time!.lo as TimePointInput).t);
  const hi = toMa(parsePoint(f.time!.hi as TimePointInput).t);
  return { maxAgeMa: Math.round(lo * 1e6) / 1e6, minAgeMa: Math.round(hi * 1e6) / 1e6, stepMyr: parseDuration(f.time!.step!) / 1e6 };
}

/**
 * What a gridded field is made from: elevation grids (a dataset of snapshots, partitioned by
 * the plate model's polygons), or the plate model's polygons alone (where its continental
 * blocks are). Those two are carried by the tiles; the climate and the people have files of their own.
 */
export function fieldSource(f: Field): 'elevation' | 'blocks' | 'climate' | 'people' {
  if (f.data?.as === 'climate') return 'climate';
  if (f.data?.as === 'people') return 'people';
  return f.data?.from === f.moves_with && f.data?.file === 'polygons' ? 'blocks' : 'elevation';
}

/** A gridded field the tiles carry, which the importer makes. */
export const tiledField = (f: Field): boolean => !f.derived && f.grid?.kind === 'lonlat' && (fieldSource(f) === 'elevation' || fieldSource(f) === 'blocks');

async function importKey(parts: unknown): Promise<string> {
  const code = await readFile(IMPORTER, 'utf8');
  const reqs = await readFile(REQUIREMENTS, 'utf8');
  return sha256(stableStringify({ code: sha256(code), reqs: sha256(reqs), parts })).slice(0, 16);
}

async function plateModel(id: string = PLATE_MODEL) {
  const manifest = await loadManifest();
  const pm = manifest.datasets[id];
  if (!pm) throw new Error(`${id} is not a dataset in the manifest`);
  return { manifest, rotations: datasetFile(id, pm, 'rotations'), polygons: datasetFile(id, pm, 'polygons'), sha256: pm.fetch.sha256 };
}

/** Run the importer once per distinct request; returns the output directory. */
async function run(command: string, name: string, key: string, request: Record<string, unknown>, log: (s: string) => void): Promise<string> {
  const out = join(CACHE, 'import', `${name}@${key}`);
  if (existsSync(join(out, 'meta.json'))) {
    log(`${name}: cached (${key})`);
    return out;
  }
  for (const p of Object.values(request)) {
    if (typeof p === 'string' && p.startsWith('/') && !existsSync(p)) throw new Error(`missing ${p}; run \`npm run fetch\` first`);
  }
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const reqPath = join(out, 'request.json');
  await writeFile(reqPath, JSON.stringify({ ...request, out }, null, 1));
  log(`${name}: importing with pyGPlates (${key})`);
  execFileSync(python(), [IMPORTER, command, reqPath], { stdio: 'inherit' });
  return out;
}

/** Normalized elevation snapshots + per-node plate ids for an elevation field. */
export async function importElevation(field: Field, log: (s: string) => void = console.log): Promise<string> {
  const pm = await plateModel(field.moves_with);
  const demId = field.data!.from;
  const dem = pm.manifest.datasets[demId];
  if (!dem) throw new Error(`${field.id}: ${demId} is not a dataset in the manifest`);
  const { minAgeMa, maxAgeMa } = fieldAgesMa(field);
  const request = { rotations: pm.rotations, polygons: pm.polygons, paleodem: datasetFile(demId, dem), minAgeMa, maxAgeMa };
  const key = await importKey({ checksums: { [field.moves_with!]: pm.sha256, [demId]: dem.fetch.sha256 }, min: minAgeMa, max: maxAgeMa });
  return run('fields', 'paleomap-fields', key, request, log);
}

/** Per-node plate ids where the plate model puts its blocks, at each of a blocks field's ages. */
export async function importBlocks(field: Field, log: (s: string) => void = console.log): Promise<string> {
  const pm = await plateModel(field.moves_with);
  const { minAgeMa, maxAgeMa, stepMyr } = fieldAgesMa(field);
  const agesMa: number[] = [];
  for (let a = minAgeMa; a <= maxAgeMa + 1e-9; a += stepMyr) agesMa.push(Math.round(a * 1e6) / 1e6);
  const request = { rotations: pm.rotations, polygons: pm.polygons, agesMa };
  const key = await importKey({ checksums: { [field.moves_with!]: pm.sha256 }, agesMa });
  return run('blocks', 'paleomap-blocks', key, request, log);
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

/**
 * Which plate polygon contains each present-day point, and whether it exists at given ages.
 * Answers are kept one per point, keyed by the importer, the plate model and the query, so a
 * change to the world asks pyGPlates only about the points it adds or moves.
 */
export async function resolvePoints(points: PointQuery[]): Promise<PointResult[]> {
  const pm = await plateModel();
  const prefix = await importKey({ checksums: { [PLATE_MODEL]: pm.sha256 } });
  const file = join(CACHE, 'import', `points@${prefix}.json`);
  const known: Record<string, Omit<PointResult, 'id'>> = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
  const keyOf = (p: PointQuery) => stableStringify([p.lat, p.lon, p.agesMa]);
  const missing = new Map<string, PointQuery>();
  for (const p of points) if (!known[keyOf(p)]) missing.set(keyOf(p), { ...p, id: keyOf(p) });
  if (missing.size) {
    await mkdir(join(CACHE, 'import'), { recursive: true });
    const reqPath = join(CACHE, 'import', `points@${prefix}.request.json`);
    await writeFile(reqPath, JSON.stringify({ rotations: pm.rotations, polygons: pm.polygons, points: [...missing.values()] }));
    const stdout = execFileSync(python(), [IMPORTER, 'points', reqPath], { encoding: 'utf8' });
    for (const { id, ...r } of JSON.parse(stdout).points as PointResult[]) known[id] = r;
    const sorted = Object.fromEntries(Object.entries(known).sort(([a], [b]) => (a < b ? -1 : 1)));
    await writeFile(file, JSON.stringify(sorted));
  }
  return points.map((p) => ({ id: p.id, ...known[keyOf(p)] }));
}
