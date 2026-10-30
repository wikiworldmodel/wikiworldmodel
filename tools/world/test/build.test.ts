// Pass criteria: building twice gives byte-identical output, and the tile set is complete.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeTile } from '../../../core/container.ts';
import { fromMa, PRESENT_YEAR, toMa } from '../../../core/time.ts';
import type { TileHeader, Tileset } from '../../../core/tileset.ts';
import type { CoverageFile, EntityRecord, PeriodsFile, SearchFile, SeriesFile } from '../../../core/records.ts';
import { GENERATOR, generateClouds, type CloudParams } from '../../../world/generators/earth/clouds/v1.ts';
import { runBuild } from '../src/build/index.ts';
import { latestBuild } from './helpers.ts';

/** A file's bytes as an ArrayBuffer of their own (small files share Node's buffer pool). */
function bytes(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function digest(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p), createHash('sha256').update(readFileSync(p)).digest('hex'));
    }
  };
  walk(dir);
  return out;
}

describe('build', () => {
  it('is reproducible: two builds are byte-identical', async () => {
    const quiet = console.log;
    console.log = () => {};
    try {
      expect(await runBuild([])).toBe(0);
      const first = latestBuild();
      const a = digest(first);
      expect(await runBuild([])).toBe(0);
      const second = latestBuild();
      expect(second).toBe(first);
      expect(digest(second)).toEqual(a);
    } finally {
      console.log = quiet;
    }
  });

  it('has, in every tile, the keyframes that bracket every moment of its span', () => {
    const dir = latestBuild();
    const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
    for (const ref of ts.tiles) {
      const { header, arrays } = decodeTile<TileHeader>(bytes(join(dir, ref.url)));
      // A span no field covers has only the coarse tile, for its features.
      const covering = ts.fields.find((f) => f.coverage[0] < ref.time[1] && f.coverage[1] > ref.time[0]);
      expect(header.field?.id).toBe(covering?.id);
      if (!header.field) {
        expect(ref.lod).toBe(0);
        continue;
      }
      const keys = covering!.keyframesMa;
      const ages = header.field.keyframes.map((k) => k.ageMa);
      // The nearest keyframe at or before the span's start, and at or after its end (none
      // after the youngest: a projection holds it).
      const older = keys.filter((k) => fromMa(k) <= ref.time[0])[0];
      const younger = keys.filter((k) => fromMa(k) >= ref.time[1]).at(-1);
      expect(ages).toContain(older);
      if (younger !== undefined) expect(ages).toContain(younger);
      const n = header.field.grid.nx * header.field.grid.ny;
      for (const k of header.field.keyframes) {
        expect(arrays[k.elev].length).toBe(n);
        expect(arrays[k.plate].length).toBe(n);
      }
      if (ref.parent) {
        const parent = ts.tiles.find((t) => t.id === ref.parent)!;
        expect(parent.time[0]).toBeLessThanOrEqual(ref.time[0]);
        expect(parent.time[1]).toBeGreaterThanOrEqual(ref.time[1]);
      }
    }
    const lod0 = ts.tiles.filter((t) => t.lod === 0).sort((a, b) => a.time[0] - b.time[0]);
    expect(lod0[0].time[0]).toBe(ts.timeRange[0]);
    expect(lod0.at(-1)!.time[1]).toBe(ts.timeRange[1]);
    for (let i = 1; i < lod0.length; i++) expect(lod0[i].time[0]).toBe(lod0[i - 1].time[1]);
  });

  it('records generator output that the generator reproduces', () => {
    const dir = latestBuild();
    const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
    const { header } = decodeTile<TileHeader>(bytes(join(dir, ts.tiles[0].url)));
    const g = header.generators.find((x) => x.generator === GENERATOR)!;
    expect([g.slot, g.seed]).toEqual(['globe', 'earth/clouds']);
    const out = generateClouds(g.seed, g.params as unknown as CloudParams);
    expect(createHash('sha256').update(out).digest('hex')).toBe(g.outputSha256);
  });

  it('records what it was made from: commit, datasets, generators, alternatives shown, license filter', () => {
    const b = JSON.parse(readFileSync(join(latestBuild(), 'build.json'), 'utf8'));
    expect(Object.keys(b.datasets)).toEqual(['src:foster-2017-co2', 'src:paleodem-v2', 'src:paleomap-plate-model', 'src:vandermeer-2022-sea-level']);
    expect(b.generators['gen:earth/clouds']).toEqual({ version: 1, seeds: { globe: 'earth/clouds' } });
    expect(b.alternatives).toEqual({ shown: ['alt:earliest-life/isua-stromatolites', 'alt:time-scale/pbdb-2022'], default: { 'alt:earliest-life': null, 'alt:time-scale': null } });
    expect(b.licenses.allowed).toContain('CC-BY-4.0');
    expect(b.data.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('derives inverse relations instead of storing them', () => {
    const rec = (id: string) => JSON.parse(readFileSync(join(latestBuild(), 'records', `${id}.json`), 'utf8')) as EntityRecord;
    expect(rec('earth/events/chicxulub-impact').inverse).toEqual([
      expect.objectContaining({ rel: 'caused', from: 'earth/events/kpg-extinction', via: 'earth/events/kpg-extinction#caused-by-chicxulub' }),
      expect.objectContaining({ rel: 'caused', from: 'earth/structures/chicxulub-crater', via: 'earth/structures/chicxulub-crater#formed-by' }),
    ]);
    expect(rec('earth/lips/deccan-traps').inverse).toEqual([expect.objectContaining({ rel: 'contains', from: 'earth/events/chicxulub-impact' })]);
    expect(rec('earth/plates/africa').inverse.map((x) => x.from)).toEqual(['life/mesosaurus/calvinia', 'life/mesosaurus/kabus']);
  });

  it('writes a coverage map: unsourced claims, wanted records, basis by tile', () => {
    const c = JSON.parse(readFileSync(join(latestBuild(), 'coverage.json'), 'utf8')) as CoverageFile;
    expect(c.wanted).toEqual([]);
    expect(c.claims.unsourced).toContain('earth/orogens/himalaya#location');
    // Coarse tiles over the whole span; fine ones over the fields' spans.
    const ts = JSON.parse(readFileSync(join(latestBuild(), 'tileset.json'), 'utf8')) as Tileset;
    expect(c.tiles).toHaveLength(ts.tiles.length);
    expect(ts.tiles.filter((t) => t.lod === 0).length).toBe(ts.lods[0].binsMa.length);
    // The Mesosaurus localities are counted in the coarse tile of the Artinskian, placed by reconstruction.
    const artinskian = c.tiles.find((t) => t.tile.startsWith('0/') && t.time[0] <= fromMa(285) && fromMa(285) <= t.time[1])!;
    expect(artinskian.features.reconstruction).toBeGreaterThanOrEqual(4);
  });

  it('spans the world: from the Hadean to the furthest projection', () => {
    const dir = latestBuild();
    const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
    const { periods } = JSON.parse(readFileSync(join(dir, 'periods.json'), 'utf8')) as PeriodsFile;
    const eons = periods.filter((p) => p.rank === 'eon').map((p) => [p.name, toMa(p.start)]);
    expect(eons).toEqual([['Hadean', 4600], ['Archean', 4000], ['Proterozoic', 2500], ['Phanerozoic', 541]]);
    expect(toMa(ts.timeRange[0])).toBe(4600);
    expect(ts.timeRange[1]).toBeGreaterThan(PRESENT_YEAR + 1e9);
  });

  it('covers each time with one field at most: elevation held into the near future, the plate model\'s blocks before it', () => {
    const ts = JSON.parse(readFileSync(join(latestBuild(), 'tileset.json'), 'utf8')) as Tileset;
    const [elevation, blocks] = ts.fields;
    expect([elevation.id, elevation.mode, blocks.id, blocks.mode]).toEqual(['field:earth/elevation', 'elevation', 'field:earth/continental-blocks', 'blocks']);
    expect(elevation.coverage.map(toMa)).toEqual([540, -0.01]);
    expect(elevation.projection).toMatchObject({ method: 'hold', until: PRESENT_YEAR + 1e4 });
    expect(blocks.coverage.map(toMa)).toEqual([1100, 540]);
    expect(blocks.keyframesMa[0]).toBe(540);
  });

  it('computes the Sun\'s brightness from its rule, as a projection after the present', () => {
    const { series } = JSON.parse(readFileSync(join(latestBuild(), 'series.json'), 'utf8')) as SeriesFile;
    const sun = series.find((x) => x.id === 'field:sun/luminosity')!;
    const at = (t: number) => sun.points.find((p) => p[0] === t)?.[1];
    expect(at(PRESENT_YEAR)).toBe(1);
    expect(sun.points[0]).toEqual([fromMa(4300), expect.closeTo(1 / (1 + 0.4 * (4.3 / 4.567)), 5), null, null]);
    expect(sun.points.at(-1)![1]).toBeCloseTo(1 / (1 + 0.4 * (1 - 9.567 / 4.567)), 4);
    expect(sun.projectedAfter).toBe(PRESENT_YEAR);
    expect(sun.rule).toEqual({ name: 'gough-1981', params: { sun_age: '4.567 Gyr' } });
  });

  it('reads series from their datasets\' tables, value and band, oldest first', () => {
    const { series } = JSON.parse(readFileSync(join(latestBuild(), 'series.json'), 'utf8')) as SeriesFile;
    const by = (id: string) => series.find((x) => x.id === id)!;
    const temperature = by('field:earth/surface-temperature');
    expect(temperature.points).toHaveLength(541);
    expect(temperature.points.at(-1)).toEqual([PRESENT_YEAR, 14.5, expect.closeTo(13.7929, 4), expect.closeTo(15.2071, 4)]);
    const co2 = by('field:earth/co2');
    expect(co2.points).toHaveLength(840);
    expect(co2.points[0][0]).toBe(Math.round(fromMa(419.5039)));
    expect(co2.band).toBe('68% interval');
    for (const [t, v, lo, hi] of [...co2.points, ...by('field:earth/sea-level').points]) {
      expect(t).toBeLessThanOrEqual(PRESENT_YEAR);
      expect(lo! <= hi!).toBe(true);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('shows a taxon at its first appearance where no claim pins its origin, and unknown where nothing limits it', () => {
    const { entities } = JSON.parse(readFileSync(join(latestBuild(), 'search.json'), 'utf8')) as SearchFile;
    const start = (id: string) => entities.find((e) => e.id === id)!.time.start;
    // Dinosaurs: no molecular date; their oldest fossil, dated by its stage, sets the origin.
    expect(start('life/taxa/dinosauria').best).toBe(start('life/occurrences/buriolestes-buriol').best);
    expect(start('life/taxa/dinosauria').derived).toBe(true);
    // Archaea: only "younger than 3.4 Ga" and no fossil, so no best estimate, only the bound.
    expect(start('life/taxa/archaea').best).toBeNull();
    expect(toMa(start('life/taxa/archaea').lo)).toBe(3400);
    // A molecular date that pins an origin is shown at its centre.
    expect(toMa(start('life/taxa/cellular-organisms').best!)).toBeCloseTo(4210, 6);
  });

  it('shows a moment at the one-sided evidence that bounds it, where that is tighter than its date', () => {
    const { entities } = JSON.parse(readFileSync(join(latestBuild(), 'search.json'), 'utf8')) as SearchFile;
    const start = (id: string) => entities.find((e) => e.id === id)!.time.start;
    // Dickinsonia: in the Ediacaran (635–541 Ma), and below an ash bed of 555.3 Ma.
    expect(toMa(start('life/occurrences/dickinsonia-zimnie-gory').best!)).toBeCloseTo(555.3, 6);
    // The India–Asia collision: its preferred date is tighter than its one-sided bound.
    expect(toMa(start('earth/events/india-asia-collision').best!)).toBeCloseTo(59, 6);
  });
});
