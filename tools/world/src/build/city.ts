// A city for the viewer (city/<site>.json and its ground): every structure on the site with its
// footprint in local metres, its times, its form and the ground it stands on. Written records
// and the map's imported ones go through the same path; what a form does not say is left for
// the generator to guess, and evidence mode shows it as such.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { formProblem, toLocal, type CityFile, type CityStructure, type FormSpec, type FormType } from '../../../../core/city.ts';
import type { Basis, FeatureTime } from '../../../../core/tileset.ts';
import { fabricPlan, planPrint, VERSION as FABRIC_VERSION, type FabricParams } from '../../../../world/generators/rome/fabric/v1.ts';
import { GroundSampler } from '../../../../world/generators/city/ground.ts';
import { elementKey, type LatLon, type OhmElement, type OhmSnapshot } from '../ohm.ts';
import { CACHE } from '../paths.ts';
import { sha256, stableStringify } from '../util.ts';
import type { Dataset, Entity } from '../world.ts';
import { carve, cityGrid, encodeGrid, flatten, hillsGrid, inRings, lowerAround, medianUnder, regionGrid, type FlatPlace, type GroundGrid } from './ground.ts';
import { claimOf, labeller, subjectTime, weakest, type Solved } from './records.ts';

const FABRIC = 'gen:rome/fabric';

/** A grid of a dataset, kept between builds: reading and smoothing the surveys takes a while. */
async function cachedGrid(name: string, keys: Dataset[], make: () => Promise<GroundGrid>): Promise<GroundGrid> {
  const key = sha256(stableStringify({ name, keys: keys.map((d) => d.fetch.sha256), reader: 4 })).slice(0, 16);
  const path = join(CACHE, 'import', `ground-${name}@${key}`);
  if (existsSync(`${path}.json`)) {
    const meta = JSON.parse(await readFile(`${path}.json`, 'utf8')) as Omit<GroundGrid, 'z'>;
    const b = await readFile(`${path}.bin`);
    return { ...meta, z: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) };
  }
  const g = await make();
  await mkdir(dirname(path), { recursive: true });
  const { z, ...meta } = g;
  await writeFile(`${path}.json`, JSON.stringify(meta));
  await writeFile(`${path}.bin`, Buffer.from(z.buffer, z.byteOffset, z.byteLength));
  return g;
}

const isClosed = (l: LatLon[]) => l.length > 3 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1];

/** Rings as flat local metres, to the centimetre, without the repeated last point. */
function flat(origin: { lat: number; lon: number }, l: LatLon[], closed: boolean): number[] {
  const out: number[] = [];
  const n = closed ? l.length - 1 : l.length;
  for (let i = 0; i < n; i++) {
    const [x, y] = toLocal(origin, l[i][0], l[i][1]);
    out.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
  }
  return out;
}

/** Twice the signed area of a flat ring. */
function ringArea(r: number[]): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1];
  return Math.abs(a) / 2;
}

/** The form a structure is raised from, when no claim gives one: from what kind of thing it is. */
const FORM_OF_KIND: Record<string, FormType> = {
  'building/temple': 'temple',
  'building/basilica': 'basilica',
  'building/baths': 'baths',
  'building/theatre': 'theatre',
  'building/amphitheatre': 'amphitheatre',
  'building/circus': 'circus',
  'building/palace': 'palace',
  'building/market': 'market',
  'building/warehouse': 'warehouse',
  'building/barracks': 'barracks',
  'building/tomb': 'mausoleum',
  'monument/arch': 'arch',
  'monument/column': 'column',
  'monument/obelisk': 'obelisk',
  'monument/statue': 'statue',
  'monument/fountain': 'fountain',
  'works/wall': 'wall',
  'works/gate': 'gate',
  'works/aqueduct': 'aqueduct',
  'works/bridge': 'bridge',
  'open/forum': 'court',
};

/** The kinds a city draws, with or without a form. */
const DRAWN = /^(building|monument|works|open)(\/|$)/;

export interface CityBuild {
  file: CityFile;
  blobs: Map<string, Uint8Array>;
}

export async function buildCity(s: Solved, log: (m: string) => void): Promise<CityBuild | undefined> {
  const w = s.world;
  const gen = w.generators.find((g) => g.id === FABRIC);
  const datasetId = [...w.snapshots.keys()][0];
  if (!gen || !datasetId) return undefined;
  const snap = w.snapshots.get(datasetId) as OhmSnapshot;
  const elements = new Map(snap.elements.map((e) => [elementKey(e), e]));
  const params = gen.params as unknown as FabricParams;
  const site = params.site;
  const origin = site.origin;
  const labelOf = labeller(s);

  // The river and its island. The map has a reach of the river both as a relation and as the way
  // it is made of, so each outline is kept once.
  const outlines = { water: new Map<string, number[]>(), islands: new Map<string, number[]>() };
  const keep = (into: Map<string, number[]>, r: number[]) => into.set(r.join(), r);
  for (const e of snap.elements) {
    if (e.tags.natural === 'water' && !e.tags.start_date) {
      if (e.line && isClosed(e.line)) keep(outlines.water, flat(origin, e.line, true));
      for (const r of e.outer ?? []) if (isClosed(r)) keep(outlines.water, flat(origin, r, true));
      for (const r of e.inner ?? []) if (isClosed(r)) keep(outlines.islands, flat(origin, r, true));
    }
    if (e.tags.name === 'Insula Tiberina' && e.line && isClosed(e.line)) keep(outlines.islands, flat(origin, e.line, true));
  }
  const water = [...outlines.water.values()];
  const islands = [...outlines.islands.values()];

  // The structures, without their ground for now.
  const structures: CityStructure[] = [];
  const flats: { s: CityStructure; level?: number; area: number }[] = [];
  const alive = (t: FeatureTime, y: number) => (t.start.best ?? -Infinity) <= y && y <= (t.end.best ?? Infinity);
  for (const e of w.entities) {
    if (!DRAWN.test(e.kind) || e.kind === 'open/region') continue;
    const st = structureOf(s, e, elements, origin, labelOf);
    if (!st) continue;
    structures.push(st.structure);
    const area = st.structure.rings.reduce((a, r) => a + ringArea(r), 0);
    const flatKind = /^(building|monument)/.test(e.kind) || e.kind === 'open/forum' || e.kind === 'open/square';
    if (flatKind && st.structure.kind !== 'open/district' && area >= 20 && area < 250000 && alive(st.structure.time, site.slice)) flats.push({ s: st.structure, level: st.level, area });
  }
  structures.sort((a, b) => (a.id < b.id ? -1 : 1));
  // What the map draws as parts of a monument a record has written: the record's form raises it whole.
  const whole = structures.filter((x) => x.curated && x.rings.length);
  const inWhole = (x: CityStructure) => whole.some((c) => c.id !== x.id && c.rings.some((r) => inRings([r], x.at[0], x.at[1])));
  for (let i = structures.length - 1; i >= 0; i--) {
    const x = structures[i];
    if (!x.curated && x.kind === 'building/other' && /map does not name/.test(x.label) && inWhole(x)) structures.splice(i, 1);
  }

  // The ground: the city's survey, lowered to the structures' levels, the river carved in.
  const [city, hills, region] = await Promise.all([
    cachedGrid('city', [w.manifest.datasets['src:tinitaly-1.1-w46075']], () => cityGrid(w, origin)),
    cachedGrid('hills', [w.manifest.datasets['src:srtm-gl1-n41e012'], w.manifest.datasets['src:srtm-gl1-n42e012']], () => hillsGrid(w, origin)),
    cachedGrid('region', [w.manifest.datasets['src:etopo-2022-n45e000'], w.manifest.datasets['src:etopo-2022-n45e015']], () => regionGrid(w, origin)),
  ]);
  carve(city, water, islands, site.water_level, 70);
  // Where a record gives the ancient level, the valley around it lies buried under today's ground:
  // bring it down first, so that its neighbours stand at that level too.
  for (const f of flats) if (f.level !== undefined) lowerAround(city, f.s.at[0], f.s.at[1], f.level, 260);
  for (const f of flats.sort((a, b) => b.area - a.area)) {
    if (!structures.includes(f.s)) continue;
    const level = f.level ?? medianUnder(city, f.s.rings);
    f.s.base = Math.round(level * 100) / 100;
    const place: FlatPlace = { rings: f.s.rings, level, margin: Math.max(14, Math.min(45, Math.sqrt(f.area) * 0.25)) };
    flatten(city, place);
  }
  const blobs = new Map<string, Uint8Array>();
  const ground = [city, hills, region].map((g, i) => {
    const url = `city/${site.id}/ground-${i}.bin`;
    blobs.set(url, encodeGrid(g));
    return { url, ...gridMeta(g) };
  });
  // The generators read the ground as the viewer will: the same integers from the same files.
  const sampler = new GroundSampler(ground.map((g) => ({ ...g, z: new Int16Array(blobs.get(g.url)!.buffer) })));
  for (const st of structures) if (st.base === 0) st.base = Math.round(sampler.at(st.at[0], st.at[1]) * 100) / 100;

  // The constraints of the housing: each region, and what the catalogues count there.
  const regions = w.entities
    .filter((e) => e.kind === 'open/region')
    .map((e) => {
      const loc = claimOf(s, e.id, 'location')!.value as { lat: number; lon: number };
      const [x, y] = toLocal(origin, loc.lat, loc.lon);
      const ins = claimOf(s, e.id, 'insulae');
      const dom = claimOf(s, e.id, 'domus');
      return { id: e.id, label: labelOf(e.id), at: [Math.round(x), Math.round(y)] as [number, number], insulae: ins?.value as number | undefined, domus: dom?.value as number | undefined };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const seed = gen.slots.rome.seed;
  const file: CityFile = {
    format: 'lightworld-city@1',
    site: { id: site.id, label: site.label, origin, span: site.span, slice: site.slice, water_level: site.water_level },
    ground,
    structures,
    water,
    islands,
    fabric: { generator: gen.id, version: gen.version, seed, basis: 'procedural', params: gen.params, regions, output: {} },
  };
  if (gen.version !== FABRIC_VERSION) throw new Error(`${FABRIC}: the record is version ${gen.version}, the code version ${FABRIC_VERSION}`);
  const plan = fabricPlan(file, sampler);
  file.fabric.output = planPrint(plan);
  log(`city    ${site.id}: ${structures.length} structures, ${structures.filter((x) => x.curated).length} written by hand; ${plan.lots} generated buildings, ${plan.treeCount} trees`);
  return { file, blobs };
}

const gridMeta = (g: GroundGrid) => ({ nx: g.nx, ny: g.ny, x0: g.x0, y0: g.y0, cell: g.cell });

/** One entity as a structure: its footprint from the snapshot, its claims resolved. */
/** The point inside a ring nearest to (x, y), among the midpoints across it from each vertex. */
function pointInside(r: number[], x: number, y: number): [number, number] {
  const n = r.length / 2;
  let best: [number, number] = [r[0], r[1]];
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + (n >> 1)) % n;
    const mx = (r[i * 2] + r[j * 2]) / 2;
    const my = (r[i * 2 + 1] + r[j * 2 + 1]) / 2;
    const d = (mx - x) * (mx - x) + (my - y) * (my - y);
    if (d < bd && inRings([r], mx, my)) {
      bd = d;
      best = [mx, my];
    }
  }
  return best;
}

function structureOf(s: Solved, e: Entity, elements: Map<string, OhmElement>, origin: { lat: number; lon: number }, labelOf: (r: string) => string): { structure: CityStructure; level?: number } | undefined {
  const fp = claimOf(s, e.id, 'footprint');
  const loc = claimOf(s, e.id, 'location');
  if (!loc) return undefined;
  const rings: number[][] = [];
  const holes: number[][] = [];
  const lines: number[][] = [];
  const look: Record<string, string> = {};
  for (const key of (fp?.value as { elements?: string[] } | undefined)?.elements ?? []) {
    const el = elements.get(key);
    if (!el) continue;
    for (const k of ['building:colour', 'roof:colour', 'roof:shape', 'roof:height', 'min_height', 'building:levels', 'highway', 'surface', 'bridge', 'tunnel', 'layer']) if (el.tags[k] && !look[k]) look[k] = el.tags[k];
    if (el.line) (isClosed(el.line) && !el.tags.highway && !el.tags.barrier && !el.tags.waterway ? rings : lines).push(flat(origin, el.line, isClosed(el.line) && !el.tags.highway && !el.tags.barrier && !el.tags.waterway));
    for (const r of el.outer ?? []) (isClosed(r) ? rings : lines).push(flat(origin, r, isClosed(r)));
    for (const r of el.inner ?? []) if (isClosed(r)) holes.push(flat(origin, r, true));
  }
  // A wall drawn as a closed ring is still a wall: a line, not a floor plan.
  if (e.kind === 'works/wall' || e.kind === 'works/aqueduct' || e.kind === 'works/road') while (rings.length) lines.push(rings.pop()!.concat());
  const p = loc.value as { lat: number; lon: number };
  let [ax, ay] = toLocal(origin, p.lat, p.lon);
  // The middle of a bend of the river is on land: a name for it belongs on the water.
  if (e.kind === 'open/water' && rings[0] && !inRings([rings[0]], ax, ay)) [ax, ay] = pointInside(rings[0], ax, ay);
  const formClaim = claimOf(s, e.id, 'form');
  const type = (formClaim?.value as FormSpec | undefined)?.type ?? FORM_OF_KIND[e.kind] ?? 'generic';
  const form: FormSpec = formClaim && !formProblem(formClaim.value) ? (formClaim.value as FormSpec) : { type };
  const height = claimOf(s, e.id, 'height')?.value as number | undefined;
  const level = claimOf(s, e.id, 'ground_level')?.value as number | undefined;
  const { time, variants } = subjectTime(s, e.id);
  const curated = !e.id.startsWith('rome/ohm/');
  const area = rings.reduce((a, r) => a + ringArea(r), 0);
  // What the map outlines at this size is an estate or a quarter, not a building: nothing is raised on it.
  const kind = !curated && area > 120000 && e.kind.startsWith('building') ? 'open/district' : e.kind;
  const named = !labelOf(e.id).includes('the map does not name') && !labelOf(e.id).startsWith('A stretch');
  const rank = e.kind === 'works/road' || e.kind === 'works/wall' ? (curated ? 2 : 3) : !named ? 3 : curated ? (area >= 12000 ? 0 : area >= 800 ? 1 : 2) : area >= 6000 ? 1 : 2;
  const bases: Basis[] = [fp?.basis ?? 'reconstruction', formClaim?.basis ?? 'reconstruction'];
  return {
    level,
    structure: {
      id: e.id,
      label: labelOf(e.id),
      kind,
      form,
      rings,
      holes: holes.length ? holes : undefined,
      lines: lines.length ? lines : undefined,
      at: [Math.round(ax * 100) / 100, Math.round(ay * 100) / 100],
      base: level ?? 0,
      height,
      time,
      variants,
      basis: weakest(bases),
      curated,
      rank,
      look: Object.keys(look).length ? look : undefined,
    },
  };
}
