// Loading a build: its index files, and records on demand. Every URL is under the build's
// own directory, so a link that names a build keeps showing that build.
import type { PlanetFile } from '../../core/planet.ts';
import type { BuildIndex, EntityRecord, PeriodsFile, SearchFile, SeriesFile } from '../../core/records.ts';
import { RotationModel } from '../../core/rotation-model.ts';
import { PRESENT_YEAR } from '../../core/time.ts';
import type { FramesFile, Tileset } from '../../core/tileset.ts';

export interface Build {
  id: string;
  base: string;
  tileset: Tileset;
  frames: FramesFile;
  model: RotationModel;
  periods: PeriodsFile;
  search: SearchFile;
  series: SeriesFile;
  planet: PlanetFile;
}

/** Every URL the viewer fetched, in order; tests read it to check what scrubbing loads. */
export const fetchLog: string[] = [];

export async function getJSON<T>(url: string): Promise<T> {
  fetchLog.push(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function getBytes(url: string): Promise<ArrayBuffer> {
  fetchLog.push(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

export async function latestBuild(root: string): Promise<string> {
  return (await getJSON<BuildIndex>(`${root}builds/index.json`)).latest;
}

export async function loadBuild(root: string, id: string): Promise<Build> {
  const base = `${root}builds/${id}/`;
  const tileset = await getJSON<Tileset>(`${base}tileset.json`);
  const [frames, periods, search, series, planet] = await Promise.all([
    getJSON<FramesFile>(base + tileset.files.frames),
    getJSON<PeriodsFile>(base + tileset.files.periods),
    getJSON<SearchFile>(base + tileset.files.search),
    getJSON<SeriesFile>(base + tileset.files.series),
    getJSON<PlanetFile>(base + tileset.files.planet),
  ]);
  // A period that still holds has no end; on the time axis it runs to the present.
  for (const p of periods.periods) {
    p.end ??= PRESENT_YEAR;
    for (const v of Object.values(p.variants ?? {})) v.end ??= PRESENT_YEAR;
  }
  return { id, base, tileset, frames, model: new RotationModel(frames.rotations), periods, search, series, planet };
}

const records = new Map<string, Promise<EntityRecord>>();

export function loadRecord(build: Build, id: string): Promise<EntityRecord> {
  let p = records.get(id);
  if (!p) {
    p = getJSON<EntityRecord>(`${build.base}${build.tileset.files.records}${id}.json`);
    records.set(id, p);
  }
  return p;
}
