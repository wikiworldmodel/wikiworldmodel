// The living scenes the build can answer for. The Hell Creek is a place with its own formation's rows: which
// taxa are drawn comes from the snapshot and the records' claims, and a taxon the records place elsewhere or
// elsewhen, or with no form or size, is left out and says why. Anywhere else, the browser makes the scene
// itself from the atlas: witness places here are made the same way, and their hashes kept so that a browser
// can be held to them. No ground and no organism is stored for either.
import { atlasHasLand, atlasList, type AtlasBin, type AtlasIndex } from '../../../../core/atlas.ts';
import { climateClass, CLIMATE_LABEL, decodeNode, type ClimateRule } from '../../../../core/climate.ts';
import type { Fingerprint } from '../../../../core/fingerprint.ts';
import { canonicalForm, type Form } from '../../../../core/form.ts';
import { coverAt, type PlanetFile } from '../../../../core/planet.ts';
import { rotate, toLatLon, conj, unitVector } from '../../../../core/quat.ts';
import type { LivingTaxon, SceneFileV2, SceneOmission, SceneSpec } from '../../../../core/scene.ts';
import { parsePoint, toMa, type TimePointInput } from '../../../../core/time.ts';
import { cubeRoot, placeSpec, reliefPatch, sizeWithin, type PlaceWorld } from '../../../../world/generators/life/spec.ts';
import type { SceneWater } from '../../../../core/scene.ts';
import { FULL_BUDGET, SceneStream } from '../../../../world/generators/life/stream.ts';
import { VERSION, type LivingParams } from '../../../../world/generators/life/scene/v4.ts';
import { FormTree } from '../forms.ts';
import { pbdbNumber } from '../pbdb.ts';
import { sha256, stableStringify } from '../util.ts';
import type { ClimateKeyframe } from './climate.ts';
import { SRC_W, type Snapshot } from './fields.ts';
import { claimOf, labeller, subjectTime, type Solved } from './records.ts';

const SCENE = 'gen:life/scene';

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

const elevationOf = (snap: Snapshot) => (lat: number, lon: number): number => snap.elev[Math.max(0, Math.min(180, 90 - Math.round(lat))) * SRC_W + (((Math.round(lon) + 180) % SRC_W) + SRC_W) % SRC_W];
const plateOf = (snap: Snapshot) => (lat: number, lon: number): number => snap.plate[Math.max(0, Math.min(180, 90 - Math.round(lat))) * SRC_W + (((Math.round(lon) + 180) % SRC_W) + SRC_W) % SRC_W];
const nearestOf = <T extends { ageMa: number }>(list: T[], age: number): T => [...list].sort((a, b) => Math.abs(a.ageMa - age) - Math.abs(b.ageMa - age))[0];

/** What a keyframe of the climate says at a place, from the bytes the viewer reads too. */
const climateOf = (key: ClimateKeyframe, grid: { step: number; nx: number; lon0: number; lat0: number }) => (lat: number, lon: number) => {
  const row = Math.round((grid.lat0 - lat) / grid.step);
  const col = ((Math.round((lon - grid.lon0) / grid.step) % grid.nx) + grid.nx) % grid.nx;
  const k = (row * grid.nx + col) * 4;
  return decodeNode([key.values[k] / 255, key.values[k + 1] / 255, key.values[k + 2] / 255, key.values[k + 3] / 255]);
};

export interface SceneBuild {
  file: SceneFileV2;
}

export function buildScene(s: Solved, elevation: Snapshot[], climate: ClimateKeyframe[], climateGridInfo: { step: number; nx: number; ny: number; lon0: number; lat0: number }, rule: ClimateRule, planet: PlanetFile, log: (m: string) => void): SceneBuild | undefined {
  const w = s.world;
  const gen = w.generators.find((g) => g.id === SCENE);
  if (!gen) return undefined;
  const params = gen.params as unknown as LivingParams & { site: { id: string; label: string; ecosystem: string; snapshot: string; slice: string; window: [string, string]; flow?: number } };
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

  // Which taxa: every record with a body plan of its own, if the snapshot has it here at this moment.
  const tree = new FormTree(w);
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
  const taxa: LivingTaxon[] = [];
  const omitted: SceneOmission[] = [];
  const forms: Record<string, Form> = {};
  const covered = new Set<number>();
  const most = Math.max(1, ...[...rows.values()].map((r) => r.rows));
  // Every record that says something of its body and has rows here; but a clade whose members are on the list too is
  // not on it itself, or a family would stand beside its own genera.
  const candidates = [...w.entities].sort((a, b) => (a.id < b.id ? -1 : 1)).filter((e) => {
    if (e.kind !== 'taxon' || (!claimOf(s, e.id, 'body_plan') && !claimOf(s, e.id, 'body_form'))) return false;
    const no = pbdbNumber(e);
    return no !== undefined && rows.has(no);
  });
  const above = new Set<string>();
  const candidateOf = new Map(candidates.map((e) => [pbdbNumber(e)!, e.id]));
  for (const e of candidates) {
    for (const up of tree.path(e.id).slice(1)) above.add(up);
    // And by the database's classification, as its rows are counted, where the world's tree goes another way.
    for (let x = byNo.get(pbdbNumber(e)!)?.parent ?? 0, g = 0; x && byNo.has(x) && g < 200; x = byNo.get(x)!.parent, g++) {
      const id = candidateOf.get(x);
      if (id) above.add(id);
    }
  }
  for (const e of candidates) {
    if (above.has(e.id)) continue;
    const label = labelOf(e.id);
    const no = pbdbNumber(e)!;
    const here = rows.get(no)!;
    const { time, variants } = subjectTime(s, e.id);
    const leave = (why: string) => omitted.push({ id: e.id, label, why });
    if ((time.start.best ?? -Infinity) > slice || (time.end.best ?? Infinity) < slice) {
      leave(`Its record does not put it alive at ${site.slice}.`);
      continue;
    }
    const form = tree.form(e.id);
    const source = tree.source(e.id);
    if (!form || !source) {
      leave('No node above it in the tree has a body plan.');
      continue;
    }
    const plantForm = form.kind === 'plant';
    // A size of its own, as its claims give it; or a place in the range of the nearest node above that gives one.
    const sized = (prop: 'body_length' | 'hip_height' | 'plant_height' | 'body_mass') => {
      const own = quantity(claimOf(s, e.id, prop)?.value);
      if (own !== undefined) return { value: own, from: undefined as string | undefined };
      const q = tree.size(e.id, prop);
      return q ? { value: sizeWithin({ ...q, from: labelOf(q.from) }, no)!, from: labelOf(q.from) } : undefined;
    };
    const lengthClaim = plantForm ? undefined : sized('body_length');
    const hip = plantForm ? undefined : quantity(claimOf(s, e.id, 'hip_height')?.value);
    const massClaim = plantForm ? undefined : sized('body_mass');
    const fromMass = !plantForm && lengthClaim === undefined && massClaim !== undefined;
    const length = fromMass ? Math.round(cubeRoot(massClaim!.value / (form.mass_length ?? 20)) * 1000) / 1000 : lengthClaim?.value;
    const heightClaim = plantForm ? sized('plant_height') : undefined;
    const height = heightClaim?.value;
    const posture = tree.posture(e.id);
    if (plantForm ? height === undefined && form.behave?.layer !== 'float' : length === undefined) {
      leave(plantForm ? 'No node above it gives a height, and a size is not guessed.' : 'No node above it gives a length, and a size is not guessed.');
      continue;
    }
    const canon = canonicalForm(form);
    const key = sha256(stableStringify(canon)).slice(0, 16);
    forms[key] = canon;
    const sizeFrom = plantForm ? heightClaim?.from : lengthClaim?.from ?? massClaim?.from;
    taxa.push({
      id: e.id,
      label,
      form: key,
      form_from: source.from,
      form_label: labelOf(source.from),
      own: source.own,
      tier: 'formation',
      weight: here.rows / most,
      rows: here.rows,
      collections: here.collections.size,
      ...(posture ? { posture } : {}),
      biped: posture === 'biped',
      ...(length !== undefined ? { length } : {}),
      ...(hip !== undefined ? { hip } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(massClaim !== undefined ? { mass: massClaim.value } : {}),
      ...(sizeFrom ? { size_from: sizeFrom } : {}),
      ...(fromMass ? { fromMass: true } : {}),
      time,
      ...(variants ? { variants } : {}),
    });
    covered.add(no);
  }
  if (!taxa.length) {
    log(`scene   ${site.id}: not built: no taxon of the formation has a form and a size yet`);
    return undefined;
  }
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
  const key = nearestOf(elevation, sliceMa);
  const at = positionAt(key.ageMa);
  const isoline = (w.fields.find((f) => f.id === 'field:earth/coastline') as unknown as { isoline_m?: number } | undefined)?.isoline_m ?? 20;
  const relief = reliefPatch(at.lat, at.lon, elevationOf(key), isoline);
  const ck = nearestOf(climate, sliceMa);
  const kp = positionAt(ck.ageMa);
  const node = climateOf(ck, climateGridInfo)(kp.lat, kp.lon);
  const climateNow = climateClass(node, rule);
  const cover = coverAt(planet, slice, {});
  const { site: _site, ...rest } = params;
  const seedText = gen.slots[site.id]?.seed ?? site.id;
  const spec: SceneSpec = {
    format: 'lightworld-scene@2',
    site: { id: site.id, label: site.label, place: eco.id, origin: place, relief_at: { lat: Math.round(at.lat * 1e5) / 1e5, lon: Math.round(at.lon * 1e5) / 1e5 }, span, slice },
    relief,
    biome: { climate: climateNow, label: CLIMATE_LABEL[climateNow], field: 'field:earth/climate', ageMa: ck.ageMa, cover: { plants: cover.plants, forests: cover.forests, grasses: cover.grasses }, node },
    taxa,
    omitted,
    forms,
    fossils: { source: site.snapshot, rows: inSlice, collections: new Set(snap.occurrences.filter((o) => o.max >= sliceMa && o.min <= sliceMa).map((o) => o.collection)).size, title: w.manifest.datasets[site.snapshot].title ?? site.snapshot, drawn: drawnRows },
    generator: { generator: gen.id, version: gen.version, seed: seedText, basis: 'procedural', params: { ...rest, ground: { ...params.ground, flow: site.flow } } as unknown as Record<string, unknown> },
  };
  const stream = new SceneStream(spec, FULL_BUDGET);
  const file: SceneFileV2 = { format: 'lightworld-scene-file@2', spec, print: stream.print(), focus: stream.plan.focus, to_river: stream.plan.toRiver, water_level: stream.look.water };
  log(`scene   ${site.id}: ${taxa.length} taxa drawn and ${omitted.length} left out; water at ${stream.look.water} m; ${climateNow}; at ${place.lat}, ${place.lon}`);
  return { file };
}

/** The questions a place's spec asks, answered from the build's files. */
export function placeWorld(s: Solved, index: AtlasIndex, bin: AtlasBin, forms: Record<string, Form>, elevation: Snapshot[], climate: ClimateKeyframe[], climateGridInfo: { step: number; nx: number; ny: number; lon0: number; lat0: number }, rule: ClimateRule, planet: PlanetFile): PlaceWorld {
  const w = s.world;
  const gen = w.generators.find((g) => g.id === SCENE)!;
  const { site: _site, ...rest } = gen.params as unknown as LivingParams & { site: unknown };
  const midMa = toMa(bin.slice);
  const key = nearestOf(elevation, midMa);
  const ck = nearestOf(climate, midMa);
  const isoline = (w.fields.find((f) => f.id === 'field:earth/coastline') as unknown as { isoline_m?: number } | undefined)?.isoline_m ?? 20;
  const cover = coverAt(planet, bin.slice, {});
  return {
    atlas: index,
    bin,
    list: (lat, lon) => (atlasHasLand(bin, index.grid, lat, lon) ? atlasList(bin, index.grid, lat, lon) : undefined),
    forms,
    keyAge: key.ageMa,
    elevation: elevationOf(key),
    plate: plateOf(key),
    carry: (plate, lat, lon, a, b) => {
      if (!s.model.reaches(plate, a) || !s.model.reaches(plate, b)) return [lat, lon];
      const [la, lo] = toLatLon(rotate(s.model.total(plate, b), rotate(conj(s.model.total(plate, a)), unitVector(lat, lon))));
      return [la, lo];
    },
    climateAge: ck.ageMa,
    climate: climateOf(ck, climateGridInfo),
    rule,
    climateField: 'field:earth/climate',
    cover: { plants: cover.plants, forests: cover.forests, grasses: cover.grasses },
    isoline,
    generator: { id: gen.id, version: gen.version, params: rest as unknown as Record<string, unknown> },
  };
}

export interface Witness {
  lat: number;
  lon: number;
  t: number;
  /** what the browser's scene of this place must agree with, within the tolerance */
  print: Fingerprint;
  taxa: number;
}

/** A few places the browser is held to: the same scene, within the tolerance of core/fingerprint.ts, as the build makes here. */
export function witnesses(s: Solved, index: AtlasIndex, files: Map<string, string>, elevation: Snapshot[], climate: ClimateKeyframe[], climateGridInfo: { step: number; nx: number; ny: number; lon0: number; lat0: number }, rule: ClimateRule, planet: PlanetFile, log: (m: string) => void, water?: (t: number, ageMa: number, at: { lat: number; lon: number }, isoline: number) => SceneWater | undefined, months?: (pw: PlaceWorld, lat: number, lon: number, ageMa: number) => PlaceWorld['months']): Witness[] {
  const forms = JSON.parse(files.get(index.forms)!) as Record<string, Form>;
  const out: Witness[] = [];
  // A stage from each part of the chart that has rows, at the patch with the longest list; and from the middle one, the
  // places a mistake would hide: as far toward a pole as it has land, and by the line where longitude wraps.
  const stages = index.bins.filter((b) => b.rows > 200);
  const chosen = [stages[Math.floor(stages.length * 0.3)], stages[Math.floor(stages.length * 0.6)], stages[Math.floor(stages.length * 0.9)]].filter(Boolean);
  const patchPlace = (key: number): [number, number] => [90 - (Math.floor(key / index.grid.nx) + 0.5) * index.grid.step, -180 + ((key % index.grid.nx) + 0.5) * index.grid.step];
  chosen.forEach((ref, order) => {
    const bin = JSON.parse(files.get(ref.file)!) as AtlasBin;
    const pw = placeWorld(s, index, bin, forms, elevation, climate, climateGridInfo, rule, planet);
    const keys = Object.keys(bin.nodes).map(Number);
    const places: [number, number][] = [patchPlace(keys.sort((a, b) => bin.nodes[String(b)].length - bin.nodes[String(a)].length || a - b)[0])];
    if (order === 1) {
      const polar = [...keys].sort((a, b) => Math.abs(patchPlace(b)[0]) - Math.abs(patchPlace(a)[0]) || a - b)[0];
      places.push(patchPlace(polar));
      const edge = [...keys].sort((a, b) => Math.abs(patchPlace(b)[1]) - Math.abs(patchPlace(a)[1]) || a - b)[0];
      places.push(patchPlace(edge));
    }
    for (const [lat, lon] of places) {
      // Its climate at its heights as a browser gives it, from the same files.
      pw.months = months?.(pw, lat, lon, toMa(bin.slice));
      const spec = placeSpec(pw, lat, lon, toMa(bin.slice));
      if (!spec) continue;
      // Its rivers as a browser gives them, from the same files.
      const w = water?.(bin.slice, toMa(bin.slice), spec.site.relief_at ?? spec.site.origin, pw.isoline);
      if (w) spec.water = w;
      const stream = new SceneStream(spec, FULL_BUDGET);
      out.push({ lat, lon, t: bin.slice, print: stream.print(), taxa: spec.taxa.length });
      log(`witness ${ref.name}: ${spec.taxa.length} taxa at ${lat}, ${lon}, ${spec.biome.climate}${spec.climate ? ` (${spec.climate.field.replace('field:earth/', '')} at ${spec.climate.ageMa} Ma, month ${spec.climate.month})` : ''}, water ${stream.look.water} m, ${spec.water ? `${spec.water.rivers.length} rivers (${spec.water.tier})` : 'an invented river'}`);
    }
  });
  return out;
}
