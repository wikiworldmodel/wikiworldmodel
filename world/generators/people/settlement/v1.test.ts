// The settlement generator held, in aggregate, to what it samples (docs/STRUCTURE.md section 3.4): the people the world
// puts in the land, the way of life, the traditions, the cities; and to the ground it stands on. On a made-up world.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compileTraditions, type Tradition } from '../../../../core/dwelling.ts';
import { lifewayOf, type AnthromeClass, type Assessment } from '../../../../core/landscape.ts';
import type { SceneSpec, ScenePeople } from '../../../../core/scene.ts';
import { LandUseMap, makeSettlement, roundLots, toLocal, type Ground } from './v1.ts';

const ROOT = join(import.meta.dirname, '../../../..');
const classes = (parse(readFileSync(join(ROOT, 'world/fields/people/anthromes.yaml'), 'utf8')) as { params: { classes: AnthromeClass[] } }).params.classes;
const gen = parse(readFileSync(join(ROOT, 'world/generators/people/settlement.yaml'), 'utf8')) as { id: string; version: number; params: Record<string, unknown> };
const number = (code: number) => classes.findIndex((c) => c.code === code) + 1;

const assess = (forage: number, swidden: number, farm: number, herd: number, urban = 0): Assessment => ({
  use: [forage, swidden, farm, herd].map((l) => [l, l, l, l] as [number, number, number, number]),
  urban,
  urbanMedian: urban,
  quality: 2,
  expertise: 2,
});

/** A world of 5′ cells, 2° on a side around the equator and the prime meridian, each of one class and density and region. */
function world(cell: (row: number, col: number) => { code: number; density: number; region: number }, regions: { id: number; a: Assessment }[], extra: Partial<ScenePeople> = {}): ScenePeople {
  const nx = 24;
  const ny = 24;
  const anthrome: number[] = [];
  const density: number[] = [];
  const region: number[] = [];
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const x = cell(r, c);
    anthrome.push(number(x.code));
    density.push(x.density);
    region.push(x.region);
  }
  const centre = cell(12, 12);
  const a = regions.find((g) => g.id === centre.region)?.a;
  return {
    t: 100,
    step: 100,
    grid: { north: 1, west: -1, nx, ny, res: 1 / 12, anthrome, density, region },
    classes,
    regions: regions.map((g) => ({ id: g.id, label: `Region ${g.id}`, slice: '2,000 BP', assessment: g.a })),
    lifeway: lifewayOf(classes, number(centre.code), centre.density, a),
    cities: [],
    traditions: [],
    fields: { anthromes: 'field:people/anthromes', assessment: 'field:people/land-use-assessment', population: 'field:earth/population', lifeways: 'field:people/lifeways' },
    generator: { generator: gen.id, version: gen.version, params: gen.params },
    ...extra,
  };
}

const spec = (people: ScenePeople, origin = { lat: 0, lon: 0 }): SceneSpec => ({ site: { origin }, biome: { climate: 'temperate' }, people }) as unknown as SceneSpec;
const flat: Ground = { at: () => 40 };
const dry = () => 0;
const EXTENT = 16000;

describe('the settlement generator', () => {
  it('holds as many people as the world puts in the land it draws', () => {
    for (const [code, density] of [[32, 40], [23, 260], [33, 4], [42, 3]] as [number, number][]) {
      const p = world(() => ({ code, density, region: 1 }), [{ id: 1, a: assess(1, 1, 3, 2) }]);
      const plan = makeSettlement(spec(p), flat, dry, EXTENT);
      expect(plan.expected).toBeGreaterThan(0);
      // A tenth either way: settlements are whole, and one either side of the scene's edge is in or out whole.
      expect(Math.abs(plan.drawn - plan.expected) / plan.expected, `class ${code} at ${density} to the km²`).toBeLessThan(0.1);
    }
  });

  it('stands no house in the water or on a cliff', () => {
    // A river 600 m wide along y, its water at 0 m; and a cliff, rising 1 in 2, east of 6 km.
    const ground: Ground = { at: (x) => (Math.abs(x) < 300 ? -4 : x > 6000 ? 40 + (x - 6000) * 0.5 : 40) };
    const p = world(() => ({ code: 23, density: 300, region: 1 }), [{ id: 1, a: assess(1, 1, 3, 2) }]);
    const plan = makeSettlement(spec(p), ground, dry, EXTENT);
    expect(plan.houses.length).toBeGreaterThan(1000);
    for (const h of plan.houses) {
      expect(Math.abs(h.x) >= 300 - 13).toBe(true);
      expect(h.x <= 6000 + 13).toBe(true);
    }
  });

  it('draws fields where people farmed, pasture where they herded, and neither for foragers', () => {
    const sample = (code: number, density: number, a: Assessment) => {
      const p = world(() => ({ code, density, region: 1 }), [{ id: 1, a }]);
      const plan = makeSettlement(spec(p), flat, dry, EXTENT);
      const use = new LandUseMap(plan, flat, dry, 7);
      let crop = 0;
      let pasture = 0;
      for (let x = -15000; x <= 15000; x += 500) for (let y = -15000; y <= 15000; y += 500) {
        const u = use.at(x, y);
        crop += u.crop;
        pasture += u.pasture;
      }
      return { crop, pasture, plan };
    };
    const farmers = sample(23, 260, assess(1, 1, 3, 2));
    expect(farmers.crop).toBeGreaterThan(100);
    expect(farmers.pasture).toBe(0);
    const herders = sample(42, 3, assess(1, 0, 0, 3));
    expect(herders.pasture).toBeGreaterThan(1);
    expect(herders.crop).toBe(0);
    // Remote woodland, where the region's archaeologists say foraging was the way of life.
    const foragers = sample(53, 0.5, assess(3, 0, 0, 0));
    expect(foragers.plan.settlements.every((s) => s.pattern === 'foragers')).toBe(true);
    expect(foragers.crop + foragers.pasture).toBe(0);
  });

  it("draws a tradition's house where it holds, and the generic one where none does", () => {
    const traditions: Tradition[] = compileTraditions([{ id: 'test/round-house', label: 'A round house', regions: [1], span: [-500, 500], dwelling: { plan: 'round', diameter: 8, walls: 'stone', roof: 'conical', roof_material: 'thatch' } }]);
    // The west half of the world is region 1, where the tradition holds; the east half region 2, where none does.
    const p = world((_, c) => ({ code: 23, density: 260, region: c < 12 ? 1 : 2 }), [{ id: 1, a: assess(1, 1, 3, 2) }, { id: 2, a: assess(1, 1, 3, 2) }], { traditions });
    const plan = makeSettlement(spec(p), flat, dry, EXTENT);
    const of = (west: boolean) => new Set(plan.houses.filter((h) => (h.x < -500) === west && Math.abs(h.x) > 500).map((h) => plan.forms[h.form].from));
    expect(of(true)).toEqual(new Set(['tradition']));
    expect(of(false)).toEqual(new Set(['generic']));
    const t = plan.forms.find((f) => f.from === 'tradition')!;
    expect(t.spec).toMatchObject({ plan: 'round', walls: 'stone', roof_material: 'thatch' });
    expect(t.parts).toMatchObject({ walls: 'test/round-house' });
  });

  it('draws a city of the lists where the anthromes have none', () => {
    const cities = [{ name: 'Testopolis', country: 'Nowhere', lat: 0.02, lon: 0.03, people: 40000, field: 'field:people/cities-ancient', source: 'src:test' }];
    const p = world(() => ({ code: 54, density: 2, region: 1 }), [{ id: 1, a: assess(1, 0, 1, 3, 1) }], { cities });
    const plan = makeSettlement(spec(p), flat, dry, EXTENT);
    const city = plan.settlements.find((s) => s.city === 'Testopolis');
    expect(city).toBeDefined();
    expect(city!.pattern).toBe('city');
    expect(city!.people).toBe(40000);
    const [cx, cy] = toLocal({ lat: 0, lon: 0 }, 0.02, 0.03);
    expect(Math.hypot(city!.x - cx, city!.y - cy)).toBeLessThan(1);
    const near = plan.houses.filter((h) => Math.hypot(h.x - cx, h.y - cy) < city!.r * 1.2);
    expect(near.length).toBeGreaterThan(1000);
    // No herders' camp stands inside the city.
    expect(plan.settlements.filter((s) => !s.city && Math.hypot(s.x - cx, s.y - cy) < city!.r)).toEqual([]);
    // Round, not a square: the houses reach about as far in every direction, and no further than its radius allows.
    const mine = plan.houses.filter((h) => h.settlement === plan.settlements.indexOf(city!));
    const far = Math.max(...mine.map((h) => Math.hypot(h.x - cx, h.y - cy)));
    expect(far).toBeLessThan(city!.r * 1.6);
    const quarter = [0, 1, 2, 3].map((q) => mine.filter((h) => Math.floor(((Math.atan2(h.y - cy, h.x - cx) + Math.PI) / (Math.PI / 2)) % 4) === q).length / mine.length);
    for (const share of quarter) expect(share).toBeGreaterThan(0.15);
  });

  it('lays a town out round, with a wandering edge, and every lot once', () => {
    for (const n of [7, 400, 12000]) {
      const lots = roundLots(n, 0x51c1 + n);
      expect(lots.length).toBe(n);
      expect(new Set(lots.map(([x, y]) => `${x},${y}`)).size).toBe(n);
      // Within the radius of a disc of n lots, give or take its wandering edge.
      const r = Math.sqrt(n / Math.PI);
      for (const [x, y] of lots) expect(Math.hypot(x, y)).toBeLessThan(r * 1.5 + 2);
    }
    // The edge wanders: the furthest lot in each of eight directions is not the same distance out.
    const lots = roundLots(12000, 99);
    const reach = Array.from({ length: 8 }, (_, k) => Math.max(...lots.filter(([x, y]) => Math.floor(((Math.atan2(y, x) + Math.PI) / (Math.PI / 4)) % 8) === k).map(([x, y]) => Math.hypot(x, y))));
    expect(Math.max(...reach) / Math.min(...reach)).toBeGreaterThan(1.1);
  });

  it('puts a settlement in the same place from two scenes that overlap', () => {
    const p = world((r, c) => ({ code: (r + c) % 3 ? 32 : 23, density: (r + c) % 3 ? 40 : 260, region: 1 }), [{ id: 1, a: assess(1, 1, 3, 2) }]);
    const a = { lat: 0, lon: 0 };
    const b = { lat: 0.06, lon: 0.05 };
    const pa = makeSettlement(spec(p, a), flat, dry, EXTENT);
    const pb = makeSettlement(spec(p, b), flat, dry, EXTENT);
    // Back to degrees, each from its own scene's origin.
    const deg = (o: { lat: number; lon: number }, x: number, y: number) => [o.lat + y / 111194.93, o.lon + x / (111194.93 * Math.cos((o.lat * Math.PI) / 180))];
    const [bx, by] = toLocal(a, b.lat, b.lon);
    const shared = pa.settlements.filter((s) => Math.abs(s.x - bx) < EXTENT - 2000 && Math.abs(s.y - by) < EXTENT - 2000 && Math.abs(s.x) < EXTENT - 2000 && Math.abs(s.y) < EXTENT - 2000);
    expect(shared.length).toBeGreaterThan(50);
    const others = pb.settlements.map((s) => deg(b, s.x, s.y));
    for (const s of shared) {
      const [la, lo] = deg(a, s.x, s.y);
      const best = Math.min(...others.map(([lb, ob]) => Math.hypot((la - lb) * 111194.93, (lo - ob) * 111194.93)));
      expect(best).toBeLessThan(2);
    }
  });
});
