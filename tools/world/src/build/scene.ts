// A living scene for the viewer (scene/<site>.json and its ground). Which taxa are drawn comes from
// the snapshot's rows and the records' claims; a taxon the records place elsewhere or elsewhen, or
// one with no size, is left out and says why. The ground is the generator's plain, set into the land
// the elevation field reconstructs for the moment.
import { climateClass, CLIMATE_LABEL, type ClimateRule } from '../../../../core/climate.ts';
import { fromLocal } from '../../../../core/city.ts';
import { coverAt, type PlanetFile } from '../../../../core/planet.ts';
import { rotate, toLatLon, conj, unitVector } from '../../../../core/quat.ts';
import { isPlant, type BodyPlan, type SceneFile, type SceneOmission, type SceneTaxon } from '../../../../core/scene.ts';
import { parsePoint, toMa, type TimePointInput } from '../../../../core/time.ts';
import { GroundSampler } from '../../../../world/generators/city/ground.ts';
import { hashString } from '../../../../world/generators/city/math.ts';
import { SceneBuilder } from '../../../../world/generators/life/cells.ts';
import { arrival, fbm, plainGrid, planBytes, scenePlan, VERSION, watersOf, type SceneParams } from '../../../../world/generators/life/scene/v1.ts';
import { pbdbNumber } from '../pbdb.ts';
import { sha256 } from '../util.ts';
import type { Snapshot } from './fields.ts';
import { SRC_W } from './fields.ts';
import type { ClimateKeyframe } from './climate.ts';
import { blur, encodeGrid, type GroundGrid } from './ground.ts';
import { claimOf, labeller, subjectTime, type Solved } from './records.ts';

const SCENE = 'gen:life/scene';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The elevation field's height at a paleo-position: its grid is a degree square, from 90°N and 180°W. */
function elevationAt(snap: Snapshot, lat: number, lon: number): number {
  const fy = 90 - lat;
  const fx = ((((lon + 180) % 360) + 360) % 360);
  const j = Math.max(0, Math.min(179, Math.floor(fy)));
  const i = Math.floor(fx);
  const u = fx - i;
  const v = fy - j;
  const at = (a: number, b: number) => snap.elev[b * SRC_W + (a % SRC_W)];
  return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
}

const quantity = (v: unknown): number | undefined => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const q = v as { value?: number; mean?: number; lo?: number; hi?: number };
    if (typeof q.value === 'number') return q.value;
    if (typeof q.mean === 'number') return q.mean;
    if (typeof q.lo === 'number' && typeof q.hi === 'number') return (q.lo + q.hi) / 2;
  }
  return undefined;
};

export interface SceneBuild {
  file: SceneFile;
  blobs: Map<string, Uint8Array>;
  /** what the rest of the build and its tests want to know */
  rule: ClimateRule;
}

export function buildScene(s: Solved, elevation: Snapshot[], climate: ClimateKeyframe[], climateGridInfo: { step: number; nx: number; ny: number; lon0: number; lat0: number }, rule: ClimateRule, planet: PlanetFile, log: (m: string) => void): SceneBuild | undefined {
  const w = s.world;
  const gen = w.generators.find((g) => g.id === SCENE);
  if (!gen) return undefined;
  const params = gen.params as unknown as SceneParams;
  if (gen.version !== VERSION) throw new Error(`${SCENE}: the record is version ${gen.version}, the code version ${VERSION}`);
  const site = params.site;
  const eco = w.entity.get(site.ecosystem);
  const snap = w.fossils.get(site.snapshot);
  if (!eco || !snap) {
    log(`scene   ${site.id}: not built: ${eco ? `no snapshot ${site.snapshot}` : `no record ${site.ecosystem}`} yet`);
    return undefined;
  }
  const labelOf = labeller(s);
  const slice = parsePoint(site.slice as TimePointInput).t;
  const sliceMa = toMa(slice);

  // Where the place stood then: its coordinates today, carried by its plate.
  const loc = claimOf(s, eco.id, 'location')?.value as { lat: number; lon: number } | undefined;
  const frame = claimOf(s, eco.id, 'frame')?.value as string | undefined;
  const plate = frame ? w.frame.get(frame)?.transform?.plate : undefined;
  if (!loc || !plate) throw new Error(`${eco.id}: a scene needs a location and a frame on a plate`);
  const positionAt = (age: number) => {
    const [lat, lon] = toLatLon(rotate(s.model.total(plate, age), rotate(conj(s.model.total(plate, 0)), unitVector(loc.lat, loc.lon))));
    return { lat, lon };
  };
  const origin = positionAt(sliceMa);
  const place = { lat: Math.round(origin.lat * 1e5) / 1e5, lon: Math.round(origin.lon * 1e5) / 1e5 };

  const { time: ecoTime } = subjectTime(s, eco.id);
  const span: [number, number] = [ecoTime.start.best ?? slice, ecoTime.end.best ?? slice];
  if (slice < span[0] || slice > span[1]) throw new Error(`${SCENE}: the slice ${site.slice} is outside ${eco.id}'s own time`);

  // Which taxa: every record with a body plan, if the snapshot has it here at this moment.
  const byNo = new Map(snap.taxa.map((t) => [t.no, t]));
  const rows = new Map<number, { rows: number; collections: Set<number> }>();
  let inSlice = 0;
  for (const o of snap.occurrences) {
    if (o.max < sliceMa || o.min > sliceMa) continue;
    inSlice++;
    for (let x = o.taxon; x && byNo.has(x); x = byNo.get(x)!.parent) {
      const r = rows.get(x) ?? { rows: 0, collections: new Set<number>() };
      r.rows++;
      r.collections.add(o.collection);
      rows.set(x, r);
    }
  }
  const taxa: SceneTaxon[] = [];
  const omitted: SceneOmission[] = [];
  const covered = new Set<number>();
  for (const e of [...w.entities].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (e.kind !== 'taxon') continue;
    const plan = claimOf(s, e.id, 'body_plan')?.value as BodyPlan | undefined;
    if (!plan) continue;
    const label = labelOf(e.id);
    const no = pbdbNumber(e);
    const here = no !== undefined ? rows.get(no) : undefined;
    const { time, variants } = subjectTime(s, e.id);
    const leave = (why: string) => omitted.push({ id: e.id, label, why });
    if (!here) {
      leave(`The snapshot has no occurrence of it in the formation at ${site.slice}.`);
      continue;
    }
    if ((time.start.best ?? -Infinity) > slice || (time.end.best ?? Infinity) < slice) {
      leave(`Its record does not put it alive at ${site.slice}.`);
      continue;
    }
    const claimedLength = quantity(claimOf(s, e.id, 'body_length')?.value);
    const hip = quantity(claimOf(s, e.id, 'hip_height')?.value);
    const mass = quantity(claimOf(s, e.id, 'body_mass')?.value);
    // A body plan may say what its body weighs for its length: a claimed mass then gives the size, as the kit is shaped.
    const massShare = params.animals.mass_length?.[plan];
    const fromMass = claimedLength === undefined && mass !== undefined && massShare !== undefined;
    const length = fromMass ? Math.round(Math.cbrt(mass! / massShare!) * 1000) / 1000 : claimedLength;
    const height = quantity(claimOf(s, e.id, 'plant_height')?.value);
    const posture = claimOf(s, e.id, 'posture')?.value as string | undefined;
    if (isPlant(plan) ? height === undefined && posture !== 'floating' : length === undefined) {
      leave(isPlant(plan) ? 'No claim gives its height, and a size is not guessed.' : 'No claim gives its length, and a size is not guessed.');
      continue;
    }
    taxa.push({ id: e.id, label, plan, ...(posture ? { posture } : {}), ...(fromMass ? { fromMass: true } : {}), ...(length !== undefined ? { length } : {}), ...(hip !== undefined ? { hip } : {}), ...(height !== undefined ? { height } : {}), ...(mass !== undefined ? { mass } : {}), rows: here.rows, collections: here.collections.size, time, ...(variants ? { variants } : {}) });
    covered.add(no!);
  }
  if (!taxa.length) {
    log(`scene   ${site.id}: not built: no taxon of the formation has a body plan and a size yet`);
    return undefined;
  }
  // How much of the slice's rows the drawn taxa account for.
  let drawnRows = 0;
  for (const o of snap.occurrences) {
    if (o.max < sliceMa || o.min > sliceMa) continue;
    for (let x = o.taxon; x && byNo.has(x); x = byNo.get(x)!.parent) {
      if (covered.has(x)) {
        drawnRows++;
        break;
      }
    }
  }

  // The land it stands on, as the elevation field reconstructs it: the snapshot nearest the slice.
  const nearest = [...elevation].sort((a, b) => Math.abs(a.ageMa - sliceMa) - Math.abs(b.ageMa - sliceMa))[0];
  const at = positionAt(nearest.ageMa);
  const relief = (x: number, y: number) => {
    const [lat, lon] = fromLocal(at, x, y);
    return elevationAt(nearest, lat, lon);
  };
  const g = params.ground;
  const seedText = gen.slots[site.id]?.seed ?? site.id;
  const seed = hashString(seedText);
  const water = Math.round(Math.max(relief(0, 0), g.lowest_water));
  const waters = watersOf(g, seed, 6000);
  const blended = (x: number, y: number, plain: number) => {
    const r = Math.sqrt(x * x + y * y);
    const k = smooth(g.blend[0], g.blend[1], r);
    return k ? plain + (relief(x, y) - plain) * k : plain;
  };
  const fine = { nx: 1281, ny: 1281, x0: -6400, y0: -6400, cell: 10 };
  const mid = { nx: 1281, ny: 1281, x0: -32000, y0: -32000, cell: 50 };
  const far = { nx: 1201, ny: 1201, x0: -480000, y0: -480000, cell: 800 };
  const level0: GroundGrid = { ...fine, z: plainGrid(fine, g, water, seed, waters) };
  const level1: GroundGrid = { ...mid, z: plainGrid(mid, g, water, seed, waters) };
  for (let j = 0; j < mid.ny; j++) for (let i = 0; i < mid.nx; i++) level1.z[j * mid.nx + i] = blended(mid.x0 + i * mid.cell, mid.y0 + j * mid.cell, level1.z[j * mid.nx + i]);
  const level2: GroundGrid = { ...far, z: new Float32Array(far.nx * far.ny) };
  for (let j = 0; j < far.ny; j++) {
    for (let i = 0; i < far.nx; i++) {
      const x = far.x0 + i * far.cell;
      const y = far.y0 + j * far.cell;
      const r = relief(x, y);
      // A degree's grid is smooth at this scale: the high ground takes some invented roughness, in proportion.
      const rough = r > 80 ? (r - 80) * 0.7 * (fbm(x / 26000, y / 26000, seed + 71) - 0.5) : 0;
      level2.z[j * far.nx + i] = blended(x, y, water + g.rise) + rough * smooth(g.blend[0], g.blend[1], Math.sqrt(x * x + y * y));
    }
  }
  blur(level2, 1.2);
  const blobs = new Map<string, Uint8Array>();
  const ground = [level0, level1, level2].map((grid, i) => {
    const url = `scene/${site.id}/ground-${i}.bin`;
    blobs.set(url, encodeGrid(grid));
    return { url, nx: grid.nx, ny: grid.ny, x0: grid.x0, y0: grid.y0, cell: grid.cell };
  });
  const sampler = new GroundSampler(ground.map((l) => ({ ...l, z: new Int16Array(blobs.get(l.url)!.buffer) })));
  const arrive = arrival(waters, 2600, params.cover.clearing * 0.72);

  // The climate there, as the field reads it, at the keyframe nearest the slice.
  const key = [...climate].sort((a, b) => Math.abs(a.ageMa - sliceMa) - Math.abs(b.ageMa - sliceMa))[0];
  const kp = positionAt(key.ageMa);
  const { step, nx, lon0, lat0 } = climateGridInfo;
  const row = Math.round((lat0 - kp.lat) / step);
  const col = ((Math.round((kp.lon - lon0) / step) % nx) + nx) % nx;
  const k = (row * nx + col) * 4;
  const node = { hot: key.nodes[k], cold: key.nodes[k + 1], aridity: key.nodes[k + 2], margin: key.nodes[k + 3] };
  const climateNow = climateClass(node, rule);
  const cover = coverAt(planet, slice, {});

  const file: SceneFile = {
    format: 'lightworld-scene@1',
    site: { id: site.id, label: site.label, place: eco.id, origin: place, today: { lat: loc.lat, lon: loc.lon }, span, slice, water_level: water, focus: [Math.round(arrive.at[0]), Math.round(arrive.at[1])], to_river: [Math.round(arrive.toRiver[0] * 1000) / 1000, Math.round(arrive.toRiver[1] * 1000) / 1000] },
    ground,
    taxa,
    omitted,
    biome: { climate: climateNow, label: CLIMATE_LABEL[climateNow], field: 'field:earth/climate', ageMa: key.ageMa, cover: { plants: cover.plants, forests: cover.forests, grasses: cover.grasses } },
    fossils: { source: site.snapshot, rows: inSlice, collections: new Set(snap.occurrences.filter((o) => o.max >= sliceMa && o.min <= sliceMa).map((o) => o.collection)).size, title: w.manifest.datasets[site.snapshot].title ?? site.snapshot, drawn: drawnRows },
    generator: { generator: gen.id, version: gen.version, seed: seedText, basis: 'procedural', params: gen.params, outputSha256: '', cell: { key: 0, detail: 1, sha256: '' } },
  };
  const plan = scenePlan(file, sampler);
  file.generator.outputSha256 = sha256(planBytes(plan));
  // One cell's mesh too, in the middle of it all: the browser's must match it to the byte.
  const builder = new SceneBuilder(file, sampler.levels, plan);
  const half = 17 * 400;
  const cellKey = Math.floor((file.site.focus[1] + half) / 400) * 34 + Math.floor((file.site.focus[0] + half) / 400);
  const { vertices, indices } = builder.build(cellKey, 1).arrays();
  file.generator.cell = { key: cellKey, detail: 1, sha256: sha256(Buffer.concat([new Uint8Array(vertices), new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength)])) };
  log(`scene   ${site.id}: ${taxa.length} taxa drawn and ${omitted.length} left out; ${plan.count} organisms; water at ${water} m; ${climateNow}; at ${place.lat}, ${place.lon}`);
  return { file, blobs, rule };
}
