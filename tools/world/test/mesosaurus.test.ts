// Pass criterion: the Mesosaurus localities of South America and southern Africa, thousands of
// kilometres apart today, meet when moved back to the Artinskian (290.1–283.5 Ma in the ICS
// chart; to 279.3 Ma in the PBDB's time scale) by the build's own frames.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EntityRecord } from '../../../core/records.ts';
import { angleBetween, rotate, unitVector } from '../../../core/quat.ts';
import { RotationModel } from '../../../core/rotation-model.ts';
import { toMa } from '../../../core/time.ts';
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
  // Measured in present-day coordinates, which are plate-local here: PALEOMAP's rotations at
  // the present are the identity.
  const position = (slug: string, ageMa: number) => {
    const r = record(slug);
    const loc = r.claims.find((c) => c.prop === 'location')!.value as { lat: number; lon: number; frame: string };
    expect(loc.frame).toBe('frame:earth/present-day');
    return rotate(model.total(r.frame!.plate!, ageMa), unitVector(loc.lat, loc.lon));
  };
  const km = (a: string, b: string, ageMa: number) => angleBetween(position(a, ageMa), position(b, ageMa)) * EARTH_RADIUS_KM;
  const pairs = AMERICA.flatMap((a) => AFRICA.map((b) => [a, b] as const));

  it('ride the South American and African plates', () => {
    expect(AMERICA.map((s) => record(s).frame!.plate)).toEqual([201, 202]);
    expect(AFRICA.map((s) => record(s).frame!.plate)).toEqual([701, 701]);
    expect(record('kabus').frame!.entityLabel).toBe('south-central Africa');
  });

  it('are dated by the stage they cite', () => {
    for (const s of [...AMERICA, ...AFRICA]) {
      const t = record(s).time.start;
      expect([toMa(t.lo), toMa(t.hi)].map((x) => +x.toFixed(3))).toEqual([290.1, 283.5]);
    }
  });

  it('are an ocean apart today', () => {
    for (const [a, b] of pairs) expect(km(a, b, 0)).toBeGreaterThan(6500);
  });

  it('meet at 285 and 280 Ma, when the Irati and Whitehill basins were one', () => {
    for (const age of [285, 280]) {
      const d = pairs.map(([a, b]) => km(a, b, age));
      for (const x of d) expect(x).toBeLessThan(2000);
      expect(Math.min(...d)).toBeLessThan(1000);
    }
  });
});
