// A living scene, version 2: any place on land at any moment, from a spec. Nothing is laid out until it is
// looked at: each 400 m cell makes what stands in it from hashes of where it is, so the scene has no edge
// to speak of, and what a far view shows is the top of the same list a near view shows in full. The records
// say which taxa could be here and how big they grew; this says where each stands, how many there are,
// what it is doing and what colour it is, all invented and marked so. Written with only + − × ÷, square roots and
// integer operations; the build and every browser are held to agree within the tolerance of core/fingerprint.ts.
import type { Part } from '../../../../core/fingerprint.ts';
import type { Form, Pose } from '../../../../core/form.ts';
import type { LivingTaxon, ReliefPatch, SceneSpec } from '../../../../core/scene.ts';
import { GroundSampler, type GroundGridData } from '../../city/ground.ts';
import { dcos, dsin, hash2, hash3, hashString, PI, Rng, TAU } from '../../city/math.ts';
import { POSE } from '../forms.ts';
import { arrival, fbm, noise, plainGrid, watersOf, type GridSpec, type PlainParams, type Waters } from '../land.ts';

export const GENERATOR = 'gen:life/scene';
export const VERSION = 2;

/** The side of a cell of the ground, in metres. */
export const CELL = 400;
/** How far from the origin anything is made: the ground's fine and middle grids reach this far and further. */
export const EXTENT = 16000;
/** Cells across the whole scene. */
export const CELLS = (EXTENT * 2) / CELL;
export const cellKey = (i: number, j: number) => (j + CELLS / 2) * CELLS + (i + CELLS / 2);

export const EARTH = 6371000;
const DEG = PI / 180;

export interface LivingParams {
  site?: { id: string; label: string; ecosystem: string; snapshot: string; slice: string; window: [string, string] };
  /** the plain around a place: as a scene's river and floodplain, and how it gives way to the land the field reconstructs */
  ground: {
    flow?: number;
    width: number;
    depth: number;
    wavelength: number;
    swing: number;
    bank: [number, number];
    rise: number;
    roughness: number;
    size: number;
    levee: [number, number];
    oxbows: number;
    oxbow_radius: [number, number];
    oxbow_width: number;
    ponds: number;
    pond_radius: [number, number];
    blend: [number, number];
    lowest_water: number;
    /** below this height at the place, in metres, its water is the sea */
    sea_below: number;
    /** how much invented relief the land has beyond the plain, as a share of its height above the coast */
    rugged: number;
    /** how rough the plain gets for each metre the land around it varies by */
    swell: number;
    /** a shore: how far the land's height wanders with noise, in metres, to make a coast of a 1° grid */
    coast: number;
  };
  cover: {
    patch: number;
    glade: number;
    clearing: number;
    bare: number;
    /** by climate class: how much of the land is forest, low plants and bare ground, and whether it has rivers, all 0–1 */
    climates: Record<string, { forest: number; herb: number; bare: number; river: number; dunes?: number; tones: string }>;
    /** what colours each kind of land has: the generator's choice, and nobody's record */
    tones: Record<string, Record<string, number[]>>;
  };
  plants: {
    /** the sowing grid, in metres; trees to the hectare under full canopy */
    step: number;
    trees: number;
    /** the share of the trees made for a cell seen only from afar */
    far_share: number;
    /** the understory's grid in metres, and plants to the hectare */
    under_step: number;
    under: number;
    mat_step: number;
    mats: number;
  };
  animals: {
    /** Damuth's rule: a species of 1 kg at this many to the km², falling as mass to the −¾ */
    density: number;
    /** how many times more are shown than the rule says, as a visitor would otherwise seldom meet one */
    show: number;
    /** how many of those a predator is, of a plant-eater of its size */
    predators: number;
    /** the most groups of a taxon in one cell, however small */
    most_in_cell: number;
    /** a group of each animal at least this long stands by the arrival */
    near_radius: number;
    front_length: number;
    /** what animals below this length need: being looked at from close by */
    small_m: number;
    mass_length: number;
    defaults: { group: [number, number]; habitat: string; poses: Pose[] };
  };
  /** how far off each kind of cell is made, in metres from the eye */
  reach: { full: number; near: number };
  view: { range: number; turn: number; tilt: number };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ——— The land ———

/** The field's height at a local point: bilinear on the patch. */
export class Relief {
  private kx: number;
  constructor(private p: ReliefPatch, private origin: { lat: number; lon: number }) {
    this.kx = 1 / (EARTH * dcos(origin.lat * DEG) * DEG);
  }
  at(x: number, y: number): number {
    const { p } = this;
    const lat = this.origin.lat + y / (EARTH * DEG);
    const lon = this.origin.lon + x * this.kx;
    const fy = (p.lat0 - lat) / p.step;
    const fx = (lon - p.lon0) / p.step;
    const cy = fy < 0 ? 0 : fy > p.ny - 1.001 ? p.ny - 1.001 : fy;
    const cx = fx < 0 ? 0 : fx > p.nx - 1.001 ? p.nx - 1.001 : fx;
    const j = Math.floor(cy);
    const i = Math.floor(cx);
    const u = cx - i;
    const v = cy - j;
    const at = j * p.nx + i;
    const z = p.z;
    return (z[at] * (1 - u) + z[at + 1] * u) * (1 - v) + (z[at + p.nx] * (1 - u) + z[at + p.nx + 1] * u) * v;
  }
}

/** The bearing downhill from the place, in one of sixteen directions, chosen with no inverse trigonometry. */
export function downhill(r: Relief, seed: number): number {
  let best = hash2(1, 1, seed) * TAU;
  let low = r.at(0, 0);
  for (let k = 0; k < 16; k++) {
    const a = (TAU * k) / 16;
    const z = r.at(dsin(a) * 40000, dcos(a) * 40000);
    if (z < low - 1) {
      low = z;
      best = a;
    }
  }
  return best;
}

/** What a place is like, worked out once: what the plain and the waters take from the land around. */
export interface PlaceLook {
  /** the level of its water, in metres above the coast */
  water: number;
  /** whether that is the sea */
  sea: boolean;
  flow: number;
  rivers: boolean;
  /** how much the land varies around it, in metres */
  relief: number;
  seed: number;
}

export function placeLook(spec: SceneSpec): PlaceLook {
  const params = spec.generator.params as unknown as LivingParams;
  const seed = hashString(spec.generator.seed);
  const r = new Relief(spec.relief, spec.site.relief_at ?? spec.site.origin);
  const g = params.ground;
  const e0 = r.at(0, 0);
  let lo = e0;
  let hi = e0;
  for (let k = 0; k < 24; k++) {
    const a = (TAU * k) / 24;
    for (const d of [30000, 90000]) {
      const z = r.at(dsin(a) * d, dcos(a) * d);
      if (z < lo) lo = z;
      if (z > hi) hi = z;
    }
  }
  const sea = e0 < g.sea_below;
  const clim = params.cover.climates[spec.biome.climate];
  const rivers = (clim?.river ?? 0) * Math.min(1, spec.biome.cover.plants + 0.5) > hash2(3, 3, seed);
  return { water: sea ? 0 : Math.round(e0 < g.lowest_water ? g.lowest_water : e0), sea, flow: g.flow ?? downhill(r, seed), rivers, relief: hi - lo, seed };
}

/** The plain's parameters, as the land around a place roughens them. */
function plainOf(spec: SceneSpec, look: PlaceLook): LivingParams['ground'] & PlainParams {
  const g = (spec.generator.params as unknown as LivingParams).ground;
  const rough = g.roughness + look.relief * g.swell;
  return { ...g, flow: look.flow, roughness: rough, rise: g.rise + rough * 0.5 };
}

const NO_WATERS: Waters = { river: [], oxbows: [], ponds: [] };

/** The waters of a place, worked out once. */
export const watersFor = (spec: SceneSpec, look: PlaceLook): Waters => (look.rivers ? watersOf(plainOf(spec, look), look.seed, 6000) : NO_WATERS);

/** Far from a plain, the land's own lie, with ridges made up in proportion to its height. */
function landAt(rel: Relief, g: LivingParams['ground'], x: number, y: number, seed: number): number {
  const b = rel.at(x, y);
  const n1 = fbm(x / 26000, y / 26000, seed + 71) - 0.5;
  const n2 = fbm(x / 6200, y / 6200, seed + 72) - 0.5;
  const high = b > 80 ? b - 80 : 0;
  // A coast of a coarse grid wanders, and hills stand in proportion to what is under them.
  const near = 1 - smooth(0, g.coast * 3, b < 0 ? -b : b);
  return b + near * g.coast * (n1 + n2) * 2 + high * g.rugged * (n1 * 1.4 + n2 * 0.6);
}

/** The ground's three grids, in metres above the coast: what a browser makes for itself. */
export function groundGrids(spec: SceneSpec, look: PlaceLook, waters: Waters, sizes: { fine: GridSpec; mid: GridSpec; far: GridSpec } = GRIDS): GroundGridData[] {
  const g = plainOf(spec, look);
  const rel = new Relief(spec.relief, spec.site.relief_at ?? spec.site.origin);
  const { seed, water } = look;
  const clim = (spec.generator.params as unknown as LivingParams).cover.climates[spec.biome.climate];
  const dune = clim?.dunes ?? 0;
  const mixed = (x: number, y: number, plain: number) => {
    const r = Math.sqrt(x * x + y * y);
    const k = smooth(g.blend[0], g.blend[1], r);
    const land = landAt(rel, g, x, y, seed);
    // Where the land the field has lies under the sea, so does the plain: it has a shore.
    const dry = look.sea ? smooth(-g.coast * 0.5, g.coast * 0.5, land) : 1;
    const w = (1 - k) * dry;
    return land + (plain - land) * w;
  };
  const withDunes = (x: number, y: number, z: number) => {
    if (!dune) return z;
    const crest = noise(x / 420 + noise(y / 900, x / 900, seed + 81) * 2.2, y / 1500, seed + 82);
    return z + dune * crest * crest * 2 * (0.6 + 0.8 * noise(x / 2600, y / 2600, seed + 83));
  };
  const fine = sizes.fine;
  const mid = sizes.mid;
  const far = sizes.far;
  const z0 = plainGrid(fine, g, water, seed, waters);
  for (let j = 0; j < fine.ny; j++) {
    for (let i = 0; i < fine.nx; i++) {
      const x = fine.x0 + i * fine.cell;
      const y = fine.y0 + j * fine.cell;
      const at = j * fine.nx + i;
      z0[at] = mixed(x, y, withDunes(x, y, z0[at]));
    }
  }
  const z1 = plainGrid(mid, g, water, seed, waters);
  for (let j = 0; j < mid.ny; j++) {
    for (let i = 0; i < mid.nx; i++) {
      const x = mid.x0 + i * mid.cell;
      const y = mid.y0 + j * mid.cell;
      const at = j * mid.nx + i;
      z1[at] = mixed(x, y, withDunes(x, y, z1[at]));
    }
  }
  const z2 = new Float32Array(far.nx * far.ny);
  for (let j = 0; j < far.ny; j++) {
    const y = far.y0 + j * far.cell;
    for (let i = 0; i < far.nx; i++) {
      const x = far.x0 + i * far.cell;
      z2[j * far.nx + i] = mixed(x, y, water + g.rise);
    }
  }
  // A small blur of a coarse grid, with fixed weights: the grid is a degree's, and has no business with corners.
  const blurred = new Float32Array(z2.length);
  const W = [1, 4, 6, 4, 1];
  const line = (from: Float32Array, to: Float32Array, n: number, count: number, at: (l: number, k: number) => number) => {
    for (let l = 0; l < count; l++) {
      for (let k = 0; k < n; k++) {
        let s = 0;
        for (let q = -2; q <= 2; q++) s += from[at(l, k + q < 0 ? 0 : k + q >= n ? n - 1 : k + q)] * W[q + 2];
        to[at(l, k)] = s / 16;
      }
    }
  };
  line(z2, blurred, far.nx, far.ny, (l, k) => l * far.nx + k);
  line(blurred, z2, far.ny, far.nx, (l, k) => k * far.nx + l);
  return [
    { ...fine, z: encode(z0) },
    { ...mid, z: encode(z1) },
    { ...far, z: encode(z2) },
  ];
}

/** Heights to decimetres: what the renderer's textures hold. */
function encode(z: Float32Array): Int16Array {
  const out = new Int16Array(z.length);
  for (let i = 0; i < z.length; i++) {
    const v = z[i] * 10;
    const r = v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5);
    out[i] = r < -32000 ? -32000 : r > 32000 ? 32000 : r;
  }
  return out;
}

export const GRIDS: { fine: GridSpec; mid: GridSpec; far: GridSpec } = {
  fine: { nx: 1281, ny: 1281, x0: -6400, y0: -6400, cell: 10 },
  mid: { nx: 1281, ny: 1281, x0: -32000, y0: -32000, cell: 50 },
  far: { nx: 1201, ny: 1201, x0: -480000, y0: -480000, cell: 800 },
};

// ——— What covers the ground ———

/** What a point of the land is: water, bare ground, canopy, low plants. Reused, to save making an object per point. */
export class LandCover {
  water = 0;
  bare = 0;
  canopy = 0;
  low = 0;
  above = 0;
  private c: LivingParams['cover'];
  private forest: number;
  private herb: number;
  private baren: number;
  private fx: number;
  private fy: number;
  private seed: number;
  constructor(spec: SceneSpec, private ground: GroundSampler, private level: number, focus: [number, number]) {
    const p = spec.generator.params as unknown as LivingParams;
    this.c = p.cover;
    const cl = p.cover.climates[spec.biome.climate] ?? { forest: 0, herb: 0, bare: 1, river: 0, tones: 'barren' };
    const cover = spec.biome.cover;
    // What may grow is what the climate bears and what has come to exist by now.
    this.forest = Math.min(cl.forest, cover.forests);
    this.herb = Math.min(cl.herb, cover.plants);
    this.baren = 1 - cover.plants * (1 - cl.bare);
    this.seed = hashString(spec.generator.seed);
    this.fx = focus[0];
    this.fy = focus[1];
  }
  get forestShare(): number {
    return this.forest;
  }
  at(x: number, y: number): this {
    const above = this.ground.at(x, y) - this.level;
    this.above = above;
    if (above < 0) {
      this.water = 1;
      this.bare = 0;
      this.canopy = 0;
      this.low = 0;
      return this;
    }
    this.water = 0;
    const c = this.c;
    const wob = noise(x / 34, y / 34, this.seed + 31);
    const shore = smooth(c.bare * 1.5, c.bare * 0.5, above + (wob - 0.5) * c.bare * 0.9);
    const patchy = fbm(x / c.patch, y / c.patch, this.seed + 32);
    // Bare ground in patches, as much as the climate leaves; all of it where nothing grows yet.
    const dry = this.baren >= 1 ? 1 : smooth(1 - this.baren - 0.12, 1 - this.baren + 0.12, 0.5 * patchy + 0.5 * noise(x / 260, y / 260, this.seed + 33));
    this.bare = shore > dry ? shore : dry;
    let canopy = smooth(c.glade - 0.05, c.glade + 0.07, patchy);
    const dx = x - this.fx;
    const dy = y - this.fy;
    const r = Math.sqrt(dx * dx + dy * dy);
    canopy *= smooth(c.clearing, c.clearing * 1.5, r + (wob - 0.5) * c.clearing * 0.7);
    this.canopy = canopy * this.forest * (1 - this.bare);
    this.low = this.herb * (1 - this.canopy) * (1 - this.bare);
    return this;
  }
}

/** What the plan says the ground is, as an image: R canopy, G low plants, B bare ground, A water. */
export function coverMask(cover: LandCover, size: number, half: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const scale = (half * 2) / size;
  for (let j = 0; j < size; j++) {
    const y = -half + (j + 0.5) * scale;
    for (let i = 0; i < size; i++) {
      const x = -half + (i + 0.5) * scale;
      cover.at(x, y);
      const at = (j * size + i) * 4;
      if (cover.water) {
        data[at + 3] = 255;
        continue;
      }
      data[at] = (cover.canopy * 255) | 0;
      data[at + 1] = (cover.low * 255) | 0;
      data[at + 2] = (cover.bare * 255) | 0;
    }
  }
  return data;
}

// ——— Who stands where ———

/** What a cell holds. All its arrays are in step. */
export interface CellRows {
  key: number;
  /** how much of it was made: 0 far trees only, 1 and big animals, 2 and everything */
  tier: number;
  count: number;
  /** x, y, z, its size as a share of a grown one, and the direction it faces */
  place: Float32Array;
  taxon: Uint16Array;
  pose: Uint8Array;
  shade: Uint8Array;
  phase: Uint8Array;
  /** 0–255: lower ones stay in view from further off, as the same individuals at every distance */
  rank: Uint8Array;
  /** where names go: x, y, z of each group's first, and its taxon */
  groups: number[];
}

class Rows {
  place: number[] = [];
  taxon: number[] = [];
  pose: number[] = [];
  shade: number[] = [];
  phase: number[] = [];
  rank: number[] = [];
  add(x: number, y: number, z: number, fx: number, fy: number, size: number, taxon: number, pose: number, shade: number, phase: number, rank: number): void {
    this.place.push(x, y, z, size, fx, fy);
    this.taxon.push(taxon);
    this.pose.push(pose);
    this.shade.push(shade);
    this.phase.push(phase);
    this.rank.push(rank);
  }
}

interface TaxonLayout {
  index: number;
  t: LivingTaxon;
  form: Form;
  plant: boolean;
  /** an animal's groups for each cell, on average */
  perCell: number;
  habitat: string;
  poses: number[];
  group: [number, number];
  flies?: [number, number];
  /** its length or height */
  size: number;
}

export interface LivingPlan {
  look: PlaceLook;
  focus: [number, number];
  toRiver: [number, number];
  cell(i: number, j: number, tier: number): CellRows;
}

/** How many to the km² a taxon is drawn at, by Damuth's rule and how common it is on its list. */
export function densityOf(t: LivingTaxon, form: Form, a: LivingParams['animals'], productivity: number): number {
  const L = t.length ?? 1;
  const mass = t.mass ?? L * L * L * (form.mass_length ?? a.mass_length);
  const m = mass < 0.001 ? 0.001 : mass;
  // Mass to the −¾, by square roots.
  const root = Math.sqrt(Math.sqrt(m));
  const rule = a.density / (root * root * root);
  const prey = /carnivor|insectiv|piscivor/.test(t.diet ?? '') ? a.predators : 1;
  return rule * prey * a.show * (0.25 + 1.5 * t.weight) * productivity;
}

export function makePlan(spec: SceneSpec, ground: GroundSampler, look: PlaceLook, waters: Waters): LivingPlan {
  const params = spec.generator.params as unknown as LivingParams;
  const seed = look.seed;
  const level = look.water;
  const A = params.animals;
  const P = params.plants;
  // Where a visitor arrives: inside the first good bend of the river, or simply by the origin.
  const arrive = waters.river.length ? arrival(waters, 2600, params.cover.clearing * 0.72) : { at: [Math.round(hash2(4, 1, seed) * 800 - 400), Math.round(hash2(4, 2, seed) * 800 - 400)] as [number, number], toRiver: [0, 1] as [number, number] };
  const focus: [number, number] = [Math.round(arrive.at[0]), Math.round(arrive.at[1])];
  const toRiver: [number, number] = [Math.round(arrive.toRiver[0] * 1000) / 1000, Math.round(arrive.toRiver[1] * 1000) / 1000];
  const land = new LandCover(spec, ground, level, focus);
  const productivity = 0.2 + 0.8 * (land.forestShare > 0.5 ? 1 : land.forestShare + 0.3);
  const layouts: TaxonLayout[] = spec.taxa.map((t, index) => {
    const form = spec.forms[t.form];
    const plant = form.kind === 'plant';
    const b = form.behave ?? {};
    const group = (b.group ?? A.defaults.group) as [number, number];
    const mean = (group[0] + group[1]) / 2;
    const perKm2 = plant ? 0 : densityOf(t, form, A, productivity);
    const perCell = plant ? 0 : Math.min(A.most_in_cell, (perKm2 * (CELL * CELL)) / 1e6 / mean);
    return { index, t, form, plant, perCell, habitat: b.habitat ?? A.defaults.habitat, poses: (b.poses ?? A.defaults.poses).map((p) => POSE[p]), group, ...(b.flies ? { flies: b.flies } : {}), size: plant ? t.height ?? 1 : t.length ?? 1 };
  });
  const canopy = layouts.filter((x) => x.plant && (x.form.behave?.layer ?? 'canopy') === 'canopy' && x.t.height !== undefined);
  const under = layouts.filter((x) => x.plant && x.form.behave?.layer === 'under' && x.t.height !== undefined);
  const mats = layouts.filter((x) => x.plant && x.form.behave?.layer === 'float');
  const animals = layouts.filter((x) => !x.plant && x.t.length !== undefined && x.habitat !== 'water').sort((a, b) => b.size - a.size || (a.t.id < b.t.id ? -1 : 1));
  const plantWeight = (e: TaxonLayout, wet: number) => (0.1 + e.t.weight) * ((e.form.behave?.weight ?? 1) + (e.form.behave?.wet ?? 0) * wet);
  const choose = (of: TaxonLayout[], wet: number, u0: number): TaxonLayout => {
    let sum = 0;
    for (const e of of) {
      const w = plantWeight(e, wet);
      if (w > 0) sum += w;
    }
    let u = u0 * sum;
    for (const e of of) {
      const w = plantWeight(e, wet);
      if (w <= 0) continue;
      u -= w;
      if (u <= 0) return e;
    }
    return of[of.length - 1];
  };
  const S = P.step;
  const perSide = Math.round(CELL / S);
  const treeChance = (P.trees * S * S) / 10000;
  /** If a tree stands at this node of the sowing grid: its x, y and how it was chosen. */
  const treeAt = (U: number, V: number): [number, number, number] | null => {
    if (!canopy.length) return null;
    const x = (U + hash2(U, V, seed + 41)) * S;
    const y = (V + hash2(U, V, seed + 42)) * S;
    land.at(x, y);
    if (land.water || land.canopy <= 0) return null;
    if (hash2(U, V, seed + 43) >= treeChance * land.canopy) return null;
    return [x, y, smooth(2.4, 0.5, land.above)];
  };
  const clearOfTrees = (x: number, y: number, r: number): boolean => {
    const span = Math.ceil(r / S);
    const U0 = Math.floor(x / S);
    const V0 = Math.floor(y / S);
    for (let v = V0 - span; v <= V0 + span; v++) {
      for (let u = U0 - span; u <= U0 + span; u++) {
        if (hash2(u, v, seed + 43) >= treeChance) continue;
        const q = treeAt(u, v);
        if (!q) continue;
        const dx = q[0] - x;
        const dy = q[1] - y;
        if (dx * dx + dy * dy < (r + 0.8) * (r + 0.8)) return false;
      }
    }
    return true;
  };
  const accept = (habitat: string, x: number, y: number, relaxed: boolean): boolean => {
    land.at(x, y);
    if (habitat === 'air') return true;
    if (habitat === 'edge' || habitat === 'wet') return land.above > -1.8 && land.above < 1.1;
    if (land.water) return false;
    if (relaxed) return true;
    if (habitat === 'open') return land.canopy < 0.3 && land.bare < 0.7;
    if (habitat === 'forest' || habitat === 'canopy') return land.canopy > 0.3;
    return true;
  };
  /** Lay out one group of animals around a place, into a list. */
  const placeGroup = (rows: Rows, groups: number[], a: TaxonLayout, cx: number, cy: number, salt: number, rank: number): void => {
    const rng = new Rng((seed ^ Math.imul(salt, 0x2f6e2b1)) >>> 0);
    const k = a.group[0] + Math.floor(rng.next() * (a.group[1] - a.group[0] + 1));
    const L = a.size;
    const turn = rng.next() * TAU;
    const spread = L * (0.9 + 0.5 * Math.sqrt(k));
    let drawn = 0;
    for (let q = 0; q < k * 6 && drawn < k; q++) {
      const b = rng.next() * TAU;
      const r = drawn === 0 ? 0 : spread * Math.sqrt(rng.next());
      const x = cx + dcos(b) * r;
      const y = cy + dsin(b) * r;
      const relaxed = q > k * 4;
      if (!accept(a.habitat, x, y, relaxed)) continue;
      const scale = drawn === 0 ? 1 : 0.68 + 0.32 * rng.next();
      const R = L * scale * (L < 0.6 ? 0.5 : 0.34);
      if (!relaxed && a.habitat !== 'air' && !clearOfTrees(x, y, R)) continue;
      const h = turn + (rng.next() - 0.5) * 1.1;
      let pose: number = a.poses[Math.floor(rng.next() * a.poses.length)];
      const gz = ground.at(x, y);
      let z = gz;
      if (a.habitat === 'edge' || a.habitat === 'wet') {
        const H = (a.t.hip ?? L * (a.form.hip ?? 0.2)) * scale;
        // Afloat where it is deep enough: with the water at the middle of its body.
        if (gz < level) z = Math.max(gz, level - H * 0.9);
      }
      if (a.flies) {
        pose = POSE.fly;
        z = gz + a.flies[0] + (a.flies[1] - a.flies[0]) * rng.next();
      } else if (land.above < 1.2 && land.above > -0.2 && (pose === POSE.graze || pose === POSE.stand)) pose = POSE.drink;
      rows.add(x, y, z, dsin(h), dcos(h), scale, a.index, pose, rng.int(0, 255), rng.int(0, 255), rank);
      if (drawn === 0) groups.push(x, y, z, a.index);
      drawn++;
    }
  };
  // Something of each near the arrival, wherever it might otherwise have fallen: every taxon is there to be seen.
  const staged = new Map<number, ((rows: Rows, groups: number[]) => void)[]>();
  const stage = (x: number, y: number, draw: (rows: Rows, groups: number[]) => void) => {
    const k = cellKey(Math.floor(x / CELL), Math.floor(y / CELL));
    const l = staged.get(k);
    if (l) l.push(draw);
    else staged.set(k, [draw]);
  };
  const stageRng = new Rng((seed ^ 0x77ab21) >>> 0);
  for (const a of animals) {
    const front = a.size >= A.front_length && a.habitat !== 'edge' && a.habitat !== 'air';
    let found = false;
    let cx = 0;
    let cy = 0;
    for (let tries = 0; tries < 80 && !found; tries++) {
      const relaxed = tries > 60;
      if (front) {
        const q = params.cover.clearing * (0.12 + 0.72 * Math.sqrt(stageRng.next()));
        const b = stageRng.next() * TAU;
        cx = focus[0] + toRiver[0] * params.cover.clearing * 0.1 + dcos(b) * q;
        cy = focus[1] + toRiver[1] * params.cover.clearing * 0.1 + dsin(b) * q;
      } else {
        const q = A.near_radius * (0.2 + 0.8 * Math.sqrt(stageRng.next()));
        const b = stageRng.next() * TAU;
        cx = focus[0] + dcos(b) * q;
        cy = focus[1] + dsin(b) * q;
      }
      found = accept(a.habitat, cx, cy, relaxed);
    }
    if (!found) continue;
    const salt = 100000 + a.index;
    const fx = cx;
    const fy = cy;
    stage(fx, fy, (rows, groups) => placeGroup(rows, groups, a, fx, fy, salt, 0));
  }
  for (const e of [...canopy, ...under]) {
    const b = stageRng.next() * TAU;
    const q = A.near_radius * (0.5 + 1.2 * stageRng.next());
    const x = focus[0] + dcos(b) * q;
    const y = focus[1] + dsin(b) * q;
    const a0 = stageRng.next() * TAU;
    const shade = stageRng.int(0, 255);
    land.at(x, y);
    if (land.water) continue;
    const z = ground.at(x, y);
    const size = 0.6 + 0.4 * stageRng.next();
    stage(x, y, (rows) => rows.add(x, y, z, dcos(a0), dsin(a0), size, e.index, POSE.stand, shade, 0, 0));
  }

  const cell = (i: number, j: number, tier: number): CellRows => {
    const rows = new Rows();
    const groups: number[] = [];
    // Trees: a share of them from afar, and the rest as the cell comes near.
    if (canopy.length) {
      const U0 = i * perSide;
      const V0 = j * perSide;
      for (let v = V0; v < V0 + perSide; v++) {
        for (let u = U0; u < U0 + perSide; u++) {
          const rank = hash2(u, v, seed + 44);
          if (tier === 0 && rank >= P.far_share) continue;
          if (hash2(u, v, seed + 43) >= treeChance) continue;
          const q = treeAt(u, v);
          if (!q) continue;
          const e = choose(canopy, q[2], hash2(u, v, seed + 45));
          // A claim gives what a grown plant reaches: most of these have not, and none is past it.
          const grown = hash2(u, v, seed + 46);
          const size = 0.42 + 0.58 * grown * grown;
          const a = hash2(u, v, seed + 47) * TAU;
          rows.add(q[0], q[1], ground.at(q[0], q[1]), dcos(a), dsin(a), size, e.index, POSE.stand, (hash2(u, v, seed + 48) * 256) | 0, 0, (rank * 256) | 0);
        }
      }
    }
    if (tier >= 1) {
      // Animals, in groups: as many as the rule says, each group a hash of where it is.
      for (const a of animals) {
        if (a.size < A.small_m && tier < 2) continue;
        const e = a.perCell;
        const whole = Math.floor(e);
        const n = whole + (hash3(i, j, a.index, seed + 50) < e - whole ? 1 : 0);
        for (let g = 0; g < n; g++) {
          const salt = Math.imul(a.index + 1, 73856093) ^ Math.imul(i, 19349663) ^ Math.imul(j, 83492791) ^ g;
          const rng = new Rng((seed ^ salt) >>> 0);
          let found = false;
          let cx = 0;
          let cy = 0;
          for (let tries = 0; tries < 6 && !found; tries++) {
            cx = (i + rng.next()) * CELL;
            cy = (j + rng.next()) * CELL;
            found = accept(a.habitat, cx, cy, false);
          }
          if (!found) continue;
          placeGroup(rows, groups, a, cx, cy, salt, (hash3(i, j, g, seed + a.index) * 256) | 0);
        }
      }
      // What floats, on the still water.
      if (mats.length) {
        const step = P.mat_step;
        const side = Math.round(CELL / step);
        for (let v = j * side; v < (j + 1) * side; v++) {
          for (let u = i * side; u < (i + 1) * side; u++) {
            if (hash2(u, v, seed + 63) >= (P.mats * step * step) / 10000) continue;
            const x = (u + hash2(u, v, seed + 61)) * step;
            const y = (v + hash2(u, v, seed + 62)) * step;
            const z = ground.at(x, y);
            // Shallow: a pond, an old bend or the river's margin.
            if (z >= level || z < level - 1.6) continue;
            const e = choose(mats, 1, hash2(u, v, seed + 64));
            rows.add(x, y, level, 1, 0, 0.6 + 0.8 * hash2(u, v, seed + 65), e.index, POSE.stand, (hash2(u, v, seed + 66) * 256) | 0, 0, (hash2(u, v, seed + 67) * 256) | 0);
          }
        }
      }
    }
    if (tier >= 2 && under.length) {
      // The understory, only for what is nearly underfoot.
      const step = P.under_step;
      const side = Math.round(CELL / step);
      for (let v = j * side; v < (j + 1) * side; v++) {
        for (let u = i * side; u < (i + 1) * side; u++) {
          const x = (u + hash2(u, v, seed + 51)) * step;
          const y = (v + hash2(u, v, seed + 52)) * step;
          const clump = noise(x / 22, y / 22, seed + 53);
          const chance = (P.under * clump * clump * 4 * step * step) / 10000;
          if (hash2(u, v, seed + 54) >= chance) continue;
          land.at(x, y);
          if (land.water || land.bare > 0.5 || land.low + land.canopy <= 0) continue;
          const e = choose(under, smooth(2.4, 0.5, land.above), hash2(u, v, seed + 55));
          const a = hash2(u, v, seed + 56) * TAU;
          rows.add(x, y, ground.at(x, y), dcos(a), dsin(a), 0.5 + 0.5 * hash2(u, v, seed + 57), e.index, POSE.stand, (hash2(u, v, seed + 58) * 256) | 0, 0, (hash2(u, v, seed + 59) * 256) | 0);
        }
      }
    }
    if (tier >= 1) for (const draw of staged.get(cellKey(i, j)) ?? []) draw(rows, groups);
    return {
      key: cellKey(i, j),
      tier,
      count: rows.taxon.length,
      place: Float32Array.from(rows.place),
      taxon: Uint16Array.from(rows.taxon),
      pose: Uint8Array.from(rows.pose),
      shade: Uint8Array.from(rows.shade),
      phase: Uint8Array.from(rows.phase),
      rank: Uint8Array.from(rows.rank),
      groups,
    };
  };
  return { look, focus, toRiver, cell };
}

/** A cell's rows as bytes: what the build and the browser hash. */
/** A cell as parts of a fingerprint: who stands in it exactly, and where and how big within the tolerance. */
export function cellParts(c: CellRows, prefix = 'cell'): Part[] {
  return [
    { name: `${prefix}.place`, values: c.place },
    { name: `${prefix}.taxon`, values: c.taxon, identity: true },
    { name: `${prefix}.pose`, values: c.pose, identity: true },
    { name: `${prefix}.shade`, values: c.shade },
    { name: `${prefix}.phase`, values: c.phase },
    { name: `${prefix}.rank`, values: c.rank, identity: true },
  ];
}

/** The water of a plain, as a sheet at its level: the ground stands above it except where it is cut. The sea needs none. */
export function waterSheet(spec: SceneSpec, look: PlaceLook): { vertices: Float32Array; indices: Uint32Array } {
  const empty = { vertices: new Float32Array(0), indices: new Uint32Array(0) };
  if (look.water <= 0 || !look.rivers) return empty;
  const reach = (spec.generator.params as unknown as LivingParams).ground.blend[0] * 0.92;
  const n = 96;
  const verts = new Float32Array((n + 1) * (n + 1) * 3);
  const step = (reach * 2) / n;
  const kept: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = (j * (n + 1) + i) * 3;
      verts[k] = -reach + i * step;
      verts[k + 1] = -reach + j * step;
      verts[k + 2] = look.water;
    }
  }
  for (let j = 0; j < n; j++) {
    const y = -reach + (j + 0.5) * step;
    for (let i = 0; i < n; i++) {
      const x = -reach + (i + 0.5) * step;
      if (x * x + y * y > reach * reach) continue;
      const a = j * (n + 1) + i;
      kept.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
    }
  }
  return { vertices: verts, indices: Uint32Array.from(kept) };
}

