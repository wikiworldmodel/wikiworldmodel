import { join } from 'node:path';
import { CACHE, WORLD } from './paths.ts';
import { readYaml } from './util.ts';

export interface DatasetFile {
  path: string;
  sha256: string;
}

export interface Dataset {
  title: string;
  /** short attribution shown wherever the data is displayed */
  credit: string;
  source: string;
  version: string;
  url: string;
  sha256: string;
  bytes: number;
  format: 'zip' | 'parquet';
  files?: Record<string, DatasetFile>;
  upstream?: { url: string; sha256: string };
  via?: string;
  license: string;
  license_note?: string;
}

export interface Manifest {
  datasets: Record<string, Dataset>;
}

export async function loadManifest(): Promise<Manifest> {
  return readYaml<Manifest>(join(WORLD, 'manifest.yaml'));
}

/** Each dataset version gets its own directory, keyed by its checksum. */
export function datasetDir(id: string, d: Dataset): string {
  return join(CACHE, 'datasets', `${id}@${d.sha256.slice(0, 12)}`);
}

export function datasetPath(id: string, d: Dataset): string {
  return join(datasetDir(id, d), d.url.split('/').pop()!);
}

/** Path of a named file inside a dataset: the archive member if it has `files`, else the download. */
export function datasetFile(id: string, d: Dataset, name?: string): string {
  if (!name) return datasetPath(id, d);
  const f = d.files?.[name];
  if (!f) throw new Error(`dataset ${id} has no file "${name}"`);
  return join(datasetDir(id, d), f.path);
}
