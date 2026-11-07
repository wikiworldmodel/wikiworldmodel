// Every layer answers everywhere, in a tier (docs/STRUCTURE.md section 3.3): evidence, model, generic or unknown,
// never nothing; and generic land stands in where nothing records where the land was.
import { describe, expect, it } from 'vitest';
import type { SeaBin } from './atlas.ts';
import type { PlanetFile } from './planet.ts';
import { LAYERS, resolve, seaTierOf, tierCounts, TIERS, type ResolveWorld } from './resolve.ts';
import type { FeatureTime } from './tileset.ts';

const span = (a: number, b: number): FeatureTime => ({ start: { best: a, lo: a, hi: a, derived: false }, end: { best: b, lo: b, hi: b, derived: false }, instant: false });
const state = (subject: string, label: string, a: number, b: number, surface: string) => ({ subject, label, time: span(a, b), values: { surface: [{ claim: `${subject}#s`, value: surface, rank: 'normal', basis: 'reconstruction' as const }] } });
const GA = (ga: number) => 1950 - ga * 1e9;

/** A made-up planet: molten, then with oceans, then dry; a map for its last hundred million years. */
const PLANET: PlanetFile = {
  planet: { id: 'test/earth', label: 'Earth', time: span(GA(4.5), GA(-3)), phases: [state('test/earth@magma', 'Magma ocean', GA(4.5), GA(4.4), 'magma'), state('test/earth@oceans', 'Oceans', GA(4.4), GA(-1), 'ocean'), state('test/earth@dry', 'Dry', GA(-1), GA(-3), 'bare-rock')] },
  episodes: [],
};
const WORLD: ResolveWorld = {
  planet: PLANET,
  geography: [{ title: 'A map', mode: 'elevation', coverage: [GA(0.1), 1950] }],
  climate: [GA(0.1), 1950],
  polities: [-3000, 1950],
  polity: (lat) => (lat > 0 ? 'North' : undefined),
  life: (lat, _lon, t) => (t < GA(0.5) ? null : lat > 30 ? 'here' : lat > 0 ? 'region' : lat > -30 ? 'standin' : 'sea'),
  genericLand: (lat) => lat > 45,
};

describe('resolve', () => {
  it('answers every layer at every place and time with a tier, from before the planet to after its oceans', () => {
    const times = [GA(4.6), GA(4.45), GA(3), GA(0.05), 1000, 1950, GA(-0.5), GA(-2), GA(-4)];
    for (const layer of LAYERS) {
      for (const t of times) for (const lat of [-60, -10, 10, 60]) {
        const a = resolve(WORLD, layer, lat, 0, t);
        expect(TIERS, `${layer} at ${t}, ${lat}`).toContain(a.tier);
        expect(a.why.length, `${layer} at ${t}`).toBeGreaterThan(10);
      }
    }
  });

  it('draws generic land where nothing records where the land was, and says so', () => {
    expect(resolve(WORLD, 'geography', 60, 0, GA(3))).toMatchObject({ tier: 'generic', value: 'land' });
    expect(resolve(WORLD, 'geography', 10, 0, GA(3))).toMatchObject({ tier: 'generic', value: 'sea' });
    expect(resolve(WORLD, 'geography', 10, 0, GA(0.05))).toMatchObject({ tier: 'model', value: 'elevation' });
    expect(resolve(WORLD, 'geography', 10, 0, GA(4.45))).toMatchObject({ tier: 'evidence', value: 'magma' });
    expect(resolve(WORLD, 'geography', 10, 0, GA(-2))).toMatchObject({ tier: 'generic', value: 'rock' });
    expect(resolve(WORLD, 'geography', 10, 0, GA(4.6))).toMatchObject({ tier: 'unknown', value: null });
  });

  it("reads the atlas's tiers as tiers of evidence", () => {
    const t = GA(0.05);
    expect([40, 10, -10, -40].map((lat) => resolve(WORLD, 'life', lat, 0, t).tier)).toEqual(['evidence', 'model', 'generic', 'unknown']);
    expect(resolve(WORLD, 'life', 40, 0, GA(3)).tier).toBe('unknown');
  });

  it("reads the sea's atlas as the land's, where the land's has no land", () => {
    const grid = { step: 90, nx: 4, ny: 2 };
    // Two stages of one sea: the first with a genus recorded in the north-west patch, one stood in for in the north-east and
    // nothing at all in the south-west; the second with no list anywhere.
    const taxon = { no: 1, label: 'Atrypa', rank: 'genus', group: 'Rhynchonellata', rows: 3, span: [390, 385] as [number, number] };
    const bins: SeaBin[] = [
      { format: 'lightworld-sea-bin@1' as const, from: GA(0.4), to: GA(0.38), slice: GA(0.39), name: 'a', taxa: [taxon, { ...taxon, standin: true }], nodes: { 0: [0, 255, 0, 12], 1: [1, 255, 2, 500], 4: [] } },
      { format: 'lightworld-sea-bin@1' as const, from: GA(0.38), to: GA(0.36), slice: GA(0.37), name: 'b', taxa: [], nodes: {} },
    ];
    const tier = (lat: number, lon: number, t: number) => seaTierOf(bins, grid, (i) => bins[i], lat, lon, t);
    expect([tier(45, -135, GA(0.39)), tier(45, -45, GA(0.39)), tier(-45, -135, GA(0.39)), tier(-45, 45, GA(0.39)), tier(45, -135, GA(0.37)), tier(45, -135, GA(0.5))]).toEqual(['sea-here', 'sea-standin', 'sea-nothing', null, null, null]);
    const world: ResolveWorld = { ...WORLD, life: () => 'sea-region' };
    expect(resolve(world, 'life', 0, 0, GA(0.05))).toMatchObject({ tier: 'model', value: 'sea-region' });
    expect(resolve({ ...WORLD, life: () => 'sea-here' }, 'life', 0, 0, GA(0.05)).tier).toBe('evidence');
    expect(resolve({ ...WORLD, life: () => 'sea-standin' }, 'life', 0, 0, GA(0.05)).tier).toBe('generic');
  });

  it('reads the rivers where a dataset saw them, then the drainage where it routes them, and a scene\'s invention before', () => {
    const world: ResolveWorld = { ...WORLD, water: { observed: { span: [1950, 2100], at: (lat) => lat > 0 }, model: [[GA(0.000798), 2100], [GA(0.545), GA(0.000798)]] } };
    expect(resolve(world, 'water', 10, 0, 2000).tier).toBe('evidence');
    expect(resolve(world, 'water', -10, 0, 2000).tier).toBe('model');
    expect(resolve(world, 'water', 10, 0, GA(0.0001)).tier).toBe('model');
    expect(resolve(world, 'water', 10, 0, GA(0.3)).tier).toBe('model');
    expect(resolve(world, 'water', 10, 0, GA(0.6)).tier).toBe('generic');
  });

  it('counts the tiers each layer answers in', () => {
    const counts = tierCounts(WORLD, [[60, 0], [10, 0]], [GA(3), GA(0.05)]);
    for (const layer of LAYERS) expect(Object.values(counts[layer]).reduce((a, b) => a + b, 0)).toBe(4);
    expect(counts.geography).toEqual({ evidence: 0, model: 2, generic: 2, unknown: 0 });
  });
});
