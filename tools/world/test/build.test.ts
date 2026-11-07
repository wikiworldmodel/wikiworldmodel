// Pass criteria: the tile set is complete, and holds what the world says. They read the build that
// `npm run build:world` made; that building it again gives the same bytes is reproducible.test.ts.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeTile } from '../../../core/container.ts';
import { bytesPrint, fingerprintProblems } from '../../../core/fingerprint.ts';
import { fromMa, PRESENT_YEAR, toMa } from '../../../core/time.ts';
import { featureTileUrl, type FeatureIndex } from '../../../core/featuretiles.ts';
import { cityKind, type Feature, type FramesFile, type TileHeader, type Tileset } from '../../../core/tileset.ts';
import { PLATE_OFFSET, PlateModels, RotationModel } from '../../../core/rotation-model.ts';
import type { IceHeader } from '../../../core/ice.ts';
import { chosenClaim, type PlanetFile } from '../../../core/planet.ts';
import { peopleAt, type PeopleFile, type PeopleHeader } from '../../../core/layers.ts';
import { territoriesAt, type TerritoryFile } from '../../../core/territory.ts';
import type { CoverageFile, EntityRecord, PeriodsFile, SearchFile, SeriesFile } from '../../../core/records.ts';
import { decodeRuns } from '../../../core/coverage.ts';
import { seaLevelAt } from '../../../core/sealevel.ts';
import { LAYERS, TIERS } from '../../../core/resolve.ts';
import { GENERATOR, generateClouds, type CloudParams } from '../../../world/generators/earth/clouds/v1.ts';
import { GENERATOR as SURFACE, generateSurface, type SurfaceParams } from '../../../world/generators/earth/surface/v1.ts';
import { GENERATOR as GENERIC_LAND, generateGenericLand, type GenericLandParams } from '../../../world/generators/earth/generic-land/v1.ts';
import { latestBuild } from './helpers.ts';

/** A file's bytes as an ArrayBuffer of their own (small files share Node's buffer pool). */
function bytes(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

describe('build', () => {
  it('has, in every tile, the keyframes that bracket every moment of its span', () => {
    const dir = latestBuild();
    const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
    for (const ref of ts.tiles) {
      const { header, arrays } = decodeTile<TileHeader>(bytes(join(dir, ref.url)));
      // A span no field covers has only the coarse tile, for its generator constraints.
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
      // A field of one moment, held over the times it covers, has that keyframe for all of them.
      const older = keys.filter((k) => fromMa(k) <= ref.time[0])[0] ?? keys.at(-1);
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

  it('answers every layer everywhere in a tier, and draws generic land only where no map covers the time', () => {
    const c = JSON.parse(readFileSync(join(latestBuild(), 'coverage.json'), 'utf8')) as CoverageFile;
    const spans = Object.fromEntries((c.tiers ?? []).map((s) => [s.span, s.layers]));
    expect(Object.keys(spans).length).toBe(8);
    // A grid of 10° cells at eight times through each span: every answer has a tier.
    for (const [span, layers] of Object.entries(spans)) {
      for (const [layer, counts] of Object.entries(layers)) expect(Object.values(counts).reduce((a, b) => a + b, 0), `${layer} in ${span}`).toBe(648 * 8);
    }
    expect(spans['4600–1000 Ma'].geography.generic).toBeGreaterThan(0);
    expect(spans['100–10 Ma'].geography).toEqual({ evidence: 0, model: 648 * 8, generic: 0, unknown: 0 });
    // The land's life is recorded somewhere in the Phanerozoic, and nowhere before it.
    expect(spans['100–10 Ma'].life.evidence).toBeGreaterThan(0);
    expect(spans['4600–1000 Ma'].life.evidence).toBe(0);
  });

  it('charts every layer in every column of the time scale, and what it says answers a layer does answer it', () => {
    const c = JSON.parse(readFileSync(join(latestBuild(), 'coverage.json'), 'utf8')) as CoverageFile;
    const m = c.matrix!;
    const ts = JSON.parse(readFileSync(join(latestBuild(), 'tileset.json'), 'utf8')) as Tileset;
    const places = (180 / m.step) * (360 / m.step);
    expect(m.layers.map((l) => l.layer)).toEqual([...LAYERS]);
    expect(m.columns[0][0]).toBe(ts.timeRange[0]);
    expect(m.columns.at(-1)![1]).toBe(ts.timeRange[1]);
    for (let i = 1; i < m.columns.length; i++) expect(m.columns[i][0]).toBe(m.columns[i - 1][1]);
    for (const { layer, cells } of m.layers) {
      expect(cells.length).toBe(m.columns.length);
      cells.forEach((cell, i) => {
        expect(cell.share.reduce((a, b) => a + b, 0), `${layer} in column ${i}`).toBeCloseTo(1, 3);
        expect(cell.why.reduce((a, [, x]) => a + x, 0), `${layer} in column ${i}`).toBeCloseTo(1, 3);
        expect(decodeRuns(cell.map).length).toBe(places);
      });
    }
    // Each thing the chart draws under a layer answers that layer in its tier, somewhere within its span.
    for (const s of m.sources) {
      expect(s.span.every(Number.isFinite), s.id).toBe(true);
      const inside = m.columns.map((col, i) => [col, i] as const).filter(([col]) => col[0] >= s.span[0] && col[1] <= s.span[1]);
      if (!inside.length) continue;
      const cells = m.layers.find((l) => l.layer === s.layer)!.cells;
      const k = TIERS.indexOf(s.tier);
      expect(Math.max(...inside.map(([, i]) => cells[i].share[k])), `${s.id} answers ${s.layer} in ${s.tier}`).toBeGreaterThan(0);
    }
    // Where a map covers the time, the land and sea are a model's everywhere.
    const k66 = m.columns.findIndex(([a, b]) => a <= fromMa(66) && fromMa(66) < b);
    expect(m.layers.find((l) => l.layer === 'geography')!.cells[k66].share[TIERS.indexOf('model')]).toBe(1);
  });

  it('records generic land that its generator reproduces, at its share of the planet', () => {
    const dir = latestBuild();
    const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
    const { header } = decodeTile<TileHeader>(bytes(join(dir, ts.tiles[0].url)));
    const g = header.generators.find((x) => x.generator === GENERIC_LAND)!;
    const p = g.params as unknown as GenericLandParams;
    const mask = generateGenericLand(g.seed, p);
    expect(fingerprintProblems(g.output, bytesPrint('pixels', mask))).toEqual([]);
    let land = 0;
    let total = 0;
    for (let j = 0; j < p.height; j++) {
      const area = Math.cos(Math.PI / 2 - ((j + 0.5) / p.height) * Math.PI);
      for (let i = 0; i < p.width; i++) {
        total += area;
        if (mask[j * p.width + i] > 128) land += area;
      }
    }
    expect(land / total).toBeCloseTo(p.land_share, 2);
  });

  it('records generator output that the generator reproduces', () => {
    const dir = latestBuild();
    const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
    const { header } = decodeTile<TileHeader>(bytes(join(dir, ts.tiles[0].url)));
    const g = header.generators.find((x) => x.generator === GENERATOR)!;
    expect([g.slot, g.seed]).toEqual(['globe', 'earth/clouds']);
    const out = generateClouds(g.seed, g.params as unknown as CloudParams);
    expect(fingerprintProblems(g.output, bytesPrint('pixels', out))).toEqual([]);
    const sg = header.generators.find((x) => x.generator === SURFACE)!;
    expect([sg.slot, sg.seed]).toEqual(['globe', 'earth/surface']);
    expect(fingerprintProblems(sg.output, bytesPrint('pixels', generateSurface(sg.seed, sg.params as unknown as SurfaceParams)))).toEqual([]);
  });

  it('records what it was made from: commit, datasets, generators, alternatives shown, license filter', () => {
    const b = JSON.parse(readFileSync(join(latestBuild(), 'build.json'), 'utf8'));
    expect(Object.keys(b.datasets)).toEqual([
      'src:ar6-wg1-fig2-4',
      'src:beyer-2020-late-quaternary',
      'src:cao-2024-plate-model',
      'src:cliopatria-0.2.1',
      'src:etopo-2022-60s',
      'src:etopo-2022-n45e000',
      'src:etopo-2022-n45e015',
      'src:foster-2017-co2',
      'src:glottolog-5.3',
      'src:hyde-3.2.1-population-grid',
      'src:hyde-3.2.1-world-land-use',
      'src:hyde-3.2.1-world-population',
      'src:itinere-2024',
      'src:jouzel-2007-epica-dome-c',
      'src:li-2022-phanerozoic-climate',
      'src:natural-earth-boundaries-5.1.2',
      'src:natural-earth-lakes-5.1.2',
      'src:natural-earth-ocean-5.1.2',
      'src:natural-earth-places-5.1.2',
      'src:noaa-hazards-2026-11-04',
      'src:ohm-rome-2026-11-01',
      'src:paleodem-v2',
      'src:paleomap-plate-model',
      'src:paleomist-1.0',
      'src:pbdb-diversity-2026-11-04',
      'src:pbdb-hell-creek-2026-11-04',
      'src:pbdb-land-2026-11-05',
      'src:pbdb-sea-2026-11-06',
      'src:spratt-lisiecki-2016-sea-level',
      'src:srtm-gl1-n41e012',
      'src:srtm-gl1-n42e012',
      'src:tinitaly-1.1-w46075',
      'src:vandermeer-2022-sea-level',
    ]);
    expect(b.generators['gen:earth/clouds']).toEqual({ version: 1, seeds: { globe: 'earth/clouds' } });
    expect(b.generators['gen:earth/surface']).toEqual({ version: 1, seeds: { globe: 'earth/surface' } });
    expect(b.alternatives.shown).toEqual(expect.arrayContaining(['alt:earliest-life/isua-stromatolites', 'alt:time-scale/pbdb-2022', 'alt:peopling-of-the-americas/pre-lgm', 'alt:ipcc-ar6-scenarios/ssp585']));
    // No alternative is anyone's default: that is a person's decision.
    expect(new Set(Object.values(b.alternatives.default))).toEqual(new Set([null]));
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
    expect(rec('earth/plates/africa').inverse.map((x) => x.from)).toEqual(expect.arrayContaining(['life/mesosaurus/calvinia', 'life/mesosaurus/kabus']));
  });

  it('tiles the markers apart from the terrain: each once, by time, place and prominence', () => {
    const dir = latestBuild();
    const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
    const index = JSON.parse(readFileSync(join(dir, ts.files.features), 'utf8')) as FeatureIndex;
    const seen = new Map<string, Feature>();
    for (const r of index.tiles) {
      const rows = JSON.parse(readFileSync(join(dir, featureTileUrl(r)), 'utf8')) as Feature[];
      expect(rows.filter((f) => !f.moves).length).toBeLessThanOrEqual(32);
      for (const f of rows) {
        expect(seen.has(f.id)).toBe(false);
        seen.set(f.id, f);
        expect(f.variants).toBeUndefined();
        expect(typeof f.prominence).toBe('number');
      }
    }
    expect(Object.keys(index.where).sort()).toEqual([...seen.keys()].sort());
    // The terrain tiles carry none, and what a site draws is not on the globe.
    const { header } = decodeTile<TileHeader>(bytes(join(dir, ts.tiles[0].url)));
    expect('features' in header).toBe(false);
    expect([...seen.values()].filter((f) => cityKind(f.kind))).toEqual([]);
    // An impact outranks a fossil, and a measured size adds to a kind's score.
    const of = (end: string) => [...seen.values()].find((f) => f.id.endsWith(end))!.prominence!;
    expect(of('chicxulub-impact')).toBeGreaterThan(of('homo-sapiens-jebel-irhoud'));
    expect(of('lips/deccan-traps')).toBeGreaterThan(8);
    // Dates under other pictures are kept apart, for those who ask.
    const variants = JSON.parse(readFileSync(join(dir, 'features/variants.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(variants).length).toBeGreaterThan(0);
    for (const id of Object.keys(variants)) expect(seen.has(id)).toBe(true);
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

  it('prefers at each time the finest field that covers it: today\'s relief through the glacial cycles, elevation held into the near future, the plate models\' blocks before it', () => {
    const ts = JSON.parse(readFileSync(join(latestBuild(), 'tileset.json'), 'utf8')) as Tileset;
    const [relief, elevation, blocks, deep] = ts.fields;
    expect([relief.id, relief.mode, elevation.id, elevation.mode, blocks.id, blocks.mode, deep.id, deep.mode]).toEqual(['field:earth/relief', 'elevation', 'field:earth/elevation', 'elevation', 'field:earth/continental-blocks', 'blocks', 'field:earth/continental-blocks-deep', 'blocks']);
    expect(deep.coverage.map(toMa)).toEqual([1800, 1100]);
    expect(deep.keyframesMa[0]).toBe(1100);
    expect(relief.coverage.map(toMa)).toEqual([0.798, -0.01]);
    expect(relief.keyframesMa).toEqual([0]);
    expect([relief.res_deg, relief.coastline?.isolineM, relief.coastline?.seaLevel]).toEqual([0.1, 0, 'field:earth/sea-level-stack']);
    expect(elevation.coverage.map(toMa)).toEqual([540, -0.01]);
    expect(elevation.projection).toMatchObject({ method: 'hold', until: PRESENT_YEAR + 1e4 });
    expect(blocks.coverage.map(toMa)).toEqual([1100, 540]);
    expect(blocks.keyframesMa[0]).toBe(540);
  });

  describe('the coastline of the glacial cycles', () => {
    const dir = () => latestBuild();
    const series = () => (JSON.parse(readFileSync(join(dir(), 'series.json'), 'utf8')) as SeriesFile).series;
    const stack = () => series().find((x) => x.id === 'field:earth/sea-level-stack')!;
    const lgm = () => JSON.parse(readFileSync(join(dir(), 'records/earth/ice-ages/last-glacial-maximum.json'), 'utf8')) as EntityRecord;
    /** Today's ground at a place, as the finest tiles of the relief carry it: in today's coordinates, which the plates move little in this span. */
    const ground = (lat: number, lon: number): number => {
      const ts = JSON.parse(readFileSync(join(dir(), 'tileset.json'), 'utf8')) as Tileset;
      const ref = ts.tiles.find((r) => r.lod === 3 && r.time[1] === PRESENT_YEAR && lon >= r.bbox[0] && lon < r.bbox[2] && lat >= r.bbox[1] && lat < r.bbox[3])!;
      const { header, arrays } = decodeTile<TileHeader>(bytes(join(dir(), ref.url)));
      expect(header.field?.id).toBe('field:earth/relief');
      const g = header.field!.grid;
      return arrays[header.field!.keyframes[0].elev][Math.round((g.lat0 - lat) / g.step) * g.nx + Math.round((lon - g.lon0) / g.step)];
    };

    it('draws the land bridges of the Last Glacial Maximum, and parts them today', () => {
      // The middle of the Last Glacial Maximum, as the world dates it, and the sea level the stack gives then.
      const t = (lgm().time.start.best! + lgm().time.end.best!) / 2;
      const low = seaLevelAt(stack().points, t);
      expect(low).toBeLessThan(-100);
      // Beringia, which the first Americans crossed; Doggerland; the Sunda Shelf; and the Torres Strait, which joined
      // New Guinea to Australia in Sahul. Each is sea today and dry land at the lowstand.
      for (const [name, lat, lon] of [['Bering Strait', 65.9, -169], ['Dogger Bank', 54.7, 2.5], ['Java Sea', -5, 110], ['Torres Strait', -10, 142.5]] as const) {
        const z = ground(lat, lon);
        expect(z, `${name} today`).toBeLessThan(0);
        expect(z, `${name} at the Last Glacial Maximum`).toBeGreaterThan(low);
      }
      // The Strait of Gibraltar stays open: the Mediterranean was never cut off in these cycles.
      expect(ground(35.95, -5.6)).toBeLessThan(low);
      // Ground below sea level that the ocean does not reach stays dry at every sea level the stack gives.
      const highest = Math.max(...stack().points.map((p) => p[1]));
      for (const [name, lat, lon] of [['the Qattara Depression', 29.5, 27], ['the Turfan Depression', 42.7, 89.3], ['the Caspian lowland', 46.5, 49]] as const) expect(ground(lat, lon), name).toBeGreaterThan(Math.max(highest, 0));
    });

    it('keeps the sea of the Last Glacial Maximum within what the world\'s claims give for it', () => {
      const claims = lgm().claims.filter((c) => c.prop === 'sea_level');
      expect(claims.length).toBeGreaterThan(2);
      // The stack's lowest within the span the world gives the LGM is within the range of the claim the world prefers.
      const { start, end } = lgm().time;
      const inside = stack().points.filter((p) => p[0] >= start.best! && p[0] <= end.best!);
      const lowest = Math.min(...inside.map((p) => p[1]));
      const preferred = claims.find((c) => c.chosen)!.value as { lo: number; hi: number };
      expect(lowest).toBeGreaterThanOrEqual(preferred.lo);
      expect(lowest).toBeLessThanOrEqual(preferred.hi);
      // And every claim dated within it falls in the stack's 95% band at its date.
      for (const c of claims.filter((x) => typeof x.valid === 'string')) {
        const t = PRESENT_YEAR - Number(/([\d.]+) ka/.exec(c.valid as string)![1]) * 1000;
        const row = stack().points.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a));
        const v = c.value as number | { lo: number; hi: number };
        const [lo, hi] = typeof v === 'number' ? [v, v] : [v.lo, v.hi];
        expect(hi, c.key).toBeGreaterThanOrEqual(row[2]!);
        expect(lo, c.key).toBeLessThanOrEqual(row[3]!);
      }
    });
  });

  it('moves each plate model\'s blocks with that model\'s own rotations, its plates kept apart from the first model\'s', () => {
    const dir = latestBuild();
    const frames = JSON.parse(readFileSync(join(dir, 'frames.json'), 'utf8')) as FramesFile;
    expect(frames.models?.map((m) => [m.source, m.offset])).toEqual([['src:cao-2024-plate-model', PLATE_OFFSET]]);
    const plates = new PlateModels(new RotationModel(frames.rotations), frames.models!.map((m) => ({ source: m.source, offset: m.offset, model: new RotationModel(m.rotations) })));
    const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
    const ref = ts.tiles.find((r) => r.lod === 0 && toMa(r.time[0]) >= 1800 - 1e-6 && toMa(r.time[1]) < 1800 && toMa(r.time[1]) >= 1100)!;
    const { header, arrays } = decodeTile<TileHeader>(bytes(join(dir, ref.url)));
    expect(header.field?.id).toBe('field:earth/continental-blocks-deep');
    const k = header.field!.keyframes.find((x) => x.ageMa === 1800)!;
    const used = new Set([...(arrays[k.plate] as Uint16Array)].filter((i) => i).map((i) => frames.plateIndex[i]));
    expect(used.size).toBeGreaterThan(20);
    // Every plate under a block at 1.8 Ga is the second model's, and that model says where it was then.
    for (const p of used) {
      expect(p).toBeGreaterThanOrEqual(PLATE_OFFSET);
      expect(plates.reaches(p, 1800), `plate ${p}`).toBe(true);
    }
    // Some of the globe is inside a block: the cratons the model places at 1.8 Ga, far fewer than today's continents.
    const n = header.field!.grid.nx * header.field!.grid.ny;
    const inside = [...(arrays[k.elev] as Int16Array)].filter((v) => v > 0).length / n;
    expect(inside).toBeGreaterThan(0.05);
    expect(inside).toBeLessThan(0.4);
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

  it('reads the series of the last 800 kyr: ages from 2000 where the table counts so, and measured rows after 1950 as no projection', () => {
    const { series } = JSON.parse(readFileSync(join(latestBuild(), 'series.json'), 'utf8')) as SeriesFile;
    const by = (id: string) => series.find((x) => x.id === id)!;
    const co2 = by('field:earth/co2-ice-core');
    expect(co2.points).toHaveLength(1894);
    expect(co2.points[0]).toEqual([2000 - 805719, 207.3, null, null]);
    expect(co2.points.at(-1)).toEqual([2019, 409.9, null, null]);
    expect(co2.projectedAfter).toBeUndefined();
    expect(by('field:earth/methane-ice-core').points).toHaveLength(2268);
    expect(by('field:earth/antarctic-temperature').points).toHaveLength(5788);
    const sea = by('field:earth/sea-level-stack');
    // Its rows after 5 ka, which it says read too high, are outside the field's span.
    expect(sea.points).toHaveLength(794);
    expect(sea.points.at(-1)![0]).toBe(PRESENT_YEAR - 5000);
    expect(sea.refines).toBe('field:earth/sea-level');
    expect(co2.refines).toBe('field:earth/co2');
    expect(sea.points.find((p) => p[0] === PRESENT_YEAR - 24000)).toEqual([PRESENT_YEAR - 24000, -130, expect.closeTo(-134.67, 2), expect.closeTo(-113.97, 2)]);
  });

  it('shows a taxon at its first appearance where no claim pins its origin, and unknown where nothing limits it', () => {
    const { entities } = JSON.parse(readFileSync(join(latestBuild(), 'search.json'), 'utf8')) as SearchFile;
    const start = (id: string) => entities.find((e) => e.id === id)!.time.start;
    // Dinosaurs: no molecular date; their oldest fossil sets the origin, and that is at least as old as this one.
    expect(start('life/taxa/dinosauria').best).toBeLessThanOrEqual(start('life/occurrences/buriolestes-buriol').best!);
    expect(start('life/taxa/dinosauria').derived).toBe(true);
    // Archaea: only "younger than 3.4 Ga" and no fossil, so no best estimate, only the bound.
    expect(start('life/taxa/archaea').best).toBeNull();
    expect(toMa(start('life/taxa/archaea').lo)).toBe(3400);
    // A molecular date that pins an origin is shown at its centre.
    expect(toMa(start('life/taxa/cellular-organisms').best!)).toBeCloseTo(4210, 6);
  });

  describe('the ice sheets', () => {
    const series = () => (JSON.parse(readFileSync(join(latestBuild(), 'series.json'), 'utf8')) as SeriesFile).series;
    const ice = () => series().find((s) => s.id === 'field:earth/ice-sheet-sea-level')!;
    const valueAt = (s: SeriesFile['series'][number], ka: number) => {
      const t = 1950 - ka * 1e3;
      const i = s.points.findIndex((p) => p[0] >= t);
      const [a, b] = [s.points[i - 1] ?? s.points[i], s.points[i]];
      return a[0] === b[0] ? a[1] : a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
    };

    it('has a keyframe every 2.5 kyr and two scenarios, the second only where they differ in kind', () => {
      const dir = latestBuild();
      const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
      expect(ts.files.ice).toBe('ice.lwt');
      const { header, arrays } = decodeTile<IceHeader>(bytes(join(dir, 'ice.lwt')));
      expect(header.scenarios.map((s) => s.id)).toEqual(['maximal', 'minimal']);
      const ages = header.scenarios[0].keyframes.map((k) => k.ageMa);
      expect(ages).toHaveLength(33);
      expect(ages[0]).toBe(0);
      expect(ages.at(-1)).toBe(0.08);
      for (let i = 1; i < ages.length; i++) expect(ages[i] - ages[i - 1]).toBeCloseTo(0.0025, 9);
      expect(header.scenarios[1].keyframes.map((k) => k.ageMa)).toEqual(ages.filter((a) => a >= 0.0375 && a <= 0.055));
      const n = header.grid.nx * header.grid.ny;
      expect(arrays[header.plate].length).toBe(n);
      for (const k of header.scenarios.flatMap((s) => s.keyframes)) {
        expect(arrays[k.margin].length).toBe(n);
        expect(arrays[k.thickness].length).toBe(n);
      }
      // The whole of it stays small: no bigger than the climate field, near enough.
      expect(readFileSync(join(dir, 'ice.lwt')).length).toBeLessThan(6e6);
    });

    it('reads as the dataset\'s own sea-level column: the "Calculated ESL" of Gowan et al.\'s Supplementary Tables 1 and 2', () => {
      // Copied from those tables, in metres, for the keyframes where the shape of the curve turns.
      const minimal: Record<number, number> = { 80: -9.5, 60: -78.9, 42.5: -25.3, 20: -116.0, 12.5: -54.1, 5: -4.6 };
      const maximal: Record<number, number> = { 80: -9.4, 60: -78.9, 42.5: -36.3, 20: -116.4, 12.5: -54.2, 5: -4.6 };
      const s = ice();
      for (const [ka, m] of Object.entries(maximal)) expect(Math.abs(valueAt(s, Number(ka)) - m), `maximal at ${ka} ka`).toBeLessThan(1.5);
      const other = s.variants!['alt:laurentide-mis3/hudson-bay-ice-free'];
      for (const [ka, m] of Object.entries(minimal)) expect(Math.abs(other.find((x) => x[0] === 1950 - Number(ka) * 1e3)![1] - m), `minimal at ${ka} ka`).toBeLessThan(1.5);
      // At every keyframe the band runs between the two.
      s.points.forEach((p, i) => {
        expect(p[2]).toBe(Math.min(p[1], other[i][1]));
        expect(p[3]).toBe(Math.max(p[1], other[i][1]));
      });
      expect(s.points).toHaveLength(33);
      expect(s.rule?.params).toEqual({ ocean_area_km2: 361000000, ice_density: 910, water_density: 1000 });
      expect(s.band).toContain('two scenarios');
    });

    it('agrees with the sea-level stack in sign and rough size, and the disagreement is what the field says it is', () => {
      const stack = series().find((x) => x.id === 'field:earth/sea-level-stack')!;
      const s = ice();
      const other = s.variants!['alt:laurentide-mis3/hudson-bay-ice-free'];
      // Where both have a value: from the stack's youngest row, at 5 ka, to the dataset's oldest.
      const pairs = s.points.map((p, i) => ({ ka: (1950 - p[0]) / 1e3, ice: p[1], other: other[i][1] })).filter((p) => p.ka >= 5 && p.ka <= 80).map((p) => ({ ...p, stack: valueAt(stack, p.ka) }));
      expect(pairs).toHaveLength(31);
      // Below today's at every keyframe, both of them, but for the 5 ka the stack is scaled to: 0 m there.
      for (const p of pairs) {
        expect(p.ice, `ice at ${p.ka} ka`).toBeLessThan(0);
        if (p.ka === 5) expect(p.stack).toBe(0);
        else expect(p.stack, `stack at ${p.ka} ka`).toBeLessThan(0);
      }
      // They rise and fall together, on the whole.
      const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
      const [a, b] = [pairs.map((p) => p.ice), pairs.map((p) => p.stack)];
      const [ma, mb] = [mean(a), mean(b)];
      const r = a.reduce((sum, x, i) => sum + (x - ma) * (b[i] - mb), 0) / Math.sqrt(a.reduce((sum, x) => sum + (x - ma) ** 2, 0) * b.reduce((sum, x) => sum + (x - mb) ** 2, 0));
      expect(r).toBeGreaterThan(0.8);
      // From 20 ka to 5 ka, to within about 6 m.
      for (const p of pairs.filter((x) => x.ka <= 20)) expect(Math.abs(p.ice - p.stack), `at ${p.ka} ka`).toBeLessThan(6.5);
      // Their lowest: about −116 m at 20 ka here, and −130 m at 24 ka in the stack: the 14 m the field says.
      const lowest = s.points.reduce((x, y) => (y[1] < x[1] ? y : x));
      expect(lowest[0]).toBe(1950 - 20000);
      expect(lowest[1]).toBeCloseTo(-116.2, 1);
      const inSpan = stack.points.filter((p) => p[0] >= 1950 - 80000);
      const low = inSpan.reduce((x, y) => (y[1] < x[1] ? y : x));
      expect(low[0]).toBe(1950 - 24000);
      expect(low[1]).toBe(-130);
      // In MIS 3 (57 to 29 ka) this reads higher, in either scenario, by tens of metres and up to about 54 m.
      const mis3 = pairs.filter((p) => p.ka <= 57 && p.ka >= 29);
      for (const p of mis3) {
        expect(p.ice - p.stack, `at ${p.ka} ka`).toBeGreaterThan(15);
        expect(p.other - p.stack, `at ${p.ka} ka`).toBeLessThan(55);
      }
    });

    it('draws Canada and northern Europe at the LGM from the field, and nothing of it on the Sahara', () => {
      const dir = latestBuild();
      const { header, arrays } = decodeTile<IceHeader>(bytes(join(dir, 'ice.lwt')));
      const k = header.scenarios[0].keyframes.find((x) => x.ageMa === 0.02)!;
      const inside = (lat: number, lon: number) => arrays[k.margin][(90 - lat) * header.grid.nx + (lon + 180)] > 127.5;
      for (const [lat, lon] of [[60, -85], [52, -73], [59, 18], [64, 21]]) expect(inside(lat, lon), `${lat}, ${lon}`).toBe(true);
      for (const [lat, lon] of [[65, 110], [38, -98], [40, -4], [23, 10]]) expect(inside(lat, lon), `${lat}, ${lon}`).toBe(false);
    });
  });

  it('writes the planet\'s states: its phases in order, tied to the dates they follow, and the ice of its glaciations', () => {
    const { planet, episodes } = JSON.parse(readFileSync(join(latestBuild(), 'planet.json'), 'utf8')) as PlanetFile;
    const { entities } = JSON.parse(readFileSync(join(latestBuild(), 'search.json'), 'utf8')) as SearchFile;
    expect(planet!.phases.map((p) => p.label)).toEqual(['Proto-Earth', 'Rock-vapour atmosphere', 'Magma ocean under steam', 'Oceans', 'Without oceans']);
    expect(planet!.phases.map((p) => p.values.surface?.map((c) => c.value))).toEqual([['crust-and-magma'], ['magma'], ['magma'], ['ocean'], ['bare-rock']]);
    // Earth begins within 1 Myr of the Solar System's first solids; the proto-Earth ends at the impact.
    const date = (id: string) => entities.find((e) => e.id === id)!.time.start.best!;
    const phase = (id: string) => planet!.phases.find((p) => p.subject === `space/bodies/earth@${id}`)!;
    const born = planet!.time.start.best! - date('space/events/solar-system-formation');
    expect(born).toBeGreaterThanOrEqual(0);
    expect(born).toBeLessThanOrEqual(1e6);
    expect(phase('proto-earth').time.end.best).toBe(date('earth/events/moon-forming-impact'));
    // The oceans are lost about 2 Gyr from now, a projection.
    expect(phase('oceans').time.end.best).toBe(PRESENT_YEAR + 2e9);
    expect(phase('magma-ocean').time.end.best! - date('earth/events/moon-forming-impact')).toBeCloseTo(2e6, 0);
    // Picking another date for the impact moves the magma ocean with it.
    const maurice = phase('magma-ocean').variants!['earth/events/moon-forming-impact#date-maurice-2020'];
    expect(toMa(maurice.start.best!)).toBeCloseTo(4425, 0);
    // The Snowballs' ice reaches the equator in the default picture; a competing claim leaves open water.
    for (const id of ['earth/events/makganyene-glaciation', 'earth/events/sturtian-glaciation', 'earth/events/marinoan-glaciation']) {
      const reach = episodes.find((e) => e.subject === id)!.values.ice_reach;
      expect(chosenClaim(reach, {})!.value).toBe(0);
      expect(reach.filter((c) => c.value !== 0).length).toBe(1);
    }
  });

  it('draws Rome\'s territory from its dataset: one state across the dataset\'s names, within its lifetime', () => {
    const dir = latestBuild();
    const file = JSON.parse(readFileSync(join(dir, 'territory.json'), 'utf8')) as TerritoryFile;
    const rome = file.territories.find((t) => t.subject === 'people/polities/rome')!;
    const rows = rome.claims[0].rows;
    expect(new Set(rows.map((r) => r.name))).toEqual(new Set(['Roman Kingdom', 'Roman Republic', 'Roman Empire', 'Eastern Roman Empire', 'Nicaean Empire', 'Byzantine Empire']));
    // The dataset's years are inclusive and negative for BCE: its first Republic row, −500
    // to −481, runs from the start of 500 BCE to the end of 481 BCE.
    const republic = rows.find((r) => r.name === 'Roman Republic')!;
    expect([republic.from, republic.to]).toEqual([-499, -479]);
    // Its rows wholly after the fall of Constantinople are left out.
    expect(Math.max(...rows.map((r) => r.from))).toBeLessThan(rome.time.end.best!);
    // At its height, under Trajan and Hadrian.
    const peak = rows.reduce((a, b) => (b.area > a.area ? b : a));
    expect([peak.name, peak.from, peak.to, Math.round(peak.area / 1e5)]).toEqual(['Roman Empire', 117, 127, 53]);
    // In 420 CE there were two courts: the West drawn as its own polity, part of Rome.
    expect(territoriesAt(file, 420, {}).map((a) => a.territory.subject).sort()).toEqual(['people/polities/rome', 'people/polities/western-roman-empire']);
    expect(territoriesAt(file, 1460, {})).toEqual([]);
    const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
    expect(ts.credits.map((c) => c.label)).toContain('Borders from Cliopatria (Bennett et al. 2025, Seshat)');
  });

  it('draws where people lived from its grid, whose cells come to the world\'s series at its steps and between them', () => {
    const dir = latestBuild();
    const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
    expect(ts.files.people).toBe('people.lwt');
    const { header, arrays } = decodeTile<PeopleHeader>(bytes(join(dir, 'people.lwt')));
    const f = { ...header, cell: arrays[0], land: arrays[1], people: arrays[2] } as PeopleFile;
    expect(f.steps).toHaveLength(73);
    expect([f.steps[0], f.steps.at(-1)]).toEqual([-10000, 2015]);
    expect(f.res).toBe(1);
    expect(f.people.length).toBe(f.cell.length * f.steps.length);
    expect(f.sourceRecord?.citation).toContain('Klein Goldewijk');
    expect(f.description).toContain('reconstruction');
    // The field's, so that no number about the world is in code.
    expect(f.range.map((r) => r[1])).toEqual([95, 75, 50, 25, 10, 5, 1]);
    const { series } = JSON.parse(readFileSync(join(dir, 'series.json'), 'utf8')) as SeriesFile;
    const points = series.find((x) => x.id === 'field:earth/world-population')!.points;
    const total = (t: number) => {
      const i = points.findIndex((p) => p[0] >= t);
      if (points[i][0] === t) return points[i][1];
      const [a, b] = [points[i - 1], points[i]];
      return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
    };
    const now = new Float64Array(f.cell.length);
    for (const t of [-10000, -9500, -5000, 0, 1, 50, 1000, 1450, 1705, 1955, 2000, 2012.5, 2015]) {
      expect(peopleAt(f, t, now)).toBe(true);
      const sum = now.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - total(t)) / total(t), `at ${t}: ${sum} against ${total(t)}`).toBeLessThan(5e-5);
    }
    expect(peopleAt(f, -10001, now)).toBe(false);
    expect(peopleAt(f, 2016, now)).toBe(false);
    expect(ts.credits.map((c) => c.label)).toContain('Population grid from HYDE 3.2.1 (Klein Goldewijk et al. 2017), its cells added up to 1°');
    // Loaded only when it is asked for, and no heavier than the states of the world.
    expect(statSync(join(dir, 'people.lwt')).size).toBeLessThan(6e6);
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
