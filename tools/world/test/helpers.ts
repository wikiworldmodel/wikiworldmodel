import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { datasetFile, loadManifest } from '../src/manifest.ts';
import { BUILDS } from '../src/paths.ts';

/** A fetched dataset file, or a clear failure telling how to get it. */
export async function dataset(id: string, file?: string): Promise<string> {
  const m = await loadManifest();
  const path = datasetFile(id, m.datasets[id], file);
  if (!existsSync(path)) throw new Error(`${path} is missing: run \`npm run fetch\` first`);
  return path;
}

/** The latest world build, or a clear failure telling how to make one. */
export function latestBuild(): string {
  const index = join(BUILDS, 'index.json');
  if (!existsSync(index)) throw new Error('no world build: run `npm run build:world` first');
  return join(BUILDS, JSON.parse(readFileSync(index, 'utf8')).latest);
}
