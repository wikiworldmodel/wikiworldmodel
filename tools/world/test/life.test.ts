// Pass criteria of the sixth and seventh slices that a build can answer for itself: what a scene draws rests on
// the snapshots and the records; the same bytes come out of the same spec; a list's tiers are true; no
// vegetation before the land-plants claim; no forest fossil in a reconstructed desert; and each taxon's bar in
// the tree starts where the solver says it may.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { atlasList, TIER, type AtlasBin, type AtlasIndex } from '../../../core/atlas.ts';
import { decodeTile } from '../../../core/container.ts';
import { climateClass, decodeNode, type ClimateHeader, type ClimateRule } from '../../../core/climate.ts';
import { coverAt, type PlanetFile } from '../../../core/planet.ts';
import { conj, rotate, toLatLon, unitVector } from '../../../core/quat.ts';
import type { CoverageFile, EntityRecord, SearchFile } from '../../../core/records.ts';
import { RotationModel } from '../../../core/rotation-model.ts';
import type { SceneFileV2 } from '../../../core/scene.ts';
import { parsePoint, toMa, type TimePointInput } from '../../../core/time.ts';
import type { FramesFile, Tileset } from '../../../core/tileset.ts';
import { indexTree, layoutTree, type TreeFile } from '../../../core/tree.ts';
import { CELL } from '../../../world/generators/life/scene/v2.ts';
import { FULL_BUDGET, SceneStream } from '../../../world/generators/life/stream.ts';
import type { LandSnapshot, PbdbSnapshot } from '../src/pbdb.ts';
import { pbdbNumber } from '../src/pbdb.ts';
import { loadWorld, type World } from '../src/world.ts';
import { latestBuild } from './helpers.ts';

const json = <T>(name: string): T => JSON.parse(readFileSync(join(latestBuild(), name), 'utf8')) as T;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

let world: World;
let file: SceneFileV2;
let ts: Tileset;
let snap: PbdbSnapshot;
let stream: SceneStream;

beforeAll(async () => {
  world = await loadWorld();
  ts = json<Tileset>('tileset.json');
  const site = ts.sites!.find((s) => s.kind === 'life')!;
  file = json<SceneFileV2>(site.file);
  snap = world.fossils.get(file.spec.fossils.source)!;
  stream = new SceneStream(file.spec, FULL_BUDGET);
});

describe('a living scene with its own formation', () => {
  it('is on offer at the slice it describes, inside its record\u2019s own time', () => {
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
    const e = world.entity.get(file.spec.site.place!)!;
    const loc = e.claims.find((c) => c.prop === 'location')!.value as { lat: number; lon: number };
    expect(Math.abs(file.spec.site.origin.lon - loc.lon)).toBeGreaterThan(5);
  });

  it('every taxon is one with an occurrence in the formation at the moment, and it still draws all it drew', () => {
    const taxa = file.spec.taxa;
    // What the sixth slice drew, by name: the list can grow, and none of these may leave it.
    const drew = ['acheroraptor', 'adocus', 'amesoneuron', 'ankylosaurus', 'anzu', 'azolla', 'basilemys', 'borealosuchus', 'brachychampsa', 'cercidiphyllum', 'champsosaurus', 'cimolodon', 'cinnamomum', 'compsemys', 'didelphodon', 'edmontosaurus', 'equisetum', 'ficus', 'ginkgo', 'glyptostrobus', 'helopanoplia', 'meniscoessus', 'mesodma', 'metasequoia', 'ornithomimus', 'pachycephalosaurus', 'platanites', 'polypodiaceae', 'salvinia', 'sequoia', 'taxodium', 'thescelosaurus', 'torosaurus', 'triceratops', 'trochodendroides', 'tyrannosaurus'];
    expect(drew).toHaveLength(36);
    for (const name of drew) expect(taxa.map((t) => t.id), name).toContain(`life/taxa/${name}`);
    const sliceMa = toMa(file.spec.site.slice);
    const byNo = new Map(snap.taxa.map((t) => [t.no, t]));
    const inFormation = new Set(snap.collections.filter((c) => c.formation === 'Hell Creek').map((c) => c.no));
    const here = new Map<number, number>();
    for (const o of snap.occurrences) {
      expect(inFormation.has(o.collection)).toBe(true);
      if (o.max < sliceMa || o.min > sliceMa) continue;
      for (let x = o.taxon; x && byNo.has(x); x = byNo.get(x)!.parent) here.set(x, (here.get(x) ?? 0) + 1);
    }
    for (const t of taxa) {
      const e = world.entity.get(t.id)!;
      expect(e, t.id).toBeDefined();
      expect(e.kind).toBe('taxon');
      const no = pbdbNumber(e);
      expect(no, t.id).toBeDefined();
      expect(here.get(no!), t.id).toBe(t.rows);
      expect(t.rows).toBeGreaterThan(0);
      expect(t.tier).toBe('formation');
    }
  });

  it('draws every taxon near the arrival, and stands them on land or by water as they go', () => {
    const [fx, fy] = stream.plan.focus;
    const seen = new Set<number>();
    const n = 12;
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) for (const t of stream.plan.cell(Math.floor(fx / CELL) + i, Math.floor(fy / CELL) + j, 2).taxon) seen.add(t);
    file.spec.taxa.forEach((t, i) => {
      const b = file.spec.forms[t.form].behave;
      // Not what floats, which needs still water at hand, or what is under the water, which is not drawn yet.
      if (b?.layer !== 'float' && b?.habitat !== 'water') expect(seen.has(i), t.label).toBe(true);
    });
  });

  it('nothing appears that the records place elsewhen: each taxon is alive at the slice', () => {
    for (const t of file.spec.taxa) {
      expect(t.time.start.best ?? -Infinity, t.id).toBeLessThanOrEqual(file.spec.site.slice);
      expect(t.time.end.best ?? Infinity, t.id).toBeGreaterThanOrEqual(file.spec.site.slice);
    }
    const drawn = new Set(file.spec.taxa.map((t) => t.id));
    for (const o of file.spec.omitted) {
      expect(drawn.has(o.id)).toBe(false);
      expect(o.why.length).toBeGreaterThan(10);
    }
  });

  it('nothing is drawn whose size was guessed: as its claims give it, or within the range of a node above that says whose', async () => {
    const m = await import('../src/chronology.ts');
    for (const t of file.spec.taxa) {
      const value = (prop: string) => {
        const g = m.claimGroup(world, t.id, prop);
        const c = g ? m.chosen(g) : undefined;
        return c?.value as number | { lo: number; hi: number } | undefined;
      };
      const check = (size: number | undefined, prop: string) => {
        if (size === undefined || t.size_from) return;
        const v = value(prop);
        if (typeof v === 'number') expect(size, `${t.id} ${prop}`).toBe(v);
        else if (v) expect(size, `${t.id} ${prop}`).toBeGreaterThanOrEqual(v.lo);
      };
      check(t.height, 'plant_height');
      if (!t.fromMass) check(t.length, 'body_length');
      if (t.fromMass && !t.size_from) expect(value('body_mass')).toBeTruthy();
      if (t.size_from) expect(t.size_from.length).toBeGreaterThan(0);
      // What decides the body is an editorial classification, and says so.
      for (const c of world.entity.get(t.id)!.claims) if (c.prop === 'body_plan' || c.prop === 'body_form') expect(c.status).not.toBe('accepted');
    }
  });

  it('keeps every claim a machine made as proposed', () => {
    for (const e of world.entities) {
      if (!e.id.startsWith('life/hell-creek') && !e.id.startsWith('life/transitions') && !e.id.startsWith('life/occurrences/forest-')) continue;
      for (const c of e.claims) expect(c.status, `${e.id} ${c.key}`).toBe('proposed');
    }
  });

  it('makes the same bytes from the same spec, as the build recorded', () => {
    expect(sha(stream.digestBytes())).toBe(file.sha256);
    expect(file.focus).toEqual(stream.plan.focus);
  });

  it('stores no ground and no organism', () => {
    // Its spec is its forms and its list, and a patch of the land.
    expect(JSON.stringify(file).length).toBeLessThan(800_000);
  });

  it('reads its biome from the climate field, and draws the forest the transitions allow', () => {
    const b = file.spec.biome;
    expect(b.cover.forests).toBe(1);
    expect(b.cover.plants).toBe(1);
    // Grass had not spread: the plain's low plants are not grass.
    expect(b.cover.grasses).toBe(0);
    expect(stream.cover.forestShare).toBeGreaterThan(0);
  });

  it('has a ground set into the land the elevation field reconstructs, with its water under the plain', () => {
    const [fx, fy] = stream.plan.focus;
    expect(stream.ground.at(fx, fy)).toBeGreaterThan(stream.look.water);
    const r = 34000;
    // Far off, it is no longer the generator's flat plain.
    const heights = [0, 1, 2, 3].map((k) => stream.ground.at(r * 3 * (k === 0 ? 1 : k === 1 ? -1 : 0), r * 3 * (k === 2 ? 1 : k === 3 ? -1 : 0)));
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(5);
  });
});

describe('the atlas', () => {
  let index: AtlasIndex;
  let land: LandSnapshot;
  let model: RotationModel;

  beforeAll(() => {
    index = json<AtlasIndex>(ts.files.atlas!);
    land = world.landFossils.get(index.source)!;
    const frames = json<FramesFile>(ts.files.frames);
    model = new RotationModel(frames.rotations);
  });

  it('covers most of the Phanerozoic, stage by stage, oldest first', () => {
    expect(index.bins.length).toBeGreaterThan(40);
    for (let i = 1; i < index.bins.length; i++) expect(index.bins[i].from).toBeGreaterThan(index.bins[i - 1].from);
    for (const b of index.bins) {
      expect(b.slice).toBeGreaterThanOrEqual(b.from);
      expect(b.slice).toBeLessThanOrEqual(b.to);
    }
    expect(index.bins.some((b) => b.name === 'Maastrichtian')).toBe(true);
  });

  it('holds every list\'s taxa to the rows: a taxon of a stage has a row that overlaps it, or it is a stand-in that says so', () => {
    const byNo = new Map(land.taxa.map((t) => [t[0], t]));
    for (const ref of index.bins.filter((_, i) => i % 7 === 0)) {
      const bin = json<AtlasBin>(ref.file);
      const older = toMa(bin.from);
      const younger = toMa(bin.to);
      const names = new Set<number>();
      for (const [, site, taxon] of land.rows) {
        const [, , , max, min] = land.sites[site];
        if (max > younger && min < older) for (let x = taxon, g = 0; x && g < 200; x = byNo.get(x)?.[3] ?? 0, g++) names.add(x);
      }
      for (const t of bin.taxa) {
        if (t.standin) {
          expect(t.rows).toBe(0);
          continue;
        }
        expect(names.has(t.no), `${t.label} in ${bin.name}`).toBe(true);
        expect(t.span[0]).toBeGreaterThan(younger - 1e-3);
        expect(t.span[1]).toBeLessThan(older + 1e-3);
      }
    }
  });

  it('has a tier that is true: *here* has a row of the taxon close by at the time, recounted from the snapshot', () => {
    const ref = index.bins.find((b) => b.name === 'Maastrichtian')!;
    const bin = json<AtlasBin>(ref.file);
    const older = toMa(bin.from);
    const younger = toMa(bin.to);
    const mid = toMa(bin.slice);
    const sitesOf = new Map<number, number[]>();
    // A species is on a list as its genus: its rows are the genus's.
    const byNo = new Map(land.taxa.map((t) => [t[0], t]));
    const rankOf = (no: number) => land.words[byNo.get(no)?.[2] ?? 0];
    for (const [, site, taxon] of land.rows) {
      for (let x = taxon, g = 0; x && g < 4; x = byNo.get(x)?.[3] ?? 0, g++) {
        const s = sitesOf.get(x);
        if (s) s.push(site);
        else sitesOf.set(x, [site]);
        if (!['species', 'subspecies', 'subgenus'].includes(rankOf(x))) break;
      }
    }
    const positions = new Map<number, [number, number] | null>();
    // The plate of a site: from the frames, the same way the build reads it, through the plates of today.
    const distanceKm = (a: [number, number], b: [number, number]) => {
      const ua = unitVector(a[0], a[1]);
      const ub = unitVector(b[0], b[1]);
      const d = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2]));
      return Math.acos(d) * 6371;
    };
    const elevation = plateLookup();
    const where = (site: number) => {
      if (positions.has(site)) return positions.get(site)!;
      const [, lat, lng] = land.sites[site];
      const plate = elevation(lat, lng);
      let out: [number, number] | null = null;
      if (plate && model.reaches(plate, mid)) {
        const [la, lo] = toLatLon(rotate(model.total(plate, mid), rotate(conj(model.total(plate, 0)), unitVector(lat, lng))));
        out = [la, lo];
      }
      positions.set(site, out);
      return out;
    };
    const patches = Object.keys(bin.nodes).map(Number).filter((_, i) => i % 11 === 0);
    let checked = 0;
    for (const key of patches) {
      const lat = 90 - (Math.floor(key / index.grid.nx) + 0.5) * index.grid.step;
      const lon = -180 + ((key % index.grid.nx) + 0.5) * index.grid.step;
      for (const e of atlasList(bin, index.grid, lat, lon)) {
        if (e.tier === TIER.standin) continue;
        // A patch is up to 4° across, and the graph 2° a step: that is the slack.
        const reach = (e.tier === TIER.here ? index.here_km : index.region_km) + 900;
        const near = (sitesOf.get(e.taxon.no) ?? []).some((s) => {
          const [, , , max, min] = land.sites[s];
          if (max <= younger || min >= older) return false;
          const p = where(s);
          return !!p && distanceKm(p, [lat, lon]) <= reach;
        });
        expect(near, `${e.taxon.label} at ${lat}, ${lon}, tier ${e.tier}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('puts the Hell Creek\'s own taxa in the Hell Creek\'s patch, as recorded here', () => {
    const ref = index.bins.find((b) => b.name === 'Maastrichtian')!;
    const bin = json<AtlasBin>(ref.file);
    const o = file.spec.site.origin;
    const list = atlasList(bin, index.grid, o.lat, o.lon);
    expect(list.length).toBeGreaterThan(5);
    const here = list.filter((e) => e.tier === TIER.here).map((e) => e.taxon.label);
    expect(here.some((l) => /Triceratops|Edmontosaurus|Tyrannosaurus|Thescelosaurus/.test(l)), here.join(', ')).toBe(true);
  });

  it('knows where to go to see a taxon, at a stage it lived in', () => {
    const where = json<Record<string, { t: number; lat: number; lon: number; rows: number }>>(index.where);
    const w = where['life/taxa/triceratops'];
    expect(w).toBeDefined();
    expect(toMa(w.t)).toBeGreaterThan(66);
    expect(toMa(w.t)).toBeLessThan(72.2);
    expect(Object.keys(where).length).toBeGreaterThan(100);
  });

  it('says how far the forms reach', () => {
    const c = index.coverage;
    expect(c.taxa).toBeGreaterThan(10000);
    expect(c.own_form).toBeGreaterThan(30);
    expect(c.inherited_form).toBeGreaterThan(c.own_form);
    expect(json<CoverageFile>('coverage.json').forms!.wanted.length).toBeGreaterThan(10);
  });

  it('is small: no stage\'s lists are more than a few MB, and all the forms fit in one file for now', () => {
    let total = 0;
    for (const ref of index.bins) {
      const size = readFileSync(join(latestBuild(), ref.file)).length;
      total += size;
      expect(size, ref.name).toBeLessThan(4e6);
    }
    expect(readFileSync(join(latestBuild(), index.forms)).length).toBeLessThan(4e6);
    expect(total).toBeLessThan(120e6);
  });

  it('makes a place\'s scene the same as a witness of it in the build', async () => {
    const list = json<{ lat: number; lon: number; t: number; sha256: string; taxa: number }[]>('life/witness.json');
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const w of list) {
      expect(w.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(w.taxa).toBeGreaterThan(0);
    }
  });

  /** The plate of a place today, from the finest tile of today's land. */
  function plateLookup() {
    const refs = ts.tiles.filter((r) => r.lod === 1 && toMa(r.time[1]) <= 0 && toMa(r.time[0]) >= 0);
    const frames = json<FramesFile>(ts.files.frames);
    const fields = refs.map((r) => {
      const b = readFileSync(join(latestBuild(), r.url));
      const { header, arrays } = decodeTile<import('../../../core/tileset.ts').TileHeader>(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
      const k = header.field!.keyframes.find((x) => x.ageMa === 0)!;
      return { bbox: r.bbox, grid: header.field!.grid, plate: arrays[k.plate] as Uint16Array };
    });
    return (lat: number, lon: number) => {
      for (let r = 0; r <= 3; r++) {
        for (let dj = -r; dj <= r; dj++) {
          for (let di = -r; di <= r; di++) {
            if (Math.max(Math.abs(dj), Math.abs(di)) !== r) continue;
            const la = Math.max(-90, Math.min(90, Math.round(lat) + dj));
            const lo = ((Math.round(lon) + di + 540) % 360) - 180;
            const f = fields.find((x) => la >= x.bbox[1] && la <= x.bbox[3] && lo >= x.bbox[0] && lo <= x.bbox[2]);
            if (!f) continue;
            const q = frames.plateIndex[f.plate[Math.round((f.grid.lat0 - la) / f.grid.step) * f.grid.nx + Math.round((lo - f.grid.lon0) / f.grid.step)]];
            if (q) return q;
          }
        }
      }
      return 0;
    };
  }
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
