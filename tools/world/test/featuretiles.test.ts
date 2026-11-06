// Pass criteria: every marker is stored once; no cell holds more than its budget; the view finds a
// feature whenever it is alive and the camera is near it, wherever its plate has carried it; and
// what comes from afar does not grow with the world.
import { describe, expect, it } from 'vitest';
import { binOf, BINS_EACH_WAY, binsOfNode, FEATURE_VARIANTS, featureTileUrl, lifeOf, tilesFor, timeNodeOf, withVariants, type FeatureVariants, type FeatureView } from '../../../core/featuretiles.ts';
import type { Quat } from '../../../core/quat.ts';
import { PRESENT_YEAR } from '../../../core/time.ts';
import type { Feature, FeatureTime } from '../../../core/tileset.ts';
import { kindScore, prominenceOf, tileFeatures } from '../src/build/featuretiles.ts';
import type { ProminenceRule } from '../src/world.ts';
import { mostProminent } from '../../../viewer/src/ui/markers.ts';

const rule: ProminenceRule = {
  budget: 8,
  domains: {
    earth: { reserve: 1, kinds: { 'event/impact': 9, landform: 6 } },
    people: { reserve: 1, kinds: { settlement: 6, 'event/battle': 5 } },
    life: { reserve: 1, kinds: { occurrence: 3 } },
  },
  scale: { population: [{ at: 1e4, add: 1 }, { at: 1e6, add: 3 }] },
};

const est = (best: number | null) => ({ best, lo: best ?? -Infinity, hi: best ?? Infinity, derived: false });
const span = (a: number, b: number | null): FeatureTime => ({ start: est(a), end: est(b), instant: a === b });
const feature = (id: string, kind: string, lat: number, lon: number, time: FeatureTime, plate?: number): Feature => ({
  id,
  label: id,
  kind,
  basis: { time: 'evidence', place: 'evidence', placeNow: 'evidence' },
  frame: 'f',
  plate,
  location: { lat, lon },
  time,
  status: 'proposed',
});

/** A world of n features from a small deterministic sequence, thick around one city. */
function world(n: number): Feature[] {
  const out: Feature[] = [];
  let x = 12345;
  const r = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const kinds = ['settlement', 'event/battle', 'occurrence', 'landform', 'event/impact'];
  for (let i = 0; i < n; i++) {
    const busy = i % 2 === 0;
    const lat = busy ? 41.9 + r() * 0.5 : r() * 170 - 85;
    const lon = busy ? 12.5 + r() * 0.5 : r() * 350 - 175;
    const start = busy ? PRESENT_YEAR - r() * 3000 : PRESENT_YEAR - 10 ** (r() * 9.5);
    const t = i % 5 === 0 ? span(start, null) : i % 5 === 1 ? span(start, start + r() * 200) : span(start, start);
    out.push(feature(`f${i}`, kinds[i % kinds.length], lat, lon, t, 1 + (i % 7)));
  }
  return out;
}

const prominenceBy = (id: string) => (id.length * 7) % 10;
const identity: Quat = [1, 0, 0, 0];
/** A camera straight above a place; a `dist` of zero is as close as the globe goes. */
const view = (lat: number, lon: number, t: number, dist: number, rotation: (p: number) => Quat = () => identity): FeatureView => {
  const c = Math.cos((lat * Math.PI) / 180);
  const sees = dist ? (Math.acos(1 / dist) * 180) / Math.PI : 8;
  return { t, halo: 1, dir: [c * Math.cos((lon * Math.PI) / 180), c * Math.sin((lon * Math.PI) / 180), Math.sin((lat * Math.PI) / 180)], sees, footprint: dist ? sees : 0, rotation, placed: () => true };
};

describe('the time tree', () => {
  it('splits time into leaves that double going away from the present', () => {
    expect(binOf(PRESENT_YEAR - 1)).toBe(BINS_EACH_WAY - 1);
    expect(binOf(PRESENT_YEAR)).toBe(BINS_EACH_WAY);
    expect(binOf(PRESENT_YEAR - 3)).toBe(BINS_EACH_WAY - 2);
    expect(binOf(PRESENT_YEAR - 4)).toBe(BINS_EACH_WAY - 3);
    expect(binOf(-Infinity)).toBe(0);
    expect(binOf(Infinity)).toBe(BINS_EACH_WAY * 2 - 1);
    for (let a = 1; a < 1e10; a *= 3) expect(binOf(PRESENT_YEAR - a)).toBeLessThanOrEqual(binOf(PRESENT_YEAR - a / 2));
  });

  it('names a node by the smallest span that holds a life, and knows what it covers', () => {
    for (const [a, b] of [[0, 0], [33, 34], [10, 12], [67, 67], [0, 67], [50, 51]]) {
      const { node, bins } = timeNodeOf(a, b);
      expect(bins[0]).toBeLessThanOrEqual(a);
      expect(bins[1]).toBeGreaterThanOrEqual(b);
      expect(binsOfNode(node)).toEqual(bins);
    }
    expect(timeNodeOf(33, 34).node).toBe(1);
  });

  it('reads a life from every scenario, and an open end as open', () => {
    const f = feature('x', 'settlement', 0, 0, span(100, 200));
    expect(lifeOf(f)).toEqual([100, 200]);
    expect(lifeOf({ ...f, variants: { alt: span(50, 150), other: span(120, 300) } })).toEqual([50, 300]);
    expect(lifeOf({ ...f, time: span(100, null) })[1]).toBe(Infinity);
  });
});

describe('prominence', () => {
  it('is the score of its kind or its nearest parent, and what its size adds', () => {
    expect(kindScore(rule, 'landform/impact-crater')).toEqual({ domain: 'earth', score: 6 });
    expect(kindScore(rule, 'nothing')).toBeUndefined();
    const claim = (prop: string, value: unknown, rank = 'normal') => ({ prop, value, rank }) as never;
    expect(prominenceOf(rule, { kind: 'settlement', claims: [] })).toBe(6);
    expect(prominenceOf(rule, { kind: 'settlement', claims: [claim('population', 20000)] })).toBe(7);
    expect(prominenceOf(rule, { kind: 'settlement', claims: [claim('population', { lo: 5e5, hi: 2e6 }), claim('population', 100)] })).toBe(9);
    expect(prominenceOf(rule, { kind: 'settlement', claims: [claim('population', 2e6, 'deprecated')] })).toBe(6);
    // How much has been written about it does not count.
    expect(prominenceOf(rule, { kind: 'settlement', claims: Array.from({ length: 50 }, () => claim('name', { en: 'x' })) })).toBe(6);
  });
});

describe('feature tiles', () => {
  const all = world(3000);
  const { index, files } = tileFeatures(all, rule, (f) => prominenceBy(f.id));

  it('stores every feature once, in the tile the index says, without its variants', () => {
    const seen = new Map<string, number>();
    index.tiles.forEach((r, i) => {
      const rows = JSON.parse(files.get(featureTileUrl(r))!) as Feature[];
      expect(rows).toHaveLength(r.n);
      for (const f of rows) {
        expect(seen.has(f.id)).toBe(false);
        seen.set(f.id, i);
        expect(index.where[f.id]).toBe(i);
        expect(f.variants).toBeUndefined();
      }
    });
    expect(seen.size).toBe(all.length);
  });

  it('keeps every cell within its budget, and the time node holds its whole life', () => {
    for (const r of index.tiles) expect(r.n).toBeLessThanOrEqual(rule.budget);
    for (const f of all) {
      const r = index.tiles[index.where[f.id]];
      const [lo, hi] = binsOfNode(r.t);
      const [a, b] = lifeOf(f);
      expect(lo).toBeLessThanOrEqual(binOf(a));
      expect(hi).toBeGreaterThanOrEqual(binOf(b));
    }
  });

  it('is the same whatever order it is given', () => {
    const again = tileFeatures([...all].reverse(), rule, (f) => prominenceBy(f.id));
    expect(again.index).toEqual(index);
    expect([...again.files.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [k, v] of files) expect(again.files.get(k)).toBe(v);
  });

  it('keeps the most prominent high up, and a reserve for every domain', () => {
    const p = (id: string) => (id.startsWith('big') ? 9 : id.startsWith('mid') ? 5 : 1);
    const crowd = [
      ...Array.from({ length: 20 }, (_, i) => feature(`big${i}`, 'event/impact', 10, 10, span(100, 100))),
      ...Array.from({ length: 20 }, (_, i) => feature(`mid${i}`, 'settlement', 10, 10, span(100, 100))),
      ...Array.from({ length: 3 }, (_, i) => feature(`low${i}`, 'occurrence', 10, 10, span(100, 100))),
    ];
    const t = tileFeatures(crowd, rule, (f) => p(f.id));
    const root = JSON.parse(t.files.get(featureTileUrl(t.index.tiles[0]))!) as Feature[];
    expect(root).toHaveLength(8);
    expect(root.filter((f) => f.id.startsWith('big'))).toHaveLength(6);
    expect(root.filter((f) => f.id.startsWith('mid'))).toHaveLength(1);
    expect(root.filter((f) => f.id.startsWith('low'))).toHaveLength(1);
  });

  it('keeps what stands on one spot, past its deepest level', () => {
    const pile = Array.from({ length: 500 }, (_, i) => feature(`p${i}`, 'occurrence', 1, 1, span(100, 100)));
    const t = tileFeatures(pile, rule, (f) => prominenceBy(f.id));
    expect(Object.keys(t.index.where)).toHaveLength(500);
  });

  it('leaves out what a site draws, and keeps a thing that moved in the root cell', () => {
    const moved: Feature = { ...feature('stone', 'artefact', 40, 40, span(100, null)), moves: [{ label: 'a', location: { lat: 1, lon: 1 }, time: span(100, 200), variants: { alt: span(90, 200) } }] };
    const t = tileFeatures([feature('temple', 'building/temple', 41, 12, span(100, 200)), moved, ...all.slice(0, 500)], rule, (f) => prominenceBy(f.id));
    expect(t.index.where.temple).toBeUndefined();
    const ref = t.index.tiles[t.index.where.stone];
    expect(ref.q).toBe('');
    // A move's dates under other pictures are kept apart too, and go back on its row when they come.
    const row = (JSON.parse(t.files.get(featureTileUrl(ref))!) as Feature[]).find((f) => f.id === 'stone')!;
    expect(row.moves![0].variants).toBeUndefined();
    withVariants(row, (JSON.parse(t.files.get(FEATURE_VARIANTS)!) as Record<string, FeatureVariants>).stone);
    expect(row.moves![0].variants).toEqual(JSON.parse(JSON.stringify({ alt: span(90, 200) })));
  });

  it('finds a feature whenever it is alive and the camera is near it', () => {
    for (const f of all.filter((_, i) => i % 7 === 0)) {
      const t = f.time.start.best!;
      const found = tilesFor(index, view(f.location.lat, f.location.lon, t, 0)).map(featureTileUrl);
      expect(found).toContain(featureTileUrl(index.tiles[index.where[f.id]]));
    }
  });

  it('finds it where its plate has carried it, not where it is today', () => {
    // A half-turn about the north pole: everything on plate 3 is on the far side of the globe.
    const half: Quat = [0, 0, 0, 1];
    const rotation = (p: number) => (p === 3 ? half : identity);
    const f = all.find((x) => x.plate === 3 && x.location.lat > 30 && x.location.lat < 50 && index.tiles[index.where[x.id]].q.length > 0)!;
    const t = f.time.start.best!;
    const url = featureTileUrl(index.tiles[index.where[f.id]]);
    const seen = tilesFor(index, view(f.location.lat, f.location.lon + 180, t, 0, rotation)).map(featureTileUrl);
    expect(seen).toContain(url);
  });

  it('finds what rides a plate the frames do not place where it is today, as a placeholder (docs/STRUCTURE.md section 5)', () => {
    // The same half-turn, but the frames do not reach plate 3 at this time: its things stay where they are today.
    const half: Quat = [0, 0, 0, 1];
    const f = all.find((x) => x.plate === 3 && x.location.lat > 30 && x.location.lat < 50 && index.tiles[index.where[x.id]].q.length > 0)!;
    const t = f.time.start.best!;
    const url = featureTileUrl(index.tiles[index.where[f.id]]);
    const v = { ...view(f.location.lat, f.location.lon, t, 0, (p: number) => (p === 3 ? half : identity)), placed: (p: number) => p !== 3 };
    expect(tilesFor(index, v).map(featureTileUrl)).toContain(url);
  });

  it('past the markers a screen can hold, keeps the most prominent, and what must stay', () => {
    const placed = ['a', 'b', 'c', 'd'].map((id, i) => ({ f: { id, prominence: i } }));
    expect(mostProminent(placed, 9, () => false)).toHaveLength(4);
    expect(mostProminent(placed, 2, () => false).map((m) => m.f.id)).toEqual(['c', 'd']);
    expect(mostProminent(placed, 2, (id) => id === 'a').map((m) => m.f.id)).toEqual(['a', 'd']);
  });

  it('from afar, needs few tiles and few features, however many the world has', () => {
    const big = tileFeatures(world(100_000), { ...rule, budget: 32 }, (f) => prominenceBy(f.id));
    const largest = Math.max(...[...big.files].filter(([k]) => !k.endsWith('index.json') && !k.endsWith('variants.json')).map(([, v]) => v.length));
    expect(largest).toBeLessThan(25 * 1024 * 1024);
    const tiles = tilesFor(big.index, view(40, 10, PRESENT_YEAR - 1900, 3.3));
    const rows = tiles.reduce((n, r) => n + r.n, 0);
    expect(rows).toBeLessThan(1500);
    expect(rows).toBeLessThan(100_000 / 50);
    // One file per cell, and far fewer than the 20,000 a deployment may hold, at a hundred thousand.
    expect(big.index.tiles.length).toBeLessThan(20_000);
  }, 120_000);
});
