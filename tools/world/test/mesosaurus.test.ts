// Pass criterion: the Mesosaurus localities of South America and southern Africa, thousands of
// kilometres apart today, meet when moved back to 280 Ma by the build's own frames.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EntityRecord } from '../../../core/records.ts';
import { angleBetween, rotate, unitVector } from '../../../core/quat.ts';
import { RotationModel } from '../../../core/rotation-model.ts';
import type { FramesFile } from '../../../core/tileset.ts';
import { latestBuild } from './helpers.ts';

const EARTH_RADIUS_KM = 6371;
const AMERICA = ['sao-mateus-do-sul', 'arroyo-de-la-mina'];
const AFRICA = ['calvinia', 'kabus'];

describe('Mesosaurus localities', () => {
  const build = latestBuild();
  const frames = JSON.parse(readFileSync(join(build, 'frames.json'), 'utf8')) as FramesFile;
  const model = new RotationModel(frames.rotations);
  const record = (slug: string) => JSON.parse(readFileSync(join(build, 'records/life/mesosaurus', `${slug}.json`), 'utf8')) as EntityRecord;
  const position = (slug: string, ageMa: number) => {
    const r = record(slug);
    const loc = r.claims.find((c) => c.prop === 'location')!.value as { lat: number; lon: number };
    return rotate(model.total(r.frame.plate!, ageMa), unitVector(loc.lat, loc.lon));
  };
  const km = (a: string, b: string, ageMa: number) => angleBetween(position(a, ageMa), position(b, ageMa)) * EARTH_RADIUS_KM;
  const pairs = AMERICA.flatMap((a) => AFRICA.map((b) => [a, b] as const));

  it('ride the South American and African plates', () => {
    expect(AMERICA.map((s) => record(s).frame.plate)).toEqual([201, 202]);
    expect(AFRICA.map((s) => record(s).frame.plate)).toEqual([701, 701]);
  });

  it('are an ocean apart today', () => {
    for (const [a, b] of pairs) expect(km(a, b, 0)).toBeGreaterThan(6500);
  });

  it('meet at 280 Ma, when the Irati and Whitehill basins were one', () => {
    const d = pairs.map(([a, b]) => km(a, b, 280));
    for (const x of d) expect(x).toBeLessThan(2000);
    expect(Math.min(...d)).toBeLessThan(1000);
  });
});
