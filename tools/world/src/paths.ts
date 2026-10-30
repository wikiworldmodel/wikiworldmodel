import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const WORLD = join(REPO, 'world');
export const CACHE = join(REPO, '.cache');
export const DIST = join(REPO, 'dist');
export const BUILDS = join(DIST, 'builds');
