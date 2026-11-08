// Loading a build: its index files, and records on demand. Every URL is under the build's
// own directory, so a link that names a build keeps showing that build.
import type { PlanetFile } from '../../core/planet.ts';
import type { BuildIndex, EntityRecord, PeriodsFile, SearchFile, SeriesFile } from '../../core/records.ts';
import { PlateModels, RotationModel } from '../../core/rotation-model.ts';
import { PRESENT_YEAR } from '../../core/time.ts';
import type { AtlasIndex, SeaIndex } from '../../core/atlas.ts';
import type { FeatureIndex } from '../../core/featuretiles.ts';
import type { FramesFile, Tileset } from '../../core/tileset.ts';

export interface Build {
  id: string;
  base: string;
  tileset: Tileset;
  frames: FramesFile;
  /** the plate model the records' frames move with */
  model: RotationModel;
  /** every plate model a field moves with, by the plate numbers the tiles carry */
  plates: PlateModels;
  periods: PeriodsFile;
  search: SearchFile;
  series: SeriesFile;
  planet: PlanetFile;
  features: FeatureIndex;
  /** who lived where, if this build has it */
  atlas?: AtlasIndex;
  /** the sea's atlas: what lived in the sea, and the genera a scene of it can draw */
  sea?: SeaIndex;
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
  const [frames, periods, search, series, planet, features, atlas, sea] = await Promise.all([
    getJSON<FramesFile>(base + tileset.files.frames),
    getJSON<PeriodsFile>(base + tileset.files.periods),
    getJSON<SearchFile>(base + tileset.files.search),
    getJSON<SeriesFile>(base + tileset.files.series),
    getJSON<PlanetFile>(base + tileset.files.planet),
    getJSON<FeatureIndex>(base + tileset.files.features),
    tileset.files.atlas ? getJSON<AtlasIndex>(base + tileset.files.atlas) : Promise.resolve(undefined),
    tileset.files.sea ? getJSON<SeaIndex>(base + tileset.files.sea) : Promise.resolve(undefined),
  ]);
  // A period that still holds has no end; on the time axis it runs to the present.
  for (const p of periods.periods) {
    p.end ??= PRESENT_YEAR;
    for (const v of Object.values(p.variants ?? {})) v.end ??= PRESENT_YEAR;
  }
  const model = new RotationModel(frames.rotations);
  const plates = new PlateModels(model, (frames.models ?? []).map((m) => ({ source: m.source, offset: m.offset, model: new RotationModel(m.rotations) })));
  return { id, base, tileset, frames, model, plates, periods, search, series, planet, features, atlas, sea };
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
