// The anonymous human landscape, in its parts: reading the anthromes' grids and the regions' shapes, ArchaeoGLOBE's
// snapshot, the lists of cities, the building traditions and their dwellings, and model:people/lifeways's rules. None
// needs a build; the snapshots are the repository's.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compileTraditions, dwellingProblems, fieldProblems, settlementProblems, specText, traditionAt } from '../../../core/dwelling.ts';
import { assessmentAt, cityPeople, citiesNear, lifewayOf, nearestStep, shareDensity, tileKey, cellOf, type AnthromeClass, type Assessment, type CitiesFile, type City } from '../../../core/landscape.ts';
import { assessmentsFile, cityYear, citiesOf, eckert4Inverse, parseClassGrid, rasterizeRegions, stepOfName } from '../src/build/landscape.ts';
import { readTable, snapshotText, SLICES } from '../src/archaeoglobe.ts';
import { loadManifest } from '../src/manifest.ts';
import { REPO } from '../src/paths.ts';

const classes = (parse(readFileSync(join(REPO, 'world/fields/people/anthromes.yaml'), 'utf8')) as { params: { classes: AnthromeClass[] } }).params.classes;
const number = (code: number) => classes.findIndex((c) => c.code === code) + 1;
const assess = (forage: number, swidden: number, farm: number, herd: number, urban = 0): Assessment => ({
  use: [forage, swidden, farm, herd].map((l) => [l, l, l, l] as [number, number, number, number]),
  urban,
  urbanMedian: urban,
  quality: 2,
  expertise: 2,
});

describe('the anthromes, read', () => {
  it('reads a grid of classes, nodata and unknown codes as no land', () => {
    const text = 'ncols 4\nnrows 2\nxllcorner -180\nyllcorner -90\ncellsize 0.0833333\nNODATA_value -9999\n11 23 -9999 70\n63 99 21 12\n';
    const out = new Uint8Array(8);
    const index = new Int16Array(100).fill(-1);
    classes.forEach((c, i) => (index[c.code] = i + 1));
    parseClassGrid(new TextEncoder().encode(text), out, index);
    expect([...out]).toEqual([number(11), number(23), 0, number(70), number(63), 0, number(21), number(12)]);
  });

  it('names its steps as HYDE does: 10000BC is −10000 and 0AD is 0', () => {
    expect(stepOfName('10000BC_anthromes.zip')).toBe(-10000);
    expect(stepOfName('0AD_anthromes.zip')).toBe(0);
    expect(stepOfName('2015AD_anthromes.zip')).toBe(2015);
    expect(stepOfName('Readme.txt')).toBeUndefined();
  });

  it('takes the step nearest a time, the earlier where two are as near, and none far outside them', () => {
    const steps = [-3000, -2000, -1000, 0, 100];
    expect(nearestStep(steps, -2600)).toBe(0);
    expect(nearestStep(steps, -2500)).toBe(0);
    expect(nearestStep(steps, -2400)).toBe(1);
    expect(nearestStep(steps, 60)).toBe(4);
    expect(nearestStep(steps, 151)).toBe(-1);
    expect(nearestStep(steps, -3600)).toBe(-1);
  });

  it('finds a place\'s tile and cell, a place on a tile\'s northern edge in that tile', () => {
    expect(tileKey(33.3, 44.4, 10).key).toBe('40_40');
    expect(tileKey(40, 44.4, 10).key).toBe('40_40');
    expect(tileKey(-90, -180, 10).key).toBe('-80_-180');
    expect(tileKey(10, 181, 10).key).toBe('10_-180');
    const tile = { north: 40, west: 40, nx: 120, ny: 120, res: 1 / 12 };
    expect(cellOf(tile, 40, 40)).toBe(0);
    expect(cellOf(tile, 39.95, 40.05)).toBe(0);
    expect(cellOf(tile, 30.01, 49.99)).toBe(119 * 120 + 119);
    expect(cellOf(tile, 29.99, 45)).toBe(-1);
  });
});

describe('the regions, read', () => {
  it('turns Eckert IV back into latitude and longitude', () => {
    // Forward, by the projection's formulas, then back.
    const R = 6378137;
    const forward = (lon: number, lat: number) => {
      const phi = (lat * Math.PI) / 180;
      let th = phi / 2;
      for (let i = 0; i < 40; i++) th -= (th + Math.sin(th) * Math.cos(th) + 2 * Math.sin(th) - (2 + Math.PI / 2) * Math.sin(phi)) / (2 * Math.cos(th) * (1 + Math.cos(th)));
      return [(2 / Math.sqrt(Math.PI * (4 + Math.PI))) * R * ((lon * Math.PI) / 180) * (1 + Math.cos(th)), 2 * Math.sqrt(Math.PI / (4 + Math.PI)) * R * Math.sin(th)];
    };
    for (const [lon, lat] of [[44.4, 33.3], [-77.04, -12.05], [151.2, -33.87], [-0.12, 51.5], [179, 80], [0, 0]]) {
      const [x, y] = forward(lon, lat);
      const [lo, la] = eckert4Inverse(x, y, R);
      expect(lo).toBeCloseTo(lon, 6);
      expect(la).toBeCloseTo(lat, 6);
    }
  });

  it('fills an outline into the grid, a hole left out', () => {
    const res = 1;
    const square = [[-10, 10], [10, 10], [10, -10], [-10, -10], [-10, 10]];
    const hole = [[-3, 3], [3, 3], [3, -3], [-3, -3], [-3, 3]];
    const grid = rasterizeRegions([{ id: 7, rings: [square, hole] }], 360, 180, res);
    const at = (lat: number, lon: number) => grid[Math.floor(90 - lat) * 360 + Math.floor(lon + 180)];
    expect(at(5, 5)).toBe(7);
    expect(at(-9.5, -9.5)).toBe(7);
    expect(at(0.5, 0.5)).toBe(0);
    expect(at(11, 0)).toBe(0);
  });
});

describe('ArchaeoGLOBE\'s snapshot', () => {
  const text = readFileSync(join(REPO, 'world/snapshots/archaeoglobe-2019-assessments.csv'), 'utf8');

  it('is the file the manifest pins', async () => {
    const d = (await loadManifest()).datasets['src:archaeoglobe-2019-assessments'];
    expect(createHash('sha256').update(text).digest('hex')).toBe(d.fetch.sha256);
    expect(Buffer.byteLength(text)).toBe(d.fetch.bytes);
  });

  it('has a row for each of the 146 regions at each of the ten times, as the build reads it', () => {
    const f = assessmentsFile(text, 'src:archaeoglobe-2019-assessments', 'test');
    expect(f.regions).toHaveLength(146);
    expect(f.slices.map((s) => s.year)).toEqual(SLICES.map((s) => s.year));
    for (const r of f.regions) expect(f.rows[String(r.id)]).toHaveLength(10);
    // Iraq at 4,000 BP: continuous farming and herding widespread, and cities.
    const iraq = f.rows['59'][3];
    expect(iraq.use[2][0]).toBe(3);
    expect(iraq.use[3][0]).toBe(3);
    expect(iraq.urban).toBe(1);
    // The least answer is never above the consensus' most.
    for (const rows of Object.values(f.rows)) for (const a of rows) for (const u of a.use) expect(u[1]).toBeLessThanOrEqual(u[3]);
  });

  it('joins tables whose columns are spelt more than one way, and refuses a level that is not one', () => {
    const head = 'Region,Label,FHG_10KBP,EXAGR_10KBP,INAG_10KBP,PAS_10KBP,URBAN_10kbp';
    const lower = 'Region,Label,FHG_10kbp,EXAG_10kbp,INAG_10kbp,PAS_10kbp';
    const one = (h: string, row: string) => `${h}\n${row}\n`;
    const tables = {
      consensus: one(head, '1,"Somewhere, else",Widespread,None,Minimal,Common,Absent'),
      minimum: one(lower, '1,"Somewhere, else",Common,None,None,Minimal'),
      median: one(lower, '1,"Somewhere, else",Widespread,None,Minimal,Common'),
      maximum: one(lower, '1,"Somewhere, else",Widespread,Minimal,Common,Widespread'),
      urban: one('Region,Label,URBAN_10kbp', '1,"Somewhere, else",Absent'),
      quality: one('Region,Label,DQ_10kbp', '1,"Somewhere, else",1.5'),
      expertise: one('Region,Label,EXPERTISE_10kbp', '1,"Somewhere, else",2'),
      excavations: one('Region,Label,SITES', '1,"Somewhere, else",50-249'),
    };
    const md5 = Object.fromEntries(Object.keys(tables).map((k) => [k, 'x'])) as never;
    // Only the first time is in these tables: the others are asked for and are missing.
    expect(() => snapshotText(tables, md5, md5)).toThrow(/no column/);
    expect(readTable(tables.consensus).get(1)!.Label).toBe('Somewhere, else');
    const bad = { ...tables, consensus: one(head, '1,x,Lots,None,Minimal,Common,Absent') };
    expect(() => snapshotText(bad, md5, md5)).toThrow(/not one of/);
  });

  it('takes the survey\'s time nearest, and holds its last time to the present', () => {
    const f = assessmentsFile(text, 'src:archaeoglobe-2019-assessments', 'test');
    expect(assessmentAt(f, 59, -2100)!.slice).toBe(3);
    expect(assessmentAt(f, 59, 1700)!.slice).toBe(8);
    expect(assessmentAt(f, 59, 2015)!.slice).toBe(9);
    expect(assessmentAt(f, 999, 0)).toBeUndefined();
  });
});

describe('the lists of cities', () => {
  const read = (file: string, field: string, leftOut: { city: string; columns: string[] }[] = []) =>
    citiesOf(new TextDecoder('latin1').decode(readFileSync(join(REPO, 'world/snapshots', file))), 'src:x', field, leftOut);

  it('reads a column as the axis does: BC_3000 is −2999 and AD_100 is 100', () => {
    expect(cityYear('BC_3000')).toBe(-2999);
    expect(cityYear('AD_1')).toBe(1);
    expect(cityYear('Latitude')).toBeUndefined();
  });

  it('reads Modelski\'s Uruk, and leaves out the cells its field says to', () => {
    const left = (parse(readFileSync(join(REPO, 'world/fields/people/cities-ancient.yaml'), 'utf8')) as { params: { left_out: { city: string; columns: string[] }[] } }).params.left_out;
    const cities = read('reba-2016-modelski-ancient-v2.csv', 'field:people/cities-ancient', left);
    const uruk = cities.find((c) => c.name === 'Uruk')!;
    expect(uruk.pops[0]).toEqual([-3499, 14000]);
    expect(uruk.pops).toContainEqual([-3299, 40000]);
    const teo = cities.find((c) => c.name === 'Teotihuacan')!;
    expect(teo.pops.every(([y]) => y > 0)).toBe(true);
  });

  it('stands a city between its figures, but not across a long silence', () => {
    const c: City = { name: 'X', country: 'Y', lat: 0, lon: 0, certainty: 1, source: 's', field: 'f', pops: [[1000, 15000], [1800, 925], [1850, 77000]] };
    expect(cityPeople(c, 1000, 50, 600)).toBe(15000);
    expect(cityPeople(c, 1040, 50, 600)).toBe(15000);
    expect(cityPeople(c, 1100, 50, 600)).toBeUndefined();
    expect(cityPeople(c, 1760, 50, 600)).toBe(925);
    expect(cityPeople(c, 1825, 50, 600)).toBe(Math.round(925 + (77000 - 925) / 2));
    expect(cityPeople(c, 1900, 50, 600)).toBe(77000);
    expect(cityPeople(c, 1901, 50, 600)).toBeUndefined();
  });

  it('makes one city of two lists\' figures for it, drawn with the larger, the other kept beside it', () => {
    const at = (name: string, source: string, people: number, lat = 41.89, lon = 12.48): City => ({ name, country: 'Italy', lat, lon, certainty: 1, source, field: source, pops: [[100, people]] });
    const f: CitiesFile = { format: 'lightworld-cities@1', lists: [{ source: 'a', field: 'a', title: 'A', hold: 50, gap: 600 }, { source: 'b', field: 'b', title: 'B', hold: 50, gap: 600 }], cities: [at('Rome', 'a', 450000), at('Rome', 'b', 1000000, 41.895, 12.484), at('Ostia', 'a', 50000, 41.75, 12.29)] };
    const near = citiesNear(f, 41.9, 12.5, 100, 40);
    expect(near.map((x) => [x.city.name, x.people])).toEqual([['Rome', 1000000], ['Ostia', 50000]]);
    expect(near[0].also.map((x) => x.people)).toEqual([450000]);
  });
});

describe('the lifeway, model:people/lifeways', () => {
  it('shares a 1° cell\'s people over its 5′ cells to the same total', () => {
    const ks = [number(23), number(32), number(52), number(61), 0, number(11)];
    const land = [80, 80, 80, 80, 0, 40];
    const d = shareDensity(classes, ks, land, 123456);
    expect(d.reduce((s, x, i) => s + x * land[i], 0)).toBeCloseTo(123456, 3);
    // Denser classes take more, wild land none.
    expect(d[0]).toBeGreaterThan(d[1]);
    expect(d[1]).toBeGreaterThan(d[2]);
    expect(d[3]).toBe(0);
    expect(d[5]).toBeGreaterThan(d[0]);
  });

  it('takes a village\'s use of the land from its class, and rests it on the archaeologists who say people farmed', () => {
    const l = lifewayOf(classes, number(21), 400, assess(1, 1, 3, 2));
    expect(l).toMatchObject({ pattern: 'villages', fields: 'rice', tier: 'evidence' });
    expect(lifewayOf(classes, number(22), 400, undefined)).toMatchObject({ pattern: 'villages', fields: 'irrigated', tier: 'model' });
  });

  it('asks the archaeologists which way of life it was, where the anthrome names no use of the land', () => {
    expect(lifewayOf(classes, number(52), 5, assess(1, 1, 3, 1))).toMatchObject({ pattern: 'farmsteads', fields: 'rainfed', tier: 'evidence' });
    expect(lifewayOf(classes, number(52), 5, assess(1, 3, 1, 1))).toMatchObject({ pattern: 'shifting', fields: 'swidden' });
    expect(lifewayOf(classes, number(54), 0.5, assess(1, 0, 0, 3))).toMatchObject({ pattern: 'herders', fields: 'pasture' });
    expect(lifewayOf(classes, number(53), 0.5, assess(3, 2, 2, 0))).toMatchObject({ pattern: 'foragers', tier: 'evidence' });
    // Nothing known of the region: foragers stand in, and say so.
    expect(lifewayOf(classes, number(53), 0.5, undefined)).toMatchObject({ pattern: 'foragers', tier: 'generic' });
  });

  it('says where HYDE and the archaeologists disagree, and rests the pattern on HYDE alone there', () => {
    const fields = lifewayOf(classes, number(32), 40, assess(3, 0, 0, 1));
    expect(fields.disagrees).toMatch(/no farming/);
    expect(fields.tier).toBe('model');
    const empty = lifewayOf(classes, number(61), 0, assess(3, 2, 2, 0));
    expect(empty.pattern).toBe('none');
    expect(empty.disagrees).toMatch(/foraging and farming was common or widespread/);
  });
});

describe('building traditions', () => {
  it('checks a dwelling, a settlement form and a field system word by word', () => {
    expect(dwellingProblems({ plan: 'round', diameter: { lo: 5, hi: 15 }, walls: 'wattle-and-daub', roof: 'conical', roof_material: 'thatch', court: false })).toEqual([]);
    expect(dwellingProblems({ plan: 'hexagonal' })).toEqual([expect.stringMatching(/^plan is one of/)]);
    expect(dwellingProblems({ width: -1 })).toEqual([expect.stringMatching(/positive number/)]);
    expect(dwellingProblems({ colour: 'red' })).toEqual([expect.stringMatching(/has no "colour"/)]);
    expect(dwellingProblems({})).toEqual(['a dwelling says something']);
    expect(settlementProblems({ pattern: 'nucleated', houses: { lo: 20, hi: 10 } })).toEqual([expect.stringMatching(/houses is/)]);
    expect(fieldProblems({ kind: 'paddies', plot: 0.1, bounds: 'dikes' })).toEqual([]);
    expect(specText({ plan: 'round', diameter: { lo: 5, hi: 15 }, roof: 'conical', roof_material: 'thatch' })).toBe('round plan, 5–15 m across, conical roof, roofed with thatch');
  });

  it('inherits what a member does not say from the tradition it is a member of, and says whose each part is', () => {
    const [child, parent] = compileTraditions([
      { id: 'b', label: 'Child', parent: 'a', regions: [], span: [-100, 100], dwelling: { roof: 'flat' } },
      { id: 'a', label: 'Parent', regions: [59, 61], span: [-3000, 500], dwelling: { plan: 'courtyard', walls: 'mudbrick', roof: 'gable' }, settlement: { household: 6 } },
    ]).sort((x, y) => (x.id < y.id ? 1 : -1));
    expect(child.dwelling).toEqual({ plan: 'courtyard', walls: 'mudbrick', roof: 'flat' });
    expect(child.from).toMatchObject({ 'dwelling.roof': 'b', 'dwelling.walls': 'a', 'settlement.household': 'a' });
    expect(child.regions).toEqual([59, 61]);
    expect(child.depth).toBe(1);
    expect(parent.depth).toBe(0);
  });

  it('draws a place\'s houses from the most particular tradition that holds there and then', () => {
    const list = compileTraditions([
      { id: 'broad', label: 'Broad', regions: [1, 2, 3], span: [-3000, 1500], dwelling: { walls: 'mudbrick' } },
      { id: 'narrow', label: 'Narrow', regions: [1], span: [-2000, -1000], dwelling: { walls: 'stone' } },
      { id: 'member', label: 'Member', parent: 'broad', regions: [2], span: [0, 500], dwelling: { roof: 'flat' } },
    ]);
    expect(traditionAt(list, 1, -1500)!.id).toBe('narrow');
    expect(traditionAt(list, 1, -500)!.id).toBe('broad');
    expect(traditionAt(list, 2, 100)!.id).toBe('member');
    expect(traditionAt(list, 3, 100)!.id).toBe('broad');
    expect(traditionAt(list, 4, 100)).toBeUndefined();
    expect(traditionAt(list, 1, 1600)).toBeUndefined();
  });
});
