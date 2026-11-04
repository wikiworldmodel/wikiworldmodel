// A generator's output is part of the world: changing it is a new version, not an edit. These check
// the plan and the kit without a build: a small plain, with a river through it, and a handful of
// made-up taxa, which say nothing of any real animal.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { SceneFile, SceneTaxon } from '../../../../core/scene.ts';
import type { FeatureTime } from '../../../../core/tileset.ts';
import { GroundSampler } from '../../city/ground.ts';
import { Mesh } from '../../city/kit.ts';
import { hashString } from '../../city/math.ts';
import { SceneBuilder, sceneTime, taxonEntity } from '../cells.ts';
import { animal, HIP_SHARE, plant, POSE } from '../organisms.ts';
import { arrival, distanceField, EXTENT, fbm, Land, noise, plainGrid, planBytes, riverPath, scenePlan, VERSION, watersOf, type SceneParams } from './v1.ts';

const record = parse(readFileSync(join(import.meta.dirname, '../scene.yaml'), 'utf8'));
const PARAMS = record.params as SceneParams;
const SEED = record.slots['hell-creek'].seed as string;
const WATER = 100;

const span = (a: number, b: number): FeatureTime => ({ start: { best: a, lo: a, hi: a, derived: false }, end: { best: b, lo: b, hi: b, derived: false }, instant: false });

const animalTaxon = (name: string, plan: SceneTaxon['plan'], length: number, rows: number, extra: Partial<SceneTaxon> = {}): SceneTaxon => ({ id: `t/${name}`, label: name, plan, length, rows, collections: rows, time: span(-1e6, 1e6), ...extra });
const plantTaxon = (name: string, plan: SceneTaxon['plan'], height: number, rows: number, extra: Partial<SceneTaxon> = {}): SceneTaxon => ({ id: `t/${name}`, label: name, plan, height, rows, collections: rows, time: span(-1e6, 1e6), ...extra });

const TAXA: SceneTaxon[] = [
  animalTaxon('horned', 'ceratopsian', 8, 40, { hip: 2.6, posture: 'quadruped' }),
  animalTaxon('tyrant', 'tyrannosaur', 12, 20, { posture: 'biped' }),
  animalTaxon('duck', 'hadrosaur', 10, 30, { posture: 'facultative-quadruped' }),
  animalTaxon('tank', 'ankylosaur', 6, 4, { posture: 'quadruped' }),
  animalTaxon('dome', 'pachycephalosaur', 4, 6, { posture: 'biped' }),
  animalTaxon('small', 'ornithopod', 3, 10, { posture: 'biped' }),
  animalTaxon('quick', 'small-theropod', 2, 4, { posture: 'biped' }),
  animalTaxon('croc', 'crocodilian', 3, 20, { posture: 'sprawling' }),
  animalTaxon('shell', 'turtle', 0.5, 20),
  animalTaxon('furry', 'small-mammal', 0.3, 20),
  plantTaxon('cypress', 'conifer', 30, 20),
  plantTaxon('oak', 'broadleaf', 20, 60),
  plantTaxon('fan', 'palm', 10, 10),
  plantTaxon('frond', 'fern', 1, 10),
  plantTaxon('floater', 'fern', 0.02, 10, { posture: 'floating' }),
];

const small = { nx: 401, ny: 401, x0: -2000, y0: -2000, cell: 10 };
const mid = { nx: 201, ny: 201, x0: -10000, y0: -10000, cell: 100 };

function sampleFile(params: SceneParams = PARAMS, taxa: SceneTaxon[] = TAXA, biome: Partial<SceneFile['biome']> = {}): { file: SceneFile; grounds: { nx: number; ny: number; x0: number; y0: number; cell: number; z: Int16Array }[] } {
  const seed = hashString(SEED);
  const waters = watersOf(params.ground, seed, 1200);
  const encode = (z: Float32Array) => Int16Array.from(z, (x) => Math.round(x * 10));
  const fine = encode(plainGrid(small, params.ground, WATER, seed, waters));
  const wide = encode(plainGrid(mid, params.ground, WATER, seed, waters));
  const arrive = arrival(waters, 600, params.cover.clearing * 0.72);
  const levels = [small, mid, { nx: 11, ny: 11, x0: -50000, y0: -50000, cell: 10000 }];
  const grounds = [{ ...small, z: fine }, { ...mid, z: wide }, { ...levels[2], z: new Int16Array(121).fill((WATER + 2) * 10) }];
  const file: SceneFile = {
    format: 'lightworld-scene@1',
    site: { id: 'x', label: 'X', place: 'p', origin: { lat: 50, lon: -80 }, today: { lat: 47, lon: -106 }, span: [-1000, 1000], slice: 0, water_level: WATER, focus: [Math.round(arrive.at[0]), Math.round(arrive.at[1])], to_river: arrive.toRiver },
    ground: levels.map((l, i) => ({ ...l, url: `g${i}` })),
    taxa,
    omitted: [],
    biome: { climate: 'temperate', label: 'temperate', field: 'f', ageMa: 70, cover: { plants: 1, forests: 1, grasses: 0 }, ...biome },
    fossils: { source: 's', title: 't', rows: 100, collections: 10, drawn: 50 },
    generator: { generator: 'gen:life/scene', version: VERSION, seed: SEED, basis: 'procedural', params: params as unknown as Record<string, unknown>, outputSha256: '', cell: { key: 0, detail: 1, sha256: '' } },
  };
  return { file, grounds };
}

const planOf = (params?: SceneParams, taxa?: SceneTaxon[], biome?: Partial<SceneFile['biome']>) => {
  const { file, grounds } = sampleFile(params, taxa, biome);
  return { file, grounds, plan: scenePlan(file, new GroundSampler(grounds)) };
};

const BASE = planOf();

describe('the scene generator v1', () => {
  it('is deterministic and unchanged (bump VERSION if this must change)', () => {
    expect(VERSION).toBe(1);
    expect(record.version).toBe(VERSION);
    const again = scenePlan(BASE.file, new GroundSampler(BASE.grounds));
    expect(planBytes(again)).toEqual(planBytes(BASE.plan));
    expect(createHash('sha256').update(planBytes(BASE.plan)).digest('hex')).toBe('27f80b79e264be95a24da61daf48b2b936ba3666df0b0732968ae5f0919a49ce');
    expect(BASE.plan.count).toBeGreaterThan(1000);
  });

  it('depends on the seed', () => {
    const { file, grounds } = sampleFile();
    const other = scenePlan({ ...file, generator: { ...file.generator, seed: 'other' } }, new GroundSampler(grounds));
    expect(planBytes(other)).not.toEqual(planBytes(BASE.plan));
  });

  it('uses only what every engine computes alike', () => {
    for (const f of ['v1.ts', '../organisms.ts', '../cells.ts']) {
      const code = readFileSync(join(import.meta.dirname, f), 'utf8');
      expect(code).not.toMatch(/Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|log|log2|log10|pow|hypot|cbrt|random)\b/);
      expect(code).not.toMatch(/\bDate\b|\w\s*\*\*\s*\w/);
    }
  });
});

describe('what the plan puts on the plain', () => {
  it('is only the taxa it is given, each at least once', () => {
    const seen = new Set(BASE.plan.taxon);
    expect([...seen].sort((a, b) => a - b)).toEqual(TAXA.map((_, i) => i));
    for (const t of BASE.plan.taxon) expect(t).toBeLessThan(TAXA.length);
  });

  it('puts more of what has more rows, and no fewer of the common for having few of the rare', () => {
    const { plan, file } = planOf();
    const count = (name: string) => plan.taxon.filter((t) => file.taxa[t].label === name).length;
    expect(count('oak')).toBeGreaterThan(count('cypress'));
    const few = planOf(PARAMS, [animalTaxon('duck', 'hadrosaur', 10, 3, { posture: 'quadruped' })]).plan.count;
    const many = planOf(PARAMS, [animalTaxon('duck', 'hadrosaur', 10, 30, { posture: 'quadruped' })]).plan.count;
    expect(many).toBeGreaterThan(few * 3);
  });

  it('never puts a land animal in the water, and keeps the water animals by it', () => {
    const { plan, file, grounds } = BASE;
    const g = new GroundSampler(grounds);
    for (let i = 0; i < plan.count; i++) {
      const t = file.taxa[plan.taxon[i]];
      if (t.posture === 'floating' || t.plan === 'crocodilian' || t.plan === 'turtle') continue;
      const z = g.at(plan.place[i * 6], plan.place[i * 6 + 1]);
      if (['conifer', 'broadleaf', 'palm', 'fern'].includes(t.plan)) expect(z).toBeGreaterThanOrEqual(WATER);
      else expect(z).toBeGreaterThanOrEqual(WATER - 0.001);
    }
    for (let i = 0; i < plan.count; i++) {
      const t = file.taxa[plan.taxon[i]];
      if (t.plan !== 'crocodilian') continue;
      expect(Math.abs(g.at(plan.place[i * 6], plan.place[i * 6 + 1]) - WATER)).toBeLessThan(2.5);
    }
  });

  it('floats what floats on the water, and at its level', () => {
    const { plan, file, grounds } = BASE;
    const g = new GroundSampler(grounds);
    let n = 0;
    for (let i = 0; i < plan.count; i++) {
      if (file.taxa[plan.taxon[i]].posture !== 'floating') continue;
      n++;
      expect(plan.place[i * 6 + 2]).toBe(WATER);
      expect(g.at(plan.place[i * 6], plan.place[i * 6 + 1])).toBeLessThan(WATER);
    }
    expect(n).toBeGreaterThan(0);
  });

  it('stays inside the scene, each a unit direction and a believable size', () => {
    const { plan } = BASE;
    for (let i = 0; i < plan.count; i++) {
      const [x, y, , fx, fy, size] = plan.place.subarray(i * 6, i * 6 + 6);
      expect(Math.abs(x)).toBeLessThan(EXTENT + 1200);
      expect(Math.abs(y)).toBeLessThan(EXTENT + 1200);
      expect(Math.abs(fx * fx + fy * fy - 1)).toBeLessThan(1e-3);
      expect(size).toBeGreaterThan(0.4);
      expect(size).toBeLessThan(1.5);
    }
  });

  it('follows the biome: no forest where the transitions or the climate allow none', () => {
    const trees = (p: { plan: ReturnType<typeof scenePlan>; file: SceneFile }) => p.plan.taxon.filter((t) => ['conifer', 'broadleaf', 'palm'].includes(p.file.taxa[t].plan)).length;
    expect(trees(BASE)).toBeGreaterThan(1000);
    expect(trees(planOf(PARAMS, TAXA, { cover: { plants: 1, forests: 0, grasses: 0 } }))).toBe(0);
    expect(trees(planOf(PARAMS, TAXA, { climate: 'desert', label: 'desert' }))).toBe(0);
    const open = trees(planOf(PARAMS, TAXA, { climate: 'savanna', label: 'savanna' }));
    expect(open).toBeLessThan(trees(BASE));
    expect(open).toBeGreaterThan(0);
  });

  it('keeps the place a visitor arrives open', () => {
    const { file, grounds } = BASE;
    const land = new Land(file, PARAMS, new GroundSampler(grounds));
    land.at(file.site.focus[0], file.site.focus[1]);
    expect(land.canopy).toBe(0);
  });
});

describe('the ground it is drawn on', () => {
  it('has noise that stays in range and is the same each time', () => {
    for (let i = 0; i < 2000; i++) {
      const v = noise(i * 0.37, i * 0.11, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(fbm(i * 0.37, i * 0.11, 5)).toBeLessThanOrEqual(1);
    }
    expect(noise(3.3, 4.4, 5)).toBe(noise(3.3, 4.4, 5));
  });

  it('has a river through the origin that swings about its course and carries on past the plain', () => {
    const r = riverPath(PARAMS.ground, 7, 9000);
    let through = false;
    for (let i = 0; i < r.length; i += 2) if (r[i] === 0 && r[i + 1] === 0) through = true;
    expect(through).toBe(true);
    const end = (i: number) => Math.max(Math.abs(r[i]), Math.abs(r[i + 1]));
    expect(end(0)).toBeGreaterThanOrEqual(9000 - 40);
    expect(end(r.length - 2)).toBeGreaterThanOrEqual(9000 - 40);
    // Its length is longer than the way it goes: it meanders.
    let length = 0;
    for (let i = 2; i < r.length; i += 2) length += Math.sqrt((r[i] - r[i - 2]) ** 2 + (r[i + 1] - r[i - 1]) ** 2);
    const straight = Math.sqrt((r[0] - r[r.length - 2]) ** 2 + (r[1] - r[r.length - 1]) ** 2);
    expect(length / straight).toBeGreaterThan(1.3);
  });

  it('finds the distance to a line, closely', () => {
    const line = [-300, -200, 400, 250];
    const nx = 61;
    const d = distanceField(nx, nx, -600, -600, 20, [line], 100);
    const exact = (x: number, y: number) => {
      const ex = line[2] - line[0];
      const ey = line[3] - line[1];
      const t = Math.max(0, Math.min(1, ((x - line[0]) * ex + (y - line[1]) * ey) / (ex * ex + ey * ey)));
      return Math.hypot(x - line[0] - ex * t, y - line[1] - ey * t);
    };
    for (let j = 0; j < nx; j += 3) {
      for (let i = 0; i < nx; i += 3) {
        const want = exact(-600 + i * 20, -600 + j * 20);
        // Exact near the line; stepped further off, and never short.
        if (want < 60) expect(Math.abs(d[j * nx + i] - want)).toBeLessThan(0.01);
        else {
          expect(d[j * nx + i]).toBeGreaterThanOrEqual(want - 0.01);
          expect(d[j * nx + i]).toBeLessThan(want * 1.12 + 25);
        }
      }
    }
  });

  it('cuts the river below the water, and stands the plain above it', () => {
    const seed = hashString(SEED);
    const w = watersOf(PARAMS.ground, seed, 1200);
    const z = plainGrid(small, PARAMS.ground, WATER, seed, w);
    // On the line of the river, near the origin, it is under water, as deep as it says.
    const at = (x: number, y: number) => z[Math.round((y + 2000) / 10) * 401 + Math.round((x + 2000) / 10)];
    expect(at(0, 0)).toBeLessThan(WATER - PARAMS.ground.depth * 0.8);
    let dry = 0;
    let wet = 0;
    for (const v of z) v < WATER ? wet++ : dry++;
    expect(wet / (wet + dry)).toBeGreaterThan(0.01);
    expect(wet / (wet + dry)).toBeLessThan(0.3);
  });
});

describe('the kit', () => {
  const stance = { L: 8, H: 2.4, pose: POSE.stand, phase: 0.2, sway: 0.05, detail: 1, tint: 100, biped: false };
  const bounds = (m: Mesh) => {
    const { vertices } = m.arrays();
    const f = new Float32Array(vertices);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.verts; i++) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], f[i * 7 + k]);
        hi[k] = Math.max(hi[k], f[i * 7 + k]);
      }
    }
    return { lo, hi };
  };

  it.each(['ceratopsian', 'tyrannosaur', 'hadrosaur', 'ankylosaur', 'pachycephalosaur', 'ornithopod', 'small-theropod', 'crocodilian'])('draws a %s as long as its claims say, standing on the ground, finer close by', (plan) => {
    for (const pose of Object.values(POSE)) {
      const m = new Mesh(4096);
      animal(m, plan, { ...stance, pose });
      expect(m.count).toBeGreaterThan(0);
      const { lo, hi } = bounds(m);
      const length = hi[1] - lo[1];
      // From the tip of the snout to the tip of the tail, whatever the head is doing.
      expect(length).toBeGreaterThan(stance.L * 0.75);
      expect(length).toBeLessThan(stance.L * 1.25);
      // Feet on the ground, near enough, and not sunk into it.
      expect(lo[2]).toBeGreaterThan(-0.03 * stance.L);
      expect(lo[2]).toBeLessThan(stance.H * 0.3);
      expect(hi[2]).toBeGreaterThan(stance.H * 0.8);
    }
    const coarse = new Mesh(4096);
    animal(coarse, plan, { ...stance, detail: 0 });
    const fine = new Mesh(4096);
    animal(fine, plan, stance);
    expect(coarse.verts).toBeLessThan(fine.verts * 0.6);
  });

  it('draws a turtle from its shell, and a small mammal from its length', () => {
    const t = new Mesh(1024);
    animal(t, 'turtle', { ...stance, L: 0.5, H: 0.1 });
    const shell = bounds(t);
    expect(shell.hi[2]).toBeLessThan(0.3);
    expect(shell.hi[0] - shell.lo[0]).toBeGreaterThan(0.3);
    const f = new Mesh(1024);
    animal(f, 'small-mammal', { ...stance, L: 0.3, H: 0.03 });
    const fur = bounds(f);
    expect(fur.hi[2]).toBeLessThan(0.12);
  });

  it('refuses a body plan it has no kit for', () => {
    expect(() => animal(new Mesh(16), 'unicorn', stance)).toThrow('no kit');
    expect(() => plant(new Mesh(16), 'unicorn', undefined, 5, 1, 1, 0)).toThrow('no kit');
  });

  it.each(['conifer', 'broadleaf', 'palm'])('draws a %s as tall as its claim says, its trunk from the ground', (plan) => {
    const m = new Mesh(4096);
    plant(m, plan, undefined, 20, 12345, 1, 100);
    const { lo, hi } = bounds(m);
    expect(lo[2]).toBeLessThan(0);
    expect(hi[2]).toBeGreaterThan(20 * 0.8);
    expect(hi[2]).toBeLessThan(20 * 1.25);
    const far = new Mesh(64);
    plant(far, plan, undefined, 20, 12345, 0, 100);
    expect(far.verts).toBeLessThan(40);
    const top = bounds(far).hi[2];
    expect(top).toBeGreaterThan(20 * 0.8);
    expect(top).toBeLessThan(20 * 1.25);
  });

  it('draws a fern only close by, and what floats flat on the water', () => {
    const near = new Mesh(256);
    plant(near, 'fern', undefined, 1, 5, 1, 90);
    expect(near.verts).toBeGreaterThan(0);
    const far = new Mesh(16);
    plant(far, 'fern', undefined, 1, 5, 0, 90);
    expect(far.verts).toBe(0);
    const mat = new Mesh(64);
    plant(mat, 'fern', 'floating', 2, 5, 1, 90);
    const b = bounds(mat);
    expect(b.hi[2] - b.lo[2]).toBeLessThan(0.01);
    expect(b.hi[0] - b.lo[0]).toBeGreaterThan(1);
  });

  it('has a share of length for the hips of every animal plan', () => {
    for (const plan of ['ceratopsian', 'tyrannosaur', 'hadrosaur', 'ankylosaur', 'pachycephalosaur', 'ornithopod', 'small-theropod', 'crocodilian', 'turtle', 'small-mammal']) expect(HIP_SHARE[plan]).toBeGreaterThan(0);
  });
});

describe('the cells', () => {
  const builder = new SceneBuilder(BASE.file, BASE.grounds, BASE.plan);

  it('date each taxon by its record, in years from the slice', () => {
    const { file, grounds } = sampleFile();
    const shifted = { ...file, site: { ...file.site, slice: -66500000 } };
    shifted.taxa = shifted.taxa.map((t, i) => (i === 0 ? { ...t, time: span(-67000000, -66000000) } : t));
    const e = new SceneBuilder(shifted, grounds, BASE.plan).entities();
    const k = taxonEntity(0) * 4;
    expect(e[k]).toBe(sceneTime(-67000000, -66500000));
    expect(e[k]).toBe(-500000);
    expect(e[k + 1]).toBe(500000);
    // Everything is generated: its basis is procedural, as generated housing's is.
    expect(e[k + 2]).toBe(3);
  });

  it('make the same mesh each time, finer close by, each vertex naming its taxon', () => {
    const key = builder.cells().find((c) => builder.build(c, 1).verts > 2000)!;
    const a = builder.build(key, 1).arrays();
    const b = builder.build(key, 1).arrays();
    expect(new Uint8Array(a.vertices)).toEqual(new Uint8Array(b.vertices));
    expect(a.indices).toEqual(b.indices);
    expect(builder.build(key, 0).verts).toBeLessThan(builder.build(key, 1).verts);
    const ents = new Uint16Array(a.vertices);
    for (let v = 0; v < a.vertices.byteLength / 28; v += 97) {
      const entity = ents[v * 14 + 13];
      expect(entity).toBeGreaterThanOrEqual(1);
      expect(entity).toBeLessThanOrEqual(TAXA.length);
    }
  });

  it('name each group where it stands', () => {
    const labels = builder.labels();
    expect(labels.length).toBeGreaterThan(5);
    for (const l of labels) {
      expect(l.taxon).toBeLessThan(TAXA.length);
      expect(l.top).toBeGreaterThan(l.base);
    }
    // Only animals are named: there are too many plants to.
    expect(new Set(labels.map((l) => TAXA[l.taxon].plan)).has('conifer')).toBe(false);
  });

  it('paint the ground from the same plan: water where it is under the level, canopy and glade elsewhere', () => {
    const { data, box } = builder.mask(128, 2000);
    expect(box).toEqual([-2000, -2000, 2000, 2000]);
    let water = 0;
    let canopy = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255) water++;
      if (data[i] > 128) canopy++;
    }
    expect(water).toBeGreaterThan(30);
    expect(canopy).toBeGreaterThan(1000);
  });

  it('lay the water as one sheet at its level', () => {
    const w = builder.water();
    // It stops short of where the invented plain gives way to the reconstructed land.
    const reach = PARAMS.ground.blend[0];
    for (let k = 0; k < w.indices.length; k += 3) {
      const v = w.indices[k] * 3;
      expect(Math.sqrt(w.vertices[v] ** 2 + w.vertices[v + 1] ** 2)).toBeLessThan(reach);
    }
    for (let i = 2; i < w.vertices.length; i += 3) expect(w.vertices[i]).toBe(WATER);
    expect(Math.max(...w.indices)).toBeLessThan(w.vertices.length / 3);
  });
});
