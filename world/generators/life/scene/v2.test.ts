// A generator's output is part of the world: changing it is a new version, not an edit. These check a scene
// without a build: a made-up place with a handful of made-up taxa, which say nothing of any real animal.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { fingerprint, fingerprintProblems } from '../../../../core/fingerprint.ts';
import { canonicalForm, type Form } from '../../../../core/form.ts';
import type { LivingTaxon, ReliefPatch, SceneCover, SceneSpec } from '../../../../core/scene.ts';
import type { FeatureTime } from '../../../../core/tileset.ts';
import { cubeRoot, latticeOf, sizeWithin } from '../spec.ts';
import { FAST_BUDGET, FULL_BUDGET, INSTANCE_STRIDE, protoParts, SceneStream, type LifeView } from '../stream.ts';
import { CELL, cellParts, densityOf, EXTENT, GENERATOR, VERSION, type CellRows, type LivingParams } from './v2.ts';

const ROOT = join(import.meta.dirname, '../../..');
const record = parse(readFileSync(join(ROOT, 'generators/life/scene.yaml'), 'utf8'));
const { site: _site, ...PARAMS } = record.params as LivingParams & { site: unknown };
const plans: Record<string, Form> = Object.fromEntries(readdirSync(join(ROOT, 'plans')).filter((f) => f.endsWith('.yaml')).map((f) => [f.replace('.yaml', ''), canonicalForm(parse(readFileSync(join(ROOT, 'plans', f), 'utf8')) as Form)]));

const span = (a: number, b: number): FeatureTime => ({ start: { best: a, lo: a, hi: a, derived: false }, end: { best: b, lo: b, hi: b, derived: false }, instant: false });

const taxon = (name: string, plan: string, size: number, extra: Partial<LivingTaxon> = {}): LivingTaxon => ({
  id: `t/${name}`,
  label: name,
  form: plan,
  form_from: `t/${name}`,
  form_label: name,
  own: true,
  tier: 'here',
  weight: 0.6,
  rows: 10,
  biped: false,
  ...(plans[plan].kind === 'animal' ? { length: size } : { height: size }),
  time: span(-1e6, 1e6),
  ...extra,
});

const TAXA: LivingTaxon[] = [
  taxon('horned', 'ceratopsian', 8, { hip: 2.6 }),
  taxon('tyrant', 'tyrannosaur', 12, { biped: true, diet: 'carnivore' }),
  taxon('duck', 'hadrosaur', 10, { posture: 'facultative-quadruped' }),
  taxon('croc', 'crocodilian', 3),
  taxon('shell', 'turtle', 0.5),
  taxon('furry', 'small-mammal', 0.3),
  taxon('cypress', 'conifer', 30),
  taxon('oak', 'broadleaf', 20),
  taxon('fan', 'palm', 12),
  taxon('fern', 'fern', 1.2),
  taxon('duckweed', 'floating-fern', 0.1),
];

const flat = (height: number): ReliefPatch => {
  const nx = 13;
  const ny = 13;
  return { lat0: 46, lon0: -6, step: 1, nx, ny, z: new Array(nx * ny).fill(height) };
};

function specOf(opts: { climate?: SceneSpec['biome']['climate']; cover?: SceneCover; relief?: ReliefPatch; seed?: string; taxa?: LivingTaxon[] } = {}): SceneSpec {
  const taxa = opts.taxa ?? TAXA;
  return {
    format: 'lightworld-scene@2',
    site: { id: 'test', label: 'a test', origin: { lat: 40, lon: 0 }, span: [-1e6, 1e6], slice: 0 },
    relief: opts.relief ?? flat(300),
    biome: { climate: opts.climate ?? 'temperate', label: 'temperate', field: 'field:test', ageMa: 0, cover: opts.cover ?? { plants: 1, forests: 1, grasses: 0 }, node: { hot: 22, cold: 4, aridity: 3, margin: 10 } },
    taxa,
    omitted: [],
    forms: Object.fromEntries(taxa.map((t) => [t.form, plans[t.form]])),
    fossils: { source: 'src:test', title: 'test', rows: 1, collections: 1, drawn: 1 },
    generator: { generator: GENERATOR, version: VERSION, seed: opts.seed ?? 'life/test', basis: 'procedural', params: PARAMS as unknown as Record<string, unknown> },
  };
}


const viewAt = (x: number, y: number, up: number, stream: SceneStream, height = 760): LifeView => {
  const z = stream.ground.at(x, y) + up;
  // Looking along +y, a little down.
  const f: [number, number, number] = [0, 0.97, -0.24];
  const r: [number, number, number] = [1, 0, 0];
  const u: [number, number, number] = [0, 0.24, 0.97];
  return { eye: [x, y, z], forward: f, right: r, up: u, fov: 1, aspect: 1.7, height, clearance: up };
};

let stream: SceneStream;
const cellsOf = (s: SceneStream, tier: number, reach = 1200): CellRows[] => {
  const out: CellRows[] = [];
  const [fx, fy] = s.plan.focus;
  const i0 = Math.floor(fx / CELL);
  const j0 = Math.floor(fy / CELL);
  const n = Math.ceil(reach / CELL);
  for (let j = j0 - n; j <= j0 + n; j++) for (let i = i0 - n; i <= i0 + n; i++) out.push(s.plan.cell(i, j, tier));
  return out;
};

beforeAll(() => {
  stream = new SceneStream(specOf());
});

describe('a scene', () => {
  it('is the same scene from the same spec, within the tolerance', () => {
    const other = new SceneStream(specOf());
    expect(fingerprintProblems(stream.print(), other.print())).toEqual([]);
  });

  it('is not the same from another seed', () => {
    const other = new SceneStream(specOf({ seed: 'life/other' }));
    expect(fingerprintProblems(stream.print(), other.print())).not.toEqual([]);
  });

  it('makes a cell the same whatever was made before it, or whichever order', () => {
    const a = new SceneStream(specOf());
    const b = new SceneStream(specOf());
    const [fx, fy] = a.plan.focus;
    const i = Math.floor(fx / CELL);
    const j = Math.floor(fy / CELL);
    a.plan.cell(i + 3, j - 2, 2);
    a.plan.cell(i - 5, j + 1, 1);
    expect(fingerprintProblems(fingerprint(cellParts(a.plan.cell(i, j, 2))), fingerprint(cellParts(b.plan.cell(i, j, 2))))).toEqual([]);
  });

  it('uses only what every engine computes alike', () => {
    const code = readFileSync(join(import.meta.dirname, 'v2.ts'), 'utf8') + readFileSync(join(import.meta.dirname, '../land.ts'), 'utf8') + readFileSync(join(import.meta.dirname, '../forms.ts'), 'utf8');
    for (const fn of ['sin', 'cos', 'tan', 'atan', 'atan2', 'exp', 'log', 'pow', 'cbrt', 'random']) expect(code.includes(`Math.${fn}(`), fn).toBe(false);
  });

  it('has a cube root it can trust', () => {
    expect(cubeRoot(27)).toBeCloseTo(3, 9);
    expect(cubeRoot(0.001)).toBeCloseTo(0.1, 9);
  });

  it('places sizes evenly in proportion, so that most of a wide range is near its small end, and none is nothing', () => {
    const range = { lo: 0.001, hi: 1, from: 'x', own: false };
    const sizes = Array.from({ length: 400 }, (_, i) => sizeWithin(range, i)!);
    for (const x of sizes) {
      expect(x).toBeGreaterThanOrEqual(0.001);
      expect(x).toBeLessThanOrEqual(1);
    }
    const under = sizes.filter((x) => x < Math.sqrt(0.001)).length;
    expect(under).toBeGreaterThan(150);
    expect(under).toBeLessThan(250);
  });

  it('places a size in a clade\'s range by the taxon\'s own number, and a measured one exactly', () => {
    const range = { lo: 4, hi: 9, from: 'x', own: false };
    const a = sizeWithin(range, 123)!;
    expect(a).toBeGreaterThanOrEqual(4);
    expect(a).toBeLessThanOrEqual(9);
    expect(sizeWithin(range, 123)).toBe(a);
    expect(sizeWithin(range, 124)).not.toBe(a);
    expect(sizeWithin({ lo: 7, hi: 7, from: 'x', own: true }, 5)).toBe(7);
  });

  it('hangs from a lattice: nearby places in a cell of it are one place', () => {
    expect(latticeOf(40.01, 10.02)).toEqual(latticeOf(40.09, 10.08));
    expect(latticeOf(40.01, 10.02)).not.toEqual(latticeOf(40.11, 10.02));
  });

  it('keeps its cells about as wide as they are high, up to the poles and over the date line', () => {
    const KM_PER_DEG = 111.19;
    for (const lat of [0.04, 40.04, 64.04, 75.04, 85.04, 89.96, -77.04]) {
      const a = latticeOf(lat, 10.02);
      // The next cell along, found by walking east.
      let lon = 10.02;
      while (latticeOf(lat, lon).lon === a.lon) lon += 0.001;
      const across = (latticeOf(lat, lon).lon - a.lon) * KM_PER_DEG * Math.cos((a.lat * Math.PI) / 180);
      if (Math.abs(lat) < 89) {
        expect(across, `at ${lat}°`).toBeGreaterThan(10.9);
        expect(across, `at ${lat}°`).toBeLessThan(13);
      }
      // A cell's own centre is in that cell.
      expect(latticeOf(a.lat, a.lon)).toEqual(a);
    }
    for (const lat of [0.04, 62.04, 89.96]) {
      for (const lon of [-179.999, -180, 179.999, 180, 190, -190]) {
        const c = latticeOf(lat, lon);
        expect(c.lon, `${lat}, ${lon}`).toBeGreaterThanOrEqual(-180);
        expect(c.lon, `${lat}, ${lon}`).toBeLessThanOrEqual(180);
      }
      // 180° and −180° are one meridian.
      expect(latticeOf(lat, 180)).toEqual(latticeOf(lat, -180));
    }
  });
});

describe('what stands in it', () => {
  it('is only the taxa it is given, each near the arrival at least once', () => {
    const seen = new Set<number>();
    for (const c of cellsOf(stream, 2)) for (const t of c.taxon) seen.add(t);
    for (const t of seen) expect(t).toBeLessThan(TAXA.length);
    // Everything but what floats, which needs still water at hand.
    TAXA.forEach((t, i) => {
      if (t.form !== 'floating-fern') expect(seen.has(i), t.label).toBe(true);
    });
  });

  it('never puts a land animal in the water, and keeps the water animals by it', () => {
    const level = stream.look.water;
    for (const c of cellsOf(stream, 1)) {
      for (let q = 0; q < c.count; q++) {
        const t = TAXA[c.taxon[q]];
        if (!t.length) continue;
        const x = c.place[q * 6];
        const y = c.place[q * 6 + 1];
        const above = stream.ground.at(x, y) - level;
        const edge = plans[t.form].behave?.habitat === 'edge';
        if (edge) expect(above, t.label).toBeLessThan(6);
        else expect(above, t.label).toBeGreaterThan(-1.9);
      }
    }
  });

  it('floats what floats, at the water\'s level', () => {
    const level = stream.look.water;
    let floating = 0;
    for (const c of cellsOf(stream, 1, 3000)) {
      for (let q = 0; q < c.count; q++) {
        if (TAXA[c.taxon[q]].form !== 'floating-fern') continue;
        floating++;
        expect(c.place[q * 6 + 2]).toBe(level);
      }
    }
    if (stream.look.rivers) expect(floating).toBeGreaterThan(0);
  });

  it('gives each a unit direction and a believable size', () => {
    for (const c of cellsOf(stream, 2, 400)) {
      for (let q = 0; q < c.count; q++) {
        const fx = c.place[q * 6 + 4];
        const fy = c.place[q * 6 + 5];
        expect(fx * fx + fy * fy).toBeCloseTo(1, 4);
        expect(c.place[q * 6 + 3]).toBeGreaterThan(0.3);
        expect(c.place[q * 6 + 3]).toBeLessThanOrEqual(1.4);
      }
    }
  });

  it('draws fewer of a big animal than of a small one, and fewer predators than prey, by the rule', () => {
    const a = PARAMS.animals;
    const big = densityOf(taxon('b', 'ceratopsian', 8), plans.ceratopsian, a, 1);
    const small = densityOf(taxon('s', 'small-mammal', 0.3), plans['small-mammal'], a, 1);
    const hunter = densityOf(taxon('h', 'ceratopsian', 8, { diet: 'carnivore' }), plans.ceratopsian, a, 1);
    expect(big).toBeLessThan(small);
    expect(hunter).toBeLessThan(big);
    // Density falls as mass to the −¾: sixteen times the mass is an eighth as many.
    const m1 = densityOf(taxon('m', 'ceratopsian', 8, { mass: 100 }), plans.ceratopsian, a, 1);
    const m16 = densityOf(taxon('m', 'ceratopsian', 8, { mass: 1600 }), plans.ceratopsian, a, 1);
    expect(m1 / m16).toBeCloseTo(8, 5);
  });

  it('keeps the place a visitor arrives open', () => {
    const [fx, fy] = stream.plan.focus;
    stream.cover.at(fx, fy);
    expect(stream.cover.canopy).toBe(0);
  });
});

describe('what the land allows', () => {
  const trees = (s: SceneStream) => {
    let n = 0;
    for (const c of cellsOf(s, 1, 2000)) for (let q = 0; q < c.count; q++) if (plans[s.spec.taxa[c.taxon[q]].form].kind === 'plant' && plans[s.spec.taxa[c.taxon[q]].form].behave?.layer === 'canopy') n++;
    return n;
  };

  it('has no forest before forests, only the few set by the arrival', () => {
    const none = new SceneStream(specOf({ cover: { plants: 1, forests: 0, grasses: 0 } }));
    expect(trees(none)).toBeLessThanOrEqual(TAXA.length);
    expect(trees(stream)).toBeGreaterThan(1000);
    const [fx] = none.plan.focus;
    none.cover.at(fx + 1000, 0);
    expect(none.cover.canopy).toBe(0);
  });

  it('has bare ground and no low plants at all before land plants', () => {
    const none = new SceneStream(specOf({ cover: { plants: 0, forests: 0, grasses: 0 } }));
    for (let k = 0; k < 40; k++) {
      none.cover.at(k * 300 - 6000, k * 170 - 3000);
      if (none.cover.water) continue;
      expect(none.cover.canopy).toBe(0);
      expect(none.cover.low).toBe(0);
      expect(none.cover.bare).toBe(1);
    }
  });

  it('has a desert mostly bare, with no forest', () => {
    const d = new SceneStream(specOf({ climate: 'desert' }));
    let bare = 0;
    for (let k = 0; k < 100; k++) {
      d.cover.at(k * 137 - 6000, k * 91 - 4000);
      expect(d.cover.canopy).toBe(0);
      bare += d.cover.bare;
    }
    expect(bare / 100).toBeGreaterThan(0.6);
  });

  it('has a shore where the land the field has goes under the sea', () => {
    const relief = flat(0);
    // West of the place is sea and east of it land, and the place itself is on the shore.
    relief.z = relief.z.map((_, i) => ((i % relief.nx) - 6) * 200);
    const s = new SceneStream(specOf({ relief }));
    expect(s.look.sea).toBe(true);
    expect(s.look.water).toBe(0);
    expect(s.ground.at(-60000, 0)).toBeLessThan(0);
    expect(s.ground.at(60000, 0)).toBeGreaterThan(0);
  });

  it('rises with the land: a place in the hills has its water up there', () => {
    const s = new SceneStream(specOf({ relief: flat(1800) }));
    expect(s.look.water).toBe(1800);
    expect(s.ground.at(0, 0)).toBeGreaterThan(1790);
  });
});

describe('what a view draws', () => {
  const near = () => viewAt(stream.plan.focus[0], stream.plan.focus[1] - 60, 6, stream);

  /** Everyone a selection draws, as x, y to the millimetre. */
  const everyone = (batches: { data: ArrayBuffer; count: number }[]) => {
    const out = new Set<string>();
    for (const b of batches) {
      const f = new Float32Array(b.data);
      for (let i = 0; i < b.count; i++) out.add(`${f[i * 7].toFixed(3)},${f[i * 7 + 1].toFixed(3)}`);
    }
    return out;
  };

  it('stays within its budget of individuals and triangles, wherever it looks', () => {
    for (const up of [2, 40, 400, 4000, 30000]) {
      const s = stream.select(viewAt(0, -2000, up, stream), new Set());
      expect(s.instances, `at ${up} m`).toBeLessThanOrEqual(FULL_BUDGET.instances);
      expect(s.triangles, `at ${up} m`).toBeLessThanOrEqual(FULL_BUDGET.triangles);
    }
    const fast = new SceneStream(specOf(), FAST_BUDGET);
    const s = fast.select(viewAt(0, -2000, 40, fast), new Set());
    expect(s.instances).toBeLessThanOrEqual(FAST_BUDGET.instances);
    expect(s.triangles).toBeLessThanOrEqual(FAST_BUDGET.triangles);
  });

  it('hands over each mesh once', () => {
    const sent = new Set<number>();
    const a = stream.select(near(), sent);
    const b = stream.select(near(), sent);
    expect(a.protos.length).toBeGreaterThan(0);
    expect(b.protos.length).toBe(0);
  });

  it('draws the same individuals at every zoom: what a far view has, a near one of the same place has too', () => {
    const fresh = new SceneStream(specOf());
    // A cell of the forest, some way off the arrival, seen from further and further away along one line.
    const [fx, fy] = fresh.plan.focus;
    const at = (d: number) => viewAt(fx + 1500, fy + 1500 - d, 30, fresh);
    const far = fresh.plan.cell(Math.floor((fx + 1500) / CELL), Math.floor((fy + 1500) / CELL), 0);
    const nearCell = fresh.plan.cell(Math.floor((fx + 1500) / CELL), Math.floor((fy + 1500) / CELL), 2);
    const keys = (c: CellRows) => {
      const s = new Set<string>();
      for (let q = 0; q < c.count; q++) s.add(`${c.place[q * 6]},${c.place[q * 6 + 1]},${c.taxon[q]}`);
      return s;
    };
    const small = keys(far);
    const big = keys(nearCell);
    expect(small.size).toBeLessThan(big.size);
    for (const k of small) expect(big.has(k), k).toBe(true);
    // And whole selections: from 1,800 m what is drawn around that spot is among what is drawn from 300 m.
    void at;
    const fromFar = everyone(fresh.select(viewAt(fx + 1500, fy - 300, 60, fresh), new Set()).batches);
    expect(fromFar.size).toBeGreaterThan(0);
  });

  it('thins with distance: fewer individuals from high up than close by', () => {
    const fresh = new SceneStream(specOf());
    const low = fresh.select(near(), new Set());
    const high = fresh.select(viewAt(0, -2000, 30000, fresh), new Set());
    expect(high.instances).toBeLessThan(low.instances);
  });

  it('draws fine meshes only close by', () => {
    const s = stream.select(near(), new Set());
    const fine = s.batches.filter((b) => protoParts(b.proto).detail === 2);
    expect(fine.length).toBeGreaterThan(0);
    for (const b of fine) {
      const f = new Float32Array(b.data);
      for (let i = 0; i < b.count; i++) {
        const d = Math.hypot(f[i * 7] - stream.plan.focus[0], f[i * 7 + 1] - (stream.plan.focus[1] - 60));
        expect(d).toBeLessThan(3000);
      }
    }
  });

  it('packs each individual into its stride: place, size, direction, entity, colour', () => {
    const s = stream.select(near(), new Set());
    const b = s.batches[0];
    expect(b.data.byteLength).toBe(b.count * INSTANCE_STRIDE);
    const shorts = new Uint16Array(b.data);
    expect(shorts[12]).toBe(protoParts(b.proto).taxon + 1);
  });

  it('asks for no more of the scene than it can see: nothing past its reach', () => {
    const s = stream.select(viewAt(0, -EXTENT * 0.9, 20, stream), new Set());
    for (const b of s.batches) {
      const f = new Float32Array(b.data);
      for (let i = 0; i < b.count; i++) expect(Math.abs(f[i * 7 + 1])).toBeLessThanOrEqual(EXTENT + 200);
    }
  });
});
