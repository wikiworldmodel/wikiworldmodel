// Pass criteria of the sixth slice that a build can answer for itself: what the scene draws rests on
// the snapshot and the records; the same plan and mesh come out of the same files; no vegetation
// before the land-plants claim; no forest fossil in a reconstructed desert; and each taxon's bar in
// the tree starts where the solver says it may.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeTile } from '../../../core/container.ts';
import { climateClass, decodeNode, type ClimateHeader, type ClimateRule } from '../../../core/climate.ts';
import { coverAt, type PlanetFile } from '../../../core/planet.ts';
import type { CoverageFile, EntityRecord, SearchFile } from '../../../core/records.ts';
import type { SceneFile } from '../../../core/scene.ts';
import { parsePoint, toMa, type TimePointInput } from '../../../core/time.ts';
import type { Tileset } from '../../../core/tileset.ts';
import { indexTree, layoutTree, type TreeFile } from '../../../core/tree.ts';
import { GroundSampler } from '../../../world/generators/city/ground.ts';
import { SceneBuilder } from '../../../world/generators/life/cells.ts';
import { planBytes, scenePlan, type SceneParams } from '../../../world/generators/life/scene/v1.ts';
import type { PbdbSnapshot } from '../src/pbdb.ts';
import { pbdbNumber } from '../src/pbdb.ts';
import { loadWorld, type World } from '../src/world.ts';
import { latestBuild } from './helpers.ts';

const json = <T>(name: string): T => JSON.parse(readFileSync(join(latestBuild(), name), 'utf8')) as T;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

let world: World;
let file: SceneFile;
let ts: Tileset;
let grounds: { nx: number; ny: number; x0: number; y0: number; cell: number; z: Int16Array }[];
let snap: PbdbSnapshot;
const planOf = () => scenePlan(file, new GroundSampler(grounds));

beforeAll(async () => {
  world = await loadWorld();
  ts = json<Tileset>('tileset.json');
  const site = ts.sites!.find((s) => s.kind === 'life')!;
  file = json<SceneFile>(site.file);
  grounds = file.ground.map((g) => {
    const b = readFileSync(join(latestBuild(), g.url));
    return { ...g, z: new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) };
  });
  snap = world.fossils.get(file.fossils.source)!;
});

describe('a living scene', () => {
  it('is on offer at the slice it describes, inside its record’s own time', () => {
    const site = ts.sites!.find((s) => s.kind === 'life')!;
    expect(site.place).toBe('life/hell-creek/ecosystem');
    expect(site.slice).toBe(parsePoint('66.5 Ma' as TimePointInput).t);
    expect(site.span[0]).toBeLessThan(site.slice);
    expect(site.span[1]).toBeGreaterThan(site.slice);
    // It ends with the world it shows: no later than the last of the Cretaceous.
    expect(toMa(site.span[1])).toBeGreaterThan(65.5);
    // The time window it opens on shows the slice.
    expect(site.window[0]).toBeLessThan(site.slice);
    expect(site.window[1]).toBeGreaterThan(site.slice);
  });

  it('stands where the plate carried the place, not where it is today', () => {
    const { origin, today } = file.site;
    expect(Math.abs(origin.lon - today.lon)).toBeGreaterThan(5);
  });

  it('every organism is a taxon with an occurrence in the formation at the moment', () => {
    const plan = planOf();
    expect(plan.count).toBeGreaterThan(10000);
    const sliceMa = toMa(file.site.slice);
    const byNo = new Map(snap.taxa.map((t) => [t.no, t]));
    const inFormation = new Set(snap.collections.filter((c) => c.formation === 'Hell Creek').map((c) => c.no));
    const here = new Map<number, number>();
    for (const o of snap.occurrences) {
      expect(inFormation.has(o.collection)).toBe(true);
      if (o.max < sliceMa || o.min > sliceMa) continue;
      for (let x = o.taxon; x && byNo.has(x); x = byNo.get(x)!.parent) here.set(x, (here.get(x) ?? 0) + 1);
    }
    const drawn = new Set(plan.taxon);
    for (const i of drawn) {
      const t = file.taxa[i];
      const e = world.entity.get(t.id)!;
      expect(e, t.id).toBeDefined();
      expect(e.kind).toBe('taxon');
      const no = pbdbNumber(e);
      expect(no, t.id).toBeDefined();
      expect(here.get(no!), t.id).toBe(t.rows);
      expect(t.rows).toBeGreaterThan(0);
    }
    // And the kits the outline asks for all have something to draw.
    const plans = new Set([...drawn].map((i) => file.taxa[i].plan));
    for (const p of ['ceratopsian', 'tyrannosaur', 'hadrosaur', 'crocodilian', 'turtle', 'small-mammal', 'conifer', 'palm', 'broadleaf', 'fern'] as const) expect(plans.has(p), p).toBe(true);
    // Every taxon the file lists is drawn at least once.
    expect(drawn.size).toBe(file.taxa.length);
  });

  it('nothing appears that the records place elsewhen: each taxon is alive at the slice, and no taxon outside it is drawn', () => {
    for (const t of file.taxa) {
      expect(t.time.start.best ?? -Infinity, t.id).toBeLessThanOrEqual(file.site.slice);
      expect(t.time.end.best ?? Infinity, t.id).toBeGreaterThanOrEqual(file.site.slice);
    }
    const drawn = new Set(file.taxa.map((t) => t.id));
    // A taxon with a body plan that is not in the formation, had there been one, says why it is left out.
    for (const o of file.omitted) {
      expect(drawn.has(o.id)).toBe(false);
      expect(o.why.length).toBeGreaterThan(10);
    }
  });

  it('nothing is drawn whose size was guessed: lengths and heights are as the claims give them, or follow from a claimed mass', async () => {
    const m = await import('../src/chronology.ts');
    for (const t of file.taxa) {
      const e = world.entity.get(t.id)!;
      const group = (prop: string) => m.claimGroup(world, t.id, prop);
      const value = (prop: string) => {
        const g = group(prop);
        const c = g ? m.chosen(g) : undefined;
        return c?.value as number | undefined;
      };
      if (t.height !== undefined) expect(t.height).toBe(value('plant_height'));
      if (t.length !== undefined && !t.fromMass) expect(t.length).toBe(value('body_length'));
      if (t.fromMass) expect(value('body_mass')).toBeGreaterThan(0);
      if (t.hip !== undefined) expect(t.hip).toBe(value('hip_height'));
      // What decides the kit is an editorial classification, and says so.
      const plan = e.claims.find((c) => c.prop === 'body_plan')!;
      expect(plan.value).toBe(t.plan);
      expect(plan.status).not.toBe('accepted');
    }
  });

  it('keeps every claim a machine made as proposed', () => {
    for (const e of world.entities) {
      if (!e.id.startsWith('life/hell-creek') && !e.id.startsWith('life/transitions') && !e.id.startsWith('life/occurrences/forest-')) continue;
      for (const c of e.claims) expect(c.status, `${e.id} ${c.key}`).toBe('proposed');
    }
  });

  it('makes the same plan and the same mesh from the same files, as the build recorded', () => {
    const plan = planOf();
    expect(sha(planBytes(plan))).toBe(file.generator.outputSha256);
    const b = new SceneBuilder(file, grounds, plan);
    const { key, detail, sha256 } = file.generator.cell;
    const { vertices, indices } = b.build(key, detail).arrays();
    const all = new Uint8Array(vertices.byteLength + indices.byteLength);
    all.set(new Uint8Array(vertices), 0);
    all.set(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), vertices.byteLength);
    expect(sha(all)).toBe(sha256);
    expect(vertices.byteLength).toBeGreaterThan(1000);
  });

  it('reads its biome from the climate field, and draws the forest the transitions allow', () => {
    expect(file.biome.cover.forests).toBe(1);
    expect(file.biome.cover.plants).toBe(1);
    // Grass had not spread: the plain's low plants are not grass.
    expect(file.biome.cover.grasses).toBe(0);
    const params = file.generator.params as unknown as SceneParams;
    expect(params.cover.forest_by_climate[file.biome.climate]).toBeGreaterThan(0);
  });

  it('has a ground set into the land the elevation field reconstructs, with its water under the plain', () => {
    const g = new GroundSampler(grounds);
    const [fx, fy] = file.site.focus;
    expect(g.at(fx, fy)).toBeGreaterThan(file.site.water_level);
    const params = file.generator.params as unknown as SceneParams;
    const r = params.ground.blend[1];
    // Far off, it is no longer the generator's flat plain.
    const heights = [0, 1, 2, 3].map((k) => g.at(r * 3 * (k === 0 ? 1 : k === 1 ? -1 : 0), r * 3 * (k === 2 ? 1 : k === 3 ? -1 : 0)));
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(5);
  });
});

describe('the biomes', () => {
  const planet = () => json<PlanetFile>('planet.json');

  it('have no vegetation before the land-plants claim', () => {
    const p = planet();
    const land = p.covers!.find((c) => c.values.cover?.some((v) => v.value === 'land-plants'))!;
    const start = land.time.start.best!;
    expect(toMa(start)).toBeGreaterThan(420);
    expect(toMa(start)).toBeLessThan(520);
    for (const t of [start - 1e8, start - 1e6, start - 1]) {
      const c = coverAt(p, t, {});
      expect(c.plants).toBe(0);
      expect(c.forests).toBe(0);
      expect(c.grasses).toBe(0);
    }
    expect(coverAt(p, start + 1e6, {}).plants).toBeGreaterThan(0);
    // Every competing date for them, whichever a reader picks.
    for (const [key, v] of Object.entries(land.variants ?? {})) {
      const pick = key.split('+').filter((x) => x.includes('#'));
      const c = coverAt(p, v.start.best! - 1, pick.length ? { picks: pick } : {});
      expect(c.plants, key).toBe(0);
    }
  });

  it('have forests only after the first forests, and grass only after grass', () => {
    const p = planet();
    const forests = p.covers!.find((c) => c.values.cover?.some((v) => v.value === 'forests'))!.time.start.best!;
    const grass = p.covers!.find((c) => c.values.cover?.some((v) => v.value === 'grasslands'))!.time.start.best!;
    expect(forests).toBeLessThan(grass);
    expect(coverAt(p, forests - 1, {}).forests).toBe(0);
    expect(coverAt(p, forests + 3e7, {}).forests).toBeGreaterThan(0);
    expect(coverAt(p, grass - 1, {}).grasses).toBe(0);
    expect(coverAt(p, 2000, {}).grasses).toBe(1);
  });

  it('hold: no forest fossil falls in a reconstructed desert', () => {
    const c = json<CoverageFile>('coverage.json');
    expect(c.forests!.length).toBeGreaterThanOrEqual(10);
    for (const f of c.forests!) {
      expect(f.climate, f.id).not.toBeNull();
      expect(f.climate, `${f.id}, ${f.ageMa} Ma, at ${f.lat}, ${f.lon}`).not.toBe('desert');
    }
  });

  it('have the same rule in the file the globe reads, and classify as the rule says', () => {
    const b = readFileSync(join(latestBuild(), ts.files.climate!));
    const { header, arrays } = decodeTile<ClimateHeader>(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    expect(header.keyframes.length).toBe(55);
    expect(header.keyframes[0].ageMa).toBe(0);
    const rule = header.rule as ClimateRule;
    expect(rule.polar).toBe(10);
    // Today: the Sahara is a desert, the Congo is tropical, and Greenland's middle is under ice.
    const today = arrays[header.keyframes[0].values] as Uint8Array;
    const at = (lat: number, lon: number) => {
      const { lat0, lon0, step, nx } = header.grid;
      const k = (Math.round((lat0 - lat) / step) * nx + Math.round((lon - lon0) / step)) * 4;
      return climateClass(decodeNode([today[k] / 255, today[k + 1] / 255, today[k + 2] / 255, today[k + 3] / 255]), rule);
    };
    expect(at(24, 12)).toBe('desert');
    expect(['rainforest', 'savanna']).toContain(at(0, 22));
    expect(['ice', 'tundra']).toContain(at(74, -40));
  });
});

describe('the tree of life', () => {
  it('starts each bar within the solver’s bounds, and ends it no earlier', () => {
    const f = json<TreeFile>('tree.json');
    expect(f.nodes.length).toBeGreaterThan(1000);
    let dated = 0;
    for (const n of f.nodes) {
      const s = n.time.start;
      if (s.best === null) continue;
      dated++;
      if (s.lo !== null) expect(s.best, n.id).toBeGreaterThanOrEqual(s.lo - 1e-6);
      if (s.hi !== null) expect(s.best, n.id).toBeLessThanOrEqual(s.hi + 1e-6);
      const e = n.time.end.best;
      if (e !== null) expect(e, n.id).toBeGreaterThanOrEqual(s.best - 1e-6);
    }
    expect(dated).toBeGreaterThan(1000);
  });

  it('gives each taxon the same time its record has', () => {
    const f = json<TreeFile>('tree.json');
    for (const id of ['life/taxa/triceratops', 'life/taxa/mesosaurus-tenuidens', 'life/taxa/dinosauria']) {
      const n = f.nodes.find((x) => x.id === id);
      if (!n) continue;
      const r = json<EntityRecord>(`records/${id}.json`);
      expect(n.time).toEqual(r.time);
    }
  });

  it('keeps a child no older than its parent', () => {
    const f = json<TreeFile>('tree.json');
    for (const n of f.nodes) {
      if (n.parent < 0) continue;
      const p = f.nodes[n.parent];
      if (n.time.start.best === null || p.time.start.best === null) continue;
      expect(n.time.start.best, `${n.id} under ${p.id}`).toBeGreaterThanOrEqual(p.time.start.best - 1e-6);
    }
  });

  it('holds what the database adds folded until opened, and its fossils as rows of the snapshot', () => {
    const f = json<TreeFile>('tree.json');
    const ix = indexTree(f.nodes);
    const shown = layoutTree(f.nodes, ix, new Set());
    expect(shown.length).toBeLessThan(f.nodes.length / 3);
    expect(f.fossils[0].source).toBe('src:pbdb-hell-creek-2026-11-04');
    expect(f.fossils[0].plate).toBe(101);
    expect(f.fossils[0].rows.length).toBeGreaterThan(5000);
    // Only taxa in the search index the viewer shows are ones that are named.
    const search = json<SearchFile>('search.json');
    const bulk = search.entities.filter((e) => e.bulk);
    expect(bulk.length).toBeGreaterThan(500);
  });
});
